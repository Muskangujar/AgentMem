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

Embedder::Embedder(const std::string& model_path)
    : env_(ORT_LOGGING_LEVEL_WARNING, "agentmem"),
      dim_(BGE_DIM),
      stub_mode_(model_path.empty()) {

    session_opts_.SetIntraOpNumThreads(2);
    session_opts_.SetGraphOptimizationLevel(GraphOptimizationLevel::ORT_ENABLE_ALL);

    if (!stub_mode_) {
        try {
#ifdef _WIN32
            // Windows ONNX Runtime requires wide string paths
            int wlen = MultiByteToWideChar(CP_UTF8, 0, model_path.c_str(), -1, nullptr, 0);
            std::vector<wchar_t> wpath(wlen);
            MultiByteToWideChar(CP_UTF8, 0, model_path.c_str(), -1, wpath.data(), wlen);
            session_ = std::make_unique<Ort::Session>(
                env_, wpath.data(), session_opts_);
#else
            session_ = std::make_unique<Ort::Session>(
                env_, model_path.c_str(), session_opts_);
#endif
        } catch (const Ort::Exception& e) {
            // Fall back to stub mode if model can't be loaded
            fprintf(stderr, "[agentmem] WARNING: failed to load ONNX model at '%s': %s\n"
                            "           Falling back to deterministic stub embeddings.\n",
                    model_path.c_str(), e.what());
            stub_mode_ = true;
            session_.reset();
        }
    }
}

size_t Embedder::dim() const {
    return dim_;
}

/// Hash-based pseudo-tokenizer: maps each whitespace-delimited token to
/// a token ID in [1, 30000) using FNV-1a hash. This is NOT a proper
/// WordPiece tokenizer, but produces stable, deterministic IDs that the
/// ONNX model can consume. For production quality, wire tokenizers-cpp.
std::vector<int64_t> Embedder::tokenize(const std::string& text) const {
    std::vector<int64_t> ids;
    ids.push_back(CLS_TOKEN);

    // Simple whitespace split
    size_t start = 0;
    while (start < text.size()) {
        // Skip whitespace
        while (start < text.size() && std::isspace(static_cast<unsigned char>(text[start])))
            ++start;
        if (start >= text.size()) break;

        size_t end = start;
        while (end < text.size() && !std::isspace(static_cast<unsigned char>(text[end])))
            ++end;

        // FNV-1a hash of the word → token ID in [1, 30000)
        uint64_t hash = 14695981039346656037ULL;
        for (size_t i = start; i < end; ++i) {
            hash ^= static_cast<uint64_t>(static_cast<unsigned char>(
                std::tolower(static_cast<unsigned char>(text[i]))));
            hash *= 1099511628211ULL;
        }
        ids.push_back(static_cast<int64_t>((hash % 29999) + 1));

        start = end;
        if (ids.size() >= MAX_SEQ_LEN - 1) break;  // leave room for SEP
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
        // ── Deterministic stub: hash-based embedding ────────────────────
        // Produces distinct, deterministic vectors for different inputs
        // so that cosine similarity is meaningful even without a real model.
        uint64_t hash = 14695981039346656037ULL;
        for (char c : text_str) {
            hash ^= static_cast<uint64_t>(static_cast<unsigned char>(c));
            hash *= 1099511628211ULL;
        }

        float norm = 0.0f;
        for (size_t i = 0; i < dim_; ++i) {
            // Mix hash with position to get unique per-dimension values
            uint64_t h = hash ^ (i * 2654435761ULL);
            h = (h >> 16) ^ h;
            // Map to [-1, 1]
            float val = static_cast<float>(static_cast<int64_t>(h % 20001) - 10000) / 10000.0f;
            output[i] = val;
            norm += val * val;
        }
        // L2-normalize
        norm = std::sqrt(norm);
        if (norm > 1e-12f) {
            for (size_t i = 0; i < dim_; ++i) {
                output[i] /= norm;
            }
        }
        return;
    }

    // ── Real ONNX inference ─────────────────────────────────────────────

    // 1. Tokenize
    auto token_ids = tokenize(text_str);
    size_t seq_len = token_ids.size();

    // 2. Build attention mask and token type IDs
    std::vector<int64_t> attention_mask(seq_len, 1);
    std::vector<int64_t> token_type_ids(seq_len, 0);

    // 3. Create ONNX tensors
    Ort::MemoryInfo mem_info = Ort::MemoryInfo::CreateCpu(
        OrtArenaAllocator, OrtMemTypeDefault);

    std::array<int64_t, 2> shape = {1, static_cast<int64_t>(seq_len)};

    auto input_ids_tensor = Ort::Value::CreateTensor<int64_t>(
        mem_info, token_ids.data(), token_ids.size(),
        shape.data(), shape.size());

    auto attention_mask_tensor = Ort::Value::CreateTensor<int64_t>(
        mem_info, attention_mask.data(), attention_mask.size(),
        shape.data(), shape.size());

    auto token_type_ids_tensor = Ort::Value::CreateTensor<int64_t>(
        mem_info, token_type_ids.data(), token_type_ids.size(),
        shape.data(), shape.size());

    // 4. Run inference (mutex-guarded for thread safety)
    const char* input_names[] = {"input_ids", "attention_mask", "token_type_ids"};
    const char* output_names[] = {"last_hidden_state"};

    std::vector<Ort::Value> input_tensors;
    input_tensors.push_back(std::move(input_ids_tensor));
    input_tensors.push_back(std::move(attention_mask_tensor));
    input_tensors.push_back(std::move(token_type_ids_tensor));

    std::vector<Ort::Value> output_tensors;
    {
        std::lock_guard<std::mutex> lock(
            const_cast<std::mutex&>(mu_));

        output_tensors = session_->Run(
            Ort::RunOptions{nullptr},
            input_names, input_tensors.data(), input_tensors.size(),
            output_names, 1);
    }

    // 5. Extract CLS token embedding (first token of last_hidden_state)
    //    Shape: [1, seq_len, 384]
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

    // CLS pooling: first token
    float norm = 0.0f;
    for (size_t i = 0; i < dim_; ++i) {
        output[i] = raw[i];
        norm += raw[i] * raw[i];
    }

    // L2-normalize the output embedding
    norm = std::sqrt(norm);
    if (norm > 1e-12f) {
        for (size_t i = 0; i < dim_; ++i) {
            output[i] /= norm;
        }
    }
}

std::unique_ptr<Embedder> new_embedder(rust::Str model_path) {
    std::string path(model_path.data(), model_path.size());
    return std::make_unique<Embedder>(path);
}

} // namespace agentmem
