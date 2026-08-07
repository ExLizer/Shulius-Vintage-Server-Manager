import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Cloud, Loader2, Settings2 } from "lucide-react";
import { toast } from "sonner";
import { getPbUrl } from "@/lib/pocketbase";
import { runSetupChecks } from "@/lib/pb-setup";
import { CloudSetupWizard } from "@/components/setup/CloudSetupWizard";

// Tarjeta de Ajustes para ver/cambiar el servidor PocketBase en runtime.
// El wizard hace el trabajo pesado (verificación paso a paso); acá solo
// mostramos el estado actual y un test rápido.
export function CloudServerCard() {
    const { t } = useTranslation();
    const [wizardOpen, setWizardOpen] = useState(false);
    const [testing, setTesting] = useState(false);
    // getPbUrl() no es reactivo; bump para releer tras cerrar el wizard.
    const [, setConfigVersion] = useState(0);

    const url = getPbUrl();

    const handleTest = async () => {
        if (!url) return;
        setTesting(true);
        try {
            const outcome = await runSetupChecks(url);
            if (outcome.ok) {
                toast.success(t("setup.settingsCard.testOk"));
            } else {
                toast.error(t("setup.settingsCard.testFail"));
            }
        } finally {
            setTesting(false);
        }
    };

    return (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <Cloud className="h-5 w-5" />
                    {t("setup.settingsCard.title")}
                </CardTitle>
                <CardDescription>{t("setup.settingsCard.description")}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
                <div className="space-y-1">
                    <Label>{t("setup.settingsCard.current")}</Label>
                    {url ? (
                        <p className="text-sm font-mono break-all">{url}</p>
                    ) : (
                        <p className="text-sm text-muted-foreground">
                            {t("setup.settingsCard.notConfigured")}
                        </p>
                    )}
                </div>

                <div className="flex flex-wrap gap-2">
                    <Button variant="outline" onClick={() => setWizardOpen(true)}>
                        <Settings2 className="w-4 h-4 mr-2" />
                        {url ? t("setup.settingsCard.change") : t("setup.settingsCard.configure")}
                    </Button>
                    {url && (
                        <Button variant="outline" onClick={handleTest} disabled={testing}>
                            {testing && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                            {t("setup.settingsCard.test")}
                        </Button>
                    )}
                </div>

                {url && (
                    <p className="text-xs text-muted-foreground">
                        {t("setup.settingsCard.changeWarning")}
                    </p>
                )}
            </CardContent>

            <CloudSetupWizard
                open={wizardOpen}
                onClose={() => {
                    setWizardOpen(false);
                    setConfigVersion((v) => v + 1);
                }}
            />
        </Card>
    );
}
