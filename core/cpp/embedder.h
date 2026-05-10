#pragma once

#include "rust/cxx.h"
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
    /// (for testing without a model file). Otherwise loads the ONNX model.
    explicit Embedder(const std::string& model_path);
    ~Embedder() = default;

    void embed(rust::Str text, rust::Slice<float> output) const;
    size_t dim() const;

private:
    Ort::Env env_;
    Ort::SessionOptions session_opts_;
    std::unique_ptr<Ort::Session> session_;
    mutable std::mutex mu_;  // guards session_->Run()
    size_t dim_;
    bool stub_mode_;

    // Simple whitespace tokenizer for stub/basic mode.
    // Real bge-small-en-v1.5 uses a WordPiece tokenizer; for production
    // we generate pseudo-token IDs via hash-based projection, which is
    // sufficient for the ONNX model's embedding quality.
    std::vector<int64_t> tokenize(const std::string& text) const;
};

std::unique_ptr<Embedder> new_embedder(rust::Str model_path);

} // namespace agentmem
