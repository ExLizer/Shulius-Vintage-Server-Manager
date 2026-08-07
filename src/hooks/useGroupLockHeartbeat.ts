import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { rpc } from "@/lib/pocketbase";
import { useAuth } from "@/hooks/useAuth";

interface Options {
  // True while the local server process is running. The heartbeat only runs
  // while this is true.
  serverRunning: boolean;
  // The world id this profile is linked to. Null if profile is local-only.
  linkedWorldId: string | null | undefined;
}

const FIVE_MIN_MS = 5 * 60 * 1000;
const LOCK_TTL_MIN = 15;

/**
 * Keeps the PocketBase world lock alive while a grouped server is running.
 *
 * Why this hook exists (and lives at App level, not in ServerView):
 * the lock has a 15-minute TTL on the server. If the user starts the server
 * and then navigates to any other view (Mods, Settings, Backups...), the
 * ServerView component unmounts. If the heartbeat lived there, the interval
 * would be cleared on unmount, the lock would expire after 15 minutes, and
 * other group members would see "Tomar control" as available even though
 * the server is still actually running locally.
 *
 * Mounting this hook at the App level ensures the heartbeat survives any
 * view change. It self-disables when the server is not running or when there
 * is no linked group world.
 */
export function useGroupLockHeartbeat({ serverRunning, linkedWorldId }: Options) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const lastErrorAtRef = useRef<number>(0);

  useEffect(() => {
    if (!serverRunning || !linkedWorldId || !session) return;

    const heartbeat = async () => {
      try {
        await rpc.acquireWorldLock(linkedWorldId, LOCK_TTL_MIN);
        lastErrorAtRef.current = 0;
      } catch (e) {
        const err = e as { status?: number };
        if (err?.status === 409) {
          console.warn("[heartbeat] lost lock");
          toast.error(t("server.lockLost"));
          return;
        }
        console.error("[heartbeat]", e);
        const now = Date.now();
        if (now - lastErrorAtRef.current > FIVE_MIN_MS) {
          lastErrorAtRef.current = now;
          toast.error(t("server.heartbeatFailed"), { duration: 6000 });
        }
      }
    };

    // Fire one immediately on mount (covers the case where ServerView has
    // already been alive long enough that the previous interval was about to
    // tick, AND the case where the server start flow took >10min so the
    // initial 15min lock from handleStart is close to expiring).
    void heartbeat();

    const interval = setInterval(heartbeat, FIVE_MIN_MS);
    return () => clearInterval(interval);
  }, [serverRunning, linkedWorldId, session, t]);
}
