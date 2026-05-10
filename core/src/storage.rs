use rocksdb::{ColumnFamily, ColumnFamilyDescriptor, Options, DB};
use std::sync::Arc;

pub struct AgentStorage {
    pub(crate) db: Arc<DB>,
}

impl AgentStorage {
    pub fn open(path: impl AsRef<std::path::Path>) -> Result<Self, rocksdb::Error> {
        let mut opts = Options::default();
        opts.create_if_missing(true);
        opts.create_missing_column_families(true);
        opts.set_compression_type(rocksdb::DBCompressionType::Lz4);

        let descriptors = ["default", "episodic", "structured", "semantic_meta"]
            .iter()
            .map(|name| ColumnFamilyDescriptor::new(*name, Options::default()))
            .collect::<Vec<_>>();

        let db = DB::open_cf_descriptors(&opts, path, descriptors)?;
        Ok(Self { db: Arc::new(db) })
    }

    pub(crate) fn cf(&self, name: CfName) -> &ColumnFamily {
        self.db
            .cf_handle(name.as_str())
            .expect("CF must exist; opened with create_missing_column_families=true")
    }
}

#[derive(Copy, Clone)]
pub(crate) enum CfName {
    Episodic,
    Structured,
    SemanticMeta,
    /// "default" CF used for counters and metadata (Phase 3+).
    Default,
}

impl CfName {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Episodic => "episodic",
            Self::Structured => "structured",
            Self::SemanticMeta => "semantic_meta",
        }
    }
}
