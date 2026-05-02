import { useState } from "react";
import { useQuery, useAction, useMutation } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import {
  Bot,
  Loader2,
  Check,
  AlertCircle,
  Zap,
  Send,
  ToggleLeft,
  ToggleRight,
  Flame,
  Brain,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

interface AgentPanelProps {
  projectId: Id<"projects">;
}

const STATUS_ICON: Record<string, React.ReactNode> = {
  queued: <div className="w-2 h-2 rounded-full bg-muted-foreground/40 animate-pulse" />,
  running: <Loader2 className="h-3 w-3 text-primary animate-spin" />,
  done: <Check className="h-3 w-3 text-green-400" />,
  error: <AlertCircle className="h-3 w-3 text-red-400" />,
};

export function AgentPanel({ projectId }: AgentPanelProps) {
  const [prompt, setPrompt] = useState("");
  const [isRunning, setIsRunning] = useState(false);
  const [lastResult, setLastResult] = useState<string | null>(null);
  const [tab, setTab] = useState<"run" | "history">("run");

  const tasks = useQuery(api.agents.listTasks, { projectId });
  const autonomousSettings = useQuery(api.suggestions.getAutonomousMode, { projectId });
  const runMultiAgent = useAction(api.agents.runMultiAgent);
  const runAutonomousCycle = useAction(api.suggestions.runAutonomousCycle);
  const setAutonomousMode = useMutation(api.suggestions.setAutonomousMode);

  const activeTasks = tasks?.filter(t => t.status === "running" || t.status === "queued") ?? [];
  const recentTasks = tasks?.filter(t => t.status === "done" || t.status === "error").slice(-15).reverse() ?? [];
  const autonomousOn = autonomousSettings?.autonomousMode ?? false;

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

  const handleToggleAutonomous = async () => {
    try {
      await setAutonomousMode({ projectId, autonomousMode: !autonomousOn });
      toast.success(autonomousOn ? "Autonomous mode paused" : "🔥 Autonomous mode ON — system is self-building");
    } catch {
      toast.error("Failed to toggle");
    }
  };

  const handleRunNow = async () => {
    try {
      toast.info("Running autonomous cycle...", { duration: 2000 });
      const result = await runAutonomousCycle({ projectId });
      toast.success(result.slice(0, 80));
    } catch (e) {
      toast.error(`Cycle failed: ${String(e)}`);
    }
  };

  return (
    <div className="h-full flex flex-col bg-[oklch(0.11_0.02_260)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Zap className="h-4 w-4 text-amber-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex-1">
          Agents
        </span>
        {activeTasks.length > 0 && (
          <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-bold animate-pulse">
            {activeTasks.length} running
          </span>
        )}
        {/* Autonomous toggle */}
        <button
          type="button"
          onClick={handleToggleAutonomous}
          className={cn(
            "flex items-center gap-1 px-2 py-1 rounded text-[10px] font-bold uppercase tracking-wider border transition-colors",
            autonomousOn
              ? "bg-amber-400/20 text-amber-400 border-amber-400/30"
              : "bg-white/5 text-muted-foreground border-border hover:text-foreground"
          )}
        >
          {autonomousOn ? <ToggleRight className="h-3 w-3" /> : <ToggleLeft className="h-3 w-3" />}
          Auto
        </button>
      </div>

      {/* Autonomous mode banner */}
      {autonomousOn && (
        <div className="flex items-center gap-2 px-3 py-2 bg-amber-400/10 border-b border-amber-400/20 shrink-0">
          <Flame className="h-3.5 w-3.5 text-amber-400 shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-amber-300 leading-snug">
              Self-building — picks top suggestion and builds it automatically.
            </p>
            {autonomousSettings?.lastAutoRunAt && (
              <p className="text-[9px] text-amber-300/50 mt-0.5">
                Last run: {new Date(autonomousSettings.lastAutoRunAt).toLocaleTimeString()}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={handleRunNow}
            className="shrink-0 text-[9px] font-bold uppercase text-amber-400 hover:text-amber-300 px-2 py-1 border border-amber-400/30 rounded transition-colors"
          >
            Run Now
          </button>
        </div>
      )}

      {/* Tabs */}
      <div className="flex border-b border-border shrink-0">
        {(["run", "history"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              "flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
              tab === t
                ? "text-amber-400 border-b-2 border-amber-400"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {t === "run" ? "Run Task" : `History (${recentTasks.length})`}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* ── RUN TAB ── */}
        {tab === "run" && (
          <div className="p-3 flex flex-col gap-3">
            {/* Active tasks */}
            {activeTasks.length > 0 && (
              <div className="space-y-1.5">
                <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60">
                  Running
                </p>
                {activeTasks.map(task => (
                  <div key={task._id} className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/20">
                    <span className="text-base leading-none">{task.agentIcon}</span>
                    <div className="flex-1 min-w-0">
                      <p className="text-[10px] font-semibold text-foreground truncate">{task.agentName}</p>
                      <p className="text-[9px] text-muted-foreground truncate">{task.task}</p>
                    </div>
                    <Loader2 className="h-3 w-3 text-primary animate-spin shrink-0" />
                  </div>
                ))}
              </div>
            )}

            {/* Prompt input */}
            <div>
              <label className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/60 block mb-1.5">
                Give agents a task
              </label>
              <textarea
                value={prompt}
                onChange={e => setPrompt(e.target.value)}
                onKeyDown={e => {
                  if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) handleRun();
                }}
                placeholder="e.g. Add a dark/light mode toggle, fix the mobile layout, add error boundaries to all panels..."
                rows={4}
                disabled={isRunning}
                className="w-full bg-[oklch(0.14_0.02_260)] border border-border rounded px-2.5 py-2 text-[11px] text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-primary resize-none leading-relaxed disabled:opacity-50"
              />
              <p className="text-[9px] text-muted-foreground/40 mt-1">Ctrl+Enter to run</p>
            </div>

            <button
              type="button"
              onClick={handleRun}
              disabled={!prompt.trim() || isRunning}
              className="flex items-center justify-center gap-2 w-full py-2.5 bg-amber-500/20 hover:bg-amber-500/30 disabled:opacity-40 text-amber-400 rounded font-bold text-[11px] transition-colors"
            >
              {isRunning ? (
                <><Loader2 className="h-3.5 w-3.5 animate-spin" /> Agents working...</>
              ) : (
                <><Zap className="h-3.5 w-3.5" /> Launch Agent Swarm</>
              )}
            </button>

            {/* Last result */}
            {lastResult && (
              <div className={cn(
                "rounded-md border p-2.5 text-[10px] leading-relaxed",
                lastResult.startsWith("Error:")
                  ? "border-red-500/20 bg-red-500/5 text-red-300"
                  : "border-green-500/20 bg-green-500/5 text-green-300"
              )}>
                <div className="flex items-center gap-1.5 mb-1">
                  {lastResult.startsWith("Error:") ? (
                    <AlertCircle className="h-3 w-3 shrink-0" />
                  ) : (
                    <Check className="h-3 w-3 shrink-0" />
                  )}
                  <span className="font-semibold text-[9px] uppercase tracking-wider">
                    {lastResult.startsWith("Error:") ? "Failed" : "Complete"}
                  </span>
                </div>
                <p className="whitespace-pre-wrap">{lastResult}</p>
              </div>
            )}

            {/* Quick prompts */}
            <div>
              <p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground/40 mb-1.5">
                Quick tasks
              </p>
              <div className="grid grid-cols-1 gap-1">
                {[
                  "Fix all mobile layout issues and ensure every touch target is at least 44px",
                  "Add loading states and error boundaries to every panel",
                  "Add keyboard shortcuts and improve overall accessibility",
                  "Polish the UI — better spacing, hover states, and micro-animations",
                ].map(q => (
                  <button
                    key={q}
                    type="button"
                    onClick={() => setPrompt(q)}
                    disabled={isRunning}
                    className="flex items-center gap-2 text-left p-2 rounded bg-white/3 hover:bg-white/6 border border-border/50 hover:border-border transition-colors text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-40"
                  >
                    <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/40" />
                    {q}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── HISTORY TAB ── */}
        {tab === "history" && (
          <div className="p-2 space-y-1.5">
            {recentTasks.length === 0 && (
              <div className="flex flex-col items-center justify-center py-14">
                <Bot className="h-8 w-8 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">No tasks run yet</p>
              </div>
            )}
            {recentTasks.map(task => (
              <div
                key={task._id}
                className={cn(
                  "rounded-md border p-2.5 transition-colors",
                  task.status === "error"
                    ? "border-red-500/20 bg-red-500/5"
                    : "border-border bg-[oklch(0.13_0.02_260)]"
                )}
              >
                <div className="flex items-center gap-2">
                  <span className="text-base leading-none">{task.agentIcon}</span>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] font-semibold text-foreground">{task.agentName}</p>
                    <p className="text-[9px] text-muted-foreground truncate">{task.task}</p>
                  </div>
                  <div className="shrink-0">{STATUS_ICON[task.status]}</div>
                </div>
                {task.result && (
                  <p className="text-[9px] text-muted-foreground/70 mt-1.5 ml-7 leading-relaxed">
                    {task.result.slice(0, 120)}{task.result.length > 120 ? "…" : ""}
                  </p>
                )}
                {task.filesChanged && task.filesChanged.length > 0 && (
                  <div className="flex flex-wrap gap-1 mt-1.5 ml-7">
                    {task.filesChanged.slice(0, 4).map(f => (
                      <span key={f} className="text-[8px] bg-white/5 border border-border/50 px-1.5 py-0.5 rounded font-mono text-muted-foreground/60">
                        {f.split("/").pop()}
                      </span>
                    ))}
                    {task.filesChanged.length > 4 && (
                      <span className="text-[8px] text-muted-foreground/40">+{task.filesChanged.length - 4} more</span>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
