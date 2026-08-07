use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::Path;

#[derive(Debug, Serialize)]
pub struct SaveInfo {
    pub name: String,
    pub full_path: String,
    pub size_bytes: u64,
    pub modified_at: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerConfig {
    #[serde(rename = "WorldConfig")]
    pub world_config: Option<WorldConfig>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct WorldConfig {
    #[serde(rename = "SaveFileLocation")]
    pub save_file_location: Option<String>,
}

// This struct uses snake_case for Tauri/JS communication
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct FullServerConfig {
    #[serde(default)]
    pub server_name: String,
    #[serde(default)]
    pub server_description: String,
    #[serde(default)]
    pub welcome_message: String,
    #[serde(default)]
    pub password: String,
    #[serde(default = "default_max_clients")]
    pub max_clients: u32,
    #[serde(default = "default_true")]
    pub authenticate: bool,
    #[serde(default)]
    pub only_whitelisted: bool,
    #[serde(default = "default_true")]
    pub pvp: bool,
    #[serde(default)]
    pub whitelisted_players: Vec<String>,
    #[serde(default)]
    pub color_accurate_worldmap: bool,
}

fn default_max_clients() -> u32 {
    16
}

fn default_true() -> bool {
    true
}

#[tauri::command]
pub fn list_saves(path: String) -> Result<Vec<SaveInfo>, String> {
    let dir = Path::new(&path);

    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut saves = Vec::new();

    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().map_or(false, |ext| ext == "vcdbs") {
            if let Ok(metadata) = fs::metadata(&path) {
                let modified: DateTime<Utc> = metadata
                    .modified()
                    .map(|t| t.into())
                    .unwrap_or_else(|_| Utc::now());

                saves.push(SaveInfo {
                    name: path
                        .file_stem()
                        .map(|s| s.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    full_path: path.to_string_lossy().to_string(),
                    size_bytes: metadata.len(),
                    modified_at: modified.format("%Y-%m-%d %H:%M:%S").to_string(),
                });
            }
        }
    }

    // Sort by modified date, newest first
    saves.sort_by(|a, b| b.modified_at.cmp(&a.modified_at));

    Ok(saves)
}

#[tauri::command]
pub fn backup_save(
    src_path: String,
    backup_dir: String,
    keep_backups: Option<u32>,
) -> Result<String, String> {
    let src = Path::new(&src_path);
    let backup_dir_path = Path::new(&backup_dir);

    if !src.exists() {
        return Err("Source file does not exist".to_string());
    }

    fs::create_dir_all(backup_dir_path).map_err(|e| e.to_string())?;

    let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
    let filename = src
        .file_stem()
        .map(|s| s.to_string_lossy().to_string())
        .unwrap_or_else(|| "backup".to_string());
    let backup_name = format!("{}_{}.vcdbs", filename, timestamp);
    let backup_path = backup_dir_path.join(&backup_name);

    fs::copy(src, &backup_path).map_err(|e| format!("Failed to create backup: {}", e))?;

    // Retention: borrar los mas viejos del mismo save base, mantener `keep`.
    // Pasamos None = sin prune (compatibilidad con callers viejos). Cuando el
    // setting llega como 0 lo tratamos como "deshabilitado" para evitar
    // borrar todo accidentalmente.
    if let Some(keep) = keep_backups {
        if keep > 0 {
            let _ = crate::commands::backups::prune_old_backups(
                backup_dir.clone(),
                filename.clone(),
                "save".to_string(),
                keep as usize,
            );
        }
    }

    Ok(backup_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn copy_save(
    src_path: String,
    dst_path: String,
    create_backup: bool,
    backup_dir: String,
    keep_backups: Option<u32>,
) -> Result<(), String> {
    let src = Path::new(&src_path);
    let dst = Path::new(&dst_path);

    if !src.exists() {
        return Err("Source file does not exist".to_string());
    }

    if dst.exists() && create_backup {
        backup_save(dst_path.clone(), backup_dir, keep_backups)?;
    }

    if let Some(parent) = dst.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    fs::copy(src, dst).map_err(|e| format!("Failed to copy save: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn delete_save(
    path: String,
    backup_dir: String,
    create_backup: bool,
    keep_backups: Option<u32>,
) -> Result<(), String> {
    let file = Path::new(&path);

    if !file.exists() {
        return Err("File does not exist".to_string());
    }

    if create_backup {
        backup_save(path.clone(), backup_dir, keep_backups)?;
    }

    fs::remove_file(file).map_err(|e| format!("Failed to delete save: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn set_active_world(config_path: String, save_file_location: String) -> Result<(), String> {
    let config_file = Path::new(&config_path);

    // Read existing config or create default
    let mut config: serde_json::Value = if config_file.exists() {
        let content = fs::read_to_string(config_file).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())?
    } else {
        serde_json::json!({})
    };

    // Update WorldConfig.SaveFileLocation
    if config.get("WorldConfig").is_none() {
        config["WorldConfig"] = serde_json::json!({});
    }

    // Use forward slashes for the path in JSON (Windows accepts both)
    let normalized_path = save_file_location.replace('\\', "/");
    config["WorldConfig"]["SaveFileLocation"] = serde_json::Value::String(normalized_path);

    // Write back to file
    let content = serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?;
    fs::write(config_file, content).map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn read_server_config(config_path: String) -> Result<Option<String>, String> {
    let config_file = Path::new(&config_path);

    if !config_file.exists() {
        return Ok(None);
    }

    let content = fs::read_to_string(config_file).map_err(|e| e.to_string())?;
    let config: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    Ok(config
        .get("WorldConfig")
        .and_then(|wc| wc.get("SaveFileLocation"))
        .and_then(|sl| sl.as_str())
        .map(|s| s.to_string()))
}

#[tauri::command]
pub fn read_full_server_config(config_path: String) -> Result<FullServerConfig, String> {
    let config_file = Path::new(&config_path);

    if !config_file.exists() {
        return Ok(FullServerConfig::default());
    }

    let content = fs::read_to_string(config_file).map_err(|e| e.to_string())?;
    let json: serde_json::Value = serde_json::from_str(&content).map_err(|e| e.to_string())?;

    // Manually map from PascalCase JSON to snake_case struct
    Ok(FullServerConfig {
        server_name: json.get("ServerName")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        server_description: json.get("ServerDescription")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        welcome_message: json.get("WelcomeMessage")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        password: json.get("Password")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string(),
        max_clients: json.get("MaxClients")
            .and_then(|v| v.as_u64())
            .unwrap_or(16) as u32,
        authenticate: json.get("VerifyPlayerAuth")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        // WhitelistMode: 1 = off, 2 = whitelist enabled
        only_whitelisted: json.get("WhitelistMode")
            .and_then(|v| v.as_u64())
            .map(|v| v == 2)
            .unwrap_or(false),
        pvp: json.get("AllowPvP")
            .and_then(|v| v.as_bool())
            .unwrap_or(true),
        // Whitelist se maneja con comandos /player, no con un array en serverconfig.json
        whitelisted_players: vec![],
        color_accurate_worldmap: json.get("WorldConfig")
            .and_then(|wc| wc.get("WorldConfiguration"))
            .and_then(|wconf| wconf.get("colorAccurateWorldmap"))
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

#[tauri::command]
pub fn save_full_server_config(config_path: String, config: FullServerConfig) -> Result<(), String> {
    let config_file = Path::new(&config_path);

    // Read existing config to preserve other fields
    let mut existing: serde_json::Value = if config_file.exists() {
        let content = fs::read_to_string(config_file).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).unwrap_or(serde_json::json!({}))
    } else {
        serde_json::json!({})
    };

    // Update only the fields we manage
    existing["ServerName"] = serde_json::Value::String(config.server_name);
    existing["ServerDescription"] = serde_json::Value::String(config.server_description);
    existing["WelcomeMessage"] = serde_json::Value::String(config.welcome_message);
    existing["Password"] = serde_json::Value::String(config.password);
    existing["MaxClients"] = serde_json::Value::Number(config.max_clients.into());
    existing["VerifyPlayerAuth"] = serde_json::Value::Bool(config.authenticate);
    // WhitelistMode: 1 = off, 2 = whitelist enabled
    existing["WhitelistMode"] = serde_json::Value::Number(if config.only_whitelisted { 2 } else { 1 }.into());
    existing["OnlyWhitelisted"] = serde_json::Value::Bool(config.only_whitelisted);
    existing["AllowPvP"] = serde_json::Value::Bool(config.pvp);

    // Remove root-level ColorAccurateWorldmap if it exists (wrong location)
    if let Some(obj) = existing.as_object_mut() {
        obj.retain(|k, _| !k.eq_ignore_ascii_case("coloraccurateworldmap"));
    }

    // Update colorAccurateWorldmap inside WorldConfig.WorldConfiguration
    if let Some(world_config) = existing.get_mut("WorldConfig") {
        if let Some(world_configuration) = world_config.get_mut("WorldConfiguration") {
            world_configuration["colorAccurateWorldmap"] = serde_json::Value::Bool(config.color_accurate_worldmap);
        }
    }

    // Ensure parent directory exists
    if let Some(parent) = config_file.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    // Write back to file
    let content = serde_json::to_string_pretty(&existing).map_err(|e| e.to_string())?;
    fs::write(config_file, content).map_err(|e| e.to_string())?;

    Ok(())
}
