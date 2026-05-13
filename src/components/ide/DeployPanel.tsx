/**
 * ═══════════════════════════════════════════════════════════════════
 * CODEFORGE v2 — ONE-CLICK DEPLOY
 * ═══════════════════════════════════════════════════════════════════
 *
 * Deploy projects to the web via:
 * - Instant preview (blob URL)
 * - Share link (data URL)  
 * - Export ZIP → deploy anywhere
 * - GitHub Pages (if connected)
 *
 * Future: Netlify, Vercel, Railway direct deploy.
 */
import type { Id } from "../../../convex/_generated/dataModel";
import { useQuery, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  Rocket,
  Globe,
  Loader2,
  ExternalLink,
  Copy,
  Check,
  Download,
  Github,
  Zap,
  Box,
} from "lucide-react";

interface DeployPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  projectId: Id<"projects"> | null;
  projectName?: string;
}

export function DeployPanel({
  open,
  onOpenChange,
  projectId,
  projectName,
}: DeployPanelProps) {
  const [deployingTo, setDeployingTo] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const allFiles = useQuery(
    api.files.listWithContent,
    projectId ? { projectId } : "skip"
  );
  const githubSettings = useQuery(api.github.getSettings);
  const activeProject = useQuery(
    api.projects.get,
    projectId ? { projectId } : "skip"
  );

  const commitFile = useAction(api.github.commitFile);

  // Generate a self-contained HTML preview
  const generatePreview = useCallback(() => {
    if (!allFiles) return null;

    const htmlFile = allFiles.find((f) => f.name === "index.html" || f.path?.endsWith("index.html"));
    if (!htmlFile?.content) return null;

    let html = htmlFile.content;

    // Inline CSS
    const cssFiles = allFiles.filter((f) => f.name?.endsWith(".css") && f.content);
    for (const css of cssFiles) {
      const linkRegex = new RegExp(`<link[^>]*href=["']${css.path || css.name}["'][^>]*>`, "gi");
      html = html.replace(linkRegex, `<style>${css.content}</style>`);
      // Also try just filename
      const nameRegex = new RegExp(`<link[^>]*href=["']${css.name}["'][^>]*>`, "gi");
      html = html.replace(nameRegex, `<style>${css.content}</style>`);
    }

    // Inline JS
    const jsFiles = allFiles.filter((f) => (f.name?.endsWith(".js") || f.name?.endsWith(".ts")) && f.content);
    for (const js of jsFiles) {
      const scriptRegex = new RegExp(`<script[^>]*src=["']${js.path || js.name}["'][^>]*></script>`, "gi");
      html = html.replace(scriptRegex, `<script>${js.content}</script>`);
      const nameRegex = new RegExp(`<script[^>]*src=["']${js.name}["'][^>]*></script>`, "gi");
      html = html.replace(nameRegex, `<script>${js.content}</script>`);
    }

    return html;
  }, [allFiles]);

  // Instant Preview (new tab)
  const handleInstantPreview = () => {
    const html = generatePreview();
    if (!html) {
      toast.error("No index.html found in project");
      return;
    }

    const blob = new Blob([html], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    window.open(url, "_blank");
    toast.success("Preview opened in new tab");
  };

  // Generate shareable link
  const handleShareLink = () => {
    const html = generatePreview();
    if (!html) {
      toast.error("No index.html found in project");
      return;
    }

    const encoded = btoa(unescape(encodeURIComponent(html)));
    const url = `data:text/html;base64,${encoded}`;
    setPreviewUrl(url);
    toast.success("Share link generated");
  };

  // Copy share link
  const handleCopy = async () => {
    if (!previewUrl) return;
    await navigator.clipboard.writeText(previewUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Link copied to clipboard");
  };

  // Deploy to GitHub Pages
  const handleGitHubPages = async () => {
    if (!activeProject?.githubRepo || !allFiles) {
      toast.error("No GitHub repo linked");
      return;
    }

    setDeployingTo("github-pages");
    const repo = activeProject.githubRepo;
    const html = generatePreview();

    if (!html) {
      toast.error("No index.html found");
      setDeployingTo(null);
      return;
    }

    try {
      // Push index.html to gh-pages branch root
      const result = await commitFile({
        repo,
        path: "index.html",
        content: html,
        message: `Deploy ${projectName || "project"} via CodeForge`,
        branch: "gh-pages",
      });

      if (result.success) {
        const [owner, repoName] = repo.split("/");
        const pagesUrl = `https://${owner}.github.io/${repoName}/`;
        toast.success(`Deployed to GitHub Pages! ${pagesUrl}`);
        window.open(pagesUrl, "_blank");
      } else {
        toast.error(result.error || "Deploy failed");
      }
    } catch (e) {
      toast.error("Failed to deploy to GitHub Pages");
    }
    setDeployingTo(null);
  };

  // Export as ZIP (reuses ExportButton logic but in deploy context)
  const handleExportDeploy = async () => {
    setDeployingTo("zip");
    try {
      const { default: JSZip } = await import("jszip");
      const { saveAs } = await import("file-saver");
      const zip = new JSZip();

      for (const file of allFiles || []) {
        if (file.type === "file" && file.content) {
          zip.file(file.path || file.name, file.content);
        }
      }

      const blob = await zip.generateAsync({ type: "blob" });
      saveAs(blob, `${projectName || "project"}.zip`);
      toast.success("ZIP downloaded — ready to deploy anywhere");
    } catch {
      toast.error("Failed to generate ZIP");
    }
    setDeployingTo(null);
  };

  const DEPLOY_OPTIONS = [
    {
      id: "preview",
      name: "Instant Preview",
      description: "Open in a new tab instantly",
      icon: Zap,
      color: "text-yellow-400",
      action: handleInstantPreview,
      available: true,
    },
    {
      id: "share",
      name: "Share Link",
      description: "Generate a shareable link",
      icon: Globe,
      color: "text-blue-400",
      action: handleShareLink,
      available: true,
    },
    {
      id: "github-pages",
      name: "GitHub Pages",
      description: "Deploy to GitHub Pages (free hosting)",
      icon: Github,
      color: "text-white/80",
      action: handleGitHubPages,
      available: !!githubSettings?.connected && !!activeProject?.githubRepo,
    },
    {
      id: "vercel",
      name: "Deploy to Vercel",
      description: "One-click deploy to production (Vercel API)",
      icon: Box,
      color: "text-indigo-400",
      action: handleVercelDeploy,
      available: true,
    },
    {
      id: "netlify",
      name: "Deploy to Netlify",
      description: "Publish to Netlify via Netlify Drop API",
      icon: Globe,
      color: "text-teal-400",
      action: handleNetlifyDeploy,
      available: true,
    },
    {
      id: "zip",
      name: "Download ZIP",
      description: "Download & deploy anywhere",
      icon: Download,
      color: "text-emerald-400",
      action: handleExportDeploy,
      available: true,
    },
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Rocket className="h-5 w-5 text-emerald-400" />
            Deploy {projectName || "Project"}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-3 mt-2">
          {DEPLOY_OPTIONS.map((opt) => {
            const Icon = opt.icon;
            const isDeploying = deployingTo === opt.id;

            return (
              <button
                key={opt.id}
                className={cn(
                  "w-full flex items-center gap-3 p-3 rounded-lg border transition-all text-left",
                  opt.available
                    ? "border-white/5 bg-white/[0.02] hover:border-emerald-500/20 hover:bg-emerald-500/[0.02] cursor-pointer"
                    : "border-white/5 bg-white/[0.01] opacity-40 cursor-not-allowed"
                )}
                onClick={() => opt.available && !isDeploying && opt.action()}
                disabled={!opt.available || !!deployingTo}
              >
                <div className={cn("p-2 rounded-lg bg-white/5", opt.color)}>
                  {isDeploying ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Icon className="h-4 w-4" />
                  )}
                </div>
                <div className="flex-1">
                  <h4 className="text-sm font-medium">{opt.name}</h4>
                  <p className="text-[10px] text-white/30">{opt.description}</p>
                </div>
                {!opt.available && (
                  <Badge variant="outline" className="text-[8px] h-4 border-white/10 text-white/20">
                    Connect GitHub
                  </Badge>
                )}
              </button>
            );
          })}
        </div>

        {/* Share link output */}
        {previewUrl && (
          <div className="mt-3 p-3 rounded-lg bg-white/[0.03] border border-white/5">
            <div className="flex items-center gap-2 mb-2">
              <Globe className="h-3.5 w-3.5 text-blue-400" />
              <span className="text-xs text-white/50">Share Link</span>
            </div>
            <div className="flex gap-2">
              <input
                readOnly
                value={previewUrl.substring(0, 60) + "..."}
                className="flex-1 h-7 text-[10px] font-mono bg-white/5 border border-white/10 rounded px-2 text-white/40"
              />
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs gap-1"
                onClick={handleCopy}
              >
                {copied ? (
                  <>
                    <Check className="h-3 w-3" />
                    Copied
                  </>
                ) : (
                  <>
                    <Copy className="h-3 w-3" />
                    Copy
                  </>
                )}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
