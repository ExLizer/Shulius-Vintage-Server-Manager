import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useTranslation } from "react-i18next";
import {
  Play,
  Square,
  RotateCcw,
  Send,
  Save,
  Megaphone,
  MoreHorizontal,
  Activity,
  Cpu,
  MemoryStick,
  HardDrive,
  Wifi,
  Users,
  Globe,
  ChevronRight,
  Clock,
  Zap,
  CalendarClock,
  Terminal as TerminalIcon,
  Cloud,
  AlertTriangle,
  Lock,
} from "lucide-react";
import { LineChart, Line, ResponsiveContainer, Area, AreaChart } from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { HoverHint } from "@/components/ui/hover-hint";
import { performServerStop } from "@/lib/server-stop";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Settings, ServerStatus, PlayerInfo, ProcessMetrics, SaveInfo, ServerProfile } from "@/lib/types";
import * as tauri from "@/lib/tauri";
import { toast } from "sonner";
import { StopProgressIndicator } from "./StopProgressIndicator";
import { GroupFlowIndicator, type GroupFlow } from "./GroupFlowIndicator";
import { pb, rpc, getErrorMessage, requirePbUrl, type World, type WorldVersion } from "@/lib/pocketbase";
import { useAuth } from "@/hooks/useAuth";
import { usePbRealtimeRefetch } from "@/hooks/usePbRealtimeRefetch";
import { verifyMods, type ModVerificationResult, type ModsManifest } from "@/lib/mods-verify";
import { ModsVerifyDialog, type ModsVerifyChoice } from "./ModsVerifyDialog";

interface ServerViewProps {
  settings: Settings;
  serverStatus: ServerStatus;
  onStatusChange: () => void;
  metricsHistory: ProcessMetrics[];
  activeProfile: ServerProfile | null;
  onProfilesChange?: () => void;
  nextAutosaveAt: number | null;
  nextAutobackupAt: number | null;
  onUpdateScheduling: (kind: 'autosave' | 'autobackup', minutes: number) => Promise<void>;
}

type ConsoleLine = {
  raw: string;
  level: 'info' | 'warn' | 'err' | 'cmd' | 'plain';
};

function classifyLog(line: string): ConsoleLine {
  if (line.startsWith('[ERR]') || /\b(ERROR|EXCEPTION)\b/i.test(line)) {
    return { raw: line, level: 'err' };
  }
  if (line.startsWith('[WARN]') || /\bWARN(ING)?\b/i.test(line)) {
    return { raw: line, level: 'warn' };
  }
  if (line.startsWith('[INFO]') || /\bINFO\b/i.test(line)) {
    return { raw: line, level: 'info' };
  }
  if (line.startsWith('>')) {
    return { raw: line, level: 'cmd' };
  }
  return { raw: line, level: 'plain' };
}

function formatUptime(ms: number): string {
  if (ms <= 0) return '—';
  const totalSeconds = Math.floor(ms / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

function formatBytes(mb: number): string {
  if (mb >= 1024) return `${(mb / 1024).toFixed(2)} GB`;
  return `${mb.toFixed(0)} MB`;
}

type LinkedWorldSnapshot = {
  name: string;
  current_version: number;
  current_holder: string | null;
  lock_expires_at: string | null;
  holderName: string | null;
};

export function ServerView({
  settings,
  serverStatus,
  onStatusChange,
  metricsHistory,
  activeProfile,
  onProfilesChange,
  nextAutosaveAt,
  nextAutobackupAt,
  onUpdateScheduling,
}: ServerViewProps) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [loading, setLoading] = useState(false);
  const [groupFlow, setGroupFlow] = useState<GroupFlow | null>(null);
  const [groupStageId, setGroupStageId] = useState<string | null>(null);
  // Setter unificado: asigna el flow y el stage en una sola llamada (evita olvidos).
  const setGroupStage = (flow: GroupFlow | null, stageId: string | null) => {
    setGroupFlow(flow);
    setGroupStageId(stageId);
  };
  const [verifyContext, setVerifyContext] = useState<{
    result: ModVerificationResult;
    resolve: (choice: ModsVerifyChoice) => void;
  } | null>(null);
  const [isStopping, setIsStopping] = useState(false);
  const [command, setCommand] = useState('');
  const [players, setPlayers] = useState<PlayerInfo[]>([]);
  const [logs, setLogs] = useState<string[]>([]);
  const [worlds, setWorlds] = useState<SaveInfo[]>([]);
  const [activeWorld, setActiveWorld] = useState<string | null>(null);
  const [uptimeMs, setUptimeMs] = useState(0);
  const [showBroadcast, setShowBroadcast] = useState(false);
  const [broadcastMsg, setBroadcastMsg] = useState('');
  const [showMore, setShowMore] = useState(false);
  const [playerJoinTimes, setPlayerJoinTimes] = useState<Record<string, number>>({});

  const logsEndRef = useRef<HTMLDivElement>(null);
  const startedAtRef = useRef<number | null>(null);

  const latestMetrics = metricsHistory.length > 0 ? metricsHistory[metricsHistory.length - 1] : null;

  // Uptime tracker
  useEffect(() => {
    if (serverStatus.running) {
      if (startedAtRef.current === null) {
        startedAtRef.current = Date.now();
      }
      const interval = setInterval(() => {
        if (startedAtRef.current !== null) {
          setUptimeMs(Date.now() - startedAtRef.current);
        }
      }, 1000);
      return () => clearInterval(interval);
    } else {
      startedAtRef.current = null;
      setUptimeMs(0);
    }
  }, [serverStatus.running]);

  // Players + logs polling
  useEffect(() => {
    if (!serverStatus.running) {
      setPlayers([]);
      setLogs([]);
      setPlayerJoinTimes({});
      return;
    }

    const tick = async () => {
      try {
        const [online, serverLogs] = await Promise.all([
          tauri.getOnlinePlayers(),
          tauri.getServerLogs(),
        ]);
        setPlayers(online);
        setLogs(serverLogs);
        // Track player join times for "X min ago" in panel
        setPlayerJoinTimes((prev) => {
          const next = { ...prev };
          const now = Date.now();
          const onlineNames = new Set(online.map((p) => p.name));
          for (const p of online) {
            if (next[p.name] === undefined) next[p.name] = now;
          }
          for (const k of Object.keys(next)) {
            if (!onlineNames.has(k)) delete next[k];
          }
          return next;
        });
      } catch (e) {
        console.error('Polling error:', e);
      }
    };

    tick();
    const interval = setInterval(tick, 3000);
    return () => clearInterval(interval);
  }, [serverStatus.running]);

  // Worlds/saves
  useEffect(() => {
    const loadWorlds = async () => {
      if (!settings.data_path) {
        setWorlds([]);
        return;
      }
      try {
        const list = await tauri.listSaves(`${settings.data_path}\\Saves`);
        setWorlds(list);
        // tauri.readServerConfig returns just the SaveFileLocation path string
        // (NOT the whole JSON). Just split off the filename.
        const cfg = await tauri.readServerConfig(`${settings.data_path}\\serverconfig.json`);
        if (cfg) {
          const fname = cfg.split(/[/\\]/).pop() ?? '';
          if (fname) {
            setActiveWorld(fname);
          }
        }
      } catch {
        // Ignore — paths may not be configured yet
      }
    };
    loadWorlds();
  }, [settings.data_path, serverStatus.running]);

  // Auto-scroll del log: scrollIntoView() walks UP en el DOM y scrollea TODOS
  // los containers padres — incluyendo el body/main, que pisa el scroll del
  // usuario cuando esta leyendo otra parte de la pagina y aparece un log nuevo.
  // En vez de eso, scrolleamos SOLO el viewport interno del Radix ScrollArea
  // y nada mas. Ademas, solo lo hacemos si el usuario ya estaba pegado al
  // fondo (within 80px) — si scrollea para arriba a leer logs viejos, no lo
  // yankeamos de vuelta abajo cada vez que aparece una linea.
  useEffect(() => {
    const sentinel = logsEndRef.current;
    if (!sentinel) return;
    const viewport = sentinel.closest('[data-radix-scroll-area-viewport]') as HTMLElement | null;
    if (!viewport) return;
    const distanceFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
    if (distanceFromBottom < 80) {
      viewport.scrollTop = viewport.scrollHeight;
    }
  }, [logs]);

  // NOTE: el heartbeat del lock vivia aca antes. Se movio a App.tsx via
  // useGroupLockHeartbeat para que sobreviva navegacion entre views.
  // Si vive en este componente, navegar a otra pestaña desmonta ServerView
  // y el lock se pierde en 15 min, dejando que otro miembro tome control.

  // Actions
  const handleStart = async () => {
    if (!settings.server_exe_path) {
      toast.error(t('server.configurePathFirst'));
      return;
    }

    const linkedWorldId = activeProfile?.linked_group_world_id ?? null;

    // Local mode (default behavior, profile is not linked to a group world)
    if (!linkedWorldId) {
      setLoading(true);
      try {
        await tauri.startServer(settings.server_exe_path, settings.data_path);
        toast.success(t('server.started'));
        onStatusChange();
      } catch (e) {
        toast.error(`${t('common.error')}: ${e}`);
      } finally {
        setLoading(false);
      }
      return;
    }

    // Group mode flow
    if (!session) {
      toast.error(t('server.groupNotLoggedIn'));
      return;
    }

    setLoading(true);

    try {
      // 0) Pre-flight: verify mods against latest version's manifest BEFORE acquiring lock.
      // This way, if the user cancels, no lock is held.
      setGroupStage('start', 'verifyingMods');
      let latestVer: WorldVersion | null = null;
      try {
        latestVer = await pb.collection('world_versions').getFirstListItem<WorldVersion>(
          `world = "${linkedWorldId}"`,
          { sort: '-version', fields: 'id,version,mods_manifest' }
        );
      } catch (e) {
        // PB devuelve 404 si no hay versiones todavia. No es error real.
        const err = e as { status?: number };
        if (err?.status !== 404) throw e;
      }

      if (latestVer && latestVer.mods_manifest) {
        const manifest = latestVer.mods_manifest as ModsManifest;
        const installed = await tauri
          .listInstalledMods(`${settings.data_path}\\Mods`)
          .catch(() => []);
        const verification = verifyMods(installed, manifest);

        if (!verification.match) {
          // show dialog and wait for user choice
          const choice = await new Promise<ModsVerifyChoice>((resolve) => {
            setVerifyContext({ result: verification, resolve });
          });
          setVerifyContext(null);

          if (choice === 'cancel') {
            setLoading(false);
            setGroupStage(null, null);
            return;
          }
          // choice === 'continue' o 'fixed' → seguimos con el flujo
        }
      }

      // 1) Fetch world metadata FIRST. PB rules: si el user no es miembro o el
      // mundo fue borrado, esto tira 404. Hacerlo ANTES del lock evita racear
      // por un mundo inaccesible/muerto.
      setGroupStage('start', 'fetchingVersion');
      let world: World;
      try {
        world = await pb.collection('worlds').getOne<World>(linkedWorldId, {
          fields: 'id,name,current_version',
        });
      } catch (e) {
        const err = e as { status?: number };
        if (err?.status === 404) {
          // El mundo fue borrado por un admin O perdiste el acceso al grupo.
          // Auto-unlink el profile asi el proximo Start funciona como local.
          if (activeProfile?.id) {
            try {
              await tauri.linkProfileToWorld(activeProfile.id, null);
              onProfilesChange?.();
            } catch (e2) {
              console.warn('[group] could not auto-unlink profile', e2);
            }
          }
          throw new Error(t('server.groupWorldGone'));
        }
        throw e;
      }

      // 2) Acquire lock now that we know the world exists and we have access.
      setGroupStage('start', 'acquiringLock');
      try {
        await rpc.acquireWorldLock(linkedWorldId, 15);
      } catch (e) {
        const err = e as { status?: number };
        if (err?.status === 409) {
          toast.error(t('server.groupLockHeld'));
          setLoading(false);
          setGroupStage(null, null);
          return;
        }
        throw e;
      }

      if (world.current_version === 0) {
        // No save uploaded yet, skip download and start blank.
        // Importante: igual hay que apuntar serverconfig.json a <safeName>.vcdbs
        // para que VS genere el mundo con ese nombre. Sin esto, VS reusaria el
        // SaveFileLocation previo y al hacer stop no encontrariamos el archivo.
        const safeName = world.name.replace(/[^a-zA-Z0-9_-]/g, '_');
        const destFilename = `${safeName}.vcdbs`;
        const destPath = `${settings.data_path}\\Saves\\${destFilename}`;
        const configPath = `${settings.data_path}\\serverconfig.json`;
        await tauri.setActiveWorld(configPath, destPath);

        // Register in profile so SavesView etiqueta el save como group save
        if (activeProfile?.id) {
          try {
            await tauri.registerGroupSave(activeProfile.id, {
              world_id: world.id,
              world_name: world.name,
              filename: destFilename,
            });
            onProfilesChange?.();
          } catch (e) {
            console.warn('[group] could not register save in profile', e);
          }
        }

        toast.message(t('server.groupNoSaveYet'));
        setGroupStage('start', 'starting');
        await tauri.startServer(settings.server_exe_path, settings.data_path);
        toast.success(t('server.started'));
        onStatusChange();
        return;
      }

      // 3) Buscar el record world_versions REAL mas reciente del mundo. Antes
      // filtrabamos por `version = world.current_version`, pero current_version
      // lo bumpea un hook async y puede quedar desfasado del MAX real si el
      // hook fallo en algun upload anterior — el sintoma es que arrancas el
      // server y aparece un save mas viejo del esperado. Ordenar por -version
      // y limitar a 1 da la version mas alta existente, que es siempre la
      // correcta (los uploads son atomicos: o entran completos o no entran).
      setGroupStage('start', 'downloading');
      const latestRecord = await pb.collection('world_versions').getFirstListItem<WorldVersion>(
        `world = "${world.id}"`,
        { fields: 'id,version,file', sort: '-version' }
      );

      const safeName = world.name.replace(/[^a-zA-Z0-9_-]/g, '_');
      const destFilename = `${safeName}.vcdbs`;
      const destPath = `${settings.data_path}\\Saves\\${destFilename}`;
      const token = pb.authStore.token;
      if (!token) throw new Error('Not authenticated');
      const dl = await tauri.downloadSaveFromCloud({
        destinationPath: destPath,
        pbUrl: requirePbUrl(),
        token,
        recordId: latestRecord.id,
        filename: latestRecord.file,
        backupExisting: true,
        backupDir: settings.backup_dir || undefined,
        keepBackups: settings.keep_backups,
      });
      if (dl.backup_path) {
        console.log('[group] backup created at', dl.backup_path);
      }

      // 3.5) Register this save in the profile so SavesView can label it as a group save
      if (activeProfile?.id) {
        try {
          await tauri.registerGroupSave(activeProfile.id, {
            world_id: world.id,
            world_name: world.name,
            filename: destFilename,
          });
          onProfilesChange?.();
        } catch (e) {
          console.warn('[group] could not register save in profile', e);
        }
      }

      // 4) Update serverconfig.json to point to the downloaded save
      setGroupStage('start', 'settingActive');
      const configPath = `${settings.data_path}\\serverconfig.json`;
      await tauri.setActiveWorld(configPath, destPath);

      // 5) Start the actual server
      setGroupStage('start', 'starting');
      await tauri.startServer(settings.server_exe_path, settings.data_path);
      toast.success(t('server.startedGroup', { world: world.name }));
      onStatusChange();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
      setGroupStage(null, null);
    }
  };

  const handleStop = async () => {
    setLoading(true);
    setIsStopping(true);

    const result = await performServerStop(
      {
        settings,
        activeProfile,
        session,
        onStatusChange,
        onProfilesChange,
      },
      {
        onStage: (stage) => {
          if (stage) setGroupStage('stop', stage);
          else setGroupStage(null, null);
        },
      }
    );

    // Local-mode success keeps isStopping=true so the StopProgressIndicator
    // can finish its animation; it'll call handleStopComplete itself. Every
    // other path resets isStopping immediately.
    switch (result.kind) {
      case 'localSuccess':
        toast.success(t('server.stopped'));
        // intentionally NOT resetting isStopping — indicator handles it
        break;
      case 'groupSuccess':
        toast.success(t('server.stoppedGroup', { world: result.worldName }));
        setIsStopping(false);
        break;
      case 'groupSessionExpiredFallback':
        toast.warning(t('server.groupSessionExpiredFallback'), { duration: 8000 });
        setIsStopping(false);
        break;
      case 'groupNoSaveFound':
        toast.error(t('server.groupNoSaveGenerated'));
        setIsStopping(false);
        break;
      case 'failed':
        toast.error(result.error);
        setIsStopping(false);
        break;
    }

    setLoading(false);
  };

  const handleStopComplete = () => setIsStopping(false);

  const handleRestart = async () => {
    // Group mode: full stop (upload + release) then full start (acquire + download)
    // Each one manages its own loading/stage state.
    if (activeProfile?.linked_group_world_id) {
      await handleStop();
      // Pequeno respiro para que el estado se asiente antes de re-arrancar
      await new Promise((r) => setTimeout(r, 1500));
      await handleStart();
      return;
    }

    // Local mode (current behavior)
    setLoading(true);
    try {
      await tauri.stopServer();
      await new Promise((r) => setTimeout(r, 2000));
      await tauri.startServer(settings.server_exe_path, settings.data_path);
      toast.success(t('server.restarted'));
      onStatusChange();
    } catch (e) {
      toast.error(`${t('common.error')}: ${e}`);
    } finally {
      setLoading(false);
    }
  };

  const handleQuickSave = async () => {
    try {
      await tauri.sendCommand('/autosavenow');
      toast.success(t('dashboard.savedSuccess'));
    } catch (e) {
      toast.error(`${t('common.error')}: ${e}`);
    }
  };

  const handleSendCommand = async () => {
    if (!command.trim()) return;
    try {
      await tauri.sendCommand(command);
      setCommand('');
    } catch (e) {
      toast.error(`${t('common.error')}: ${e}`);
    }
  };

  const handleSendBroadcast = async () => {
    const msg = broadcastMsg.trim();
    if (!msg) return;
    try {
      await tauri.sendCommand(`/announce ${msg}`);
      toast.success('Announcement sent');
      setBroadcastMsg('');
      setShowBroadcast(false);
    } catch (e) {
      toast.error(`${t('common.error')}: ${e}`);
    }
  };

  const consoleLines = useMemo(() => logs.slice(-200).map(classifyLog), [logs]);

  // Snapshot del mundo grupal linkeado al perfil activo. Incluye holder + expiry
  // para poder bloquear el boton Start cuando otro miembro esta hosteando
  // (lockState === "other"). Se actualiza tanto al montar como por realtime SSE.
  const [linkedWorld, setLinkedWorld] = useState<LinkedWorldSnapshot | null>(null);
  // Trackeamos current_version del mundo del grupo para detectar cuando otro
  // miembro sube una version nueva mientras yo no soy el holder. Cuando cambia
  // de N → N+1 sin que sea por mi propio stop, muestro un toast.
  const lastSeenVersionRef = useRef<number | null>(null);
  const linkedWorldId = activeProfile?.linked_group_world_id ?? null;

  // Tick cada 30s para recomputar lockState cuando lock_expires_at pasa de
  // futuro a pasado sin que llegue un evento PB (caso: holder se va sin
  // hacer Stop, el heartbeat deja de extender, el lock vence en silencio).
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!linkedWorldId) return;
    const i = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(i);
  }, [linkedWorldId]);

  // Fetch del world + holder name expandido. Devolvemos null si el mundo no
  // existe o el user no tiene acceso (404).
  const fetchLinkedWorldSnapshot = useCallback(
    async (worldId: string): Promise<LinkedWorldSnapshot | null> => {
      try {
        const data = await pb.collection('worlds').getOne<World & {
          expand?: { current_holder?: { id: string; name?: string; email?: string } };
        }>(worldId, {
          fields:
            'id,name,current_version,current_holder,lock_expires_at,expand.current_holder.id,expand.current_holder.name,expand.current_holder.email',
          expand: 'current_holder',
        });
        if (!data) return null;
        const holderRecord = data.expand?.current_holder;
        const holderName = holderRecord
          ? holderRecord.name || holderRecord.email?.split('@')[0] || null
          : null;
        return {
          name: data.name,
          current_version: data.current_version || 0,
          current_holder: data.current_holder || null,
          lock_expires_at: data.lock_expires_at || null,
          holderName,
        };
      } catch {
        return null;
      }
    },
    []
  );

  useEffect(() => {
    if (!linkedWorldId) {
      setLinkedWorld(null);
      lastSeenVersionRef.current = null;
      return;
    }
    let cancelled = false;
    fetchLinkedWorldSnapshot(linkedWorldId).then((snap) => {
      if (cancelled || !snap) return;
      setLinkedWorld(snap);
      lastSeenVersionRef.current = snap.current_version;
    });
    return () => {
      cancelled = true;
    };
  }, [linkedWorldId, fetchLinkedWorldSnapshot]);

  // Si tenemos un nombre cacheado en el profile, preferirlo (evita el flash al
  // navegar entre profiles antes de que llegue la respuesta de PB). Solo el
  // nombre — el holder/expiry no se cachean en el profile.
  useEffect(() => {
    if (!linkedWorldId) return;
    const entry = activeProfile?.group_saves?.find((e) => e.world_id === linkedWorldId);
    if (entry?.world_name) {
      setLinkedWorld((prev) => prev
        ? { ...prev, name: entry.world_name }
        : { name: entry.world_name, current_version: 0, current_holder: null, lock_expires_at: null, holderName: null }
      );
    }
  }, [activeProfile, linkedWorldId]);

  // Realtime: cuando alguien adquiere/libera el lock del mundo linkeado o
  // sube una version nueva, refetcheamos el record para que worldToStart y la
  // UI reflejen el estado actual sin tener que arrancar el server primero.
  usePbRealtimeRefetch<World>({
    collection: 'worlds',
    filter: linkedWorldId ? `id = "${linkedWorldId}"` : undefined,
    enabled: !!linkedWorldId,
    onChange: () => {
      if (!linkedWorldId) return;
      fetchLinkedWorldSnapshot(linkedWorldId).then((snap) => {
        if (!snap) return;
        const prev = lastSeenVersionRef.current;
        // Aviso solo si subio la version Y el server no esta corriendo
        // localmente (porque si esta corriendo significa que YO soy el
        // holder y el upload viene de mi propio stop — ese caso no
        // requiere toast).
        if (
          prev !== null &&
          snap.current_version > prev &&
          !serverStatus.running
        ) {
          toast.info(
            t('server.groupNewVersionAvailable', { name: snap.name }),
            { duration: 6000 }
          );
        }
        lastSeenVersionRef.current = snap.current_version;
        setLinkedWorld(snap);
      });
    },
    onEvent: (e) => {
      // Si el mundo se borra mientras lo tengo linkeado, limpio el state
      // local. handleStart ya auto-unlinkea el profile con 404; el realtime
      // solo adelanta la UI.
      if (e.action === 'delete' && e.record.id === linkedWorldId) {
        setLinkedWorld(null);
        lastSeenVersionRef.current = null;
      }
    },
  });

  // Backwards-compat alias para los useMemo de abajo que ya usaban linkedWorldName.
  const linkedWorldName = linkedWorld?.name ?? null;

  // Gate del boton Start: si otro miembro tiene el lock vigente, no le dejo
  // arrancar al server porque la primera cosa que hace el flujo grupal es
  // intentar acquireWorldLock — que devolveria 409 y un toast feo, perdiendo
  // tiempo y prendiendo expectativas. Mejor cortarlo en la UI.
  // - state "free"     → boton normal
  // - state "mine"     → boton normal (yo ya tengo el lock, el server probablemente esta off)
  // - state "expired"  → boton normal (el holder se fue sin Stop, lock vencio)
  // - state "other"    → boton bloqueado con candado + tooltip
  const heldByOther = useMemo(() => {
    if (!linkedWorld?.current_holder) return false;
    if (linkedWorld.current_holder === session?.id) return false;
    if (!linkedWorld.lock_expires_at) return false;
    return new Date(linkedWorld.lock_expires_at).getTime() > Date.now();
  }, [linkedWorld, session?.id]);

  // Compute what world will actually start, with explicit awareness of group vs local mode.
  // In group mode this comes from profile.linked_group_world_id (Group flow overwrites
  // serverconfig at start time, so serverconfig.json is not the source of truth here).
  // Bug E fix: tambien tracking si el user tiene sesion activa para el modo grupal.
  const worldToStart = useMemo(() => {
    const linkedId = activeProfile?.linked_group_world_id;
    if (linkedId) {
      const entry = activeProfile?.group_saves?.find((e) => e.world_id === linkedId);
      return {
        mode: 'group' as const,
        name: entry?.world_name ?? linkedWorldName,
        downloaded: !!entry,
        needsLogin: !session,
      };
    }
    return {
      mode: 'local' as const,
      name: activeWorld
        ? activeWorld.split(/[/\\]/).pop()?.replace(/\.vcdbs$/i, '') ?? activeWorld
        : null,
      downloaded: !!activeWorld,
      needsLogin: false,
    };
  }, [activeProfile, activeWorld, linkedWorldName, session]);
  const cpuValue = latestMetrics?.cpu_usage ?? 0;
  const memoryMb = latestMetrics?.memory_mb ?? 0;
  const memoryDisplay = serverStatus.running ? formatBytes(memoryMb) : '—';

  return (
    <div className="p-6 space-y-5">
      {/* SECTION: Server Overview (metrics) */}
      <section>
        <div className="flex items-end justify-between mb-3">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[hsl(38_25%_92%)]">
              {t('server.title')}
            </h1>
            <p className="text-xs text-muted-foreground mt-0.5">
              {settings.data_path
                ? settings.data_path
                : t('server.subtitle')}
            </p>
          </div>
          <span className="text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {t('dashboard.status')}
          </span>
        </div>

        <div className="grid gap-3 grid-cols-2 md:grid-cols-3 xl:grid-cols-5">
          <MetricCard
            icon={Activity}
            label={t('dashboard.status')}
            value={serverStatus.running ? t('dashboard.online') : t('dashboard.offline')}
            valueColor={serverStatus.running ? 'hsl(var(--emerald))' : 'hsl(var(--muted-foreground))'}
            sub={
              serverStatus.running
                ? `${t('dashboard.uptime')} ${formatUptime(uptimeMs)}`
                : settings.server_exe_path
                ? '—'
                : t('server.mustConfigurePath')
            }
            decoration={
              <span
                className={
                  serverStatus.running ? 'vs-pulse-dot' : 'w-2 h-2 rounded-full bg-[hsl(var(--muted-foreground))]'
                }
              />
            }
          />

          <MetricCard
            icon={Cpu}
            label={t('dashboard.cpu')}
            value={serverStatus.running ? `${cpuValue.toFixed(0)}%` : '—'}
            sub={serverStatus.running ? `Process ${serverStatus.pid ?? '—'}` : '—'}
            chart={
              <Sparkline
                data={metricsHistory}
                dataKey="cpu_usage"
                stroke="hsl(25 80% 60%)"
                fill="hsl(25 80% 60% / 0.15)"
              />
            }
          />

          <MetricCard
            icon={MemoryStick}
            label={t('dashboard.ram')}
            value={memoryDisplay}
            sub={serverStatus.running ? 'JVM heap' : '—'}
            chart={
              <Sparkline
                data={metricsHistory}
                dataKey="memory_mb"
                stroke="hsl(142 55% 55%)"
                fill="hsl(142 55% 55% / 0.15)"
              />
            }
          />

          <MetricCard
            icon={HardDrive}
            label={t('dashboard.disk')}
            value={serverStatus.running ? `${worlds.length} ${worlds.length === 1 ? 'world' : 'worlds'}` : '—'}
            sub={
              worlds.length > 0
                ? formatBytes(worlds.reduce((acc, w) => acc + w.size_bytes / (1024 * 1024), 0))
                : '—'
            }
            chart={<StaticBars values={[3, 4, 5, 4, 6, 5, 7, 6]} color="hsl(42 75% 60%)" />}
          />

          <MetricCard
            icon={Wifi}
            label={t('dashboard.ping')}
            value={serverStatus.running ? `${players.length}` : '—'}
            sub={serverStatus.running ? `${players.length === 1 ? 'player' : 'players'} online` : '—'}
            chart={<StaticBars values={[2, 4, 3, 5, 4, 6, 5, 4]} color="hsl(195 60% 60%)" />}
          />
        </div>
      </section>

      {/* SECTION: Server Controls */}
      <section className="vs-panel p-4">
        <div className="flex items-center justify-between mb-3">
          <h2 className="vs-panel-title">
            <Zap className="h-3.5 w-3.5" />
            {t('dashboard.serverControls')}
          </h2>
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs text-muted-foreground hover:text-foreground"
            onClick={() => setShowMore(true)}
          >
            <MoreHorizontal className="h-3.5 w-3.5 mr-1" />
            {t('dashboard.moreActions')}
          </Button>
        </div>

        {/* What will start — visible BEFORE clicking Start, so the user knows */}
        <div
          className={`mb-2 flex items-center gap-2 px-3 py-2 rounded-md text-xs ${
            worldToStart.mode === 'group'
              ? 'bg-[hsl(255_30%_10%)] border border-[hsl(255_60%_30%)]'
              : 'bg-[hsl(200_25%_10%)] border border-[hsl(30_15%_22%)]'
          }`}
        >
          {worldToStart.mode === 'group' ? (
            <Cloud className="h-3.5 w-3.5 text-[hsl(255_75%_70%)] shrink-0" />
          ) : (
            <HardDrive className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
          )}
          <span className="text-muted-foreground">
            {t('server.willStartLabel')}:
          </span>
          {worldToStart.name ? (
            <span
              className={
                worldToStart.mode === 'group'
                  ? 'font-medium text-[hsl(255_75%_85%)]'
                  : 'font-medium'
              }
            >
              {worldToStart.name}
              {worldToStart.mode === 'group' && !worldToStart.downloaded && (
                <span className="ml-1 italic text-muted-foreground text-[10px]">
                  {t('server.willStartGroupNotDownloaded')}
                </span>
              )}
            </span>
          ) : (
            <span className="italic text-muted-foreground">
              {worldToStart.mode === 'group'
                ? t('server.willStartGroupUnknown')
                : t('server.willStartNoActive')}
            </span>
          )}
          {worldToStart.mode === 'group' && worldToStart.needsLogin && (
            <span className="ml-auto text-[10px] uppercase tracking-wider text-[hsl(35_85%_60%)] inline-flex items-center gap-1">
              <AlertTriangle className="h-3 w-3" />
              {t('server.modeGroupNeedsLogin')}
            </span>
          )}
          {worldToStart.mode === 'group' && !worldToStart.needsLogin && (
            <span className="ml-auto text-[10px] uppercase tracking-wider text-[hsl(255_75%_70%)]">
              {t('server.modeGroup')}
            </span>
          )}
          {worldToStart.mode === 'local' && (
            <span className="ml-auto text-[10px] uppercase tracking-wider text-muted-foreground">
              {t('server.modeLocal')}
            </span>
          )}
        </div>

        {groupFlow && (
          <div className="mb-2 px-3 py-2">
            <GroupFlowIndicator flow={groupFlow} currentStageId={groupStageId} />
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <HoverHint
            hint={
              heldByOther
                ? t('dashboard.startDisabledHeldByOther', {
                    name: linkedWorld?.holderName ?? t('groups.world.someoneElse'),
                  })
                : !settings.server_exe_path
                ? t('dashboard.startDisabledNoExe')
                : serverStatus.running
                ? t('dashboard.startDisabledRunning')
                : loading
                ? t('dashboard.startDisabledBusy')
                : null
            }
          >
            <button
              type="button"
              onClick={handleStart}
              disabled={loading || serverStatus.running || !settings.server_exe_path || heldByOther}
              className="vs-cta-primary inline-flex items-center justify-center gap-2 h-10 px-5 rounded-md text-sm font-semibold disabled:cursor-not-allowed"
            >
              {heldByOther ? (
                <Lock className="h-4 w-4" />
              ) : (
                <Play className="h-4 w-4 fill-current" />
              )}
              {heldByOther
                ? t('dashboard.startHeldByOtherLabel', {
                    name: linkedWorld?.holderName ?? t('groups.world.someoneElse'),
                  })
                : activeProfile?.linked_group_world_id
                ? t('dashboard.startServerGroup')
                : t('dashboard.startServer')}
            </button>
          </HoverHint>

          <button
            type="button"
            onClick={handleStop}
            disabled={loading || !serverStatus.running}
            className="vs-cta-secondary inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Square className="h-3.5 w-3.5" />
            {t('dashboard.stopServer')}
          </button>

          <button
            type="button"
            onClick={handleRestart}
            disabled={loading || !serverStatus.running}
            className="vs-cta-secondary inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <RotateCcw className="h-3.5 w-3.5" />
            {t('dashboard.restart')}
          </button>

          <button
            type="button"
            onClick={handleQuickSave}
            disabled={!serverStatus.running}
            className="vs-cta-secondary inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="h-3.5 w-3.5" />
            {t('dashboard.quickSave')}
          </button>

          <button
            type="button"
            onClick={() => setShowBroadcast(true)}
            disabled={!serverStatus.running}
            className="vs-cta-secondary inline-flex items-center justify-center gap-2 h-10 px-4 rounded-md text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Megaphone className="h-3.5 w-3.5" />
            {t('dashboard.broadcast')}
          </button>
        </div>

        {/* En flujo grupal el GroupFlowIndicator ya cubre el stage "stopping",
            asi que solo mostramos el StopProgressIndicator viejo en modo local. */}
        {isStopping && !groupFlow && (
          <div className="mt-3 pt-3 border-t border-[hsl(30_15%_18%)]">
            <StopProgressIndicator visible={isStopping} onComplete={handleStopComplete} />
          </div>
        )}
      </section>

      {/* SECTION: Players + Worlds + WorldInfo */}
      <section className="grid gap-4 lg:grid-cols-3">
        <PlayersOnlinePanel
          players={players}
          joinTimes={playerJoinTimes}
          serverRunning={serverStatus.running}
        />

        <WorldsPanel
          worlds={worlds}
          activeWorld={activeWorld}
        />

        <WorldInfoPanel
          serverRunning={serverStatus.running}
          dataPath={settings.data_path}
          worldsCount={worlds.length}
          playersCount={players.length}
        />
      </section>

      {/* SECTION: Performance + Console + Events */}
      <section className="grid gap-4 lg:grid-cols-[1.1fr,1.4fr,0.9fr]">
        <PerformancePanel
          metricsHistory={metricsHistory}
          serverRunning={serverStatus.running}
        />

        <ConsolePanel
          consoleLines={consoleLines}
          serverRunning={serverStatus.running}
          command={command}
          onCommandChange={setCommand}
          onSubmit={handleSendCommand}
          logsEndRef={logsEndRef}
        />

        <EventsPanel
          serverRunning={serverStatus.running}
          autosaveMinutes={settings.autosave_interval_minutes}
          autobackupMinutes={settings.autobackup_interval_minutes}
          nextAutosaveAt={nextAutosaveAt}
          nextAutobackupAt={nextAutobackupAt}
          onUpdateScheduling={onUpdateScheduling}
        />
      </section>

      {/* Mods verification dialog (group flow pre-start) */}
      <ModsVerifyDialog
        open={!!verifyContext}
        result={verifyContext?.result ?? { match: true, missing: [], extra: [], mismatched: [] }}
        modsPath={`${settings.data_path}\\Mods`}
        onChoice={(c) => verifyContext?.resolve(c)}
      />

      {/* Dialogs */}
      <Dialog open={showBroadcast} onOpenChange={setShowBroadcast}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboard.broadcastTitle')}</DialogTitle>
            <DialogDescription>{t('dashboard.broadcastDesc')}</DialogDescription>
          </DialogHeader>
          <textarea
            placeholder={t('dashboard.broadcastPlaceholder')}
            value={broadcastMsg}
            onChange={(e) => setBroadcastMsg(e.target.value)}
            rows={3}
            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring resize-none"
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => setShowBroadcast(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              onClick={handleSendBroadcast}
              disabled={!broadcastMsg.trim() || !serverStatus.running}
              className="gap-2"
            >
              <Send className="h-4 w-4" />
              {t('dashboard.broadcastSend')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={showMore} onOpenChange={setShowMore}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('dashboard.moreActions')}</DialogTitle>
            <DialogDescription>{t('dashboard.moreSoon')}</DialogDescription>
          </DialogHeader>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------- Sub-components ---------- */

function MetricCard({
  icon: Icon,
  label,
  value,
  valueColor,
  sub,
  decoration,
  chart,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  valueColor?: string;
  sub?: string;
  decoration?: React.ReactNode;
  chart?: React.ReactNode;
}) {
  return (
    <div className="vs-metric-card">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-[hsl(30_15%_22%)] bg-[hsl(200_25%_10%)]">
            <Icon className="h-3.5 w-3.5 text-[hsl(var(--copper-soft))]" />
          </span>
          <span className="vs-metric-label">{label}</span>
        </div>
        {decoration}
      </div>

      <div className="mt-3 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div
            className="vs-metric-value truncate"
            style={valueColor ? { color: valueColor } : undefined}
          >
            {value}
          </div>
          {sub && (
            <div className="text-[11px] text-muted-foreground mt-0.5 truncate">{sub}</div>
          )}
        </div>
        {chart && <div className="h-10 w-24 shrink-0">{chart}</div>}
      </div>
    </div>
  );
}

function Sparkline({
  data,
  dataKey,
  stroke,
  fill,
}: {
  data: ProcessMetrics[];
  dataKey: keyof ProcessMetrics;
  stroke: string;
  fill: string;
}) {
  if (data.length < 2) {
    return (
      <div className="h-full w-full flex items-end justify-end gap-0.5 opacity-40">
        {[2, 3, 2, 4, 3, 5, 4, 3].map((v, i) => (
          <span
            key={i}
            className="w-[3px] rounded-sm"
            style={{ height: `${v * 8}%`, background: stroke }}
          />
        ))}
      </div>
    );
  }
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id={`grad-${String(dataKey)}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={fill} stopOpacity={1} />
            <stop offset="100%" stopColor={fill} stopOpacity={0} />
          </linearGradient>
        </defs>
        <Area
          type="monotone"
          dataKey={dataKey as string}
          stroke={stroke}
          strokeWidth={1.5}
          fill={`url(#grad-${String(dataKey)})`}
          isAnimationActive={false}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

function StaticBars({ values, color }: { values: number[]; color: string }) {
  const max = Math.max(...values);
  return (
    <div className="h-full w-full flex items-end justify-end gap-0.5 opacity-50">
      {values.map((v, i) => (
        <span
          key={i}
          className="w-[3px] rounded-sm"
          style={{
            height: `${(v / max) * 100}%`,
            background: color,
          }}
        />
      ))}
    </div>
  );
}

/* Players Online */
function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  return `${d}d`;
}

function PlayersOnlinePanel({
  players,
  joinTimes,
  serverRunning,
}: {
  players: PlayerInfo[];
  joinTimes: Record<string, number>;
  serverRunning: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="vs-panel p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="vs-panel-title">
          <Users className="h-3.5 w-3.5" />
          {t('dashboard.playersOnline')}{' '}
          <span className="text-foreground font-bold ml-1 normal-case tracking-normal">
            {serverRunning ? players.length : '—'}
          </span>
        </h3>
        <button
          type="button"
          className="text-[11px] text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
        >
          {t('dashboard.managePlayers')}
          <ChevronRight className="h-3 w-3" />
        </button>
      </div>

      <div className="flex-1 min-h-[160px]">
        {!serverRunning ? (
          <EmptyHint label={t('server.serverNotRunning')} />
        ) : players.length === 0 ? (
          <EmptyHint label={t('dashboard.noPlayersOnline')} />
        ) : (
          <ul className="space-y-1.5">
            {players.map((p) => {
              const joined = joinTimes[p.name];
              const initials = p.name.slice(0, 2).toUpperCase();
              return (
                <li
                  key={p.name}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-[hsl(200_25%_12%)] transition-colors"
                >
                  <span className="vs-avatar h-7 w-7 text-[10px] font-bold">
                    {initials}
                  </span>
                  <span className="flex-1 min-w-0 text-sm truncate">{p.name}</span>
                  <span className="text-[11px] text-muted-foreground font-mono">
                    {joined ? timeAgo(joined) : '—'}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* Worlds & Saves */
function WorldsPanel({
  worlds,
  activeWorld,
}: {
  worlds: SaveInfo[];
  activeWorld: string | null;
}) {
  const { t } = useTranslation();
  const visible = worlds.slice(0, 4);

  return (
    <div className="vs-panel p-4 flex flex-col">
      <div className="flex items-center justify-between mb-3">
        <h3 className="vs-panel-title">
          <Globe className="h-3.5 w-3.5" />
          {t('dashboard.worldsAndSaves')}
        </h3>
        <span className="text-[11px] text-muted-foreground">
          {worlds.length} {worlds.length === 1 ? 'item' : 'items'}
        </span>
      </div>

      <div className="flex-1 min-h-[160px]">
        {visible.length === 0 ? (
          <EmptyHint label={t('dashboard.noWorlds')} />
        ) : (
          <ul className="space-y-1.5">
            {visible.map((w) => {
              const isActive = activeWorld === w.name;
              const initial = w.name.charAt(0).toUpperCase() || 'W';
              const sizeMB = w.size_bytes / (1024 * 1024);
              const sizeStr =
                sizeMB >= 1024 ? `${(sizeMB / 1024).toFixed(1)} GB` : `${sizeMB.toFixed(0)} MB`;
              return (
                <li
                  key={w.full_path}
                  className="flex items-center gap-2.5 px-2 py-1.5 rounded-md hover:bg-[hsl(200_25%_12%)] transition-colors"
                >
                  <span
                    className="h-9 w-12 rounded-md shrink-0 flex items-center justify-center text-sm font-bold border border-[hsl(30_15%_22%)]"
                    style={{
                      background:
                        'linear-gradient(135deg, hsl(28 50% 30%), hsl(200 30% 14%))',
                      color: 'hsl(40 50% 80%)',
                    }}
                  >
                    {initial}
                  </span>
                  <span className="flex-1 min-w-0">
                    <span className="block text-sm truncate text-[hsl(38_22%_88%)]">
                      {w.name.replace(/\.vcdbs$/i, '')}
                    </span>
                    <span className="block text-[11px] text-muted-foreground">
                      {sizeStr}
                    </span>
                  </span>
                  {isActive && (
                    <span className="text-[10px] uppercase tracking-[0.14em] font-semibold px-1.5 py-0.5 rounded bg-[hsl(25_70%_25%)] text-[hsl(25_90%_70%)] border border-[hsl(25_60%_35%)]">
                      Active
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/* World Info */
function WorldInfoPanel({
  serverRunning,
  dataPath,
  worldsCount,
  playersCount,
}: {
  serverRunning: boolean;
  dataPath: string;
  worldsCount: number;
  playersCount: number;
}) {
  const { t } = useTranslation();
  const rows: { label: string; value: string }[] = [
    { label: t('dashboard.gameTime'), value: serverRunning ? '—' : '—' },
    { label: t('dashboard.day'), value: '—' },
    { label: t('dashboard.season'), value: '—' },
    { label: t('dashboard.weather'), value: '—' },
    { label: t('dashboard.difficulty'), value: '—' },
    { label: t('dashboard.players'), value: serverRunning ? `${playersCount}` : '—' },
    { label: 'Worlds', value: `${worldsCount}` },
    { label: 'Data', value: dataPath ? '✓' : '—' },
  ];

  return (
    <div className="vs-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="vs-panel-title">
          <Clock className="h-3.5 w-3.5" />
          {t('dashboard.worldInfo')}
        </h3>
      </div>
      <ul className="divide-y divide-[hsl(30_12%_15%)]">
        {rows.map((r) => (
          <li
            key={r.label}
            className="flex items-center justify-between py-1.5 first:pt-0 last:pb-0"
          >
            <span className="text-xs text-muted-foreground">{r.label}</span>
            <span className="text-xs font-mono text-[hsl(38_22%_88%)]">{r.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* Performance — three mini charts */
function PerformancePanel({
  metricsHistory,
  serverRunning,
}: {
  metricsHistory: ProcessMetrics[];
  serverRunning: boolean;
}) {
  const { t } = useTranslation();
  const latest = metricsHistory.length > 0 ? metricsHistory[metricsHistory.length - 1] : null;

  const charts = [
    {
      label: t('dashboard.tps'),
      value: serverRunning ? '20.0' : '—',
      stroke: 'hsl(142 55% 55%)',
      data: metricsHistory.map((m) => ({ ...m, val: 20 })),
      key: 'val',
    },
    {
      label: t('dashboard.cpu'),
      value: serverRunning && latest ? `${latest.cpu_usage.toFixed(0)}%` : '—',
      stroke: 'hsl(25 80% 60%)',
      data: metricsHistory,
      key: 'cpu_usage',
    },
    {
      label: t('dashboard.memory'),
      value: serverRunning && latest ? formatBytes(latest.memory_mb) : '—',
      stroke: 'hsl(195 60% 60%)',
      data: metricsHistory,
      key: 'memory_mb',
    },
  ];

  return (
    <div className="vs-panel p-4">
      <h3 className="vs-panel-title mb-3">
        <Activity className="h-3.5 w-3.5" />
        {t('dashboard.performance')}
      </h3>

      <div className="space-y-3">
        {charts.map((c) => (
          <div key={c.label} className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {c.label}
              </span>
              <span className="text-xs font-mono text-[hsl(38_22%_88%)]">
                {c.value}
              </span>
            </div>
            <div className="h-10 vs-panel-inset px-1">
              {c.data.length > 1 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={c.data} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                    <Line
                      type="monotone"
                      dataKey={c.key}
                      stroke={c.stroke}
                      strokeWidth={1.5}
                      dot={false}
                      isAnimationActive={false}
                    />
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full w-full flex items-center justify-center text-[10px] text-muted-foreground">
                  {serverRunning ? 'Collecting…' : '—'}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Console */
function ConsolePanel({
  consoleLines,
  serverRunning,
  command,
  onCommandChange,
  onSubmit,
  logsEndRef,
}: {
  consoleLines: ConsoleLine[];
  serverRunning: boolean;
  command: string;
  onCommandChange: (s: string) => void;
  onSubmit: () => void;
  logsEndRef: React.RefObject<HTMLDivElement | null>;
}) {
  const { t } = useTranslation();
  return (
    <div className="vs-panel p-4 flex flex-col h-[420px]">
      <div className="flex items-center justify-between mb-3">
        <h3 className="vs-panel-title">
          <TerminalIcon className="h-3.5 w-3.5" />
          {t('dashboard.console')}
        </h3>
        <span className="text-[10px] text-muted-foreground">
          {consoleLines.length} {consoleLines.length === 1 ? 'line' : 'lines'}
        </span>
      </div>

      <div className="vs-console rounded-md flex-1 min-h-0 overflow-hidden">
        <ScrollArea className="h-full">
          <div className="p-3 space-y-0.5">
            {!serverRunning && consoleLines.length === 0 ? (
              <p className="text-xs text-muted-foreground">
                {t('server.serverNotRunning')}
              </p>
            ) : consoleLines.length === 0 ? (
              <p className="text-xs text-muted-foreground">{t('server.noLogs')}</p>
            ) : (
              consoleLines.map((l, i) => (
                <p
                  key={i}
                  className={`vs-console-line ${
                    l.level === 'err'
                      ? 'vs-console-line--err'
                      : l.level === 'warn'
                      ? 'vs-console-line--warn'
                      : l.level === 'info'
                      ? 'vs-console-line--info'
                      : l.level === 'cmd'
                      ? 'vs-console-line--cmd'
                      : ''
                  }`}
                >
                  {l.raw}
                </p>
              ))
            )}
            <div ref={logsEndRef} />
          </div>
        </ScrollArea>
      </div>

      <div className="mt-2 flex items-center gap-2">
        <div className="flex-1 relative">
          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[hsl(var(--copper-soft))] font-mono">
            ›
          </span>
          <Input
            value={command}
            onChange={(e) => onCommandChange(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
            placeholder={t('dashboard.consolePlaceholder')}
            disabled={!serverRunning}
            className="pl-7 font-mono text-xs bg-[hsl(200_30%_5%)] border-[hsl(30_15%_18%)]"
          />
        </div>
        <Button
          onClick={onSubmit}
          disabled={!serverRunning || !command.trim()}
          size="sm"
          className="h-9"
        >
          <Send className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

/* Scheduled Events
 *
 * Replaces the old placeholder panel with two real, clickable scheduled tasks
 * that the manager actually executes while the server is running:
 *
 *   - Auto-save: sends `/autosavenow` via stdin every N min
 *   - Auto-backup: copies the live .vcdbs into backup_dir, respecting
 *                  keep_backups for rotation
 *
 * Click any row to edit its interval; 0 disables that task. Countdowns update
 * every second; falling back to "Sin tarea" / "Desactivado" / "Configurar" as
 * appropriate. Weekly maintenance was removed — it had no backend.
 */
type SchedKind = 'autosave' | 'autobackup';

interface EventsPanelProps {
  serverRunning: boolean;
  autosaveMinutes: number;
  autobackupMinutes: number;
  nextAutosaveAt: number | null;
  nextAutobackupAt: number | null;
  onUpdateScheduling: (kind: SchedKind, minutes: number) => Promise<void>;
}

function formatCountdown(ms: number, t: (k: string, opts?: Record<string, unknown>) => string): string {
  if (ms <= 0) return t('dashboard.scheduledNow');
  const totalSec = Math.ceil(ms / 1000);
  const days = Math.floor(totalSec / 86400);
  const hours = Math.floor((totalSec % 86400) / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (days > 0) return t('dashboard.in', { value: `${days}d ${hours}h` });
  if (hours > 0) return t('dashboard.in', { value: `${hours}h ${minutes}m` });
  if (minutes > 0) return t('dashboard.in', { value: `${minutes}m ${seconds}s` });
  return t('dashboard.in', { value: `${seconds}s` });
}

function EventsPanel({
  serverRunning,
  autosaveMinutes,
  autobackupMinutes,
  nextAutosaveAt,
  nextAutobackupAt,
  onUpdateScheduling,
}: EventsPanelProps) {
  const { t } = useTranslation();
  const [editing, setEditing] = useState<SchedKind | null>(null);

  // 1-second tick so the countdown labels stay live.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const rowFor = (kind: SchedKind, intervalMin: number, nextAt: number | null) => {
    let dueLabel: string;
    if (intervalMin <= 0) {
      dueLabel = t('dashboard.scheduledDisabled');
    } else if (!serverRunning || nextAt === null) {
      dueLabel = t('dashboard.scheduledIdle', { value: `${intervalMin}m` });
    } else {
      dueLabel = formatCountdown(nextAt - Date.now(), t);
    }

    const meta =
      kind === 'autosave'
        ? { icon: Save, title: t('dashboard.autoSave'), tone: 'hsl(142 55% 55%)' }
        : { icon: HardDrive, title: t('dashboard.autoBackup'), tone: 'hsl(195 60% 60%)' };

    return (
      <li key={kind}>
        <button
          type="button"
          onClick={() => setEditing(kind)}
          className="w-full flex items-center gap-2.5 px-2 py-2 rounded-md hover:bg-[hsl(200_25%_12%)] transition-colors text-left"
          title={t('dashboard.scheduledClickToEdit')}
        >
          <span
            className="h-7 w-7 rounded-md shrink-0 inline-flex items-center justify-center border border-[hsl(30_15%_22%)] bg-[hsl(200_30%_8%)]"
            style={{ color: meta.tone }}
          >
            <meta.icon className="h-3.5 w-3.5" />
          </span>
          <span className="flex-1 min-w-0">
            <span className="block text-sm truncate text-[hsl(38_22%_88%)]">
              {meta.title}
            </span>
          </span>
          <span className="text-[11px] font-mono text-muted-foreground">
            {dueLabel}
          </span>
        </button>
      </li>
    );
  };

  return (
    <div className="vs-panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="vs-panel-title">
          <CalendarClock className="h-3.5 w-3.5" />
          {t('dashboard.scheduledEvents')}
        </h3>
      </div>

      <ul className="space-y-1.5">
        {rowFor('autosave', autosaveMinutes, nextAutosaveAt)}
        {rowFor('autobackup', autobackupMinutes, nextAutobackupAt)}
      </ul>

      <ScheduleEditDialog
        kind={editing}
        currentMinutes={
          editing === 'autosave'
            ? autosaveMinutes
            : editing === 'autobackup'
            ? autobackupMinutes
            : 0
        }
        onClose={() => setEditing(null)}
        onSave={async (m) => {
          if (editing) await onUpdateScheduling(editing, m);
          setEditing(null);
        }}
      />
    </div>
  );
}

interface ScheduleEditDialogProps {
  kind: SchedKind | null;
  currentMinutes: number;
  onClose: () => void;
  onSave: (minutes: number) => Promise<void>;
}

function ScheduleEditDialog({ kind, currentMinutes, onClose, onSave }: ScheduleEditDialogProps) {
  const { t } = useTranslation();
  const [value, setValue] = useState<string>(String(currentMinutes));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (kind !== null) setValue(String(currentMinutes));
  }, [kind, currentMinutes]);

  if (kind === null) return null;

  const title = kind === 'autosave' ? t('dashboard.autoSave') : t('dashboard.autoBackup');
  const description =
    kind === 'autosave'
      ? t('dashboard.scheduledEditAutosaveDesc')
      : t('dashboard.scheduledEditAutobackupDesc');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsed = parseInt(value, 10);
    if (isNaN(parsed) || parsed < 0) return;
    setSaving(true);
    try {
      await onSave(parsed);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => { if (!o && !saving) onClose(); }}>
      <DialogContent>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('dashboard.scheduledEditTitle', { task: title })}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 py-3">
            <div className="space-y-1.5">
              <label htmlFor="sched-minutes" className="text-sm font-medium">
                {t('dashboard.scheduledEditLabel')}
              </label>
              <Input
                id="sched-minutes"
                type="number"
                min={0}
                step={1}
                value={value}
                autoFocus
                onChange={(e) => setValue(e.target.value)}
                className="w-32 font-mono"
              />
              <p className="text-[11px] text-muted-foreground">
                {t('dashboard.scheduledEditHint')}
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? '...' : t('common.save')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ---------- Tiny helpers ---------- */

function EmptyHint({ label }: { label: string }) {
  return (
    <div className="h-full min-h-[120px] flex items-center justify-center">
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}
