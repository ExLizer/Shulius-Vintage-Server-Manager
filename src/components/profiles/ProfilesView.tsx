import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Upload,
  Download,
  Trash2,
  Loader2,
  FolderOpen,
  Package,
  HardDrive,
  Calendar,
  Check,
  Star,
  Edit2,
  Plus,
} from "lucide-react";
import { open, save } from "@tauri-apps/plugin-dialog";
import type { ServerProfile, ServerProfileExportMetadata } from "@/lib/types";
import * as tauri from "@/lib/tauri";
import { toast } from "sonner";

interface ProfilesViewProps {
  serverRunning: boolean;
  profiles: ServerProfile[];
  activeProfile: ServerProfile | null;
  onProfilesChange: () => void;
  onProfileChange: (profile: ServerProfile) => void;
}

function formatDate(dateString: string): string {
  try {
    const date = new Date(dateString);
    return date.toLocaleDateString("es-ES", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return dateString;
  }
}

export function ProfilesView({
  serverRunning,
  profiles,
  activeProfile,
  onProfilesChange,
  onProfileChange,
}: ProfilesViewProps) {
  const { t } = useTranslation();

  // Export dialog state
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [exportName, setExportName] = useState("");
  const [exportDescription, setExportDescription] = useState("");
  const [exportPreview, setExportPreview] = useState<ServerProfileExportMetadata | null>(null);
  const [exporting, setExporting] = useState(false);
  const [profileToExport, setProfileToExport] = useState<ServerProfile | null>(null);

  // Import dialog state
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importPath, setImportPath] = useState("");
  const [importName, setImportName] = useState("");
  const [importing, setImporting] = useState(false);

  // Create dialog state
  const [showCreateDialog, setShowCreateDialog] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createDescription, setCreateDescription] = useState("");
  const [creating, setCreating] = useState(false);

  // Delete confirmation
  const [profileToDelete, setProfileToDelete] = useState<ServerProfile | null>(null);

  // Edit dialog state
  const [showEditDialog, setShowEditDialog] = useState(false);
  const [editProfile, setEditProfile] = useState<ServerProfile | null>(null);
  const [editName, setEditName] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // Change profile confirmation
  const [profileToActivate, setProfileToActivate] = useState<ServerProfile | null>(null);

  const handleExportClick = async (profile: ServerProfile) => {
    setProfileToExport(profile);
    setExportName(profile.name);
    setExportDescription(profile.description || "");
    setExportPreview(null);

    try {
      const preview = await tauri.getProfileExportPreview(profile.data_path);
      setExportPreview(preview);
    } catch (e) {
      console.error("Error getting export preview:", e);
    }

    setShowExportDialog(true);
  };

  const handleExport = async () => {
    if (!profileToExport || !exportName.trim()) return;

    setExporting(true);
    try {
      const desktopPath = await tauri.getDesktopPath();
      const sanitizedName = exportName.replace(/[^a-zA-Z0-9-_ ]/g, "_");
      const defaultPath = `${desktopPath}\\${sanitizedName}.zip`;

      const outputPath = await save({
        defaultPath,
        filters: [{ name: "ZIP", extensions: ["zip"] }],
      });

      if (!outputPath) {
        setExporting(false);
        return;
      }

      await tauri.exportServerProfile(
        profileToExport.data_path,
        outputPath,
        exportName,
        exportDescription
      );

      toast.success(t('profiles.exported', { path: outputPath }));
      setShowExportDialog(false);
    } catch (e) {
      console.error("Error exporting profile:", e);
      toast.error(t('profiles.errorExporting', { error: e }));
    } finally {
      setExporting(false);
    }
  };

  const handleImportClick = () => {
    setImportPath("");
    setImportName("");
    setShowImportDialog(true);
  };

  const handleSelectImportFile = async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "Server Profile", extensions: ["zip"] }],
    });

    if (selected) {
      setImportPath(selected);
      // Extract filename without extension as default name
      const filename = selected.split("\\").pop()?.replace(".zip", "") || "";
      setImportName(filename);
    }
  };

  const handleImport = async () => {
    if (!importPath) return;

    setImporting(true);
    try {
      const result = await tauri.importServerProfile(
        importPath,
        importName.trim() || undefined
      );

      toast.success(t('profiles.profileImported', { name: result.profile.name, mods: result.mods_imported, saves: result.saves_imported }));
      setShowImportDialog(false);
      onProfilesChange();
    } catch (e) {
      console.error("Error importing profile:", e);
      toast.error(t('profiles.errorImporting', { error: e }));
    } finally {
      setImporting(false);
    }
  };

  const handleCreateClick = () => {
    setCreateName("");
    setCreateDescription("");
    setShowCreateDialog(true);
  };

  const handleCreate = async () => {
    if (!createName.trim()) return;

    setCreating(true);
    try {
      const profile = await tauri.createServerProfile(createName, createDescription);
      toast.success(t('profiles.profileCreated', { name: profile.name }));
      setShowCreateDialog(false);
      onProfilesChange();
    } catch (e) {
      console.error("Error creating profile:", e);
      toast.error(t('profiles.errorCreating', { error: e }));
    } finally {
      setCreating(false);
    }
  };

  const handleDeleteClick = (profile: ServerProfile) => {
    setProfileToDelete(profile);
  };

  const handleDeleteConfirm = async () => {
    if (!profileToDelete) return;

    try {
      await tauri.deleteServerProfile(profileToDelete.id);
      toast.success(t('profiles.profileDeleted', { name: profileToDelete.name }));
      onProfilesChange();
    } catch (e) {
      console.error("Error deleting profile:", e);
      toast.error(t('profiles.errorDeleting', { error: e }));
    } finally {
      setProfileToDelete(null);
    }
  };

  const handleEditClick = (profile: ServerProfile) => {
    setEditProfile(profile);
    setEditName(profile.name);
    setEditDescription(profile.description || "");
    setShowEditDialog(true);
  };

  const handleEditSave = async () => {
    if (!editProfile || !editName.trim()) return;

    setSaving(true);
    try {
      await tauri.updateServerProfile(editProfile.id, editName, editDescription);
      toast.success(t('profiles.profileUpdated'));
      setShowEditDialog(false);
      onProfilesChange();
    } catch (e) {
      console.error("Error updating profile:", e);
      toast.error(t('profiles.errorUpdating', { error: e }));
    } finally {
      setSaving(false);
    }
  };

  const handleActivateClick = (profile: ServerProfile) => {
    if (serverRunning) {
      setProfileToActivate(profile);
    } else {
      handleActivateConfirm(profile);
    }
  };

  const handleActivateConfirm = async (profile?: ServerProfile) => {
    const targetProfile = profile || profileToActivate;
    if (!targetProfile) return;

    try {
      const result = await tauri.setActiveProfile(targetProfile.id);
      onProfileChange(result);
      toast.success(t('profiles.profileActivated', { name: result.name }));
    } catch (e) {
      console.error("Error activating profile:", e);
      toast.error(t('profiles.errorActivating', { error: e }));
    } finally {
      setProfileToActivate(null);
    }
  };

  return (
    <div className="flex-1 p-6">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold">{t('profiles.title')}</h1>
          <p className="text-muted-foreground">
            {t('profiles.subtitle')}
          </p>
        </div>
        <div className="flex gap-2">
          <Button onClick={handleCreateClick} variant="outline" className="gap-2">
            <Plus className="h-4 w-4" />
            {t('profiles.newProfile')}
          </Button>
          <Button onClick={handleImportClick} className="gap-2">
            <Upload className="h-4 w-4" />
            {t('profiles.importProfile')}
          </Button>
        </div>
      </div>

      <ScrollArea className="h-[calc(100vh-180px)]">
        <div className="grid gap-4">
          {profiles.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-muted-foreground">
                {t('profiles.noProfiles')}
              </CardContent>
            </Card>
          ) : (
            profiles.map((profile) => {
              const isActive = activeProfile?.id === profile.id;

              return (
                <Card
                  key={profile.id}
                  className={`transition-colors ${
                    isActive ? "border-primary bg-primary/5" : ""
                  }`}
                >
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-2">
                        <CardTitle className="text-lg">{profile.name}</CardTitle>
                        {profile.is_default && (
                          <Badge variant="secondary" className="gap-1">
                            <Star className="h-3 w-3" />
                            {t('profiles.main')}
                          </Badge>
                        )}
                        {isActive && (
                          <Badge variant="default" className="gap-1">
                            <Check className="h-3 w-3" />
                            {t('profiles.active')}
                          </Badge>
                        )}
                        {profile.imported_at && (
                          <Badge variant="outline">{t('profiles.imported')}</Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        {!isActive && (
                          <Button
                            variant="outline"
                            size="sm"
                            onClick={() => handleActivateClick(profile)}
                          >
                            {t('common.activate')}
                          </Button>
                        )}
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleEditClick(profile)}
                        >
                          <Edit2 className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleExportClick(profile)}
                        >
                          <Download className="h-4 w-4" />
                        </Button>
                        {!profile.is_default && (
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => handleDeleteClick(profile)}
                            className="text-destructive hover:text-destructive"
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    </div>
                    {profile.description && (
                      <CardDescription>{profile.description}</CardDescription>
                    )}
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 gap-4 text-sm text-muted-foreground">
                      <div className="flex items-center gap-2">
                        <FolderOpen className="h-4 w-4" />
                        <span className="truncate" title={profile.data_path}>
                          {profile.data_path}
                        </span>
                      </div>
                      <div className="flex items-center gap-2">
                        <Calendar className="h-4 w-4" />
                        <span>
                          {profile.imported_at
                            ? `${t('profiles.imported')}: ${formatDate(profile.imported_at)}`
                            : `${t('profiles.created')}: ${formatDate(profile.created_at)}`}
                        </span>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              );
            })
          )}
        </div>
      </ScrollArea>

      {/* Export Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('profiles.exportProfile')}</DialogTitle>
            <DialogDescription>
              {t('profiles.exportProfileDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="export-name">{t('profiles.profileName')}</Label>
              <Input
                id="export-name"
                value={exportName}
                onChange={(e) => setExportName(e.target.value)}
                placeholder="Mi Servidor"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="export-description">{t('common.description')} ({t('common.optional')})</Label>
              <Input
                id="export-description"
                value={exportDescription}
                onChange={(e) => setExportDescription(e.target.value)}
                placeholder="..."
              />
            </div>

            {exportPreview && (
              <div className="rounded-md bg-muted p-4 space-y-2">
                <p className="text-sm font-medium">{t('profiles.contentToExport')}</p>
                <div className="grid grid-cols-3 gap-4 text-sm text-muted-foreground">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4" />
                    <span>{t('profiles.modsCount', { count: exportPreview.mods_count })}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <HardDrive className="h-4 w-4" />
                    <span>{t('profiles.worldsCount', { count: exportPreview.saves_count })}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Check className="h-4 w-4" />
                    <span>{exportPreview.has_server_config ? t('profiles.configIncluded') : t('profiles.noConfig')}</span>
                  </div>
                </div>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowExportDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleExport} disabled={exporting || !exportName.trim()}>
              {exporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('common.export')}...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  {t('common.export')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Import Dialog */}
      <Dialog open={showImportDialog} onOpenChange={setShowImportDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('profiles.importProfile')}</DialogTitle>
            <DialogDescription>
              {t('profiles.importProfileDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label>{t('profiles.profileFile')}</Label>
              <div className="flex gap-2">
                <Input
                  value={importPath}
                  readOnly
                  placeholder={t('profiles.selectZipFile')}
                  className="flex-1"
                />
                <Button variant="outline" onClick={handleSelectImportFile}>
                  {t('common.browse')}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="import-name">{t('profiles.profileNameOptional')}</Label>
              <Input
                id="import-name"
                value={importName}
                onChange={(e) => setImportName(e.target.value)}
                placeholder={t('profiles.useFilenameIfEmpty')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowImportDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleImport} disabled={importing || !importPath}>
              {importing ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('common.import')}...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  {t('common.import')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Create Dialog */}
      <Dialog open={showCreateDialog} onOpenChange={setShowCreateDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('profiles.createProfile')}</DialogTitle>
            <DialogDescription>
              {t('profiles.createProfileDesc')}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="create-name">{t('profiles.profileName')}</Label>
              <Input
                id="create-name"
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Mi Servidor"
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="create-description">{t('common.description')} ({t('common.optional')})</Label>
              <Input
                id="create-description"
                value={createDescription}
                onChange={(e) => setCreateDescription(e.target.value)}
                placeholder="..."
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowCreateDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleCreate} disabled={creating || !createName.trim()}>
              {creating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {t('common.create')}...
                </>
              ) : (
                <>
                  <Plus className="mr-2 h-4 w-4" />
                  {t('common.create')}
                </>
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Edit Dialog */}
      <Dialog open={showEditDialog} onOpenChange={setShowEditDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('profiles.editProfile')}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">{t('common.name')}</Label>
              <Input
                id="edit-name"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="edit-description">{t('common.description')}</Label>
              <Input
                id="edit-description"
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder={t('common.optional')}
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setShowEditDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleEditSave} disabled={saving || !editName.trim()}>
              {saving ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation */}
      <AlertDialog open={!!profileToDelete} onOpenChange={() => setProfileToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('profiles.deleteProfile')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('profiles.deleteProfileConfirm', { name: profileToDelete?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteConfirm}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Activate Profile Confirmation (when server running) */}
      <AlertDialog open={!!profileToActivate} onOpenChange={() => setProfileToActivate(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('profiles.changeActiveProfile')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('profiles.serverRunningChangeProfile')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => handleActivateConfirm()}>
              {t('profiles.stopAndChange')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
