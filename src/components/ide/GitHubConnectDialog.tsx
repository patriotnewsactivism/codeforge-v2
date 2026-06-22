import { useAuthActions } from "@convex-dev/auth/react";
import { useAction } from "convex/react";
import { CheckCircle, ExternalLink, Github, Loader2 } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { api } from "../../../convex/_generated/api";

export function GitHubConnectDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { signIn } = useAuthActions();
  const [token, setToken] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [showPat, setShowPat] = useState(false);
  const [result, setResult] = useState<{
    valid: boolean;
    username?: string;
  } | null>(null);
  const validateToken = useAction(api.github.validateToken);

  // One-click OAuth: links GitHub to the current account and captures a
  // repo-scoped token automatically. Returns to the current page afterward.
  const handleOAuthConnect = async () => {
    setConnecting(true);
    try {
      await signIn("github", {
        redirectTo: window.location.pathname + window.location.search,
      });
    } catch (e) {
      toast.error(
        e instanceof Error ? e.message : "Could not connect to GitHub",
      );
      setConnecting(false);
    }
  };

  const handleValidate = async () => {
    if (!token.trim()) return;
    setIsValidating(true);
    try {
      const res = await validateToken({ token: token.trim() });
      setResult(res);
      if (res.valid) {
        toast.success(`Connected as ${res.username}`);
        onOpenChange(false);
      } else {
        toast.error(res.error || "Invalid token");
      }
    } catch (_e) {
      toast.error("Failed to validate token");
    }
    setIsValidating(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Github className="h-5 w-5" />
            Connect GitHub
          </DialogTitle>
          <DialogDescription>
            Link your GitHub account to import and sync your repositories.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Primary path: one-click OAuth */}
          <Button
            onClick={() => void handleOAuthConnect()}
            disabled={connecting}
            className="w-full"
          >
            {connecting ? (
              <Loader2 className="h-4 w-4 animate-spin mr-2" />
            ) : (
              <Github className="h-4 w-4 mr-2" />
            )}
            {connecting ? "Redirecting to GitHub..." : "Continue with GitHub"}
          </Button>

          {/* Divider */}
          <div className="relative">
            <div className="absolute inset-0 flex items-center">
              <span className="w-full border-t border-border" />
            </div>
            <div className="relative flex justify-center text-[10px] uppercase">
              <span className="bg-background px-2 text-muted-foreground tracking-wider">
                or use a token
              </span>
            </div>
          </div>

          {!showPat ? (
            <Button
              variant="ghost"
              className="w-full text-xs text-muted-foreground"
              onClick={() => setShowPat(true)}
            >
              Connect with a Personal Access Token instead
            </Button>
          ) : (
            <>
              <div className="rounded-lg bg-card/50 border border-border p-3 text-xs">
                <p className="font-medium mb-2">How to create a token:</p>
                <ol className="space-y-1 text-muted-foreground list-decimal list-inside">
                  <li>
                    Go to{" "}
                    <a
                      href="https://github.com/settings/tokens/new"
                      target="_blank"
                      rel="noopener"
                      className="text-chart-3 hover:underline inline-flex items-center gap-0.5"
                    >
                      GitHub Token Settings
                      <ExternalLink className="h-2.5 w-2.5" />
                    </a>
                  </li>
                  <li>
                    Select scopes:{" "}
                    <Badge variant="secondary" className="text-[9px] h-3.5">
                      repo
                    </Badge>{" "}
                    (Full control of private repositories)
                  </li>
                  <li>Generate and paste the token below</li>
                </ol>
              </div>

              <Input
                type="password"
                placeholder="ghp_xxxxxxxxxxxxxxxxxxxx"
                value={token}
                onChange={e => {
                  setToken(e.target.value);
                  setResult(null);
                }}
                onKeyDown={e => e.key === "Enter" && handleValidate()}
              />

              {result?.valid && (
                <div className="flex items-center gap-2 text-sm text-success">
                  <CheckCircle className="h-4 w-4" />
                  Connected as <strong>{result.username}</strong>
                </div>
              )}

              <Button
                onClick={handleValidate}
                disabled={isValidating || !token.trim()}
                className="w-full"
                variant="outline"
              >
                {isValidating ? (
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Github className="h-4 w-4 mr-2" />
                )}
                {isValidating ? "Validating..." : "Connect with Token"}
              </Button>
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
