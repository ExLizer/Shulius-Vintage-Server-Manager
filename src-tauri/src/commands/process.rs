use serde::Serialize;
use std::collections::VecDeque;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use sysinfo::{Pid, System};
use tauri::State;

const MAX_LOG_LINES: usize = 500;

pub struct ServerState {
    // child esta envuelto en Arc para que comandos async (stop_server) puedan
    // clonar la referencia y moverla a un spawn_blocking sin pelear con la
    // lifetime de tauri::State<'_>. Antes era Mutex<Option<Child>> directo, lo
    // cual fuerza al comando a ser sincronico → corre en el hilo principal de
    // la UI → 120s de "sin responder" durante el shutdown.
    pub child: Arc<Mutex<Option<Child>>>,
    pub logs: Arc<Mutex<VecDeque<String>>>,
    pub players: Arc<Mutex<Vec<String>>>,
}

impl Default for ServerState {
    fn default() -> Self {
        ServerState {
            child: Arc::new(Mutex::new(None)),
            logs: Arc::new(Mutex::new(VecDeque::with_capacity(MAX_LOG_LINES))),
            players: Arc::new(Mutex::new(Vec::new())),
        }
    }
}

// Re-export as ServerProcess for backwards compatibility
pub type ServerProcess = ServerState;

#[derive(Debug, Serialize)]
pub struct ServerStatus {
    pub running: bool,
    pub pid: Option<u32>,
}

#[derive(Debug, Serialize, Clone)]
pub struct PlayerInfo {
    pub name: String,
}

fn parse_player_join(line: &str) -> Option<String> {
    // Vintage Story log format:
    // "[Server Event] Shulius55 [::ffff:192.168.0.36]:55797 joins."
    let line_lower = line.to_lowercase();

    if line_lower.contains("[server event]") && line_lower.contains("joins.") {
        if let Some(start) = line.find("] ") {
            let rest = &line[start + 2..];
            // Name is before the IP address or before "joins"
            // Format: "PlayerName [IP]:port joins." or "PlayerName joins."

            // Try to find where the name ends (either at [ or at space before joins)
            let name_end = rest.find(" [")
                .or_else(|| rest.to_lowercase().find(" joins"))
                .unwrap_or(rest.len());

            let name = rest[..name_end].trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }
    None
}

fn parse_player_leave(line: &str) -> Option<String> {
    // Vintage Story log formats:
    // "[Server Event] PlayerName leaves."
    // "[Server Notification] UDP: client disconnected PlayerName"
    let line_lower = line.to_lowercase();

    // Check for "leaves." format (name before)
    if line_lower.contains("[server event]") && line_lower.contains("leaves.") {
        if let Some(start) = line.find("] ") {
            let rest = &line[start + 2..];
            if let Some(end) = rest.to_lowercase().find(" leaves") {
                let name = rest[..end].trim();
                // Handle "PlayerName [IP]:port leaves." format
                let name = name.split(" [").next().unwrap_or(name).trim();
                if !name.is_empty() {
                    return Some(name.to_string());
                }
            }
        }
    }

    // Check for "UDP: client disconnected PlayerName" format (name AFTER disconnected)
    if line_lower.contains("udp: client disconnected") {
        if let Some(pos) = line_lower.find("udp: client disconnected") {
            let after = &line[pos + 24..]; // "udp: client disconnected" is 24 chars
            let name = after.trim();
            if !name.is_empty() {
                return Some(name.to_string());
            }
        }
    }

    None
}

#[tauri::command]
pub fn start_server(
    server_state: State<'_, ServerProcess>,
    exe_path: String,
    data_path: String,
) -> Result<ServerStatus, String> {
    let mut child_guard = server_state.child.lock().map_err(|e| e.to_string())?;

    // Check if already running
    if let Some(ref mut child) = *child_guard {
        match child.try_wait() {
            Ok(Some(_)) => {
                // Process has exited, we can start a new one
            }
            Ok(None) => {
                // Process is still running
                return Err("Server is already running".to_string());
            }
            Err(e) => {
                return Err(format!("Failed to check server status: {}", e));
            }
        }
    }

    // Clear logs and players
    {
        let mut logs = server_state.logs.lock().map_err(|e| e.to_string())?;
        logs.clear();
    }
    {
        let mut players = server_state.players.lock().map_err(|e| e.to_string())?;
        players.clear();
    }

    // Start the server
    let mut cmd = Command::new(&exe_path);

    // Set working directory to server's installation folder
    if let Some(server_dir) = std::path::Path::new(&exe_path).parent() {
        cmd.current_dir(server_dir);
    }

    cmd.args(["--dataPath", &data_path])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = cmd.spawn()
        .map_err(|e| format!("Failed to start server: {}", e))?;

    let pid = child.id();

    // Spawn thread to read stdout
    let stdout = child.stdout.take();
    let logs_clone = Arc::clone(&server_state.logs);
    let players_clone = Arc::clone(&server_state.players);

    if let Some(stdout) = stdout {
        thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines() {
                if let Ok(line) = line {
                    // Check for player join/leave
                    if let Some(player) = parse_player_join(&line) {
                        if let Ok(mut players) = players_clone.lock() {
                            if !players.contains(&player) {
                                players.push(player);
                            }
                        }
                    }
                    if let Some(player) = parse_player_leave(&line) {
                        if let Ok(mut players) = players_clone.lock() {
                            players.retain(|p| p != &player);
                        }
                    }

                    // Add to logs
                    if let Ok(mut logs) = logs_clone.lock() {
                        if logs.len() >= MAX_LOG_LINES {
                            logs.pop_front();
                        }
                        logs.push_back(line);
                    }
                }
            }
        });
    }

    // Spawn thread to read stderr
    let stderr = child.stderr.take();
    let logs_clone2 = Arc::clone(&server_state.logs);

    if let Some(stderr) = stderr {
        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines() {
                if let Ok(line) = line {
                    if let Ok(mut logs) = logs_clone2.lock() {
                        if logs.len() >= MAX_LOG_LINES {
                            logs.pop_front();
                        }
                        logs.push_back(format!("[ERR] {}", line));
                    }
                }
            }
        });
    }

    *child_guard = Some(child);

    Ok(ServerStatus {
        running: true,
        pid: Some(pid),
    })
}

// Espera a que aparezca CUALQUIERA de los `markers` (substring match) en las
// lineas de log nuevas desde `start_offset`. Retorna true si se vio antes del
// timeout, false si vencio. Hace polling de los logs cada 150ms.
//
// Necesario porque /autosavenow lanza un offthread save (chunks dirty se
// persisten en background). Si /stop llega antes que el offthread termine,
// el .vcdbs queda con cambios sin escribir. Adivinar con sleep fijo no
// funciona porque el tiempo depende de cuantos chunks haya modificado el
// jugador.
fn wait_for_log_marker(
    logs: &Arc<Mutex<VecDeque<String>>>,
    start_offset: usize,
    markers: &[&str],
    timeout: std::time::Duration,
) -> bool {
    let start = std::time::Instant::now();
    while start.elapsed() < timeout {
        if let Ok(guard) = logs.lock() {
            // Solo miramos lineas nuevas (las que llegaron despues de que
            // mandamos el comando). El VecDeque puede haber descartado lineas
            // viejas por MAX_LOG_LINES; si rotó, miramos todo el buffer actual
            // (los markers son lo bastante especificos como para que un falso
            // positivo casi nunca importe — solo aparecerian una vez por stop).
            let total = guard.len();
            let from = if total >= start_offset { start_offset } else { 0 };
            for line in guard.iter().skip(from) {
                for m in markers {
                    if line.contains(m) {
                        return true;
                    }
                }
            }
        }
        std::thread::sleep(std::time::Duration::from_millis(150));
    }
    false
}

#[tauri::command]
pub async fn stop_server(
    server_state: State<'_, ServerProcess>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    // El stop sequence hace polling sincronico con waits de hasta 30s + 60s + 30s.
    // Si esto corre en el hilo de la UI (lo que pasa con #[tauri::command] sync
    // en Tauri 2) la app se ve "sin responder" durante todo el shutdown. Lo
    // pasamos al pool de blocking del runtime async para que la UI siga libre.
    let child_arc = Arc::clone(&server_state.child);
    let logs_arc = Arc::clone(&server_state.logs);
    let players_arc = Arc::clone(&server_state.players);

    tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
        stop_server_blocking(child_arc, logs_arc, players_arc, app_handle)
    })
    .await
    .map_err(|e| format!("stop_server task join error: {}", e))?
}

fn stop_server_blocking(
    child_arc: Arc<Mutex<Option<Child>>>,
    logs_arc: Arc<Mutex<VecDeque<String>>>,
    players_arc: Arc<Mutex<Vec<String>>>,
    app_handle: tauri::AppHandle,
) -> Result<(), String> {
    use tauri::Emitter;

    let mut child_guard = child_arc.lock().map_err(|e| e.to_string())?;

    if let Some(ref mut child) = *child_guard {
        if let Some(mut stdin) = child.stdin.take() {
            // Step 1: anuncio (cortesia con los jugadores conectados)
            app_handle.emit("server-stop-progress", "announcing").ok();
            let _ = stdin.write_all(b"/announce Server guardando y apagando...\r\n");
            let _ = stdin.flush();
            std::thread::sleep(std::time::Duration::from_millis(500));

            // Step 2: autosave + esperar a que el OFFTHREAD termine.
            // /autosavenow es asincrono: el "save inmediato" termina rapido
            // pero los chunks dirty se escriben en otro thread. Hay que esperar
            // a "Offthread save of savegame done" antes de mandar /stop, si no
            // los cambios recientes se pierden.
            app_handle.emit("server-stop-progress", "autosaving").ok();
            let offset_before_autosave = logs_arc.lock().map(|g| g.len()).unwrap_or(0);
            let _ = stdin.write_all(b"/autosavenow\r\n");
            let _ = stdin.flush();
            let autosave_ok = wait_for_log_marker(
                &logs_arc,
                offset_before_autosave,
                &[
                    "Offthread save of savegame done",
                    "Autosave completed",
                ],
                std::time::Duration::from_secs(30),
            );
            if !autosave_ok {
                eprintln!("[stop] autosave marker not seen in 30s, proceeding to /stop anyway");
            }

            // Step 3: /stop. El shutdown sequence de VS hace otro save sincrono
            // de los chunks cargados. Esperamos a "Stopped the server!" antes
            // de declarar exito.
            app_handle.emit("server-stop-progress", "stopping").ok();
            let offset_before_stop = logs_arc.lock().map(|g| g.len()).unwrap_or(0);
            let _ = stdin.write_all(b"/stop\r\n");
            let _ = stdin.flush();

            // Stdin se dropea aca a proposito. Cerrar stdin le indica a VS que
            // no van a llegar mas comandos y permite que su consola termine
            // limpiamente. Antes lo reasignabamos a child.stdin, lo cual a
            // veces interfiere con el shutdown ordenado en Windows.
            drop(stdin);

            let stopped_ok = wait_for_log_marker(
                &logs_arc,
                offset_before_stop,
                &["Stopped the server!"],
                std::time::Duration::from_secs(60),
            );
            if !stopped_ok {
                eprintln!("[stop] 'Stopped the server!' marker not seen in 60s");
            }
        }

        // Damos hasta 30s mas para que el process termine solo (el log puede
        // haber dicho "Stopped" pero el process aun esta cerrando handles +
        // flush de SQLite). Polling con try_wait en vez de sleep fijo asi
        // arrancamos en cuanto termine.
        let wait_until = std::time::Instant::now() + std::time::Duration::from_secs(30);
        let mut exited = false;
        while std::time::Instant::now() < wait_until {
            match child.try_wait() {
                Ok(Some(_)) => {
                    exited = true;
                    break;
                }
                Ok(None) => {
                    std::thread::sleep(std::time::Duration::from_millis(200));
                }
                Err(e) => {
                    return Err(format!("Failed to check server status: {}", e));
                }
            }
        }

        if !exited {
            // Ultimo recurso. A esta altura ya esperamos hasta ~120s en total
            // (30s autosave + 60s stop + 30s exit). Si sigue vivo, algo se
            // colgo en VS y kill es la unica salida. Riesgo: WAL puede quedar
            // sin checkpoint, pero el wal_checkpoint pre-upload de cloud.rs
            // ataja eso.
            eprintln!("[stop] server did not exit in 120s, force killing");
            child.kill().map_err(|e| format!("Failed to kill server: {}", e))?;
            child.wait().map_err(|e| format!("Failed to wait for server: {}", e))?;
        }

        if let Ok(mut players) = players_arc.lock() {
            players.clear();
        }

        app_handle.emit("server-stop-progress", "done").ok();

        *child_guard = None;
        Ok(())
    } else {
        Err("Server is not running".to_string())
    }
}

#[tauri::command]
pub fn get_server_status(server_state: State<'_, ServerProcess>) -> Result<ServerStatus, String> {
    let mut child_guard = server_state.child.lock().map_err(|e| e.to_string())?;

    if let Some(ref mut child) = *child_guard {
        match child.try_wait() {
            Ok(Some(_)) => {
                // Process has exited
                *child_guard = None;
                // Clear players
                if let Ok(mut players) = server_state.players.lock() {
                    players.clear();
                }
                Ok(ServerStatus {
                    running: false,
                    pid: None,
                })
            }
            Ok(None) => {
                // Process is still running
                Ok(ServerStatus {
                    running: true,
                    pid: Some(child.id()),
                })
            }
            Err(e) => Err(format!("Failed to check server status: {}", e)),
        }
    } else {
        Ok(ServerStatus {
            running: false,
            pid: None,
        })
    }
}

#[tauri::command]
pub fn send_command(server_state: State<'_, ServerProcess>, command: String) -> Result<(), String> {
    let mut child_guard = server_state.child.lock().map_err(|e| e.to_string())?;

    if let Some(ref mut child) = *child_guard {
        if let Some(ref mut stdin) = child.stdin {
            // CRITICO: CRLF, no solo LF. El servidor VS en Windows lee comandos
            // de stdin con un splitter que espera \r\n; con solo \n los comandos
            // entran al buffer pero no se procesan, asi que /autosavenow,
            // /announce y todo lo que vaya por aca se descarta silenciosamente.
            // Sintoma: el autosave del dashboard no aparece en la consola y los
            // jugadores no reciben los broadcasts. stop_server ya manda \r\n por
            // el mismo motivo, esta funcion estaba inconsistente.
            stdin.write_all(format!("{}\r\n", command).as_bytes())
                .map_err(|e| format!("Failed to send command: {}", e))?;
            stdin.flush().map_err(|e| format!("Failed to flush: {}", e))?;
            Ok(())
        } else {
            Err("No stdin available".to_string())
        }
    } else {
        Err("Server is not running".to_string())
    }
}

#[tauri::command]
pub fn get_server_logs(server_state: State<'_, ServerProcess>) -> Result<Vec<String>, String> {
    let logs = server_state.logs.lock().map_err(|e| e.to_string())?;
    Ok(logs.iter().cloned().collect())
}

#[tauri::command]
pub fn get_online_players(server_state: State<'_, ServerProcess>) -> Result<Vec<PlayerInfo>, String> {
    let players = server_state.players.lock().map_err(|e| e.to_string())?;
    Ok(players.iter().map(|name| PlayerInfo { name: name.clone() }).collect())
}

#[derive(Debug, Serialize)]
pub struct ProcessMetrics {
    pub cpu_usage: f32,
    pub memory_mb: f64,
    pub timestamp: i64,
}

#[tauri::command]
pub fn get_process_metrics(server_state: State<'_, ServerProcess>) -> Result<Option<ProcessMetrics>, String> {
    let child_guard = server_state.child.lock().map_err(|e| e.to_string())?;

    if let Some(ref child) = *child_guard {
        let pid = child.id();
        let mut sys = System::new_all();
        let sysinfo_pid = Pid::from_u32(pid);

        // Need to refresh twice for CPU usage to be accurate
        sys.refresh_process(sysinfo_pid);
        std::thread::sleep(std::time::Duration::from_millis(100));
        sys.refresh_process(sysinfo_pid);

        if let Some(process) = sys.process(sysinfo_pid) {
            // Normalize CPU usage to 0-100% by dividing by number of CPUs
            let num_cpus = sys.cpus().len().max(1) as f32;
            let normalized_cpu = process.cpu_usage() / num_cpus;

            return Ok(Some(ProcessMetrics {
                cpu_usage: normalized_cpu,
                memory_mb: process.memory() as f64 / 1024.0 / 1024.0,
                timestamp: chrono::Utc::now().timestamp_millis(),
            }));
        }
    }
    Ok(None)
}
