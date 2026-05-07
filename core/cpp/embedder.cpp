#include "cpp/embedder.h"
#include <stdexcept>

namespace agentmem {

Embedder::Embedder()
    : env_(ORT_LOGGING_LEVEL_WARNING, "agentmem") {
    session_opts_.SetIntraOpNumThreads(1);
    // session_ intentionally left null — no model loaded in Phase 1
}

void Embedder::embed(rust::Str text, rust::Slice<float> output) const {
    (void)text;
    if (output.size() != 384) {
        throw std::runtime_error("embed: output buffer must be 384 floats");
    }
    for (size_t i = 0; i < output.size(); ++i) {
        output[i] = 0.01f * static_cast<float>(i);
    }
}

std::unique_ptr<Embedder> new_embedder() {
    return std::make_unique<Embedder>();
}

} // namespace agentmem
