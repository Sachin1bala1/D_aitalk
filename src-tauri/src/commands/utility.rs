use tauri::State;
use super::AppState;

#[tauri::command]
pub async fn clear_query_cache(
    connection_id: Option<String>,
    state: State<'_, AppState>,
) -> Result<(), String> {
    state.query_cache.clear(connection_id.as_deref());
    Ok(())
}

#[tauri::command]
pub async fn health_check() -> Result<serde_json::Value, String> {
    Ok(serde_json::json!({
        "status": "ok",
        "version": env!("CARGO_PKG_VERSION"),
    }))
}

use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

/// Parse and verify a license key of the form `DATAIQ-{TIER}-{expiry_days}-{hmac_hex}`.
/// Returns `(tier_lower, expired)` on success, or `None` if the key is structurally
/// invalid or the HMAC does not match.
fn validate_license_key(key: &str) -> Option<(String, bool)> {
    let secret = std::env::var("DATAIQ_LICENSE_SECRET")
        .unwrap_or_else(|_| "dataiq-dev-secret-2026".to_string());

    let parts: Vec<&str> = key.trim().split('-').collect();
    if parts.len() != 4 || parts[0] != "DATAIQ" {
        return None;
    }

    let tier = parts[1]; // "PRO" or "ENT"
    if tier != "PRO" && tier != "ENT" {
        return None;
    }
    let expiry_str = parts[2];
    let provided_hmac = parts[3];

    // Verify HMAC-SHA256 over "TIER-expiry_days"
    let message = format!("{}-{}", tier, expiry_str);
    let mut mac = HmacSha256::new_from_slice(secret.as_bytes())
        .expect("HMAC can take any key size");
    mac.update(message.as_bytes());
    let computed = hex::encode(mac.finalize().into_bytes());

    if computed != provided_hmac {
        return None;
    }

    // Check expiry (days since Unix epoch)
    let expiry_days: u64 = expiry_str.parse().unwrap_or(0);
    let now_days = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
        / 86400;

    let expired = now_days > expiry_days;
    let tier_lower = tier.to_lowercase();
    Some((tier_lower, expired))
}

#[tauri::command]
pub fn activate_license(key: String) -> Result<String, String> {
    match validate_license_key(key.trim()) {
        Some((_tier, true)) => Err("License key has expired".to_string()),
        Some((tier, false)) => {
            let entry =
                keyring::Entry::new("daitalk", "license_key").map_err(|e| e.to_string())?;
            entry
                .set_password(key.trim())
                .map_err(|e| e.to_string())?;
            Ok(tier)
        }
        None => Err("Invalid license key".to_string()),
    }
}

#[tauri::command]
pub fn check_license() -> Result<serde_json::Value, String> {
    let entry = keyring::Entry::new("daitalk", "license_key").map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(stored_key) => match validate_license_key(&stored_key) {
            Some((tier, false)) => Ok(serde_json::json!({ "tier": tier, "valid": true })),
            Some((_tier, true)) => {
                Ok(serde_json::json!({ "tier": "free", "valid": false, "expired": true }))
            }
            None => Ok(serde_json::json!({ "tier": "free", "valid": false })),
        },
        Err(keyring::Error::NoEntry) => Ok(serde_json::json!({ "tier": "free", "valid": false })),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
pub fn remove_license() -> Result<(), String> {
    let entry = keyring::Entry::new("daitalk", "license_key").map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}
