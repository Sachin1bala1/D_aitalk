use tauri::{AppHandle, Emitter};

use super::types::QueryBatch;
use crate::error::DbError;

pub trait QueryBatchSink: Send + Sync {
    fn emit_batch(&self, batch: QueryBatch) -> Result<(), DbError>;
}

pub struct TauriQueryBatchSink {
    app: AppHandle,
}

impl TauriQueryBatchSink {
    pub fn new(app: AppHandle) -> Self {
        Self { app }
    }
}

impl QueryBatchSink for TauriQueryBatchSink {
    fn emit_batch(&self, batch: QueryBatch) -> Result<(), DbError> {
        self.app
            .emit("query_batch", batch)
            .map_err(|e| DbError::Other(e.to_string()))
    }
}
