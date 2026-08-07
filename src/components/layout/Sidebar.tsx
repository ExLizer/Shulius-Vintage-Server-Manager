import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import {
  LayoutDashboard,
  Users,
  Package,
  Globe,
  Network,
  FileCog,
  UserCog,
  Settings as SettingsIcon,
  Copy,
  Check,
  User as UserIcon,
  Cloud,
  Archive,
} from "lucide-react";
import type { ViewType, Settings as SettingsType, LocalPlayerInfo, ServerProfile } from "@/lib/types";
import { toast } from "sonner";
import * as tauri from "@/lib/tauri";

interface SidebarProps {
  currentView: ViewType;
  onViewChange: (view: ViewType) => void;
  serverRunning: boolean;
  settings: SettingsType;
  publicIp: string | null;
  activeProfile: ServerProfile | null;
}

const navItems: {
  id: ViewType;
  labelKey: string;
  icon: React.ComponentType<{ className?: string }>;
}[] = [
  { id: 'server', labelKey: 'sidebar.server', icon: LayoutDashboard },
  { id: 'player', labelKey: 'sidebar.player', icon: Users },
  { id: 'mods', labelKey: 'sidebar.mods', icon: Package },
  { id: 'saves', labelKey: 'sidebar.worlds', icon: Globe },
  { id: 'backups', labelKey: 'sidebar.backups', icon: Archive },
  { id: 'profiles', labelKey: 'sidebar.profiles', icon: UserCog },
  { id: 'serverconfig', labelKey: 'sidebar.serverConfig', icon: FileCog },
  { id: 'network', labelKey: 'sidebar.network', icon: Network },
  { id: 'groups', labelKey: 'sidebar.groups', icon: Cloud },
  { id: 'settings', labelKey: 'sidebar.settings', icon: SettingsIcon },
];

export function Sidebar({
  currentView,
  onViewChange,
  serverRunning,
  settings,
  publicIp,
  activeProfile,
}: SidebarProps) {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);
  const [localPlayer, setLocalPlayer] = useState<LocalPlayerInfo | null>(null);

  const serverAddress = publicIp ? `${publicIp}:${settings.port}` : '— : —';

  const handleCopyAddress = async () => {
    if (!publicIp) return;
    await navigator.clipboard.writeText(serverAddress);
    setCopied(true);
    toast.success(t('sidebar.addressCopied'));
    setTimeout(() => setCopied(false), 1800);
  };

  useEffect(() => {
    const fetchLocalPlayer = async () => {
      if (!settings.data_path) {
        setLocalPlayer(null);
        return;
      }
      try {
        const info = await tauri.getLocalPlayerInfo(settings.data_path);
        setLocalPlayer(info);
      } catch {
        setLocalPlayer(null);
      }
    };
    fetchLocalPlayer();
  }, [settings.data_path]);

  const initials = (localPlayer?.name ?? 'VS')
    .split(/\s+/)
    .map((s) => s[0])
    .filter(Boolean)
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <aside className="w-56 shrink-0 flex flex-col bg-[hsl(200_30%_7%)] border-r border-[hsl(30_15%_18%)]">
      <div className="px-4 pt-4 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[hsl(var(--muted-foreground))]">
          {t('sidebar.navigation')}
        </p>
      </div>

      <nav className="flex-1 px-2 space-y-0.5 overflow-y-auto">
        {navItems.map((item) => {
          const Icon = item.icon;
          const active = currentView === item.id;
          return (
            <button
              key={item.id}
              type="button"
              data-active={active}
              onClick={() => onViewChange(item.id)}
              className="vs-nav-item"
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="truncate">{t(item.labelKey)}</span>
            </button>
          );
        })}
      </nav>

      <div className="border-t border-[hsl(30_15%_18%)] p-3 space-y-2">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] font-semibold text-[hsl(var(--muted-foreground))]">
          <span className="inline-flex items-center gap-1.5">
            Server
            {activeProfile?.linked_group_world_id && (
              <Cloud
                className="h-3.5 w-3.5 text-[hsl(255_75%_70%)] drop-shadow-[0_0_4px_hsl(255_75%_60%/0.6)]"
                aria-label={t('sidebar.groupMode')}
              />
            )}
          </span>
          {serverRunning ? (
            <span className="vs-status-online">
              <span className="vs-pulse-dot" />
              {t('sidebar.running')}
            </span>
          ) : (
            <span className="vs-status-offline">
              <span className="w-2 h-2 rounded-full bg-[hsl(var(--muted-foreground))]" />
              {t('sidebar.stopped')}
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={handleCopyAddress}
          disabled={!publicIp}
          className="w-full text-left rounded-md border border-[hsl(30_15%_20%)] bg-[hsl(200_25%_10%)] hover:bg-[hsl(200_25%_13%)] hover:border-[hsl(30_25%_28%)] px-2.5 py-1.5 transition-colors group disabled:opacity-60 disabled:cursor-not-allowed"
        >
          <div className="flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-[0.14em] text-[hsl(var(--muted-foreground))]">
              {t('sidebar.address')}
            </p>
            {copied ? (
              <Check className="h-3 w-3 text-[hsl(var(--emerald))]" />
            ) : (
              <Copy className="h-3 w-3 text-[hsl(var(--muted-foreground))] opacity-0 group-hover:opacity-100 transition-opacity" />
            )}
          </div>
          <p className="text-xs font-mono truncate text-[hsl(38_22%_82%)]">
            {serverAddress}
          </p>
        </button>
      </div>

      <div className="border-t border-[hsl(30_15%_18%)] p-3">
        <button
          type="button"
          onClick={() => onViewChange('player')}
          className="w-full flex items-center gap-2.5 rounded-lg p-2 hover:bg-[hsl(200_25%_12%)] transition-colors"
        >
          <span className="vs-avatar h-9 w-9 text-xs font-bold">
            {initials || <UserIcon className="h-4 w-4" />}
          </span>
          <span className="min-w-0 flex-1 text-left">
            <span className="block text-sm font-medium truncate text-[hsl(38_22%_88%)]">
              {localPlayer?.name ?? 'Player'}
            </span>
            <span className="block text-[11px] text-[hsl(var(--muted-foreground))] truncate font-mono">
              {localPlayer?.uid ? localPlayer.uid.slice(0, 8) : 'no-uid'}
            </span>
          </span>
        </button>
      </div>
    </aside>
  );
}
