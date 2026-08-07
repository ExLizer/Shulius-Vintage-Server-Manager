use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Settings {
    pub server_exe_path: String,
    pub data_path: String,
    pub port: u16,
    pub backup_dir: String,
    pub keep_backups: u32,
    pub singleplayer_saves_path: String,
    #[serde(default)]
    pub active_profile_id: Option<String>,
    #[serde(default = "default_language")]
    pub language: String,
    // Manager-side scheduled tasks. 0 means disabled.
    #[serde(default = "default_autosave_minutes")]
    pub autosave_interval_minutes: u32,
    #[serde(default)]
    pub autobackup_interval_minutes: u32,
}

fn default_language() -> String {
    "es".to_string()
}

fn default_autosave_minutes() -> u32 {
    5
}

impl Default for Settings {
    fn default() -> Self {
        let appdata = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
        let vs_data = appdata.join("VintagestoryData");

        Settings {
            server_exe_path: String::new(),
            data_path: vs_data.to_string_lossy().to_string(),
            port: 42420,
            backup_dir: vs_data.join("BackupsTool").to_string_lossy().to_string(),
            keep_backups: 20,
            singleplayer_saves_path: vs_data.join("Saves").to_string_lossy().to_string(),
            active_profile_id: None,
            language: default_language(),
            autosave_interval_minutes: default_autosave_minutes(),
            autobackup_interval_minutes: 0,
        }
    }
}

#[derive(Debug, Serialize)]
pub struct DefaultPaths {
    pub vs_data_path: String,
    pub saves_path: String,
    pub suggested_server_exe: String,
}

fn get_settings_path(app: &AppHandle) -> PathBuf {
    let app_data = app.path().app_data_dir().unwrap_or_else(|_| PathBuf::from("."));
    fs::create_dir_all(&app_data).ok();
    app_data.join("settings.json")
}

#[tauri::command]
pub fn load_settings(app: AppHandle) -> Result<Settings, String> {
    let path = get_settings_path(&app);

    if path.exists() {
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        serde_json::from_str(&content).map_err(|e| e.to_string())
    } else {
        Ok(Settings::default())
    }
}

#[tauri::command]
pub fn save_settings(app: AppHandle, settings: Settings) -> Result<(), String> {
    let path = get_settings_path(&app);
    let content = serde_json::to_string_pretty(&settings).map_err(|e| e.to_string())?;
    fs::write(path, content).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn get_default_paths() -> DefaultPaths {
    let appdata = dirs::data_dir().unwrap_or_else(|| PathBuf::from("."));
    let vs_data = appdata.join("VintagestoryData");
    let roaming = dirs::config_dir().unwrap_or_else(|| PathBuf::from("."));

    DefaultPaths {
        vs_data_path: vs_data.to_string_lossy().to_string(),
        saves_path: vs_data.join("Saves").to_string_lossy().to_string(),
        suggested_server_exe: roaming.join("Vintagestory").join("VintagestoryServer.exe").to_string_lossy().to_string(),
    }
}
