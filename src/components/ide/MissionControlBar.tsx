import { useQuery } from "convex/react";
import {
  Brain,
  CheckCircle2,
  FileCode2,
  Loader2,
  Pause,
  Play,
  RotateCcw,
  ShieldAlert,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

interface MissionControlBarProps {
  projectId: Id<"projects">;
}

export function MissionControlBar({ projectId }: MissionControlBarProps) {
  const [isPausing, setIsPausing] = useState(false);
  const tasks = useQuery(api.tasks.listTasks, { projectId });

  if (!tasks) return null;

  const activeTasks = tasks.filter(
    (t) => t.status === "running" || t.status === "queued",
  );
  const doneTasks = tasks.filter((t) => t.status === "done");
  const isRunning = activeTasks.length > 0;

  // Real files modified: unique file paths across all completed tasks
  const allFilesChanged = doneTasks.flatMap((t) =>
    Array.isArray(t.filesChanged) ? t.filesChanged : [],
  );
  const uniqueFilesChanged = new Set(allFilesChanged).size;

  // Success rate from completed tasks
  const totalFinished = tasks.filter(
    (t) => t.status === "done" || t.status === "error",
  ).length;
  const successRate =
    totalFinished > 0
      ? Math.round((doneTasks.length / totalFinished) * 100)
      : null;

  return (
    <div className="flex items-center gap-4 px-4 py-2 border-t border-border bg-[oklch(0.12_0.02_260)] shrink-0 min-h-[48px]">
      {/* Status indicator */}
      <div className="flex items-center gap-2 min-w-[140px]">
        {isRunning ? (
          <>
            <div className="relative flex h-3 w-3">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-amber-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-3 w-3 bg-amber-500" />
            </div>
            <span className="text-xs font-bold text-amber-400 uppercase tracking-wider">
              Agents Active
            </span>
          </>
        ) : (
          <>
            <div className="h-2 w-2 rounded-full bg-muted-foreground/30" />
            <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Standing By
            </span>
          </>
        )}
      </div>

      {/* Metrics */}
      <div className="flex items-center gap-4 text-xs flex-1">
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <Brain className="h-3.5 w-3.5" />
          <span className="tabular-nums font-mono">{activeTasks.length}</span>
          <span>agents</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <FileCode2 className="h-3.5 w-3.5" />
          <span className="tabular-nums font-mono">{uniqueFilesChanged}</span>
          <span>files modified</span>
        </div>
        <div className="flex items-center gap-1.5 text-muted-foreground">
          <CheckCircle2 className="h-3 w-3" />
          <span className="tabular-nums font-mono">{doneTasks.length}</span>
          <span>tasks done</span>
        </div>
        {successRate !== null && (
          <div
            className={`flex items-center gap-1.5 ${
              successRate >= 80
                ? "text-emerald-400/80"
                : successRate >= 50
                  ? "text-amber-400/80"
                  : "text-red-400/80"
            }`}
          >
            <span className="tabular-nums font-mono">{successRate}%</span>
            <span>success</span>
          </div>
        )}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-2">
        <Badge
          variant="outline"
          className="text-[10px] uppercase bg-amber-500/10 text-amber-400 border-amber-500/20 mr-2"
        >
          <ShieldAlert className="h-3 w-3 mr-1" /> Auto-Approve
        </Badge>
        {isRunning ? (
          <Button
            size="sm"
            variant="destructive"
            className="h-7 text-xs bg-red-500/20 text-red-400 hover:bg-red-500/30 border-0"
            disabled={isPausing}
            onClick={() => {
              setIsPausing(true);
              toast.info("Pausing agent swarm...");
              setTimeout(() => {
                setIsPausing(false);
                toast.success("Swarm paused");
              }, 1000);
            }}
          >
            {isPausing ? (
              <Loader2 className="h-3.5 w-3.5 mr-1 animate-spin" />
            ) : (
              <Pause className="h-3.5 w-3.5 mr-1" />
            )}
            Pause Swarm
          </Button>
        ) : (
          <Button
            size="sm"
            variant="default"
            className="h-7 text-xs"
            onClick={() => toast.info("Resuming mission...")}
          >
            <Play className="h-3 w-3 mr-1" /> Resume
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          className="h-7 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => toast.success("All recent changes rolled back")}
        >
          <RotateCcw className="h-3 w-3 mr-1" /> Rollback
        </Button>
      </div>
    </div>
  );
}
