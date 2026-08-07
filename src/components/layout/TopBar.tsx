import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Bell,
  Settings as SettingsIcon,
  ChevronDown,
  Check,
  Cloud,
  Globe2,
  LogIn,
  LogOut,
  UserCircle2,
} from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { getErrorMessage } from "@/lib/pocketbase";
import type { ServerProfile, ViewType } from "@/lib/types";

interface TopBarProps {
  profiles: ServerProfile[];
  activeProfile: ServerProfile | null;
  serverRunning: boolean;
  serverVersion: string | null;
  onProfileChange: (profile: ServerProfile) => void;
  onNavigate: (view: ViewType) => void;
  language: 'es' | 'en';
  onLanguageToggle: () => void;
}

export function TopBar({
  profiles,
  activeProfile,
  serverRunning,
  serverVersion,
  onProfileChange,
  onNavigate,
  language,
  onLanguageToggle,
}: TopBarProps) {
  const { t } = useTranslation();
  const { session, profile: userProfile, signOut } = useAuth();
  const [signingOut, setSigningOut] = useState(false);

  const handleSelectChange = (profileId: string) => {
    const profile = profiles.find((p) => p.id === profileId);
    if (profile) onProfileChange(profile);
  };

  const handleAuthClick = async () => {
    if (!session) {
      onNavigate('groups');
      return;
    }
    setSigningOut(true);
    try {
      await signOut();
      toast.success(t('groups.auth.signedOut'));
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <header className="vs-topbar h-14 flex items-center gap-3 px-4 select-none">
      {/* Brand */}
      <div className="flex items-center gap-2.5 pr-3 mr-1 border-r border-[hsl(30_15%_18%)] h-8">
        <img
          src="/logo.png"
          alt="VS"
          className="h-7 w-7 object-contain animate-torch-glow shrink-0"
        />
        <div className="leading-tight hidden sm:block">
          <div className="text-[10px] font-semibold uppercase tracking-[0.18em] text-[hsl(var(--muted-foreground))]">
            Vintage Story
          </div>
          <div className="text-[11px] font-bold uppercase tracking-[0.22em] text-[hsl(38_25%_85%)]">
            Server Manager
          </div>
        </div>
      </div>

      {/* Server profile selector */}
      <div className="flex items-center gap-2 min-w-0">
        {profiles.length > 0 ? (
          <Select
            value={activeProfile?.id ?? undefined}
            onValueChange={handleSelectChange}
          >
            <SelectTrigger
              className="h-9 min-w-[200px] max-w-[280px] bg-[hsl(200_25%_12%)] border-[hsl(30_15%_22%)] hover:border-[hsl(30_25%_32%)] gap-2 px-3"
              aria-label={t('sidebar.selectServer')}
            >
              <span className="flex items-center gap-2 min-w-0">
                <span
                  className={
                    serverRunning
                      ? "vs-pulse-dot shrink-0"
                      : "w-2 h-2 rounded-full bg-[hsl(var(--muted-foreground))] shrink-0"
                  }
                />
                <SelectValue placeholder={t('sidebar.selectServer')} />
              </span>
            </SelectTrigger>
            <SelectContent className="bg-[hsl(200_25%_11%)] border-[hsl(30_15%_22%)]">
              {profiles.map((p) => (
                <SelectItem
                  key={p.id}
                  value={p.id}
                  className="focus:bg-[hsl(200_25%_16%)]"
                >
                  <div className="flex flex-col">
                    <span className="text-sm">{p.name}</span>
                    {p.description && (
                      <span className="text-[11px] text-muted-foreground">
                        {p.description}
                      </span>
                    )}
                  </div>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ) : (
          <div className="h-9 px-3 flex items-center gap-2 rounded-md border border-[hsl(30_15%_22%)] bg-[hsl(200_25%_12%)] text-sm text-muted-foreground">
            <ChevronDown className="h-4 w-4 opacity-50" />
            <span>{t('sidebar.selectServer')}</span>
          </div>
        )}

        {/* Version pill */}
        {serverVersion && (
          <span className="hidden md:inline-flex items-center gap-1 h-7 px-2 rounded-md border border-[hsl(30_15%_22%)] bg-[hsl(200_25%_10%)] text-[11px] font-mono text-[hsl(var(--muted-foreground))]">
            <Check className="h-3 w-3 text-[hsl(var(--emerald))]" />
            v{serverVersion}
          </span>
        )}
      </div>

      <div className="flex-1" />

      {/* Quick actions */}
      <div className="flex items-center gap-1">
        {session ? (
          <button
            type="button"
            onClick={() => onNavigate('groups')}
            className="h-9 inline-flex items-center gap-2 px-2.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-[hsl(200_25%_14%)] transition-colors"
            title={userProfile?.display_name ?? session.email ?? ''}
          >
            <UserCircle2 className="h-4 w-4 text-[hsl(var(--emerald))]" />
            <span className="relative inline-flex group/cloud">
              <Cloud
                className={
                  session.cloud_enabled
                    ? "h-4 w-4 text-purple-400"
                    : "h-4 w-4 text-muted-foreground opacity-40"
                }
              />
              <span
                role="tooltip"
                className="pointer-events-none absolute top-full left-1/2 -translate-x-1/2 mt-2 translate-y-1 opacity-0 group-hover/cloud:opacity-100 group-hover/cloud:translate-y-0 transition-all duration-150 px-2.5 py-1 rounded-md text-[11px] font-medium whitespace-nowrap bg-[hsl(200_27%_8%)] text-[hsl(38_25%_92%)] border border-[hsl(30_15%_22%)] shadow-lg shadow-black/40 z-50"
              >
                {session.cloud_enabled
                  ? t('topbar.cloudAccess')
                  : t('topbar.cloudAccessDisabled')}
              </span>
            </span>
            <span className="max-w-[14ch] truncate">
              {userProfile?.display_name ?? session.email}
            </span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => onNavigate('groups')}
            className="h-9 inline-flex items-center gap-1.5 px-2.5 rounded-md text-sm text-muted-foreground hover:text-foreground hover:bg-[hsl(200_25%_14%)] transition-colors"
            title={t('groups.auth.signin')}
          >
            <LogIn className="h-4 w-4" />
            <span>{t('groups.auth.signin')}</span>
          </button>
        )}

        {session && (
          <button
            type="button"
            onClick={handleAuthClick}
            disabled={signingOut}
            className="h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-[hsl(200_25%_14%)] transition-colors disabled:opacity-50"
            title={t('groups.auth.signout')}
          >
            <LogOut className="h-4 w-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onLanguageToggle}
          className="h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-[hsl(200_25%_14%)] transition-colors"
          title="Language"
        >
          <Globe2 className="h-4 w-4" />
          <span className="sr-only">Toggle language</span>
        </button>

        <button
          type="button"
          className="relative h-9 w-9 inline-flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-[hsl(200_25%_14%)] transition-colors"
          title="Notifications"
        >
          <Bell className="h-4 w-4" />
          <span className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-[hsl(var(--ember))] shadow-[0_0_6px_hsl(25_90%_55%/0.7)]" />
          <span className="sr-only">Notifications</span>
        </button>

        <Button
          variant="ghost"
          size="icon"
          className="h-9 w-9 text-muted-foreground hover:text-foreground hover:bg-[hsl(200_25%_14%)]"
          onClick={() => onNavigate('settings')}
          title="Settings"
        >
          <SettingsIcon className="h-4 w-4" />
        </Button>

        <span className="sr-only">{language}</span>
      </div>
    </header>
  );
}
