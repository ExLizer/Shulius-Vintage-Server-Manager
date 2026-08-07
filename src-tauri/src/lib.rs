mod commands;

use commands::{backups, cloud, config, mods, player, ports, process, profiles, saves};
use process::ServerProcess;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_process::init())
        .manage(ServerProcess::default())
        .invoke_handler(tauri::generate_handler![
            // Config commands
            config::load_settings,
            config::save_settings,
            config::get_default_paths,
            // Process commands
            process::start_server,
            process::stop_server,
            process::get_server_status,
            process::send_command,
            process::get_server_logs,
            process::get_online_players,
            process::get_process_metrics,
            // Saves commands
            saves::list_saves,
            saves::backup_save,
            saves::copy_save,
            saves::delete_save,
            saves::set_active_world,
            saves::read_server_config,
            saves::read_full_server_config,
            saves::save_full_server_config,
            // Ports commands
            ports::test_port_local,
            ports::get_local_ip,
            ports::get_public_ip,
            // Mods commands
            mods::list_installed_mods,
            mods::get_server_version,
            mods::search_mods,
            mods::get_mod_details,
            mods::get_game_versions,
            mods::download_mod,
            mods::delete_mod,
            // Modpack commands
            mods::get_desktop_path,
            mods::export_modpack,
            mods::import_modpack,
            mods::list_modpack_profiles,
            mods::save_modpack_profile,
            mods::delete_modpack_profile,
            // Profile commands
            profiles::get_profiles_base_path,
            profiles::list_server_profiles,
            profiles::ensure_default_profile,
            profiles::create_server_profile,
            profiles::set_active_profile,
            profiles::update_server_profile,
            profiles::link_profile_to_world,
            profiles::register_group_save,
            profiles::unregister_group_save,
            profiles::delete_server_profile,
            profiles::export_server_profile,
            profiles::import_server_profile,
            profiles::get_profile_export_preview,
            // Player commands
            player::get_local_player_info,
            player::generate_random_uid,
            player::set_local_player_uid,
            // Cloud commands
            cloud::upload_save_to_cloud,
            cloud::download_save_from_cloud,
            // Backups commands
            backups::list_backups,
            backups::delete_backups,
            backups::prune_old_backups,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
