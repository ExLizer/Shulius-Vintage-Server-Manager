import { useState, useEffect, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { RefreshCw, Copy, Trash2, CheckCircle, Archive, Cloud, HardDrive } from "lucide-react";
import type { Settings, SaveInfo, ServerProfile, GroupSaveEntry } from "@/lib/types";
import * as tauri from "@/lib/tauri";
import { toast } from "sonner";

interface SavesViewProps {
  settings: Settings;
  serverRunning: boolean;
  activeProfile: ServerProfile | null;
  onProfilesChange?: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function SavesView({ settings, serverRunning, activeProfile, onProfilesChange }: SavesViewProps) {
  const { t } = useTranslation();
  const [serverSaves, setServerSaves] = useState<SaveInfo[]>([]);
  const [spSaves, setSpSaves] = useState<SaveInfo[]>([]);
  const [activeWorld, setActiveWorld] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SaveInfo | null>(null);
  const [copyTarget, setCopyTarget] = useState<SaveInfo | null>(null);

  const serverSavesPath = settings.data_path ? `${settings.data_path}\\Saves` : "";
  const serverConfigPath = settings.data_path ? `${settings.data_path}\\serverconfig.json` : "";

  // Map filename → group entry (case-insensitive)
  const groupSavesMap = useMemo(() => {
    const map = new Map<string, GroupSaveEntry>();
    for (const e of activeProfile?.group_saves ?? []) {
      map.set(e.filename.toLowerCase(), e);
    }
    return map;
  }, [activeProfile?.group_saves]);

  const isGroupSave = (save: SaveInfo): GroupSaveEntry | null => {
    // SaveInfo.name is the filename without extension. Reconstruct full filename.
    const filename = save.full_path.split(/[\\/]/).pop() ?? `${save.name}.vcdbs`;
    return groupSavesMap.get(filename.toLowerCase()) ?? null;
  };

  // Split server saves into group vs local
  const { groupServerSaves, localServerSaves } = useMemo(() => {
    const group: { save: SaveInfo; entry: GroupSaveEntry }[] = [];
    const local: SaveInfo[] = [];
    for (const save of serverSaves) {
      const entry = isGroupSave(save);
      if (entry) group.push({ save, entry });
      else local.push(save);
    }
    return { groupServerSaves: group, localServerSaves: local };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [serverSaves, groupSavesMap]);

  const loadSaves = async () => {
    setLoading(true);
    try {
      if (serverSavesPath) {
        const saves = await tauri.listSaves(serverSavesPath);
        setServerSaves(saves);
      }
      if (settings.singleplayer_saves_path) {
        const saves = await tauri.listSaves(settings.singleplayer_saves_path);
        setSpSaves(saves);
      }
      if (serverConfigPath) {
        const active = await tauri.readServerConfig(serverConfigPath);
        setActiveWorld(active);
      }
    } catch (e) {
      toast.error(t('worlds.errorLoading', { error: e }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadSaves();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings]);

  const handleSetActive = async (save: SaveInfo) => {
    if (serverRunning) {
      toast.error(t('worlds.stopServerFirst'));
      return;
    }
    if (!activeProfile?.id) {
      toast.error(t('worlds.noActiveProfile'));
      return;
    }
    try {
      // 1) Update serverconfig.json to point to this .vcdbs
      await tauri.setActiveWorld(serverConfigPath, save.full_path);

      // 2) Update profile linkage based on whether this is a group save or not
      const group = isGroupSave(save);
      if (group) {
        await tauri.linkProfileToWorld(activeProfile.id, group.world_id);
        toast.success(t('worlds.activatedGroup', { world: group.world_name }));
      } else {
        // Si el profile estaba en modo grupal, lo desvinculamos. Si no, no-op.
        if (activeProfile.linked_group_world_id) {
          await tauri.linkProfileToWorld(activeProfile.id, null);
        }
        toast.success(t('worlds.activatedLocal', { name: save.name }));
      }

      setActiveWorld(save.full_path);
      onProfilesChange?.(); // refrescar sidebar (cloud icon) y activeProfile
    } catch (e) {
      toast.error(`Error: ${e}`);
    }
  };

  const handleBackup = async (save: SaveInfo) => {
    try {
      const backupPath = await tauri.backupSave(save.full_path, settings.backup_dir, settings.keep_backups);
      toast.success(t('worlds.backupCreated', { path: backupPath }));
    } catch (e) {
      toast.error(`Error: ${e}`);
    }
  };

  const handleCopyToServer = async () => {
    if (!copyTarget) return;
    if (serverRunning) {
      toast.error(t('worlds.stopServerFirst'));
      setCopyTarget(null);
      return;
    }
    try {
      const dstPath = `${serverSavesPath}\\${copyTarget.name}.vcdbs`;
      await tauri.copySave(copyTarget.full_path, dstPath, true, settings.backup_dir, settings.keep_backups);
      toast.success(t('worlds.worldCopied', { name: copyTarget.name }));
      setCopyTarget(null);
      loadSaves();
    } catch (e) {
      toast.error(`Error: ${e}`);
      setCopyTarget(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    if (serverRunning) {
      toast.error(t('worlds.stopServerFirst'));
      setDeleteTarget(null);
      return;
    }
    try {
      await tauri.deleteSave(deleteTarget.full_path, settings.backup_dir, true, settings.keep_backups);

      // Si era un group save, también limpiamos el registro en el profile
      const group = isGroupSave(deleteTarget);
      if (group && activeProfile?.id) {
        const filename = deleteTarget.full_path.split(/[\\/]/).pop() ?? `${deleteTarget.name}.vcdbs`;
        try {
          await tauri.unregisterGroupSave(activeProfile.id, filename);
          // Si el profile estaba linkeado a este world, desvincular
          if (activeProfile.linked_group_world_id === group.world_id) {
            await tauri.linkProfileToWorld(activeProfile.id, null);
          }
          onProfilesChange?.();
        } catch (e) {
          console.warn('[saves] could not unregister group save', e);
        }
      }

      toast.success(t('worlds.worldDeleted', { name: deleteTarget.name }));
      setDeleteTarget(null);
      loadSaves();
    } catch (e) {
      toast.error(`Error: ${e}`);
      setDeleteTarget(null);
    }
  };

  /**
   * "Active" semantics depend on the profile mode:
   *
   * - Group mode (profile.linked_group_world_id set): the world that will be started
   *   is determined by the link, not by serverconfig.json (the group flow overwrites
   *   serverconfig at Start time). So the active save is the group save whose entry
   *   matches the linked world_id. Local saves never show "Activo" in this mode.
   *
   * - Local mode: traditional behavior — match serverconfig.json's SaveFileLocation.
   */
  const isActive = (save: SaveInfo): boolean => {
    if (activeProfile?.linked_group_world_id) {
      const entry = isGroupSave(save);
      return entry?.world_id === activeProfile.linked_group_world_id;
    }
    if (!activeWorld) return false;
    const normalizedActive = activeWorld.replace(/\\/g, '/').toLowerCase();
    const normalizedSave = save.full_path.replace(/\\/g, '/').toLowerCase();
    return normalizedActive === normalizedSave;
  };

  const renderRow = (save: SaveInfo, opts: { isServer: boolean; group?: GroupSaveEntry | null }) => {
    const { isServer, group } = opts;
    return (
      <TableRow key={save.full_path}>
        <TableCell className="font-medium">
          <div className="flex items-center gap-2 min-w-0">
            <span className="truncate">{save.name}</span>
            {isServer && isActive(save) && (
              <Badge variant="default" className="text-xs shrink-0">
                {t('worlds.active')}
              </Badge>
            )}
            {group && (
              <Badge
                variant="outline"
                className="text-[10px] gap-1 shrink-0 border-[hsl(255_60%_40%)] bg-[hsl(255_50%_15%/0.4)]"
                title={`world_id: ${group.world_id}`}
              >
                <Cloud className="h-3 w-3 text-[hsl(255_75%_70%)]" />
                {group.world_name}
              </Badge>
            )}
          </div>
        </TableCell>
        <TableCell>{formatBytes(save.size_bytes)}</TableCell>
        <TableCell>{save.modified_at}</TableCell>
        <TableCell className="text-right">
          <div className="flex justify-end gap-1">
            {isServer && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => handleSetActive(save)}
                disabled={isActive(save) || serverRunning}
                title={t('worlds.setActive')}
              >
                <CheckCircle className="h-4 w-4" />
              </Button>
            )}
            {!isServer && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setCopyTarget(save)}
                disabled={serverRunning}
                title={t('worlds.copyToServer')}
              >
                <Copy className="h-4 w-4" />
              </Button>
            )}
            <Button
              size="sm"
              variant="ghost"
              onClick={() => handleBackup(save)}
              title={t('worlds.backup')}
            >
              <Archive className="h-4 w-4" />
            </Button>
            {isServer && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setDeleteTarget(save)}
                disabled={serverRunning}
                title={t('common.delete')}
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            )}
          </div>
        </TableCell>
      </TableRow>
    );
  };

  const SavesTable = ({
    rows,
    emptyMessage,
  }: {
    rows: React.ReactNode;
    emptyMessage: string;
  }) => (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>{t('common.name')}</TableHead>
          <TableHead>{t('common.size')}</TableHead>
          <TableHead>{t('worlds.modified')}</TableHead>
          <TableHead className="text-right">{t('common.actions')}</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {Array.isArray(rows) && rows.length === 0 ? (
          <TableRow>
            <TableCell colSpan={4} className="text-center text-muted-foreground">
              {emptyMessage}
            </TableCell>
          </TableRow>
        ) : (
          rows
        )}
      </TableBody>
    </Table>
  );

  const deleteIsGroup = deleteTarget ? isGroupSave(deleteTarget) : null;

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t('worlds.title')}</h2>
          <p className="text-muted-foreground">{t('worlds.subtitle')}</p>
        </div>
        <Button onClick={loadSaves} disabled={loading} variant="outline" className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </Button>
      </div>

      {serverRunning && (
        <div className="bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-sm">
          {t('worlds.serverRunningWarning')}
        </div>
      )}

      <Tabs defaultValue="server">
        <TabsList>
          <TabsTrigger value="server">
            {t('worlds.serverTab')} ({serverSaves.length})
          </TabsTrigger>
          <TabsTrigger value="singleplayer">
            {t('worlds.singleplayerTab')} ({spSaves.length})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="server" className="space-y-4">
          {/* Group worlds section */}
          <Card className="border-[hsl(255_60%_30%)]">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Cloud className="h-5 w-5 text-[hsl(255_75%_70%)]" />
                {t('worlds.groupWorlds')}
              </CardTitle>
              <CardDescription>{t('worlds.groupWorldsDesc')}</CardDescription>
            </CardHeader>
            <CardContent>
              <SavesTable
                rows={groupServerSaves.map(({ save, entry }) =>
                  renderRow(save, { isServer: true, group: entry })
                )}
                emptyMessage={t('worlds.noGroupWorlds')}
              />
            </CardContent>
          </Card>

          {/* Local worlds section */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="h-5 w-5 text-muted-foreground" />
                {t('worlds.localWorlds')}
              </CardTitle>
              <CardDescription>
                {serverSavesPath || t('worlds.configureDataPath')}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SavesTable
                rows={localServerSaves.map((save) =>
                  renderRow(save, { isServer: true, group: null })
                )}
                emptyMessage={t('worlds.noLocalWorlds')}
              />
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="singleplayer">
          <Card>
            <CardHeader>
              <CardTitle>{t('worlds.singleplayerWorlds')}</CardTitle>
              <CardDescription>{settings.singleplayer_saves_path}</CardDescription>
            </CardHeader>
            <CardContent>
              <SavesTable
                rows={spSaves.map((save) => renderRow(save, { isServer: false }))}
                emptyMessage={t('worlds.noWorlds')}
              />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      <AlertDialog open={!!deleteTarget} onOpenChange={() => setDeleteTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('worlds.deleteWorld')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('worlds.deleteWorldConfirm', { name: deleteTarget?.name })}
              {deleteIsGroup && (
                <span className="block mt-2 text-[hsl(255_75%_75%)]">
                  {t('worlds.deleteGroupHint', { world: deleteIsGroup.world_name })}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>{t('common.delete')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog open={!!copyTarget} onOpenChange={() => setCopyTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('worlds.copyToServer')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('worlds.copyToServerConfirm', { name: copyTarget?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleCopyToServer}>{t('common.copy')}</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
