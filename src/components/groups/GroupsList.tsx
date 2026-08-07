import { useState, useEffect, useCallback } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Plus,
  KeyRound,
  RefreshCw,
  Users as UsersIcon,
  ChevronRight,
  Crown,
  Shield,
  User as UserIcon,
} from "lucide-react";
import { toast } from "sonner";
import {
  pb,
  rpc,
  getErrorMessage,
  withTimeout,
  type Group,
  type GroupMember,
} from "@/lib/pocketbase";
import { useAuth } from "@/hooks/useAuth";
import { usePbRealtimeRefetch } from "@/hooks/usePbRealtimeRefetch";
import { GearLoaderBlock } from "@/components/ui/gear-loader";

interface GroupsListProps {
  onSelect: (group: Group) => void;
}

interface GroupWithRole extends Group {
  role: GroupMember["role"];
}

export function GroupsList({ onSelect }: GroupsListProps) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [groups, setGroups] = useState<GroupWithRole[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  const loadGroups = useCallback(async () => {
    if (!session) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const memberRows = await withTimeout(
        pb.collection("group_members").getFullList<GroupMember>({
          filter: `user = "${session.id}"`,
          fields: "id,group,role",
        }),
        10_000,
        "fetch group_members"
      );

      const ids = memberRows.map((m) => m.group);
      if (ids.length === 0) {
        setGroups([]);
        return;
      }

      const filter = ids.map((id) => `id = "${id}"`).join(" || ");
      const groupsData = await withTimeout(
        pb.collection("groups").getFullList<Group>({ filter }),
        10_000,
        "fetch groups"
      );

      const roleByGroupId = new Map(memberRows.map((m) => [m.group, m.role]));
      const list: GroupWithRole[] = groupsData.map((g) => ({
        ...g,
        role: roleByGroupId.get(g.id) ?? "player",
      }));

      list.sort((a, b) => a.full_tag.localeCompare(b.full_tag));
      setGroups(list);
    } catch (err) {
      console.error("[GroupsList] loadGroups error:", err);
      toast.error(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    loadGroups();
    const fallback = setTimeout(() => {
      setLoading(false);
    }, 12_000);
    return () => clearTimeout(fallback);
  }, [loadGroups]);

  // Realtime: refetch cuando me agregan/quitan de un grupo (group_members
  // donde user = yo) o cuando cambia alguno de los grupos donde soy miembro
  // (rename, delete). Filtramos por user server-side; para groups dejamos sin
  // filtro y confiamos en que las List Rules de PB ya restringen los records
  // visibles a los grupos accesibles, asi que solo recibimos eventos
  // relevantes.
  usePbRealtimeRefetch({
    collection: "group_members",
    filter: session ? `user = "${session.id}"` : undefined,
    onChange: loadGroups,
    enabled: !!session,
  });
  usePbRealtimeRefetch({
    collection: "groups",
    onChange: loadGroups,
    enabled: !!session,
  });

  const roleIcon = (role: GroupMember["role"]) => {
    if (role === "owner") return <Crown className="h-3.5 w-3.5 text-[hsl(var(--ember))]" />;
    if (role === "admin") return <Shield className="h-3.5 w-3.5 text-[hsl(var(--emerald))]" />;
    return <UserIcon className="h-3.5 w-3.5 text-muted-foreground" />;
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-semibold flex items-center gap-2">
            <UsersIcon className="h-5 w-5" />
            {t("groups.title")}
          </h2>
          <p className="text-sm text-muted-foreground">
            {t("groups.subtitle")}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon" onClick={loadGroups} disabled={loading}>
            <RefreshCw className={loading ? "h-4 w-4 animate-spin" : "h-4 w-4"} />
          </Button>

          <Dialog open={joinOpen} onOpenChange={setJoinOpen}>
            <DialogTrigger asChild>
              <Button variant="outline">
                <KeyRound className="h-4 w-4 mr-1.5" />
                {t("groups.joinByCode")}
              </Button>
            </DialogTrigger>
            <JoinGroupForm
              onClose={() => {
                setJoinOpen(false);
                loadGroups();
              }}
            />
          </Dialog>

          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="h-4 w-4 mr-1.5" />
                {t("groups.createGroup")}
              </Button>
            </DialogTrigger>
            <CreateGroupForm
              onClose={() => {
                setCreateOpen(false);
                loadGroups();
              }}
            />
          </Dialog>
        </div>
      </div>

      {loading && groups.length === 0 ? (
        <Card>
          <CardContent>
            <GearLoaderBlock size="lg" label={t("common.loading")} />
          </CardContent>
        </Card>
      ) : groups.length === 0 ? (
        <Card>
          <CardContent className="py-10 text-center space-y-2">
            <p className="text-muted-foreground">{t("groups.empty")}</p>
            <p className="text-sm text-muted-foreground">
              {t("groups.emptyHint")}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {groups.map((g) => (
            <button
              key={g.id}
              type="button"
              onClick={() => onSelect(g)}
              className="text-left"
            >
              <Card className="hover:border-[hsl(30_25%_32%)] transition-colors">
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-base flex items-center gap-2 min-w-0">
                    <span className="truncate">{g.name}</span>
                    <span className="text-xs font-mono text-muted-foreground">
                      #{g.discriminator}
                    </span>
                  </CardTitle>
                  <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                </CardHeader>
                <CardContent className="pt-0 flex items-center gap-2">
                  <Badge variant="outline" className="text-[10px] gap-1">
                    {roleIcon(g.role)}
                    {t(`groups.role.${g.role}`)}
                  </Badge>
                </CardContent>
              </Card>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function CreateGroupForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { session } = useAuth();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!session) return;
    if (name.includes("#")) {
      toast.error(t("groups.create.noHash"));
      return;
    }
    setBusy(true);
    try {
      const result = await rpc.createGroup(name.trim());
      toast.success(t("groups.create.created", { tag: result.full_tag }));
      setName("");
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>{t("groups.create.title")}</DialogTitle>
          <DialogDescription>{t("groups.create.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-3">
          <div className="space-y-1.5">
            <Label htmlFor="group-name">{t("groups.create.nameLabel")}</Label>
            <Input
              id="group-name"
              required
              minLength={1}
              maxLength={32}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={t("groups.create.namePlaceholder")}
            />
            <p className="text-[11px] text-muted-foreground">
              {t("groups.create.nameHint")}
            </p>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={busy || name.trim().length === 0}>
            {busy ? "..." : t("groups.create.submit")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

function JoinGroupForm({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const cleaned = code.trim().toUpperCase();
      await rpc.redeemInvite(cleaned);
      toast.success(t("groups.join.joined"));
      setCode("");
      onClose();
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <DialogContent>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <DialogTitle>{t("groups.join.title")}</DialogTitle>
          <DialogDescription>{t("groups.join.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 py-3">
          <div className="space-y-1.5">
            <Label htmlFor="invite-code">{t("groups.join.codeLabel")}</Label>
            <Input
              id="invite-code"
              required
              minLength={8}
              maxLength={12}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              className="font-mono uppercase tracking-[0.3em]"
              placeholder="K7XMP3QR"
            />
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
            {t("common.cancel")}
          </Button>
          <Button type="submit" disabled={busy || code.length < 8}>
            {busy ? "..." : t("groups.join.submit")}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  );
}

