use crate::namespace::ns_hash;
use crate::storage::{AgentStorage, CfName};

pub struct StructuredKv<'a> {
    storage: &'a AgentStorage,
}

impl<'a> StructuredKv<'a> {
    pub fn new(storage: &'a AgentStorage) -> Self {
        Self { storage }
    }

    pub fn set_kv(&self, namespace: &str, key: &str, value: Vec<u8>) -> Result<(), rocksdb::Error> {
        let full = self.full_key(namespace, key);
        self.storage
            .db
            .put_cf(self.storage.cf(CfName::Structured), full, value)
    }

    pub fn get_kv(&self, namespace: &str, key: &str) -> Result<Option<Vec<u8>>, rocksdb::Error> {
        let full = self.full_key(namespace, key);
        self.storage
            .db
            .get_cf(self.storage.cf(CfName::Structured), full)
    }

    fn full_key(&self, namespace: &str, key: &str) -> Vec<u8> {
        let hash = ns_hash(namespace);
        let mut full = Vec::with_capacity(16 + key.len());
        full.extend_from_slice(&hash);
        full.extend_from_slice(key.as_bytes());
        full
    }
}
