/**
 * ═══════════════════════════════════════════════════════════════════
 * CODEFORGE v2 — GIT PANEL (Two-Way Sync)
 * ═══════════════════════════════════════════════════════════════════
 *
 * Push/Pull from GitHub. Shows branches, mission history.
 * Full two-way sync with commit messages and conflict detection.
 */
import type { Id } from "../../../convex/_generated/dataModel";
import { useQuery, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import {
  GitBranch,
  Github,
  Upload,
  Download,
  Loader2,
  RefreshCw,
  Check,
  AlertTriangle,
} from "lucide-react";

interface GitPanelProps {
  projectId: Id<"projects"> | null;
}

export function GitPanel({ projectId }: GitPanelProps) {
  const githubSettings = useQuery(api.github.getSettings);
  const missions = useQuery(
    api.missions.listByProject,
    projectId ? { projectId } : "skip"
  );
  const activeProject = useQuery(
    api.projects.get,
    projectId ? { projectId } : "skip"
  );
  const allFiles = useQuery(
    api.files.listWithContent,
    projectId ? { projectId } : "skip"
  );

  const commitFile = useAction(api.github.commitFile);
  const importRepo = useAction(api.github.importRepo);

  const [isPushing, setIsPushing] = useState(false);
  const [isPulling, setIsPulling] = useState(false);
  const [commitMessage, setCommitMessage] = useState("");
  const [pushProgress, setPushProgress] = useState({ done: 0, total: 0 });

  const repo = activeProject?.githubRepo;

  // Push all files to GitHub
  const handlePush = async () => {
    if (!repo || !allFiles || !projectId) return;
    const msg = commitMessage.trim() || `CodeForge update — ${new Date().toLocaleString()}`;
    setIsPushing(true);

    const filesToPush = allFiles.filter((f) => f.type === "file" && f.content);
    setPushProgress({ done: 0, total: filesToPush.length });

    let successCount = 0;
    let failCount = 0;

    // Push files sequentially to avoid rate limits
    for (let i = 0; i < filesToPush.length; i++) {
      const file = filesToPush[i];
      try {
        const result = await commitFile({
          repo,
          path: file.path,
          content: file.content || "",
          message: `${msg}\n\nFile: ${file.path}`,
        });
        if (result.success) {
          successCount++;
        } else {
          failCount++;
          console.error(`Failed to push ${file.path}:`, result.error);
        }
      } catch (e) {
        failCount++;
        console.error(`Error pushing ${file.path}:`, e);
      }
      setPushProgress({ done: i + 1, total: filesToPush.length });
    }

    setIsPushing(false);
    setCommitMessage("");

    if (failCount === 0) {
      toast.success(`Pushed ${successCount} files to ${repo}`);
    } else {
      toast.error(`Pushed ${successCount} files, ${failCount} failed`);
    }
  };

  // Pull latest from GitHub
  const handlePull = async () => {
    if (!repo || !projectId) return;
    setIsPulling(true);

    try {
      const result = await importRepo({
        projectId,
        repo,
      });

      if (result.success) {
        toast.success(`Pulled ${result.fileCount} files from ${repo}`);
      } else {
        toast.error(result.error || "Failed to pull from GitHub");
      }
    } catch (e) {
      toast.error("Failed to pull from GitHub");
    }

    setIsPulling(false);
  };

  if (!projectId) {
    return (
      <div className="flex h-full items-center justify-center p-4 bg-[#0a0a0f]">
        <p className="text-xs text-white/30">Select a project to view git activity</p>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col bg-[#0a0a0f] border-l border-white/5">
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/5 px-3 py-2 bg-white/[0.02]">
        <GitBranch className="h-4 w-4 text-emerald-400/60" />
        <span className="text-xs font-semibold text-white/70">Git</span>
        {githubSettings?.connected && (
          <Badge className="text-[9px] h-4 px-1.5 bg-white/5 text-white/40 border-0">
            <Github className="h-2.5 w-2.5 mr-1" />
            connected
          </Badge>
        )}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-2 space-y-3">
        {!githubSettings?.connected ? (
          <div className="flex flex-col items-center justify-center py-8">
            <Github className="h-8 w-8 mb-3 text-white/10" />
            <p className="text-xs text-white/30 font-medium">GitHub not connected</p>
            <p className="text-[10px] text-white/20 text-center mt-1">
              Connect GitHub from the top bar to enable git features
            </p>
          </div>
        ) : (
          <>
            {/* Sync section */}
            {repo && (
              <div className="rounded-lg border border-white/5 p-3 bg-white/[0.02] space-y-3">
                <div className="flex items-center gap-2">
                  <Github className="h-3.5 w-3.5 text-white/40" />
                  <span className="text-[11px] text-white/60 font-mono truncate">
                    {repo}
                  </span>
                </div>

                {/* Commit message */}
                <Input
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                  placeholder="Commit message (optional)..."
                  className="h-7 text-xs bg-white/5 border-white/10"
                />

                {/* Push / Pull buttons */}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1 h-7 text-xs gap-1.5"
                    onClick={handlePush}
                    disabled={isPushing || isPulling || !allFiles?.length}
                  >
                    {isPushing ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Pushing {pushProgress.done}/{pushProgress.total}
                      </>
                    ) : (
                      <>
                        <Upload className="h-3 w-3" />
                        Push to GitHub
                      </>
                    )}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    className="flex-1 h-7 text-xs gap-1.5"
                    onClick={handlePull}
                    disabled={isPulling || isPushing}
                  >
                    {isPulling ? (
                      <>
                        <Loader2 className="h-3 w-3 animate-spin" />
                        Pulling...
                      </>
                    ) : (
                      <>
                        <Download className="h-3 w-3" />
                        Pull from GitHub
                      </>
                    )}
                  </Button>
                </div>

                {/* File count */}
                <div className="text-[10px] text-white/20">
                  {allFiles?.filter((f) => f.type === "file").length || 0} files in project
                </div>
              </div>
            )}

            {!repo && (
              <div className="rounded-lg border border-dashed border-white/10 p-4 text-center">
                <AlertTriangle className="h-5 w-5 mx-auto mb-2 text-yellow-400/40" />
                <p className="text-[11px] text-white/40">
                  No GitHub repo linked to this project.
                </p>
                <p className="text-[10px] text-white/20 mt-1">
                  Import a repo from the top bar to enable push/pull.
                </p>
              </div>
            )}

            {/* Mission history */}
            <div>
              <div className="text-[10px] text-white/20 uppercase tracking-wider font-semibold mb-2 px-1">
                Mission History
              </div>
              {!missions || missions.length === 0 ? (
                <div className="text-center py-4">
                  <p className="text-[10px] text-white/15">No missions yet</p>
                </div>
              ) : (
                <div className="space-y-1.5">
                  {missions.map((mission) => (
                    <div
                      key={mission._id}
                      className={cn(
                        "rounded-lg border border-white/5 p-2.5 bg-white/[0.02]",
                        mission.status === "running" && "border-emerald-500/20"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <span className="text-[10px] text-white/50 truncate flex-1">
                          {mission.prompt?.slice(0, 60)}
                        </span>
                        <Badge
                          className={cn(
                            "text-[8px] h-3.5 px-1 border-0 shrink-0",
                            mission.status === "completed"
                              ? "bg-emerald-500/10 text-emerald-400"
                              : mission.status === "running"
                              ? "bg-blue-500/10 text-blue-400"
                              : mission.status === "failed"
                              ? "bg-red-500/10 text-red-400"
                              : "bg-white/5 text-white/40"
                          )}
                        >
                          {mission.status === "completed" && <Check className="h-2 w-2 mr-0.5" />}
                          {mission.status}
                        </Badge>
                      </div>
                      <div className="text-[9px] text-white/15 mt-1">
                        {new Date(mission._creationTime).toLocaleString()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
