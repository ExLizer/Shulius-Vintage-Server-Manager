import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Archive,
  RefreshCw,
  Trash2,
  AlertTriangle,
  HardDrive,
  Package,
  FileQuestion,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { GearLoaderBlock } from "@/components/ui/gear-loader";
import * as tauri from "@/lib/tauri";
import type { BackupEntry } from "@/lib/tauri";
import type { Settings } from "@/lib/types";

type Filter = "all" | "save" | "mod" | "orphan";

interface BackupsViewProps {
  settings: Settings;
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function formatDate(unix: number): string {
  if (unix === 0) return "—";
  return new Date(unix * 1000).toLocaleString();
}

export function BackupsView({ settings }: BackupsViewProps) {
  const { t } = useTranslation();
  const [entries, setEntries] = useState<BackupEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState<Filter>("all");
  const [confirmTarget, setConfirmTarget] = useState<
    null | { paths: string[]; label: string }
  >(null);

  const load = useCallback(async () => {
    if (!settings.backup_dir) return;
    setLoading(true);
    try {
      const savesDir = settings.data_path
        ? `${settings.data_path}\\Saves`
        : undefined;
      const data = await tauri.listBackups(settings.backup_dir, savesDir);
      setEntries(data);
      setSelected(new Set());
    } catch (err) {
      toast.error(String(err));
    } finally {
      setLoading(false);
    }
  }, [settings.backup_dir, settings.data_path]);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    if (filter === "all") return entries;
    if (filter === "orphan") return entries.filter((e) => e.orphan);
    return entries.filter((e) => e.kind === filter);
  }, [entries, filter]);

  const totals = useMemo(() => {
    const all = entries.reduce(
      (acc, e) => {
        acc.bytes += e.size_bytes;
        acc.count += 1;
        if (e.orphan) acc.orphan += 1;
        if (e.kind === "save") acc.save += 1;
        if (e.kind === "mod") acc.mod += 1;
        return acc;
      },
      { bytes: 0, count: 0, save: 0, mod: 0, orphan: 0 }
    );
    return all;
  }, [entries]);

  const selectedBytes = useMemo(() => {
    return entries
      .filter((e) => selected.has(e.file_path))
      .reduce((acc, e) => acc + e.size_bytes, 0);
  }, [entries, selected]);

  const toggleOne = (path: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const toggleAllVisible = () => {
    const allSelected =
      filtered.length > 0 && filtered.every((e) => selected.has(e.file_path));
    setSelected((prev) => {
      const next = new Set(prev);
      if (allSelected) {
        for (const e of filtered) next.delete(e.file_path);
      } else {
        for (const e of filtered) next.add(e.file_path);
      }
      return next;
    });
  };

  // Agrupar para mostrar "ocupa X MB en N copias" por base.
  const groups = useMemo(() => {
    const map = new Map<
      string,
      { base: string; kind: string; entries: BackupEntry[]; bytes: number }
    >();
    for (const e of filtered) {
      const key = `${e.kind}|${e.base_name}`;
      const g = map.get(key);
      if (g) {
        g.entries.push(e);
        g.bytes += e.size_bytes;
      } else {
        map.set(key, {
          base: e.base_name,
          kind: e.kind,
          entries: [e],
          bytes: e.size_bytes,
        });
      }
    }
    // Mostrar grupos ordenados por bytes desc — los que mas ocupan arriba.
    return Array.from(map.values()).sort((a, b) => b.bytes - a.bytes);
  }, [filtered]);

  const handleDeleteSelected = () => {
    if (selected.size === 0) return;
    setConfirmTarget({
      paths: Array.from(selected),
      label: t("backups.confirmDeleteSelected", { count: selected.size }),
    });
  };

  const handleDeleteOrphans = () => {
    const paths = entries.filter((e) => e.orphan).map((e) => e.file_path);
    if (paths.length === 0) {
      toast.info(t("backups.noOrphans"));
      return;
    }
    setConfirmTarget({
      paths,
      label: t("backups.confirmDeleteOrphans", { count: paths.length }),
    });
  };

  const handleDeleteGroup = (paths: string[], baseName: string) => {
    setConfirmTarget({
      paths,
      label: t("backups.confirmDeleteGroup", {
        count: paths.length,
        name: baseName,
      }),
    });
  };

  const confirmDelete = async () => {
    if (!confirmTarget) return;
    try {
      const freed = await tauri.deleteBackups(confirmTarget.paths);
      toast.success(
        t("backups.deletedToast", {
          count: confirmTarget.paths.length,
          freed: formatBytes(freed),
        })
      );
      setConfirmTarget(null);
      load();
    } catch (err) {
      toast.error(String(err));
      setConfirmTarget(null);
    }
  };

  if (!settings.backup_dir) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="pt-6 text-center text-muted-foreground text-sm">
            {t("backups.noBackupDir")}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-3 min-w-0">
          <Archive className="h-5 w-5 text-[hsl(var(--ember))]" />
          <div className="min-w-0">
            <h2 className="text-xl font-semibold">{t("backups.title")}</h2>
            <p className="text-xs text-muted-foreground font-mono truncate">
              {settings.backup_dir}
            </p>
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={load} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>

      <Card>
        <CardContent className="pt-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Stat label={t("backups.totalSize")} value={formatBytes(totals.bytes)} />
          <Stat label={t("backups.totalFiles")} value={String(totals.count)} />
          <Stat
            label={t("backups.saveBackups")}
            value={String(totals.save)}
            icon={<HardDrive className="h-3 w-3" />}
          />
          <Stat
            label={t("backups.orphans")}
            value={String(totals.orphan)}
            warn={totals.orphan > 0}
            icon={<AlertTriangle className="h-3 w-3" />}
          />
        </CardContent>
      </Card>

      <div className="flex items-center gap-2 flex-wrap">
        <FilterChip active={filter === "all"} onClick={() => setFilter("all")}>
          {t("backups.filterAll")} ({totals.count})
        </FilterChip>
        <FilterChip active={filter === "save"} onClick={() => setFilter("save")}>
          {t("backups.filterSaves")} ({totals.save})
        </FilterChip>
        <FilterChip active={filter === "mod"} onClick={() => setFilter("mod")}>
          {t("backups.filterMods")} ({totals.mod})
        </FilterChip>
        <FilterChip
          active={filter === "orphan"}
          onClick={() => setFilter("orphan")}
          tone="warn"
        >
          {t("backups.filterOrphans")} ({totals.orphan})
        </FilterChip>
        <div className="ml-auto flex items-center gap-2">
          {totals.orphan > 0 && (
            <Button
              variant="outline"
              size="sm"
              onClick={handleDeleteOrphans}
              className="text-[hsl(35_85%_60%)] border-[hsl(35_60%_30%)]"
            >
              <AlertTriangle className="h-3.5 w-3.5 mr-1.5" />
              {t("backups.deleteOrphans", { count: totals.orphan })}
            </Button>
          )}
          {selected.size > 0 && (
            <Button
              variant="destructive"
              size="sm"
              onClick={handleDeleteSelected}
            >
              <Trash2 className="h-3.5 w-3.5 mr-1.5" />
              {t("backups.deleteSelected", {
                count: selected.size,
                freed: formatBytes(selectedBytes),
              })}
            </Button>
          )}
        </div>
      </div>

      <Card>
        <CardContent className="pt-4 space-y-3">
          {groups.length === 0 ? (
            loading ? (
              <GearLoaderBlock size="md" label={t("common.loading")} />
            ) : (
              <p className="text-center text-muted-foreground text-sm py-8">
                {t("backups.empty")}
              </p>
            )
          ) : (
            groups.map((g) => (
              <BackupGroup
                key={`${g.kind}|${g.base}`}
                group={g}
                selected={selected}
                onToggle={toggleOne}
                onDeleteGroup={() =>
                  handleDeleteGroup(
                    g.entries.map((e) => e.file_path),
                    g.base
                  )
                }
              />
            ))
          )}
        </CardContent>
      </Card>

      {filtered.length > 0 && (
        <div className="flex items-center justify-between text-xs text-muted-foreground pl-1">
          <button
            type="button"
            onClick={toggleAllVisible}
            className="underline hover:text-foreground transition-colors"
          >
            {filtered.every((e) => selected.has(e.file_path))
              ? t("backups.unselectAllVisible")
              : t("backups.selectAllVisible")}
          </button>
          <span>
            {t("backups.retentionHint", { keep: settings.keep_backups })}
          </span>
        </div>
      )}

      <AlertDialog
        open={confirmTarget !== null}
        onOpenChange={(o) => !o && setConfirmTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <Trash2 className="h-5 w-5 text-destructive" />
              {t("backups.confirmTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {confirmTarget?.label}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={confirmDelete}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("common.confirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Stat({
  label,
  value,
  warn,
  icon,
}: {
  label: string;
  value: string;
  warn?: boolean;
  icon?: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </p>
      <p
        className={`text-lg font-semibold ${
          warn ? "text-[hsl(35_85%_60%)]" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children,
  tone,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
  tone?: "warn";
}) {
  const base = "px-2.5 py-1 rounded-md text-xs font-medium transition-colors";
  const inactive =
    "border border-[hsl(30_15%_22%)] text-muted-foreground hover:border-[hsl(30_25%_32%)] hover:text-foreground";
  const activeCls =
    tone === "warn"
      ? "bg-[hsl(35_60%_30%)] text-[hsl(35_90%_85%)] border border-[hsl(35_60%_40%)]"
      : "bg-[hsl(var(--ember)/0.2)] text-foreground border border-[hsl(var(--ember)/0.6)]";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${base} ${active ? activeCls : inactive}`}
    >
      {children}
    </button>
  );
}

function BackupGroup({
  group,
  selected,
  onToggle,
  onDeleteGroup,
}: {
  group: {
    base: string;
    kind: string;
    entries: BackupEntry[];
    bytes: number;
  };
  selected: Set<string>;
  onToggle: (path: string) => void;
  onDeleteGroup: () => void;
}) {
  const { t } = useTranslation();
  const Icon =
    group.kind === "save"
      ? HardDrive
      : group.kind === "mod"
      ? Package
      : FileQuestion;
  const hasOrphan = group.entries.some((e) => e.orphan);

  return (
    <div className="rounded-md border border-[hsl(30_15%_22%)] bg-[hsl(200_25%_10%)]">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[hsl(30_15%_22%)]">
        <div className="flex items-center gap-2 min-w-0">
          <Icon className="h-4 w-4 text-muted-foreground shrink-0" />
          <span className="font-medium truncate">{group.base}</span>
          {hasOrphan && (
            <Badge
              variant="outline"
              className="text-[9px] border-[hsl(35_60%_40%)] text-[hsl(35_85%_60%)]"
            >
              <AlertTriangle className="h-2.5 w-2.5 mr-0.5" />
              {t("backups.orphanBadge")}
            </Badge>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="text-xs text-muted-foreground font-mono">
            {group.entries.length} × {formatBytes(group.bytes)}
          </span>
          <Button
            variant="ghost"
            size="icon"
            onClick={onDeleteGroup}
            title={t("backups.deleteGroup")}
            className="h-7 w-7"
          >
            <Trash2 className="h-3.5 w-3.5 text-destructive" />
          </Button>
        </div>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8"></TableHead>
            <TableHead>{t("backups.fileName")}</TableHead>
            <TableHead className="w-32">{t("backups.size")}</TableHead>
            <TableHead className="w-44">{t("backups.modified")}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {group.entries.map((e) => (
            <TableRow key={e.file_path}>
              <TableCell>
                <Checkbox
                  checked={selected.has(e.file_path)}
                  onCheckedChange={() => onToggle(e.file_path)}
                />
              </TableCell>
              <TableCell className="font-mono text-xs truncate max-w-[400px]">
                {e.file_name}
                {e.orphan && (
                  <Badge
                    variant="outline"
                    className="ml-1.5 text-[9px] border-[hsl(35_60%_40%)] text-[hsl(35_85%_60%)]"
                  >
                    {t("backups.orphanBadge")}
                  </Badge>
                )}
              </TableCell>
              <TableCell className="font-mono text-xs">
                {formatBytes(e.size_bytes)}
              </TableCell>
              <TableCell className="font-mono text-xs text-muted-foreground">
                {formatDate(e.modified_unix)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
