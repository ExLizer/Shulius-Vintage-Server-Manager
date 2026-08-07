import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Download, Sparkles, X } from "lucide-react";
import type { Update } from "@tauri-apps/plugin-updater";

export type InstallPhase = "idle" | "downloading" | "installing" | "ready";

interface UpdateBannerProps {
  update: Update;
  phase: InstallPhase;
  downloaded: number;
  contentLength: number;
  onInstall: () => void;
  onDismiss: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdateBanner({
  update,
  phase,
  downloaded,
  contentLength,
  onInstall,
  onDismiss,
}: UpdateBannerProps) {
  const { t } = useTranslation();

  const progressPct =
    contentLength > 0 ? Math.min(100, (downloaded / contentLength) * 100) : 0;
  const isWorking = phase !== "idle";

  return (
    <div className="border-b border-[hsl(var(--emerald))]/30 bg-[hsl(var(--emerald))]/[0.07]">
      <div className="flex items-center gap-3 px-4 py-2">
        <Sparkles className="h-5 w-5 text-[hsl(var(--emerald))] shrink-0" />

        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium leading-tight">
            {t("settings.updates.banner.title", { version: update.version })}
          </div>
          {update.body ? (
            <div className="text-xs text-muted-foreground truncate" title={update.body}>
              {update.body}
            </div>
          ) : null}

          {phase === "downloading" ? (
            <div className="mt-1.5 flex items-center gap-2">
              <div className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
                <div
                  className="h-full bg-[hsl(var(--emerald))] transition-all"
                  style={{ width: `${progressPct}%` }}
                />
              </div>
              {contentLength > 0 ? (
                <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                  {formatBytes(downloaded)} / {formatBytes(contentLength)}
                </span>
              ) : null}
            </div>
          ) : phase === "installing" || phase === "ready" ? (
            <div className="mt-1.5 text-xs text-muted-foreground">
              {phase === "installing"
                ? t("settings.updates.installing")
                : t("settings.updates.relaunching")}
            </div>
          ) : null}
        </div>

        {!isWorking ? (
          <>
            <Button size="sm" onClick={onInstall}>
              <Download className="h-4 w-4 mr-1.5" />
              {t("settings.updates.banner.install")}
            </Button>
            <Button
              size="icon"
              variant="ghost"
              onClick={onDismiss}
              title={t("settings.updates.banner.dismiss")}
              aria-label={t("settings.updates.banner.dismiss")}
              className="h-8 w-8"
            >
              <X className="h-4 w-4" />
            </Button>
          </>
        ) : null}
      </div>
    </div>
  );
}
