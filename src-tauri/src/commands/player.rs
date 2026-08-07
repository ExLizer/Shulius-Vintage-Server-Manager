use serde::Serialize;
use serde_json::{Map, Value};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize)]
pub struct LocalPlayerInfo {
    pub uid: Option<String>,
    pub name: Option<String>,
    pub source_path: String,
}

fn read_string_setting(value: &Value, key: &str) -> Option<String> {
    let direct = value.get(key).and_then(|v| v.as_str());
    if let Some(s) = direct {
        return Some(s.to_string());
    }
    value
        .get("stringSettings")
        .and_then(|v| v.get(key))
        .and_then(|v| v.as_str())
        .map(|s| s.to_string())
}

fn candidate_paths(data_path: &str) -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if !data_path.is_empty() {
        paths.push(Path::new(data_path).join("clientsettings.json"));
    }
    if let Some(appdata) = dirs::data_dir() {
        paths.push(appdata.join("VintagestoryData").join("clientsettings.json"));
    }
    paths
}

fn b64url_encode(bytes: &[u8]) -> String {
    const CHARS: &[u8] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
    let mut out = String::with_capacity((bytes.len() * 4 + 2) / 3);
    let mut i = 0;
    while i < bytes.len() {
        let b0 = bytes[i] as u32;
        let b1 = if i + 1 < bytes.len() { bytes[i + 1] as u32 } else { 0 };
        let b2 = if i + 2 < bytes.len() { bytes[i + 2] as u32 } else { 0 };
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(CHARS[((n >> 18) & 0x3f) as usize] as char);
        out.push(CHARS[((n >> 12) & 0x3f) as usize] as char);
        if i + 1 < bytes.len() {
            out.push(CHARS[((n >> 6) & 0x3f) as usize] as char);
        }
        if i + 2 < bytes.len() {
            out.push(CHARS[(n & 0x3f) as usize] as char);
        }
        i += 3;
    }
    out
}

fn resolve_clientsettings_path(data_path: &str) -> Option<PathBuf> {
    if !data_path.is_empty() {
        let candidate = Path::new(data_path).join("clientsettings.json");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    if let Some(appdata) = dirs::data_dir() {
        let candidate = appdata.join("VintagestoryData").join("clientsettings.json");
        if candidate.exists() {
            return Some(candidate);
        }
    }
    None
}

#[tauri::command]
pub fn generate_random_uid() -> String {
    let uuid = uuid::Uuid::new_v4();
    b64url_encode(uuid.as_bytes())
}

#[tauri::command]
pub fn set_local_player_uid(data_path: String, uid: String) -> Result<LocalPlayerInfo, String> {
    let trimmed = uid.trim().to_string();
    if trimmed.is_empty() {
        return Err("UID cannot be empty".to_string());
    }

    let path = resolve_clientsettings_path(&data_path)
        .ok_or_else(|| "clientsettings.json not found".to_string())?;

    let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut json: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    let bak_path = path.with_extension("json.bak");
    fs::write(&bak_path, &content).map_err(|e| e.to_string())?;

    let obj = json
        .as_object_mut()
        .ok_or_else(|| "clientsettings.json is not a JSON object".to_string())?;

    let string_settings = obj
        .entry("stringSettings".to_string())
        .or_insert_with(|| Value::Object(Map::new()));
    let string_settings_obj = string_settings
        .as_object_mut()
        .ok_or_else(|| "stringSettings is not an object".to_string())?;
    string_settings_obj.insert("playeruid".to_string(), Value::String(trimmed.clone()));

    let new_content = serde_json::to_string_pretty(&json).map_err(|e| e.to_string())?;
    fs::write(&path, new_content).map_err(|e| e.to_string())?;

    Ok(LocalPlayerInfo {
        uid: Some(trimmed),
        name: read_string_setting(&json, "playername"),
        source_path: path.to_string_lossy().to_string(),
    })
}

#[tauri::command]
pub fn get_local_player_info(data_path: String) -> Result<LocalPlayerInfo, String> {
    let mut last_path = String::new();
    for path in candidate_paths(&data_path) {
        last_path = path.to_string_lossy().to_string();
        if !path.exists() {
            continue;
        }
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        let json: Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;
        return Ok(LocalPlayerInfo {
            uid: read_string_setting(&json, "playeruid"),
            name: read_string_setting(&json, "playername"),
            source_path: last_path,
        });
    }
    Ok(LocalPlayerInfo {
        uid: None,
        name: None,
        source_path: last_path,
    })
}
