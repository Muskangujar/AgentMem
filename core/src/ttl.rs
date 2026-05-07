use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use rocksdb::{IteratorMode, WriteBatch};

use crate::storage::{AgentStorage, CfName};

pub struct TtlConfig {
    pub episodic_max_age: Duration,
    pub scan_interval: Duration,
}

pub fn spawn_episodic_evictor(
    storage: Arc<AgentStorage>,
    config: TtlConfig,
) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        loop {
            tokio::time::sleep(config.scan_interval).await;

            // as u64 truncation is safe until year 2554
            #[allow(clippy::cast_possible_truncation)]
            let now_ns = SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .expect("system clock is before Unix epoch")
                .as_nanos() as u64;
            let cutoff_ns = now_ns.saturating_sub(config.episodic_max_age.as_nanos() as u64);

            match evict_once(&storage, cutoff_ns) {
                Ok(n) => {
                    eprintln!("[ttl] evicted {n} episodic entries older than {cutoff_ns}");
                }
                Err(e) => eprintln!("[ttl] eviction error: {e}"),
            }
        }
    })
}

/// Scans all episodic entries and deletes those whose timestamp is before `cutoff_ns`.
/// Caps at 10 000 deletes per call to bound peak memory. Returns the number evicted.
pub fn evict_once(storage: &AgentStorage, cutoff_ns: u64) -> Result<usize, rocksdb::Error> {
    let cf = storage.cf(CfName::Episodic);
    let iter = storage.db.iterator_cf(cf, IteratorMode::Start);

    let mut to_delete: Vec<Box<[u8]>> = Vec::new();
    for item in iter {
        let (key, _val) = item?;
        // Key layout: [ns_hash 0..16) | [ts_ns 16..24) | [uuid 24..32)
        if key.len() >= 24 {
            let mut ts_bytes = [0u8; 8];
            ts_bytes.copy_from_slice(&key[16..24]);
            if u64::from_be_bytes(ts_bytes) < cutoff_ns {
                to_delete.push(key);
            }
        }
        if to_delete.len() >= 10_000 {
            break;
        }
    }

    let n = to_delete.len();
    if n > 0 {
        let mut batch = WriteBatch::default();
        for key in &to_delete {
            batch.delete_cf(cf, key);
        }
        storage.db.write(batch)?;
    }

    Ok(n)
}
