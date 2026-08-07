import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Download, PackageCheck, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { check, type Update } from "@tauri-apps/plugin-updater";
import { relaunch } from "@tauri-apps/plugin-process";
import { getVersion } from "@tauri-apps/api/app";

const AUTOCHECK_KEY = "vssm.autoCheckUpdates";
const LAST_CHECK_KEY = "vssm.lastUpdateCheck";

type Phase = "idle" | "checking" | "available" | "downloading" | "installing" | "ready";

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function UpdatesCard() {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<Phase>("idle");
  const [currentVersion, setCurrentVersion] = useState<string>("");
  const [update, setUpdate] = useState<Update | null>(null);
  const [downloaded, setDownloaded] = useState(0);
  const [contentLength, setContentLength] = useState(0);
  const [autoCheck, setAutoCheck] = useState<boolean>(() => {
    const v = typeof window !== "undefined" ? window.localStorage.getItem(AUTOCHECK_KEY) : null;
    return v === null ? true : v === "1";
  });
  const updateRef = useRef<Update | null>(null);

  useEffect(() => {
    getVersion().then(setCurrentVersion).catch(() => undefined);
  }, []);

  useEffect(() => {
    window.localStorage.setItem(AUTOCHECK_KEY, autoCheck ? "1" : "0");
  }, [autoCheck]);

  useEffect(() => {
    return () => {
      updateRef.current?.close().catch(() => undefined);
    };
  }, []);

  const doCheck = useCallback(async (silent = false) => {
    setPhase("checking");
    try {
      const result = await check();
      window.localStorage.setItem(LAST_CHECK_KEY, String(Date.now()));
      if (result) {
        updateRef.current?.close().catch(() => undefined);
        updateRef.current = result;
        setUpdate(result);
        setPhase("available");
        if (!silent) toast.success(t("settings.updates.foundToast", { version: result.version }));
      } else {
        setUpdate(null);
        setPhase("idle");
        if (!silent) toast.success(t("settings.updates.upToDate"));
      }
    } catch (e) {
      setPhase("idle");
      if (!silent) toast.error(`${t("settings.updates.checkError")}: ${e}`);
      else console.warn("[updater] silent check failed:", e);
    }
  }, [t]);

  const doInstall = useCallback(async () => {
    if (!update) return;
    setPhase("downloading");
    setDownloaded(0);
    setContentLength(0);
    try {
      await update.downloadAndInstall((event) => {
        switch (event.event) {
          case "Started":
            setContentLength(event.data.contentLength ?? 0);
            break;
          case "Progress":
            setDownloaded((prev) => prev + event.data.chunkLength);
            break;
          case "Finished":
            setPhase("installing");
            break;
        }
      });
      setPhase("ready");
      toast.success(t("settings.updates.installedRelaunching"));
      setTimeout(() => {
        relaunch().catch((e) => {
          console.error("[updater] relaunch failed:", e);
          toast.error(t("settings.updates.relaunchManually"));
        });
      }, 800);
    } catch (e) {
      setPhase("available");
      toast.error(`${t("settings.updates.installError")}: ${e}`);
    }
  }, [update, t]);

  const progressPct = contentLength > 0 ? Math.min(100, (downloaded / contentLength) * 100) : 0;
  const isBusy = phase === "checking" || phase === "downloading" || phase === "installing" || phase === "ready";

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PackageCheck className="h-5 w-5" />
          {t("settings.updates.title")}
        </CardTitle>
        <CardDescription>{t("settings.updates.subtitle")}</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <div className="text-sm">
              <span className="text-muted-foreground">{t("settings.updates.currentVersion")}: </span>
              <span className="font-mono">{currentVersion || "—"}</span>
            </div>
            {phase === "available" && update ? (
              <div className="text-sm mt-1">
                <span className="text-[hsl(var(--emerald))]">
                  {t("settings.updates.availableShort", { version: update.version })}
                </span>
              </div>
            ) : null}
          </div>
          <Button
            variant="outline"
            onClick={() => doCheck(false)}
            disabled={isBusy}
            className="shrink-0"
          >
            <RefreshCw className={phase === "checking" ? "h-4 w-4 mr-2 animate-spin" : "h-4 w-4 mr-2"} />
            {phase === "checking" ? t("settings.updates.checking") : t("settings.updates.checkButton")}
          </Button>
        </div>

        {phase === "available" && update ? (
          <div className="rounded-md border border-[hsl(var(--emerald))]/30 bg-[hsl(var(--emerald))]/5 p-3 space-y-2">
            <div className="text-sm font-medium">
              {t("settings.updates.releaseNotes")} ({update.version})
            </div>
            {update.body ? (
              <pre className="text-xs whitespace-pre-wrap text-muted-foreground max-h-40 overflow-y-auto">
                {update.body}
              </pre>
            ) : (
              <div className="text-xs text-muted-foreground">{t("settings.updates.noNotes")}</div>
            )}
            <Button onClick={doInstall} className="w-full">
              <Download className="h-4 w-4 mr-2" />
              {t("settings.updates.downloadInstall")}
            </Button>
          </div>
        ) : null}

        {(phase === "downloading" || phase === "installing" || phase === "ready") ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>
                {phase === "downloading"
                  ? t("settings.updates.downloading")
                  : phase === "installing"
                  ? t("settings.updates.installing")
                  : t("settings.updates.relaunching")}
              </span>
              {phase === "downloading" && contentLength > 0 ? (
                <span className="font-mono">
                  {formatBytes(downloaded)} / {formatBytes(contentLength)}
                </span>
              ) : null}
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div
                className="h-full bg-[hsl(var(--emerald))] transition-all"
                style={{
                  width:
                    phase === "downloading"
                      ? `${progressPct}%`
                      : phase === "installing" || phase === "ready"
                      ? "100%"
                      : "0%",
                }}
              />
            </div>
          </div>
        ) : null}

        <div className="flex items-center justify-between pt-2 border-t border-border">
          <div className="space-y-0.5">
            <Label htmlFor="auto-check-updates" className="text-sm">
              {t("settings.updates.autoCheckLabel")}
            </Label>
            <p className="text-xs text-muted-foreground">
              {t("settings.updates.autoCheckDesc")}
            </p>
          </div>
          <Switch
            id="auto-check-updates"
            checked={autoCheck}
            onCheckedChange={setAutoCheck}
          />
        </div>
      </CardContent>
    </Card>
  );
}
