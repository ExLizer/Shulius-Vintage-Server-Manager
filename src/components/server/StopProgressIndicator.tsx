import { useEffect, useState, useRef } from "react";
import { useTranslation } from "react-i18next";
import { listen } from "@tauri-apps/api/event";
import type { UnlistenFn } from "@tauri-apps/api/event";

interface StopProgressIndicatorProps {
  visible: boolean;
  onComplete?: () => void;
}

type StopStep = "idle" | "announcing" | "autosaving" | "saving" | "stopping" | "done";

const stepKeys: { id: StopStep; labelKey: string }[] = [
  { id: "announcing", labelKey: "stopProgress.announcing" },
  { id: "autosaving", labelKey: "stopProgress.autosaving" },
  { id: "saving", labelKey: "stopProgress.saving" },
  { id: "stopping", labelKey: "stopProgress.stopping" },
  { id: "done", labelKey: "stopProgress.done" },
];

export function StopProgressIndicator({ visible, onComplete }: StopProgressIndicatorProps) {
  const { t } = useTranslation();
  const [currentStep, setCurrentStep] = useState<StopStep>("idle");
  const onCompleteRef = useRef(onComplete);
  onCompleteRef.current = onComplete;

  // Always listen for events, regardless of visibility
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const setupListener = async () => {
      unlisten = await listen<string>("server-stop-progress", (event) => {
        const step = event.payload as StopStep;
        console.log("Stop progress event:", step);
        setCurrentStep(step);

        if (step === "done" && onCompleteRef.current) {
          setTimeout(() => onCompleteRef.current?.(), 800);
        }
      });
    };

    setupListener();

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, []);

  // Reset when hidden
  useEffect(() => {
    if (!visible) {
      // Small delay before reset to show "done" state
      const timer = setTimeout(() => setCurrentStep("idle"), 1000);
      return () => clearTimeout(timer);
    }
  }, [visible]);

  if (!visible) return null;

  const currentStepIndex = stepKeys.findIndex((s) => s.id === currentStep);
  const currentLabelKey = stepKeys.find((s) => s.id === currentStep)?.labelKey;
  const currentLabel = currentLabelKey ? t(currentLabelKey) : t('stopProgress.starting');

  return (
    <div className="py-3 space-y-3">
      <div className="flex items-center justify-center gap-2">
        {stepKeys.map((step, index) => {
          const isActive = currentStepIndex >= index;
          const isCurrent = currentStep === step.id;

          return (
            <div
              key={step.id}
              className={`
                w-3 h-3 rounded-full transition-all duration-500
                ${isActive ? "stop-dot-active" : "stop-dot-inactive"}
                ${isCurrent ? "scale-125" : ""}
              `}
            />
          );
        })}
      </div>
      <p className="text-xs text-center text-muted-foreground animate-pulse">
        {currentLabel}
      </p>
    </div>
  );
}
