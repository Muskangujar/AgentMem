# EXECUTION TICKET — AgentMem Core (Dev A Domain)

**Audience:** Junior coding agent executing locally in terminal.
**Author:** Dev A (Principal Systems Engineer, AgentBase).
**Scope:** C++ ONNX embedding engine, Rust FFI bridge, RocksDB storage layer, TTL eviction daemon.
**Out of scope (DO NOT TOUCH):** Python SDK, TypeScript dashboard/CLI, `tonic` gRPC server, AgentID integration glue, any `sdk/` or `cli/` or `dashboard/` tree.

---

## 0. Ground Rules (read before any tool call)

1. **Sequential execution.** Phases must complete in order. There is one mandatory PAUSE gate at the end of Phase 1 — stop and wait for the user to confirm `cargo check` is green before starting Phase 2.
2. **No drift.** If a step seems to require touching a file outside `core/`, stop and ask. The Python SDK, gRPC server, and dashboard are owned by Dev B.
3. **Pin versions exactly** as specified in §1.1. Do not "upgrade" to latest crates without asking — `cxx 1.0` and `rocksdb 0.21` were chosen for a reason (mature C ABI for cxx, stable RocksDB CF API in 0.21).
4. **No premature optimization.** Do not introduce `parking_lot`, `dashmap`, `rayon`, or async runtimes other than `tokio`. Do not write benchmarks until the user asks.
5. **No new files** outside the structure described below. The user has already laid out the directory tree; verify with `ls core/` and `ls core/cpp/` and `ls core/src/` before writing anything.
6. **Mocked inference is intentional.** Phase 1 stubs ONNX with deterministic dummy floats. Do not download `bge-small-en-v1.5.onnx` or wire up `tokenizers-cpp` in Phase 1. That is a separate ticket.
7. **Comments policy.** Function-level: only document non-obvious *why*. No multi-line block comments restating signatures.
8. **Error handling boundary.** C++ may throw `std::exception`; cxx surfaces these as `cxx::Exception` on the Rust side. Do not silently swallow. Do not introduce `anyhow` or `thiserror` yet — use `Result<_, cxx::Exception>` and `Result<_, rocksdb::Error>` raw in Phase 1/2. A unified `AgentMemError` is a Phase 4 cleanup.

### 0.1 Preflight — verify before doing anything

Run these and confirm output before any file edit:

```bash
# Toolchain
rustc --version              # expect 1.75+ stable
cargo --version
g++ --version                # expect 11+ (Ubuntu 22.04 default)
pkg-config --version

# ONNX Runtime presence (we link against system lib)
ldconfig -p | grep -i onnxruntime
# OR check the install prefix:
ls /usr/local/lib/libonnxruntime.so*  || ls /usr/lib/x86_64-linux-gnu/libonnxruntime.so*

# Directory structure (must already exist)
test -d core/cpp && test -d core/src && echo "tree ok"
```

If `libonnxruntime.so` is not on the linker path, **stop and tell the user**. Do not attempt to install it; that is an environment task for Dev A.

---

## Phase 1 — FFI Foundation & Embedding Engine (Weeks 1–2)

**Goal:** A Rust caller can invoke `embedder.embed_text("hello")` and get back a `Vec<f32>` of length 384, having crossed into C++ once with zero copies of the input string and zero copies of the output buffer.

**Definition of done for Phase 1:**
- `cargo check -p agentmem-core` is clean (no warnings about `cxx` either).
- `cargo build -p agentmem-core` produces a `.rlib` and links `libonnxruntime` without complaint (linker only — we don't *call* ONNX yet).
- A throwaway `examples/smoke.rs` (created in Phase 1.5 below) prints `[0.0, 0.01, 0.02, ...]` of length 384.

### 1.1 `core/Cargo.toml`

Create with **exactly** these contents (placeholders in `{{...}}`):

```toml
[package]
name = "agentmem-core"
version = "0.1.0"
edition = "2021"
rust-version = "1.75"

[lib]
name = "agentmem_core"
crate-type = ["rlib"]

[dependencies]
cxx = "1.0"
rocksdb = "0.21"
serde = { version = "1.0", features = ["derive"] }
rmp-serde = "1.1"
tokio = { version = "1", features = ["full"] }

[build-dependencies]
cxx-build = "1.0"
```

Notes for the agent:
- **No `[features]` block** in Phase 1. CUDA toggle is Phase 4.
- **No `dev-dependencies`** yet. Tests come in Phase 2.
- Do NOT add `crate-type = ["cdylib"]`. `maturin`'s pyo3 build is owned by Dev B and lives in a separate crate.

### 1.2 `core/build.rs`

Responsibilities, in order:

1. Tell cargo to rerun the build script if any of these change:
   - `src/lib.rs` (the cxx::bridge lives here)
   - `cpp/embedder.h`
   - `cpp/embedder.cpp`
2. Use `cxx_build::bridge("src/lib.rs")` to generate the C++ shim.
3. Add `cpp/embedder.cpp` as a compilation unit (`.file("cpp/embedder.cpp")`).
4. Set `.flag_if_supported("-std=c++17")` and `.flag_if_supported("-Wall")`.
5. Compile under the static-archive name `agentmem_embedder` (`.compile("agentmem_embedder")`).
6. After compile, emit linker directives to cargo:
   - `cargo:rustc-link-lib=onnxruntime` (dynamic; system-installed)
   - If a custom prefix is needed, optionally read `ORT_LIB_DIR` env var and emit `cargo:rustc-link-search=native={dir}`. **Do not** hardcode `/usr/local/lib`.

Pseudo-shape only (do NOT just paste this — fill in idiomatically):

```rust
// build.rs — shape, not final code
fn main() {
    cxx_build::bridge("src/lib.rs")
        .file("cpp/embedder.cpp")
        .flag_if_supported("-std=c++17")
        .flag_if_supported("-Wall")
        .compile("agentmem_embedder");

    if let Ok(dir) = std::env::var("ORT_LIB_DIR") {
        println!("cargo:rustc-link-search=native={dir}");
    }
    println!("cargo:rustc-link-lib=onnxruntime");

    println!("cargo:rerun-if-changed=src/lib.rs");
    println!("cargo:rerun-if-changed=cpp/embedder.h");
    println!("cargo:rerun-if-changed=cpp/embedder.cpp");
    println!("cargo:rerun-if-env-changed=ORT_LIB_DIR");
}
```

**Pitfall:** `cxx-build` requires the bridge module to compile cleanly *as Rust* before it generates headers. If `lib.rs` has a syntax error inside the `#[cxx::bridge]` block, `cxx_build::bridge()` fails first. Always edit `lib.rs` before `embedder.cpp`.

### 1.3 `core/cpp/embedder.h`

Define an `Embedder` class. Required shape:

- Lives in namespace `agentmem` (we'll re-export through the cxx namespace mapping in §1.5).
- Constructor: `Embedder()`. Holds:
  - `Ort::Env env_;` initialized once with severity `ORT_LOGGING_LEVEL_WARNING`, log id `"agentmem"`.
  - `Ort::SessionOptions session_opts_;` with intra-op threads = 1 (we'll surface a knob in Phase 4).
  - `std::unique_ptr<Ort::Session> session_;` — **left null in Phase 1**. We're mocking. Do NOT create a session yet (no model file on disk).
- Public method:
  ```cpp
  void embed(rust::Str text, rust::Slice<float> output) const;
  ```
- Header guard: `#pragma once`.
- Includes: `<onnxruntime_cxx_api.h>`, `<memory>`, `"rust/cxx.h"`. (`rust/cxx.h` is auto-generated and on the include path because of `cxx_build`.)

**Safety rule (state in a one-line comment above the class):** the session is constructed exactly once and is not thread-safe for concurrent `Run()`. Wrap with a Rust-side `Mutex` if multi-threaded calls are needed. We will revisit when we wire real inference.

### 1.4 `core/cpp/embedder.cpp`

Implementation requirements:

1. Constructor: initialize `env_` and `session_opts_`. Do **not** load a model.
2. `embed(rust::Str text, rust::Slice<float> output) const`:
   - `(void)text;` — explicitly mark unused so `-Wall` is clean.
   - **Assert** `output.size() == 384`. Use `if (output.size() != 384) throw std::runtime_error("embed: output buffer must be 384 floats");`. Cxx will surface this as `cxx::Exception` on the Rust side.
   - Fill the buffer: `for (size_t i = 0; i < output.size(); ++i) output[i] = 0.01f * static_cast<float>(i);`.
   - That is *all*. No tokenization, no `Run()`, no allocations.

Mark `embed` as `const` and **do not** capture or store `text`. The `rust::Str` view is only valid for the duration of the call.

### 1.5 `core/src/lib.rs` — the bridge

Top of file:

```rust
#![allow(clippy::needless_lifetimes)] // cxx-generated code

#[cxx::bridge(namespace = "agentmem")]
mod ffi {
    unsafe extern "C++" {
        include!("agentmem-core/cpp/embedder.h");

        type Embedder;

        fn new_embedder() -> UniquePtr<Embedder>;

        // Zero-copy: rust::Str borrows the &str, rust::Slice<f32> borrows the &mut [f32]
        fn embed(self: &Embedder, text: &str, output: &mut [f32]);
    }
}
```

Important details:
- `include!` path is **relative to the crate root as cxx sees it**, which the build script controls. The path `"agentmem-core/cpp/embedder.h"` matches the `cxx_build::bridge("src/lib.rs")` default include prefix. If the include fails at link time, fall back to `include!("cpp/embedder.h")` and adjust `build.rs` `.include(".")` accordingly.
- `new_embedder()` is a **free function** in C++ that returns `std::unique_ptr<Embedder>`. Add it to `embedder.h`/`.cpp` as `std::unique_ptr<Embedder> new_embedder();`. Cxx cannot bind constructors directly; this is the canonical pattern.
- `&mut [f32]` on the Rust side maps to `rust::Slice<float>` (mutable) on the C++ side. This is the zero-copy contract.
- The bridge function itself is `fn embed(self: &Embedder, ...)` — `&self`, not `&mut self`, matching the C++ `const` qualifier.

Below the bridge:

```rust
pub struct AgentMemEmbedder {
    inner: cxx::UniquePtr<ffi::Embedder>,
}

impl AgentMemEmbedder {
    pub fn new() -> Self { /* call ffi::new_embedder() */ }

    /// Embeds `text` into a fixed 384-dim float vector.
    /// Returns a freshly-allocated Vec; a future `embed_into(&mut [f32])`
    /// API will allow the caller to reuse buffers when this matters.
    pub fn embed_text(&self, text: &str) -> Result<Vec<f32>, cxx::Exception> {
        let mut buf = vec![0.0f32; 384];
        // ffi::embed currently doesn't return Result; if it throws (e.g. size assert),
        // cxx converts to cxx::Exception via the catch_unwind-style trampoline.
        // To make that propagate as Result, declare embed in the bridge as
        //     fn embed(self: &Embedder, text: &str, output: &mut [f32]) -> Result<()>;
        // which tells cxx to wrap the call.
        self.inner.embed(text, &mut buf)?;
        Ok(buf)
    }
}
```

**Action:** in the bridge declaration, change `fn embed(...);` to `fn embed(...) -> Result<()>;`. This is the cxx idiom that converts thrown `std::exception`s into `cxx::Exception`. Without `-> Result<()>`, an exception will abort the process.

### 1.6 `core/examples/smoke.rs` (Phase 1.5 verification)

Create a tiny example so we don't need any test framework yet:

```rust
// examples/smoke.rs
use agentmem_core::AgentMemEmbedder;

fn main() {
    let e = AgentMemEmbedder::new();
    let v = e.embed_text("hello world").expect("embed");
    assert_eq!(v.len(), 384);
    assert!((v[0] - 0.0).abs() < 1e-6);
    assert!((v[1] - 0.01).abs() < 1e-6);
    println!("first 4 dims: {:?}", &v[..4]);
}
```

Add `pub use crate::AgentMemEmbedder;` to `lib.rs` so it's reachable from examples.

### 1.7 PAUSE GATE — STOP HERE

Output to the user, **verbatim**:

> Phase 1 implementation complete. Please run:
>
> ```
> cargo check -p agentmem-core
> cargo build -p agentmem-core --example smoke
> cargo run   -p agentmem-core --example smoke
> ```
>
> Confirm: (1) `cargo check` is clean, (2) the smoke example prints `first 4 dims: [0.0, 0.01, 0.02, 0.03]`. Reply "go" to proceed to Phase 2 (storage engine), or share any errors.

**Do not start Phase 2 until the user says "go".** If they report errors, debug iteratively — common ones below.

#### Common Phase 1 errors and fixes

| Symptom | Likely cause | Fix |
|---|---|---|
| `cannot find -lonnxruntime` at link time | ORT lib dir not on linker path | Set `ORT_LIB_DIR=/usr/local/lib` (or wherever) and rebuild |
| `fatal error: rust/cxx.h: No such file` | bridge generation didn't run | Ensure `cxx_build::bridge("src/lib.rs")` runs before `.file(...)` |
| `error: undefined reference to 'agentmem::new_embedder()'` | header declares it, .cpp doesn't define it | Add `std::unique_ptr<Embedder> new_embedder() { return std::make_unique<Embedder>(); }` |
| `cxx::Exception` at runtime: "buffer must be 384" | caller passed wrong-size buffer | Fix caller; assertion is intentional |
| Process aborts (SIGABRT) on exception | bridge fn is missing `-> Result<()>` | Add it; rebuild |

---

## Phase 2 — Storage Engine (Week 3)

**Goal:** A multi-tenant, append-only-where-it-matters RocksDB layer with three Column Families. All reads and writes are namespaced by a 16-byte hash so tenants cannot leak across each other.

**Definition of done for Phase 2:**
- `AgentStorage::open(path)` creates the DB if missing, opens all CFs.
- Round-trip tests pass for episodic and structured CFs (added in §2.4).
- No `unwrap()` in non-test code paths. Bubble up `rocksdb::Error`.

### 2.1 Cross-cutting: namespace hashing

Add a private helper module `core/src/namespace.rs` (this file *is* allowed and necessary):

- Function: `pub(crate) fn ns_hash(namespace: &str) -> [u8; 16]`.
- Use BLAKE3 or SHA-256 truncated to 16 bytes. **Use the `sha2` crate, not a new dependency** — wait: `sha2` is not in `Cargo.toml` yet. Add it now: `sha2 = "0.10"`. Justify in commit: "stable, audited, no transitive bloat; 16-byte truncated SHA-256 is sufficient for tenant prefix collision resistance at our scale."
- Implementation: `Sha256::new().update(namespace.as_bytes()).finalize()` → take first 16 bytes.
- Add a unit test verifying `ns_hash("a")` is deterministic and `ns_hash("a") != ns_hash("b")`.

**Why not a HashMap of namespace → id?** Persistence. The hash is recomputable from the namespace string with zero state. Restart-safe.

### 2.2 `core/src/storage.rs`

Public surface:

```rust
use std::sync::Arc;
use rocksdb::{DB, Options, ColumnFamilyDescriptor, ColumnFamily};

pub struct AgentStorage {
    pub(crate) db: Arc<DB>,
}

impl AgentStorage {
    pub fn open(path: impl AsRef<std::path::Path>) -> Result<Self, rocksdb::Error>;

    pub(crate) fn cf(&self, name: CfName) -> &ColumnFamily;
}

#[derive(Copy, Clone)]
pub(crate) enum CfName {
    Episodic,
    Structured,
    SemanticMeta,
}

impl CfName {
    pub(crate) fn as_str(self) -> &'static str { /* match */ }
}
```

Inside `open`:

1. `Options::default()` with:
   - `create_if_missing(true)`
   - `create_missing_column_families(true)`
   - `set_compression_type(rocksdb::DBCompressionType::Lz4)` — small payloads, fast decode.
2. Build CF descriptors for: `default`, `episodic`, `structured`, `semantic_meta`. Per-CF options can stay default in Phase 2; we'll tune `prefix_extractor` for `episodic` in Phase 4.
3. `DB::open_cf_descriptors(&opts, path, descriptors)`.
4. Wrap in `Arc<DB>` and return.

`cf(CfName::Episodic)` looks up by string name and `expect("CF must exist; opened with create_missing_column_families=true")` — this is a structural invariant, not user input.

**Important:** do not store `&ColumnFamily` handles on the struct. CF handles are tied to the `DB` lifetime; look them up per call. RocksDB CF handle lookup is a `HashMap` access — cheap.

### 2.3 `core/src/episodic.rs` — append-only event log

#### Key schema (32 bytes total)

```
[0..16)   namespace hash  (sha256(namespace)[..16])
[16..24)  timestamp_ns    (u64, BIG-ENDIAN)
[24..32)  action_uuid     (first 8 bytes of uuid::Uuid::new_v4())
```

**Why big-endian?** RocksDB sorts keys lexicographically. Big-endian u64 means lex order = numeric order, so a prefix-seek with the namespace hash will iterate events in time order. Native-endian (little) on x86 would scramble the order.

**Why only 8 bytes of UUID?** Disambiguates concurrent writes inside the same nanosecond. Full 16 bytes is overkill and doubles key size; 64 bits of randomness inside a single nanosecond is more than enough.

Add to `Cargo.toml`: `uuid = { version = "1", features = ["v4"] }`.

#### Value schema (MessagePack via `rmp-serde`)

```rust
#[derive(Serialize, Deserialize)]
pub struct Episode {
    pub action: String,
    pub result_summary: String,
    pub timestamp_ns: u64,            // duplicated from key for convenience on read
    pub action_uuid: [u8; 16],        // full uuid (key only stores first 8 bytes)
}
```

#### Public API

```rust
pub struct EpisodicLog<'a> {
    storage: &'a AgentStorage,
}

impl<'a> EpisodicLog<'a> {
    pub fn new(storage: &'a AgentStorage) -> Self;

    /// Returns the timestamp_ns + uuid actually written, so callers can
    /// reference this episode if needed.
    pub fn log_episode(
        &self,
        namespace: &str,
        action: String,
        result_summary: String,
    ) -> Result<(u64, uuid::Uuid), rocksdb::Error>;

    /// Returns up to `limit` most-recent episodes for the namespace,
    /// newest first. Uses a reverse iterator with prefix bounds.
    pub fn get_episodes(
        &self,
        namespace: &str,
        limit: usize,
    ) -> Result<Vec<Episode>, rocksdb::Error>;
}
```

#### `log_episode` implementation requirements

1. `let ts = std::time::SystemTime::now().duration_since(UNIX_EPOCH)?.as_nanos() as u64;`
   - **Pitfall:** `as_nanos()` returns `u128`; truncating to `u64` is fine until year 2554. Document this with a one-line comment.
2. Generate `let uuid = Uuid::new_v4();`.
3. Build the 32-byte key: `let mut key = [0u8; 32]; key[..16].copy_from_slice(&ns_hash); key[16..24].copy_from_slice(&ts.to_be_bytes()); key[24..32].copy_from_slice(&uuid.as_bytes()[..8]);`
4. Encode value: `rmp_serde::to_vec(&episode)?`.
5. `db.put_cf(cf(Episodic), &key, &value)?`.
6. Return `(ts, uuid)`.

#### `get_episodes` implementation requirements

This is the tricky one. RocksDB's `prefix_iterator_cf` requires a prefix extractor configured on the CF; we don't have one yet. Use a **bounded raw iterator** instead:

1. Compute `lower = ns_hash || [0u8; 16]` and `upper = ns_hash || [0xFFu8; 16]` (32 bytes each).
2. Configure `ReadOptions` with `set_iterate_lower_bound(lower)` and `set_iterate_upper_bound(upper)`.
3. Open `db.iterator_cf_opt(cf(Episodic), read_opts, IteratorMode::End)`.
4. Iterate; decode each value via `rmp_serde::from_slice`; push to `Vec`.
5. Stop after `limit` items.
6. Return; the vec is already newest-first because we iterated from `End`.

**Pitfall:** `IteratorMode::End` requires both bounds to be set — without `upper_bound`, it starts at the literal end of the entire CF (other tenants' data). Always set both.

### 2.4 `core/src/structured.rs` — exact KV

#### Key schema

```
[0..16)   namespace hash
[16..)    user key bytes (variable)
```

#### Public API

```rust
pub struct StructuredKv<'a> {
    storage: &'a AgentStorage,
}

impl<'a> StructuredKv<'a> {
    pub fn new(storage: &'a AgentStorage) -> Self;

    pub fn set_kv(
        &self,
        namespace: &str,
        key: &str,
        value: Vec<u8>,
    ) -> Result<(), rocksdb::Error>;

    pub fn get_kv(
        &self,
        namespace: &str,
        key: &str,
    ) -> Result<Option<Vec<u8>>, rocksdb::Error>;
}
```

Implementation:
- Build full key by concatenating `ns_hash` + `key.as_bytes()` into a `Vec<u8>`. Avoid allocating twice — `let mut full = Vec::with_capacity(16 + key.len()); full.extend_from_slice(&hash); full.extend_from_slice(key.as_bytes());`.
- `set_kv` → `db.put_cf(cf(Structured), &full, &value)`.
- `get_kv` → `db.get_cf(cf(Structured), &full)` returns `Result<Option<Vec<u8>>, _>` directly. Pass through.

**Note on the `value: Vec<u8>` signature:** taking ownership avoids a clone if the caller is willing. If callers tend to pass `&[u8]`, swap to `value: &[u8]` later — for now match the ticket spec.

**Note on what NOT to do:** do not serialize the value with MessagePack. Structured KV is *exact bytes in, exact bytes out*. The caller (Python SDK) decides serialization. This is the explicit-memory contract from the design doc.

### 2.5 Add `dev-dependencies` and a smoke test

In `Cargo.toml`:

```toml
[dev-dependencies]
tempfile = "3"
```

Create `core/tests/storage_smoke.rs` with three round-trip tests:

1. `episodic_round_trip`: log 3 episodes for ns `"a"` and 1 for ns `"b"`. Assert `get_episodes("a", 10)` returns exactly 3, newest first, and `get_episodes("b", 10)` returns exactly 1. **This is the multi-tenancy proof.**
2. `structured_round_trip`: `set_kv("a", "k", b"v".to_vec())`; `get_kv("a", "k") == Some(b"v")`; `get_kv("b", "k") == None`.
3. `episodic_limit`: log 100 episodes; `get_episodes(.., 10)` returns 10.

All tests use `tempfile::TempDir` for the DB path.

After implementing, run `cargo test -p agentmem-core` and report results to user. **No PAUSE gate here** — proceed to Phase 3 unless tests fail.

---

## Phase 3 — Semantic Engine & TTL Daemon (Weeks 3–4)

**Goal:** (a) glue the embedder to a stub vector index so the semantic write path compiles end-to-end, (b) ship a background eviction loop for the episodic CF.

### 3.1 `core/src/semantic.rs`

#### Schema

`semantic_meta` CF stores the *original text* and metadata. The vector lives in the (stub) index:

- Key in `semantic_meta`: `[ns_hash (16B)] | [doc_id (u32 BE, 4B)]`. Total 20 bytes.
- Value (MessagePack):

  ```rust
  #[derive(Serialize, Deserialize)]
  pub struct SemanticRecord {
      pub doc_id: u32,
      pub text: String,
      pub created_ns: u64,
  }
  ```

#### Doc ID generation

A per-namespace monotonic counter. Persist it in the `default` CF under key `[ns_hash] || b"semantic_next_id"`:

- On `remember`: read counter (default `0` if missing), use it as the new `doc_id`, write back `doc_id + 1`. Use a `WriteBatch` so the counter bump and the record write are atomic.

#### Stub vector index

```rust
use std::collections::HashMap;
use std::sync::RwLock;

pub struct StubIndex {
    // key: (ns_hash, doc_id), value: 384-dim vector
    inner: RwLock<HashMap<([u8; 16], u32), Vec<f32>>>,
}

impl StubIndex {
    pub fn new() -> Self;
    pub fn insert(&self, ns: [u8; 16], doc_id: u32, vec: Vec<f32>);
    // Phase 3 does NOT implement search — explicitly leave search() as
    //     pub fn search(...) -> Vec<u32> { unimplemented!("hnsw replaces this in Phase 4") }
}
```

This intentionally has no persistence — it's a placeholder. **Do not** add `serde` to `StubIndex`. The whole point is that the future HNSW (`instant-distance` or hand-rolled) will replace this struct wholesale; persistence is its problem to solve.

#### Public API

```rust
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
    ) -> Self;

    /// Returns the assigned doc_id.
    pub fn remember(
        &self,
        namespace: &str,
        text: &str,
    ) -> Result<u32, SemanticError>;
}

#[derive(Debug)]
pub enum SemanticError {
    Embed(cxx::Exception),
    Storage(rocksdb::Error),
    Encode(rmp_serde::encode::Error),
}
```

`From` impls for the three inner errors so `?` works.

`remember` flow (in this order — order matters for crash safety):

1. Embed: `let vec = self.embedder.embed_text(text)?;` (cheap to fail; do this first).
2. Read+bump counter via `WriteBatch`:
   - Read current counter (`storage.db.get_cf(default_cf, counter_key)?`).
   - Decode as `u32::from_be_bytes`.
   - Build `SemanticRecord { doc_id, text: text.to_string(), created_ns }`; encode via `rmp_serde::to_vec`.
   - `WriteBatch`: `put_cf(semantic_meta_cf, record_key, encoded)` and `put_cf(default_cf, counter_key, (doc_id+1).to_be_bytes())`.
   - `db.write(batch)?`.
3. Insert into `StubIndex` *after* the DB commit. Index is volatile; if it fails, the canonical record is still in RocksDB and the future HNSW Phase 4 task can backfill from `semantic_meta`.

### 3.2 `core/src/ttl.rs` — eviction daemon

#### API

```rust
use std::time::Duration;
use std::sync::Arc;

pub struct TtlConfig {
    pub episodic_max_age: Duration,
    pub scan_interval: Duration,
}

pub fn spawn_episodic_evictor(
    storage: Arc<AgentStorage>,
    config: TtlConfig,
) -> tokio::task::JoinHandle<()>;
```

#### Behavior

A `tokio::spawn`'d future that loops forever:

1. Sleep `config.scan_interval`.
2. Compute `cutoff_ns = now_ns - config.episodic_max_age.as_nanos() as u64`.
3. Iterate the `episodic` CF *across all namespaces*. For each key:
   - Bytes 16..24 are the timestamp BE.
   - If `ts < cutoff_ns`, append to a `Vec<Vec<u8>>` of keys-to-delete (cap at 10_000 per scan to bound memory).
4. Apply deletes via a single `WriteBatch`.
5. Log: `eprintln!("[ttl] evicted {n} episodic entries older than {cutoff_ns}");` (replace with `tracing` in Phase 4 — do not add it now).
6. Loop.

#### Design notes (call these out to the user in your summary)

- **Why not a per-key TTL using RocksDB's CompactOnDeletionCollector?** That requires a custom CF compaction filter — significantly more code, harder to test, and ties us to a specific RocksDB build. The async sweep is simple, observable, and good enough for a v1 with hundreds of thousands of episodes. We'll revisit if scan time grows past ~50ms.
- **Why iterate all namespaces?** TTL is a global policy, not per-tenant. Per-tenant TTLs are a future feature — gate behind a config map in Phase 4 if/when product asks.
- **Cancellation:** the returned `JoinHandle` is the cancellation handle. The caller (eventually, the gRPC server in Dev B's domain) will `handle.abort()` on shutdown. Do not add a custom shutdown channel.

#### Test

`core/tests/ttl_smoke.rs`:

1. Open a storage with a `TempDir`.
2. Manually log 5 episodes with timestamps spread across "old" (now - 1h) and "new" (now). To do this, expose a `pub(crate) fn log_episode_at(&self, .., ts_ns: u64)` test helper on `EpisodicLog` (gate behind `#[cfg(test)]` or `pub(crate)` and re-export under `#[cfg(test)]`).
3. Call the eviction loop body **once directly** (refactor the loop body into a private `pub(crate) fn evict_once(...)` function so the test doesn't have to deal with `tokio::time::sleep`).
4. Assert old episodes are gone, new ones remain.

### 3.3 `core/src/lib.rs` — module wiring

After Phase 3, `lib.rs` re-exports:

```rust
mod namespace;
pub mod storage;
pub mod episodic;
pub mod structured;
pub mod semantic;
pub mod ttl;

pub use storage::AgentStorage;
pub use episodic::{EpisodicLog, Episode};
pub use structured::StructuredKv;
pub use semantic::{SemanticMemory, SemanticRecord, SemanticError, StubIndex};
pub use ttl::{TtlConfig, spawn_episodic_evictor};

// (cxx::bridge stays at the bottom or in its own private mod)
pub use embedder_wrapper::AgentMemEmbedder;
```

Adjust the bridge module path (`mod ffi` and `pub struct AgentMemEmbedder`) into a `pub(crate) mod embedder_wrapper` if needed to keep `lib.rs` tidy.

---

## 4. Cross-cutting requirements

### 4.1 Lints

Add to top of `lib.rs`:

```rust
#![deny(unsafe_op_in_unsafe_fn)]
#![warn(clippy::pedantic, clippy::nursery)]
#![allow(clippy::module_name_repetitions, clippy::must_use_candidate)]
```

If pedantic generates >20 warnings on first compile, ratchet down to `#![warn(clippy::all)]` and report to user. Do not silence individual lints in line.

### 4.2 No `unwrap` outside tests

All non-test code paths must propagate errors. The only acceptable `expect()` is on structural invariants (`cf(...).expect("CF was created at open")`).

### 4.3 No `println!` outside `examples/` and the TTL daemon

Logging belongs to `tracing` (Phase 4). For now, the TTL `eprintln!` is the one exception, called out above.

### 4.4 Concurrency model summary

- `AgentStorage` is `Send + Sync` because `Arc<DB>` is.
- `AgentMemEmbedder` is `Send` but **not `Sync`** until we wrap the C++ session in a `Mutex`. **Document this on the struct** with a `// SAFETY:` comment. Phase 4 will add the mutex when we wire real ONNX.
- `StubIndex` is `Send + Sync` (its inner `RwLock<HashMap>` is).

---

## 5. Verification matrix (run before declaring "done")

| Command | Expected |
|---|---|
| `cargo fmt --check -p agentmem-core` | clean |
| `cargo clippy -p agentmem-core --all-targets -- -D warnings` | clean |
| `cargo build -p agentmem-core` | builds rlib |
| `cargo test -p agentmem-core` | all tests green |
| `cargo run -p agentmem-core --example smoke` | prints first 4 dims `[0.0, 0.01, 0.02, 0.03]` |
| `ldd target/debug/examples/smoke \| grep onnx` | shows `libonnxruntime.so` resolved |

---

## 6. Out-of-scope reminders (re-read before each commit)

You will be tempted to do these. **Do not.**

- ❌ Implement real ONNX inference. (Phase 4 — separate ticket.)
- ❌ Wire `tokenizers-cpp`. (Phase 4.)
- ❌ Build an HNSW. (Phase 4 — likely `instant-distance` crate, but TBD.)
- ❌ Add a gRPC server, `tonic`, `prost`, `.proto` files. (Dev B's domain.)
- ❌ Add `pyo3`, `maturin`, or any Python glue. (Dev B's domain.)
- ❌ Touch `sdk/`, `cli/`, `dashboard/`. (Dev B's domain.)
- ❌ Integrate with AgentID. (Phase 5.)
- ❌ Add `tracing`, `tracing-subscriber`, structured logging. (Phase 4.)
- ❌ Refactor errors into a unified `AgentMemError` enum. (Phase 4 cleanup.)

If a step seems to demand any of these, stop and ask.

---

## 7. Final report format

When all three phases are done, produce a summary in this shape:

```
Phase 1: <PASS/FAIL>  files: Cargo.toml, build.rs, cpp/embedder.{h,cpp}, src/lib.rs, examples/smoke.rs
Phase 2: <PASS/FAIL>  files: src/{namespace.rs, storage.rs, episodic.rs, structured.rs}, tests/storage_smoke.rs
Phase 3: <PASS/FAIL>  files: src/{semantic.rs, ttl.rs}, tests/ttl_smoke.rs

Verification:
  cargo fmt --check        : <result>
  cargo clippy -D warnings : <result>
  cargo test               : <N passed, M failed>
  cargo run --example smoke: <output>

Open questions for Dev A:
  - <anything that required a judgment call>
```

End with a list of every `TODO(phase4)` comment you left in the code, with file:line references, so Dev A can audit them in one pass.
