#include "cpp/embedder.h"
#include <cmath>
#include <cstring>
#include <numeric>
#include <stdexcept>
#include <functional>

#ifdef _WIN32
#include <windows.h>
#endif

namespace agentmem {

// ── Constants for bge-small-en-v1.5 ─────────────────────────────────────────
static constexpr size_t BGE_DIM = 384;
static constexpr size_t MAX_SEQ_LEN = 512;
static constexpr int64_t CLS_TOKEN = 101;
static constexpr int64_t SEP_TOKEN = 102;

/// Derive the directory containing `model_path` and return the path to vocab.txt
/// in that same directory.  Works on both POSIX ("/") and Windows ("\") paths.
static std::string vocab_path_from_model(const std::string& model_path) {
    size_t sep = model_path.find_last_of("/\\");
    if (sep == std::string::npos) return "vocab.txt"; // model in cwd
    return model_path.substr(0, sep + 1) + "vocab.txt";
}

Embedder::Embedder(const std::string& model_path)
    : env_(ORT_LOGGING_LEVEL_WARNING, "agentmem"),
      dim_(BGE_DIM),
      stub_mode_(model_path.empty()) {

    session_opts_.SetIntraOpNumThreads(2);
    session_opts_.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);

    if (!stub_mode_) {
        try {
#ifdef _WIN32
            // Windows ONNX Runtime requires wide string paths.
            int wlen = MultiByteToWideChar(CP_UTF8, 0, model_path.c_str(), -1, nullptr, 0);
            std::vector<wchar_t> wpath(wlen);
            MultiByteToWideChar(CP_UTF8, 0, model_path.c_str(), -1, wpath.data(), wlen);
            session_ = std::make_unique<Ort::Session>(env_, wpath.data(), session_opts_);
#else
            session_ = std::make_unique<Ort::Session>(env_, model_path.c_str(), session_opts_);
#endif
        } catch (const Ort::Exception& e) {
            fprintf(stderr,
                    "[agentmem] WARNING: failed to load ONNX model at '%s': %s\n"
                    "           Falling back to deterministic stub embeddings.\n",
                    model_path.c_str(), e.what());
            stub_mode_ = true;
            session_.reset();
        }

        // Load vocab.txt from the model directory for real WordPiece tokenization.
        // Falls back silently to FNV-1a hash tokenization if vocab.txt is absent.
        if (!stub_mode_) {
            std::string vpath = vocab_path_from_model(model_path);
            if (tokenizer_.load(vpath)) {
                fprintf(stderr, "[agentmem] WordPiece tokenizer loaded: %zu tokens from %s\n",
                        tokenizer_.vocab_size(), vpath.c_str());
            } else {
                fprintf(stderr,
                        "[agentmem] WARNING: vocab.txt not found at '%s'; "
                        "using FNV-1a hash tokenization (lower embedding quality).\n"
                        "           Place vocab.txt alongside the ONNX model for real "
                        "BERT tokenization.\n",
                        vpath.c_str());
            }
        }
    }
}

size_t Embedder::dim() const {
    return dim_;
}

/// Tokenize text into BERT token IDs.
///
/// When a vocabulary is loaded: applies BERT BasicTokenizer (lowercase, strip
/// combining marks, CJK spacing, punctuation split) followed by WordPiece greedy
/// longest-prefix matching — producing the correct token IDs for bge-small-en-v1.5.
///
/// Fallback (no vocab.txt): maps each whitespace-delimited token to an ID in
/// [1, 30000) via FNV-1a hash. The IDs are wrong for the model vocabulary but
/// produce stable, deterministic values; embedding quality is degraded but the
/// ONNX session still runs without crashing.
std::vector<int64_t> Embedder::tokenize(const std::string& text) const {
    if (tokenizer_.is_loaded()) {
        return tokenizer_.tokenize(text, MAX_SEQ_LEN);
    }

    // ── FNV-1a fallback (no vocab.txt available) ──────────────────────────
    std::vector<int64_t> ids;
    ids.push_back(CLS_TOKEN);

    size_t start = 0;
    while (start < text.size()) {
        while (start < text.size() && std::isspace(static_cast<unsigned char>(text[start])))
            ++start;
        if (start >= text.size()) break;

        size_t end = start;
        while (end < text.size() && !std::isspace(static_cast<unsigned char>(text[end])))
            ++end;

        uint64_t hash = 14695981039346656037ULL;
        for (size_t i = start; i < end; ++i) {
            hash ^= static_cast<uint64_t>(
                static_cast<unsigned char>(std::tolower(static_cast<unsigned char>(text[i]))));
            hash *= 1099511628211ULL;
        }
        ids.push_back(static_cast<int64_t>((hash % 29999) + 1));

        start = end;
        if (ids.size() >= MAX_SEQ_LEN - 1) break;
    }

    ids.push_back(SEP_TOKEN);
    return ids;
}

void Embedder::embed(rust::Str text, rust::Slice<float> output) const {
    if (output.size() != dim_) {
        throw std::runtime_error(
            "embed: output buffer must be " + std::to_string(dim_) + " floats, got " +
            std::to_string(output.size()));
    }

    std::string text_str(text.data(), text.size());

    if (stub_mode_) {
        // ── Deterministic stub: hash-based embedding ────────────────────────
        // Produces distinct, deterministic vectors for different inputs so that
        // cosine similarity is meaningful even without a real model.
        uint64_t hash = 14695981039346656037ULL;
        for (char c : text_str) {
            hash ^= static_cast<uint64_t>(static_cast<unsigned char>(c));
            hash *= 1099511628211ULL;
        }

        float norm = 0.0f;
        for (size_t i = 0; i < dim_; ++i) {
            uint64_t h = hash ^ (i * 2654435761ULL);
            h = (h >> 16) ^ h;
            float val = static_cast<float>(static_cast<int64_t>(h % 20001) - 10000) / 10000.0f;
            output[i] = val;
            norm += val * val;
        }
        norm = std::sqrt(norm);
        if (norm > 1e-12f) {
            for (size_t i = 0; i < dim_; ++i) output[i] /= norm;
        }
        return;
    }

    // ── Real ONNX inference ─────────────────────────────────────────────────

    // 1. Tokenize (WordPiece when vocab loaded, FNV-1a hash otherwise)
    auto token_ids = tokenize(text_str);
    size_t seq_len = token_ids.size();

    // 2. Build attention mask and token type IDs
    std::vector<int64_t> attention_mask(seq_len, 1);
    std::vector<int64_t> token_type_ids(seq_len, 0);

    // 3. Create ONNX tensors
    Ort::MemoryInfo mem_info = Ort::MemoryInfo::CreateCpu(OrtArenaAllocator, OrtMemTypeDefault);
    std::array<int64_t, 2> shape = {1, static_cast<int64_t>(seq_len)};

    auto input_ids_tensor = Ort::Value::CreateTensor<int64_t>(
        mem_info, token_ids.data(), token_ids.size(), shape.data(), shape.size());
    auto attention_mask_tensor = Ort::Value::CreateTensor<int64_t>(
        mem_info, attention_mask.data(), attention_mask.size(), shape.data(), shape.size());
    auto token_type_ids_tensor = Ort::Value::CreateTensor<int64_t>(
        mem_info, token_type_ids.data(), token_type_ids.size(), shape.data(), shape.size());

    // 4. Run inference (mutex-guarded for thread safety)
    const char* input_names[]  = {"input_ids", "attention_mask", "token_type_ids"};
    const char* output_names[] = {"last_hidden_state"};

    std::vector<Ort::Value> input_tensors;
    input_tensors.push_back(std::move(input_ids_tensor));
    input_tensors.push_back(std::move(attention_mask_tensor));
    input_tensors.push_back(std::move(token_type_ids_tensor));

    std::vector<Ort::Value> output_tensors;
    {
        std::lock_guard<std::mutex> lock(const_cast<std::mutex&>(mu_));
        output_tensors = session_->Run(
            Ort::RunOptions{nullptr},
            input_names, input_tensors.data(), input_tensors.size(),
            output_names, 1);
    }

    // 5. Extract CLS token embedding (first token of last_hidden_state).
    //    Output shape: [1, seq_len, 384]
    auto& out_tensor = output_tensors[0];
    auto type_info = out_tensor.GetTensorTypeAndShapeInfo();
    auto out_shape = type_info.GetShape();
    size_t hidden_dim = static_cast<size_t>(out_shape.back());

    if (hidden_dim != dim_) {
        throw std::runtime_error(
            "embed: model output dim " + std::to_string(hidden_dim) +
            " != expected " + std::to_string(dim_));
    }

    const float* raw = out_tensor.GetTensorData<float>();

    // CLS pooling: use the first token's hidden state
    float norm = 0.0f;
    for (size_t i = 0; i < dim_; ++i) {
        output[i] = raw[i];
        norm += raw[i] * raw[i];
    }

    // L2-normalize the output embedding
    norm = std::sqrt(norm);
    if (norm > 1e-12f) {
        for (size_t i = 0; i < dim_; ++i) output[i] /= norm;
    }
}

std::unique_ptr<Embedder> new_embedder(rust::Str model_path) {
    std::string path(model_path.data(), model_path.size());
    return std::make_unique<Embedder>(path);
}

} // namespace agentmem
