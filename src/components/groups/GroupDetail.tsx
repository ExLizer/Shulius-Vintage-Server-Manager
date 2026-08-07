import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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
import {
  ArrowLeft,
  Plus,
  Crown,
  Shield,
  User as UserIcon,
  Globe,
  Copy,
  Check,
  RefreshCw,
  Lock,
  Unlock,
  Trash2,
  CloudDownload,
  CloudUpload,
  Settings as SettingsIcon,
  AlertTriangle,
} from "lucide-react";
import { open as openDialog } from "@tauri-apps/plugin-dialog";
import { toast } from "sonner";
import {
  pb,
  rpc,
  getErrorMessage,
  userToProfile,
  requirePbUrl,
  type Group,
  type GroupMember,
  type Invite,
  type Profile,
  type World,
  type UserRecord,
} from "@/lib/pocketbase";
import { useAuth } from "@/hooks/useAuth";
import { usePbRealtimeRefetch } from "@/hooks/usePbRealtimeRefetch";
import { PresenceDot } from "@/components/ui/presence-dot";
import * as tauri from "@/lib/tauri";
import type { Settings, SaveInfo, ServerProfile } from "@/lib/types";
import type { UploadProgress } from "@/lib/tauri";
import { listen } from "@tauri-apps/api/event";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

interface GroupDetailProps {
  group: Group;
  settings: Settings;
  onProfilesChange?: () => void;
  onBack: () => void;
}

interface MemberRow extends GroupMember {
  profile: Profile | null;
}

export function GroupDetail({ group, settings, onProfilesChange, onBack }: GroupDetailProps) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [tab, setTab] = useState<"worlds" | "members" | "invites" | "settings">("worlds");
  const [members, setMembers] = useState<MemberRow[]>([]);
  const [worlds, setWorlds] = useState<World[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [profiles, setProfiles] = useState<Map<string, Profile>>(new Map());
  const [loading, setLoading] = useState(true);

  const myRole: GroupMember["role"] | null =
    members.find((m) => m.user === session?.id)?.role ?? null;
  const isAdmin = myRole === "owner" || myRole === "admin";

  // Re-evaluate lock expiry every 30s so the active-session banner disappears
  // when a lock times out without anyone touching it.
  const [, setHeaderTick] = useState(0);
  useEffect(() => {
    const i = setInterval(() => setHeaderTick((t) => t + 1), 30_000);
    return () => clearInterval(i);
  }, []);

  // Active sessions: worlds with a live (non-expired) lock by some user.
  // Used both for the top-of-group "playing now" banner and to highlight
  // the holder cell in the worlds table.
  const activeSessions = worlds
    .filter(
      (w) =>
        !!w.current_holder &&
        (!w.lock_expires_at || new Date(w.lock_expires_at) > new Date())
    )
    .map((w) => ({
      worldId: w.id,
      worldName: w.name,
      holder: profiles.get(w.current_holder) ?? null,
      holderId: w.current_holder,
      isMe: w.current_holder === session?.id,
    }));

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [memberRows, worldsData, invitesData] = await Promise.all([
        pb.collection("group_members").getFullList<GroupMember>({
          filter: `group = "${group.id}"`,
          expand: "user",
        }),
        pb.collection("worlds").getFullList<World>({
          filter: `group = "${group.id}"`,
          sort: "created",
        }),
        pb.collection("invites").getFullList<Invite>({
          filter: `group = "${group.id}"`,
          sort: "-created",
        }),
      ]);

      const enrichedMembers: MemberRow[] = memberRows.map((m) => ({
        ...m,
        profile: userToProfile(m.expand?.user as UserRecord | undefined),
      }));
      setMembers(enrichedMembers);
      setWorlds(worldsData);
      setInvites(invitesData);

      const map = new Map<string, Profile>();
      for (const m of enrichedMembers) {
        if (m.profile) map.set(m.profile.id, m.profile);
      }
      setProfiles(map);
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [group.id]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  // Realtime: refetcheo cuando alguien adquiere/libera lock, crea o borra un
  // mundo, modifica miembros o invites del grupo actual. PocketBase emite via
  // SSE filtrado server-side por las reglas de acceso de cada coleccion.
  const groupFilter = `group = "${group.id}"`;
  usePbRealtimeRefetch({ collection: "worlds", filter: groupFilter, onChange: loadAll });
  usePbRealtimeRefetch({ collection: "group_members", filter: groupFilter, onChange: loadAll });
  usePbRealtimeRefetch({ collection: "invites", filter: groupFilter, onChange: loadAll });

  // Caso especial: si el grupo en si se borra (delete event sobre el record
  // groups con id = group.id), salimos del detail para evitar quedar en una
  // vista huerfana con header pero sin data.
  usePbRealtimeRefetch({
    collection: "groups",
    filter: `id = "${group.id}"`,
    onChange: () => {
      // No-op: el delete se maneja en onEvent. El update (rename del grupo)
      // tampoco lo refetcheamos aca porque el header viene de props del padre.
    },
    onEvent: (e) => {
      if (e.action === "delete" && e.record.id === group.id) {
        toast.info(t("groups.deletedExternally"));
        onBack();
      }
    },
  });

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3 min-w-0">
          <Button variant="ghost" size="icon" onClick={onBack}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-0">
            <h2 className="text-xl font-semibold flex items-center gap-2">
              <span className="truncate">{group.name}</span>
              <span className="text-sm font-mono text-muted-foreground">
                #{group.discriminator}
              </span>
            </h2>
            {myRole && (
              <Badge variant="outline" className="mt-1 text-[10px] gap-1">
                <RoleIcon role={myRole} />
                {t(`groups.role.${myRole}`)}
              </Badge>
            )}
          </div>
        </div>
        <Button variant="ghost" size="icon" onClick={loadAll} disabled={loading}>
          <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
        </Button>
      </div>

      {activeSessions.length > 0 && (
        <div className="flex flex-col gap-1.5 rounded-md border border-[hsl(var(--emerald))]/30 bg-[hsl(var(--emerald))]/[0.06] px-3 py-2">
          {activeSessions.map((s) => (
            <div key={s.worldId} className="flex items-center gap-2 text-sm">
              <PresenceDot />
              <span className="font-medium">
                {s.isMe
                  ? t("groups.presence.youAreRunning", { world: s.worldName })
                  : t("groups.presence.userIsRunning", {
                      user: s.holder?.display_name ?? t("groups.presence.unknownUser"),
                      world: s.worldName,
                    })}
              </span>
            </div>
          ))}
        </div>
      )}

      <Tabs value={tab} onValueChange={(v) => setTab(v as typeof tab)}>
        <TabsList>
          <TabsTrigger value="worlds">
            <Globe className="h-4 w-4 mr-1.5" />
            {t("groups.tabs.worlds")} ({worlds.length})
          </TabsTrigger>
          <TabsTrigger value="members">
            <UserIcon className="h-4 w-4 mr-1.5" />
            {t("groups.tabs.members")} ({members.length})
          </TabsTrigger>
          <TabsTrigger value="invites">
            <Copy className="h-4 w-4 mr-1.5" />
            {t("groups.tabs.invites")} ({invites.length})
          </TabsTrigger>
          {isAdmin && (
            <TabsTrigger value="settings">
              <SettingsIcon className="h-4 w-4 mr-1.5" />
              {t("groups.tabs.settings")}
            </TabsTrigger>
          )}
        </TabsList>

        <TabsContent value="worlds" className="mt-3">
          <WorldsTab
            group={group}
            worlds={worlds}
            profiles={profiles}
            isAdmin={isAdmin}
            settings={settings}
            onChange={loadAll}
            onProfilesChange={onProfilesChange}
          />
        </TabsContent>

        <TabsContent value="members" className="mt-3">
          <MembersTab members={members} myUserId={session?.id ?? null} isAdmin={isAdmin} onChange={loadAll} />
        </TabsContent>

        <TabsContent value="invites" className="mt-3">
          <InvitesTab group={group} invites={invites} isAdmin={isAdmin} onChange={loadAll} />
        </TabsContent>

        {isAdmin && (
          <TabsContent value="settings" className="mt-3">
            <SettingsTab
              group={group}
              isOwner={myRole === "owner"}
              onDeleted={onBack}
            />
          </TabsContent>
        )}
      </Tabs>
    </div>
  );
}

function RoleIcon({ role }: { role: GroupMember["role"] }) {
  if (role === "owner") return <Crown className="h-3.5 w-3.5 text-[hsl(var(--ember))]" />;
  if (role === "admin") return <Shield className="h-3.5 w-3.5 text-[hsl(var(--emerald))]" />;
  return <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />;
}

// ============ WORLDS TAB ============

function WorldsTab({
  group,
  worlds,
  profiles,
  isAdmin,
  settings,
  onChange,
  onProfilesChange,
}: {
  group: Group;
  worlds: World[];
  profiles: Map<string, Profile>;
  isAdmin: boolean;
  settings: Settings;
  onChange: () => void;
  onProfilesChange?: () => void;
}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [linkTarget, setLinkTarget] = useState<World | null>(null);
  const [, setTick] = useState(0);

  // Re-render every 30s to update lock expiry countdowns
  useEffect(() => {
    const i = setInterval(() => setTick((t) => t + 1), 30_000);
    return () => clearInterval(i);
  }, []);

  const handleAcquire = async (worldId: string) => {
    setBusyId(worldId);
    try {
      await rpc.acquireWorldLock(worldId, 15);
      toast.success(t("groups.world.lockAcquired"));
      onChange();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleRelease = async (worldId: string) => {
    setBusyId(worldId);
    try {
      await rpc.releaseWorldLock(worldId);
      toast.success(t("groups.world.lockReleased"));
      onChange();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const [deleteWorldTarget, setDeleteWorldTarget] = useState<World | null>(null);
  const [forceReleaseTarget, setForceReleaseTarget] = useState<World | null>(null);
  const [uploadTarget, setUploadTarget] = useState<World | null>(null);

  const handleDeleteWorld = async () => {
    if (!deleteWorldTarget) return;
    const world = deleteWorldTarget;
    setBusyId(world.id);
    try {
      // PocketBase cascade-borra los world_versions y los archivos asociados
      await rpc.deleteWorld(world.id);
      toast.success(t("groups.world.deleted", { name: world.name }));
      setDeleteWorldTarget(null);
      onChange();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleForceRelease = async () => {
    if (!forceReleaseTarget) return;
    const world = forceReleaseTarget;
    setBusyId(world.id);
    try {
      await rpc.releaseWorldLock(world.id);
      toast.success(t("groups.world.forceReleased", { name: world.name }));
      setForceReleaseTarget(null);
      onChange();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const lockState = (w: World): "free" | "mine" | "other" | "expired" => {
    if (!w.current_holder) return "free";
    if (w.lock_expires_at && new Date(w.lock_expires_at) <= new Date()) return "expired";
    if (w.current_holder === session?.id) return "mine";
    return "other";
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        <div className="flex items-center justify-end">
          {isAdmin && (
            <Dialog open={createOpen} onOpenChange={setCreateOpen}>
              <DialogTrigger asChild>
                <Button>
                  <Plus className="h-4 w-4 mr-1.5" />
                  {t("groups.world.create")}
                </Button>
              </DialogTrigger>
              <CreateWorldForm
                groupId={group.id}
                singleplayerSavesPath={settings.singleplayer_saves_path}
                onClose={() => {
                  setCreateOpen(false);
                  onChange();
                }}
              />
            </Dialog>
          )}
        </div>

        {worlds.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            {t("groups.world.empty")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("common.name")}</TableHead>
                <TableHead>{t("groups.world.status")}</TableHead>
                <TableHead>{t("groups.world.holder")}</TableHead>
                <TableHead>{t("groups.world.expires")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {worlds.map((w) => {
                const state = lockState(w);
                const holder = w.current_holder ? profiles.get(w.current_holder) : null;
                return (
                  <TableRow key={w.id}>
                    <TableCell className="font-medium">{w.name}</TableCell>
                    <TableCell>
                      {state === "free" && (
                        <Badge variant="outline" className="gap-1">
                          <Unlock className="h-3 w-3" />
                          {t("groups.world.statusFree")}
                        </Badge>
                      )}
                      {state === "expired" && (
                        <Badge variant="outline" className="gap-1 text-muted-foreground">
                          <Unlock className="h-3 w-3" />
                          {t("groups.world.statusExpired")}
                        </Badge>
                      )}
                      {state === "mine" && (
                        <Badge className="gap-1">
                          <Lock className="h-3 w-3" />
                          {t("groups.world.statusMine")}
                        </Badge>
                      )}
                      {state === "other" && (
                        <Badge variant="destructive" className="gap-1">
                          <Lock className="h-3 w-3" />
                          {t("groups.world.statusHeld")}
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-sm">
                      {state === "mine" || state === "other" ? (
                        <span className="inline-flex items-center gap-2">
                          <PresenceDot title={t("groups.presence.runningNow")} />
                          {holder?.display_name ?? "—"}
                        </span>
                      ) : (
                        (holder?.display_name ?? "—")
                      )}
                    </TableCell>
                    <TableCell className="text-sm font-mono">
                      {w.lock_expires_at
                        ? new Date(w.lock_expires_at).toLocaleTimeString()
                        : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1.5 items-center">
                        <Button
                          variant="ghost"
                          size="icon"
                          title={t("groups.world.linkToProfile")}
                          onClick={() => setLinkTarget(w)}
                        >
                          <CloudDownload className="h-4 w-4 text-[hsl(220_70%_65%)]" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          title={
                            state === "other"
                              ? t("groups.world.upload.heldByOther")
                              : t("groups.world.upload.button")
                          }
                          disabled={busyId === w.id || state === "other"}
                          onClick={() => setUploadTarget(w)}
                        >
                          <CloudUpload className="h-4 w-4 text-[hsl(var(--copper))]" />
                        </Button>
                        {state === "mine" ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyId === w.id}
                            onClick={() => handleRelease(w.id)}
                          >
                            {t("groups.world.release")}
                          </Button>
                        ) : state === "other" && isAdmin ? (
                          <Button
                            variant="outline"
                            size="sm"
                            disabled={busyId === w.id}
                            onClick={() => setForceReleaseTarget(w)}
                            title={t("groups.world.forceReleaseHint")}
                          >
                            {t("groups.world.forceRelease")}
                          </Button>
                        ) : (
                          <Button
                            size="sm"
                            disabled={busyId === w.id || state === "other"}
                            onClick={() => handleAcquire(w.id)}
                          >
                            {state === "other" ? t("groups.world.held") : t("groups.world.acquire")}
                          </Button>
                        )}
                        {isAdmin && (
                          <Button
                            variant="ghost"
                            size="icon"
                            disabled={busyId === w.id}
                            onClick={() => setDeleteWorldTarget(w)}
                            title={t("groups.world.delete")}
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>

      {linkTarget && (
        <LinkProfileDialog
          world={linkTarget}
          onClose={() => setLinkTarget(null)}
          onProfilesChange={onProfilesChange}
        />
      )}

      {uploadTarget && (
        <Dialog
          open={uploadTarget !== null}
          onOpenChange={(o) => !o && setUploadTarget(null)}
        >
          <UploadSaveToWorldDialog
            world={uploadTarget}
            settings={settings}
            onClose={(uploaded) => {
              setUploadTarget(null);
              if (uploaded) onChange();
            }}
          />
        </Dialog>
      )}

      <AlertDialog
        open={deleteWorldTarget !== null}
        onOpenChange={(o) => !o && setDeleteWorldTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("groups.world.deleteTitle", { name: deleteWorldTarget?.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("groups.world.deleteWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId === deleteWorldTarget?.id}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteWorld}
              disabled={busyId === deleteWorldTarget?.id}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("groups.world.deleteConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <AlertDialog
        open={forceReleaseTarget !== null}
        onOpenChange={(o) => !o && setForceReleaseTarget(null)}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t("groups.world.forceReleaseTitle", { name: forceReleaseTarget?.name })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("groups.world.forceReleaseWarning")}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busyId === forceReleaseTarget?.id}>
              {t("common.cancel")}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={handleForceRelease}
              disabled={busyId === forceReleaseTarget?.id}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {t("groups.world.forceReleaseConfirm")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function LinkProfileDialog({
  world,
  onClose,
  onProfilesChange,
}: {
  world: World;
  onClose: () => void;
  onProfilesChange?: () => void;
}) {
  const { t } = useTranslation();
  const [profiles, setProfiles] = useState<ServerProfile[]>([]);
  const [selectedId, setSelectedId] = useState<string>("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    tauri
      .listServerProfiles()
      .then((list) => {
        setProfiles(list);
        if (list.length > 0) setSelectedId(list[0].id);
      })
      .catch((e) => toast.error(getErrorMessage(e)));
  }, []);

  const handleApply = async () => {
    if (!selectedId) return;
    setBusy(true);
    try {
      await tauri.linkProfileToWorld(selectedId, world.id);
      const profile = profiles.find((p) => p.id === selectedId);
      toast.success(
        t("groups.world.linkedToProfile", {
          profile: profile?.name ?? "?",
          world: world.name,
        })
      );
      onProfilesChange?.();
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("groups.world.linkDialogTitle")}</DialogTitle>
          <DialogDescription>
            {t("groups.world.linkDialogDescription", { world: world.name })}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-2 py-3 max-h-[300px] overflow-auto">
          {profiles.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-6">
              {t("groups.world.noProfiles")}
            </p>
          ) : (
            profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={`w-full text-left rounded-md border px-3 py-2 transition-colors ${
                  selectedId === p.id
                    ? "border-[hsl(220_70%_50%)] bg-[hsl(220_70%_50%/0.1)]"
                    : "border-[hsl(30_15%_22%)] hover:border-[hsl(30_25%_32%)]"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <div className="text-sm font-medium truncate">{p.name}</div>
                    {p.description && (
                      <div className="text-[11px] text-muted-foreground truncate">
                        {p.description}
                      </div>
                    )}
                  </div>
                  {p.linked_group_world_id && (
                    <Badge variant="outline" className="text-[10px] gap-1 shrink-0">
                      <CloudDownload className="h-3 w-3" />
                      {t("groups.world.alreadyLinked")}
                    </Badge>
                  )}
                </div>
              </button>
            ))
          )}
        </div>

        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button onClick={handleApply} disabled={busy || !selectedId}>
            {busy ? "..." : t("groups.world.linkApply")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}

function CreateWorldForm({
  groupId,
  singleplayerSavesPath,
  onClose,
}: {
  groupId: string;
  singleplayerSavesPath: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<"blank" | "sp">("blank");
  const [name, setName] = useState("");
  const [spSaves, setSpSaves] = useState<SaveInfo[]>([]);
  const [selectedSp, setSelectedSp] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  useEffect(() => {
    if (tab !== "sp" || !singleplayerSavesPath) return;
    tauri
      .listSaves(singleplayerSavesPath)
      .then(setSpSaves)
      .catch(() => setSpSaves([]));
  }, [tab, singleplayerSavesPath]);

  useEffect(() => {
    if (!busy) return;
    const unlistenPromise = listen<UploadProgress>("upload-progress", (event) => {
      setProgress(event.payload);
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [busy]);

  const handleSubmitBlank = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await rpc.createWorld(groupId, name.trim());
      toast.success(t("groups.world.created"));
      setName("");
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitSp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedSp) return;
    setBusy(true);
    setProgress(null);
    try {
      const fileName = selectedSp.split(/[\\/]/).pop() || "unknown.vcdbs";

      // 1) Crear el world (sin save todavia)
      const created = await rpc.createWorld(groupId, name.trim(), fileName);
      const worldId = created.id;

      // 2) Tomar el lock del mundo antes de subir. El hook server-side de
      // world_versions exige que el uploader sea el current_holder del mundo
      // (evita que un miembro sin lock inyecte versiones). Como acabamos de
      // crear el world, el lock esta libre y lo tomamos sin conflicto.
      await rpc.acquireWorldLock(worldId, 15);

      // 3) Subir el save: Rust comprime con zstd y hace un POST multipart
      // creando directamente el record en world_versions. El hook server-side
      // actualiza worlds.current_version cuando se crea el version. Liberamos
      // el lock pase lo que pase — esto es solo el seed inicial, no una sesion.
      const token = pb.authStore.token;
      const userId = pb.authStore.record?.id;
      if (!token || !userId) throw new Error("Not authenticated");
      try {
        await tauri.uploadSaveToCloud({
          savePath: selectedSp,
          pbUrl: requirePbUrl(),
          token,
          worldId,
          version: 1,
          userId,
        });
      } finally {
        try {
          await rpc.releaseWorldLock(worldId);
        } catch (relErr) {
          console.warn("[world] no se pudo liberar el lock del seed inicial", relErr);
        }
      }

      toast.success(t("groups.world.createdWithSave"));
      setName("");
      setSelectedSp("");
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t("groups.world.createTitle")}</DialogTitle>
        <DialogDescription>{t("groups.world.createDescription")}</DialogDescription>
      </DialogHeader>

      <Tabs value={tab} onValueChange={(v) => setTab(v as "blank" | "sp")}>
        <TabsList className="grid grid-cols-2">
          <TabsTrigger value="blank" disabled={busy}>
            {t("groups.world.tabBlank")}
          </TabsTrigger>
          <TabsTrigger value="sp" disabled={busy}>
            {t("groups.world.tabSp")}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="blank">
          <form onSubmit={handleSubmitBlank} className="space-y-3 py-3">
            <div className="space-y-1.5">
              <Label htmlFor="blank-name">{t("common.name")}</Label>
              <Input
                id="blank-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("groups.world.namePlaceholder")}
              />
              <p className="text-[11px] text-muted-foreground">
                {t("groups.world.blankHint")}
              </p>
            </div>
            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button type="submit" disabled={busy || name.trim().length === 0}>
                {busy ? "..." : t("common.create")}
              </Button>
            </DialogFooter>
          </form>
        </TabsContent>

        <TabsContent value="sp">
          <form onSubmit={handleSubmitSp} className="space-y-3 py-3">
            <div className="space-y-1.5">
              <Label htmlFor="sp-name">{t("common.name")}</Label>
              <Input
                id="sp-name"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={t("groups.world.namePlaceholder")}
                disabled={busy}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="sp-save">{t("groups.world.spSave")}</Label>
              <Select value={selectedSp} onValueChange={setSelectedSp} disabled={busy}>
                <SelectTrigger id="sp-save">
                  <SelectValue placeholder={t("groups.world.spSavePlaceholder")} />
                </SelectTrigger>
                <SelectContent>
                  {spSaves.map((s) => (
                    <SelectItem key={s.full_path} value={s.full_path}>
                      <span className="flex items-center gap-2">
                        <span>{s.name}</span>
                        <span className="text-muted-foreground text-xs">
                          {formatBytes(s.size_bytes)}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {spSaves.length === 0 && singleplayerSavesPath && (
                <p className="text-[11px] text-muted-foreground">
                  {t("groups.world.noSpSaves")}
                </p>
              )}
              {!singleplayerSavesPath && (
                <p className="text-[11px] text-muted-foreground">
                  {t("groups.world.spPathMissing")}
                </p>
              )}
            </div>

            {progress && (
              <div className="space-y-1.5 p-3 rounded-md bg-[hsl(200_25%_10%)] border border-[hsl(30_15%_22%)]">
                <div className="flex justify-between text-xs">
                  <span className="text-muted-foreground">{progress.message}</span>
                  <span className="font-mono">{progress.percent}%</span>
                </div>
                <div className="h-1.5 bg-[hsl(200_25%_15%)] rounded overflow-hidden">
                  <div
                    className="h-full bg-[hsl(var(--ember))] transition-all"
                    style={{ width: `${progress.percent}%` }}
                  />
                </div>
              </div>
            )}

            <DialogFooter>
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                {t("common.cancel")}
              </Button>
              <Button
                type="submit"
                disabled={busy || name.trim().length === 0 || !selectedSp}
              >
                {busy ? progress?.message ?? "..." : t("groups.world.createAndUpload")}
              </Button>
            </DialogFooter>
          </form>
        </TabsContent>
      </Tabs>
    </DialogContent>
  );
}

// ============ UPLOAD SAVE TO EXISTING WORLD ============
//
// Reemplaza la version "actual" del cloud para un mundo del grupo con un
// .vcdbs local elegido por el usuario. Equivalente a "stop del server con
// upload" pero arrancando desde un archivo arbitrario en disco, sin que el
// server tenga que haber estado corriendo. Util para empujar un backup
// rescatado de Backups/, recuperar progreso de una sesion que crasheo sin
// poder hacer stop limpio, o pisar el cloud con una version conocida-buena.
//
// Flujo: acquire-lock (30 min, ventana generosa para uploads grandes) →
// next_world_version transaccional → uploadSaveToCloud (zstd + multipart POST)
// → release-lock. El nuevo record en world_versions se vuelve la version
// actual via el hook onRecordAfterCreateSuccess.
function UploadSaveToWorldDialog({
  world,
  settings,
  onClose,
}: {
  world: World;
  settings: Settings;
  onClose: (uploaded: boolean) => void;
}) {
  const { t } = useTranslation();
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileName, setFileName] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UploadProgress | null>(null);

  useEffect(() => {
    if (!busy) return;
    const unlistenPromise = listen<UploadProgress>("upload-progress", (event) => {
      setProgress(event.payload);
    });
    return () => {
      unlistenPromise.then((fn) => fn());
    };
  }, [busy]);

  const handlePickFile = async () => {
    try {
      // Default al folder de Saves del server si esta configurado — es donde
      // suele estar el .vcdbs activo. Si no, el dialog arranca donde el OS quiera.
      const defaultDir = settings.data_path ? `${settings.data_path}\\Saves` : undefined;
      const selected = await openDialog({
        multiple: false,
        title: t("groups.world.upload.pickFile"),
        defaultPath: defaultDir,
        filters: [{ name: "Vintage Story Save", extensions: ["vcdbs"] }],
      });
      if (selected && typeof selected === "string") {
        setFilePath(selected);
        setFileName(selected.split(/[\\/]/).pop() || "save.vcdbs");
      }
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const handleUpload = async () => {
    if (!filePath) return;
    setBusy(true);
    setProgress(null);
    let lockAcquired = false;
    try {
      // 30 min: uploads de saves grandes sobre conexiones residenciales pueden
      // tomar varios minutos. El heartbeat normal del cliente no aplica aca
      // porque no hay server corriendo, asi que pedimos una ventana generosa.
      await rpc.acquireWorldLock(world.id, 30);
      lockAcquired = true;

      const nv = await rpc.nextWorldVersion(world.id);
      const version = nv.next_version;

      const token = pb.authStore.token;
      const userId = pb.authStore.record?.id;
      if (!token || !userId) throw new Error("Not authenticated");
      await tauri.uploadSaveToCloud({
        savePath: filePath,
        pbUrl: requirePbUrl(),
        token,
        worldId: world.id,
        version,
        userId,
      });

      await rpc.releaseWorldLock(world.id);
      lockAcquired = false;

      toast.success(
        t("groups.world.upload.success", { world: world.name, version })
      );
      onClose(true);
    } catch (err) {
      toast.error(getErrorMessage(err));
      // Mejor esfuerzo: si llegamos a tomar el lock pero el upload reventó,
      // liberamos para no dejar al mundo bloqueado durante 30 min.
      if (lockAcquired) {
        try {
          await rpc.releaseWorldLock(world.id);
        } catch (_) {
          /* ignore */
        }
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>
          {t("groups.world.upload.title", { world: world.name })}
        </DialogTitle>
        <DialogDescription>
          {t("groups.world.upload.description", {
            currentVersion: world.current_version,
            nextVersion: (world.current_version || 0) + 1,
          })}
        </DialogDescription>
      </DialogHeader>

      <div className="space-y-3 py-2">
        <div className="space-y-1.5">
          <Label>{t("groups.world.upload.file")}</Label>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={handlePickFile}
              disabled={busy}
            >
              {t("groups.world.upload.browse")}
            </Button>
            {filePath ? (
              <span className="text-xs font-mono text-muted-foreground truncate flex-1">
                {fileName}
              </span>
            ) : (
              <span className="text-xs text-muted-foreground italic">
                {t("groups.world.upload.noneSelected")}
              </span>
            )}
          </div>
          {filePath && (
            <p className="text-[11px] text-muted-foreground break-all">
              {filePath}
            </p>
          )}
        </div>

        {progress && (
          <div className="space-y-1.5 p-3 rounded-md bg-[hsl(200_25%_10%)] border border-[hsl(30_15%_22%)]">
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">{progress.message}</span>
              <span className="font-mono">{progress.percent}%</span>
            </div>
            <div className="h-1.5 bg-[hsl(200_25%_15%)] rounded overflow-hidden">
              <div
                className="h-full bg-[hsl(var(--ember))] transition-all"
                style={{ width: `${progress.percent}%` }}
              />
            </div>
          </div>
        )}
      </div>

      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          onClick={() => onClose(false)}
          disabled={busy}
        >
          {t("common.cancel")}
        </Button>
        <Button onClick={handleUpload} disabled={busy || !filePath}>
          {busy
            ? (progress?.message ?? "...")
            : t("groups.world.upload.confirm")}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}

// ============ MEMBERS TAB ============

function MembersTab({
  members,
  myUserId,
  isAdmin,
  onChange,
}: {
  members: MemberRow[];
  myUserId: string | null;
  isAdmin: boolean;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const [removeTarget, setRemoveTarget] = useState<MemberRow | null>(null);
  const [busy, setBusy] = useState(false);

  const handleRemove = async () => {
    if (!removeTarget) return;
    setBusy(true);
    try {
      await pb.collection("group_members").delete(removeTarget.id);
      toast.success(t("groups.members.removed"));
      setRemoveTarget(null);
      onChange();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleRoleChange = async (
    member: MemberRow,
    newRole: "admin" | "player"
  ) => {
    if (member.role === newRole || member.role === "owner") return;
    try {
      await rpc.changeMemberRole(member.group, member.user, newRole);
      toast.success(
        newRole === "admin"
          ? t("groups.members.promoted", { name: member.profile?.display_name ?? "" })
          : t("groups.members.demoted", { name: member.profile?.display_name ?? "" })
      );
      onChange();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  return (
    <Card>
      <CardContent className="pt-4">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t("groups.members.name")}</TableHead>
              <TableHead>{t("groups.members.role")}</TableHead>
              <TableHead>{t("groups.members.joined")}</TableHead>
              <TableHead className="text-right">{t("common.actions")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {members.map((m) => (
              <TableRow key={m.id}>
                <TableCell className="font-medium">
                  <div className="flex items-center gap-2">
                    {m.profile?.display_name ?? m.user.slice(0, 8)}
                    {m.user === myUserId && (
                      <Badge variant="outline" className="text-[10px]">
                        {t("groups.members.you")}
                      </Badge>
                    )}
                  </div>
                </TableCell>
                <TableCell>
                  {isAdmin && m.role !== "owner" ? (
                    <Select
                      value={m.role}
                      onValueChange={(v) => handleRoleChange(m, v as "admin" | "player")}
                    >
                      <SelectTrigger className="h-7 w-[110px] text-xs">
                        <span className="flex items-center gap-1.5">
                          <RoleIcon role={m.role} />
                          <SelectValue />
                        </span>
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="admin">{t("groups.role.admin")}</SelectItem>
                        <SelectItem value="player">{t("groups.role.player")}</SelectItem>
                      </SelectContent>
                    </Select>
                  ) : (
                    <Badge variant="outline" className="gap-1 text-[10px]">
                      <RoleIcon role={m.role} />
                      {t(`groups.role.${m.role}`)}
                    </Badge>
                  )}
                </TableCell>
                <TableCell className="text-sm font-mono text-muted-foreground">
                  {new Date(m.joined_at || m.created).toLocaleDateString()}
                </TableCell>
                <TableCell className="text-right">
                  {m.role !== "owner" && (isAdmin || m.user === myUserId) && (
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setRemoveTarget(m)}
                      title={
                        m.user === myUserId
                          ? t("groups.members.leave")
                          : t("groups.members.remove")
                      }
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        <AlertDialog open={removeTarget !== null} onOpenChange={(o) => !o && setRemoveTarget(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {removeTarget?.user === myUserId
                  ? t("groups.members.leaveConfirm")
                  : t("groups.members.removeConfirm")}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t("groups.members.removeWarning", {
                  name: removeTarget?.profile?.display_name ?? "",
                })}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
              <AlertDialogAction onClick={handleRemove} disabled={busy}>
                {t("common.confirm")}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

// ============ INVITES TAB ============

function InvitesTab({
  group,
  invites,
  isAdmin,
  onChange,
}: {
  group: Group;
  invites: Invite[];
  isAdmin: boolean;
  onChange: () => void;
}) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  const createInvite = async () => {
    if (!session) return;
    try {
      const result = await rpc.createInvite(group.id, { uses: 5 });
      toast.success(t("groups.invites.generated", { code: result.code }));
      onChange();
    } catch (err) {
      toast.error(getErrorMessage(err));
    }
  };

  const handleDelete = async (invite: Invite) => {
    setBusyId(invite.id);
    try {
      await pb.collection("invites").delete(invite.id);
      toast.success(t("groups.invites.deleted"));
      onChange();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusyId(null);
    }
  };

  const handleCopy = async (code: string) => {
    await navigator.clipboard.writeText(code);
    setCopiedCode(code);
    toast.success(t("groups.invites.copied"));
    setTimeout(() => setCopiedCode(null), 1800);
  };

  return (
    <Card>
      <CardContent className="pt-4 space-y-3">
        {isAdmin && (
          <div className="flex items-center justify-end">
            <Button onClick={createInvite}>
              <Plus className="h-4 w-4 mr-1.5" />
              {t("groups.invites.create")}
            </Button>
          </div>
        )}

        {invites.length === 0 ? (
          <p className="text-center text-muted-foreground py-8">
            {t("groups.invites.empty")}
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t("groups.invites.code")}</TableHead>
                <TableHead>{t("groups.invites.usesLeft")}</TableHead>
                <TableHead>{t("groups.invites.createdAt")}</TableHead>
                <TableHead className="text-right">{t("common.actions")}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {invites.map((inv) => (
                <TableRow key={inv.id}>
                  <TableCell className="font-mono tracking-[0.25em] text-base">
                    {inv.code}
                  </TableCell>
                  <TableCell>
                    <Badge variant={inv.uses_left > 0 ? "outline" : "destructive"}>
                      {inv.uses_left}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-sm font-mono text-muted-foreground">
                    {new Date(inv.created).toLocaleDateString()}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => handleCopy(inv.code)}
                        title={t("groups.invites.copy")}
                      >
                        {copiedCode === inv.code ? (
                          <Check className="h-4 w-4 text-[hsl(var(--emerald))]" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      {isAdmin && (
                        <Button
                          variant="ghost"
                          size="icon"
                          disabled={busyId === inv.id}
                          onClick={() => handleDelete(inv)}
                          title={t("groups.invites.delete")}
                        >
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

// ============ SETTINGS TAB ============

function SettingsTab({
  group,
  isOwner,
  onDeleted,
}: {
  group: Group;
  isOwner: boolean;
  onDeleted: () => void;
}) {
  const { t } = useTranslation();
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopyId = async () => {
    await navigator.clipboard.writeText(group.id);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleDeleteGroup = async () => {
    if (confirmText !== group.full_tag) return;
    setBusy(true);
    try {
      await rpc.deleteGroup(group.id);
      toast.success(t("groups.settings.deleted", { tag: group.full_tag }));
      setConfirmDelete(false);
      onDeleted();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-4">
      <Card>
        <CardContent className="pt-4 space-y-3">
          <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {t("groups.settings.info")}
          </div>
          <div className="space-y-1.5 text-sm">
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">{t("groups.settings.name")}</span>
              <span className="font-medium">{group.name}</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {t("groups.settings.discriminator")}
              </span>
              <span className="font-mono text-xs">#{group.discriminator}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-muted-foreground shrink-0">{t("groups.settings.id")}</span>
              <button
                type="button"
                onClick={handleCopyId}
                className="flex items-center gap-1.5 font-mono text-[10px] text-muted-foreground hover:text-foreground transition-colors min-w-0"
                title={t("common.copy")}
              >
                <span className="truncate">{group.id}</span>
                {copied ? (
                  <Check className="h-3 w-3 text-[hsl(var(--emerald))] shrink-0" />
                ) : (
                  <Copy className="h-3 w-3 shrink-0" />
                )}
              </button>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">
                {t("groups.settings.created")}
              </span>
              <span className="font-mono text-xs">
                {new Date(group.created).toLocaleDateString()}
              </span>
            </div>
          </div>
        </CardContent>
      </Card>

      {isOwner && (
        <Card className="border-destructive/40">
          <CardContent className="pt-4 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-destructive">
              <AlertTriangle className="h-3.5 w-3.5" />
              {t("groups.settings.dangerZone")}
            </div>
            <p className="text-sm text-muted-foreground">
              {t("groups.settings.deleteDescription")}
            </p>
            <Button
              variant="outline"
              className="border-destructive/40 text-destructive hover:bg-destructive hover:text-destructive-foreground"
              onClick={() => setConfirmDelete(true)}
            >
              <Trash2 className="h-4 w-4 mr-1.5" />
              {t("groups.settings.deleteButton")}
            </Button>
          </CardContent>
        </Card>
      )}

      <AlertDialog
        open={confirmDelete}
        onOpenChange={(o) => {
          if (!o) {
            setConfirmDelete(false);
            setConfirmText("");
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-destructive">
              <AlertTriangle className="h-5 w-5" />
              {t("groups.settings.deleteTitle")}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t("groups.settings.deleteWarning", { tag: group.full_tag })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <div className="py-2 space-y-1.5">
            <Label htmlFor="confirm-delete" className="text-xs">
              {t("groups.settings.deleteConfirmLabel", { tag: group.full_tag })}
            </Label>
            <Input
              id="confirm-delete"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={group.full_tag}
              autoComplete="off"
            />
          </div>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>{t("common.cancel")}</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteGroup}
              disabled={busy || confirmText !== group.full_tag}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {busy ? "..." : t("groups.settings.deleteButton")}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
