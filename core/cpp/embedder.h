#pragma once

#include "rust/cxx.h"
#include <memory>
#include <onnxruntime_cxx_api.h>

namespace agentmem {

// SAFETY: session_ is constructed exactly once and is not thread-safe for
// concurrent Run(). Wrap the Rust-side AgentMemEmbedder in a Mutex if
// multi-threaded calls are needed; revisit when real inference is wired.
class Embedder {
public:
    Embedder();
    ~Embedder() = default;

    void embed(rust::Str text, rust::Slice<float> output) const;

private:
    Ort::Env env_;
    Ort::SessionOptions session_opts_;
    std::unique_ptr<Ort::Session> session_; // left null in Phase 1 (stub)
};

std::unique_ptr<Embedder> new_embedder();

} // namespace agentmem
