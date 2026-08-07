import { invoke } from '@tauri-apps/api/core';
import type { Settings, DefaultPaths, ServerStatus, SaveInfo, PlayerInfo, LocalPlayerInfo, ProcessMetrics, FullServerConfig, InstalledMod, ApiModSearchResult, ApiModDetails, ModpackProfile, ModpackImportResult, ServerProfile, ServerProfileExportMetadata, ProfileImportResult } from './types';

// Config commands
export async function loadSettings(): Promise<Settings> {
  return invoke('load_settings');
}

export async function saveSettings(settings: Settings): Promise<void> {
  return invoke('save_settings', { settings });
}

export async function getDefaultPaths(): Promise<DefaultPaths> {
  return invoke('get_default_paths');
}

// Process commands
export async function startServer(exePath: string, dataPath: string): Promise<ServerStatus> {
  return invoke('start_server', { exePath, dataPath });
}

export async function stopServer(): Promise<void> {
  return invoke('stop_server');
}

export async function getServerStatus(): Promise<ServerStatus> {
  return invoke('get_server_status');
}

export async function sendCommand(command: string): Promise<void> {
  return invoke('send_command', { command });
}

export async function getServerLogs(): Promise<string[]> {
  return invoke('get_server_logs');
}

export async function getOnlinePlayers(): Promise<PlayerInfo[]> {
  return invoke('get_online_players');
}

export async function getProcessMetrics(): Promise<ProcessMetrics | null> {
  return invoke('get_process_metrics');
}

// Saves commands
export async function listSaves(path: string): Promise<SaveInfo[]> {
  return invoke('list_saves', { path });
}

export async function backupSave(srcPath: string, backupDir: string, keepBackups?: number): Promise<string> {
  return invoke('backup_save', { srcPath, backupDir, keepBackups });
}

export async function copySave(
  srcPath: string,
  dstPath: string,
  createBackup: boolean,
  backupDir: string,
  keepBackups?: number
): Promise<void> {
  return invoke('copy_save', { srcPath, dstPath, createBackup, backupDir, keepBackups });
}

export async function deleteSave(
  path: string,
  backupDir: string,
  createBackup: boolean,
  keepBackups?: number
): Promise<void> {
  return invoke('delete_save', { path, backupDir, createBackup, keepBackups });
}

// Backups management
export interface BackupEntry {
  file_path: string;
  file_name: string;
  size_bytes: number;
  modified_unix: number;
  kind: 'save' | 'mod' | 'other';
  base_name: string;
  orphan: boolean;
}

export async function listBackups(backupDir: string, savesDir?: string): Promise<BackupEntry[]> {
  return invoke('list_backups', { backupDir, savesDir });
}

export async function deleteBackups(paths: string[]): Promise<number> {
  return invoke('delete_backups', { paths });
}

export async function pruneOldBackups(
  backupDir: string,
  baseName: string,
  kind: string,
  keep: number
): Promise<number> {
  return invoke('prune_old_backups', { backupDir, baseName, kind, keep });
}

export async function setActiveWorld(configPath: string, saveFileLocation: string): Promise<void> {
  return invoke('set_active_world', { configPath, saveFileLocation });
}

export async function readServerConfig(configPath: string): Promise<string | null> {
  return invoke('read_server_config', { configPath });
}

export async function readFullServerConfig(configPath: string): Promise<FullServerConfig> {
  return invoke('read_full_server_config', { configPath });
}

export async function saveFullServerConfig(configPath: string, config: FullServerConfig): Promise<void> {
  return invoke('save_full_server_config', { configPath, config });
}

// Ports commands
export async function testPortLocal(port: number): Promise<boolean> {
  return invoke('test_port_local', { port });
}

export async function getLocalIp(): Promise<string> {
  return invoke('get_local_ip');
}

export async function getPublicIp(): Promise<string> {
  return invoke('get_public_ip');
}

// Mods commands
export async function listInstalledMods(modsPath: string): Promise<InstalledMod[]> {
  return invoke('list_installed_mods', { modsPath });
}

export async function getServerVersion(serverExePath: string): Promise<string | null> {
  return invoke('get_server_version', { serverExePath });
}

export async function searchMods(
  query: string,
  gameVersion?: string,
  orderBy?: string
): Promise<ApiModSearchResult[]> {
  return invoke('search_mods', { query, gameVersion, orderBy });
}

export async function getModDetails(modId: string): Promise<ApiModDetails> {
  return invoke('get_mod_details', { modId });
}

export async function getGameVersions(): Promise<string[]> {
  return invoke('get_game_versions');
}

export async function downloadMod(
  downloadUrl: string,
  filename: string,
  modsPath: string
): Promise<string> {
  return invoke('download_mod', { downloadUrl, filename, modsPath });
}

export async function deleteMod(
  modPath: string,
  backupDir: string,
  createBackup: boolean
): Promise<void> {
  return invoke('delete_mod', { modPath, backupDir, createBackup });
}

// Modpack commands
export async function getDesktopPath(): Promise<string> {
  return invoke('get_desktop_path');
}

export async function exportModpack(
  modsPath: string,
  outputPath: string,
  modpackName: string,
  description: string,
  selectedModPaths: string[]
): Promise<string> {
  return invoke('export_modpack', { modsPath, outputPath, modpackName, description, selectedModPaths });
}

export async function importModpack(
  modpackPath: string,
  modsPath: string,
  backupExisting: boolean,
  backupDir: string
): Promise<ModpackImportResult> {
  return invoke('import_modpack', { modpackPath, modsPath, backupExisting, backupDir });
}

// Modpack profile commands
export async function listModpackProfiles(dataPath: string): Promise<ModpackProfile[]> {
  return invoke('list_modpack_profiles', { dataPath });
}

export async function saveModpackProfile(dataPath: string, profile: ModpackProfile): Promise<void> {
  return invoke('save_modpack_profile', { dataPath, profile });
}

export async function deleteModpackProfile(dataPath: string, profileId: string): Promise<void> {
  return invoke('delete_modpack_profile', { dataPath, profileId });
}

// Server Profile commands
export async function getProfilesBasePath(): Promise<string> {
  return invoke('get_profiles_base_path');
}

export async function listServerProfiles(): Promise<ServerProfile[]> {
  return invoke('list_server_profiles');
}

export async function ensureDefaultProfile(currentDataPath: string): Promise<ServerProfile> {
  return invoke('ensure_default_profile', { currentDataPath });
}

export async function createServerProfile(name: string, description: string): Promise<ServerProfile> {
  return invoke('create_server_profile', { name, description });
}

export async function setActiveProfile(profileId: string): Promise<ServerProfile> {
  return invoke('set_active_profile', { profileId });
}

export async function updateServerProfile(
  profileId: string,
  name: string,
  description: string
): Promise<ServerProfile> {
  return invoke('update_server_profile', { profileId, name, description });
}

export async function linkProfileToWorld(
  profileId: string,
  worldId: string | null,
): Promise<ServerProfile> {
  return invoke('link_profile_to_world', { profileId, worldId });
}

export async function registerGroupSave(
  profileId: string,
  entry: { world_id: string; world_name: string; filename: string }
): Promise<ServerProfile> {
  return invoke('register_group_save', { profileId, entry });
}

export async function unregisterGroupSave(
  profileId: string,
  filename: string
): Promise<ServerProfile> {
  return invoke('unregister_group_save', { profileId, filename });
}

export async function deleteServerProfile(profileId: string): Promise<void> {
  return invoke('delete_server_profile', { profileId });
}

export async function exportServerProfile(
  dataPath: string,
  outputPath: string,
  profileName: string,
  description: string
): Promise<string> {
  return invoke('export_server_profile', { dataPath, outputPath, profileName, description });
}

export async function importServerProfile(
  zipPath: string,
  customName?: string
): Promise<ProfileImportResult> {
  return invoke('import_server_profile', { zipPath, customName });
}

export async function getProfileExportPreview(dataPath: string): Promise<ServerProfileExportMetadata> {
  return invoke('get_profile_export_preview', { dataPath });
}

// Player commands
export async function getLocalPlayerInfo(dataPath: string): Promise<LocalPlayerInfo> {
  return invoke('get_local_player_info', { dataPath });
}

export async function generateRandomUid(): Promise<string> {
  return invoke('generate_random_uid');
}

export async function setLocalPlayerUid(dataPath: string, uid: string): Promise<LocalPlayerInfo> {
  return invoke('set_local_player_uid', { dataPath, uid });
}

// Cloud commands (PocketBase backend)
export interface UploadResult {
  record_id: string;
  size_bytes: number;
  original_size: number;
}

export interface UploadProgress {
  stage: 'reading' | 'compressing' | 'uploading' | 'done';
  percent: number;
  bytes_done: number;
  bytes_total: number;
  message: string;
}

export async function uploadSaveToCloud(args: {
  savePath: string;
  pbUrl: string;
  token: string;
  worldId: string;
  version: number;
  userId: string;
  modsManifest?: unknown;
}): Promise<UploadResult> {
  return invoke('upload_save_to_cloud', {
    savePath: args.savePath,
    pbUrl: args.pbUrl,
    token: args.token,
    worldId: args.worldId,
    version: args.version,
    userId: args.userId,
    modsManifest: args.modsManifest ?? null,
  });
}

export interface DownloadResult {
  bytes_written: number;
  backup_path: string | null;
  destination_path: string;
}

export interface DownloadProgress {
  stage: 'backup' | 'downloading' | 'decompressing' | 'writing' | 'done';
  percent: number;
  bytes_done: number;
  bytes_total: number;
  message: string;
}

export async function downloadSaveFromCloud(args: {
  destinationPath: string;
  pbUrl: string;
  token: string;
  recordId: string;
  filename: string;
  backupExisting: boolean;
  backupDir?: string;
  keepBackups?: number;
}): Promise<DownloadResult> {
  return invoke('download_save_from_cloud', args);
}
