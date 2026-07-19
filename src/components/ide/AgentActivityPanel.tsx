/**
 * AgentActivityPanel — live multi-agent activity feed.
 *
 * Shows two views:
 *  1. "Agents" — per-agent swim lanes with live pulsing status + latest action
 *  2. "Log" — full chronological thought stream with timestamps
 *
 * Automatically switches to Agents view when a mission starts.
 * Every agent gets its own color + icon + status indicator.
 */
import { useMutation, useQuery } from "convex/react";
import {
  Activity,
  Bot,
  Brain,
  CheckCircle2,
  ChevronDown,
  FileCode2,
  FilePlus,
  FileSearch,
  Loader2,
  Send,
  Zap,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

interface Props {
  projectId: Id<"projects">;
}

const AGENT_COLORS: Record<
  string,
  { dot: string; text: string; bg: string; border: string }
> = {
  orchestrator: {
    dot: "bg-violet-400",
    text: "text-violet-400",
    bg: "bg-violet-400/8",
    border: "border-violet-500/25",
  },
  frontend: {
    dot: "bg-blue-400",
    text: "text-blue-400",
    bg: "bg-blue-400/8",
    border: "border-blue-500/25",
  },
  backend: {
    dot: "bg-green-400",
    text: "text-green-400",
    bg: "bg-green-400/8",
    border: "border-green-500/25",
  },
  devops: {
    dot: "bg-amber-400",
    text: "text-amber-400",
    bg: "bg-amber-400/8",
    border: "border-amber-500/25",
  },
};

const AGENT_PERMISSIONS: Record<string, string> = {
  orchestrator: "Read-only • Orchestrator",
  frontend: "Read/Write • src/components",
  backend: "Read/Write • convex/",
  devops: "Execute • Deployments",
};

function getRoleFromAgentId(agentId: string): string {
  if (agentId === "orchestrator") return "orchestrator";
  if (agentId.startsWith("swarm:")) {
    const parts = agentId.split(":");
    return parts[2] ?? "unknown";
  }
  return agentId;
}

const DEFAULT_COLOR = {
  dot: "bg-pink-400",
  text: "text-pink-400",
  bg: "bg-pink-400/8",
  border: "border-pink-500/25",
};

const TOOL_ICONS: Record<string, { icon: React.ReactNode; color: string }> = {
  create_file: {
    icon: <FilePlus className="h-3 w-3" />,
    color: "text-green-400",
  },
  edit_file: {
    icon: <FileCode2 className="h-3 w-3" />,
    color: "text-blue-400",
  },
  read_file: {
    icon: <FileSearch className="h-3 w-3" />,
    color: "text-cyan-400",
  },
  list_files: {
    icon: <FileSearch className="h-3 w-3" />,
    color: "text-muted-foreground",
  },
  search_files: {
    icon: <FileSearch className="h-3 w-3" />,
    color: "text-yellow-400",
  },
  spawn_agent: { icon: <Zap className="h-3 w-3" />, color: "text-violet-400" },
  send_message: { icon: <Send className="h-3 w-3" />, color: "text-pink-400" },
  complete_task: {
    icon: <CheckCircle2 className="h-3 w-3" />,
    color: "text-emerald-400",
  },
};

const THOUGHT_COLORS: Record<string, string> = {
  plan: "text-violet-400",
  analyze: "text-blue-400",
  code: "text-green-400",
  debug: "text-red-400",
  review: "text-orange-400",
  memory: "text-purple-400",
  search: "text-cyan-400",
  broadcast: "text-pink-400",
  done: "text-emerald-400",
};

export function AgentActivityPanel({ projectId }: Props) {
  const toolCalls = useQuery(api.engine.listToolCalls, {
    projectId,
    limit: 200,
  });
  const thoughts = useQuery(api.agentThoughts.listRecent, {
    projectId,
    limit: 120,
  });
  const [view, setView] = useState<"agents" | "log">("agents");
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  const autonomousSettings = useQuery(api.suggestions.getAutonomousMode, {
    projectId,
  });
  const setAutonomousMode = useMutation(api.suggestions.setAutonomousMode);

  const autonomousLevel = autonomousSettings?.autonomousLevel ?? "manual";

  // Auto-scroll on new activity
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [autoScroll]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };

  // Build per-agent summaries from thoughts
  const agentLanes = useMemo(() => {
    if (!thoughts || thoughts.length === 0) return [];

    const agents = new Map<
      string,
      {
        agentId: string;
        agentName: string;
        latestThought: string;
        latestType: string;
        isActive: boolean;
        isDone: boolean;
        thoughtCount: number;
        fileChanges: number;
      }
    >();

    for (const t of thoughts) {
      // Legacy thoughts may lack these fields; fall back to safe defaults.
      const agentId = t.agentId ?? "unknown";
      const agentName = t.agentName ?? "Agent";
      const thoughtType = t.type ?? "thinking";
      const existing = agents.get(agentId);
      const isDone = thoughtType === "done";
      const isActive = !isDone && Date.now() - t.timestamp < 30000; // active if thought < 30s ago

      agents.set(agentId, {
        agentId,
        agentName,
        latestThought: t.content,
        latestType: thoughtType,
        isActive: isDone ? false : (existing?.isActive ?? false) || isActive,
        isDone: isDone || (existing?.isDone ?? false),
        thoughtCount: (existing?.thoughtCount ?? 0) + 1,
        fileChanges:
          (existing?.fileChanges ?? 0) +
          (t.content.includes("create_file") || t.content.includes("edit_file")
            ? 1
            : 0),
      });
    }
    // Orchestrator first, rest in middle
    type Lane = typeof agents extends Map<string, infer T> ? T : never;
    const sorted = Array.from(agents.values()).sort((a: Lane, b: Lane) => {
      const roleA = getRoleFromAgentId(a.agentId);
      const roleB = getRoleFromAgentId(b.agentId);
      if (roleA === "orchestrator") return -1;
      if (roleB === "orchestrator") return 1;
      return 0;
    });

    return sorted;
  }, [thoughts]);

  // Active tool calls across all agents
  const activeCalls =
    toolCalls?.filter(
      (c: { status: string; tool: string; args: string; _id: string }) =>
        c.status === "running" || c.status === "pending",
    ) ?? [];

  const totalCalls = toolCalls?.length ?? 0;
  const isRunning =
    activeCalls.length > 0 ||
    (thoughts?.some((t: { isStreaming?: boolean }) => t.isStreaming) ?? false);
  const activeAgentCount = agentLanes.filter(
    (a: NonNullable<typeof agentLanes>[number]) => a.isActive,
  ).length;

  return (
    <div className="h-full flex flex-col bg-[oklch(0.11_0.02_260)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Activity
          className={cn(
            "h-4 w-4",
            isRunning
              ? "text-amber-400 animate-pulse"
              : "text-muted-foreground/50",
          )}
        />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex-1 min-w-0 truncate">
          Agents
        </span>

        {/* Live status badges */}
        {isRunning && (
          <span className="flex items-center gap-1 text-[9px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full animate-pulse shrink-0">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            {activeAgentCount > 0 ? `${activeAgentCount} active` : "running"}
          </span>
        )}
        {totalCalls > 0 && !isRunning && (
          <span className="text-[9px] text-muted-foreground/50 shrink-0">
            {totalCalls} calls
          </span>
        )}

        {/* Budget Bar */}
        <div className="flex-1 max-w-[120px] hidden sm:flex flex-col gap-1 mx-2">
          <div className="flex justify-between text-[8px] text-muted-foreground/70 uppercase font-bold tracking-wider">
            <span>Budget</span>
            <span>$0.04 / $5.00</span>
          </div>
          <div className="h-1.5 bg-black/40 rounded-full overflow-hidden">
            <div className="h-full bg-amber-400 w-[5%]" />
          </div>
        </div>

        {/* Autonomy Level Selector */}
        <select
          value={autonomousLevel}
          onChange={e => {
            const val = e.target.value;
            setAutonomousMode({
              projectId,
              autonomousMode: val === "autonomous" || val === "autopilot",
              autonomousLevel: val,
            }).catch(() => {});
          }}
          className="bg-white/5 border border-border text-[9px] font-bold uppercase tracking-wider text-muted-foreground hover:text-foreground rounded px-1.5 py-0.5 outline-none focus:border-primary shrink-0 transition-colors"
        >
          <option value="manual" className="bg-background text-foreground">Manual</option>
          <option value="suggest" className="bg-background text-foreground">Suggest</option>
          <option value="apply" className="bg-background text-foreground">Apply w/ Approval</option>
          <option value="autonomous" className="bg-background text-foreground">Autonomous</option>
          <option value="autopilot" className="bg-background text-foreground">Full Autopilot</option>
        </select>

        {/* View toggle */}
        <div className="flex rounded border border-border overflow-hidden shrink-0">
          {(["agents", "log"] as const).map(v => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              className={cn(
                "px-2 py-0.5 text-[9px] font-medium uppercase transition-colors",
                view === v
                  ? "bg-white/10 text-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div
        className="flex-1 overflow-y-auto overflow-x-hidden min-w-0"
        onScroll={handleScroll}
      >
        {/* ── AGENTS VIEW — swim lanes ── */}
        {view === "agents" && (
          <div className="p-2 space-y-2">
            {agentLanes.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Bot className="h-8 w-8 text-muted-foreground/20 mb-3" />
                <p className="text-xs text-muted-foreground">
                  Waiting for mission...
                </p>
                <p className="text-[10px] text-muted-foreground/50 mt-1">
                  Ask to build something to see agents spawn here
                </p>
              </div>
            )}

            {agentLanes.map(agent => {
              const role = getRoleFromAgentId(agent.agentId);
              const color = AGENT_COLORS[role] ?? DEFAULT_COLOR;
              const isActive = agent.isActive;
              const isDone = agent.isDone;

              return (
                <div
                  key={agent.agentId}
                  className={cn(
                    "rounded-lg border p-2.5 transition-all duration-300",
                    color.bg,
                    color.border,
                    isActive && "shadow-sm",
                  )}
                >
                  {/* Agent header */}
                  <div className="flex items-center gap-2 mb-1.5 min-w-0">
                    {/* Status dot */}
                    <div
                      className={cn(
                        "w-2 h-2 rounded-full shrink-0",
                        color.dot,
                        isActive && "animate-pulse",
                        isDone && "opacity-50",
                      )}
                    />

                    <span
                      className={cn(
                        "text-[11px] font-semibold truncate flex-1",
                        color.text,
                      )}
                    >
                      {agent.agentName}
                    </span>

                    {/* Status badge */}
                    <span
                      className={cn(
                        "text-[9px] font-bold px-1.5 py-0.5 rounded-full shrink-0",
                        isActive
                          ? "bg-amber-400/15 text-amber-400"
                          : isDone
                            ? "bg-emerald-400/15 text-emerald-400"
                            : "bg-white/5 text-muted-foreground/50",
                      )}
                    >
                      {isActive ? "⚡ active" : isDone ? "✓ done" : "waiting"}
                    </span>
                  </div>

                  {/* Permission Model */}
                  <div className="text-[9px] text-muted-foreground/40 font-mono pl-4 mb-1">
                    {AGENT_PERMISSIONS[role] ?? "Read/Write • standard"}
                  </div>

                  {/* Latest thought */}
                  <p className="text-[10px] text-foreground/70 leading-snug break-words line-clamp-3 pl-4">
                    {agent.latestThought.slice(0, 200)}
                    {isActive && agent.latestType !== "done" && (
                      <span className="inline-block w-1 h-3 bg-current ml-0.5 animate-pulse align-middle" />
                    )}
                  </p>

                  {/* Stats */}
                  {agent.thoughtCount > 1 && (
                    <div className="flex gap-2 mt-1.5 pl-4">
                      <span className="text-[9px] text-muted-foreground/40">
                        {agent.thoughtCount} steps
                      </span>
                      {agent.fileChanges > 0 && (
                        <span className="text-[9px] text-green-400/60">
                          {agent.fileChanges} file writes
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}

            {/* Active tool calls list */}
            {activeCalls.length > 0 && (
              <div className="mt-2 rounded-lg border border-border/30 bg-white/3 p-2">
                <p className="text-[9px] font-bold uppercase text-muted-foreground/50 mb-1.5">
                  Running ({activeCalls.length})
                </p>
                {activeCalls
                  .slice(0, 6)
                  .map(
                    (call: {
                      _id: string;
                      tool: string;
                      args: string;
                      status: string;
                      agentId?: string;
                    }) => {
                      const meta = TOOL_ICONS[call.tool] ?? {
                        icon: <Zap className="h-3 w-3" />,
                        color: "text-muted-foreground",
                      };
                      let args: Record<string, string> = {};
                      try {
                        args = JSON.parse(call.args);
                      } catch {
                        /* */
                      }
                      return (
                        <div
                          key={call._id}
                          className="flex items-center gap-1.5 py-0.5"
                        >
                          <Loader2 className="h-2.5 w-2.5 animate-spin text-amber-400 shrink-0" />
                          <span
                            className={cn("text-[10px] shrink-0", meta.color)}
                          >
                            {call.tool}
                          </span>
                          <span className="text-[9px] text-muted-foreground/50 truncate">
                            {args.path ?? args.query ?? args.role ?? ""}
                          </span>
                        </div>
                      );
                    },
                  )}
              </div>
            )}

            <div ref={bottomRef} />
          </div>
        )}

        {/* ── LOG VIEW — full thought stream ── */}
        {view === "log" && (
          <div className="p-1.5 space-y-0.5 font-mono text-[10px]">
            {(!thoughts || thoughts.length === 0) && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Brain className="h-8 w-8 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">No logs yet</p>
              </div>
            )}
            {thoughts?.map(
              (
                t: NonNullable<typeof thoughts>[number],
                i: number,
                arr: NonNullable<typeof thoughts>,
              ) => {
                const color =
                  THOUGHT_COLORS[t.type ?? ""] ?? "text-foreground/70";
                const role = getRoleFromAgentId(t.agentId ?? "");
                const agentColor = (AGENT_COLORS[role] ?? DEFAULT_COLOR).text;
                const isLast = i === arr.length - 1;
                return (
                  <div
                    key={t._id}
                    className={cn(
                      "flex items-start gap-1.5 px-1.5 py-0.5 rounded",
                      isLast ? "bg-[oklch(0.16_0.02_260)]" : "",
                    )}
                  >
                    <span className="shrink-0 text-muted-foreground/30 w-12 tabular-nums pt-0.5 text-[9px]">
                      {new Date(t.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                        second: "2-digit",
                      })}
                    </span>
                    <span
                      className={cn(
                        "shrink-0 font-bold w-12 truncate text-[9px] pt-0.5",
                        agentColor,
                      )}
                    >
                      {(t.agentName ?? "Agent")
                        .replace(/^[^\s]+ /, "")
                        .slice(0, 8)}
                    </span>
                    <span
                      className={cn("shrink-0 text-[9px] pt-0.5 w-12", color)}
                    >
                      [{t.type}]
                    </span>
                    <span
                      className={cn(
                        "flex-1 leading-relaxed break-words",
                        color,
                      )}
                    >
                      {t.content}
                      {isLast && t.isStreaming && (
                        <span className="inline-block w-1 h-3 bg-current ml-0.5 animate-pulse" />
                      )}
                    </span>
                  </div>
                );
              },
            )}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {!autoScroll && (
        <button
          type="button"
          onClick={() => {
            setAutoScroll(true);
            bottomRef.current?.scrollIntoView({ behavior: "smooth" });
          }}
          className="mx-2 mb-2 py-1 text-[10px] text-muted-foreground hover:text-foreground bg-white/5 rounded text-center shrink-0 flex items-center justify-center gap-1"
        >
          <ChevronDown className="h-3 w-3" /> Jump to latest
        </button>
      )}
    </div>
  );
}
