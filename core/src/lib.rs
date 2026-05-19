#![allow(clippy::needless_lifetimes)] // cxx-generated code
#![deny(unsafe_op_in_unsafe_fn)]
#![warn(clippy::all)]

pub mod episodic;
pub mod error;
mod namespace;
pub mod semantic;
pub mod server;
pub mod storage;
pub mod structured;
pub mod ttl;

pub use episodic::{Episode, EpisodicLog};
pub use error::AgentMemError;
pub use semantic::{HnswIndex, SemanticMemory, SemanticRecord};
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
pub struct AgentMemEmbedder {
    inner: cxx::UniquePtr<ffi::Embedder>,
}

// SAFETY: The C++ Embedder guards session_.Run() with a std::mutex.
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

    pub fn dim(&self) -> usize {
        self.inner.dim()
    }

    /// Embeds `text` into a fixed-dim float vector.
    pub fn embed_text(&self, text: &str) -> Result<Vec<f32>, AgentMemError> {
        let d = self.inner.dim();
        let mut buf = vec![0.0f32; d];
        self.inner.embed(text, &mut buf)?;
        Ok(buf)
    }
}
