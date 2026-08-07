import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
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
  Package,
  RefreshCw,
  Search,
  Download,
  Trash2,
  ExternalLink,
  Folder,
  FileArchive,
  AlertCircle,
  Loader2,
  Server,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  ChevronUp,
  ArrowUpCircle,
  CheckCircle,
  Upload,
  FolderDown,
  Calendar,
} from "lucide-react";
import { Label } from "@/components/ui/label";
import { open } from "@tauri-apps/plugin-dialog";
import type { Settings, InstalledMod, ApiModSearchResult, ApiModDetails, ApiModRelease, ModpackProfile } from "@/lib/types";
import { Checkbox } from "@/components/ui/checkbox";
import { GearLoaderBlock } from "@/components/ui/gear-loader";
import * as tauri from "@/lib/tauri";
import { toast } from "sonner";

interface ModsViewProps {
  settings: Settings;
  serverRunning: boolean;
  serverVersion: string | null;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

function formatDownloads(downloads: number): string {
  if (downloads >= 1000000) {
    return `${(downloads / 1000000).toFixed(1)}M`;
  }
  if (downloads >= 1000) {
    return `${(downloads / 1000).toFixed(1)}K`;
  }
  return downloads.toString();
}

export function ModsView({ settings, serverRunning, serverVersion }: ModsViewProps) {
  const { t } = useTranslation();
  const [installedMods, setInstalledMods] = useState<InstalledMod[]>([]);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("installed");

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<ApiModSearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [gameVersions, setGameVersions] = useState<string[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<string>("all");
  const [orderBy, setOrderBy] = useState<string>("downloads");

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const itemsPerPage = 12;

  // Mod details dialog
  const [selectedMod, setSelectedMod] = useState<ApiModDetails | null>(null);
  const [loadingDetails, setLoadingDetails] = useState(false);
  const [showDetailsDialog, setShowDetailsDialog] = useState(false);

  // Download state
  const [downloading, setDownloading] = useState<string | null>(null);

  // Delete confirmation
  const [modToDelete, setModToDelete] = useState<InstalledMod | null>(null);

  // Update checking
  const [checkingUpdates, setCheckingUpdates] = useState(false);
  const [modUpdates, setModUpdates] = useState<Map<string, { version: string; downloadUrl: string; filename: string }>>(new Map());
  const [updatingMod, setUpdatingMod] = useState<string | null>(null);
  const [updatingAll, setUpdatingAll] = useState(false);

  // Modpack state
  const [showExportDialog, setShowExportDialog] = useState(false);
  const [modpackName, setModpackName] = useState("Mi Modpack");
  const [modpackDescription, setModpackDescription] = useState("");
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [selectedModsForExport, setSelectedModsForExport] = useState<Set<string>>(new Set());
  const [modpackProfiles, setModpackProfiles] = useState<ModpackProfile[]>([]);
  const [expandedModpack, setExpandedModpack] = useState<string | null>(null);

  const modsPath = settings.data_path ? `${settings.data_path}\\Mods` : "";

  const loadInstalledMods = async () => {
    if (!modsPath) return;
    setLoading(true);
    try {
      const mods = await tauri.listInstalledMods(modsPath);
      setInstalledMods(mods);
    } catch (e) {
      console.error("Error loading mods:", e);
      toast.error(t('mods.errorLoading', { error: e }));
    } finally {
      setLoading(false);
    }
  };

  const loadGameVersions = async () => {
    try {
      const versions = await tauri.getGameVersions();
      setGameVersions(versions);
      // Pre-select server version if available
      if (serverVersion && versions.includes(serverVersion)) {
        setSelectedVersion(serverVersion);
      }
    } catch (e) {
      console.error("Error loading game versions:", e);
    }
  };

  const loadModpackProfiles = async () => {
    if (!settings.data_path) return;
    try {
      const profiles = await tauri.listModpackProfiles(settings.data_path);
      setModpackProfiles(profiles);
    } catch (e) {
      console.error("Error loading modpack profiles:", e);
    }
  };

  useEffect(() => {
    loadInstalledMods();
    loadGameVersions();
    loadModpackProfiles();
  }, [settings.data_path]);

  const handleSearch = async () => {
    setSearching(true);
    setHasSearched(true);
    setCurrentPage(1); // Reset to first page on new search
    try {
      const version = selectedVersion === "all" ? undefined : selectedVersion;
      const results = await tauri.searchMods(searchQuery, version, orderBy);
      setSearchResults(results);
    } catch (e) {
      console.error("Error searching mods:", e);
      toast.error(t('mods.errorSearching', { error: e }));
    } finally {
      setSearching(false);
    }
  };

  // Pagination calculations
  const totalPages = Math.ceil(searchResults.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = startIndex + itemsPerPage;
  const paginatedResults = searchResults.slice(startIndex, endIndex);

  const goToPage = (page: number) => {
    setCurrentPage(Math.max(1, Math.min(page, totalPages)));
    // Scroll to top of results
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  // Compare version strings (returns true if v2 > v1)
  const isNewerVersion = (installed: string, available: string): boolean => {
    if (installed === "Unknown") return true;

    const normalize = (v: string) => v.replace(/^v/i, '').trim();
    const v1Parts = normalize(installed).split('.').map(n => parseInt(n) || 0);
    const v2Parts = normalize(available).split('.').map(n => parseInt(n) || 0);

    const maxLen = Math.max(v1Parts.length, v2Parts.length);
    for (let i = 0; i < maxLen; i++) {
      const a = v1Parts[i] || 0;
      const b = v2Parts[i] || 0;
      if (b > a) return true;
      if (b < a) return false;
    }
    return false;
  };

  const checkForUpdates = async () => {
    if (installedMods.length === 0) return;

    setCheckingUpdates(true);
    const updates = new Map<string, { version: string; downloadUrl: string; filename: string }>();

    try {
      for (const mod of installedMods) {
        try {
          // Try to find the mod in the API using modid
          const details = await tauri.getModDetails(mod.modid);

          if (details && details.releases && details.releases.length > 0) {
            // Get the latest release
            const latestRelease = details.releases[0];

            if (isNewerVersion(mod.version, latestRelease.modversion)) {
              updates.set(mod.modid, {
                version: latestRelease.modversion,
                downloadUrl: latestRelease.mainfile,
                filename: latestRelease.filename,
              });
            }
          }
        } catch (e) {
          // Mod not found in API, skip
          console.log(`Could not find mod ${mod.modid} in API`);
        }
      }

      setModUpdates(updates);

      if (updates.size === 0) {
        toast.success(t('mods.allUpToDate'));
      } else {
        toast.info(t('mods.updatesAvailable', { count: updates.size }));
      }
    } catch (e) {
      console.error("Error checking for updates:", e);
      toast.error(t('mods.errorCheckingUpdates'));
    } finally {
      setCheckingUpdates(false);
    }
  };

  const updateMod = async (mod: InstalledMod) => {
    const update = modUpdates.get(mod.modid);
    if (!update) return;

    if (serverRunning) {
      toast.error(t('mods.stopServerBeforeUpdate'));
      return;
    }

    setUpdatingMod(mod.modid);
    try {
      // Delete old mod (with backup)
      await tauri.deleteMod(mod.file_path, settings.backup_dir, true);

      // Download new version
      await tauri.downloadMod(update.downloadUrl, update.filename, modsPath);

      toast.success(t('mods.updated', { name: mod.name, version: update.version }));

      // Remove from updates map
      const newUpdates = new Map(modUpdates);
      newUpdates.delete(mod.modid);
      setModUpdates(newUpdates);

      // Reload mods list
      await loadInstalledMods();
    } catch (e) {
      console.error("Error updating mod:", e);
      toast.error(t('mods.errorUpdating', { name: mod.name, error: e }));
    } finally {
      setUpdatingMod(null);
    }
  };

  const updateAllMods = async () => {
    if (modUpdates.size === 0) return;

    if (serverRunning) {
      toast.error(t('mods.stopServerBeforeUpdate'));
      return;
    }

    setUpdatingAll(true);
    let successCount = 0;
    let failCount = 0;

    try {
      for (const mod of installedMods) {
        const update = modUpdates.get(mod.modid);
        if (!update) continue;

        setUpdatingMod(mod.modid);
        try {
          await tauri.deleteMod(mod.file_path, settings.backup_dir, true);
          await tauri.downloadMod(update.downloadUrl, update.filename, modsPath);
          successCount++;
        } catch (e) {
          console.error(`Error updating ${mod.name}:`, e);
          failCount++;
        }
      }

      if (successCount > 0) {
        toast.success(t('mods.modsUpdated', { count: successCount }));
      }
      if (failCount > 0) {
        toast.error(t('mods.modsFailed', { count: failCount }));
      }

      // Clear updates and reload
      setModUpdates(new Map());
      await loadInstalledMods();
    } catch (e) {
      console.error("Error updating mods:", e);
      toast.error("Error actualizando mods");
    } finally {
      setUpdatingMod(null);
      setUpdatingAll(false);
    }
  };

  const modsWithUpdates = installedMods.filter(mod => modUpdates.has(mod.modid));

  // Modpack functions
  const openExportDialog = () => {
    // Initialize with all mods selected
    setSelectedModsForExport(new Set(installedMods.map(m => m.file_path)));
    setShowExportDialog(true);
  };

  const toggleModForExport = (filePath: string) => {
    const newSet = new Set(selectedModsForExport);
    if (newSet.has(filePath)) {
      newSet.delete(filePath);
    } else {
      newSet.add(filePath);
    }
    setSelectedModsForExport(newSet);
  };

  const toggleAllModsForExport = (selectAll: boolean) => {
    if (selectAll) {
      setSelectedModsForExport(new Set(installedMods.map(m => m.file_path)));
    } else {
      setSelectedModsForExport(new Set());
    }
  };

  const handleExportModpack = async () => {
    if (selectedModsForExport.size === 0) {
      toast.error(t('mods.selectAtLeastOne'));
      return;
    }

    setExporting(true);
    try {
      const desktopPath = await tauri.getDesktopPath();
      const sanitizedName = modpackName.replace(/[<>:"/\\|?*]/g, "_");
      const outputPath = `${desktopPath}\\${sanitizedName}.zip`;

      await tauri.exportModpack(
        modsPath,
        outputPath,
        modpackName,
        modpackDescription,
        Array.from(selectedModsForExport)
      );
      toast.success(t('mods.exported', { name: `${sanitizedName}.zip` }));
      setShowExportDialog(false);
    } catch (e) {
      console.error("Error exporting modpack:", e);
      toast.error(t('mods.errorExporting', { error: e }));
    } finally {
      setExporting(false);
    }
  };

  const handleImportModpack = async () => {
    if (serverRunning) {
      toast.error(t('mods.stopServerBeforeImport'));
      return;
    }

    try {
      const selected = await open({
        title: t('mods.selectModpack'),
        filters: [{ name: "Modpack", extensions: ["zip"] }],
      });

      if (!selected) return;

      setImporting(true);
      const result = await tauri.importModpack(
        selected as string,
        modsPath,
        true,
        settings.backup_dir
      );

      // Save the modpack profile
      await tauri.saveModpackProfile(settings.data_path, result.profile);

      toast.success(t('mods.modpackImported', { name: result.profile.name, count: result.imported_mods.length }));
      await loadInstalledMods();
      await loadModpackProfiles();
    } catch (e) {
      console.error("Error importing modpack:", e);
      toast.error(t('mods.errorImporting', { error: e }));
    } finally {
      setImporting(false);
    }
  };

  const handleDeleteModpackProfile = async (profileId: string) => {
    try {
      await tauri.deleteModpackProfile(settings.data_path, profileId);
      toast.success(t('mods.modpackProfileDeleted'));
      await loadModpackProfiles();
    } catch (e) {
      console.error("Error deleting modpack profile:", e);
      toast.error(t('mods.errorDeletingProfile', { error: e }));
    }
  };

  const handleViewDetails = async (mod: ApiModSearchResult) => {
    setLoadingDetails(true);
    setShowDetailsDialog(true);
    try {
      const modId = mod.urlalias || mod.modid.toString();
      const details = await tauri.getModDetails(modId);
      setSelectedMod(details);
    } catch (e) {
      console.error("Error loading mod details:", e);
      toast.error(t('mods.errorDetails', { error: e }));
      setShowDetailsDialog(false);
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleDownload = async (release: ApiModRelease) => {
    if (!modsPath) {
      toast.error(t('mods.configureDataPath'));
      return;
    }
    if (serverRunning) {
      toast.error(t('mods.stopServerBeforeDownload'));
      return;
    }

    setDownloading(release.filename);
    try {
      await tauri.downloadMod(release.mainfile, release.filename, modsPath);
      toast.success(t('mods.downloaded', { name: release.filename }));
      await loadInstalledMods();
      setShowDetailsDialog(false);
    } catch (e) {
      console.error("Error downloading mod:", e);
      toast.error(t('mods.errorDownloading', { error: e }));
    } finally {
      setDownloading(null);
    }
  };

  const handleDelete = async () => {
    if (!modToDelete) return;
    if (serverRunning) {
      toast.error(t('mods.stopServerBeforeDelete'));
      return;
    }

    try {
      await tauri.deleteMod(modToDelete.file_path, settings.backup_dir, true);
      toast.success(t('mods.modDeleted', { name: modToDelete.name }));
      await loadInstalledMods();
    } catch (e) {
      console.error("Error deleting mod:", e);
      toast.error(t('mods.errorDeleting', { error: e }));
    } finally {
      setModToDelete(null);
    }
  };

  const getSideBadge = (side: string) => {
    switch (side.toLowerCase()) {
      case "server":
        return (
          <Badge variant="outline" className="mod-badge-server text-xs font-medium">
            <Server className="h-3 w-3 mr-1" />
            Server
          </Badge>
        );
      case "client":
        return (
          <Badge variant="outline" className="mod-badge-client text-xs font-medium">
            Client
          </Badge>
        );
      default:
        return (
          <Badge variant="outline" className="mod-badge-universal text-xs font-medium">
            Universal
          </Badge>
        );
    }
  };

  if (!settings.data_path) {
    return (
      <div className="p-6">
        <div className="flex items-center gap-3 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
          <AlertCircle className="h-5 w-5 text-destructive" />
          <p>{t('mods.configureDataPath')}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold flex items-center gap-2">
            <Package className="h-6 w-6" />
            {t('mods.title')}
          </h2>
          <p className="text-muted-foreground">{t('mods.subtitle')}</p>
        </div>
        <div className="flex items-center gap-3">
          {serverVersion && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-md">
              <Server className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-medium">v{serverVersion}</span>
            </div>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={checkForUpdates}
            disabled={loading || checkingUpdates || installedMods.length === 0}
          >
            {checkingUpdates ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <ArrowUpCircle className="h-4 w-4 mr-2" />
            )}
            {checkingUpdates ? t('mods.checking') : t('mods.checkUpdates')}
          </Button>
          <Button variant="outline" size="sm" onClick={loadInstalledMods} disabled={loading}>
            <RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />
            {t('mods.refresh')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={openExportDialog}
            disabled={loading || installedMods.length === 0}
          >
            <Upload className="h-4 w-4 mr-2" />
            {t('mods.export')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleImportModpack}
            disabled={loading || importing || serverRunning}
          >
            {importing ? (
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
            ) : (
              <FolderDown className="h-4 w-4 mr-2" />
            )}
            {importing ? t('mods.importing') : t('mods.import')}
          </Button>
        </div>
      </div>

      {serverRunning && (
        <div className="flex items-center gap-3 p-3 bg-destructive/10 border border-destructive/20 rounded-lg text-sm">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <p>{t('mods.serverRunningWarning')}</p>
        </div>
      )}

      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <TabsList>
          <TabsTrigger value="installed">
            {t('mods.installedTab')} ({installedMods.length})
          </TabsTrigger>
          <TabsTrigger value="browse">
            {t('mods.browseTab')}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="installed" className="mt-4 space-y-4">
          {/* Update All Banner */}
          {modsWithUpdates.length > 0 && (
            <Card className="border-primary/50 bg-primary/5">
              <CardContent className="py-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <ArrowUpCircle className="h-5 w-5 text-primary" />
                    <div>
                      <p className="font-medium">
                        {t('mods.updatesAvailable', { count: modsWithUpdates.length })}
                      </p>
                      <p className="text-sm text-muted-foreground">
                        {modsWithUpdates.map(m => m.name).join(", ")}
                      </p>
                    </div>
                  </div>
                  <Button
                    onClick={updateAllMods}
                    disabled={serverRunning || updatingAll}
                  >
                    {updatingAll ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Download className="h-4 w-4 mr-2" />
                    )}
                    {updatingAll ? t('mods.updating') : t('mods.updateAll')}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle>{t('mods.installedMods')}</CardTitle>
              <CardDescription>
                Mods en {modsPath}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <GearLoaderBlock size="md" />
              ) : installedMods.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Package className="h-12 w-12 mx-auto mb-3 opacity-50" />
                  <p>{t('mods.noMods')}</p>
                  <p className="text-sm mt-1">{t('mods.browseHint')}</p>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('common.name')}</TableHead>
                      <TableHead>{t('common.version')}</TableHead>
                      <TableHead>{t('mods.side')}</TableHead>
                      <TableHead>{t('common.size')}</TableHead>
                      <TableHead className="w-[80px]">{t('common.actions')}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {installedMods.map((mod) => (
                      <TableRow key={mod.file_path}>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {mod.is_folder ? (
                              <Folder className="h-4 w-4 text-muted-foreground" />
                            ) : (
                              <FileArchive className="h-4 w-4 text-muted-foreground" />
                            )}
                            <div>
                              <p className="font-medium">{mod.name}</p>
                              <p className="text-xs text-muted-foreground">{mod.file_name}</p>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            <Badge variant="outline">{mod.version}</Badge>
                            {modUpdates.has(mod.modid) && (
                              <Badge variant="default" className="bg-primary">
                                → {modUpdates.get(mod.modid)?.version}
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>{getSideBadge(mod.side)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          {formatBytes(mod.file_size)}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {modUpdates.has(mod.modid) ? (
                              <Button
                                variant="default"
                                size="icon"
                                className="h-8 w-8"
                                onClick={() => updateMod(mod)}
                                disabled={serverRunning || updatingMod === mod.modid}
                              >
                                {updatingMod === mod.modid ? (
                                  <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                  <ArrowUpCircle className="h-4 w-4" />
                                )}
                              </Button>
                            ) : modUpdates.size > 0 ? (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="h-8 w-8 text-green-500"
                                disabled
                              >
                                <CheckCircle className="h-4 w-4" />
                              </Button>
                            ) : null}
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-destructive hover:text-destructive"
                              onClick={() => setModToDelete(mod)}
                              disabled={serverRunning || updatingMod === mod.modid}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Modpacks Cargados Section */}
          {modpackProfiles.length > 0 && (
            <Card className="mt-4">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <FolderDown className="h-5 w-5" />
                  {t('mods.loadedModpacks')}
                </CardTitle>
                <CardDescription>
                  {t('mods.previouslyImported')}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="space-y-3">
                  {modpackProfiles.map((profile) => (
                    <div
                      key={profile.id}
                      className="border rounded-lg overflow-hidden"
                    >
                      <div
                        className="flex items-center justify-between p-4 cursor-pointer hover:bg-muted/50"
                        onClick={() => setExpandedModpack(expandedModpack === profile.id ? null : profile.id)}
                      >
                        <div className="flex items-center gap-3">
                          <Package className="h-5 w-5 text-primary" />
                          <div>
                            <p className="font-medium">{profile.name}</p>
                            <div className="flex items-center gap-3 text-xs text-muted-foreground">
                              <span className="flex items-center gap-1">
                                <Calendar className="h-3 w-3" />
                                {new Date(profile.imported_at).toLocaleDateString()}
                              </span>
                              <span>{profile.mods.length} mods</span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              handleDeleteModpackProfile(profile.id);
                            }}
                          >
                            <Trash2 className="h-4 w-4" />
                          </Button>
                          {expandedModpack === profile.id ? (
                            <ChevronUp className="h-5 w-5 text-muted-foreground" />
                          ) : (
                            <ChevronDown className="h-5 w-5 text-muted-foreground" />
                          )}
                        </div>
                      </div>
                      {expandedModpack === profile.id && (
                        <div className="border-t bg-muted/30 p-4">
                          {profile.description && (
                            <p className="text-sm text-muted-foreground mb-3">
                              {profile.description}
                            </p>
                          )}
                          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {profile.mods.map((mod) => (
                              <div
                                key={mod.modid}
                                className="flex items-center gap-2 p-2 bg-background rounded border"
                              >
                                <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium truncate">{mod.name}</p>
                                  <p className="text-xs text-muted-foreground truncate">v{mod.version}</p>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="browse" className="mt-4 space-y-4">
          {/* Search Panel */}
          <div className="mod-search-panel rounded-lg p-5 space-y-4">
            <div className="flex items-center gap-2 mb-1">
              <Search className="h-5 w-5 text-muted-foreground" />
              <h3 className="font-semibold">{t('mods.searchMods')}</h3>
            </div>

            {/* Search Input Row */}
            <div className="flex gap-2">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  placeholder={t('mods.searchPlaceholder')}
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleSearch()}
                  className="pl-9 h-11 mod-search-input"
                />
              </div>
              <Button
                onClick={handleSearch}
                disabled={searching}
                className="h-11 px-6 mod-search-button"
              >
                {searching ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <>
                    <Search className="h-4 w-4 mr-2" />
                    {t('common.search')}
                  </>
                )}
              </Button>
            </div>

            {/* Filters Row */}
            <div className="flex items-center gap-4 pt-2 border-t border-border/50">
              <div className="flex items-center gap-2">
                <span className="mod-filter-label">{t('common.version')}</span>
                <Select value={selectedVersion} onValueChange={setSelectedVersion}>
                  <SelectTrigger className="w-[130px] h-9">
                    <SelectValue placeholder={t('common.version')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">{t('mods.allVersions')}</SelectItem>
                    {gameVersions.map((v) => (
                      <SelectItem key={v} value={v}>{v}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <span className="mod-filter-label">{t('mods.orderBy')}</span>
                <Select value={orderBy} onValueChange={setOrderBy}>
                  <SelectTrigger className="w-[140px] h-9">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="downloads">{t('mods.downloads')}</SelectItem>
                    <SelectItem value="lastreleased">{t('mods.recent')}</SelectItem>
                    <SelectItem value="trending">{t('mods.trending')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>

          {!hasSearched ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-card/30">
              <div className="py-16 px-4">
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted/50 mb-4">
                    <Package className="h-10 w-10 mod-empty-icon" />
                  </div>
                  <h3 className="text-lg font-medium mb-2">{t('mods.searchToStart')}</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {t('mods.searchHint')}
                  </p>
                </div>
              </div>
            </div>
          ) : searchResults.length === 0 ? (
            <div className="rounded-lg border border-dashed border-border/70 bg-card/30">
              <div className="py-16 px-4">
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-20 h-20 rounded-full bg-muted/50 mb-4">
                    <Search className="h-10 w-10 mod-empty-icon" />
                  </div>
                  <h3 className="text-lg font-medium mb-2">{t('mods.noResults')}</h3>
                  <p className="text-sm text-muted-foreground max-w-sm mx-auto">
                    {t('mods.tryOtherTerms')}
                  </p>
                </div>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between text-sm text-muted-foreground mb-2">
                <span>{t('mods.modsFound', { count: searchResults.length })}</span>
                <span>{t('mods.page', { current: currentPage, total: totalPages })}</span>
              </div>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {paginatedResults.map((mod) => (
                  <div
                    key={mod.modid}
                    className="mod-card rounded-lg bg-card cursor-pointer"
                    onClick={() => handleViewDetails(mod)}
                  >
                    <div className="p-4">
                      {/* Header with logo and info */}
                      <div className="flex gap-4">
                        <div className="mod-logo-container w-20 h-20 flex-shrink-0">
                          {mod.logo ? (
                            <img
                              src={mod.logo}
                              alt={mod.name}
                              className="w-full h-full object-cover"
                            />
                          ) : (
                            <div className="w-full h-full flex items-center justify-center">
                              <Package className="h-10 w-10 text-muted-foreground/50" />
                            </div>
                          )}
                        </div>
                        <div className="flex-1 min-w-0 py-0.5">
                          <h3 className="font-semibold text-base leading-tight mb-1 truncate">
                            {mod.name}
                          </h3>
                          <p className="text-sm text-muted-foreground mb-2">
                            {t('mods.by')} {mod.author}
                          </p>
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="mod-download-badge">
                              <Download className="h-3 w-3" />
                              {formatDownloads(mod.downloads)}
                            </span>
                            {mod.side && getSideBadge(mod.side)}
                          </div>
                        </div>
                      </div>

                      {/* Description */}
                      {mod.summary && (
                        <p className="text-sm text-muted-foreground mt-3 line-clamp-2 leading-relaxed">
                          {mod.summary}
                        </p>
                      )}

                      {/* View details hint */}
                      <div className="mt-3 pt-3 border-t border-border/50">
                        <span className="text-xs text-muted-foreground flex items-center gap-1">
                          <ChevronRight className="h-3 w-3" />
                          {t('mods.viewDetails')}
                        </span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              {/* Pagination Controls */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-1.5 mt-8">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goToPage(currentPage - 1)}
                    disabled={currentPage === 1}
                    className="h-9 w-9 p-0"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </Button>

                  {/* Page numbers */}
                  <div className="flex items-center gap-1">
                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                      .filter(page => {
                        if (page === 1 || page === totalPages) return true;
                        if (Math.abs(page - currentPage) <= 1) return true;
                        return false;
                      })
                      .map((page, index, array) => {
                        const prevPage = array[index - 1];
                        const showEllipsis = prevPage && page - prevPage > 1;

                        return (
                          <div key={page} className="flex items-center gap-1">
                            {showEllipsis && (
                              <span className="px-2 text-muted-foreground text-sm">...</span>
                            )}
                            <Button
                              variant="outline"
                              size="sm"
                              className={`w-9 h-9 p-0 font-medium ${
                                currentPage === page ? "mod-pagination-active" : ""
                              }`}
                              onClick={() => goToPage(page)}
                            >
                              {page}
                            </Button>
                          </div>
                        );
                      })}
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => goToPage(currentPage + 1)}
                    disabled={currentPage === totalPages}
                    className="h-9 w-9 p-0"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                </div>
              )}
            </>
          )}
        </TabsContent>
      </Tabs>

      {/* Mod Details Dialog */}
      <Dialog open={showDetailsDialog} onOpenChange={setShowDetailsDialog}>
        <DialogContent className="max-w-2xl max-h-[85vh] p-0 gap-0 overflow-hidden">
          {loadingDetails ? (
            <div className="py-10">
              <GearLoaderBlock size="lg" label={t('common.loading')} />
            </div>
          ) : selectedMod ? (
            <>
              {/* Header Section */}
              <div className="mod-dialog-header p-6">
                <div className="flex gap-4">
                  <div className="mod-logo-container w-16 h-16 flex-shrink-0">
                    {selectedMod.logo ? (
                      <img
                        src={selectedMod.logo}
                        alt={selectedMod.name}
                        className="w-full h-full object-cover"
                      />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center">
                        <Package className="h-8 w-8 text-muted-foreground/50" />
                      </div>
                    )}
                  </div>
                  <div className="flex-1 min-w-0">
                    <DialogTitle className="text-xl font-semibold mb-1">
                      {selectedMod.name}
                    </DialogTitle>
                    <p className="text-sm text-muted-foreground mb-2">
                      {t('mods.by')} {selectedMod.author}
                    </p>
                    <div className="flex items-center gap-3 flex-wrap">
                      <span className="mod-download-badge">
                        <Download className="h-3 w-3" />
                        {formatDownloads(selectedMod.downloads)}
                      </span>
                      {selectedMod.side && getSideBadge(selectedMod.side)}
                      <a
                        href={`https://mods.vintagestory.at/${selectedMod.urlalias || selectedMod.modid}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-sm text-primary hover:underline inline-flex items-center gap-1"
                        onClick={(e) => e.stopPropagation()}
                      >
                        <ExternalLink className="h-3 w-3" />
                        {t('mods.viewOnWeb')}
                      </a>
                    </div>
                  </div>
                </div>
              </div>

              {/* Content Section */}
              <ScrollArea className="max-h-[55vh]">
                <div className="px-6 pb-6 space-y-5">
                  {/* Description */}
                  {selectedMod.text && (
                    <div>
                      <h4 className="mod-section-title text-sm mb-3">
                        <FileArchive className="h-4 w-4 text-muted-foreground" />
                        {t('common.description')}
                      </h4>
                      <p className="text-sm text-muted-foreground whitespace-pre-wrap leading-relaxed">
                        {selectedMod.text.replace(/<[^>]*>/g, "")}
                      </p>
                    </div>
                  )}

                  {/* Available Versions */}
                  <div>
                    <h4 className="mod-section-title text-sm mb-3">
                      <Package className="h-4 w-4 text-muted-foreground" />
                      {t('mods.availableVersions')}
                    </h4>
                    <div className="space-y-2">
                      {selectedMod.releases.slice(0, 5).map((release, index) => (
                        <div
                          key={release.releaseid}
                          className={`mod-release-card p-3 ${index === 0 ? 'ring-1 ring-primary/20' : ''}`}
                        >
                          <div className="flex items-center justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 mb-1">
                                <p className="font-semibold text-sm">{release.modversion}</p>
                                {index === 0 && (
                                  <Badge variant="outline" className="mod-badge-universal text-[10px] px-1.5 py-0">
                                    Latest
                                  </Badge>
                                )}
                              </div>
                              <p className="text-xs text-muted-foreground truncate mb-1.5">
                                {release.filename}
                              </p>
                              <div className="flex gap-1 flex-wrap">
                                {release.tags.slice(0, 4).map((tag) => (
                                  <Badge key={tag} variant="outline" className="text-[10px] px-1.5 py-0 font-normal">
                                    {tag}
                                  </Badge>
                                ))}
                              </div>
                            </div>
                            <Button
                              size="sm"
                              onClick={() => handleDownload(release)}
                              disabled={downloading === release.filename || serverRunning}
                              className="flex-shrink-0 mod-search-button"
                            >
                              {downloading === release.filename ? (
                                <Loader2 className="h-4 w-4 animate-spin" />
                              ) : (
                                <>
                                  <Download className="h-4 w-4 mr-1.5" />
                                  {t('mods.download')}
                                </>
                              )}
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </ScrollArea>
            </>
          ) : null}
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={!!modToDelete} onOpenChange={() => setModToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('mods.deleteMod')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('mods.deleteModConfirm', { name: modToDelete?.name })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              {t('common.delete')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Export Modpack Dialog */}
      <Dialog open={showExportDialog} onOpenChange={setShowExportDialog}>
        <DialogContent className="max-w-2xl max-h-[80vh]">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              {t('mods.exportModpack')}
            </DialogTitle>
            <DialogDescription>
              {t('mods.selectModsToExport')}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="modpack-name">{t('mods.modpackName')}</Label>
                <Input
                  id="modpack-name"
                  value={modpackName}
                  onChange={(e) => setModpackName(e.target.value)}
                  placeholder="Mi Modpack"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="modpack-description">{t('mods.modpackDescription')}</Label>
                <Input
                  id="modpack-description"
                  value={modpackDescription}
                  onChange={(e) => setModpackDescription(e.target.value)}
                  placeholder="..."
                />
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label>{t('mods.modsToInclude')}</Label>
                <div className="flex gap-2">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleAllModsForExport(true)}
                  >
                    {t('mods.selectAll')}
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => toggleAllModsForExport(false)}
                  >
                    {t('mods.deselectAll')}
                  </Button>
                </div>
              </div>
              <ScrollArea className="h-[300px] border rounded-lg p-3">
                <div className="space-y-2">
                  {installedMods.map((mod) => (
                    <div
                      key={mod.file_path}
                      className="flex items-center gap-3 p-2 rounded hover:bg-muted cursor-pointer"
                      onClick={() => toggleModForExport(mod.file_path)}
                    >
                      <Checkbox
                        checked={selectedModsForExport.has(mod.file_path)}
                        onCheckedChange={() => toggleModForExport(mod.file_path)}
                      />
                      <div className="flex items-center gap-2 flex-1 min-w-0">
                        {mod.is_folder ? (
                          <Folder className="h-4 w-4 text-muted-foreground shrink-0" />
                        ) : (
                          <FileArchive className="h-4 w-4 text-muted-foreground shrink-0" />
                        )}
                        <div className="min-w-0">
                          <p className="font-medium truncate">{mod.name}</p>
                          <p className="text-xs text-muted-foreground truncate">{mod.version}</p>
                        </div>
                      </div>
                      <Badge variant="outline" className="shrink-0">
                        {formatBytes(mod.file_size)}
                      </Badge>
                    </div>
                  ))}
                </div>
              </ScrollArea>
            </div>

            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Package className="h-5 w-5 text-muted-foreground" />
              <span className="text-sm">
                {t('mods.willExport', { selected: selectedModsForExport.size, total: installedMods.length })}
              </span>
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setShowExportDialog(false)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleExportModpack} disabled={exporting || !modpackName.trim() || selectedModsForExport.size === 0}>
              {exporting ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Upload className="h-4 w-4 mr-2" />
              )}
              {exporting ? t('mods.exporting') : t('mods.exportToDesktop')}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
