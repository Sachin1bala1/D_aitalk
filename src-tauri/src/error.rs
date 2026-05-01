use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("SQL error: {0}")]
    Sqlx(#[from] sqlx::Error),

    #[error("Connection not found: {0}")]
    ConnectionNotFound(String),

    #[error("Unsupported driver: {0}")]
    UnsupportedDriver(String),

    #[error("Schema introspection failed: {0}")]
    IntrospectionFailed(String),

    #[error("Serialization error: {0}")]
    Serialization(#[from] serde_json::Error),

    #[error("{0}")]
    Other(String),
}

// Tauri commands must return String errors
impl From<DbError> for String {
    fn from(e: DbError) -> Self {
        e.to_string()
    }
}
