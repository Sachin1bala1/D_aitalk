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

const LICENSE_SECRET: &str = "dataiq-mvp-secret-2026";

fn validate_license_key(key: &str) -> Option<String> {
    let parts: Vec<&str> = key.splitn(2, '-').collect();
    if parts.len() != 2 {
        return None;
    }
    let tier = parts[0].to_uppercase();
    if tier != "PRO" && tier != "ENT" {
        return None;
    }
    let expected_hmac = compute_license_hmac(&tier);
    if parts[1].to_uppercase() == expected_hmac {
        Some(tier)
    } else {
        None
    }
}

fn compute_license_hmac(tier: &str) -> String {
    let mut mac = HmacSha256::new_from_slice(LICENSE_SECRET.as_bytes())
        .expect("HMAC can take key of any size");
    mac.update(tier.as_bytes());
    let result = mac.finalize();
    let bytes = result.into_bytes();
    hex::encode(&bytes[..8]).to_uppercase()
}

#[tauri::command]
pub fn activate_license(key: String) -> Result<String, String> {
    let trimmed = key.trim().to_uppercase();
    match validate_license_key(&trimmed) {
        Some(tier) => {
            let entry =
                keyring::Entry::new("daitalk", "license_key").map_err(|e| e.to_string())?;
            entry.set_password(&trimmed).map_err(|e| e.to_string())?;
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
            Some(tier) => {
                let display = if tier == "ENT" { "enterprise" } else { "pro" };
                Ok(serde_json::json!({ "tier": display, "valid": true }))
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
