use agentmem_core::{episodic::EpisodicLog, storage::AgentStorage, structured::StructuredKv};
use tempfile::TempDir;

/// Proves multi-tenancy: episodes for ns "a" and "b" never mix.
#[test]
fn episodic_round_trip() {
    let dir = TempDir::new().unwrap();
    let storage = AgentStorage::open(dir.path()).unwrap();
    let log = EpisodicLog::new(&storage);

    log.log_episode("a", "act1".into(), "res1".into()).unwrap();
    log.log_episode("a", "act2".into(), "res2".into()).unwrap();
    log.log_episode("a", "act3".into(), "res3".into()).unwrap();
    log.log_episode("b", "act4".into(), "res4".into()).unwrap();

    let a_eps = log.get_episodes("a", 10).unwrap();
    assert_eq!(a_eps.len(), 3, "ns 'a' should have exactly 3 episodes");

    let b_eps = log.get_episodes("b", 10).unwrap();
    assert_eq!(b_eps.len(), 1, "ns 'b' should have exactly 1 episode");

    let a_actions: Vec<&str> = a_eps.iter().map(|e| e.action.as_str()).collect();
    assert!(a_actions.contains(&"act1"));
    assert!(a_actions.contains(&"act2"));
    assert!(a_actions.contains(&"act3"));
}

/// Proves namespace isolation for exact-KV: same key, different namespaces → no leak.
#[test]
fn structured_round_trip() {
    let dir = TempDir::new().unwrap();
    let storage = AgentStorage::open(dir.path()).unwrap();
    let kv = StructuredKv::new(&storage);

    kv.set_kv("a", "k", b"v".to_vec()).unwrap();
    assert_eq!(kv.get_kv("a", "k").unwrap(), Some(b"v".to_vec()));
    assert_eq!(
        kv.get_kv("b", "k").unwrap(),
        None,
        "ns 'b' must not see ns 'a' data"
    );
}

/// Proves the limit parameter is respected.
#[test]
fn episodic_limit() {
    let dir = TempDir::new().unwrap();
    let storage = AgentStorage::open(dir.path()).unwrap();
    let log = EpisodicLog::new(&storage);

    for i in 0..100_usize {
        log.log_episode("ns", format!("act{i}"), format!("res{i}"))
            .unwrap();
    }

    let eps = log.get_episodes("ns", 10).unwrap();
    assert_eq!(eps.len(), 10);
}
