import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Save, FolderOpen, Globe } from "lucide-react";
import { open } from "@tauri-apps/plugin-dialog";
import type { Settings, DefaultPaths } from "@/lib/types";
import * as tauri from "@/lib/tauri";
import { toast } from "sonner";
import { UpdatesCard } from "./UpdatesCard";
import { CloudServerCard } from "./CloudServerCard";

interface SettingsViewProps {
  settings: Settings;
  onSettingsChange: (settings: Settings) => void;
}

export function SettingsView({ settings, onSettingsChange }: SettingsViewProps) {
  const { t, i18n } = useTranslation();
  const [localSettings, setLocalSettings] = useState<Settings>(settings);
  const [originalSettings, setOriginalSettings] = useState<Settings>(settings);
  const [defaultPaths, setDefaultPaths] = useState<DefaultPaths | null>(null);
  const [saving, setSaving] = useState(false);

  // Check if there are unsaved changes (excluding language which is applied immediately)
  const hasChanges = JSON.stringify({ ...localSettings, language: '' }) !== JSON.stringify({ ...originalSettings, language: '' });

  useEffect(() => {
    setLocalSettings(settings);
    setOriginalSettings(settings);
    loadDefaultPaths();
  }, [settings]);

  const handleLanguageChange = (lang: 'es' | 'en') => {
    setLocalSettings(prev => ({ ...prev, language: lang }));
    i18n.changeLanguage(lang);
  };

  const loadDefaultPaths = async () => {
    try {
      const paths = await tauri.getDefaultPaths();
      setDefaultPaths(paths);
    } catch (e) {
      console.error("Error loading default paths:", e);
    }
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      await tauri.saveSettings(localSettings);
      onSettingsChange(localSettings);
      setOriginalSettings(localSettings);
      toast.success(t('settings.saved'));
    } catch (e) {
      toast.error(`${t('common.error')}: ${e}`);
    } finally {
      setSaving(false);
    }
  };

  const updateSetting = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setLocalSettings(prev => ({ ...prev, [key]: value }));
  };

  const applyDefaults = () => {
    if (defaultPaths) {
      setLocalSettings(prev => ({
        ...prev,
        data_path: defaultPaths.vs_data_path,
        singleplayer_saves_path: defaultPaths.saves_path,
        server_exe_path: defaultPaths.suggested_server_exe,
        backup_dir: `${defaultPaths.vs_data_path}\\BackupsTool`,
      }));
    }
  };

  const browseFile = async (settingKey: keyof Settings) => {
    try {
      const selected = await open({
        multiple: false,
        filters: [{ name: 'Executable', extensions: ['exe'] }]
      });
      if (selected) {
        updateSetting(settingKey, selected as string);
      }
    } catch (e) {
      toast.error(`Error: ${e}`);
    }
  };

  const browseFolder = async (settingKey: keyof Settings) => {
    try {
      const selected = await open({
        directory: true,
        multiple: false
      });
      if (selected) {
        updateSetting(settingKey, selected as string);
      }
    } catch (e) {
      toast.error(`Error: ${e}`);
    }
  };

  return (
    <div className="p-6 pb-20 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t('settings.title')}</h2>
          <p className="text-muted-foreground">{t('settings.subtitle')}</p>
        </div>
        <Button onClick={applyDefaults} variant="outline" disabled={!defaultPaths}>
          {t('settings.useDefaults')}
        </Button>
      </div>

      <div className="grid gap-6">
        <Card>
          <CardHeader>
            <CardTitle>{t('settings.serverPaths')}</CardTitle>
            <CardDescription>{t('settings.serverPathsDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="server_exe_path">{t('settings.serverExePath')}</Label>
              <div className="flex gap-2">
                <Input
                  id="server_exe_path"
                  value={localSettings.server_exe_path}
                  onChange={(e) => updateSetting('server_exe_path', e.target.value)}
                  placeholder="C:\...\VintagestoryServer.exe"
                />
                <Button
                  variant="outline"
                  size="icon"
                  title={t('settings.browseFile')}
                  onClick={() => browseFile('server_exe_path')}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('settings.serverExeExample', { path: defaultPaths?.suggested_server_exe || "C:\\Users\\...\\VintagestoryServer.exe" })}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="data_path">{t('settings.dataPath')}</Label>
              <div className="flex gap-2">
                <Input
                  id="data_path"
                  value={localSettings.data_path}
                  onChange={(e) => updateSetting('data_path', e.target.value)}
                  placeholder="C:\...\VintagestoryData"
                />
                <Button
                  variant="outline"
                  size="icon"
                  title={t('settings.browseFolder')}
                  onClick={() => browseFolder('data_path')}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                {t('settings.dataPathDesc')}
              </p>
            </div>

            <div className="space-y-2">
              <Label htmlFor="port">{t('settings.portLabel')}</Label>
              <Input
                id="port"
                type="number"
                value={localSettings.port}
                onChange={(e) => updateSetting('port', parseInt(e.target.value) || 42420)}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.defaultPort')}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.singleplayerSaves')}</CardTitle>
            <CardDescription>{t('settings.singleplayerSavesDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="singleplayer_saves_path">{t('settings.singleplayerSavesPath')}</Label>
              <div className="flex gap-2">
                <Input
                  id="singleplayer_saves_path"
                  value={localSettings.singleplayer_saves_path}
                  onChange={(e) => updateSetting('singleplayer_saves_path', e.target.value)}
                  placeholder="%APPDATA%\VintagestoryData\Saves"
                />
                <Button
                  variant="outline"
                  size="icon"
                  title={t('settings.browseFolder')}
                  onClick={() => browseFolder('singleplayer_saves_path')}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('settings.backups')}</CardTitle>
            <CardDescription>{t('settings.backupsDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="backup_dir">{t('settings.backupDir')}</Label>
              <div className="flex gap-2">
                <Input
                  id="backup_dir"
                  value={localSettings.backup_dir}
                  onChange={(e) => updateSetting('backup_dir', e.target.value)}
                  placeholder="C:\...\Backups"
                />
                <Button
                  variant="outline"
                  size="icon"
                  title={t('settings.browseFolder')}
                  onClick={() => browseFolder('backup_dir')}
                >
                  <FolderOpen className="h-4 w-4" />
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="keep_backups">{t('settings.keepBackups')}</Label>
              <Input
                id="keep_backups"
                type="number"
                value={localSettings.keep_backups}
                onChange={(e) => updateSetting('keep_backups', parseInt(e.target.value) || 20)}
                className="w-32"
              />
              <p className="text-xs text-muted-foreground">
                {t('settings.oldBackupsDeleted')}
              </p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              {t('settings.language')}
            </CardTitle>
            <CardDescription>{t('settings.languageDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>{t('settings.languageLabel')}</Label>
              <Select
                value={i18n.language}
                onValueChange={(value) => handleLanguageChange(value as 'es' | 'en')}
              >
                <SelectTrigger className="w-48">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="es">Español</SelectItem>
                  <SelectItem value="en">English</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </CardContent>
        </Card>

        <CloudServerCard />

        <UpdatesCard />
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
            <span>{t('settings.unsavedChanges')}</span>
          </div>
          <Button
            onClick={handleSave}
            disabled={saving}
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
