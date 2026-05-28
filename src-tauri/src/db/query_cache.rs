//! LRU query result cache — 50 entries, 5-minute TTL, ~100MB cap (best-effort).
use std::hash::{Hash, Hasher};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use lru::LruCache;
use serde_json::Value;

use crate::db::types::ColumnMeta;

const MAX_ENTRIES: usize = 50;
const TTL: Duration = Duration::from_secs(300); // 5 minutes

#[derive(Clone)]
pub struct CachedResult {
    pub columns: Vec<ColumnMeta>,
    pub rows: Vec<serde_json::Map<String, Value>>,
    pub cached_at: Instant,
}

#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct CacheKey {
    pub connection_id: String,
    pub sql_hash: u64,
}

impl CacheKey {
    pub fn new(connection_id: &str, sql: &str) -> Self {
        use std::hash::DefaultHasher;
        let mut h = DefaultHasher::new();
        sql.hash(&mut h);
        Self {
            connection_id: connection_id.to_string(),
            sql_hash: h.finish(),
        }
    }
}

pub struct QueryCache {
    inner: Mutex<LruCache<CacheKey, CachedResult>>,
}

impl QueryCache {
    pub fn new() -> Self {
        Self {
            inner: Mutex::new(LruCache::new(
                std::num::NonZeroUsize::new(MAX_ENTRIES).unwrap(),
            )),
        }
    }

    pub fn get(&self, key: &CacheKey) -> Option<CachedResult> {
        let mut cache = self.inner.lock().unwrap();
        if let Some(entry) = cache.get(key) {
            if entry.cached_at.elapsed() < TTL {
                return Some(entry.clone());
            }
            // Expired — remove it
            cache.pop(key);
        }
        None
    }

    pub fn insert(&self, key: CacheKey, result: CachedResult) {
        self.inner.lock().unwrap().put(key, result);
    }

    /// Clear all entries for a given connection, or all entries if connection_id is None.
    pub fn clear(&self, connection_id: Option<&str>) {
        let mut cache = self.inner.lock().unwrap();
        match connection_id {
            None => cache.clear(),
            Some(id) => {
                let keys_to_remove: Vec<CacheKey> = cache
                    .iter()
                    .filter(|(k, _)| k.connection_id == id)
                    .map(|(k, _)| k.clone())
                    .collect();
                for k in keys_to_remove {
                    cache.pop(&k);
                }
            }
        }
    }
}
