import { useCallback, useEffect, useState } from "react";
import { check, type Update } from "@tauri-apps/plugin-updater";

const LAST_CHECK_KEY = "vssm.lastUpdateCheck";
const DISMISSED_KEY = "vssm.updateDismissedVersion";
const AUTOCHECK_KEY = "vssm.autoCheckUpdates";
const STARTUP_DELAY_MS = 8_000;

export interface AutoUpdateState {
  update: Update | null;
  // Marks the currently-known update as dismissed so it won't be re-presented
  // until a NEWER version becomes available.
  dismiss: () => void;
}

/**
 * Auto-checks for updates once at app startup (with a small delay so the UI
 * settles first) and exposes the discovered update via state. The check is
 * skipped if the user disabled it from the Settings → Updates toggle.
 *
 * Design notes:
 *  - We no longer enforce a 6h gate between startup checks. A single GET to
 *    the GitHub releases endpoint per launch is cheap, and the previous gate
 *    meant a user who dismissed an update yesterday wouldn't see a NEWER one
 *    today.
 *  - Dismissals are recorded per VERSION, not as a timestamp. So once a user
 *    closes the banner for 0.2.4 it stays closed, but the banner reappears
 *    when 0.2.5 is published.
 *  - The hook does NOT install or show a toast; it only surfaces the state.
 *    Rendering (banner, settings card) is the consumer's responsibility.
 */
export function useAutoUpdateCheck(): AutoUpdateState {
  const [update, setUpdate] = useState<Update | null>(null);

  useEffect(() => {
    const pref = window.localStorage.getItem(AUTOCHECK_KEY);
    const enabled = pref === null ? true : pref === "1";
    if (!enabled) return;

    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const result = await check();
        window.localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
        if (cancelled || !result) return;

        const dismissed = window.localStorage.getItem(DISMISSED_KEY);
        if (dismissed && dismissed === result.version) {
          // User already chose to ignore this exact version.
          result.close().catch(() => undefined);
          return;
        }

        setUpdate(result);
      } catch (e) {
        console.warn("[updater] auto-check failed:", e);
      }
    }, STARTUP_DELAY_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);

  // Close the underlying Update handle when the consumer unmounts or the state
  // gets cleared, so we don't leak the temp file handle the plugin keeps.
  useEffect(() => {
    return () => {
      update?.close().catch(() => undefined);
    };
  }, [update]);

  const dismiss = useCallback(() => {
    if (update) {
      window.localStorage.setItem(DISMISSED_KEY, update.version);
    }
    setUpdate(null);
  }, [update]);

  return { update, dismiss };
}
