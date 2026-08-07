import { useEffect, useRef } from "react";
import type { RecordModel } from "pocketbase";
import { pb } from "@/lib/pocketbase";

interface Options<T extends RecordModel = RecordModel> {
  collection: string;
  // Filtro server-side (sintaxis PocketBase). Si lo omitis recibis TODOS los
  // eventos de la coleccion accesibles segun las List/View Rules del schema.
  filter?: string;
  // Se invoca cada vez que llega un evento (con debounce). El caller decide
  // si refetchear todo o hacer un update granular leyendo `lastEvent.current`.
  onChange: () => void;
  // Callback opcional para inspeccionar el evento crudo (action + record).
  // Util si necesitas reaccionar especificamente a `delete` (ej. el grupo se
  // borro, redirigir a la lista). Se llama SIN debounce, sincronicamente.
  onEvent?: (event: { action: string; record: T }) => void;
  enabled?: boolean;
  // Coalesce ms para evitar tormenta de refetches si llegan varios eventos
  // seguidos (ej. acquire + cascade de updates). 300ms es buen default.
  debounceMs?: number;
}

// Wrapper sobre pb.collection(x).subscribe() con cleanup robusto:
// - Cancela la subscripcion si el componente se desmonta antes de que el SDK
//   resuelva el subscribe() (race condition comun con SSE).
// - Debouncea los refetches para no saturar al server cuando llegan varios
//   eventos seguidos.
// - Logea (no abortea) si el subscribe falla — la UI queda como "stale" en
//   lugar de romperse, y el refresh manual sigue funcionando.
export function usePbRealtimeRefetch<T extends RecordModel = RecordModel>({
  collection,
  filter,
  onChange,
  onEvent,
  enabled = true,
  debounceMs = 300,
}: Options<T>) {
  // Refs estables para que cambios en los callbacks no re-suscriban.
  const onChangeRef = useRef(onChange);
  const onEventRef = useRef(onEvent);
  onChangeRef.current = onChange;
  onEventRef.current = onEvent;

  useEffect(() => {
    if (!enabled) return;

    let cancelled = false;
    let unsubFn: (() => Promise<void>) | null = null;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const subscribeOpts = filter ? { filter } : undefined;

    pb.collection(collection)
      .subscribe(
        "*",
        (e) => {
          onEventRef.current?.({
            action: e.action,
            record: e.record as T,
          });
          if (timer) clearTimeout(timer);
          timer = setTimeout(() => onChangeRef.current(), debounceMs);
        },
        subscribeOpts
      )
      .then((fn) => {
        if (cancelled) {
          fn().catch(() => undefined);
        } else {
          unsubFn = fn;
        }
      })
      .catch((err) => {
        console.warn(
          `[realtime] subscribe(${collection}) failed:`,
          err instanceof Error ? err.message : err
        );
      });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      unsubFn?.().catch(() => undefined);
    };
  }, [collection, filter, enabled, debounceMs]);
}
