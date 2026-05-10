#![allow(clippy::needless_lifetimes)] // cxx-generated code
#![deny(unsafe_op_in_unsafe_fn)]
// Ratcheted down from pedantic+nursery: generated 28 errors (>20 threshold). (TODO(phase4): revisit)
#![warn(clippy::all)]

pub mod episodic;
mod namespace;
pub mod semantic;
pub mod server;
pub mod storage;
pub mod structured;
pub mod ttl;

pub use episodic::{Episode, EpisodicLog};
pub use semantic::{HnswIndex, SemanticError, SemanticMemory, SemanticRecord};
pub use storage::AgentStorage;
pub use structured::StructuredKv;
pub use ttl::{spawn_episodic_evictor, TtlConfig};

#[cxx::bridge(namespace = "agentmem")]
mod ffi {
    unsafe extern "C++" {
        include!("cpp/embedder.h");

        type Embedder;

        fn new_embedder(model_path: &str) -> UniquePtr<Embedder>;

        // Zero-copy: rust::Str borrows the &str, rust::Slice<f32> borrows the &mut [f32]
        fn embed(self: &Embedder, text: &str, output: &mut [f32]) -> Result<()>;

        fn dim(self: &Embedder) -> usize;
    }
}

// SAFETY: AgentMemEmbedder is Send + Sync — the underlying C++ Embedder
// serializes inference calls internally via a std::mutex on session_.Run().
// This is safe for tonic's multi-threaded Tokio runtime.
pub struct AgentMemEmbedder {
    inner: cxx::UniquePtr<ffi::Embedder>,
}

// SAFETY: The C++ Embedder now guards session_.Run() with a std::mutex,
// making concurrent calls from multiple threads safe.
unsafe impl Send for AgentMemEmbedder {}
unsafe impl Sync for AgentMemEmbedder {}

impl Default for AgentMemEmbedder {
    fn default() -> Self {
        Self::new("")
    }
}

impl AgentMemEmbedder {
    pub fn new(model_path: &str) -> Self {
        Self {
            inner: ffi::new_embedder(model_path),
        }
    }

    /// Returns the embedding dimension (384 for bge-small-en-v1.5).
    pub fn dim(&self) -> usize {
        self.inner.dim()
    }

    /// Embeds `text` into a fixed-dim float vector.
    /// Returns a freshly-allocated Vec; a future `embed_into(&mut [f32])`
    /// API will allow the caller to reuse buffers when this matters.
    pub fn embed_text(&self, text: &str) -> Result<Vec<f32>, cxx::Exception> {
        let d = self.inner.dim();
        let mut buf = vec![0.0f32; d];
        self.inner.embed(text, &mut buf)?;
        Ok(buf)
    }
}
