import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Save, AlertCircle } from "lucide-react";
import type { Settings, FullServerConfig } from "@/lib/types";
import * as tauri from "@/lib/tauri";
import { toast } from "sonner";

interface ServerConfigViewProps {
  settings: Settings;
  serverRunning: boolean;
}

const defaultConfig: FullServerConfig = {
  server_name: "Vintage Story Server",
  server_description: "",
  welcome_message: "Welcome to the server!",
  password: "",
  max_clients: 16,
  authenticate: true,
  only_whitelisted: false,
  pvp: true,
  whitelisted_players: [],
  color_accurate_worldmap: false,
};

export function ServerConfigView({ settings, serverRunning }: ServerConfigViewProps) {
  const { t } = useTranslation();
  const [config, setConfig] = useState<FullServerConfig>(defaultConfig);
  const [originalConfig, setOriginalConfig] = useState<FullServerConfig>(defaultConfig);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const configPath = settings.data_path ? `${settings.data_path}\\serverconfig.json` : "";

  // Check if there are unsaved changes
  const hasChanges = JSON.stringify(config) !== JSON.stringify(originalConfig);

  const loadConfig = async () => {
    if (!configPath) return;
    setLoading(true);
    try {
      const loaded = await tauri.readFullServerConfig(configPath);
      setConfig(loaded);
      setOriginalConfig(loaded);
    } catch (e) {
      console.error("Error loading config:", e);
      toast.error(t('serverConfig.errorLoading', { error: e }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadConfig();
  }, [settings.data_path]);

  const handleSave = async () => {
    if (!configPath) {
      toast.error(t('serverConfig.configureDataPathFirst'));
      return;
    }
    if (serverRunning) {
      toast.error(t('serverConfig.stopServerFirst'));
      return;
    }
    setSaving(true);
    try {
      await tauri.saveFullServerConfig(configPath, config);
      setOriginalConfig(config); // Update original to match saved
      toast.success(t('serverConfig.saved'));
    } catch (e) {
      toast.error(`${t('common.error')}: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const updateConfig = <K extends keyof FullServerConfig>(key: K, value: FullServerConfig[K]) => {
    setConfig(prev => ({ ...prev, [key]: value }));
  };

  if (!settings.data_path) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <p>{t('serverConfig.configureDataPathMessage')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 pb-20 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t('serverConfig.title')}</h2>
          <p className="text-muted-foreground">{t('serverConfig.subtitle')}</p>
        </div>
      </div>

      {serverRunning && (
        <div className="flex items-center gap-3 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <p>{t('serverConfig.serverRunningWarning')}</p>
        </div>
      )}

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('serverConfig.serverInfo')}</CardTitle>
            <CardDescription>{t('serverConfig.serverInfoDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="server_name">{t('serverConfig.serverName')}</Label>
              <Input
                id="server_name"
                value={config.server_name}
                onChange={(e) => updateConfig('server_name', e.target.value)}
                placeholder={t('serverConfig.serverNamePlaceholder')}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="server_description">{t('serverConfig.description')}</Label>
              <Input
                id="server_description"
                value={config.server_description}
                onChange={(e) => updateConfig('server_description', e.target.value)}
                placeholder={t('serverConfig.descriptionPlaceholder')}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="welcome_message">{t('serverConfig.welcomeMessage')}</Label>
              <Input
                id="welcome_message"
                value={config.welcome_message}
                onChange={(e) => updateConfig('welcome_message', e.target.value)}
                placeholder={t('serverConfig.welcomeMessagePlaceholder')}
                disabled={loading}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('serverConfig.access')}</CardTitle>
            <CardDescription>{t('serverConfig.accessDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('serverConfig.playerAuthentication')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('serverConfig.playerAuthenticationDesc')}
                </p>
              </div>
              <Switch
                checked={config.authenticate}
                onCheckedChange={(checked) => updateConfig('authenticate', checked)}
                disabled={loading}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password">{t('serverConfig.serverPassword')}</Label>
              <Input
                id="password"
                type="password"
                value={config.password}
                onChange={(e) => updateConfig('password', e.target.value)}
                placeholder={t('serverConfig.passwordPlaceholder')}
                disabled={loading}
              />
              <p className="text-xs text-muted-foreground">
                {t('serverConfig.passwordHint')}
              </p>
            </div>
            <div className="space-y-2">
              <Label htmlFor="max_clients">{t('serverConfig.maxPlayers')}</Label>
              <Input
                id="max_clients"
                type="number"
                value={config.max_clients}
                onChange={(e) => updateConfig('max_clients', parseInt(e.target.value) || 16)}
                className="w-24"
                min={1}
                max={100}
                disabled={loading}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('serverConfig.whitelist')}</CardTitle>
            <CardDescription>{t('serverConfig.whitelistDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('serverConfig.whitelistMode')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('serverConfig.whitelistModeDesc')}
                </p>
              </div>
              <Switch
                checked={config.only_whitelisted}
                onCheckedChange={(checked) => updateConfig('only_whitelisted', checked)}
                disabled={loading}
              />
            </div>

            {config.only_whitelisted && (
              <div className="p-3 bg-muted/50 rounded-lg text-sm text-muted-foreground">
                <p>{t('serverConfig.whitelistCommandHint')}</p>
                <code className="block mt-2 p-2 bg-background rounded text-xs font-mono">
                  /player [nombre] whitelist on
                </code>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('serverConfig.gameplay')}</CardTitle>
            <CardDescription>{t('serverConfig.gameplayDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('serverConfig.pvp')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('serverConfig.pvpDesc')}
                </p>
              </div>
              <Switch
                checked={config.pvp}
                onCheckedChange={(checked) => updateConfig('pvp', checked)}
                disabled={loading}
              />
            </div>
            <div className="flex items-center justify-between">
              <div className="space-y-0.5">
                <Label>{t('serverConfig.colorAccurateWorldmap')}</Label>
                <p className="text-sm text-muted-foreground">
                  {t('serverConfig.colorAccurateWorldmapDesc')}
                </p>
              </div>
              <Switch
                checked={config.color_accurate_worldmap}
                onCheckedChange={(checked) => updateConfig('color_accurate_worldmap', checked)}
                disabled={loading}
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Floating island notification for unsaved changes */}
      <div
        className={`fixed bottom-6 left-1/2 -translate-x-1/2 ml-28 transition-all duration-300 ease-out ${
          hasChanges
            ? "translate-y-0 opacity-100"
            : "translate-y-20 opacity-0 pointer-events-none"
        }`}
      >
        <div className="flex items-center gap-4 px-4 py-3 bg-card border border-border rounded-full shadow-xl">
          <div className="flex items-center gap-2 text-sm">
            <div className="w-2 h-2 rounded-full bg-yellow-500 animate-pulse" />
            <span>{t('serverConfig.unsavedChanges')}</span>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving || serverRunning}
            size="sm"
            className="gap-2 rounded-full"
          >
            <Save className="h-4 w-4" />
            {saving ? t('common.saving') : t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
