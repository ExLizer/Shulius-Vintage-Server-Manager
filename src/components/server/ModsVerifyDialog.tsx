import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertTriangle,
  Check,
  Download,
  X,
  Loader2,
  PackageX,
  PackagePlus,
  PackageMinus,
} from "lucide-react";
import {
  downloadMissingMods,
  type ModVerificationResult,
  type ModDownloadProgress,
} from "@/lib/mods-verify";

export type ModsVerifyChoice = "cancel" | "continue" | "fixed";

interface ModsVerifyDialogProps {
  open: boolean;
  result: ModVerificationResult;
  modsPath: string;
  onChoice: (choice: ModsVerifyChoice) => void;
}

export function ModsVerifyDialog({
  open,
  result,
  modsPath,
  onChoice,
}: ModsVerifyDialogProps) {
  const { t } = useTranslation();
  const [phase, setPhase] = useState<"review" | "downloading" | "done">("review");
  const [progress, setProgress] = useState<Map<string, ModDownloadProgress>>(
    new Map()
  );
  const [failureCount, setFailureCount] = useState(0);

  const handleDownloadAll = async () => {
    setPhase("downloading");
    setProgress(new Map(result.missing.map((m) => [
      m.modid,
      { modid: m.modid, name: m.name, status: "pending" as const },
    ])));

    const { ok, failures } = await downloadMissingMods(
      result.missing,
      modsPath,
      (p) => {
        setProgress((prev) => {
          const next = new Map(prev);
          next.set(p.modid, p);
          return next;
        });
      }
    );

    setFailureCount(failures.length);
    setPhase("done");

    if (ok) {
      // small pause so user sees the "done" state briefly
      setTimeout(() => onChoice("fixed"), 800);
    }
  };

  const handleCancel = () => {
    if (phase === "downloading") return; // no cancel mid-download
    onChoice("cancel");
  };

  const handleContinueAnyway = () => {
    onChoice("continue");
  };

  const handleProceedAfterPartialFailure = () => {
    onChoice("continue");
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && handleCancel()}>
      <DialogContent
        className="max-w-2xl"
        onPointerDownOutside={(e) => e.preventDefault()}
        onEscapeKeyDown={(e) => phase === "downloading" && e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-[hsl(var(--ember))]" />
            {t("modsVerify.title")}
          </DialogTitle>
          <DialogDescription>
            {phase === "review" && t("modsVerify.description")}
            {phase === "downloading" && t("modsVerify.downloadingDescription")}
            {phase === "done" &&
              (failureCount === 0
                ? t("modsVerify.doneAllOk")
                : t("modsVerify.donePartial", { failed: failureCount }))}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-2 max-h-[420px] overflow-auto">
          {phase === "review" && (
            <>
              {result.missing.length > 0 && (
                <Section
                  icon={<PackageX className="h-4 w-4 text-[hsl(0_75%_65%)]" />}
                  title={t("modsVerify.missing", { count: result.missing.length })}
                  tone="error"
                >
                  {result.missing.map((m) => (
                    <ModRow
                      key={m.modid}
                      name={m.name || m.modid}
                      modid={m.modid}
                      version={m.version}
                    />
                  ))}
                </Section>
              )}

              {result.mismatched.length > 0 && (
                <Section
                  icon={<AlertTriangle className="h-4 w-4 text-[hsl(35_85%_60%)]" />}
                  title={t("modsVerify.mismatched", { count: result.mismatched.length })}
                  tone="warn"
                >
                  {result.mismatched.map((m) => (
                    <ModRow
                      key={m.modid}
                      name={m.name}
                      modid={m.modid}
                      versionInfo={
                        <span className="text-[10px] font-mono">
                          <span className="text-muted-foreground">
                            {t("modsVerify.local")}: {m.localVersion}
                          </span>
                          <span className="mx-1.5 text-muted-foreground">→</span>
                          <span>{m.manifestVersion}</span>
                        </span>
                      }
                    />
                  ))}
                </Section>
              )}

              {result.extra.length > 0 && (
                <Section
                  icon={<PackagePlus className="h-4 w-4 text-[hsl(45_70%_60%)]" />}
                  title={t("modsVerify.extra", { count: result.extra.length })}
                  tone="info"
                >
                  {result.extra.map((m) => (
                    <ModRow key={m.modid} name={m.name} modid={m.modid} version={m.version} />
                  ))}
                </Section>
              )}
            </>
          )}

          {(phase === "downloading" || phase === "done") && (
            <Section
              icon={<Download className="h-4 w-4" />}
              title={t("modsVerify.downloadProgress")}
              tone="info"
            >
              {Array.from(progress.values()).map((p) => (
                <DownloadRow key={p.modid} progress={p} />
              ))}
            </Section>
          )}
        </div>

        <DialogFooter className="gap-2 flex-col sm:flex-row">
          {phase === "review" && (
            <>
              <Button
                type="button"
                variant="ghost"
                onClick={handleCancel}
                className="sm:mr-auto"
              >
                <X className="h-4 w-4 mr-1.5" />
                {t("modsVerify.cancel")}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={handleContinueAnyway}
              >
                {t("modsVerify.continueAnyway")}
              </Button>
              {result.missing.length > 0 && (
                <Button type="button" onClick={handleDownloadAll}>
                  <Download className="h-4 w-4 mr-1.5" />
                  {t("modsVerify.downloadMissing", { count: result.missing.length })}
                </Button>
              )}
            </>
          )}

          {phase === "downloading" && (
            <Button type="button" disabled>
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              {t("modsVerify.downloadingButton")}
            </Button>
          )}

          {phase === "done" && failureCount > 0 && (
            <>
              <Button type="button" variant="ghost" onClick={handleCancel}>
                {t("modsVerify.cancel")}
              </Button>
              <Button type="button" onClick={handleProceedAfterPartialFailure}>
                {t("modsVerify.proceedAnyway")}
              </Button>
            </>
          )}

          {phase === "done" && failureCount === 0 && (
            <Button type="button" disabled>
              <Check className="h-4 w-4 mr-1.5 text-[hsl(var(--emerald))]" />
              {t("modsVerify.allDone")}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Section({
  icon,
  title,
  tone,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  tone: "error" | "warn" | "info";
  children: React.ReactNode;
}) {
  const toneClass =
    tone === "error"
      ? "border-[hsl(0_50%_30%)] bg-[hsl(0_40%_10%/0.4)]"
      : tone === "warn"
      ? "border-[hsl(35_60%_30%)] bg-[hsl(35_40%_10%/0.4)]"
      : "border-[hsl(220_30%_25%)] bg-[hsl(220_30%_10%/0.4)]";
  return (
    <div className={`rounded-md border ${toneClass} p-2.5`}>
      <div className="flex items-center gap-2 mb-1.5 text-xs font-semibold uppercase tracking-wide">
        {icon}
        {title}
      </div>
      <div className="space-y-1">{children}</div>
    </div>
  );
}

function ModRow({
  name,
  modid,
  version,
  versionInfo,
}: {
  name: string;
  modid: string;
  version?: string;
  versionInfo?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 py-0.5 text-xs">
      <div className="min-w-0 flex-1">
        <span className="font-medium">{name}</span>
        <span className="text-[10px] text-muted-foreground ml-1.5 font-mono">
          ({modid})
        </span>
      </div>
      {versionInfo ?? (
        <Badge variant="outline" className="text-[10px] font-mono">
          {version}
        </Badge>
      )}
    </div>
  );
}

function DownloadRow({ progress }: { progress: ModDownloadProgress }) {
  return (
    <div className="flex items-center justify-between gap-2 px-1 py-0.5 text-xs">
      <div className="min-w-0 flex-1">
        <span className="font-medium">{progress.name || progress.modid}</span>
      </div>
      {progress.status === "pending" && (
        <Badge variant="outline" className="text-[10px]">…</Badge>
      )}
      {progress.status === "downloading" && (
        <span className="inline-flex items-center gap-1 text-[10px] text-muted-foreground">
          <Loader2 className="h-3 w-3 animate-spin" />
          downloading…
        </span>
      )}
      {progress.status === "done" && (
        <span className="inline-flex items-center gap-1 text-[10px] text-[hsl(var(--emerald))]">
          <Check className="h-3 w-3" />
          done
        </span>
      )}
      {progress.status === "failed" && (
        <span
          className="inline-flex items-center gap-1 text-[10px] text-[hsl(0_75%_65%)]"
          title={progress.error}
        >
          <PackageMinus className="h-3 w-3" />
          failed
        </span>
      )}
    </div>
  );
}
