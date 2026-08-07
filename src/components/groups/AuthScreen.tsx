import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Cloud, LogIn, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { getErrorMessage } from "@/lib/pocketbase";

export function AuthScreen() {
  const { t } = useTranslation();
  const { signIn, signUp } = useAuth();
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await signIn(email.trim(), password);
      toast.success(t("groups.auth.signedIn"));
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (displayName.trim().length < 2) {
      toast.error(t("groups.auth.displayNameTooShort"));
      return;
    }
    if (password.length < 6) {
      toast.error(t("groups.auth.passwordTooShort"));
      return;
    }
    setBusy(true);
    try {
      await signUp(email.trim(), password, displayName.trim());
      toast.success(t("groups.auth.signedUp"));
    } catch (err) {
      toast.error(getErrorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="p-6 flex items-start justify-center">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <div className="mx-auto mb-2 h-12 w-12 rounded-full bg-[hsl(200_25%_12%)] border border-[hsl(30_15%_22%)] flex items-center justify-center">
            <Cloud className="h-6 w-6 text-[hsl(var(--ember))]" />
          </div>
          <CardTitle>{t("groups.auth.title")}</CardTitle>
          <CardDescription>{t("groups.auth.subtitle")}</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs value={mode} onValueChange={(v) => setMode(v as "signin" | "signup")}>
            <TabsList className="grid w-full grid-cols-2 mb-4">
              <TabsTrigger value="signin">
                <LogIn className="h-4 w-4 mr-1.5" />
                {t("groups.auth.signin")}
              </TabsTrigger>
              <TabsTrigger value="signup">
                <UserPlus className="h-4 w-4 mr-1.5" />
                {t("groups.auth.signup")}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="signin-email">{t("groups.auth.email")}</Label>
                  <Input
                    id="signin-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signin-pass">{t("groups.auth.password")}</Label>
                  <Input
                    id="signin-pass"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={busy} className="w-full mt-2">
                  {busy ? "..." : t("groups.auth.signin")}
                </Button>
              </form>
            </TabsContent>

            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-3">
                <div className="space-y-1.5">
                  <Label htmlFor="signup-name">{t("groups.auth.displayName")}</Label>
                  <Input
                    id="signup-name"
                    type="text"
                    autoComplete="nickname"
                    required
                    minLength={2}
                    maxLength={32}
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-email">{t("groups.auth.email")}</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="signup-pass">{t("groups.auth.password")}</Label>
                  <Input
                    id="signup-pass"
                    type="password"
                    autoComplete="new-password"
                    required
                    minLength={6}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {t("groups.auth.passwordHint")}
                  </p>
                </div>
                <Button type="submit" disabled={busy} className="w-full mt-2">
                  {busy ? "..." : t("groups.auth.signup")}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
