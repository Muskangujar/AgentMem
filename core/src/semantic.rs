use std::collections::HashMap;
use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

use rocksdb::WriteBatch;
use serde::{Deserialize, Serialize};

use crate::namespace::ns_hash;
use crate::storage::{AgentStorage, CfName};
use crate::AgentMemEmbedder;

#[derive(Serialize, Deserialize)]
pub struct SemanticRecord {
    pub doc_id: u32,
    pub text: String,
    pub created_ns: u64,
}

// Key: (namespace hash, doc_id) → embedding vector. HNSW replaces this in Phase 4 (TODO(phase4)).
type VecStore = HashMap<([u8; 16], u32), Vec<f32>>;

/// In-memory vector index placeholder. HNSW replaces this entirely in Phase 4 (TODO(phase4)).
// Send + Sync: inner RwLock<VecStore> is both.
pub struct StubIndex {
    inner: RwLock<VecStore>,
}

impl Default for StubIndex {
    fn default() -> Self {
        Self::new()
    }
}

impl StubIndex {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(HashMap::new()),
        }
    }

    pub fn insert(&self, ns: [u8; 16], doc_id: u32, vec: Vec<f32>) {
        self.inner
            .write()
            .expect("StubIndex RwLock poisoned")
            .insert((ns, doc_id), vec);
    }

    pub fn search(&self, _ns: [u8; 16], _query: &[f32], _k: usize) -> Vec<u32> {
        unimplemented!("hnsw replaces this in Phase 4")
    }
}

#[derive(Debug)]
pub enum SemanticError {
    Embed(cxx::Exception),
    Storage(rocksdb::Error),
    Encode(rmp_serde::encode::Error),
}

impl From<cxx::Exception> for SemanticError {
    fn from(e: cxx::Exception) -> Self {
        Self::Embed(e)
    }
}

impl From<rocksdb::Error> for SemanticError {
    fn from(e: rocksdb::Error) -> Self {
        Self::Storage(e)
    }
}

impl From<rmp_serde::encode::Error> for SemanticError {
    fn from(e: rmp_serde::encode::Error) -> Self {
        Self::Encode(e)
    }
}

pub struct SemanticMemory<'a> {
    embedder: &'a AgentMemEmbedder,
    storage: &'a AgentStorage,
    index: &'a StubIndex,
}

impl<'a> SemanticMemory<'a> {
    pub fn new(
        embedder: &'a AgentMemEmbedder,
        storage: &'a AgentStorage,
        index: &'a StubIndex,
    ) -> Self {
        Self {
            embedder,
            storage,
            index,
        }
    }

    /// Embeds `text`, persists it to `semantic_meta` CF, and inserts the vector into the stub
    /// index. Returns the assigned `doc_id`. The index insert happens after the DB commit so that
    /// a crash between the two leaves only the canonical RocksDB record, which a Phase 4
    /// backfill task can pick up.
    pub fn remember(&self, namespace: &str, text: &str) -> Result<u32, SemanticError> {
        // 1. Embed first — cheap to fail; do before touching the DB.
        let vec = self.embedder.embed_text(text)?;

        let ns = ns_hash(namespace);

        // Counter key: [ns_hash (16B)] || b"semantic_next_id" (16B) = 32B total.
        let mut counter_key = [0u8; 32];
        counter_key[..16].copy_from_slice(&ns);
        counter_key[16..].copy_from_slice(b"semantic_next_id");

        let default_cf = self.storage.cf(CfName::Default);
        let meta_cf = self.storage.cf(CfName::SemanticMeta);

        // 2. Read + atomically bump counter via WriteBatch.
        let counter_bytes = self.storage.db.get_cf(default_cf, counter_key)?;
        let doc_id = counter_bytes
            .as_deref()
            .and_then(|v| <[u8; 4]>::try_from(v).ok())
            .map(u32::from_be_bytes)
            .unwrap_or(0u32);

        // as u64 truncation is safe until year 2554
        #[allow(clippy::cast_possible_truncation)]
        let created_ns = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is before Unix epoch")
            .as_nanos() as u64;

        let record = SemanticRecord {
            doc_id,
            text: text.to_string(),
            created_ns,
        };

        // Key: [ns_hash (16B)] | [doc_id BE (4B)] = 20B.
        let mut record_key = [0u8; 20];
        record_key[..16].copy_from_slice(&ns);
        record_key[16..].copy_from_slice(&doc_id.to_be_bytes());

        let encoded = rmp_serde::to_vec(&record)?;

        let mut batch = WriteBatch::default();
        batch.put_cf(meta_cf, record_key, &encoded);
        batch.put_cf(default_cf, counter_key, (doc_id + 1).to_be_bytes());
        self.storage.db.write(batch)?;

        // 3. Insert into StubIndex after DB commit (volatile; crash here leaves a backfillable gap).
        self.index.insert(ns, doc_id, vec);

        Ok(doc_id)
    }
}
