export interface Settings {
  server_exe_path: string;
  data_path: string;
  port: number;
  backup_dir: string;
  keep_backups: number;
  singleplayer_saves_path: string;
  active_profile_id: string | null;
  language: 'es' | 'en';
  // Manager-side scheduled tasks (in minutes). 0 means disabled.
  autosave_interval_minutes: number;
  autobackup_interval_minutes: number;
}

export interface DefaultPaths {
  vs_data_path: string;
  saves_path: string;
  suggested_server_exe: string;
}

export interface ServerStatus {
  running: boolean;
  pid: number | null;
}

export interface SaveInfo {
  name: string;
  full_path: string;
  size_bytes: number;
  modified_at: string;
}

export interface PlayerInfo {
  name: string;
}

export interface LocalPlayerInfo {
  uid: string | null;
  name: string | null;
  source_path: string;
}

export interface ProcessMetrics {
  cpu_usage: number;
  memory_mb: number;
  timestamp: number;
}

export interface FullServerConfig {
  server_name: string;
  server_description: string;
  welcome_message: string;
  password: string;
  max_clients: number;
  authenticate: boolean;
  only_whitelisted: boolean;
  pvp: boolean;
  whitelisted_players: string[];
  color_accurate_worldmap: boolean;
}

export type ViewType = 'server' | 'saves' | 'mods' | 'network' | 'settings' | 'serverconfig' | 'profiles' | 'player' | 'groups' | 'backups';

// Server Profiles
export interface GroupSaveEntry {
  world_id: string;
  world_name: string;
  filename: string;
}

export interface ServerProfile {
  id: string;
  name: string;
  description: string;
  data_path: string;
  created_at: string;
  imported_at?: string;
  is_default: boolean;
  linked_group_world_id?: string | null;
  group_saves?: GroupSaveEntry[];
}

export interface ServerProfileExportMetadata {
  format_version: number;
  name: string;
  description: string;
  created_at: string;
  exported_at: string;
  mods_count: number;
  saves_count: number;
  has_server_config: boolean;
}

export interface ProfileImportResult {
  profile: ServerProfile;
  mods_imported: number;
  saves_imported: number;
}

export interface InstalledMod {
  modid: string;
  name: string;
  version: string;
  description: string;
  authors: string[];
  side: string;
  file_path: string;
  file_name: string;
  file_size: number;
  is_folder: boolean;
}

export interface ApiModSearchResult {
  modid: number;
  name: string;
  summary: string | null;
  author: string;
  downloads: number;
  side: string | null;
  logo: string | null;
  tags: string[] | null;
  urlalias: string | null;
}

export interface ApiModDetails {
  modid: number;
  name: string;
  text: string | null;
  author: string;
  downloads: number;
  side: string | null;
  logo: string | null;
  releases: ApiModRelease[];
  urlalias: string | null;
}

export interface ApiModRelease {
  releaseid: number;
  filename: string;
  modversion: string;
  tags: string[];
  mainfile: string;
}

export interface ModpackModInfo {
  modid: string;
  name: string;
  version: string;
  file_name: string;
}

export interface ModpackProfile {
  id: string;
  name: string;
  description: string;
  imported_at: string;
  mods: ModpackModInfo[];
}

export interface ModpackImportResult {
  profile: ModpackProfile;
  imported_mods: string[];
}
