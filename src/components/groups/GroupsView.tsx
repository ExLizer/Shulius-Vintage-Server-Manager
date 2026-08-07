import { useState } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "@/hooks/useAuth";
import { AuthScreen } from "./AuthScreen";
import { GroupsList } from "./GroupsList";
import { GroupDetail } from "./GroupDetail";
import { GearLoaderBlock } from "@/components/ui/gear-loader";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { CloudOff, Settings2 } from "lucide-react";
import { CloudSetupWizard } from "@/components/setup/CloudSetupWizard";
import { isPbConfigured, type Group } from "@/lib/pocketbase";
import type { Settings } from "@/lib/types";

interface GroupsViewProps {
  settings: Settings;
  onProfilesChange?: () => void;
}

export function GroupsView({ settings, onProfilesChange }: GroupsViewProps) {
  const { t } = useTranslation();
  const { session, loading } = useAuth();
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  // isPbConfigured() no es reactivo por sí solo; este contador fuerza el
  // re-render cuando el wizard termina de configurar el servidor.
  const [, setConfigVersion] = useState(0);

  if (!isPbConfigured()) {
    return (
      <div className="p-6 flex items-start justify-center">
        <Card className="w-full max-w-md">
          <CardHeader className="text-center">
            <CloudOff className="w-10 h-10 mx-auto text-muted-foreground" />
            <CardTitle>{t("setup.groupsGate.title")}</CardTitle>
            <CardDescription>{t("setup.groupsGate.description")}</CardDescription>
          </CardHeader>
          <CardContent className="flex justify-center">
            <Button onClick={() => setWizardOpen(true)}>
              <Settings2 className="w-4 h-4 mr-2" />
              {t("setup.groupsGate.configure")}
            </Button>
          </CardContent>
        </Card>
        <CloudSetupWizard
          open={wizardOpen}
          onClose={() => {
            setWizardOpen(false);
            setConfigVersion((v) => v + 1);
          }}
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-6">
        <GearLoaderBlock size="lg" label={t("common.loading")} />
      </div>
    );
  }

  if (!session) {
    return <AuthScreen />;
  }

  if (selectedGroup) {
    return (
      <GroupDetail
        group={selectedGroup}
        settings={settings}
        onProfilesChange={onProfilesChange}
        onBack={() => setSelectedGroup(null)}
      />
    );
  }

  return <GroupsList onSelect={setSelectedGroup} />;
}
