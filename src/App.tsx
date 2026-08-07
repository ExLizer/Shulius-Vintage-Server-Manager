import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { relaunch } from "@tauri-apps/plugin-process";
import { Sidebar } from "@/components/layout/Sidebar";
import { TopBar } from "@/components/layout/TopBar";
import { ServerView } from "@/components/server/ServerView";
import { SavesView } from "@/components/saves/SavesView";
import { ModsView } from "@/components/mods/ModsView";
import { NetworkView } from "@/components/network/NetworkView";
import { SettingsView } from "@/components/settings/SettingsView";
import { ServerConfigView } from "@/components/serverconfig/ServerConfigView";
import { ProfilesView } from "@/components/profiles/ProfilesView";
import { PlayerView } from "@/components/player/PlayerView";
import { GroupsView } from "@/components/groups/GroupsView";
import { BackupsView } from "@/components/backups/BackupsView";
import { Toaster } from "@/components/ui/sonner";
import type { ViewType, Settings, ServerStatus, ServerProfile, ProcessMetrics } from "@/lib/types";
import * as tauri from "@/lib/tauri";
import { useAutoUpdateCheck } from "@/hooks/useAutoUpdateCheck";
import { useGroupLockHeartbeat } from "@/hooks/useGroupLockHeartbeat";
import { useCloseGuard } from "@/hooks/useCloseGuard";
import { useServerAutosave } from "@/hooks/useServerAutosave";
import { useServerAutobackup } from "@/hooks/useServerAutobackup";
import { UpdateBanner, type InstallPhase } from "@/components/updates/UpdateBanner";
import { UnsavedServerDialog, type GuardReason } from "@/components/updates/UnsavedServerDialog";
import { useAuth } from "@/hooks/useAuth";
import { performServerStop, type StopStage } from "@/lib/server-stop";
import { CloudSetupWizard } from "@/components/setup/CloudSetupWizard";
import { isFirstRunSetupPending } from "@/lib/setup-state";

const MAX_METRICS_HISTORY = 60;

function App() {
  const { i18n, t } = useTranslation();
  const { session } = useAuth();
  const { update: pendingUpdate, dismiss: dismissUpdate } = useAutoUpdateCheck();
  const [currentView, setCurrentView] = useState<ViewType>('server');
  const [settings, setSettings] = useState<Settings>({
    server_exe_path: '',
    data_path: '',
    port: 42420,
    backup_dir: '',
    keep_backups: 20,
    singleplayer_saves_path: '',
    active_profile_id: null,
    language: 'es',
    autosave_interval_minutes: 5,
    autobackup_interval_minutes: 0,
  });
  const [serverStatus, setServerStatus] = useState<ServerStatus>({
    running: false,
    pid: null,
  });
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const [serverVersion, setServerVersion] = useState<string | null>(null);
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [activeProfile, setActiveProfile] = useState<ServerProfile | null>(null);
  const [metricsHistory, setMetricsHistory] = useState<ProcessMetrics[]>([]);
  // Wizard de primer inicio: solo si la nube nunca se configuró ni se salteó.
  const [showFirstRunSetup, setShowFirstRunSetup] = useState(() => isFirstRunSetupPending());

  useEffect(() => {
    const loadSettingsAndProfiles = async () => {
      try {
        const savedSettings = await tauri.loadSettings();
        setSettings(savedSettings);
        if (savedSettings.language) i18n.changeLanguage(savedSettings.language);
        if (savedSettings.data_path) await tauri.ensureDefaultProfile(savedSettings.data_path);

        const loadedProfiles = await tauri.listServerProfiles();
        setProfiles(loadedProfiles);

        if (savedSettings.active_profile_id) {
          const active = loadedProfiles.find((p) => p.id === savedSettings.active_profile_id);
          if (active) setActiveProfile(active);
        } else if (loadedProfiles.length > 0) {
          const defaultProfile = loadedProfiles.find((p) => p.is_default) || loadedProfiles[0];
          setActiveProfile(defaultProfile);
        }
      } catch (e) {
        console.error('Error loading settings:', e);
      }
    };
    loadSettingsAndProfiles();

    const fetchIp = async () => {
      try {
        const ip = await tauri.getPublicIp();
        setPublicIp(ip);
      } catch (e) {
        console.error('Error getting public IP:', e);
      }
    };
    fetchIp();

    const pollStatus = async () => {
      try {
        const status = await tauri.getServerStatus();
        setServerStatus(status);
      } catch (e) {
        console.error('Error getting server status:', e);
      }
    };
    pollStatus();
    const interval = setInterval(pollStatus, 3000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!serverStatus.running) {
      setMetricsHistory([]);
      return;
    }
    const pollMetrics = async () => {
      try {
        const metrics = await tauri.getProcessMetrics();
        if (metrics) {
          setMetricsHistory((prev) => {
            const next = [...prev, metrics];
            return next.length > MAX_METRICS_HISTORY ? next.slice(-MAX_METRICS_HISTORY) : next;
          });
        }
      } catch (e) {
        console.error('Error getting metrics:', e);
      }
    };
    pollMetrics();
    const metricsInterval = setInterval(pollMetrics, 2000);
    return () => clearInterval(metricsInterval);
  }, [serverStatus.running]);

  useEffect(() => {
    const fetchVersion = async () => {
      if (settings.server_exe_path) {
        try {
          const version = await tauri.getServerVersion(settings.server_exe_path);
          setServerVersion(version);
        } catch (e) {
          console.error('Error getting server version:', e);
          setServerVersion(null);
        }
      } else {
        setServerVersion(null);
      }
    };
    fetchVersion();
  }, [settings.server_exe_path]);

  // Keep the world lock alive in PocketBase regardless of which view is active.
  // Living here (App level) and not in ServerView ensures the interval is not
  // killed when the user navigates away while the server is running.
  useGroupLockHeartbeat({
    serverRunning: serverStatus.running,
    linkedWorldId: activeProfile?.linked_group_world_id ?? null,
  });

  // Scheduled manager-side tasks (autosave + autobackup). Same reason for
  // living at App level: must survive view navigation while the server runs.
  const { nextFireAt: nextAutosaveAt } = useServerAutosave({
    serverRunning: serverStatus.running,
    intervalMinutes: settings.autosave_interval_minutes,
  });
  const { nextFireAt: nextAutobackupAt } = useServerAutobackup({
    serverRunning: serverStatus.running,
    intervalMinutes: settings.autobackup_interval_minutes,
    dataPath: settings.data_path,
    backupDir: settings.backup_dir,
    keepBackups: settings.keep_backups,
  });

  // ============================================================
  // Update install + safety guard (close window / install update
  // while server is running). All orchestrated here because the
  // banner, close intercept, and stop logic all need a single
  // source of truth for state.
  // ============================================================
  const [installPhase, setInstallPhase] = useState<InstallPhase>('idle');
  const [installDownloaded, setInstallDownloaded] = useState(0);
  const [installContentLength, setInstallContentLength] = useState(0);

  const [guardOpen, setGuardOpen] = useState(false);
  const [guardReason, setGuardReason] = useState<GuardReason>('close');
  const [guardBusy, setGuardBusy] = useState(false);
  const [guardStage, setGuardStage] = useState<StopStage | null>(null);

  const performInstall = useCallback(async () => {
    if (!pendingUpdate) return;
    setInstallPhase('downloading');
    setInstallDownloaded(0);
    setInstallContentLength(0);
    try {
      await pendingUpdate.downloadAndInstall((event) => {
        switch (event.event) {
          case 'Started':
            setInstallContentLength(event.data.contentLength ?? 0);
            break;
          case 'Progress':
            setInstallDownloaded((prev) => prev + event.data.chunkLength);
            break;
          case 'Finished':
            setInstallPhase('installing');
            break;
        }
      });
      setInstallPhase('ready');
      toast.success(t('settings.updates.installedRelaunching'));
      setTimeout(() => {
        relaunch().catch((e) => {
          console.error('[updater] relaunch failed:', e);
          toast.error(t('settings.updates.relaunchManually'));
        });
      }, 800);
    } catch (e) {
      setInstallPhase('idle');
      toast.error(`${t('settings.updates.installError')}: ${e}`);
    }
  }, [pendingUpdate, t]);

  const closeGuard = useCloseGuard({
    active: serverStatus.running,
    onIntercept: () => {
      setGuardReason('close');
      setGuardStage(null);
      setGuardBusy(false);
      setGuardOpen(true);
    },
  });

  const handleBannerInstallClick = useCallback(() => {
    if (serverStatus.running) {
      setGuardReason('update');
      setGuardStage(null);
      setGuardBusy(false);
      setGuardOpen(true);
    } else {
      void performInstall();
    }
  }, [serverStatus.running, performInstall]);

  const handleGuardSaveAndProceed = useCallback(async () => {
    setGuardBusy(true);
    const result = await performServerStop(
      {
        settings,
        activeProfile,
        session,
        onStatusChange: () => {
          tauri.getServerStatus().then(setServerStatus).catch(() => undefined);
        },
        onProfilesChange: () => {
          tauri.listServerProfiles().then(setProfiles).catch(() => undefined);
        },
      },
      { onStage: setGuardStage }
    );
    setGuardBusy(false);

    if (result.kind === 'failed') {
      toast.error(result.error);
      // Leave dialog open so user can retry or cancel.
      return;
    }
    if (result.kind === 'groupNoSaveFound') {
      toast.warning(t('server.groupNoSaveGenerated'));
    } else if (result.kind === 'groupSessionExpiredFallback') {
      toast.warning(t('server.groupSessionExpiredFallback'));
    }

    // Close dialog and proceed with the originally-requested action.
    setGuardOpen(false);
    if (guardReason === 'close') {
      await closeGuard.allowClose();
    } else {
      await performInstall();
    }
  }, [activeProfile, closeGuard, guardReason, performInstall, session, settings, t]);

  const handleGuardDiscardAndProceed = useCallback(async () => {
    // User explicitly chose to skip the save. Just kill the server process
    // locally without uploading and proceed.
    setGuardBusy(true);
    try {
      await tauri.stopServer();
    } catch (e) {
      console.warn('[guard] discard stop failed:', e);
    }
    setGuardBusy(false);
    setGuardOpen(false);
    if (guardReason === 'close') {
      await closeGuard.allowClose();
    } else {
      await performInstall();
    }
  }, [closeGuard, guardReason, performInstall]);

  const handleSettingsChange = (newSettings: Settings) => setSettings(newSettings);

  const updateSchedulingMinutes = useCallback(
    async (kind: 'autosave' | 'autobackup', minutes: number) => {
      const sanitized = Math.max(0, Math.floor(minutes));
      const newSettings: Settings = {
        ...settings,
        ...(kind === 'autosave'
          ? { autosave_interval_minutes: sanitized }
          : { autobackup_interval_minutes: sanitized }),
      };
      setSettings(newSettings);
      try {
        await tauri.saveSettings(newSettings);
      } catch (e) {
        toast.error(`${t('common.error')}: ${e}`);
      }
    },
    [settings, t]
  );

  const loadProfiles = async () => {
    try {
      const loadedProfiles = await tauri.listServerProfiles();
      setProfiles(loadedProfiles);
      // Refrescar activeProfile si esta en la lista (para que tome cambios como linked_group_world_id)
      setActiveProfile((prev) => {
        if (!prev) return prev;
        const updated = loadedProfiles.find((p) => p.id === prev.id);
        return updated ?? prev;
      });
    } catch (e) {
      console.error('Error loading profiles:', e);
    }
  };

  const handleProfileChange = async (profile: ServerProfile) => {
    setActiveProfile(profile);
    const newSettings = {
      ...settings,
      data_path: profile.data_path,
      active_profile_id: profile.id,
    };
    setSettings(newSettings);
    try {
      await tauri.saveSettings(newSettings);
    } catch (e) {
      console.error('Error saving settings:', e);
    }
  };

  const handleStatusChange = async () => {
    try {
      const status = await tauri.getServerStatus();
      setServerStatus(status);
    } catch (e) {
      console.error('Error updating status:', e);
    }
  };

  const handleLanguageToggle = async () => {
    const next: 'es' | 'en' = settings.language === 'es' ? 'en' : 'es';
    const newSettings = { ...settings, language: next };
    setSettings(newSettings);
    i18n.changeLanguage(next);
    try {
      await tauri.saveSettings(newSettings);
    } catch (e) {
      console.error('Error saving language:', e);
    }
  };

  return (
    <div className="flex flex-col h-screen text-foreground">
      <TopBar
        profiles={profiles}
        activeProfile={activeProfile}
        serverRunning={serverStatus.running}
        serverVersion={serverVersion}
        onProfileChange={handleProfileChange}
        onNavigate={setCurrentView}
        language={settings.language}
        onLanguageToggle={handleLanguageToggle}
      />

      {pendingUpdate && (
        <UpdateBanner
          update={pendingUpdate}
          phase={installPhase}
          downloaded={installDownloaded}
          contentLength={installContentLength}
          onInstall={handleBannerInstallClick}
          onDismiss={dismissUpdate}
        />
      )}

      <CloudSetupWizard
        open={showFirstRunSetup}
        firstRun
        onClose={(configured) => {
          setShowFirstRunSetup(false);
          if (configured) setCurrentView('groups');
        }}
      />

      <UnsavedServerDialog
        open={guardOpen}
        reason={guardReason}
        busy={guardBusy}
        stage={guardStage}
        isGroup={!!activeProfile?.linked_group_world_id}
        onSaveAndProceed={handleGuardSaveAndProceed}
        onDiscardAndProceed={handleGuardDiscardAndProceed}
        onCancel={() => setGuardOpen(false)}
      />

      <div className="flex flex-1 min-h-0">
        <Sidebar
          currentView={currentView}
          onViewChange={setCurrentView}
          serverRunning={serverStatus.running}
          settings={settings}
          publicIp={publicIp}
          activeProfile={activeProfile}
        />

        <main className="flex-1 overflow-auto">
          {currentView === 'server' && (
            <ServerView
              settings={settings}
              serverStatus={serverStatus}
              onStatusChange={handleStatusChange}
              metricsHistory={metricsHistory}
              activeProfile={activeProfile}
              onProfilesChange={loadProfiles}
              nextAutosaveAt={nextAutosaveAt}
              nextAutobackupAt={nextAutobackupAt}
              onUpdateScheduling={updateSchedulingMinutes}
            />
          )}
          {currentView === 'saves' && (
            <SavesView
              settings={settings}
              serverRunning={serverStatus.running}
              activeProfile={activeProfile}
              onProfilesChange={loadProfiles}
            />
          )}
          {currentView === 'mods' && (
            <ModsView
              settings={settings}
              serverRunning={serverStatus.running}
              serverVersion={serverVersion}
            />
          )}
          {currentView === 'network' && (
            <NetworkView settings={settings} serverRunning={serverStatus.running} />
          )}
          {currentView === 'serverconfig' && (
            <ServerConfigView settings={settings} serverRunning={serverStatus.running} />
          )}
          {currentView === 'profiles' && (
            <ProfilesView
              serverRunning={serverStatus.running}
              profiles={profiles}
              activeProfile={activeProfile}
              onProfilesChange={loadProfiles}
              onProfileChange={handleProfileChange}
            />
          )}
          {currentView === 'player' && <PlayerView settings={settings} />}
          {currentView === 'groups' && (
            <GroupsView settings={settings} onProfilesChange={loadProfiles} />
          )}
          {currentView === 'backups' && <BackupsView settings={settings} />}
          {currentView === 'settings' && (
            <SettingsView settings={settings} onSettingsChange={handleSettingsChange} />
          )}
        </main>
      </div>

      {/* Status bar */}
      <footer className="vs-statusbar h-7 px-3 flex items-center gap-3 text-[11px]">
        <span className="inline-flex items-center gap-1.5">
          <span
            className={
              serverStatus.running
                ? 'w-1.5 h-1.5 rounded-full bg-[hsl(var(--emerald))]'
                : 'w-1.5 h-1.5 rounded-full bg-[hsl(var(--muted-foreground))]'
            }
          />
          {serverStatus.running ? 'Server running' : 'Server offline'}
          {serverStatus.pid ? ` · PID ${serverStatus.pid}` : ''}
        </span>
        <span className="opacity-50">·</span>
        <span className="font-mono">
          {publicIp ? `${publicIp}:${settings.port}` : '—'}
        </span>
        <span className="flex-1" />
        {activeProfile && (
          <span className="text-muted-foreground truncate max-w-[40ch]">
            {activeProfile.name}
          </span>
        )}
      </footer>

      <Toaster position="bottom-right" />
    </div>
  );
}

export default App;
