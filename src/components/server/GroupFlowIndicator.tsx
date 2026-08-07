import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

export type GroupFlow = "start" | "stop";

// Cada stage del flow grupal. hasProgress=true significa que el dot puede expandirse
// en barra de progreso cuando el backend Rust emite eventos download-progress/upload-progress.
interface StageDef {
  id: string;
  labelKey: string;
  hasProgress: boolean;
}

const START_STAGES: StageDef[] = [
  { id: "verifyingMods", labelKey: "server.groupVerifyingMods", hasProgress: false },
  { id: "fetchingVersion", labelKey: "server.groupFetchingVersion", hasProgress: false },
  { id: "acquiringLock", labelKey: "server.groupAcquiringLock", hasProgress: false },
  { id: "downloading", labelKey: "server.groupDownloading", hasProgress: true },
  { id: "settingActive", labelKey: "server.groupSettingActive", hasProgress: false },
  { id: "starting", labelKey: "server.groupStarting", hasProgress: false },
];

const STOP_STAGES: StageDef[] = [
  { id: "stopping", labelKey: "server.groupStopping", hasProgress: false },
  { id: "readingSave", labelKey: "server.groupReadingSave", hasProgress: false },
  { id: "buildingManifest", labelKey: "server.groupBuildingManifest", hasProgress: false },
  { id: "uploading", labelKey: "server.groupUploading", hasProgress: true },
  { id: "releasingLock", labelKey: "server.groupReleasingLock", hasProgress: false },
];

interface ProgressPayload {
  stage: string;
  percent: number;
  bytes_done: number;
  bytes_total: number;
  message: string;
}

interface GroupFlowIndicatorProps {
  flow: GroupFlow | null;
  currentStageId: string | null;
}

export function GroupFlowIndicator({ flow, currentStageId }: GroupFlowIndicatorProps) {
  const { t } = useTranslation();
  const [progress, setProgress] = useState<ProgressPayload | null>(null);

  // Cuando cambia el stage, reseteamos el progress para no arrastrar percent viejo.
  useEffect(() => {
    setProgress(null);
  }, [currentStageId]);

  // Escuchamos el evento Tauri que corresponde al flow actual. Para start oimos
  // download-progress; para stop, upload-progress. Solo cuando el flow esta activo.
  useEffect(() => {
    if (!flow) return;
    const eventName = flow === "start" ? "download-progress" : "upload-progress";
    let unlisten: UnlistenFn | null = null;

    listen<ProgressPayload>(eventName, (event) => {
      setProgress(event.payload);
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, [flow]);

  if (!flow) return null;

  const stages = flow === "start" ? START_STAGES : STOP_STAGES;
  const currentIdx = currentStageId ? stages.findIndex((s) => s.id === currentStageId) : -1;
  const currentStage = currentIdx >= 0 ? stages[currentIdx] : null;

  // Solo mostramos la barra si la etapa actual es una con progress y tenemos eventos
  // recibidos. Si llegamos a "done" en el progress, mostramos 100 y dejamos que el
  // siguiente cambio de stage colapse el dot otra vez a circulo.
  const showBar = !!(currentStage?.hasProgress && progress);
  const percent = progress ? Math.max(0, Math.min(100, Math.round(progress.percent))) : 0;

  // El label: si hay un message del evento (incluye bytes), lo mostramos textual; sino
  // caemos al i18n key del stage. Si no hay stage, mostramos un fallback.
  const label = progress?.message
    ? progress.message
    : currentStage
      ? t(currentStage.labelKey)
      : t("server.groupStarting");

  return (
    <div className="py-2 space-y-2">
      <div className="flex items-center justify-center gap-2">
        {stages.map((stage, idx) => {
          const isActive = currentIdx >= idx;
          const isCurrent = currentIdx === idx;
          const expand = isCurrent && showBar;

          return (
            <div
              key={stage.id}
              className={[
                "flow-dot",
                isActive ? "flow-dot--active" : "flow-dot--inactive",
                isCurrent ? "flow-dot--current" : "",
                expand ? "flow-dot--expanded" : "",
              ].join(" ")}
              aria-label={t(stage.labelKey)}
            >
              {expand && (
                <>
                  <div
                    className="flow-dot__fill"
                    style={{ transform: `scaleX(${percent / 100})` }}
                  />
                  <span className="flow-dot__percent">{percent}%</span>
                </>
              )}
            </div>
          );
        })}
      </div>
      <p className="text-xs text-center text-muted-foreground animate-pulse">{label}</p>
    </div>
  );
}
