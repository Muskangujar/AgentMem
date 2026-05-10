//! Binary entry point for the AgentMem gRPC server.
//!
//! Usage:
//!   cargo run --bin agentmem-server -- [--addr 0.0.0.0:50051] [--db-path /tmp/agentmem_db]

use agentmem_core::server;
use agentmem_core::storage::AgentStorage;
use agentmem_core::{AgentMemEmbedder, HnswIndex};

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let addr = std::env::var("AGENTMEM_ADDR").unwrap_or_else(|_| "0.0.0.0:50051".to_string());
    let db_path =
        std::env::var("AGENTMEM_DB_PATH").unwrap_or_else(|_| "/tmp/agentmem_db".to_string());
    let model_path = std::env::var("AGENTMEM_MODEL_PATH").unwrap_or_default();

    eprintln!("[agentmem] opening RocksDB at {db_path}");
    let storage = AgentStorage::open(&db_path)?;

    let embedder = AgentMemEmbedder::new(&model_path);
    let index = HnswIndex::new();

    // Restore HNSW index from RocksDB snapshot if available
    match index.load_from_storage(&storage) {
        Ok(n) if n > 0 => eprintln!("[agentmem] restored {n} vectors into HNSW index"),
        Ok(_) => eprintln!("[agentmem] no existing HNSW snapshot found, starting fresh"),
        Err(e) => eprintln!("[agentmem] warning: failed to load HNSW snapshot: {e:?}"),
    }

    server::serve(&addr, embedder, storage, index).await
}
