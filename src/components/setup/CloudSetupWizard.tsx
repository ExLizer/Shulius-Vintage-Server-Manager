import { useCallback, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
    ArrowLeft,
    ArrowRight,
    Check,
    CheckCircle2,
    Cloud,
    ExternalLink,
    HardDrive,
    Loader2,
    RefreshCw,
    Server,
    XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { getPbUrl, setPbUrl } from "@/lib/pocketbase";
import { markSetupDone } from "@/lib/setup-state";
import { runSetupChecks, type SetupCheckResult } from "@/lib/pb-setup";

const REPO_URL = "https://github.com/ExLizer/Shulius-Vintage-Server-Manager";
const SELF_HOST_GUIDE_URL = `${REPO_URL}#self-hosting`;
const POCKETBASE_DOCS_URL = "https://pocketbase.io/docs/";
const COOLIFY_URL = "https://coolify.io/";

type WizardStep = "welcome" | "choose" | "verify" | "done";

interface CloudSetupWizardProps {
    open: boolean;
    /** true si el wizard terminó con un servidor configurado y verificado. */
    onClose: (configured: boolean) => void;
    /**
     * Primer inicio: muestra el paso de bienvenida con la opción
     * "usar solo en modo local". Desde Ajustes se arranca directo en "choose".
     */
    firstRun?: boolean;
}

export function CloudSetupWizard({ open, onClose, firstRun = false }: CloudSetupWizardProps) {
    return (
        <Dialog
            open={open}
            onOpenChange={(o) => {
                // Cerrar con Escape/click afuera = "decidir después"; en primer
                // inicio no marcamos setup_done así el wizard reaparece la
                // próxima vez. Los cierres "exitosos" pasan por los botones.
                if (!o) onClose(false);
            }}
        >
            <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
                {/* El cuerpo se monta al abrir: el estado del wizard arranca
                    fresco en cada apertura sin efectos de reset. */}
                {open && <WizardBody firstRun={firstRun} onClose={onClose} />}
            </DialogContent>
        </Dialog>
    );
}

function WizardBody({ firstRun, onClose }: { firstRun: boolean; onClose: (configured: boolean) => void }) {
    const { t } = useTranslation();
    const [step, setStep] = useState<WizardStep>(firstRun ? "welcome" : "choose");
    const [url, setUrl] = useState(getPbUrl() ?? "");
    const [checks, setChecks] = useState<SetupCheckResult[]>([]);
    const [checking, setChecking] = useState(false);
    const [verifiedUrl, setVerifiedUrl] = useState<string | null>(null);
    const [showSelfHostHelp, setShowSelfHostHelp] = useState(false);
    const runIdRef = useRef(0);

    const startVerification = useCallback(async (candidate: string) => {
        const runId = ++runIdRef.current;
        setStep("verify");
        setChecking(true);
        setVerifiedUrl(null);
        setChecks([]);
        const outcome = await runSetupChecks(candidate, (progress) => {
            if (runIdRef.current === runId) setChecks(progress);
        });
        if (runIdRef.current !== runId) return; // corrida vieja, ignorar
        setChecks(outcome.results);
        setChecking(false);
        if (outcome.ok) setVerifiedUrl(outcome.url);
    }, []);

    const handleFinish = () => {
        if (!verifiedUrl) return;
        try {
            setPbUrl(verifiedUrl);
        } catch (e) {
            toast.error(String(e));
            return;
        }
        markSetupDone();
        setStep("done");
    };

    const handleLocalOnly = () => {
        markSetupDone();
        onClose(false);
    };

    const checkLabel = (id: SetupCheckResult["id"]) => t(`setup.checks.${id}`);

    const renderCheckIcon = (status: SetupCheckResult["status"]) => {
        switch (status) {
            case "ok":
                return <CheckCircle2 className="w-5 h-5 text-[hsl(var(--emerald))] shrink-0" />;
            case "fail":
                return <XCircle className="w-5 h-5 text-destructive shrink-0" />;
            case "running":
                return <Loader2 className="w-5 h-5 animate-spin text-muted-foreground shrink-0" />;
            default:
                return <span className="w-5 h-5 rounded-full border border-border shrink-0" />;
        }
    };

    const failedCheck = checks.find((c) => c.status === "fail");

    return (
        <>
            {step === "welcome" && (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Cloud className="w-5 h-5" />
                                {t("setup.welcome.title")}
                            </DialogTitle>
                            <DialogDescription>{t("setup.welcome.subtitle")}</DialogDescription>
                        </DialogHeader>

                        <div className="space-y-3 text-sm">
                            <p>{t("setup.welcome.intro")}</p>
                            <ul className="list-disc pl-5 space-y-1 text-muted-foreground">
                                <li>{t("setup.welcome.feature1")}</li>
                                <li>{t("setup.welcome.feature2")}</li>
                                <li>{t("setup.welcome.feature3")}</li>
                            </ul>
                            <p className="text-muted-foreground">{t("setup.welcome.note")}</p>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                            <Button onClick={() => setStep("choose")} className="h-auto py-3 flex-col items-start gap-1">
                                <span className="flex items-center gap-2 font-semibold">
                                    <Cloud className="w-4 h-4" />
                                    {t("setup.welcome.configureCloud")}
                                </span>
                                <span className="text-xs font-normal opacity-80 text-left whitespace-normal">
                                    {t("setup.welcome.configureCloudDesc")}
                                </span>
                            </Button>
                            <Button
                                variant="outline"
                                onClick={handleLocalOnly}
                                className="h-auto py-3 flex-col items-start gap-1"
                            >
                                <span className="flex items-center gap-2 font-semibold">
                                    <HardDrive className="w-4 h-4" />
                                    {t("setup.welcome.localOnly")}
                                </span>
                                <span className="text-xs font-normal opacity-80 text-left whitespace-normal">
                                    {t("setup.welcome.localOnlyDesc")}
                                </span>
                            </Button>
                        </div>
                    </>
                )}

                {step === "choose" && (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <Server className="w-5 h-5" />
                                {t("setup.choose.title")}
                            </DialogTitle>
                            <DialogDescription>{t("setup.choose.subtitle")}</DialogDescription>
                        </DialogHeader>

                        <div className="space-y-4">
                            <form
                                className="space-y-2"
                                onSubmit={(e) => {
                                    e.preventDefault();
                                    if (url.trim()) void startVerification(url);
                                }}
                            >
                                <Label htmlFor="pb-url">{t("setup.choose.urlLabel")}</Label>
                                <Input
                                    id="pb-url"
                                    placeholder="https://pocketbase.mi-dominio.com"
                                    value={url}
                                    onChange={(e) => setUrl(e.target.value)}
                                    autoFocus
                                />
                                <p className="text-xs text-muted-foreground">{t("setup.choose.urlHint")}</p>
                                <div className="flex gap-2 pt-1">
                                    {firstRun && (
                                        <Button type="button" variant="ghost" onClick={() => setStep("welcome")}>
                                            <ArrowLeft className="w-4 h-4 mr-1" />
                                            {t("common.back")}
                                        </Button>
                                    )}
                                    <span className="flex-1" />
                                    <Button type="submit" disabled={!url.trim()}>
                                        {t("setup.choose.verify")}
                                        <ArrowRight className="w-4 h-4 ml-1" />
                                    </Button>
                                </div>
                            </form>

                            <div className="border-t border-border pt-3">
                                <button
                                    type="button"
                                    className="text-sm text-muted-foreground hover:text-foreground underline underline-offset-2"
                                    onClick={() => setShowSelfHostHelp((v) => !v)}
                                >
                                    {t("setup.choose.noServerYet")}
                                </button>

                                {showSelfHostHelp && (
                                    <div className="mt-3 space-y-3 text-sm rounded-md border border-border bg-muted/30 p-3">
                                        <p>{t("setup.selfHost.intro")}</p>
                                        <ol className="list-decimal pl-5 space-y-1.5 text-muted-foreground">
                                            <li>{t("setup.selfHost.step1")}</li>
                                            <li>{t("setup.selfHost.step2")}</li>
                                            <li>{t("setup.selfHost.step3")}</li>
                                            <li>{t("setup.selfHost.step4")}</li>
                                            <li>{t("setup.selfHost.step5")}</li>
                                        </ol>
                                        <p className="text-muted-foreground">{t("setup.selfHost.time")}</p>
                                        <div className="flex flex-wrap gap-2">
                                            <a href={SELF_HOST_GUIDE_URL} target="_blank" rel="noreferrer">
                                                <Button variant="outline" size="sm">
                                                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                                                    {t("setup.selfHost.fullGuide")}
                                                </Button>
                                            </a>
                                            <a href={POCKETBASE_DOCS_URL} target="_blank" rel="noreferrer">
                                                <Button variant="outline" size="sm">
                                                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                                                    PocketBase Docs
                                                </Button>
                                            </a>
                                            <a href={COOLIFY_URL} target="_blank" rel="noreferrer">
                                                <Button variant="outline" size="sm">
                                                    <ExternalLink className="w-3.5 h-3.5 mr-1.5" />
                                                    Coolify
                                                </Button>
                                            </a>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
                )}

                {step === "verify" && (
                    <>
                        <DialogHeader>
                            <DialogTitle>{t("setup.verify.title")}</DialogTitle>
                            <DialogDescription className="font-mono break-all">{url}</DialogDescription>
                        </DialogHeader>

                        <div className="space-y-2">
                            {checks.map((c) => (
                                <div
                                    key={c.id}
                                    className="flex items-start gap-3 rounded-md border border-border p-3"
                                >
                                    {renderCheckIcon(c.status)}
                                    <div className="min-w-0 flex-1">
                                        <div className="text-sm font-medium">{checkLabel(c.id)}</div>
                                        {c.status === "fail" && c.errorKey && (
                                            <div className="text-xs text-destructive mt-1">
                                                {t(`setup.checks.errors.${c.errorKey}`)}
                                            </div>
                                        )}
                                        {c.status === "fail" && c.detail && (
                                            <div className="text-xs text-muted-foreground font-mono mt-1 break-all">
                                                {c.detail}
                                            </div>
                                        )}
                                    </div>
                                </div>
                            ))}

                            {failedCheck && (
                                <div className="text-xs text-muted-foreground rounded-md bg-muted/30 border border-border p-3">
                                    {t(`setup.checks.hints.${failedCheck.errorKey ?? "unreachable"}`)}
                                </div>
                            )}
                        </div>

                        <div className="flex gap-2 pt-2">
                            <Button variant="ghost" onClick={() => setStep("choose")} disabled={checking}>
                                <ArrowLeft className="w-4 h-4 mr-1" />
                                {t("common.back")}
                            </Button>
                            <span className="flex-1" />
                            {failedCheck && (
                                <Button variant="outline" onClick={() => void startVerification(url)}>
                                    <RefreshCw className="w-4 h-4 mr-1" />
                                    {t("setup.verify.retry")}
                                </Button>
                            )}
                            <Button onClick={handleFinish} disabled={!verifiedUrl || checking}>
                                <Check className="w-4 h-4 mr-1" />
                                {t("setup.verify.finish")}
                            </Button>
                        </div>
                    </>
                )}

                {step === "done" && (
                    <>
                        <DialogHeader>
                            <DialogTitle className="flex items-center gap-2">
                                <CheckCircle2 className="w-5 h-5 text-[hsl(var(--emerald))]" />
                                {t("setup.done.title")}
                            </DialogTitle>
                            <DialogDescription>{t("setup.done.subtitle")}</DialogDescription>
                        </DialogHeader>

                        <div className="space-y-3 text-sm">
                            <p>{t("setup.done.next1")}</p>
                            <p className="text-muted-foreground">{t("setup.done.next2")}</p>
                        </div>

                        <div className="flex justify-end pt-2">
                            <Button onClick={() => onClose(true)}>{t("setup.done.close")}</Button>
                        </div>
                    </>
                )}
        </>
    );
}
