import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Check, Copy, Pencil, RefreshCw, Shuffle, User } from "lucide-react";
import type { LocalPlayerInfo, Settings } from "@/lib/types";
import * as tauri from "@/lib/tauri";
import { toast } from "sonner";

interface PlayerViewProps {
  settings: Settings;
}

export function PlayerView({ settings }: PlayerViewProps) {
  const { t } = useTranslation();
  const [info, setInfo] = useState<LocalPlayerInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRandomize, setConfirmRandomize] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editValue, setEditValue] = useState("");
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await tauri.getLocalPlayerInfo(settings.data_path);
      setInfo(data);
    } catch (e) {
      toast.error(`${t('common.error')}: ${e}`);
      setInfo(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [settings.data_path]);

  const handleCopy = async () => {
    if (!info?.uid) return;
    await navigator.clipboard.writeText(info.uid);
    setCopied(true);
    toast.success(t('player.copied'));
    setTimeout(() => setCopied(false), 2000);
  };

  const applyUid = async (uid: string) => {
    setSaving(true);
    try {
      const updated = await tauri.setLocalPlayerUid(settings.data_path, uid);
      setInfo(updated);
      toast.success(t('player.uidUpdated'));
      return true;
    } catch (e) {
      toast.error(`${t('common.error')}: ${e}`);
      return false;
    } finally {
      setSaving(false);
    }
  };

  const handleRandomize = async () => {
    setConfirmRandomize(false);
    try {
      const newUid = await tauri.generateRandomUid();
      await applyUid(newUid);
    } catch (e) {
      toast.error(`${t('common.error')}: ${e}`);
    }
  };

  const openEdit = () => {
    setEditValue(info?.uid ?? "");
    setEditOpen(true);
  };

  const handleSaveEdit = async () => {
    const trimmed = editValue.trim();
    if (!trimmed) {
      toast.error(t('player.uidEmpty'));
      return;
    }
    const ok = await applyUid(trimmed);
    if (ok) setEditOpen(false);
  };

  const handleGenerateInDialog = async () => {
    try {
      const newUid = await tauri.generateRandomUid();
      setEditValue(newUid);
    } catch (e) {
      toast.error(`${t('common.error')}: ${e}`);
    }
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t('player.title')}</h2>
          <p className="text-muted-foreground">{t('player.subtitle')}</p>
        </div>
        <Button onClick={load} variant="outline" size="sm" disabled={loading} className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <User className="h-5 w-5" />
            {t('player.identity')}
          </CardTitle>
          <CardDescription>{t('player.identityDesc')}</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t('player.name')}</p>
            <p className="text-sm font-mono">
              {info?.name ?? <span className="text-muted-foreground italic">{t('player.notFound')}</span>}
            </p>
          </div>

          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">{t('player.uid')}</p>
            {info?.uid ? (
              <button
                onClick={handleCopy}
                className="w-full text-left p-3 rounded-md bg-muted/50 hover:bg-muted transition-colors group flex items-center justify-between gap-2"
              >
                <span className="text-sm font-mono break-all">{info.uid}</span>
                {copied ? (
                  <Check className="h-4 w-4 text-green-500 shrink-0" />
                ) : (
                  <Copy className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
                )}
              </button>
            ) : (
              <p className="text-sm font-mono text-muted-foreground italic">{t('player.notFound')}</p>
            )}
          </div>

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setConfirmRandomize(true)}
              disabled={saving || loading}
              className="gap-2"
            >
              <Shuffle className="h-4 w-4" />
              {t('player.randomize')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={openEdit}
              disabled={saving || loading}
              className="gap-2"
            >
              <Pencil className="h-4 w-4" />
              {t('player.edit')}
            </Button>
          </div>

          <p className="text-xs text-muted-foreground border-l-2 border-yellow-500/60 pl-2">
            {t('player.warning')}
          </p>

          {info?.source_path && (
            <div className="space-y-1 pt-2">
              <p className="text-xs text-muted-foreground">{t('player.source')}</p>
              <p className="text-xs font-mono text-muted-foreground break-all">{info.source_path}</p>
            </div>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmRandomize} onOpenChange={setConfirmRandomize}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('player.confirmRandomizeTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('player.confirmRandomizeDesc')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleRandomize}>
              {t('player.randomize')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('player.editTitle')}</DialogTitle>
            <DialogDescription>{t('player.editDesc')}</DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="player_uid">{t('player.uid')}</Label>
            <div className="flex gap-2">
              <Input
                id="player_uid"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                placeholder="..."
                className="font-mono"
              />
              <Button
                variant="outline"
                size="icon"
                onClick={handleGenerateInDialog}
                title={t('player.randomize')}
              >
                <Shuffle className="h-4 w-4" />
              </Button>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              {t('common.cancel')}
            </Button>
            <Button onClick={handleSaveEdit} disabled={saving}>
              {saving ? t('common.saving') : t('common.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
