/**
 * AgentActivityPanel — real-time view of the v2 engine tool-calling loop.
 * Subscribes to toolCalls + agentThoughts tables via Convex live queries.
 * Shows every tool call as it happens: pending → running → done/error.
 */
import { useQuery } from "convex/react";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import {
  FileCode2, FilePlus, FileX, FileSearch, FolderSearch,
  Zap, Bot, Send, CheckCircle2, AlertCircle, Loader2,
  Brain, ChevronDown, ChevronRight,
} from "lucide-react";

interface Props {
  projectId: Id<"projects">;
}

const TOOL_META: Record<string, { icon: React.ReactNode; color: string; label: string }> = {
  create_file:   { icon: <FilePlus className="h-3 w-3" />,    color: "text-green-400",  label: "create" },
  edit_file:     { icon: <FileCode2 className="h-3 w-3" />,   color: "text-blue-400",   label: "edit" },
  delete_file:   { icon: <FileX className="h-3 w-3" />,       color: "text-red-400",    label: "delete" },
  read_file:     { icon: <FileSearch className="h-3 w-3" />,  color: "text-cyan-400",   label: "read" },
  list_files:    { icon: <FolderSearch className="h-3 w-3" />, color: "text-cyan-400",  label: "list" },
  search_files:  { icon: <FolderSearch className="h-3 w-3" />, color: "text-yellow-400",label: "search" },
  spawn_agent:   { icon: <Zap className="h-3 w-3" />,         color: "text-violet-400", label: "spawn" },
  send_message:  { icon: <Send className="h-3 w-3" />,        color: "text-pink-400",   label: "msg" },
  complete_task: { icon: <CheckCircle2 className="h-3 w-3" />,color: "text-emerald-400",label: "done" },
};

const THOUGHT_COLORS: Record<string, string> = {
  plan: "text-violet-400", analyze: "text-blue-400", code: "text-green-400",
  debug: "text-red-400", review: "text-orange-400", memory: "text-purple-400",
  search: "text-cyan-400", commit: "text-yellow-400", broadcast: "text-pink-400",
  done: "text-emerald-400",
};

function parseArgs(raw: string): Record<string, string> {
  try { return JSON.parse(raw); } catch { return {}; }
}

function formatArg(key: string, val: string): string {
  if (key === "content") return `[${val.length} chars]`;
  if (val.length > 60) return val.slice(0, 57) + "…";
  return val;
}

export function AgentActivityPanel({ projectId }: Props) {
  const toolCalls = useQuery(api.engine.listToolCalls, { projectId, limit: 150 });
  const thoughts = useQuery(api.agentThoughts.listRecent, { projectId, limit: 80 });
  const [view, setView] = useState<"tools" | "thoughts">("tools");
  const [expandedTool, setExpandedTool] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const [autoScroll, setAutoScroll] = useState(true);

  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [toolCalls?.length, thoughts?.length, autoScroll]);

  const handleScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    setAutoScroll(el.scrollHeight - el.scrollTop - el.clientHeight < 60);
  };

  const activeCalls = toolCalls?.filter(c => c.status === "running" || c.status === "pending") ?? [];
  const isRunning = activeCalls.length > 0;

  return (
    <div className="h-full flex flex-col bg-[oklch(0.11_0.02_260)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border shrink-0">
        <Bot className="h-4 w-4 text-violet-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground flex-1">
          Agent Activity
        </span>
        {isRunning && (
          <span className="flex items-center gap-1 text-[9px] font-bold text-amber-400 bg-amber-400/10 px-1.5 py-0.5 rounded-full animate-pulse">
            <Loader2 className="h-2.5 w-2.5 animate-spin" />
            {activeCalls.length} active
          </span>
        )}
        <span className="text-[9px] text-muted-foreground/40">{toolCalls?.length ?? 0} calls</span>
      </div>

      {/* Sub-tabs */}
      <div className="flex border-b border-border shrink-0">
        {(["tools", "thoughts"] as const).map(v => (
          <button key={v} type="button" onClick={() => setView(v)}
            className={cn(
              "flex-1 py-1 text-[10px] font-semibold uppercase tracking-wider transition-colors",
              view === v ? "text-violet-400 border-b-2 border-violet-400" : "text-muted-foreground hover:text-foreground"
            )}>
            {v === "tools" ? "Tool Calls" : "Thoughts"}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden" onScroll={handleScroll}>
        {/* ── TOOL CALLS VIEW ── */}
        {view === "tools" && (
          <div className="p-2 space-y-1 font-mono text-[10px]">
            {(!toolCalls || toolCalls.length === 0) && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Zap className="h-8 w-8 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">No tool calls yet</p>
                <p className="text-xs text-muted-foreground/50 mt-1">
                  Ask the AI to build something — it'll show here live
                </p>
              </div>
            )}

            {toolCalls?.map(call => {
              const meta = TOOL_META[call.tool] ?? { icon: <Bot className="h-3 w-3" />, color: "text-foreground", label: call.tool };
              const args = parseArgs(call.args);
              const isExpanded = expandedTool === call._id;
              const statusIcon = call.status === "running"
                ? <Loader2 className="h-3 w-3 text-amber-400 animate-spin shrink-0" />
                : call.status === "done"
                  ? <CheckCircle2 className="h-3 w-3 text-green-400 shrink-0" />
                  : call.status === "error"
                    ? <AlertCircle className="h-3 w-3 text-red-400 shrink-0" />
                    : <div className="w-3 h-3 rounded-full border border-muted-foreground/30 shrink-0" />;

              return (
                <div
                  key={call._id}
                  className={cn(
                    "rounded border transition-colors",
                    call.status === "running" ? "border-amber-400/30 bg-amber-400/5" :
                    call.status === "error" ? "border-red-500/20 bg-red-500/5" :
                    call.status === "done" ? "border-border/50 bg-[oklch(0.13_0.02_260)]" :
                    "border-border/30"
                  )}>
                  <button
                    type="button"
                    className="flex items-center gap-2 w-full px-2 py-1.5 text-left"
                    onClick={() => setExpandedTool(isExpanded ? null : call._id)}
                  >
                    {statusIcon}
                    <span className={cn("shrink-0", meta.color)}>{meta.icon}</span>
                    <span className={cn("font-bold", meta.color)}>{meta.label}</span>
                    <span className="text-muted-foreground/60 truncate flex-1">
                      {args.path ?? args.role ?? args.to ?? ""}
                    </span>
                    <span className="text-muted-foreground/30 shrink-0">
                      {new Date(call.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                    </span>
                    {isExpanded ? <ChevronDown className="h-3 w-3 text-muted-foreground/30 shrink-0" /> :
                      <ChevronRight className="h-3 w-3 text-muted-foreground/30 shrink-0" />}
                  </button>

                  {isExpanded && (
                    <div className="px-2 pb-2 space-y-1 border-t border-border/30 pt-1.5 ml-2">
                      <div className="text-[9px] text-muted-foreground/50 font-bold uppercase">Args</div>
                      {Object.entries(args).map(([k, v]) => (
                        <div key={k} className="flex gap-1 text-[10px]">
                          <span className="text-muted-foreground/50 shrink-0">{k}:</span>
                          <span className="text-foreground/70 break-all">{formatArg(k, v)}</span>
                        </div>
                      ))}
                      {call.result && (
                        <>
                          <div className="text-[9px] text-muted-foreground/50 font-bold uppercase mt-1.5">Result</div>
                          <div className="text-[10px] text-green-300/80 break-words leading-relaxed">
                            {call.result.slice(0, 400)}
                          </div>
                        </>
                      )}
                      {call.error && (
                        <>
                          <div className="text-[9px] text-muted-foreground/50 font-bold uppercase mt-1.5">Error</div>
                          <div className="text-[10px] text-red-300/80 break-words">{call.error}</div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}

        {/* ── THOUGHTS VIEW ── */}
        {view === "thoughts" && (
          <div className="p-1.5 space-y-0.5 font-mono text-[10px]">
            {(!thoughts || thoughts.length === 0) && (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <Brain className="h-8 w-8 text-muted-foreground/20 mb-3" />
                <p className="text-sm text-muted-foreground">Agent thoughts appear here</p>
              </div>
            )}
            {thoughts?.map((t, i, arr) => {
              const color = THOUGHT_COLORS[t.type] ?? "text-foreground/70";
              const isLast = i === arr.length - 1;
              return (
                <div key={t._id} className={cn(
                  "flex items-start gap-1.5 px-1.5 py-0.5 rounded",
                  isLast ? "bg-[oklch(0.16_0.02_260)]" : ""
                )}>
                  <span className="shrink-0 text-muted-foreground/30 w-14 tabular-nums pt-0.5 text-[9px]">
                    {new Date(t.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                  <span className={cn("shrink-0 font-bold w-14 text-[9px] pt-0.5", color)}>[{t.type}]</span>
                  <span className={cn("flex-1 leading-relaxed break-words", color)}>
                    {t.content}
                    {isLast && t.isStreaming && <span className="inline-block w-1 h-3 bg-current ml-0.5 animate-pulse" />}
                  </span>
                </div>
              );
            })}
            <div ref={bottomRef} />
          </div>
        )}
      </div>

      {!autoScroll && (
        <button type="button"
          onClick={() => { setAutoScroll(true); bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }}
          className="mx-2 mb-2 py-1 text-[10px] text-muted-foreground hover:text-foreground bg-white/5 rounded text-center shrink-0">
          ↓ Jump to latest
        </button>
      )}
    </div>
  );
}
