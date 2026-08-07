use serde::{Deserialize, Serialize};
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
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

#[derive(Debug, Serialize, Clone)]
pub struct InstalledMod {
    pub modid: String,
    pub name: String,
    pub version: String,
    pub description: String,
    pub authors: Vec<String>,
    pub side: String,
    pub file_path: String,
    pub file_name: String,
    pub file_size: u64,
    pub is_folder: bool,
}

#[derive(Debug, Deserialize)]
struct ModInfo {
    modid: Option<String>,
    name: Option<String>,
    version: Option<String>,
    description: Option<String>,
    authors: Option<Vec<String>>,
    side: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiModSearchResult {
    pub modid: i64,
    pub name: String,
    pub summary: Option<String>,
    pub author: String,
    pub downloads: i64,
    pub side: Option<String>,
    pub logo: Option<String>,
    pub tags: Option<Vec<String>>,
    pub urlalias: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiModDetails {
    pub modid: i64,
    pub name: String,
    pub text: Option<String>,
    pub author: String,
    pub downloads: i64,
    pub side: Option<String>,
    pub logo: Option<String>,
    pub releases: Vec<ApiModRelease>,
    pub urlalias: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiModRelease {
    pub releaseid: i64,
    pub filename: String,
    pub modversion: String,
    pub tags: Vec<String>,
    pub mainfile: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiSearchResponse {
    pub mods: Vec<ApiModSearchResult>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ApiModResponse {
    #[serde(rename = "mod")]
    pub mod_data: ApiModDetails,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct GameVersion {
    pub name: String,
}

// VS server (en .NET) parsea modinfo.json case-insensitive. Los autores
// escriben con la convencion que prefieren: la mayoria usa lowercase ("modid",
// "name", "version") pero algunos (ej. Spyglass) usan PascalCase ("ModID",
// "Name", "Version"). serde_json en Rust es case-sensitive, asi que sin esto
// los mods con PascalCase caen al fallback de filename y rompen el matching
// de manifests (aparecen como "missing" + "extra" en vez de "mismatched").
//
// Estrategia: parsear primero a Value, normalizar las top-level keys a
// lowercase, y recien ahi deserializar al struct ModInfo.
fn parse_modinfo_lenient(contents: &str) -> Option<ModInfo> {
    // Quitar BOM UTF-8 si esta presente (algunos editores de Windows lo agregan
    // y serde_json no lo tolera).
    let contents = contents.trim_start_matches('\u{FEFF}');
    let value: serde_json::Value = serde_json::from_str(contents).ok()?;
    let obj = value.as_object()?;
    let mut normalized = serde_json::Map::with_capacity(obj.len());
    for (k, v) in obj {
        normalized.insert(k.to_lowercase(), v.clone());
    }
    serde_json::from_value(serde_json::Value::Object(normalized)).ok()
}

fn read_modinfo_from_zip(path: &Path) -> Option<ModInfo> {
    let file = File::open(path).ok()?;
    let mut archive = ZipArchive::new(file).ok()?;

    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).ok()?;
        let name = entry.name().to_lowercase();

        if name.ends_with("modinfo.json") {
            let mut contents = String::new();
            entry.read_to_string(&mut contents).ok()?;
            return parse_modinfo_lenient(&contents);
        }
    }
    None
}

fn read_modinfo_from_folder(path: &Path) -> Option<ModInfo> {
    let modinfo_path = path.join("modinfo.json");
    if modinfo_path.exists() {
        let contents = fs::read_to_string(modinfo_path).ok()?;
        return parse_modinfo_lenient(&contents);
    }
    None
}

#[tauri::command]
pub fn list_installed_mods(mods_path: String) -> Result<Vec<InstalledMod>, String> {
    let dir = Path::new(&mods_path);

    if !dir.exists() {
        return Ok(Vec::new());
    }

    let mut mods = Vec::new();

    let entries = fs::read_dir(dir).map_err(|e| e.to_string())?;

    for entry in entries.flatten() {
        let path = entry.path();
        let metadata = fs::metadata(&path).ok();
        let file_size = metadata.as_ref().map(|m| m.len()).unwrap_or(0);
        let file_name = path.file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        let is_folder = path.is_dir();
        let is_zip = path.extension().map_or(false, |ext| ext == "zip");

        if !is_folder && !is_zip {
            continue;
        }

        let modinfo = if is_zip {
            read_modinfo_from_zip(&path)
        } else {
            read_modinfo_from_folder(&path)
        };

        let installed_mod = if let Some(info) = modinfo {
            InstalledMod {
                modid: info.modid.unwrap_or_else(|| file_name.clone()),
                name: info.name.unwrap_or_else(|| file_name.clone()),
                version: info.version.unwrap_or_else(|| "Unknown".to_string()),
                description: info.description.unwrap_or_default(),
                authors: info.authors.unwrap_or_default(),
                side: info.side.unwrap_or_else(|| "universal".to_string()),
                file_path: path.to_string_lossy().to_string(),
                file_name: file_name.clone(),
                file_size,
                is_folder,
            }
        } else {
            InstalledMod {
                modid: file_name.clone(),
                name: file_name.clone(),
                version: "Unknown".to_string(),
                description: String::new(),
                authors: Vec::new(),
                side: "universal".to_string(),
                file_path: path.to_string_lossy().to_string(),
                file_name: file_name.clone(),
                file_size,
                is_folder,
            }
        };

        mods.push(installed_mod);
    }

    // Sort by name
    mods.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    Ok(mods)
}

#[tauri::command]
pub fn get_server_version(server_exe_path: String) -> Result<Option<String>, String> {
    let path = Path::new(&server_exe_path);

    if !path.exists() {
        return Ok(None);
    }

    // Try to find version from the parent directory name or nearby files
    // Vintage Story typically has version in the folder name like "vs_server_win-x64_v1.19.8"

    if let Some(parent) = path.parent() {
        let parent_name = parent.file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_default();

        // Look for version pattern like v1.19.8 or 1.19.8
        if let Some(version) = extract_version(&parent_name) {
            return Ok(Some(version));
        }

        // Try grandparent
        if let Some(grandparent) = parent.parent() {
            let grandparent_name = grandparent.file_name()
                .map(|s| s.to_string_lossy().to_string())
                .unwrap_or_default();

            if let Some(version) = extract_version(&grandparent_name) {
                return Ok(Some(version));
            }
        }
    }

    Ok(None)
}

fn extract_version(text: &str) -> Option<String> {
    // Look for patterns like v1.19.8, 1.19.8, v1.19, 1.19
    let re_patterns = [
        r"v?(\d+\.\d+\.\d+)",
        r"v?(\d+\.\d+)",
    ];

    for pattern in re_patterns {
        if let Ok(re) = regex_lite::Regex::new(pattern) {
            if let Some(caps) = re.captures(text) {
                if let Some(m) = caps.get(1) {
                    return Some(m.as_str().to_string());
                }
            }
        }
    }
    None
}

#[tauri::command]
pub async fn search_mods(
    query: String,
    game_version: Option<String>,
    order_by: Option<String>,
) -> Result<Vec<ApiModSearchResult>, String> {
    let mut url = "https://mods.vintagestory.at/api/mods".to_string();
    let mut params = Vec::new();

    if !query.is_empty() {
        params.push(format!("text={}", urlencoding::encode(&query)));
    }

    if let Some(version) = game_version {
        if !version.is_empty() {
            params.push(format!("gameversion={}", urlencoding::encode(&version)));
        }
    }

    let order = order_by.unwrap_or_else(|| "downloads".to_string());
    params.push(format!("orderby={}", order));

    if !params.is_empty() {
        url = format!("{}?{}", url, params.join("&"));
    }

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let data: ApiSearchResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(data.mods)
}

#[tauri::command]
pub async fn get_mod_details(mod_id: String) -> Result<ApiModDetails, String> {
    let url = format!("https://mods.vintagestory.at/api/mod/{}", mod_id);

    let response = reqwest::get(&url)
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let data: ApiModResponse = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(data.mod_data)
}

#[tauri::command]
pub async fn get_game_versions() -> Result<Vec<String>, String> {
    let url = "https://mods.vintagestory.at/api/gameversions";

    let response = reqwest::get(url)
        .await
        .map_err(|e| format!("Request failed: {}", e))?;

    let versions: Vec<String> = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    Ok(versions)
}

#[tauri::command]
pub async fn download_mod(
    download_url: String,
    filename: String,
    mods_path: String,
) -> Result<String, String> {
    let mods_dir = Path::new(&mods_path);

    // Create mods directory if it doesn't exist
    fs::create_dir_all(mods_dir).map_err(|e| format!("Failed to create mods directory: {}", e))?;

    let dest_path = safe_join(mods_dir, &filename)?;

    let response = reqwest::get(&download_url)
        .await
        .map_err(|e| format!("Download failed: {}", e))?;

    let bytes = response
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response: {}", e))?;

    let mut file = File::create(&dest_path)
        .map_err(|e| format!("Failed to create file: {}", e))?;

    file.write_all(&bytes)
        .map_err(|e| format!("Failed to write file: {}", e))?;

    Ok(dest_path.to_string_lossy().to_string())
}

#[tauri::command]
pub fn delete_mod(mod_path: String, backup_dir: String, create_backup: bool) -> Result<(), String> {
    let path = Path::new(&mod_path);

    if !path.exists() {
        return Err("Mod file/folder does not exist".to_string());
    }

    // Create backup if requested
    if create_backup {
        let backup_path = Path::new(&backup_dir);
        fs::create_dir_all(backup_path).map_err(|e| format!("Failed to create backup directory: {}", e))?;

        let file_name = path.file_name()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "mod_backup".to_string());

        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let backup_name = format!("{}_{}", timestamp, file_name);
        let backup_dest = backup_path.join(&backup_name);

        if path.is_dir() {
            copy_dir_all(path, &backup_dest)?;
        } else {
            fs::copy(path, backup_dest).map_err(|e| format!("Failed to backup mod: {}", e))?;
        }
    }

    // Delete the mod
    if path.is_dir() {
        fs::remove_dir_all(path).map_err(|e| format!("Failed to delete mod folder: {}", e))?;
    } else {
        fs::remove_file(path).map_err(|e| format!("Failed to delete mod file: {}", e))?;
    }

    Ok(())
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

// ============== MODPACK FUNCTIONALITY ==============

#[derive(Debug, Serialize, Deserialize)]
pub struct ModpackMetadata {
    pub name: String,
    pub description: String,
    pub game_version: Option<String>,
    pub created_at: String,
    pub mods: Vec<ModpackModInfo>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModpackModInfo {
    pub modid: String,
    pub name: String,
    pub version: String,
    pub file_name: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct ModpackProfile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub imported_at: String,
    pub mods: Vec<ModpackModInfo>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModpackProfilesData {
    pub modpacks: Vec<ModpackProfile>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ModpackImportResult {
    pub profile: ModpackProfile,
    pub imported_mods: Vec<String>,
}

#[tauri::command]
pub fn get_desktop_path() -> Result<String, String> {
    dirs::desktop_dir()
        .map(|p| p.to_string_lossy().to_string())
        .ok_or_else(|| "Could not find desktop directory".to_string())
}

#[tauri::command]
pub fn export_modpack(
    mods_path: String,
    output_path: String,
    modpack_name: String,
    description: String,
    selected_mod_paths: Vec<String>,
) -> Result<String, String> {
    use zip::write::SimpleFileOptions;
    use zip::ZipWriter;

    let mods_dir = Path::new(&mods_path);
    if !mods_dir.exists() {
        return Err("Mods directory does not exist".to_string());
    }

    // Get list of installed mods
    let all_mods = list_installed_mods(mods_path.clone())?;

    // Filter to only selected mods
    let mods_to_export: Vec<&InstalledMod> = if selected_mod_paths.is_empty() {
        // If no selection, export all
        all_mods.iter().collect()
    } else {
        all_mods.iter()
            .filter(|m| selected_mod_paths.contains(&m.file_path))
            .collect()
    };

    if mods_to_export.is_empty() {
        return Err("No mods to export".to_string());
    }

    // Create the output file
    let output_file = File::create(&output_path)
        .map_err(|e| format!("Failed to create modpack file: {}", e))?;

    let mut zip = ZipWriter::new(output_file);
    let options = SimpleFileOptions::default()
        .compression_method(zip::CompressionMethod::Deflated);

    // Add each mod to the zip
    for mod_info in &mods_to_export {
        let mod_path = Path::new(&mod_info.file_path);

        if mod_info.is_folder {
            // Add folder recursively
            add_folder_to_zip(&mut zip, mod_path, &mod_info.file_name, options)?;
        } else {
            // Add zip file
            let mut mod_file = File::open(mod_path)
                .map_err(|e| format!("Failed to open mod file {}: {}", mod_info.file_name, e))?;

            zip.start_file(&mod_info.file_name, options)
                .map_err(|e| format!("Failed to add file to zip: {}", e))?;

            std::io::copy(&mut mod_file, &mut zip)
                .map_err(|e| format!("Failed to write mod to zip: {}", e))?;
        }
    }

    // Create metadata
    let metadata = ModpackMetadata {
        name: modpack_name,
        description,
        game_version: None,
        created_at: chrono::Local::now().to_rfc3339(),
        mods: mods_to_export.iter().map(|m| ModpackModInfo {
            modid: m.modid.clone(),
            name: m.name.clone(),
            version: m.version.clone(),
            file_name: m.file_name.clone(),
        }).collect(),
    };

    // Add metadata to zip
    let metadata_json = serde_json::to_string_pretty(&metadata)
        .map_err(|e| format!("Failed to serialize metadata: {}", e))?;

    zip.start_file("modpack.json", options)
        .map_err(|e| format!("Failed to add metadata to zip: {}", e))?;

    zip.write_all(metadata_json.as_bytes())
        .map_err(|e| format!("Failed to write metadata: {}", e))?;

    zip.finish()
        .map_err(|e| format!("Failed to finalize zip: {}", e))?;

    Ok(output_path)
}

fn add_folder_to_zip<W: Write + std::io::Seek>(
    zip: &mut zip::ZipWriter<W>,
    folder_path: &Path,
    base_name: &str,
    options: zip::write::SimpleFileOptions,
) -> Result<(), String> {
    use std::io::Read as _;

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

#[tauri::command]
pub fn import_modpack(
    modpack_path: String,
    mods_path: String,
    backup_existing: bool,
    backup_dir: String,
) -> Result<ModpackImportResult, String> {
    let modpack_file = File::open(&modpack_path)
        .map_err(|e| format!("Failed to open modpack: {}", e))?;

    let mut archive = ZipArchive::new(modpack_file)
        .map_err(|e| format!("Failed to read modpack zip: {}", e))?;

    let mods_dir = Path::new(&mods_path);
    fs::create_dir_all(mods_dir)
        .map_err(|e| format!("Failed to create mods directory: {}", e))?;

    let mut imported_mods = Vec::new();

    // Try to read modpack.json metadata
    let metadata: Option<ModpackMetadata> = {
        let mut metadata_content = None;
        for i in 0..archive.len() {
            let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
            if entry.name() == "modpack.json" {
                let mut contents = String::new();
                entry.read_to_string(&mut contents).ok();
                metadata_content = Some(contents);
                break;
            }
        }
        metadata_content.and_then(|c| serde_json::from_str(&c).ok())
    };

    // First pass: identify all top-level entries (mods)
    let mut top_level_entries: std::collections::HashSet<String> = std::collections::HashSet::new();

    for i in 0..archive.len() {
        let entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();

        // Skip modpack.json
        if name == "modpack.json" {
            continue;
        }

        // Get top-level name (first component)
        if let Some(top_level) = name.split('/').next() {
            if !top_level.is_empty() {
                top_level_entries.insert(top_level.to_string());
            }
        }
    }

    // Backup existing mods if they would be overwritten
    if backup_existing {
        for entry_name in &top_level_entries {
            let dest_path = safe_join(mods_dir, entry_name)?;
            if dest_path.exists() {
                let backup_path = Path::new(&backup_dir);
                fs::create_dir_all(backup_path).ok();

                let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
                let backup_name = format!("{}_{}", timestamp, entry_name);
                let backup_dest = backup_path.join(&backup_name);

                if dest_path.is_dir() {
                    copy_dir_all(&dest_path, &backup_dest).ok();
                    fs::remove_dir_all(&dest_path).ok();
                } else {
                    fs::copy(&dest_path, &backup_dest).ok();
                    fs::remove_file(&dest_path).ok();
                }
            }
        }
    }

    // Extract all files
    for i in 0..archive.len() {
        let mut entry = archive.by_index(i).map_err(|e| e.to_string())?;
        let name = entry.name().to_string();

        // Skip modpack.json
        if name == "modpack.json" {
            continue;
        }

        let dest_path = safe_join(mods_dir, &name)?;

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
        }
    }

    // Collect imported mod names
    for entry_name in &top_level_entries {
        if entry_name != "modpack.json" {
            imported_mods.push(entry_name.clone());
        }
    }

    // Create profile from metadata or generate default
    let profile = if let Some(meta) = metadata {
        ModpackProfile {
            id: uuid::Uuid::new_v4().to_string(),
            name: meta.name,
            description: meta.description,
            imported_at: chrono::Local::now().to_rfc3339(),
            mods: meta.mods,
        }
    } else {
        // Generate profile from imported files
        let modpack_filename = Path::new(&modpack_path)
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "Modpack Importado".to_string());

        ModpackProfile {
            id: uuid::Uuid::new_v4().to_string(),
            name: modpack_filename,
            description: String::new(),
            imported_at: chrono::Local::now().to_rfc3339(),
            mods: top_level_entries.iter()
                .filter(|e| *e != "modpack.json")
                .map(|e| ModpackModInfo {
                    modid: e.clone(),
                    name: e.clone(),
                    version: "Unknown".to_string(),
                    file_name: e.clone(),
                })
                .collect(),
        }
    };

    Ok(ModpackImportResult {
        profile,
        imported_mods,
    })
}

// ============== MODPACK PROFILE MANAGEMENT ==============

fn get_modpacks_file_path(data_path: &str) -> std::path::PathBuf {
    Path::new(data_path).join("modpacks.json")
}

#[tauri::command]
pub fn list_modpack_profiles(data_path: String) -> Result<Vec<ModpackProfile>, String> {
    let file_path = get_modpacks_file_path(&data_path);

    if !file_path.exists() {
        return Ok(Vec::new());
    }

    let contents = fs::read_to_string(&file_path)
        .map_err(|e| format!("Failed to read modpacks file: {}", e))?;

    let data: ModpackProfilesData = serde_json::from_str(&contents)
        .map_err(|e| format!("Failed to parse modpacks file: {}", e))?;

    Ok(data.modpacks)
}

#[tauri::command]
pub fn save_modpack_profile(data_path: String, profile: ModpackProfile) -> Result<(), String> {
    let file_path = get_modpacks_file_path(&data_path);

    // Load existing profiles
    let mut profiles = list_modpack_profiles(data_path.clone()).unwrap_or_default();

    // Check if profile with same ID exists, update it
    if let Some(pos) = profiles.iter().position(|p| p.id == profile.id) {
        profiles[pos] = profile;
    } else {
        profiles.push(profile);
    }

    let data = ModpackProfilesData { modpacks: profiles };

    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize modpacks: {}", e))?;

    fs::write(&file_path, json)
        .map_err(|e| format!("Failed to write modpacks file: {}", e))?;

    Ok(())
}

#[tauri::command]
pub fn delete_modpack_profile(data_path: String, profile_id: String) -> Result<(), String> {
    let file_path = get_modpacks_file_path(&data_path);

    let mut profiles = list_modpack_profiles(data_path).unwrap_or_default();

    profiles.retain(|p| p.id != profile_id);

    let data = ModpackProfilesData { modpacks: profiles };

    let json = serde_json::to_string_pretty(&data)
        .map_err(|e| format!("Failed to serialize modpacks: {}", e))?;

    fs::write(&file_path, json)
        .map_err(|e| format!("Failed to write modpacks file: {}", e))?;

    Ok(())
}
