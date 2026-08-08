import { useCallback, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import PocketBase, { BaseAuthStore } from "pocketbase";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import {
    Table,
    TableBody,
    TableCell,
    TableHead,
    TableHeader,
    TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { GearLoaderBlock } from "@/components/ui/gear-loader";
import { KeyRound, RefreshCw, ShieldCheck, Search } from "lucide-react";
import { toast } from "sonner";
import { getPbUrl, getErrorMessage, type UserRecord } from "@/lib/pocketbase";

// Panel de administración de la instancia PocketBase (Opción A).
//
// Usa un cliente PocketBase SEPARADO del singleton de la app:
//   - misma URL, pero authStore propio → la sesión de superusuario no pisa
//     la sesión del usuario normal de la pestaña Grupos.
//   - BaseAuthStore (memoria, no LocalAuthStore) → el token de superusuario
//     jamás se persiste a disco; al cerrar el diálogo o la app, desaparece.
//
// El hook server-side (C1) permite editar cloud_enabled/max_upload_bytes
// solo a superusuarios, así que todo lo que hace este panel está igualmente
// validado del lado del servidor.

const GB = 1024 * 1024 * 1024;

interface InstanceAdminDialogProps {
    open: boolean;
    onClose: () => void;
}

export function InstanceAdminDialog({ open, onClose }: InstanceAdminDialogProps) {
    return (
        <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
            <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
                {/* Montado solo al abrir: el estado (incluida la sesión de
                    superusuario, que vive en memoria) arranca limpio cada vez. */}
                {open && <AdminBody />}
            </DialogContent>
        </Dialog>
    );
}

function AdminBody() {
    const { t } = useTranslation();

    // Cliente admin dedicado. useMemo sin deps: una instancia por montaje.
    const adminPb = useMemo(() => {
        const client = new PocketBase(getPbUrl() ?? "", new BaseAuthStore());
        client.autoCancellation(false);
        return client;
    }, []);

    const [loggedIn, setLoggedIn] = useState(false);
    const [busy, setBusy] = useState(false);

    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    const [users, setUsers] = useState<UserRecord[]>([]);
    const [totalUsers, setTotalUsers] = useState(0);
    const [loadingUsers, setLoadingUsers] = useState(false);
    const [search, setSearch] = useState("");
    // Draft del cap de upload por user id (string tal cual lo tipea el admin, en GB)
    const [capDrafts, setCapDrafts] = useState<Record<string, string>>({});
    // Ids con una operación en vuelo (deshabilita los controles de esa fila)
    const [savingIds, setSavingIds] = useState<Set<string>>(new Set());

    const loadUsers = useCallback(async () => {
        setLoadingUsers(true);
        try {
            const res = await adminPb
                .collection("users")
                .getList<UserRecord>(1, 200, { sort: "-created" });
            setUsers(res.items);
            setTotalUsers(res.totalItems);
            setCapDrafts({});
        } catch (err) {
            toast.error(getErrorMessage(err));
        } finally {
            setLoadingUsers(false);
        }
    }, [adminPb]);

    const handleLogin = async (e: React.FormEvent) => {
        e.preventDefault();
        setBusy(true);
        try {
            await adminPb.collection("_superusers").authWithPassword(email.trim(), password);
            setLoggedIn(true);
            void loadUsers();
        } catch (err) {
            toast.error(getErrorMessage(err));
        } finally {
            setBusy(false);
        }
    };

    const withRowSaving = async (userId: string, fn: () => Promise<void>) => {
        setSavingIds((prev) => new Set(prev).add(userId));
        try {
            await fn();
        } catch (err) {
            toast.error(getErrorMessage(err));
        } finally {
            setSavingIds((prev) => {
                const next = new Set(prev);
                next.delete(userId);
                return next;
            });
        }
    };

    const handleToggleCloud = (user: UserRecord, enabled: boolean) =>
        withRowSaving(user.id, async () => {
            const updated = await adminPb
                .collection("users")
                .update<UserRecord>(user.id, { cloud_enabled: enabled });
            setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
            toast.success(
                enabled
                    ? t("instanceAdmin.cloudEnabledOn", { email: user.email })
                    : t("instanceAdmin.cloudEnabledOff", { email: user.email })
            );
        });

    const capDraftFor = (user: UserRecord): string => {
        const draft = capDrafts[user.id];
        if (draft !== undefined) return draft;
        return user.max_upload_bytes > 0
            ? String(Math.round((user.max_upload_bytes / GB) * 100) / 100)
            : "";
    };

    const handleCapCommit = (user: UserRecord) => {
        const raw = (capDrafts[user.id] ?? "").trim();
        if (capDrafts[user.id] === undefined) return; // sin cambios

        let bytes: number;
        if (raw === "" || raw === "0") {
            bytes = 0; // default del sistema (2 GB)
        } else {
            const gb = Number(raw.replace(",", "."));
            if (!Number.isFinite(gb) || gb < 0) {
                toast.error(t("instanceAdmin.capInvalid"));
                return;
            }
            bytes = Math.round(gb * GB);
        }
        if (bytes === user.max_upload_bytes) {
            // Sin cambio real: descartar el draft silenciosamente
            setCapDrafts((prev) => {
                const next = { ...prev };
                delete next[user.id];
                return next;
            });
            return;
        }

        void withRowSaving(user.id, async () => {
            const updated = await adminPb
                .collection("users")
                .update<UserRecord>(user.id, { max_upload_bytes: bytes });
            setUsers((prev) => prev.map((u) => (u.id === user.id ? updated : u)));
            setCapDrafts((prev) => {
                const next = { ...prev };
                delete next[user.id];
                return next;
            });
            toast.success(t("instanceAdmin.capSaved", { email: user.email }));
        });
    };

    const filtered = search.trim()
        ? users.filter((u) => {
              const q = search.trim().toLowerCase();
              return (
                  u.email.toLowerCase().includes(q) ||
                  (u.name || "").toLowerCase().includes(q)
              );
          })
        : users;

    if (!loggedIn) {
        return (
            <>
                <DialogHeader>
                    <DialogTitle className="flex items-center gap-2">
                        <ShieldCheck className="w-5 h-5" />
                        {t("instanceAdmin.title")}
                    </DialogTitle>
                    <DialogDescription>
                        {t("instanceAdmin.loginSubtitle")}
                        <span className="block font-mono text-xs mt-1 break-all">{getPbUrl()}</span>
                    </DialogDescription>
                </DialogHeader>

                <form onSubmit={handleLogin} className="space-y-3">
                    <div className="space-y-2">
                        <Label htmlFor="admin-email">{t("instanceAdmin.email")}</Label>
                        <Input
                            id="admin-email"
                            type="email"
                            autoComplete="off"
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            autoFocus
                        />
                    </div>
                    <div className="space-y-2">
                        <Label htmlFor="admin-password">{t("instanceAdmin.password")}</Label>
                        <Input
                            id="admin-password"
                            type="password"
                            autoComplete="off"
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                        />
                    </div>
                    <p className="text-xs text-muted-foreground">{t("instanceAdmin.sessionNote")}</p>
                    <div className="flex justify-end">
                        <Button type="submit" disabled={busy || !email.trim() || !password}>
                            <KeyRound className="w-4 h-4 mr-2" />
                            {busy ? "..." : t("instanceAdmin.login")}
                        </Button>
                    </div>
                </form>
            </>
        );
    }

    return (
        <>
            <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                    <ShieldCheck className="w-5 h-5" />
                    {t("instanceAdmin.title")}
                </DialogTitle>
                <DialogDescription>
                    {t("instanceAdmin.usersSubtitle", { count: totalUsers })}
                    {totalUsers > 200 && ` ${t("instanceAdmin.truncated")}`}
                </DialogDescription>
            </DialogHeader>

            <div className="flex items-center gap-2">
                <div className="relative flex-1">
                    <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
                    <Input
                        className="pl-8"
                        placeholder={t("instanceAdmin.searchPlaceholder")}
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                    />
                </div>
                <Button variant="outline" onClick={() => void loadUsers()} disabled={loadingUsers}>
                    <RefreshCw className={loadingUsers ? "w-4 h-4 animate-spin" : "w-4 h-4"} />
                </Button>
            </div>

            {loadingUsers && users.length === 0 ? (
                <GearLoaderBlock size="md" label={t("common.loading")} />
            ) : (
                <Table>
                    <TableHeader>
                        <TableRow>
                            <TableHead>{t("instanceAdmin.colUser")}</TableHead>
                            <TableHead className="text-center">{t("instanceAdmin.colCloud")}</TableHead>
                            <TableHead className="w-36">{t("instanceAdmin.colCap")}</TableHead>
                        </TableRow>
                    </TableHeader>
                    <TableBody>
                        {filtered.map((user) => {
                            const saving = savingIds.has(user.id);
                            return (
                                <TableRow key={user.id}>
                                    <TableCell>
                                        <div className="min-w-0">
                                            <div className="text-sm truncate">
                                                {user.email}
                                                {user.verified && (
                                                    <Badge variant="outline" className="ml-2 text-[10px]">
                                                        {t("instanceAdmin.verified")}
                                                    </Badge>
                                                )}
                                            </div>
                                            <div className="text-xs text-muted-foreground truncate">
                                                {user.name || "—"} · {new Date(user.created).toLocaleDateString()}
                                            </div>
                                        </div>
                                    </TableCell>
                                    <TableCell className="text-center">
                                        <Switch
                                            checked={user.cloud_enabled}
                                            disabled={saving}
                                            onCheckedChange={(v) => void handleToggleCloud(user, v)}
                                        />
                                    </TableCell>
                                    <TableCell>
                                        <Input
                                            className="h-8"
                                            placeholder={t("instanceAdmin.capDefault")}
                                            value={capDraftFor(user)}
                                            disabled={saving}
                                            onChange={(e) =>
                                                setCapDrafts((prev) => ({
                                                    ...prev,
                                                    [user.id]: e.target.value,
                                                }))
                                            }
                                            onBlur={() => handleCapCommit(user)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter") {
                                                    (e.target as HTMLInputElement).blur();
                                                }
                                            }}
                                        />
                                    </TableCell>
                                </TableRow>
                            );
                        })}
                        {filtered.length === 0 && (
                            <TableRow>
                                <TableCell colSpan={3} className="text-center text-sm text-muted-foreground">
                                    {t("instanceAdmin.noResults")}
                                </TableCell>
                            </TableRow>
                        )}
                    </TableBody>
                </Table>
            )}

            <p className="text-xs text-muted-foreground">{t("instanceAdmin.footerHint")}</p>
        </>
    );
}
