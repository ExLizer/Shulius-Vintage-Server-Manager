import { useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

interface Options {
  // Whether the guard is active. When false, close events pass through with
  // no interception. Tipically `serverRunning`.
  active: boolean;
  // Called when the user attempts to close the window while `active` is true.
  // The hook prevents the default close and invokes this callback so the
  // consumer can show a dialog.
  onIntercept: () => void;
}

/**
 * Intercepts the window close event (X button, Alt+F4, etc.) so the app can
 * present a "save before closing" prompt while a server is running.
 *
 * To allow the close after the user confirms, call the returned `allowClose`
 * function before triggering `getCurrentWindow().close()`. The next close
 * event will pass through unintercepted.
 */
export function useCloseGuard({ active, onIntercept }: Options) {
  // Refs avoid re-subscribing every time the props change. The listener
  // captures fresh values via ref reads.
  const activeRef = useRef(active);
  activeRef.current = active;

  const onInterceptRef = useRef(onIntercept);
  onInterceptRef.current = onIntercept;

  // Set to true right before we ask Tauri to close, so the listener lets the
  // request through. Reset after.
  const bypassRef = useRef(false);

  useEffect(() => {
    let unlistenFn: (() => void) | null = null;
    let cancelled = false;

    getCurrentWindow()
      .onCloseRequested((event) => {
        if (bypassRef.current) {
          // We initiated this close intentionally — let it through.
          return;
        }
        if (!activeRef.current) return;
        event.preventDefault();
        onInterceptRef.current();
      })
      .then((fn) => {
        if (cancelled) fn();
        else unlistenFn = fn;
      })
      .catch((e) => {
        console.warn("[closeGuard] failed to attach listener", e);
      });

    return () => {
      cancelled = true;
      unlistenFn?.();
    };
  }, []);

  return {
    allowClose: async () => {
      bypassRef.current = true;
      try {
        await getCurrentWindow().close();
      } catch (e) {
        bypassRef.current = false;
        throw e;
      }
    },
  };
}
