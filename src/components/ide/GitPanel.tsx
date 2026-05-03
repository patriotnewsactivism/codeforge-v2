import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useState } from "react";
import {
  GitBranch,
  GitCommit,
  GitPullRequest,
  Github,
  Upload,
  Download,
  Check,
  X,
  Loader2,
  ExternalLink,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface GitPanelProps {
  projectId: Id<"projects">;
}

export function GitPanel({ projectId }: GitPanelProps) {
  const commits = useQuery(api.git.listCommits, { projectId });
  const branches = useQuery(api.git.listBranches, { projectId });
  const activeBranch = useQuery(api.git.getActiveBranch, { projectId });
  const project = useQuery(api.projects.get, { projectId });

  const pushToGitHub = useAction(api.git.pushToGitHub);
  const importFromGitHub = useAction(api.git.importFromGitHub);

  const [activeTab, setActiveTab] = useState<"commits" | "branches" | "push" | "import">("commits");
  const [pushing, setPushing] = useState(false);
  const [importing, setImporting] = useState(false);

  // Push form state
  const [repoName, setRepoName] = useState("");
  const [branchName, setBranchName] = useState("agent/changes");
  const [commitMsg, setCommitMsg] = useState("");
  const [createPR, setCreatePR] = useState(true);
  const [prTitle, setPrTitle] = useState("");

  // Import form state
  const [importRepo, setImportRepo] = useState("");
  const [importBranch, setImportBranch] = useState("");

  const [pushResult, setPushResult] = useState<{
    success: boolean;
    branchUrl?: string;
    prUrl?: string;
    error?: string;
  } | null>(null);

  const handlePush = async () => {
    if (!repoName || !commitMsg) {
      toast.error("Repo name and commit message are required");
      return;
    }
    setPushing(true);
    setPushResult(null);
    try {
      const result = await pushToGitHub({
        projectId,
        repoFullName: repoName,
        branchName: branchName || "agent/changes",
        commitMessage: commitMsg,
        createPR,
        prTitle: prTitle || commitMsg,
        prBody: `Automated push from CodeForge\n\nBranch: \`${branchName}\``,
      });
      setPushResult(result);
      if (result.success) {
        toast.success(result.prUrl ? "PR created!" : "Branch pushed!");
      } else {
        toast.error(result.error ?? "Push failed");
      }
    } catch (e) {
      setPushResult({ success: false, error: String(e) });
    } finally {
      setPushing(false);
    }
  };

  const handleImport = async (repoOverride?: string) => {
    const repoToImport = repoOverride ?? importRepo;
    if (!repoToImport) {
      toast.error("Enter a repo — e.g. owner/repo or a GitHub URL");
      return;
    }
    setImporting(true);
    try {
      const result = await importFromGitHub({
        projectId,
        repoFullName: repoToImport,
        branch: importBranch || undefined,
      });
      if (result.success) {
        toast.success(`Imported ${result.filesImported} files from GitHub`);
      } else {
        toast.error(result.error ?? "Import failed");
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setImporting(false);
    }
  };

  const STATUS_COLORS = {
    open: "text-green-400",
    merged: "text-purple-400",
    closed: "text-red-400",
    local: "text-yellow-400",
  };

  return (
    <div className="h-full flex flex-col bg-[oklch(0.11_0.02_260)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Github className="h-4 w-4 text-foreground" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Git
        </span>
        {activeBranch && (
          <span className="ml-auto text-[10px] text-green-400 font-mono flex items-center gap-1">
            <GitBranch className="h-3 w-3" />
            {activeBranch.name}
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {(["commits", "branches", "push", "import"] as const).map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
              activeTab === tab
                ? "text-foreground border-b-2 border-foreground"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab === "commits" ? `Log (${commits?.length ?? 0})` :
             tab === "branches" ? `Branches (${branches?.length ?? 0})` :
             tab === "push" ? "Push" : "Import"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">

        {/* ── COMMIT LOG ── */}
        {activeTab === "commits" && (
          <div className="p-2 space-y-1">
            {(!commits || commits.length === 0) && (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <GitCommit className="h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No commits yet</p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Push your project to GitHub to start tracking commits
                </p>
              </div>
            )}
            {commits?.map((commit) => (
              <div
                key={commit._id}
                className="rounded-md bg-[oklch(0.14_0.02_260)] border border-border p-2"
              >
                <div className="flex items-start gap-2">
                  <GitCommit className="h-3 w-3 text-muted-foreground shrink-0 mt-0.5" />
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] text-foreground leading-snug">{commit.message}</p>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] font-mono text-violet-400">
                        {commit.sha.slice(0, 7)}
                      </span>
                      <span className="text-[9px] text-muted-foreground/60 flex items-center gap-1">
                        <GitBranch className="h-2.5 w-2.5" />
                        {commit.branch}
                      </span>
                      <span className="text-[9px] text-muted-foreground/40 ml-auto">
                        {new Date(commit.timestamp).toLocaleDateString()}
                      </span>
                    </div>
                    {commit.filesChanged.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {commit.filesChanged.slice(0, 4).map((f) => (
                          <span key={f} className="text-[9px] bg-white/5 px-1 py-0.5 rounded font-mono text-muted-foreground">
                            {f.split("/").pop()}
                          </span>
                        ))}
                        {commit.filesChanged.length > 4 && (
                          <span className="text-[9px] text-muted-foreground/50">
                            +{commit.filesChanged.length - 4} more
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* ── BRANCHES ── */}
        {activeTab === "branches" && (
          <div className="p-2 space-y-1.5">
            {(!branches || branches.length === 0) && (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <GitBranch className="h-8 w-8 text-muted-foreground/30 mb-3" />
                <p className="text-sm text-muted-foreground">No branches yet</p>
              </div>
            )}
            {branches?.map((branch) => (
              <div
                key={branch._id}
                className={cn(
                  "rounded-md border p-2",
                  branch.isActive
                    ? "bg-[oklch(0.16_0.03_260)] border-violet-500/30"
                    : "bg-[oklch(0.14_0.02_260)] border-border"
                )}
              >
                <div className="flex items-center gap-2">
                  <GitBranch className="h-3 w-3 text-muted-foreground shrink-0" />
                  <span className="text-[11px] font-mono text-foreground flex-1 truncate">
                    {branch.name}
                  </span>
                  {branch.isActive && (
                    <span className="text-[9px] text-violet-400 font-semibold">ACTIVE</span>
                  )}
                  <span className={cn("text-[9px] font-semibold uppercase", STATUS_COLORS[branch.status])}>
                    {branch.status}
                  </span>
                </div>
                {branch.headSha && (
                  <p className="text-[9px] font-mono text-muted-foreground/50 mt-1 ml-5">
                    HEAD: {branch.headSha.slice(0, 7)}
                  </p>
                )}
                {branch.prUrl && (
                  <a
                    href={branch.prUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-[10px] text-blue-400 hover:text-blue-300 mt-1 ml-5"
                  >
                    <GitPullRequest className="h-2.5 w-2.5" />
                    PR #{branch.prNumber} — View on GitHub
                    <ExternalLink className="h-2.5 w-2.5" />
                  </a>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── PUSH ── */}
        {activeTab === "push" && (
          <div className="p-3 space-y-3">
            <p className="text-[11px] text-muted-foreground">
              Push all project files to a GitHub branch and optionally open a PR.
              Requires <code className="text-violet-400">GITHUB_TOKEN</code> in Convex env.
            </p>

            <div className="space-y-2">
              <label className="block">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Repository (owner/repo) *
                </span>
                <input
                  type="text"
                  value={repoName}
                  onChange={(e) => setRepoName(e.target.value)}
                  placeholder="e.g. myorg/my-project"
                  className="mt-1 w-full bg-[oklch(0.14_0.02_260)] border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-500"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Branch name
                </span>
                <input
                  type="text"
                  value={branchName}
                  onChange={(e) => setBranchName(e.target.value)}
                  placeholder="agent/my-changes"
                  className="mt-1 w-full bg-[oklch(0.14_0.02_260)] border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-500"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Commit message *
                </span>
                <input
                  type="text"
                  value={commitMsg}
                  onChange={(e) => setCommitMsg(e.target.value)}
                  placeholder="feat: implement user authentication"
                  className="mt-1 w-full bg-[oklch(0.14_0.02_260)] border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-500"
                />
              </label>

              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createPR}
                  onChange={(e) => setCreatePR(e.target.checked)}
                  className="rounded"
                />
                <span className="text-[11px] text-muted-foreground">Create Pull Request</span>
              </label>

              {createPR && (
                <label className="block">
                  <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                    PR Title
                  </span>
                  <input
                    type="text"
                    value={prTitle}
                    onChange={(e) => setPrTitle(e.target.value)}
                    placeholder="Leave blank to use commit message"
                    className="mt-1 w-full bg-[oklch(0.14_0.02_260)] border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-500"
                  />
                </label>
              )}
            </div>

            <button
              type="button"
              onClick={handlePush}
              disabled={pushing}
              className="w-full flex items-center justify-center gap-2 py-2 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 rounded text-[11px] font-semibold text-white transition-colors"
            >
              {pushing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Upload className="h-3.5 w-3.5" />
              )}
              {pushing ? "Pushing..." : "Push to GitHub"}
            </button>

            {pushResult && (
              <div className={cn(
                "rounded-md p-3 border text-[11px]",
                pushResult.success
                  ? "bg-green-500/10 border-green-500/30 text-green-300"
                  : "bg-red-500/10 border-red-500/30 text-red-300"
              )}>
                {pushResult.success ? (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-1.5 font-semibold">
                      <Check className="h-3.5 w-3.5" />
                      {pushResult.prUrl ? "PR Created!" : "Branch Pushed!"}
                    </div>
                    {pushResult.branchUrl && (
                      <a href={pushResult.branchUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-blue-400 hover:underline">
                        <GitBranch className="h-3 w-3" /> View branch
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                    {pushResult.prUrl && (
                      <a href={pushResult.prUrl} target="_blank" rel="noopener noreferrer"
                        className="flex items-center gap-1 text-blue-400 hover:underline">
                        <GitPullRequest className="h-3 w-3" /> View Pull Request
                        <ExternalLink className="h-2.5 w-2.5" />
                      </a>
                    )}
                  </div>
                ) : (
                  <div className="flex items-start gap-1.5">
                    <X className="h-3.5 w-3.5 shrink-0 mt-0.5" />
                    <span>{pushResult.error}</span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}

        {/* ── IMPORT ── */}
        {activeTab === "import" && (
          <div className="p-3 space-y-3">
            {/* Re-sync shortcut — shown when project has a linked repo */}
            {project?.githubRepo && (
              <div className="rounded border border-violet-500/30 bg-violet-500/10 p-3 space-y-2">
                <p className="text-[11px] font-semibold text-violet-300 flex items-center gap-1.5">
                  <Github className="h-3.5 w-3.5" />
                  Linked Repo
                </p>
                <p className="text-[10px] text-muted-foreground font-mono">{project.githubRepo}</p>
                <button
                  type="button"
                  onClick={() => handleImport(project.githubRepo!)}
                  disabled={importing}
                  className="w-full flex items-center justify-center gap-1.5 py-1.5 bg-violet-600 hover:bg-violet-500 disabled:opacity-50 text-white text-[11px] font-medium rounded transition-colors"
                >
                  {importing ? <Loader2 className="h-3 w-3 animate-spin" /> : <Download className="h-3 w-3" />}
                  {importing ? "Syncing..." : "Re-sync from GitHub"}
                </button>
              </div>
            )}
            <p className="text-[11px] text-muted-foreground">
              Import files from any GitHub repository into this project.
              Public repos work without a token. Private repos need{" "}
              <code className="text-violet-400">GITHUB_TOKEN</code>.
            </p>

            <div className="space-y-2">
              <label className="block">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Repository (owner/repo) *
                </span>
                <input
                  type="text"
                  value={importRepo}
                  onChange={(e) => setImportRepo(e.target.value)}
                  placeholder="e.g. facebook/react"
                  className="mt-1 w-full bg-[oklch(0.14_0.02_260)] border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-500"
                />
              </label>

              <label className="block">
                <span className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                  Branch (optional, defaults to main)
                </span>
                <input
                  type="text"
                  value={importBranch}
                  onChange={(e) => setImportBranch(e.target.value)}
                  placeholder="main"
                  className="mt-1 w-full bg-[oklch(0.14_0.02_260)] border border-border rounded px-2 py-1.5 text-[11px] text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-violet-500"
                />
              </label>
            </div>

            <button
              type="button"
              onClick={handleImport}
              disabled={importing}
              className="w-full flex items-center justify-center gap-2 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-[11px] font-semibold text-white transition-colors"
            >
              {importing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Download className="h-3.5 w-3.5" />
              )}
              {importing ? "Importing..." : "Import from GitHub"}
            </button>
          </div>
        )}

      </div>
    </div>
  );
}
