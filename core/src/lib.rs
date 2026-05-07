#![allow(clippy::needless_lifetimes)] // cxx-generated code
#![deny(unsafe_op_in_unsafe_fn)]
// Ratcheted down from pedantic+nursery: generated 28 errors (>20 threshold). (TODO(phase4): revisit)
#![warn(clippy::all)]

pub mod episodic;
mod namespace;
pub mod semantic;
pub mod storage;
pub mod structured;
pub mod ttl;

pub use episodic::{Episode, EpisodicLog};
pub use semantic::{SemanticError, SemanticMemory, SemanticRecord, StubIndex};
pub use storage::AgentStorage;
pub use structured::StructuredKv;
pub use ttl::{spawn_episodic_evictor, TtlConfig};

#[cxx::bridge(namespace = "agentmem")]
mod ffi {
    unsafe extern "C++" {
        include!("cpp/embedder.h");

        type Embedder;

        fn new_embedder() -> UniquePtr<Embedder>;

        // Zero-copy: rust::Str borrows the &str, rust::Slice<f32> borrows the &mut [f32]
        fn embed(self: &Embedder, text: &str, output: &mut [f32]) -> Result<()>;
    }
}

// SAFETY: AgentMemEmbedder is Send but not Sync — the underlying C++ session_
// is not safe for concurrent Run() calls. Callers requiring multi-threaded
// embedding must wrap this in a Mutex. Phase 4 will add the mutex when real
// ONNX inference is wired (TODO(phase4)).
pub struct AgentMemEmbedder {
    inner: cxx::UniquePtr<ffi::Embedder>,
}

impl Default for AgentMemEmbedder {
    fn default() -> Self {
        Self::new()
    }
}

impl AgentMemEmbedder {
    pub fn new() -> Self {
        Self {
            inner: ffi::new_embedder(),
        }
    }

    /// Embeds `text` into a fixed 384-dim float vector.
    /// Returns a freshly-allocated Vec; a future `embed_into(&mut [f32])`
    /// API will allow the caller to reuse buffers when this matters.
    pub fn embed_text(&self, text: &str) -> Result<Vec<f32>, cxx::Exception> {
        let mut buf = vec![0.0f32; 384];
        self.inner.embed(text, &mut buf)?;
        Ok(buf)
    }
}

// AgentMemEmbedder is defined above at crate root; no re-export needed.
