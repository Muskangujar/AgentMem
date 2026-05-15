use std::time::{SystemTime, UNIX_EPOCH};

use rocksdb::{IteratorMode, ReadOptions};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::error::AgentMemError;
use crate::namespace::ns_hash;
use crate::storage::{AgentStorage, CfName};

#[derive(Serialize, Deserialize)]
pub struct Episode {
    pub action: String,
    pub result_summary: String,
    pub timestamp_ns: u64,
    pub action_uuid: [u8; 16],
}

pub struct EpisodicLog<'a> {
    storage: &'a AgentStorage,
}

impl<'a> EpisodicLog<'a> {
    pub fn new(storage: &'a AgentStorage) -> Self {
        Self { storage }
    }

    pub fn log_episode(
        &self,
        namespace: &str,
        action: String,
        result_summary: String,
    ) -> Result<(u64, Uuid), AgentMemError> {
        // as u64 truncation is safe until year 2554
        #[allow(clippy::cast_possible_truncation)]
        let ts = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("system clock is before Unix epoch")
            .as_nanos() as u64;

        let id = Uuid::new_v4();
        let ns = ns_hash(namespace);

        let mut key = [0u8; 32];
        key[..16].copy_from_slice(&ns);
        key[16..24].copy_from_slice(&ts.to_be_bytes());
        key[24..32].copy_from_slice(&id.as_bytes()[..8]);

        let episode = Episode {
            action,
            result_summary,
            timestamp_ns: ts,
            action_uuid: *id.as_bytes(),
        };

        let value = rmp_serde::to_vec(&episode)
            .expect("Episode is a plain struct; serialization cannot fail");

        self.storage
            .db
            .put_cf(self.storage.cf(CfName::Episodic), key, value)?;

        Ok((ts, id))
    }

    /// Test helper: write an episode at an explicit timestamp rather than now.
    pub fn log_episode_at(
        &self,
        namespace: &str,
        action: String,
        result_summary: String,
        ts_ns: u64,
    ) -> Result<(u64, Uuid), AgentMemError> {
        let id = Uuid::new_v4();
        let ns = ns_hash(namespace);

        let mut key = [0u8; 32];
        key[..16].copy_from_slice(&ns);
        key[16..24].copy_from_slice(&ts_ns.to_be_bytes());
        key[24..32].copy_from_slice(&id.as_bytes()[..8]);

        let episode = Episode {
            action,
            result_summary,
            timestamp_ns: ts_ns,
            action_uuid: *id.as_bytes(),
        };

        let value = rmp_serde::to_vec(&episode)
            .expect("Episode is a plain struct; serialization cannot fail");

        self.storage
            .db
            .put_cf(self.storage.cf(CfName::Episodic), key, value)?;

        Ok((ts_ns, id))
    }

    pub fn get_episodes(
        &self,
        namespace: &str,
        limit: usize,
    ) -> Result<Vec<Episode>, AgentMemError> {
        let ns = ns_hash(namespace);

        let mut lower = [0u8; 32];
        lower[..16].copy_from_slice(&ns);

        let mut upper = [0xFFu8; 32];
        upper[..16].copy_from_slice(&ns);

        let mut read_opts = ReadOptions::default();
        read_opts.set_iterate_lower_bound(lower.to_vec());
        read_opts.set_iterate_upper_bound(upper.to_vec());

        let iter = self.storage.db.iterator_cf_opt(
            self.storage.cf(CfName::Episodic),
            read_opts,
            IteratorMode::End,
        );

        let mut episodes = Vec::new();
        for item in iter {
            let (_key, val) = item?;
            let episode: Episode = rmp_serde::from_slice(&val)
                .expect("episode decode: data written by this crate is always valid msgpack");
            episodes.push(episode);
            if episodes.len() >= limit {
                break;
            }
        }

        Ok(episodes)
    }
}
