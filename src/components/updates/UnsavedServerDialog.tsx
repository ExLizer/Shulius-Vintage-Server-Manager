import { useTranslation } from "react-i18next";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AlertTriangle, Save, X } from "lucide-react";
import type { StopStage } from "@/lib/server-stop";

export type GuardReason = "close" | "update";

interface Props {
  open: boolean;
  reason: GuardReason;
  // True while the save+upload is in flight. Disables the action buttons and
  // shows a progress label below the body.
  busy: boolean;
  stage: StopStage | null;
  // Whether the linked profile is grouped. Used to tailor the wording (group
  // mode mentions the cloud upload explicitly).
  isGroup: boolean;
  onSaveAndProceed: () => void;
  onDiscardAndProceed: () => void;
  onCancel: () => void;
}

export function UnsavedServerDialog({
  open,
  reason,
  busy,
  stage,
  isGroup,
  onSaveAndProceed,
  onDiscardAndProceed,
  onCancel,
}: Props) {
  const { t } = useTranslation();

  const titleKey =
    reason === "close" ? "guard.closeTitle" : "guard.updateTitle";
  const descKey = isGroup
    ? reason === "close"
      ? "guard.closeBodyGroup"
      : "guard.updateBodyGroup"
    : reason === "close"
    ? "guard.closeBodyLocal"
    : "guard.updateBodyLocal";

  const stageLabel = stage ? t(`guard.stage.${stage}`) : "";

  return (
    <AlertDialog
      open={open}
      onOpenChange={(o) => {
        if (!o && !busy) onCancel();
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-[hsl(var(--ember))]" />
            {t(titleKey)}
          </AlertDialogTitle>
          <AlertDialogDescription>{t(descKey)}</AlertDialogDescription>
        </AlertDialogHeader>

        {busy ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <span className="h-2 w-2 rounded-full bg-[hsl(var(--emerald))] animate-pulse" />
            {stageLabel || t("guard.busyGeneric")}
          </div>
        ) : null}

        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy} onClick={onCancel}>
            {t("common.cancel")}
          </AlertDialogCancel>
          <button
            type="button"
            disabled={busy}
            onClick={onDiscardAndProceed}
            className="inline-flex items-center justify-center gap-1.5 rounded-md border border-border bg-transparent px-3 py-2 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <X className="h-3.5 w-3.5" />
            {t("guard.proceedWithoutSaving")}
          </button>
          <AlertDialogAction
            disabled={busy}
            onClick={onSaveAndProceed}
            className="gap-1.5"
          >
            <Save className="h-3.5 w-3.5" />
            {reason === "close" ? t("guard.saveAndClose") : t("guard.saveAndUpdate")}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
