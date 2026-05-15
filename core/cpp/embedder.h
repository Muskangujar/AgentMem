#pragma once

#include "rust/cxx.h"
#include "cpp/tokenizer.h"
#include <memory>
#include <mutex>
#include <string>
#include <vector>
#include <onnxruntime_cxx_api.h>

namespace agentmem {

/// ONNX Runtime embedding engine for bge-small-en-v1.5.
///
/// Thread safety: session_.Run() is guarded by an internal std::mutex,
/// so this class is safe for concurrent calls from multiple Rust threads.
/// The Rust-side AgentMemEmbedder can implement both Send and Sync.
class Embedder {
public:
    /// If `model_path` is empty, falls back to deterministic stub output
    /// (for testing without a model file). Otherwise loads the ONNX model
    /// and tries to load vocab.txt from the same directory for real WordPiece
    /// tokenization; falls back to FNV-1a hash tokenization if vocab.txt
    /// is absent.
    explicit Embedder(const std::string& model_path);
    ~Embedder() = default;

    void embed(rust::Str text, rust::Slice<float> output) const;
    size_t dim() const;

private:
    Ort::Env env_;
    Ort::SessionOptions session_opts_;
    std::unique_ptr<Ort::Session> session_;
    mutable std::mutex mu_;        // guards session_->Run()
    WordPieceTokenizer tokenizer_; // real BERT tokenizer; loaded from vocab.txt
    size_t dim_;
    bool stub_mode_;

    /// Tokenize text into BERT token IDs.
    /// Uses the real WordPiece tokenizer when vocab.txt was successfully loaded;
    /// otherwise falls back to FNV-1a hash projection into [1, 30000).
    std::vector<int64_t> tokenize(const std::string& text) const;
};

std::unique_ptr<Embedder> new_embedder(rust::Str model_path);

} // namespace agentmem
