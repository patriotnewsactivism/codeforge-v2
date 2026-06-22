/**
 * SettingsPage.tsx — Updated with API Keys tab for BYOK
 *
 * CHANGES FROM ORIGINAL:
 * - Added "API Keys" tab (visible to all, content differs by plan)
 * - Tab routing via ?tab=api-keys URL param (so BYOKBanner CTA links directly to it)
 * - Fixed duplicate `const [savingToken, setSavingToken] = useState(false)` declaration
 *   that existed in the original
 */
import { useAuthActions } from "@convex-dev/auth/react";
import { useAction, useMutation, useQuery } from "convex/react";
import {
  Brain,
  CheckCircle2,
  ChevronRight,
  Eye,
  EyeOff,
  Github,
  Key,
  Loader2,
  Moon,
  Palette,
  Save,
  Sun,
  User,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { toast } from "sonner";
import { AIModelsTab } from "@/components/settings/AIModelsTab";
import { ApiKeysTab } from "@/components/settings/ApiKeysTab";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useTheme } from "@/contexts/ThemeContext";
import { api } from "../../convex/_generated/api";

type SettingsTab =
  | "account"
  | "appearance"
  | "github"
  | "api-keys"
  | "ai-models";

const TABS: { id: SettingsTab; label: string; icon: React.ElementType }[] = [
  { id: "account", label: "Account", icon: User },
  { id: "appearance", label: "Appearance", icon: Palette },
  { id: "github", label: "GitHub", icon: Github },
  { id: "api-keys", label: "API Keys", icon: Key },
  { id: "ai-models", label: "AI Models", icon: Brain },
];

export function SettingsPage() {
  const user = useQuery(api.auth.currentUser);
  const { theme, toggleTheme, switchable } = useTheme();
  const { signIn, signOut } = useAuthActions();
  const deleteAccount = useMutation(api.users.deleteAccount);
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  // Tab state — reads from ?tab= param so BYOKBanner CTA works
  const tabParam = searchParams.get("tab") as SettingsTab | null;
  const [activeTab, setActiveTab] = useState<SettingsTab>(
    tabParam ?? "account",
  );

  useEffect(() => {
    if (tabParam && TABS.some(t => t.id === tabParam)) {
      setActiveTab(tabParam);
    }
  }, [tabParam]);

  const handleTabChange = (tab: SettingsTab) => {
    setActiveTab(tab);
    setSearchParams({ tab }, { replace: true });
  };

  const [changePasswordOpen, setChangePasswordOpen] = useState(false);
  const [deleteAccountOpen, setDeleteAccountOpen] = useState(false);

  // ── GitHub integration state ─────────────────────────────────────────────
  const [githubToken, setGithubToken] = useState("");
  const [showToken, setShowToken] = useState(false);
  const [savingToken, setSavingToken] = useState(false);
  const saveGithubToken = useMutation(api.github.saveToken);
  const validateGithubToken = useAction(api.github.validateToken);
  const githubSettings = useQuery(api.github.getSettings);

  const handleSaveGithubToken = async () => {
    if (!githubToken.trim()) return;
    setSavingToken(true);
    try {
      await saveGithubToken({ token: githubToken.trim() });
      const check = await validateGithubToken({ token: githubToken.trim() });
      if (check.valid) {
        toast.success(`GitHub connected as @${check.username ?? "unknown"}`);
      } else {
        toast.error(check.error ?? "Token saved but validation failed");
      }
      setGithubToken("");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save token");
    } finally {
      setSavingToken(false);
    }
  };

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [passwordStep, setPasswordStep] = useState<"request" | "verify">(
    "request",
  );

  const handleRequestPasswordReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const formData = new FormData();
    formData.append("email", user?.email || "");
    formData.append("flow", "reset");
    try {
      await signIn("password", formData);
      setPasswordStep("verify");
    } catch {
      setError("Could not send reset code. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleResetPassword = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    setLoading(true);
    const formData = new FormData(e.currentTarget);
    formData.append("email", user?.email || "");
    formData.append("flow", "reset-verification");
    try {
      await signIn("password", formData);
      setSuccess("Password changed successfully!");
      setTimeout(() => {
        setChangePasswordOpen(false);
        setPasswordStep("request");
        setSuccess("");
      }, 1500);
    } catch {
      setError("Invalid code or password. Please try again.");
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteAccount = async () => {
    setLoading(true);
    setError("");
    try {
      await deleteAccount();
      await signOut();
      navigate("/");
    } catch {
      setError("Could not delete account. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div
      className="min-h-screen"
      style={{ background: "#0D1117", color: "#E2E8F0" }}
    >
      <div className="max-w-3xl mx-auto px-4 py-8 space-y-6">
        {/* Page header */}
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-100">
            Settings
          </h1>
          <p className="text-sm text-slate-500 mt-1">
            Manage your account, appearance, and integrations
          </p>
        </div>

        {/* Profile card */}
        <Card className="overflow-hidden border-slate-800 bg-slate-900">
          <div className="h-16 bg-gradient-to-r from-cyan-500/10 via-violet-500/10 to-transparent" />
          <CardContent className="-mt-8 pb-5">
            <div className="flex items-end gap-4">
              <Avatar className="size-14 border-4 border-slate-900 shadow-lg">
                <AvatarFallback className="text-lg bg-gradient-to-br from-cyan-500 to-violet-600 text-white">
                  {user?.name?.charAt(0).toUpperCase() || (
                    <User className="size-5" />
                  )}
                </AvatarFallback>
              </Avatar>
              <div className="pb-1">
                <p className="font-semibold text-slate-100">
                  {user?.name || "User"}
                </p>
                <p className="text-sm text-slate-500">{user?.email}</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Tabs */}
        <div
          className="flex gap-1 p-1 rounded-lg overflow-x-auto"
          style={{
            background: "rgba(255,255,255,0.04)",
            border: "1px solid rgba(255,255,255,0.07)",
          }}
        >
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => handleTabChange(id)}
              className="flex items-center gap-2 px-3 py-2 text-sm rounded-md font-medium transition-all flex-1 justify-center"
              style={
                activeTab === id
                  ? {
                      background: "rgba(255,255,255,0.08)",
                      color: "#E2E8F0",
                      border: "1px solid rgba(255,255,255,0.1)",
                    }
                  : { color: "#64748B" }
              }
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{label}</span>
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div>
          {/* ── Account ── */}
          {activeTab === "account" && (
            <Card className="border-slate-800 bg-slate-900">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                  <User className="size-4 text-slate-500" />
                  Account
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2">
                <button
                  onClick={() => setChangePasswordOpen(true)}
                  className="w-full flex items-center justify-between rounded-lg border border-slate-800 p-4 transition-colors hover:bg-slate-800/50 text-left"
                >
                  <div>
                    <p className="font-medium text-sm text-slate-200">
                      Change password
                    </p>
                    <p className="text-sm text-slate-500">
                      Update your password via email code
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-slate-600" />
                </button>
                <button
                  onClick={() => setDeleteAccountOpen(true)}
                  className="w-full flex items-center justify-between rounded-lg border border-red-500/20 p-4 transition-colors hover:bg-red-500/5 text-left"
                >
                  <div>
                    <p className="font-medium text-sm text-red-400">
                      Delete account
                    </p>
                    <p className="text-sm text-slate-500">
                      Permanently delete your account and all data
                    </p>
                  </div>
                  <ChevronRight className="size-4 text-red-500" />
                </button>
              </CardContent>
            </Card>
          )}

          {/* ── Appearance ── */}
          {activeTab === "appearance" && (
            <Card className="border-slate-800 bg-slate-900">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                  <Palette className="size-4 text-slate-500" />
                  Appearance
                </CardTitle>
              </CardHeader>
              <CardContent>
                {switchable ? (
                  <div className="flex items-center justify-between rounded-lg border border-slate-800 p-4 hover:bg-slate-800/50 transition-colors">
                    <div className="flex items-center gap-4">
                      <div className="size-10 rounded-full bg-slate-800 flex items-center justify-center">
                        {theme === "light" ? (
                          <Moon className="size-5 text-slate-300" />
                        ) : (
                          <Sun className="size-5 text-slate-300" />
                        )}
                      </div>
                      <div>
                        <Label
                          htmlFor="dark-mode"
                          className="font-medium text-slate-200"
                        >
                          Dark mode
                        </Label>
                        <p className="text-sm text-slate-500">
                          Toggle between light and dark theme
                        </p>
                      </div>
                    </div>
                    <Switch
                      id="dark-mode"
                      checked={theme === "dark"}
                      onCheckedChange={toggleTheme}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-slate-500 px-4 py-2">
                    Theme follows your system preference
                  </p>
                )}
              </CardContent>
            </Card>
          )}

          {/* ── GitHub ── */}
          {activeTab === "github" && (
            <Card className="border-slate-800 bg-slate-900">
              <CardHeader className="pb-4">
                <CardTitle className="flex items-center gap-2 text-base text-slate-100">
                  <Github className="size-4 text-slate-500" />
                  GitHub Integration
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {githubSettings?.connected && (
                  <div className="flex items-center gap-2 text-sm p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400">
                    <CheckCircle2 className="size-4" />
                    Connected as @{githubSettings.username}
                  </div>
                )}

                {/* One-click OAuth — the easy path for everyone */}
                <Button
                  onClick={() =>
                    void signIn("github", {
                      redirectTo: "/settings?tab=github",
                    })
                  }
                  className="w-full bg-slate-100 text-slate-900 hover:bg-white"
                >
                  <Github className="size-4" />
                  {githubSettings?.connected
                    ? "Reconnect GitHub"
                    : "Continue with GitHub"}
                </Button>

                <div className="relative py-1">
                  <div className="absolute inset-0 flex items-center">
                    <span className="w-full border-t border-slate-800" />
                  </div>
                  <div className="relative flex justify-center text-[10px] uppercase">
                    <span className="bg-slate-900 px-2 text-slate-500 tracking-wider">
                      or use a token
                    </span>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label className="text-slate-300">
                    Personal Access Token
                  </Label>
                  <p className="text-xs text-slate-500">
                    Create a token at{" "}
                    <a
                      href="https://github.com/settings/tokens"
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-cyan-400 hover:underline"
                    >
                      github.com/settings/tokens
                    </a>{" "}
                    with{" "}
                    <code className="text-xs bg-slate-800 px-1 rounded">
                      repo
                    </code>{" "}
                    scope.
                  </p>
                  <div className="flex gap-2">
                    <div className="relative flex-1">
                      <Input
                        type={showToken ? "text" : "password"}
                        value={githubToken}
                        onChange={e => setGithubToken(e.target.value)}
                        placeholder="ghp_..."
                        className="bg-slate-800 border-slate-700 text-slate-200 font-mono text-sm pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(!showToken)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300"
                      >
                        {showToken ? (
                          <EyeOff className="size-4" />
                        ) : (
                          <Eye className="size-4" />
                        )}
                      </button>
                    </div>
                    <Button
                      onClick={handleSaveGithubToken}
                      disabled={savingToken || !githubToken.trim()}
                      className="bg-slate-700 hover:bg-slate-600 text-slate-200"
                    >
                      {savingToken ? (
                        <Loader2 className="size-4 animate-spin" />
                      ) : (
                        <Save className="size-4" />
                      )}
                      Save
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* ── API Keys (BYOK) ── */}
          {activeTab === "api-keys" && (
            <div
              className="rounded-xl p-5"
              style={{
                background: "#0D1117",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <ApiKeysTab />
            </div>
          )}

          {/* ── AI Models & Profiles ── */}
          {activeTab === "ai-models" && (
            <div
              className="rounded-xl p-5"
              style={{
                background: "#0D1117",
                border: "1px solid rgba(255,255,255,0.08)",
              }}
            >
              <AIModelsTab />
            </div>
          )}
        </div>
      </div>

      {/* ── Dialogs ── */}
      <Dialog open={changePasswordOpen} onOpenChange={setChangePasswordOpen}>
        <DialogContent className="bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-slate-100">
              Change Password
            </DialogTitle>
            <DialogDescription className="text-slate-400">
              {passwordStep === "request"
                ? "We'll send a verification code to your email."
                : "Enter the code from your email and your new password."}
            </DialogDescription>
          </DialogHeader>
          {passwordStep === "request" ? (
            <form onSubmit={handleRequestPasswordReset}>
              <div className="py-4">
                <p className="text-sm text-slate-400">
                  A reset code will be sent to:{" "}
                  <span className="font-medium text-slate-200">
                    {user?.email}
                  </span>
                </p>
              </div>
              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2 mb-4">
                  {error}
                </p>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setChangePasswordOpen(false)}
                  className="border-slate-700"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading && <Loader2 className="size-4 animate-spin" />}
                  Send Code
                </Button>
              </DialogFooter>
            </form>
          ) : (
            <form onSubmit={handleResetPassword} className="space-y-4">
              <div className="space-y-2">
                <Label className="text-slate-300">Verification code</Label>
                <Input
                  name="code"
                  placeholder="Enter code from email"
                  className="bg-slate-800 border-slate-700 text-slate-200"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-slate-300">New password</Label>
                <Input
                  type="password"
                  name="newPassword"
                  placeholder="••••••••"
                  className="bg-slate-800 border-slate-700 text-slate-200"
                />
              </div>
              {error && (
                <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
                  {error}
                </p>
              )}
              {success && (
                <p className="text-sm text-emerald-400 bg-emerald-500/10 rounded-lg px-3 py-2">
                  {success}
                </p>
              )}
              <DialogFooter>
                <Button
                  variant="outline"
                  onClick={() => setChangePasswordOpen(false)}
                  className="border-slate-700"
                >
                  Cancel
                </Button>
                <Button type="submit" disabled={loading}>
                  {loading && <Loader2 className="size-4 animate-spin" />}
                  Change Password
                </Button>
              </DialogFooter>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={deleteAccountOpen} onOpenChange={setDeleteAccountOpen}>
        <DialogContent className="bg-slate-900 border-slate-800">
          <DialogHeader>
            <DialogTitle className="text-red-400">Delete Account</DialogTitle>
            <DialogDescription className="text-slate-400">
              This is permanent. All your projects, files, and sessions will be
              deleted.
            </DialogDescription>
          </DialogHeader>
          {error && (
            <p className="text-sm text-red-400 bg-red-500/10 rounded-lg px-3 py-2">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteAccountOpen(false)}
              className="border-slate-700"
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleDeleteAccount}
              disabled={loading}
            >
              {loading && <Loader2 className="size-4 animate-spin" />}
              Delete my account
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
