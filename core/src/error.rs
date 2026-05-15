use thiserror::Error;
use tonic::Status;

/// Unified error type for all AgentMem operations.
///
/// gRPC mapping (via `From<AgentMemError> for tonic::Status`):
///   NotFound      → Status::not_found
///   all others    → Status::internal
#[derive(Debug, Error)]
pub enum AgentMemError {
    #[error("storage error: {0}")]
    Storage(#[from] rocksdb::Error),

    /// Wraps errors from the C++ ONNX embedder (cxx::Exception).
    #[error("embedder error: {0}")]
    Embedder(String),

    /// Covers msgpack (rmp-serde) and bincode serialization/deserialization.
    #[error("serialization error: {0}")]
    Serialization(String),

    #[error("not found: {0}")]
    NotFound(String),
}

// cxx::Exception: we stringify rather than store the exception object because
// it may not satisfy 'static, which thiserror's #[from] requires.
impl From<cxx::Exception> for AgentMemError {
    fn from(e: cxx::Exception) -> Self {
        Self::Embedder(e.to_string())
    }
}

impl From<rmp_serde::encode::Error> for AgentMemError {
    fn from(e: rmp_serde::encode::Error) -> Self {
        Self::Serialization(e.to_string())
    }
}

impl From<bincode::Error> for AgentMemError {
    fn from(e: bincode::Error) -> Self {
        Self::Serialization(e.to_string())
    }
}

/// Map AgentMemError to a tonic gRPC Status for use in server handlers.
impl From<AgentMemError> for Status {
    fn from(e: AgentMemError) -> Self {
        match &e {
            AgentMemError::NotFound(_) => Status::not_found(e.to_string()),
            _ => Status::internal(e.to_string()),
        }
    }
}
