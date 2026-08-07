import { useEffect, useState } from "react";
import * as tauri from "@/lib/tauri";

interface Options {
  serverRunning: boolean;
  // 0 disables the scheduler.
  intervalMinutes: number;
}

/**
 * Sends `/autosavenow` to the running VS server every N minutes. Lives at the
 * App level so it keeps firing even when the user navigates away from the
 * Server view (same lesson as the group lock heartbeat).
 *
 * Returns the timestamp (epoch ms) of the next scheduled fire, or null when
 * the scheduler is inactive. UI consumers use this to render a countdown.
 */
export function useServerAutosave({ serverRunning, intervalMinutes }: Options): {
  nextFireAt: number | null;
} {
  const [nextFireAt, setNextFireAt] = useState<number | null>(null);

  useEffect(() => {
    if (!serverRunning || intervalMinutes <= 0) {
      setNextFireAt(null);
      return;
    }

    const periodMs = intervalMinutes * 60_000;
    let cancelled = false;
    setNextFireAt(Date.now() + periodMs);

    const fire = async () => {
      try {
        await tauri.sendCommand("/autosavenow");
      } catch (e) {
        // VS rejected the command (probably not fully booted yet). Log and
        // keep trying on next tick — don't surface a toast every cycle.
        console.warn("[autosave] sendCommand failed:", e);
      }
      if (!cancelled) setNextFireAt(Date.now() + periodMs);
    };

    const id = setInterval(fire, periodMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [serverRunning, intervalMinutes]);

  return { nextFireAt };
}
