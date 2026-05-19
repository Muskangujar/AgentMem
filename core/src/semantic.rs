use std::sync::RwLock;
use std::time::{SystemTime, UNIX_EPOCH};

use instant_distance::{Builder, HnswMap, Search};
use rocksdb::WriteBatch;
use serde::{Deserialize, Serialize};

use crate::error::AgentMemError;
use crate::namespace::ns_hash;
use crate::storage::{AgentStorage, CfName};
use crate::AgentMemEmbedder;

const EMBED_DIM: usize = 384;

#[derive(Serialize, Deserialize)]
pub struct SemanticRecord {
    pub doc_id: u32,
    pub text: String,
    pub created_ns: u64,
}

/// A point in the HNSW index: namespace hash + doc_id + embedding vector.
#[derive(Clone, Serialize, Deserialize)]
pub struct HnswPoint {
    pub ns: [u8; 16],
    pub doc_id: u32,
    pub vec: Vec<f32>,
}

impl instant_distance::Point for HnswPoint {
    fn distance(&self, other: &Self) -> f32 {
        let mut dot = 0.0f32;
        let mut norm_a = 0.0f32;
        let mut norm_b = 0.0f32;
        for i in 0..self.vec.len().min(other.vec.len()) {
            dot += self.vec[i] * other.vec[i];
            norm_a += self.vec[i] * self.vec[i];
            norm_b += other.vec[i] * other.vec[i];
        }
        let denom = norm_a.sqrt() * norm_b.sqrt();
        if denom < 1e-12 {
            return 1.0;
        }
        1.0 - (dot / denom)
    }
}

/// Real HNSW approximate nearest-neighbor index, backed by `instant-distance`.
///
/// Thread-safe via internal `RwLock`. The index is rebuilt on every insert
/// (acceptable for v1 with < 100K points).
///
/// Persistence: the full point set is serialized to `bincode` and stored in
/// the RocksDB `default` CF under key `hnsw_index_snapshot`.
pub struct HnswIndex {
    inner: RwLock<HnswState>,
}

struct HnswState {
    points: Vec<HnswPoint>,
    map: Option<HnswMap<HnswPoint, u32>>,
}

impl Default for HnswIndex {
    fn default() -> Self {
        Self::new()
    }
}

impl HnswIndex {
    pub fn new() -> Self {
        Self {
            inner: RwLock::new(HnswState {
                points: Vec::new(),
                map: None,
            }),
        }
    }

    pub fn insert(&self, ns: [u8; 16], doc_id: u32, vec: Vec<f32>) {
        let mut state = self.inner.write().expect("HnswIndex RwLock poisoned");
        let point = HnswPoint { ns, doc_id, vec };
        state.points.push(point);
        Self::rebuild(&mut state);
    }

    pub fn search(&self, ns: [u8; 16], query: &[f32], k: usize) -> Vec<u32> {
        let state = self.inner.read().expect("HnswIndex RwLock poisoned");
        let map = match &state.map {
            Some(m) => m,
            None => return Vec::new(),
        };

        let query_point = HnswPoint {
            ns,
            doc_id: 0,
            vec: query.to_vec(),
        };

        let mut search = Search::default();
        let candidates = k * 4 + 16;
        let results = map.search(&query_point, &mut search);

        let mut out = Vec::with_capacity(k);
        for result in results.take(candidates) {
            let point = result.point;
            let value = *result.value;
            if point.ns == ns {
                out.push(value);
                if out.len() >= k {
                    break;
                }
            }
        }
        out
    }

    pub fn save_to_storage(&self, storage: &AgentStorage) -> Result<(), AgentMemError> {
        let state = self.inner.read().expect("HnswIndex RwLock poisoned");
        let encoded = bincode::serialize(&state.points)?;
        storage
            .db
            .put_cf(storage.cf(CfName::Default), b"hnsw_index_snapshot", encoded)?;
        Ok(())
    }

    pub fn load_from_storage(&self, storage: &AgentStorage) -> Result<usize, AgentMemError> {
        let raw = storage
            .db
            .get_cf(storage.cf(CfName::Default), b"hnsw_index_snapshot")?;
        match raw {
            Some(data) => {
                let points: Vec<HnswPoint> = bincode::deserialize(&data)?;
                let count = points.len();
                let mut state = self.inner.write().expect("HnswIndex RwLock poisoned");
                state.points = points;
                Self::rebuild(&mut state);
                Ok(count)
            }
            None => Ok(0),
        }
    }

    fn rebuild(state: &mut HnswState) {
        if state.points.is_empty() {
            state.map = None;
            return;
        }
        let values: Vec<u32> = state.points.iter().map(|p| p.doc_id).collect();
        let map = Builder::default().build(state.points.clone(), values);
        state.map = Some(map);
    }

    pub fn len(&self) -> usize {
        self.inner.read().expect("HnswIndex RwLock poisoned").points.len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }
}

pub struct SemanticMemory<'a> {
    embedder: &'a AgentMemEmbedder,
    storage: &'a AgentStorage,
    index: &'a HnswIndex,
}

impl<'a> SemanticMemory<'a> {
    pub fn new(
        embedder: &'a AgentMemEmbedder,
        storage: &'a AgentStorage,
        index: &'a HnswIndex,
    ) -> Self {
        Self {
            embedder,
            storage,
            index,
        }
    }

    /// Embeds `text`, persists it to `semantic_meta` CF, inserts the vector
    /// into the HNSW index, and saves the index snapshot to RocksDB.
    /// Returns the assigned `doc_id`.
    pub fn remember(&self, namespace: &str, text: &str) -> Result<u32, AgentMemError> {
        let vec = self.embedder.embed_text(text)?;

        let ns = ns_hash(namespace);

        let mut counter_key = [0u8; 32];
        counter_key[..16].copy_from_slice(&ns);
        counter_key[16..].copy_from_slice(b"semantic_next_id");

        let default_cf = self.storage.cf(CfName::Default);
        let meta_cf = self.storage.cf(CfName::SemanticMeta);

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

        let mut record_key = [0u8; 20];
        record_key[..16].copy_from_slice(&ns);
        record_key[16..].copy_from_slice(&doc_id.to_be_bytes());

        let encoded = rmp_serde::to_vec(&record)?;

        let mut batch = WriteBatch::default();
        batch.put_cf(meta_cf, record_key, &encoded);
        batch.put_cf(default_cf, counter_key, (doc_id + 1).to_be_bytes());
        self.storage.db.write(batch)?;

        self.index.insert(ns, doc_id, vec);
        // Best-effort persist — if this fails the index can be rebuilt from semantic_meta.
        let _ = self.index.save_to_storage(self.storage);

        Ok(doc_id)
    }

    /// Semantic recall: embeds the query, searches the HNSW index for the `k`
    /// nearest neighbors in the given namespace, and returns the original texts.
    pub fn recall(
        &self,
        namespace: &str,
        query: &str,
        k: usize,
    ) -> Result<Vec<(u32, String, f32)>, AgentMemError> {
        let query_vec = self.embedder.embed_text(query)?;
        let ns = ns_hash(namespace);

        let doc_ids = self.index.search(ns, &query_vec, k);

        let meta_cf = self.storage.cf(CfName::SemanticMeta);
        let mut results = Vec::with_capacity(doc_ids.len());

        for doc_id in &doc_ids {
            let mut record_key = [0u8; 20];
            record_key[..16].copy_from_slice(&ns);
            record_key[16..].copy_from_slice(&doc_id.to_be_bytes());

            if let Ok(Some(data)) = self.storage.db.get_cf(meta_cf, record_key) {
                if let Ok(record) = rmp_serde::from_slice::<SemanticRecord>(&data) {
                    let score = cosine_similarity(&query_vec, &self.get_vector(ns, *doc_id));
                    results.push((*doc_id, record.text, score));
                }
            }
        }

        results.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
        Ok(results)
    }

    fn get_vector(&self, ns: [u8; 16], doc_id: u32) -> Vec<f32> {
        let state = self.index.inner.read().expect("HnswIndex RwLock poisoned");
        for p in &state.points {
            if p.ns == ns && p.doc_id == doc_id {
                return p.vec.clone();
            }
        }
        vec![0.0; EMBED_DIM]
    }
}

fn cosine_similarity(a: &[f32], b: &[f32]) -> f32 {
    let mut dot = 0.0f32;
    let mut norm_a = 0.0f32;
    let mut norm_b = 0.0f32;
    for i in 0..a.len().min(b.len()) {
        dot += a[i] * b[i];
        norm_a += a[i] * a[i];
        norm_b += b[i] * b[i];
    }
    let denom = norm_a.sqrt() * norm_b.sqrt();
    if denom < 1e-12 {
        return 0.0;
    }
    dot / denom
}
