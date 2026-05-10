use std::time::{SystemTime, UNIX_EPOCH};

use agentmem_core::{episodic::EpisodicLog, storage::AgentStorage, ttl::evict_once};
use tempfile::TempDir;

#[test]
fn old_episodes_evicted_new_remain() {
    let dir = TempDir::new().unwrap();
    let storage = AgentStorage::open(dir.path()).unwrap();
    let log = EpisodicLog::new(&storage);

    let now_ns = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_nanos() as u64;

    let old_ns = now_ns - 2 * 3_600_000_000_000_u64; // 2 hours ago
    let new_ns = now_ns - 30 * 60_000_000_000_u64; // 30 minutes ago

    for i in 0..3_u64 {
        log.log_episode_at("ns", format!("old{i}"), String::new(), old_ns + i)
            .unwrap();
    }
    for i in 0..2_u64 {
        log.log_episode_at("ns", format!("new{i}"), String::new(), new_ns + i)
            .unwrap();
    }

    // cutoff = 1 hour ago; the 3 old entries should be evicted
    let cutoff_ns = now_ns - 3_600_000_000_000_u64;
    let evicted = evict_once(&storage, cutoff_ns).unwrap();
    assert_eq!(evicted, 3, "three old episodes should have been evicted");

    let remaining = log.get_episodes("ns", 100).unwrap();
    assert_eq!(remaining.len(), 2, "two new episodes should remain");
}
