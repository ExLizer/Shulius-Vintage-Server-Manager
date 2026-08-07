import { useEffect, useState } from "react";
import { toast } from "sonner";
import * as tauri from "@/lib/tauri";

interface Options {
  serverRunning: boolean;
  // 0 disables the scheduler.
  intervalMinutes: number;
  dataPath: string;
  backupDir: string;
  keepBackups: number;
}

/**
 * Periodically copies the live world save to the backup folder while the
 * server runs. Respects the keep_backups retention setting (rotates olds
 * out via the existing prune logic in tauri.backupSave).
 *
 * Source of truth for the .vcdbs path is serverconfig.json's SaveFileLocation
 * — we read it each tick so renames / world switches mid-session are picked
 * up automatically.
 */
export function useServerAutobackup({
  serverRunning,
  intervalMinutes,
  dataPath,
  backupDir,
  keepBackups,
}: Options): { nextFireAt: number | null } {
  const [nextFireAt, setNextFireAt] = useState<number | null>(null);

  useEffect(() => {
    if (!serverRunning || intervalMinutes <= 0 || !dataPath || !backupDir) {
      setNextFireAt(null);
      return;
    }

    const periodMs = intervalMinutes * 60_000;
    let cancelled = false;
    setNextFireAt(Date.now() + periodMs);

    const fire = async () => {
      try {
        const configPath = `${dataPath}\\serverconfig.json`;
        const rawSaveLoc = await tauri.readServerConfig(configPath);
        if (!rawSaveLoc) {
          console.warn("[autobackup] no SaveFileLocation in serverconfig.json");
          return;
        }

        // SaveFileLocation can be absolute or relative (relative is to data_path).
        let savePath = rawSaveLoc.replace(/\//g, "\\");
        if (!/^[a-zA-Z]:\\/.test(savePath)) {
          savePath = `${dataPath}\\${savePath}`;
        }

        await tauri.backupSave(savePath, backupDir, keepBackups);
      } catch (e) {
        console.warn("[autobackup] failed:", e);
        toast.error(`Auto-backup falló: ${e}`, { duration: 6000 });
      } finally {
        if (!cancelled) setNextFireAt(Date.now() + periodMs);
      }
    };

    const id = setInterval(fire, periodMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [serverRunning, intervalMinutes, dataPath, backupDir, keepBackups]);

  return { nextFireAt };
}
