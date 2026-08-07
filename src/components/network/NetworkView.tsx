import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { RefreshCw, Copy, Check, AlertCircle, Globe, ExternalLink } from "lucide-react";
import type { Settings } from "@/lib/types";
import * as tauri from "@/lib/tauri";
import { toast } from "sonner";

interface NetworkViewProps {
  settings: Settings;
  serverRunning: boolean;
}

export function NetworkView({ settings, serverRunning }: NetworkViewProps) {
  const { t } = useTranslation();
  const [localIp, setLocalIp] = useState<string>("");
  const [publicIp, setPublicIp] = useState<string | null>(null);
  const [portOpen, setPortOpen] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingPublicIp, setLoadingPublicIp] = useState(false);
  const [copied, setCopied] = useState(false);
  const [copiedPublic, setCopiedPublic] = useState(false);

  const fetchPublicIp = async () => {
    setLoadingPublicIp(true);
    try {
      const response = await fetch('https://api.ipify.org?format=text');
      const ip = await response.text();
      setPublicIp(ip);
    } catch {
      toast.error(t('network.errorGettingPublicIp'));
      setPublicIp(null);
    } finally {
      setLoadingPublicIp(false);
    }
  };

  const loadNetworkInfo = async () => {
    setLoading(true);
    try {
      const ip = await tauri.getLocalIp();
      setLocalIp(ip);
    } catch (e) {
      toast.error(t('network.errorGettingIp', { error: e }));
    } finally {
      setLoading(false);
    }
  };

  const testPort = async () => {
    setLoading(true);
    try {
      const open = await tauri.testPortLocal(settings.port);
      setPortOpen(open);
      if (open) {
        toast.success(t('network.portOpen'));
      } else {
        toast.info(t('network.portClosed'));
      }
    } catch (e) {
      toast.error(`${t('common.error')}: ${e}`);
      setPortOpen(false);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadNetworkInfo();
  }, []);

  const handleCopyAddress = async () => {
    const address = `${localIp}:${settings.port}`;
    await navigator.clipboard.writeText(address);
    setCopied(true);
    toast.success(t('network.addressCopied'));
    setTimeout(() => setCopied(false), 2000);
  };

  const handleCopyPublicIp = async () => {
    if (!publicIp) return;
    const address = `${publicIp}:${settings.port}`;
    await navigator.clipboard.writeText(address);
    setCopiedPublic(true);
    toast.success(t('network.publicIpCopied'));
    setTimeout(() => setCopiedPublic(false), 2000);
  };

  const openWhatIsMyIp = () => {
    window.open('https://whatismyipaddress.com/', '_blank');
  };

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold">{t('network.title')}</h2>
          <p className="text-muted-foreground">{t('network.subtitle')}</p>
        </div>
        <Button onClick={loadNetworkInfo} disabled={loading} variant="outline" className="gap-2">
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          {t('common.refresh')}
        </Button>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>{t('network.localIp')}</CardTitle>
            <CardDescription>{t('network.localIpDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">{t('network.localIp')}</p>
                <p className="text-lg font-mono">{localIp || "..."}</p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('common.port')}</p>
                <p className="text-lg font-mono">{settings.port}</p>
              </div>
            </div>
            <Button onClick={handleCopyAddress} className="w-full gap-2" variant="outline">
              {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              {copied ? t('common.copied') : `${t('common.copy')} ${localIp}:${settings.port}`}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Globe className="h-5 w-5" />
              {t('network.publicIp')}
            </CardTitle>
            <CardDescription>{t('network.publicIpDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
              <div>
                <p className="text-sm text-muted-foreground">{t('network.publicIp')}</p>
                <p className="text-lg font-mono">
                  {loadingPublicIp ? t('common.loading') : publicIp || "—"}
                </p>
              </div>
              <div>
                <p className="text-sm text-muted-foreground">{t('common.port')}</p>
                <p className="text-lg font-mono">{settings.port}</p>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleCopyPublicIp}
                className="flex-1 gap-2"
                variant="outline"
                disabled={!publicIp || loadingPublicIp}
              >
                {copiedPublic ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                {copiedPublic ? t('common.copied') : t('common.copy')}
              </Button>
              <Button onClick={openWhatIsMyIp} variant="outline" className="gap-2">
                <ExternalLink className="h-4 w-4" />
                {t('common.verify')}
              </Button>
            </div>
            <Button
              onClick={fetchPublicIp}
              variant={publicIp ? "ghost" : "default"}
              size="sm"
              className="w-full gap-2"
              disabled={loadingPublicIp}
            >
              <RefreshCw className={`h-3 w-3 ${loadingPublicIp ? 'animate-spin' : ''}`} />
              {publicIp ? t('network.refreshPublicIp') : t('network.getPublicIp')}
            </Button>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('network.portTest')}</CardTitle>
            <CardDescription>{t('network.portTestDesc')}</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <div className="flex-1">
                <p className="text-sm text-muted-foreground">{t('common.port')} {settings.port}</p>
                <div className="flex items-center gap-2 mt-1">
                  {portOpen === null ? (
                    <Badge variant="secondary">{t('network.notTested')}</Badge>
                  ) : portOpen ? (
                    <Badge variant="default" className="bg-green-600">{t('network.open')}</Badge>
                  ) : (
                    <Badge variant="destructive">{t('network.closed')}</Badge>
                  )}
                </div>
              </div>
              <Button onClick={testPort} disabled={loading}>
                {t('common.test')}
              </Button>
            </div>

            {!serverRunning && (
              <div className="flex items-start gap-2 p-3 bg-muted rounded-lg text-sm">
                <AlertCircle className="h-4 w-4 mt-0.5 text-muted-foreground" />
                <p className="text-muted-foreground">
                  {t('network.serverNotRunningPort')}
                </p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>{t('network.connectivityNotes')}</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-muted-foreground">
          <p>
            <strong>LAN:</strong> {t('network.lanNote', { ip: localIp, port: settings.port })}
          </p>
          <p>
            <strong>Internet:</strong> {t('network.internetNote')}
          </p>
          <ul className="list-disc list-inside ml-4 space-y-1">
            <li>{t('network.portForwarding', { port: settings.port })}</li>
            <li>{t('network.firewall')}</li>
            <li>{t('network.sharePublicIp')}</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
