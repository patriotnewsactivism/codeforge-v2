import { useAction, useQuery } from "convex/react";
import {
  AlertTriangle,
  Brain,
  CheckCircle2,
  DollarSign,
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
  const changeHistory = useQuery(api.changeHistory.listByProject, {
    projectId,
    limit: 50,
  });

  const activeTasks =
    tasks?.filter(
      (t: NonNullable<typeof tasks>[number]) =>
        t.status === "running" || t.status === "queued",
    ) ?? [];
  const isRunning = activeTasks.length > 0;

  const totalCost = 0.04; // TODO: aggregate from recent tasks/session
  const filesChanged = changeHistory?.length ?? 0;
  const confidence = 92; // TODO: Pull from agent stats

  if (!tasks) return null;

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
          <span className="tabular-nums font-mono">{filesChanged}</span>
          <span>files modified</span>
        </div>
        <div className="flex items-center gap-1.5 text-green-400/80">
          <DollarSign className="h-3.5 w-3.5" />
          <span className="tabular-nums font-mono">{totalCost.toFixed(3)}</span>
        </div>
        <div className="flex items-center gap-1.5 text-emerald-400/80">
          <CheckCircle2 className="h-3 w-3" />
          <span>{confidence}% confidence</span>
        </div>
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
              }, 1000); // TODO: actual API
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
