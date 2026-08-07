use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Serialize, Clone)]
pub struct BackupEntry {
    pub file_path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub modified_unix: i64,
    // "save" para .vcdbs.bak / .vcdbs, "mod" para zips de mods backupeados,
    // "other" para cualquier cosa rara que aparezca en la carpeta.
    pub kind: String,
    // Nombre base agrupador. Para saves es el nombre del mundo
    // (ej. "MUCHACHOS_local_20260520_012530.vcdbs.bak" → "MUCHACHOS").
    // Para mods es el nombre del archivo sin la fecha
    // (ej. "20260520_003718_BloodTrail-v1.2.0.zip" → "BloodTrail-v1.2.0.zip").
    pub base_name: String,
    // True si el archivo "original" al que apunta este backup ya no existe.
    // Para saves: el .vcdbs en saves_dir/<base_name>.vcdbs. Para mods siempre
    // false (los mods rotan demasiado para que orphan tenga sentido).
    pub orphan: bool,
}

fn classify(file_name: &str) -> (String, String) {
    let lower = file_name.to_lowercase();

    // Backup de save creado por download_save_from_cloud:
    //   <savename>_local_<YYYYMMDD_HHMMSS>.vcdbs.bak
    if lower.ends_with(".vcdbs.bak") {
        let stem = file_name
            .strip_suffix(".vcdbs.bak")
            .unwrap_or(file_name)
            .to_string();
        // Quitar "_local_<timestamp>" del final si esta.
        let base = if let Some(idx) = stem.rfind("_local_") {
            stem[..idx].to_string()
        } else {
            // Fallback: cortar antes del ultimo "_<8-digitos>_<6-digitos>"
            strip_trailing_timestamp(&stem)
        };
        return ("save".into(), base);
    }

    // Backup de save creado por backup_save (boton manual):
    //   <savename>_<YYYYMMDD_HHMMSS>.vcdbs
    if lower.ends_with(".vcdbs") {
        let stem = file_name.strip_suffix(".vcdbs").unwrap_or(file_name);
        let base = strip_trailing_timestamp(stem);
        return ("save".into(), base);
    }

    // Backup de mod (delete_mod / import_modpack):
    //   <YYYYMMDD_HHMMSS>_<originalfilename>
    // Lo detectamos por el prefijo de 8 digitos + "_" + 6 digitos + "_".
    if let Some(rest) = strip_leading_timestamp(file_name) {
        return ("mod".into(), rest.to_string());
    }

    ("other".into(), file_name.to_string())
}

// Quita un sufijo "_YYYYMMDD_HHMMSS" si esta presente al final del nombre.
fn strip_trailing_timestamp(s: &str) -> String {
    // Patron: "_" + 8 digitos + "_" + 6 digitos. 16 chars + 2 underscores = 17.
    if s.len() < 17 {
        return s.to_string();
    }
    let tail = &s[s.len() - 17..];
    let bytes = tail.as_bytes();
    if bytes[0] == b'_'
        && bytes[9] == b'_'
        && bytes[1..9].iter().all(|b| b.is_ascii_digit())
        && bytes[10..17].iter().all(|b| b.is_ascii_digit())
    {
        return s[..s.len() - 17].to_string();
    }
    s.to_string()
}

// Quita un prefijo "YYYYMMDD_HHMMSS_" si esta presente. Devuelve el resto.
fn strip_leading_timestamp(s: &str) -> Option<&str> {
    if s.len() < 16 {
        return None;
    }
    let head = &s[..16];
    let bytes = head.as_bytes();
    if bytes[8] == b'_'
        && bytes[15] == b'_'
        && bytes[0..8].iter().all(|b| b.is_ascii_digit())
        && bytes[9..15].iter().all(|b| b.is_ascii_digit())
    {
        return Some(&s[16..]);
    }
    None
}

#[tauri::command]
pub fn list_backups(
    backup_dir: String,
    saves_dir: Option<String>,
) -> Result<Vec<BackupEntry>, String> {
    let dir = Path::new(&backup_dir);
    if !dir.exists() {
        return Ok(Vec::new());
    }

    let saves_dir_path = saves_dir.as_ref().map(PathBuf::from);

    let mut entries = Vec::new();
    let read = fs::read_dir(dir).map_err(|e| format!("read_dir: {}", e))?;
    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let metadata = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let file_name = match path.file_name().map(|s| s.to_string_lossy().to_string()) {
            Some(n) => n,
            None => continue,
        };
        let modified_unix = metadata
            .modified()
            .ok()
            .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs() as i64)
            .unwrap_or(0);

        let (kind, base_name) = classify(&file_name);

        // Solo chequeamos huerfanos para saves: el original seria
        // <saves_dir>/<base_name>.vcdbs. Para mods el archivo "original" no
        // se sabe (puede haber sido reemplazado por otra version, eso no es
        // huerfano).
        let orphan = if kind == "save" {
            match &saves_dir_path {
                Some(sd) => !sd.join(format!("{}.vcdbs", base_name)).exists(),
                None => false,
            }
        } else {
            false
        };

        entries.push(BackupEntry {
            file_path: path.to_string_lossy().to_string(),
            file_name,
            size_bytes: metadata.len(),
            modified_unix,
            kind,
            base_name,
            orphan,
        });
    }

    // Ordenar por modified desc (mas reciente primero).
    entries.sort_by(|a, b| b.modified_unix.cmp(&a.modified_unix));

    Ok(entries)
}

#[tauri::command]
pub fn delete_backups(paths: Vec<String>) -> Result<u64, String> {
    let mut bytes_freed: u64 = 0;
    let mut errors: Vec<String> = Vec::new();
    for p in &paths {
        let path = Path::new(p);
        if !path.exists() {
            continue;
        }
        let size = fs::metadata(path).map(|m| m.len()).unwrap_or(0);
        match fs::remove_file(path) {
            Ok(_) => bytes_freed += size,
            Err(e) => errors.push(format!("{}: {}", p, e)),
        }
    }
    if !errors.is_empty() {
        return Err(errors.join("; "));
    }
    Ok(bytes_freed)
}

// Mantiene los `keep` mas recientes de los archivos cuyo `base_name` (segun
// classify) matchea `base_name` y cuyo `kind` matchea. Borra el resto.
// Devuelve la cantidad de bytes liberados.
//
// Se invoca despues de crear un backup nuevo (en saves.rs y cloud.rs) para
// que el directorio no crezca indefinidamente.
#[tauri::command]
pub fn prune_old_backups(
    backup_dir: String,
    base_name: String,
    kind: String,
    keep: usize,
) -> Result<u64, String> {
    let dir = Path::new(&backup_dir);
    if !dir.exists() || keep == 0 {
        // keep=0 no es valido — interpretarlo como "no prune" antes que
        // borrar todo accidentalmente.
        return Ok(0);
    }

    let read = fs::read_dir(dir).map_err(|e| format!("read_dir: {}", e))?;
    let mut candidates: Vec<(PathBuf, std::time::SystemTime, u64)> = Vec::new();
    for entry in read.flatten() {
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = match path.file_name().map(|s| s.to_string_lossy().to_string()) {
            Some(n) => n,
            None => continue,
        };
        let (k, b) = classify(&file_name);
        if k != kind || b != base_name {
            continue;
        }
        let md = match fs::metadata(&path) {
            Ok(m) => m,
            Err(_) => continue,
        };
        let modified = md.modified().unwrap_or(std::time::UNIX_EPOCH);
        candidates.push((path, modified, md.len()));
    }

    if candidates.len() <= keep {
        return Ok(0);
    }

    // Ordenar por mtime desc — los keep primeros se conservan, el resto se
    // borra.
    candidates.sort_by(|a, b| b.1.cmp(&a.1));
    let mut bytes_freed: u64 = 0;
    for (path, _, size) in candidates.into_iter().skip(keep) {
        if fs::remove_file(&path).is_ok() {
            bytes_freed += size;
        }
    }
    Ok(bytes_freed)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classify_save_local_bak() {
        let (k, b) = classify("MUCHACHOS_local_20260520_012530.vcdbs.bak");
        assert_eq!(k, "save");
        assert_eq!(b, "MUCHACHOS");
    }

    #[test]
    fn classify_save_vcdbs() {
        let (k, b) = classify("Los_Muchachos_20260520_014414.vcdbs");
        assert_eq!(k, "save");
        assert_eq!(b, "Los_Muchachos");
    }

    #[test]
    fn classify_mod_backup() {
        let (k, b) = classify("20260520_003718_BloodTrail-v1.2.0.zip");
        assert_eq!(k, "mod");
        assert_eq!(b, "BloodTrail-v1.2.0.zip");
    }

    #[test]
    fn classify_unknown() {
        let (k, b) = classify("random.txt");
        assert_eq!(k, "other");
        assert_eq!(b, "random.txt");
    }
}
