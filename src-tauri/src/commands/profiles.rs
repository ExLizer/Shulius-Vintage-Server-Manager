use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, Manager};
use zip::ZipArchive;

// Anti zip-slip: solo acepta nombres relativos compuestos de segmentos normales.
// Rechaza paths absolutos, prefijos de Windows (C:\), root dir, y cualquier
// componente `..` que permita escapar del directorio base.
fn safe_join(base: &Path, name: &str) -> Result<PathBuf, String> {
    if name.is_empty() {
        return Err("empty zip entry name".to_string());
    }
    let candidate = Path::new(name);
    for component in candidate.components() {
        match component {
            Component::Normal(_) | Component::CurDir => {}
            _ => {
                return Err(format!("unsafe zip entry name: {}", name));
            }
        }
    }
    Ok(base.join(candidate))
}

// ============== TYPES ==============

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct GroupSaveEntry {
    /// world_id from public.worlds
    pub world_id: String,
    /// World's display name at the moment of registration (may go stale if renamed)
    pub world_name: String,
    /// Filename inside <data_path>/Saves, e.g. "MainWorld.vcdbs"
    pub filename: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ServerProfile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub data_path: String,
    pub created_at: String,
    pub imported_at: Option<String>,
    pub is_default: bool,
    /// If set, this profile is linked to a group world.
    /// Start Server uses the group flow (acquire lock, download, etc.).
    #[serde(default)]
    pub linked_group_world_id: Option<String>,
    /// Tracks which .vcdbs files in this profile came from group worlds.
    /// Used by SavesView to classify and by activation to decide if the
    /// profile should enter group mode.
    #[serde(default)]
    pub group_saves: Vec<GroupSaveEntry>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerProfileExportMetadata {
    pub format_version: u32,
    pub name: String,
    pub description: String,
    pub created_at: String,
    pub exported_at: String,
    pub mods_count: usize,
    pub saves_count: usize,
    pub has_server_config: bool,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ServerProfilesData {
    pub profiles: Vec<ServerProfile>,
}

#[derive(Debug, Serialize)]
pub struct ProfileImportResult {
    pub profile: ServerProfile,
    pub mods_imported: usize,
    pub saves_imported: usize,
}

// ============== HELPER FUNCTIONS ==============

fn get_profiles_file_path(app: &AppHandle) -> std::path::PathBuf {
    let app_data = app.path().app_data_dir().unwrap_or_else(|_| std::path::PathBuf::from("."));
    fs::create_dir_all(&app_data).ok();
    app_data.join("server_profiles.json")
}

fn load_profiles_data(app: &AppHandle) -> ServerProfilesData {
    let path = get_profiles_file_path(app);

    if path.exists() {
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(data) = serde_json::from_str(&content) {
                return data;
            }
        }
    }

    ServerProfilesData { profiles: Vec::new() }
}

fn save_profiles_data(app: &AppHandle, data: &ServerProfilesData) -> Result<(), String> {
    let path = get_profiles_file_path(app);
    let json = serde_json::to_string_pretty(data)
        .map_err(|e| format!("Failed to serialize profiles: {}", e))?;
    fs::write(&path, json)
        .map_err(|e| format!("Failed to write profiles file: {}", e))?;
    Ok(())
}

fn sanitize_folder_name(name: &str) -> String {
    name.chars()
        .map(|c| {
            if c.is_alphanumeric() || c == '-' || c == '_' || c == ' ' {
                c
            } else {
                '_'
            }
        })
        .collect::<String>()
        .trim()
        .to_string()
}

fn copy_dir_all(src: &Path, dst: &Path) -> Result<(), String> {
    fs::create_dir_all(dst).map_err(|e| e.to_string())?;

    for entry in fs::read_dir(src).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let ty = entry.file_type().map_err(|e| e.to_string())?;

        if ty.is_dir() {
            copy_dir_all(&entry.path(), &dst.join(entry.file_name()))?;
        } else {
            fs::copy(entry.path(), dst.join(entry.file_name())).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

fn add_folder_to_zip<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    folder_path: &Path,
    base_name: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    for entry in fs::read_dir(folder_path).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = format!("{}/{}", base_name, entry.file_name().to_string_lossy());

        if path.is_dir() {
            add_folder_to_zip(zip, &path, &name, options)?;
        } else {
            let mut file = File::open(&path).map_err(|e| e.to_string())?;
            zip.start_file(&name, options).map_err(|e| e.to_string())?;

            let mut buffer = Vec::new();
            file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
            zip.write_all(&buffer).map_err(|e| e.to_string())?;
        }
    }

    Ok(())
}

// ============== COMMANDS ==============

#[tauri::command]
pub fn get_profiles_base_path() -> Result<String, String> {
    let appdata = dirs::data_dir().unwrap_or_else(|| std::path::PathBuf::from("."));
    let profiles_path = appdata.join("VintagestoryData").join("Profiles");
    Ok(profiles_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn list_server_profiles(app: AppHandle) -> Result<Vec<ServerProfile>, String> {
    let data = load_profiles_data(&app);
    Ok(data.profiles)
}

#[tauri::command]
pub fn ensure_default_profile(app: AppHandle, current_data_path: String) -> Result<ServerProfile, String> {
    let mut data = load_profiles_data(&app);

    // Check if default profile already exists
    if let Some(default_profile) = data.profiles.iter().find(|p| p.is_default) {
        return Ok(default_profile.clone());
    }

    // Create default profile
    let default_profile = ServerProfile {
        id: "default".to_string(),
        name: "Principal".to_string(),
        description: "Servidor principal".to_string(),
        data_path: current_data_path,
        created_at: chrono::Local::now().to_rfc3339(),
        imported_at: None,
        is_default: true,
        linked_group_world_id: None,
        group_saves: Vec::new(),
    };

    data.profiles.insert(0, default_profile.clone());
    save_profiles_data(&app, &data)?;

    Ok(default_profile)
}

#[tauri::command]
pub fn create_server_profile(
    app: AppHandle,
    name: String,
    description: String,
) -> Result<ServerProfile, String> {
    // Create folder in Profiles directory
    let profiles_base = get_profiles_base_path()?;
    let profiles_base_path = Path::new(&profiles_base);

    fs::create_dir_all(profiles_base_path)
        .map_err(|e| format!("Failed to create profiles directory: {}", e))?;

    // Find unique folder name
    let folder_name = sanitize_folder_name(&name);
    let mut profile_folder = profiles_base_path.join(&folder_name);
    let mut counter = 1;
    while profile_folder.exists() {
        profile_folder = profiles_base_path.join(format!("{}_{}", folder_name, counter));
        counter += 1;
    }

    // Create the profile folder structure
    fs::create_dir_all(&profile_folder)
        .map_err(|e| format!("Failed to create profile folder: {}", e))?;
    fs::create_dir_all(profile_folder.join("Mods"))
        .map_err(|e| format!("Failed to create Mods folder: {}", e))?;
    fs::create_dir_all(profile_folder.join("Saves"))
        .map_err(|e| format!("Failed to create Saves folder: {}", e))?;

    // Create profile record
    let profile = ServerProfile {
        id: uuid::Uuid::new_v4().to_string(),
        name,
        description,
        data_path: profile_folder.to_string_lossy().to_string(),
        created_at: chrono::Local::now().to_rfc3339(),
        imported_at: None,
        is_default: false,
        linked_group_world_id: None,
        group_saves: Vec::new(),
    };

    // Save to profiles list
    let mut data = load_profiles_data(&app);
    data.profiles.push(profile.clone());
    save_profiles_data(&app, &data)?;

    Ok(profile)
}

#[tauri::command]
pub fn set_active_profile(app: AppHandle, profile_id: String) -> Result<ServerProfile, String> {
    let data = load_profiles_data(&app);

    data.profiles
        .iter()
        .find(|p| p.id == profile_id)
        .cloned()
        .ok_or_else(|| "Profile not found".to_string())
}

#[tauri::command]
pub fn update_server_profile(
    app: AppHandle,
    profile_id: String,
    name: String,
    description: String,
) -> Result<ServerProfile, String> {
    let mut data = load_profiles_data(&app);

    let profile = data.profiles
        .iter_mut()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| "Profile not found".to_string())?;

    profile.name = name;
    profile.description = description;

    let updated_profile = profile.clone();
    save_profiles_data(&app, &data)?;

    Ok(updated_profile)
}

#[tauri::command]
pub fn link_profile_to_world(
    app: AppHandle,
    profile_id: String,
    world_id: Option<String>,
) -> Result<ServerProfile, String> {
    let mut data = load_profiles_data(&app);

    let profile = data
        .profiles
        .iter_mut()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| "Profile not found".to_string())?;

    profile.linked_group_world_id = world_id;

    let updated_profile = profile.clone();
    save_profiles_data(&app, &data)?;

    Ok(updated_profile)
}

/// Idempotent: registers (or replaces by filename) a group save in the profile.
/// Use after a successful download from cloud.
#[tauri::command]
pub fn register_group_save(
    app: AppHandle,
    profile_id: String,
    entry: GroupSaveEntry,
) -> Result<ServerProfile, String> {
    let mut data = load_profiles_data(&app);

    let profile = data
        .profiles
        .iter_mut()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| "Profile not found".to_string())?;

    // Replace by filename if exists, else append
    if let Some(existing) = profile
        .group_saves
        .iter_mut()
        .find(|e| e.filename == entry.filename)
    {
        *existing = entry;
    } else {
        profile.group_saves.push(entry);
    }

    let updated_profile = profile.clone();
    save_profiles_data(&app, &data)?;

    Ok(updated_profile)
}

/// Removes a group save entry by filename. Used when user deletes a save.
#[tauri::command]
pub fn unregister_group_save(
    app: AppHandle,
    profile_id: String,
    filename: String,
) -> Result<ServerProfile, String> {
    let mut data = load_profiles_data(&app);

    let profile = data
        .profiles
        .iter_mut()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| "Profile not found".to_string())?;

    profile.group_saves.retain(|e| e.filename != filename);

    let updated_profile = profile.clone();
    save_profiles_data(&app, &data)?;

    Ok(updated_profile)
}

#[tauri::command]
pub fn delete_server_profile(app: AppHandle, profile_id: String) -> Result<(), String> {
    let mut data = load_profiles_data(&app);

    // Find the profile
    let profile = data.profiles
        .iter()
        .find(|p| p.id == profile_id)
        .ok_or_else(|| "Profile not found".to_string())?;

    // Cannot delete default profile
    if profile.is_default {
        return Err("Cannot delete the default profile".to_string());
    }

    // Delete the profile's data folder
    let data_path = Path::new(&profile.data_path);
    if data_path.exists() {
        fs::remove_dir_all(data_path)
            .map_err(|e| format!("Failed to delete profile folder: {}", e))?;
    }

    // Remove from profiles list
    data.profiles.retain(|p| p.id != profile_id);
    save_profiles_data(&app, &data)?;

    Ok(())
}

#[tauri::command]
pub fn export_server_profile(
    data_path: String,
    output_path: String,
    profile_name: String,
    description: String,
) -> Result<String, String> {
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    let data_dir = Path::new(&data_path);
    if !data_dir.exists() {
        return Err("Data directory does not exist".to_string());
    }

    let mods_dir = data_dir.join("Mods");
    let saves_dir = data_dir.join("Saves");
    let server_config_path = data_dir.join("serverconfig.json");

    // Count mods and saves
    let mods_count = if mods_dir.exists() {
        fs::read_dir(&mods_dir)
            .map(|entries| entries.filter_map(|e| e.ok()).count())
            .unwrap_or(0)
    } else {
        0
    };

    let saves_count = if saves_dir.exists() {
        fs::read_dir(&saves_dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        e.path()
                            .extension()
                            .map_or(false, |ext| ext == "vcdbs")
                    })
                    .count()
            })
            .unwrap_or(0)
    } else {
        0
    };

    let has_server_config = server_config_path.exists();

    // Create the output file
    let output_file = File::create(&output_path)
        .map_err(|e| format!("Failed to create profile file: {}", e))?;

    let mut zip = ZipWriter::new(output_file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Add Mods folder
    if mods_dir.exists() {
        for entry in fs::read_dir(&mods_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();

            if path.is_dir() {
                add_folder_to_zip(&mut zip, &path, &format!("Mods/{}", file_name), options)?;
            } else {
                let mut file = File::open(&path).map_err(|e| e.to_string())?;
                zip.start_file(format!("Mods/{}", file_name), options)
                    .map_err(|e| e.to_string())?;

                let mut buffer = Vec::new();
                file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
                zip.write_all(&buffer).map_err(|e| e.to_string())?;
            }
        }
    }

    // Add Saves folder (only .vcdbs files)
    if saves_dir.exists() {
        for entry in fs::read_dir(&saves_dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let file_name = entry.file_name().to_string_lossy().to_string();

            // Only include .vcdbs files
            if path.is_file() && path.extension().map_or(false, |ext| ext == "vcdbs") {
                let mut file = File::open(&path).map_err(|e| e.to_string())?;
                zip.start_file(format!("Saves/{}", file_name), options)
                    .map_err(|e| e.to_string())?;

                let mut buffer = Vec::new();
                file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
                zip.write_all(&buffer).map_err(|e| e.to_string())?;
            }
        }
    }

    // Add serverconfig.json
    if has_server_config {
        let mut file = File::open(&server_config_path).map_err(|e| e.to_string())?;
        zip.start_file("serverconfig.json", options)
            .map_err(|e| e.to_string())?;

        let mut buffer = Vec::new();
        file.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
        zip.write_all(&buffer).map_err(|e| e.to_string())?;
    }

    // Create and add profile.json metadata
    let metadata = ServerProfileExportMetadata {
        format_version: 1,
        name: profile_name,
        description,
        created_at: chrono::Local::now().to_rfc3339(),
        exported_at: chrono::Local::now().to_rfc3339(),
        mods_count,
        saves_count,
        has_server_config,
    };

    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;

    zip.start_file("profile.json", options)
        .map_err(|e| e.to_string())?;
    zip.write_all(metadata_json.as_bytes())
        .map_err(|e| e.to_string())?;

    zip.finish()
        .map_err(|e| format!("Failed to finalize zip: {}", e))?;

    Ok(output_path)
}

#[tauri::command]
pub fn import_server_profile(
    app: AppHandle,
    zip_path: String,
    custom_name: Option<String>,
) -> Result<ProfileImportResult, String> {
    let zip_file = File::open(&zip_path)
        .map_err(|e| format!("Failed to open profile zip: {}", e))?;

    let mut archive = ZipArchive::new(zip_file)
        .map_err(|e| format!("Failed to read profile zip: {}", e))?;

    // Read profile.json metadata
    let metadata: Option<ServerProfileExportMetadata> = {
        let mut metadata_content = None;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            if entry.name() == "profile.json" {
                let mut contents = String::new();
                entry.read_to_string(&mut contents).ok();
                metadata_content = Some(contents);
                break;
            }
        }
        metadata_content.and_then(|c| serde_json::from_str(&c).ok())
    };

    // Determine profile name
    let profile_name = custom_name.unwrap_or_else(|| {
        metadata
            .as_ref()
            .map(|m| m.name.clone())
            .unwrap_or_else(|| {
                Path::new(&zip_path)
                    .file_stem()
                    .map(|s| s.to_string_lossy().to_string())
                    .unwrap_or_else(|| "Imported Profile".to_string())
            })
    });

    // Create unique folder name
    let folder_name = sanitize_folder_name(&profile_name);
    let profiles_base = get_profiles_base_path()?;
    let profiles_base_path = Path::new(&profiles_base);

    fs::create_dir_all(profiles_base_path)
        .map_err(|e| format!("Failed to create profiles directory: {}", e))?;

    // Find unique folder name
    let mut profile_folder = profiles_base_path.join(&folder_name);
    let mut counter = 1;
    while profile_folder.exists() {
        profile_folder = profiles_base_path.join(format!("{}_{}", folder_name, counter));
        counter += 1;
    }

    fs::create_dir_all(&profile_folder)
        .map_err(|e| format!("Failed to create profile folder: {}", e))?;

    let mut mods_imported = 0;
    let mut saves_imported = 0;

    // Extract all files
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();

        // Skip profile.json (metadata only)
        if name == "profile.json" {
            continue;
        }

        let dest_path = safe_join(&profile_folder, &name)?;

        if entry.is_dir() {
            fs::create_dir_all(&dest_path).ok();
        } else {
            // Ensure parent directory exists
            if let Some(parent) = dest_path.parent() {
                fs::create_dir_all(parent).ok();
            }

            let mut outfile = File::create(&dest_path)
                .map_err(|e| format!("Failed to create file {}: {}", name, e))?;

            std::io::copy(&mut entry, &mut outfile)
                .map_err(|e| format!("Failed to extract {}: {}", name, e))?;

            // Count mods and saves
            if name.starts_with("Mods/") && !name.ends_with('/') {
                // Only count top-level items in Mods
                let parts: Vec<&str> = name.split('/').collect();
                if parts.len() == 2 {
                    mods_imported += 1;
                }
            } else if name.starts_with("Saves/") && name.ends_with(".vcdbs") {
                saves_imported += 1;
            }
        }
    }

    // Create profile record
    let profile = ServerProfile {
        id: uuid::Uuid::new_v4().to_string(),
        name: profile_name,
        description: metadata
            .as_ref()
            .map(|m| m.description.clone())
            .unwrap_or_default(),
        data_path: profile_folder.to_string_lossy().to_string(),
        created_at: metadata
            .as_ref()
            .map(|m| m.created_at.clone())
            .unwrap_or_else(|| chrono::Local::now().to_rfc3339()),
        imported_at: Some(chrono::Local::now().to_rfc3339()),
        is_default: false,
        linked_group_world_id: None,
        group_saves: Vec::new(),
    };

    // Save profile to profiles list
    let mut data = load_profiles_data(&app);
    data.profiles.push(profile.clone());
    save_profiles_data(&app, &data)?;

    Ok(ProfileImportResult {
        profile,
        mods_imported,
        saves_imported,
    })
}

#[tauri::command]
pub fn get_profile_export_preview(data_path: String) -> Result<ServerProfileExportMetadata, String> {
    let data_dir = Path::new(&data_path);
    if !data_dir.exists() {
        return Err("Data directory does not exist".to_string());
    }

    let mods_dir = data_dir.join("Mods");
    let saves_dir = data_dir.join("Saves");
    let server_config_path = data_dir.join("serverconfig.json");

    let mods_count = if mods_dir.exists() {
        fs::read_dir(&mods_dir)
            .map(|entries| entries.filter_map(|e| e.ok()).count())
            .unwrap_or(0)
    } else {
        0
    };

    let saves_count = if saves_dir.exists() {
        fs::read_dir(&saves_dir)
            .map(|entries| {
                entries
                    .filter_map(|e| e.ok())
                    .filter(|e| {
                        e.path()
                            .extension()
                            .map_or(false, |ext| ext == "vcdbs")
                    })
                    .count()
            })
            .unwrap_or(0)
    } else {
        0
    };

    Ok(ServerProfileExportMetadata {
        format_version: 1,
        name: String::new(),
        description: String::new(),
        created_at: String::new(),
        exported_at: String::new(),
        mods_count,
        saves_count,
        has_server_config: server_config_path.exists(),
    })
}
