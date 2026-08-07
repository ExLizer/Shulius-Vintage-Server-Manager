use serde::Serialize;
use serde_json::Value;
use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Write};
use std::path::{Path, PathBuf};
use tauri::{Emitter, Window};

// Tuning para zstd:
// - Level 3 es el balance default-de-zstd: ~10x mas rapido que level 12 con
//   ratio casi identico en SQLite (.vcdbs es SQLite). Saves grandes son chunks
//   binarios densos donde el alto-CPU del level 12 no rinde.
// - Multithread distribuye los frames entre todos los cores.
// - Checksum XXH64 al final del frame: zstd verifica integridad al descomprimir
//   y aborta si los bytes se corrompieron en transito/disco.
const ZSTD_LEVEL: i32 = 3;
const READ_CHUNK_BYTES: usize = 1024 * 1024; // 1 MiB por syscall
const WRITE_CHUNK_BYTES: usize = 1024 * 1024;
const PROGRESS_EMIT_INTERVAL_BYTES: u64 = 10 * 1024 * 1024; // emit cada ~10 MiB

#[derive(Debug, Serialize)]
pub struct UploadResult {
    pub record_id: String,
    pub size_bytes: u64,
    pub original_size: u64,
}

#[derive(Debug, Serialize, Clone)]
pub struct UploadProgress {
    pub stage: String,
    pub percent: u8,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub message: String,
}

fn emit_progress(window: &Window, progress: UploadProgress) {
    let _ = window.emit("upload-progress", progress);
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn upload_save_to_cloud(
    window: Window,
    save_path: String,
    pb_url: String,
    token: String,
    world_id: String,
    version: u64,
    user_id: String,
    mods_manifest: Option<Value>,
) -> Result<UploadResult, String> {
    let src = Path::new(&save_path);
    if !src.exists() {
        return Err(format!("Save file not found: {}", save_path));
    }

    // CRITICO: el .vcdbs es SQLite en modo WAL. Cuando VS escribe, los cambios
    // van primero al .vcdbs-wal y solo se fusionan al .vcdbs en el checkpoint.
    // Si subimos el .vcdbs sin hacer checkpoint, los ultimos cambios (los que
    // siguen en el WAL) se pierden del lado del cloud → al re-descargar otro
    // miembro recibe una version vieja del mundo.
    //
    // PRAGMA wal_checkpoint(TRUNCATE) fuerza el merge del WAL al .vcdbs y
    // trunca el archivo -wal a 0 bytes. Despues de esto el .vcdbs contiene
    // todos los cambios y es seguro subir solo ese archivo.
    //
    // Best-effort: si falla (archivo bloqueado, no es SQLite, etc) seguimos
    // adelante. El upload no es destructivo del lado del cliente, asi que
    // perder algunos cambios remotos es preferible a abortar el stop.
    {
        let save_path_for_pragma = save_path.clone();
        let pragma_result = tauri::async_runtime::spawn_blocking(move || -> Result<(), String> {
            let conn = rusqlite::Connection::open(&save_path_for_pragma)
                .map_err(|e| format!("sqlite open: {}", e))?;
            // El pragma devuelve (busy, log_frames, checkpointed_frames) — no
            // necesitamos los valores, solo que ejecute sin error.
            conn.query_row("PRAGMA wal_checkpoint(TRUNCATE)", [], |_| Ok(()))
                .map_err(|e| format!("wal_checkpoint: {}", e))?;
            Ok(())
        })
        .await
        .map_err(|e| format!("WAL checkpoint task failed: {}", e))?;
        if let Err(e) = pragma_result {
            eprintln!("[cloud] WAL checkpoint failed (continuing): {}", e);
        }
    }

    let metadata = std::fs::metadata(src).map_err(|e| format!("Failed to stat file: {}", e))?;
    let original_size = metadata.len();

    // Stage 1+2 unificado: stream del archivo → zstd Encoder → buffer en RAM.
    // Antes: read_to_end (500MB en RAM) + encode_all (otros 200MB) = ~700MB pico.
    // Ahora: solo el comprimido queda en RAM (~200MB) + buffer de 1MB del read.
    emit_progress(
        &window,
        UploadProgress {
            stage: "compressing".into(),
            percent: 5,
            bytes_done: 0,
            bytes_total: original_size,
            message: "Comprimiendo...".into(),
        },
    );

    let n_workers: u32 = std::thread::available_parallelism()
        .map(|n| (n.get() as u32).min(8))
        .unwrap_or(2);

    let save_path_owned = save_path.clone();
    let window_compress = window.clone();
    let compressed = tauri::async_runtime::spawn_blocking(move || -> Result<Vec<u8>, String> {
        let input_file = File::open(&save_path_owned)
            .map_err(|e| format!("Failed to open file: {}", e))?;
        let mut input = BufReader::with_capacity(READ_CHUNK_BYTES, input_file);

        // Pre-allocar ~50% (ratio tipico zstd sobre SQLite). Si nos quedamos cortos
        // Vec se redimensiona; si sobramos no se desperdicia mucho.
        let mut output: Vec<u8> = Vec::with_capacity((original_size / 2) as usize);

        {
            let mut encoder = zstd::stream::write::Encoder::new(&mut output, ZSTD_LEVEL)
                .map_err(|e| format!("zstd encoder init: {}", e))?;

            // Mejores esfuerzos — si la lib zstd no fue compilada con MT, seguimos
            // single-thread sin abortar. Mismo criterio para checksum.
            if let Err(e) = encoder.multithread(n_workers) {
                eprintln!("[cloud] zstd multithread unavailable, falling back: {}", e);
            }
            if let Err(e) = encoder.include_checksum(true) {
                eprintln!("[cloud] zstd checksum unavailable: {}", e);
            }

            let mut buffer = vec![0u8; READ_CHUNK_BYTES];
            let mut bytes_read: u64 = 0;
            let mut last_emit: u64 = 0;

            loop {
                let n = input
                    .read(&mut buffer)
                    .map_err(|e| format!("read error: {}", e))?;
                if n == 0 {
                    break;
                }
                encoder
                    .write_all(&buffer[..n])
                    .map_err(|e| format!("zstd write: {}", e))?;
                bytes_read += n as u64;

                if bytes_read - last_emit >= PROGRESS_EMIT_INTERVAL_BYTES {
                    // Mapeamos compresion al rango 5-55% del progress global.
                    let ratio = if original_size == 0 {
                        0u64
                    } else {
                        bytes_read.saturating_mul(50) / original_size
                    };
                    let pct = (5 + ratio.min(50)) as u8;
                    emit_progress(
                        &window_compress,
                        UploadProgress {
                            stage: "compressing".into(),
                            percent: pct,
                            bytes_done: bytes_read,
                            bytes_total: original_size,
                            message: format!(
                                "Comprimiendo... {} / {} MiB",
                                bytes_read / (1024 * 1024),
                                original_size / (1024 * 1024)
                            ),
                        },
                    );
                    last_emit = bytes_read;
                }
            }

            encoder
                .finish()
                .map_err(|e| format!("zstd finish: {}", e))?;
        }

        Ok(output)
    })
    .await
    .map_err(|e| format!("Compress task failed: {}", e))??;

    let compressed_size = compressed.len() as u64;

    // Stage 3: POST multipart a PocketBase. Creamos directamente el record
    // world_versions con todos los campos. PB v0.23+ acepta el JWT en el header
    // Authorization SIN prefijo "Bearer ".
    emit_progress(
        &window,
        UploadProgress {
            stage: "uploading".into(),
            percent: 60,
            bytes_done: 0,
            bytes_total: compressed_size,
            message: "Subiendo al cloud...".into(),
        },
    );

    let url = format!(
        "{}/api/collections/world_versions/records",
        pb_url.trim_end_matches('/')
    );

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let filename = format!("{}.vcdbs.zst", version);
    let manifest_str = match mods_manifest {
        Some(v) => serde_json::to_string(&v).unwrap_or_else(|_| "{}".to_string()),
        None => "{}".to_string(),
    };

    let file_part = reqwest::multipart::Part::bytes(compressed)
        .file_name(filename)
        .mime_str("application/zstd")
        .map_err(|e| format!("Multipart mime error: {}", e))?;

    let form = reqwest::multipart::Form::new()
        .text("world", world_id)
        .text("version", version.to_string())
        .text("size_bytes", compressed_size.to_string())
        .text("mods_manifest", manifest_str)
        .text("created_by", user_id)
        .part("file", file_part);

    let resp = client
        .post(&url)
        .header("Authorization", &token)
        .multipart(form)
        .send()
        .await
        .map_err(|e| format!("Upload network error: {}", e))?;

    let status = resp.status();
    let body_text = resp.text().await.unwrap_or_default();
    if !status.is_success() {
        return Err(format!("Upload failed ({}): {}", status, body_text));
    }

    // PocketBase devuelve el record creado. Necesitamos el id para futuros downloads.
    let record_id = serde_json::from_str::<Value>(&body_text)
        .ok()
        .and_then(|v| v.get("id").and_then(|i| i.as_str()).map(|s| s.to_string()))
        .unwrap_or_default();

    emit_progress(
        &window,
        UploadProgress {
            stage: "done".into(),
            percent: 100,
            bytes_done: compressed_size,
            bytes_total: compressed_size,
            message: "Listo".into(),
        },
    );

    Ok(UploadResult {
        record_id,
        size_bytes: compressed_size,
        original_size,
    })
}

#[derive(Debug, Serialize)]
pub struct DownloadResult {
    pub bytes_written: u64,
    pub backup_path: Option<String>,
    pub destination_path: String,
}

#[derive(Debug, Serialize, Clone)]
pub struct DownloadProgress {
    pub stage: String,
    pub percent: u8,
    pub bytes_done: u64,
    pub bytes_total: u64,
    pub message: String,
}

fn emit_download_progress(window: &Window, progress: DownloadProgress) {
    let _ = window.emit("download-progress", progress);
}

#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn download_save_from_cloud(
    window: Window,
    destination_path: String,
    pb_url: String,
    token: String,
    record_id: String,
    filename: String,
    backup_existing: bool,
    backup_dir: Option<String>,
    keep_backups: Option<u32>,
) -> Result<DownloadResult, String> {
    let dest = PathBuf::from(&destination_path);

    // Stage 0: backup existing destination if requested
    let mut backup_path: Option<String> = None;
    if backup_existing && dest.exists() {
        emit_download_progress(
            &window,
            DownloadProgress {
                stage: "backup".into(),
                percent: 5,
                bytes_done: 0,
                bytes_total: 0,
                message: "Respaldando save local...".into(),
            },
        );
        let backup_dir_path = match backup_dir {
            Some(d) => PathBuf::from(d),
            None => dest
                .parent()
                .map(|p| p.join("Backups"))
                .unwrap_or_else(|| PathBuf::from("Backups")),
        };
        std::fs::create_dir_all(&backup_dir_path)
            .map_err(|e| format!("Failed to create backup dir: {}", e))?;
        let timestamp = chrono::Local::now().format("%Y%m%d_%H%M%S");
        let stem = dest
            .file_stem()
            .map(|s| s.to_string_lossy().to_string())
            .unwrap_or_else(|| "save".into());
        let backup_name = format!("{}_local_{}.vcdbs.bak", stem, timestamp);
        let backup_full = backup_dir_path.join(&backup_name);
        std::fs::copy(&dest, &backup_full)
            .map_err(|e| format!("Failed to backup: {}", e))?;
        backup_path = Some(backup_full.to_string_lossy().to_string());

        // Retention: borrar copias viejas del mismo save base. El backup que
        // acabamos de crear es "<stem>_local_<ts>.vcdbs.bak" → base_name del
        // classify es "<stem>". keep=0 lo tratamos como deshabilitado.
        if let Some(keep) = keep_backups {
            if keep > 0 {
                let _ = crate::commands::backups::prune_old_backups(
                    backup_dir_path.to_string_lossy().to_string(),
                    stem,
                    "save".to_string(),
                    keep as usize,
                );
            }
        }
    }

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(1800))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;
    let base = pb_url.trim_end_matches('/');

    // Stage 0.5: el campo file de world_versions tiene protected=true. Hay que
    // pedir un fileToken de corta duracion y usarlo como ?token=... en el GET.
    let token_url = format!("{}/api/files/token", base);
    let token_resp = client
        .post(&token_url)
        .header("Authorization", &token)
        .send()
        .await
        .map_err(|e| format!("File token request failed: {}", e))?;
    if !token_resp.status().is_success() {
        let s = token_resp.status();
        let b = token_resp.text().await.unwrap_or_default();
        return Err(format!("File token error ({}): {}", s, b));
    }
    let token_body: Value = token_resp
        .json()
        .await
        .map_err(|e| format!("File token parse error: {}", e))?;
    let file_token = token_body
        .get("token")
        .and_then(|v| v.as_str())
        .ok_or("File token missing in response")?
        .to_string();

    // Stage 1: download from PocketBase files endpoint
    emit_download_progress(
        &window,
        DownloadProgress {
            stage: "downloading".into(),
            percent: 15,
            bytes_done: 0,
            bytes_total: 0,
            message: "Descargando del cloud...".into(),
        },
    );

    let url = format!(
        "{}/api/files/world_versions/{}/{}?token={}",
        base, record_id, filename, file_token
    );

    let resp = client
        .get(&url)
        .send()
        .await
        .map_err(|e| format!("Download network error: {}", e))?;

    if !resp.status().is_success() {
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        return Err(format!("Download failed ({}): {}", status, body));
    }

    let compressed = resp
        .bytes()
        .await
        .map_err(|e| format!("Failed to read response body: {}", e))?
        .to_vec();
    let compressed_size = compressed.len() as u64;

    // Stage 2+3 unificado: stream descompresion → archivo destino directo.
    // Antes: decode_all (todo el .vcdbs en RAM, ~500MB) + write_all.
    // Ahora: zstd Decoder lee del Vec comprimido, copy_to escribe streaming al
    // BufWriter del archivo. Pico de RAM: solo el comprimido (~200MB).
    // Si el frame trae checksum (uploads nuevos), zstd verifica integridad y
    // aborta el copy si los bytes no matchean.
    emit_download_progress(
        &window,
        DownloadProgress {
            stage: "decompressing".into(),
            percent: 60,
            bytes_done: 0,
            bytes_total: compressed_size,
            message: "Descomprimiendo...".into(),
        },
    );

    if let Some(parent) = dest.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create destination dir: {}", e))?;
    }

    // CRITICO: borrar archivos -wal y -shm huerfanos antes de escribir el
    // .vcdbs nuevo. SQLite usa -wal (write-ahead log) y -shm (shared memory)
    // junto al .vcdbs principal; si quedan huerfanos de una sesion anterior,
    // SQLite los combinara con el .vcdbs recien descargado y obtendremos
    // datos inconsistentes ("Invalid wire-type" al deserializar map regions).
    //
    // Best-effort: si no existen o no se pueden borrar, seguimos. El .vcdbs
    // ya subido tiene checkpoint hecho, asi que no faltan datos.
    for suffix in &["-wal", "-shm"] {
        let mut path = dest.as_os_str().to_os_string();
        path.push(suffix);
        let p = PathBuf::from(path);
        if p.exists() {
            if let Err(e) = std::fs::remove_file(&p) {
                eprintln!("[cloud] could not remove orphan {:?}: {}", p, e);
            }
        }
    }

    let dest_owned = dest.clone();
    let window_decomp = window.clone();
    let written = tauri::async_runtime::spawn_blocking(move || -> Result<u64, String> {
        let out_file = File::create(&dest_owned)
            .map_err(|e| format!("Failed to open destination file: {}", e))?;
        let mut writer = BufWriter::with_capacity(WRITE_CHUNK_BYTES, out_file);

        let cursor = std::io::Cursor::new(&compressed);
        let mut decoder = zstd::stream::read::Decoder::new(cursor)
            .map_err(|e| format!("zstd decoder init: {}", e))?;

        let mut buffer = vec![0u8; READ_CHUNK_BYTES];
        let mut total: u64 = 0;
        let mut last_emit: u64 = 0;

        loop {
            let n = decoder
                .read(&mut buffer)
                // Si el checksum falla, read() retorna error aca y abortamos sin
                // dejar un .vcdbs corrupto a medio escribir.
                .map_err(|e| format!("Decompression failed: {}", e))?;
            if n == 0 {
                break;
            }
            writer
                .write_all(&buffer[..n])
                .map_err(|e| format!("Failed to write file: {}", e))?;
            total += n as u64;

            if total - last_emit >= PROGRESS_EMIT_INTERVAL_BYTES {
                // 60-90% del progress global cubre decompress+write streaming.
                // Como no sabemos el tamano descomprimido a priori, usamos
                // bytes consumidos del comprimido para estimar (aproximacion).
                let pct = 60u8.saturating_add(((total / (10 * 1024 * 1024)).min(30)) as u8);
                emit_download_progress(
                    &window_decomp,
                    DownloadProgress {
                        stage: "decompressing".into(),
                        percent: pct,
                        bytes_done: total,
                        bytes_total: 0,
                        message: format!("Descomprimiendo... {} MiB", total / (1024 * 1024)),
                    },
                );
                last_emit = total;
            }
        }

        writer
            .flush()
            .map_err(|e| format!("Failed to flush file: {}", e))?;
        Ok(total)
    })
    .await
    .map_err(|e| format!("Decompress task failed: {}", e))??;

    emit_download_progress(
        &window,
        DownloadProgress {
            stage: "done".into(),
            percent: 100,
            bytes_done: written,
            bytes_total: written,
            message: "Listo".into(),
        },
    );

    Ok(DownloadResult {
        bytes_written: written,
        backup_path,
        destination_path: dest.to_string_lossy().to_string(),
    })
}
