import { useState } from "react";
import { useQuery, useAction } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Bot,
  Loader2,
  Check,
  AlertCircle,
  Zap,
  Send,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface AgentPanelProps {
  projectId: Id<"projects">;
}

export function AgentPanel({ projectId }: AgentPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);

  const tasks = useQuery(api.agents.listTasks, { projectId });
  const runMultiAgent = useAction(api.agents.runMultiAgent);

  const activeTasks = tasks?.filter(
    (t) => t.status === "running" || t.status === "queued"
  ) ?? [];
  const recentTasks = tasks
    ?.filter((t) => t.status === "done" || t.status === "error")
    .slice(-10)
    .reverse() ?? [];

  const handleRun = async () => {
    if (!prompt.trim() || isRunning) return;
    setIsRunning(true);
    setLastResult(null);
    try {
      const result = await runMultiAgent({ projectId, prompt: prompt.trim() });
      setLastResult(result);
      setPrompt("");
    } catch (e) {
      setLastResult(`Error: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setIsRunning(false);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[oklch(0.11_0.02_260)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Zap className="h-4 w-4 text-amber-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Multi-Agent
        </span>
        {activeTasks.length > 0 && (
          <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full">
            {activeTasks.length} active
          </span>
        )}
      </div>

      {/* Active agents */}
      <div className="flex-1 overflow-y-auto px-2 py-2 space-y-2">
        {activeTasks.length === 0 && recentTasks.length === 0 && !lastResult && (
          <div className="flex flex-col items-center justify-center h-full text-center px-4">
            <Bot className="h-8 w-8 text-amber-400/30 mb-3" />
            <p className="text-sm text-muted-foreground mb-1">
              Multi-Agent Mode
            </p>
            <p className="text-xs text-muted-foreground/60">
              Spin up parallel AI agents to work on different parts of your project simultaneously
            </p>
          </div>
        )}

        {/* Active tasks */}
        {activeTasks.map((task) => (
          <AgentTaskCard key={task._id} task={task} />
        ))}

        {/* Result summary */}
        {lastResult && (
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <div className="flex items-center gap-1.5 mb-2">
              <Check className="h-3.5 w-3.5 text-green-400" />
              <span className="text-xs font-semibold">Agents Complete</span>
            </div>
            <div className="text-xs text-muted-foreground whitespace-pre-wrap">
              {lastResult}
            </div>
          </div>
        )}

        {/* Recent tasks */}
        {recentTasks.map((task) => (
          <AgentTaskCard key={task._id} task={task} />
        ))}
      </div>

      {/* Input */}
      <div className="px-3 py-2 border-t border-border">
        <div className="flex gap-2">
          <textarea
            className="flex-1 bg-[oklch(0.18_0.02_260)] border border-border rounded-lg px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-primary resize-none"
            placeholder="Describe what to build (agents will split the work)..."
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleRun();
              }
            }}
            rows={2}
            disabled={isRunning}
          />
          <Button
            size="icon"
            className="shrink-0 self-end"
            disabled={!prompt.trim() || isRunning}
            onClick={handleRun}
          >
            {isRunning ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </Button>
        </div>
      </div>
    </div>
  );
}

function AgentTaskCard({
  task,
}: {
  task: {
    _id: string;
    agentIcon: string;
    agentName: string;
    task: string;
    status: string;
    result?: string;
    filesChanged?: string[];
  };
}) {
  return (
    <div
      className={cn(
        "rounded-lg border p-2.5",
        task.status === "running"
          ? "border-primary/40 bg-primary/5"
          : task.status === "queued"
            ? "border-border bg-[oklch(0.14_0.02_260)]"
            : task.status === "done"
              ? "border-green-500/20 bg-green-500/5"
              : "border-destructive/20 bg-destructive/5"
      )}
    >
      <div className="flex items-center gap-2 mb-1">
        <span className="text-sm">{task.agentIcon}</span>
        <span className="text-xs font-semibold">{task.agentName}</span>
        <div className="ml-auto">
          {task.status === "running" ? (
            <Loader2 className="h-3 w-3 text-primary animate-spin" />
          ) : task.status === "queued" ? (
            <div className="w-2 h-2 rounded-full bg-muted-foreground/40" />
          ) : task.status === "done" ? (
            <Check className="h-3 w-3 text-green-400" />
          ) : (
            <AlertCircle className="h-3 w-3 text-destructive" />
          )}
        </div>
      </div>
      <p className="text-[10px] text-muted-foreground truncate">{task.task}</p>
      {task.result && (
        <p className="text-[10px] text-muted-foreground/80 mt-1 line-clamp-2">
          {task.result}
        </p>
      )}
      {task.filesChanged && task.filesChanged.length > 0 && (
        <div className="flex gap-1 mt-1 flex-wrap">
          {task.filesChanged.map((f) => (
            <span
              key={f}
              className="text-[9px] bg-primary/10 text-primary px-1 py-0.5 rounded"
            >
              {f}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
