//! PyO3 native extension for AgentMem.
//!
//! Exposes the Rust core's three memory subsystems to Python as simple
//! functions.  The `Memory` Python class in `agentmem/memory.py` calls
//! these in embedded mode; server mode uses gRPC instead.

use pyo3::exceptions::PyRuntimeError;
use pyo3::prelude::*;
use pyo3::types::PyDict;

use agentmem_core::episodic::EpisodicLog;
use agentmem_core::semantic::SemanticMemory;
use agentmem_core::storage::AgentStorage;
use agentmem_core::structured::StructuredKv;
use agentmem_core::{AgentMemEmbedder, StubIndex};

use uuid::Uuid;

// ── Helpers ──────────────────────────────────────────────────────────────────

/// Map any error that implements Debug into a Python RuntimeError.
fn to_pyerr<E: std::fmt::Debug>(e: E) -> PyErr {
    PyRuntimeError::new_err(format!("{e:?}"))
}

// ── Semantic Memory ─────────────────────────────────────────────────────────

/// Embed `text` and persist it under `namespace`.  Returns the assigned doc_id.
#[pyfunction]
fn native_remember(db_path: &str, namespace: &str, text: &str) -> PyResult<u32> {
    let storage = AgentStorage::open(db_path).map_err(to_pyerr)?;
    let embedder = AgentMemEmbedder::new();
    let index = StubIndex::new();

    let sem = SemanticMemory::new(&embedder, &storage, &index);
    sem.remember(namespace, text).map_err(to_pyerr)
}

// ── Episodic Memory ─────────────────────────────────────────────────────────

/// Log an episode and return (timestamp_ns, action_uuid_str).
#[pyfunction]
fn native_log_episode(
    db_path: &str,
    namespace: &str,
    action: &str,
    result_summary: &str,
) -> PyResult<(u64, String)> {
    let storage = AgentStorage::open(db_path).map_err(to_pyerr)?;
    let log = EpisodicLog::new(&storage);

    let (ts, uuid) = log
        .log_episode(namespace, action.to_string(), result_summary.to_string())
        .map_err(to_pyerr)?;

    Ok((ts, uuid.to_string()))
}

/// Retrieve the last `limit` episodes for `namespace`.
/// Returns a list of dicts with keys: action, result_summary, timestamp_ns, action_uuid.
#[pyfunction]
fn native_get_episodes(py: Python<'_>, db_path: &str, namespace: &str, limit: usize) -> PyResult<Vec<Py<PyDict>>> {
    let storage = AgentStorage::open(db_path).map_err(to_pyerr)?;
    let log = EpisodicLog::new(&storage);

    let episodes = log.get_episodes(namespace, limit).map_err(to_pyerr)?;

    let mut results = Vec::with_capacity(episodes.len());
    for ep in episodes {
        let dict = PyDict::new_bound(py);
        dict.set_item("action", &ep.action)?;
        dict.set_item("result_summary", &ep.result_summary)?;
        dict.set_item("timestamp_ns", ep.timestamp_ns)?;
        dict.set_item("action_uuid", Uuid::from_bytes(ep.action_uuid).to_string())?;
        results.push(dict.into());
    }

    Ok(results)
}

// ── Structured KV ───────────────────────────────────────────────────────────

/// Set a key-value pair under `namespace`.
#[pyfunction]
fn native_set_kv(db_path: &str, namespace: &str, key: &str, value: Vec<u8>) -> PyResult<()> {
    let storage = AgentStorage::open(db_path).map_err(to_pyerr)?;
    let kv = StructuredKv::new(&storage);
    kv.set_kv(namespace, key, value).map_err(to_pyerr)
}

/// Get a value by key under `namespace`.  Returns None if not found.
#[pyfunction]
fn native_get_kv(db_path: &str, namespace: &str, key: &str) -> PyResult<Option<Vec<u8>>> {
    let storage = AgentStorage::open(db_path).map_err(to_pyerr)?;
    let kv = StructuredKv::new(&storage);
    kv.get_kv(namespace, key).map_err(to_pyerr)
}

// ── Module ──────────────────────────────────────────────────────────────────

/// The native Python extension module, importable as `agentmem._native`.
#[pymodule]
fn _native(m: &Bound<'_, PyModule>) -> PyResult<()> {
    m.add_function(wrap_pyfunction!(native_remember, m)?)?;
    m.add_function(wrap_pyfunction!(native_log_episode, m)?)?;
    m.add_function(wrap_pyfunction!(native_get_episodes, m)?)?;
    m.add_function(wrap_pyfunction!(native_set_kv, m)?)?;
    m.add_function(wrap_pyfunction!(native_get_kv, m)?)?;
    Ok(())
}
