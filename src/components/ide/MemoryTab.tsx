import { useMutation, useQuery } from "convex/react";
import {
  AlertTriangle,
  BookOpen,
  Brain,
  Bug,
  CheckCircle,
  ChevronDown,
  ChevronUp,
  Heart,
  Layers,
  Lightbulb,
  Package,
  RefreshCw,
  Sparkles,
  Star,
  Trash2,
  Wrench,
  XCircle,
} from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const CATEGORY_META: Record<
  string,
  { label: string; icon: React.ElementType; color: string }
> = {
  pattern: { label: "Patterns", icon: Sparkles, color: "text-blue-400" },
  anti_pattern: {
    label: "Anti-Patterns",
    icon: AlertTriangle,
    color: "text-red-400",
  },
  preference: { label: "Preferences", icon: Heart, color: "text-pink-400" },
  architecture: {
    label: "Architecture",
    icon: Layers,
    color: "text-purple-400",
  },
  dependency: {
    label: "Dependencies",
    icon: Package,
    color: "text-orange-400",
  },
  bugfix: { label: "Bug Fixes", icon: Bug, color: "text-yellow-400" },
  convention: { label: "Conventions", icon: BookOpen, color: "text-green-400" },
  tool: { label: "Tools", icon: Wrench, color: "text-cyan-400" },
  insight: { label: "Insights", icon: Lightbulb, color: "text-amber-400" },
  skill: { label: "Skills", icon: Star, color: "text-yellow-300" },
};

interface MemoryTabProps {
  projectId: Id<"projects">;
}

export function MemoryTab({ projectId }: MemoryTabProps) {
  const [activeSection, setActiveSection] = useState<
    "lessons" | "skills" | "forensics" | "comms"
  >("lessons");
  const [expandedRetro, setExpandedRetro] = useState<string | null>(null);

  const stats = useQuery(api.memory.getMemoryStats, { projectId });
  const memories = useQuery(api.memory.listMemories, { projectId, limit: 60 });
  const retros = useQuery(api.memory.listRetrospectives, { projectId });
  const messages = useQuery(api.memory.listAgentMessages, { projectId });
  const deleteMemory = useMutation(api.memory.deleteMemory);
  const approveMemory = useMutation(api.memory.approveMemory);

  // Group memories by category
  const groupedLessons: Record<string, typeof memories> = {};
  const skillsList: typeof memories = [];

  for (const mem of memories ?? []) {
    if (mem.category === "skill") {
      skillsList.push(mem);
    } else {
      if (!groupedLessons[mem.category]) groupedLessons[mem.category] = [];
      groupedLessons[mem.category]!.push(mem);
    }
  }

  const MESSAGE_COLORS: Record<string, string> = {
    warning: "border-yellow-500/40 bg-yellow-500/5 text-yellow-300",
    context: "border-blue-500/40 bg-blue-500/5 text-blue-300",
    request: "border-purple-500/40 bg-purple-500/5 text-purple-300",
    finding: "border-green-500/40 bg-green-500/5 text-green-300",
    blocker: "border-red-500/40 bg-red-500/5 text-red-300",
    resolved: "border-emerald-500/40 bg-emerald-500/5 text-emerald-300",
  };

  return (
    <div className="h-full flex flex-col bg-[oklch(0.11_0.02_260)]">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border">
        <Brain className="h-4 w-4 text-violet-400" />
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
          Agent Memory
        </span>
        {stats && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            {stats.totalMemories} memories · avg score {stats.avgQualityScore}
            /10
          </span>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-border">
        {(["lessons", "skills", "forensics", "comms"] as const).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveSection(tab)}
            className={cn(
              "flex-1 py-1.5 text-[10px] font-semibold uppercase tracking-wider transition-colors",
              activeSection === tab
                ? "text-violet-400 border-b-2 border-violet-400"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {tab === "lessons"
              ? `Lessons`
              : tab === "skills"
                ? `Skills (${skillsList?.length ?? 0})`
                : tab === "forensics"
                  ? `Forensics (${stats?.totalRetrospectives ?? 0})`
                  : `Comms (${messages?.length ?? 0})`}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {/* ── LESSONS ── */}
        {activeSection === "lessons" && (
          <div className="p-2 space-y-3">
            {Object.keys(groupedLessons).length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <Brain className="h-8 w-8 text-violet-400/30 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No lessons learned yet
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Run agents to start building the memory bank
                </p>
              </div>
            )}
            {Object.entries(groupedLessons).map(([category, mems]) => {
              const meta = CATEGORY_META[category] ?? CATEGORY_META.insight!;
              const Icon = meta.icon;
              return (
                <div key={category}>
                  <div
                    className={cn(
                      "flex items-center gap-1.5 mb-1.5 text-[10px] font-bold uppercase tracking-wider",
                      meta.color,
                    )}
                  >
                    <Icon className="h-3 w-3" />
                    {meta.label} ({mems?.length ?? 0})
                  </div>
                  <div className="space-y-1">
                    {mems?.map((mem: NonNullable<typeof mems>[number]) => {
                      const strength = mem.importance * mem.decayFactor;
                      const barWidth = `${Math.round(strength * 100)}%`;
                      return (
                        <div
                          key={mem._id}
                          className="relative rounded-md bg-[oklch(0.14_0.02_260)] border border-border p-2 group"
                        >
                          <div className="flex items-start gap-2">
                            <div className="flex-1 min-w-0">
                              <p className="text-[11px] text-foreground leading-relaxed">
                                {mem.content}
                              </p>
                              <div className="flex items-center gap-2 mt-1.5">
                                {/* Importance bar */}
                                <div className="flex-1 h-1 bg-[oklch(0.20_0.02_260)] rounded-full overflow-hidden">
                                  <div
                                    className="h-full bg-violet-500 rounded-full transition-all"
                                    style={{ width: barWidth }}
                                  />
                                </div>
                                <span className="text-[9px] text-muted-foreground shrink-0">
                                  {Math.round(strength * 100)}% · used{" "}
                                  {mem.usageCount}×
                                </span>
                              </div>
                            </div>
                            <button
                              type="button"
                              onClick={() =>
                                deleteMemory({ memoryId: mem._id })
                              }
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-all shrink-0"
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── SKILLS ── */}
        {activeSection === "skills" && (
          <div className="p-2 space-y-2">
            {skillsList?.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <Star className="h-8 w-8 text-yellow-400/30 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No approved skills yet
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Agents will suggest new skills. You can approve them here.
                </p>
              </div>
            )}
            {skillsList?.map((mem: NonNullable<typeof skillsList>[number]) => {
              const isApproved = mem.isApproved;

              return (
                <div
                  key={mem._id}
                  className="relative rounded-md bg-[oklch(0.14_0.02_260)] border border-border p-3"
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="text-[11px] text-foreground leading-relaxed font-mono bg-black/20 p-2 rounded">
                        {mem.content}
                      </p>
                      <div className="flex items-center gap-3 mt-3">
                        <span
                          className={cn(
                            "text-[10px] font-semibold uppercase px-1.5 py-0.5 rounded",
                            isApproved
                              ? "bg-green-500/20 text-green-400"
                              : isApproved === false
                                ? "bg-red-500/20 text-red-400"
                                : "bg-yellow-500/20 text-yellow-400",
                          )}
                        >
                          {isApproved
                            ? "Approved"
                            : isApproved === false
                              ? "Rejected"
                              : "Pending Approval"}
                        </span>

                        <div className="ml-auto flex items-center gap-1">
                          <button
                            type="button"
                            onClick={() =>
                              approveMemory({
                                memoryId: mem._id,
                                isApproved: true,
                              })
                            }
                            className="p-1 rounded bg-green-500/10 hover:bg-green-500/30 text-green-400 transition-colors"
                            title="Approve Skill"
                          >
                            <CheckCircle className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() =>
                              approveMemory({
                                memoryId: mem._id,
                                isApproved: false,
                              })
                            }
                            className="p-1 rounded bg-red-500/10 hover:bg-red-500/30 text-red-400 transition-colors"
                            title="Reject Skill"
                          >
                            <XCircle className="h-3.5 w-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => deleteMemory({ memoryId: mem._id })}
                            className="p-1 rounded bg-muted/20 hover:bg-destructive/20 text-muted-foreground hover:text-destructive transition-colors ml-2"
                            title="Delete"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* ── FORENSICS (RETROS) ── */}
        {activeSection === "forensics" && (
          <div className="p-2 space-y-2">
            {retros?.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <RefreshCw className="h-8 w-8 text-violet-400/30 mb-3" />
                <p className="text-sm text-muted-foreground">
                  No retrospectives yet
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  After each agent run, a retrospective is automatically
                  generated
                </p>
              </div>
            )}
            {retros?.map((retro: NonNullable<typeof retros>[number]) => {
              const isExpanded = expandedRetro === retro._id;
              const scoreColor =
                retro.qualityScore >= 8
                  ? "text-green-400"
                  : retro.qualityScore >= 6
                    ? "text-yellow-400"
                    : "text-red-400";
              return (
                <div
                  key={retro._id}
                  className="rounded-lg border border-border bg-[oklch(0.14_0.02_260)] overflow-hidden"
                >
                  <button
                    type="button"
                    onClick={() =>
                      setExpandedRetro(isExpanded ? null : retro._id)
                    }
                    className="w-full flex items-center gap-2 px-3 py-2 hover:bg-[oklch(0.17_0.02_260)] transition-colors"
                  >
                    <span
                      className={cn(
                        "text-sm font-bold tabular-nums",
                        scoreColor,
                      )}
                    >
                      {retro.qualityScore}/10
                    </span>
                    <span className="text-xs text-muted-foreground flex-1 text-left">
                      {retro.agentsInvolved.length} agents ·{" "}
                      {retro.memoriesCreated.length} memories extracted
                    </span>
                    <span className="text-[10px] text-muted-foreground/60">
                      {new Date(retro.timestamp).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                    {isExpanded ? (
                      <ChevronUp className="h-3 w-3 text-muted-foreground" />
                    ) : (
                      <ChevronDown className="h-3 w-3 text-muted-foreground" />
                    )}
                  </button>

                  {isExpanded && (
                    <div className="px-3 pb-3 space-y-2 border-t border-border pt-2">
                      {retro.whatWorked.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-green-400 uppercase tracking-wider mb-1">
                            ✓ What Worked
                          </p>
                          <ul className="space-y-0.5">
                            {retro.whatWorked.map((item: string, i: number) => (
                              <li
                                key={i}
                                className="text-[11px] text-muted-foreground"
                              >
                                • {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {retro.whatFailed.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-red-400 uppercase tracking-wider mb-1">
                            ✗ What Failed
                          </p>
                          <ul className="space-y-0.5">
                            {retro.whatFailed.map((item: string, i: number) => (
                              <li
                                key={i}
                                className="text-[11px] text-muted-foreground"
                              >
                                • {item}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {retro.improvements.length > 0 && (
                        <div>
                          <p className="text-[10px] font-semibold text-blue-400 uppercase tracking-wider mb-1">
                            → Improvements
                          </p>
                          <ul className="space-y-0.5">
                            {retro.improvements.map(
                              (item: string, i: number) => (
                                <li
                                  key={i}
                                  className="text-[11px] text-muted-foreground"
                                >
                                  • {item}
                                </li>
                              ),
                            )}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── AGENT COMMS ── */}
        {activeSection === "comms" && (
          <div className="p-2 space-y-1.5">
            {messages?.length === 0 && (
              <div className="flex flex-col items-center justify-center py-12 text-center px-4">
                <span className="text-3xl mb-3">📡</span>
                <p className="text-sm text-muted-foreground">
                  No agent messages yet
                </p>
                <p className="text-xs text-muted-foreground/60 mt-1">
                  Agents broadcast findings, warnings, and context to each other
                  during runs
                </p>
              </div>
            )}
            {messages?.map((msg: NonNullable<typeof messages>[number]) => (
              <div
                key={msg._id}
                className={cn(
                  "rounded-md border px-2.5 py-2",
                  MESSAGE_COLORS[msg.messageType] ?? MESSAGE_COLORS.context,
                )}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <span className="text-sm">{msg.fromAgentIcon}</span>
                  <span className="text-[10px] font-semibold">
                    {msg.fromAgentName}
                  </span>
                  {msg.toAgentName ? (
                    <>
                      <span className="text-[9px] text-muted-foreground">
                        →
                      </span>
                      <span className="text-[10px] font-semibold">
                        {msg.toAgentName}
                      </span>
                    </>
                  ) : (
                    <span className="text-[9px] text-muted-foreground">
                      → broadcast
                    </span>
                  )}
                  <span className="ml-auto text-[9px] opacity-60 uppercase tracking-wider">
                    {msg.messageType}
                  </span>
                </div>
                <p className="text-[11px] leading-relaxed">{msg.content}</p>
                {msg.relatedFiles && msg.relatedFiles.length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {msg.relatedFiles.map((f: string) => (
                      <span
                        key={f}
                        className="text-[9px] bg-white/10 px-1 py-0.5 rounded font-mono"
                      >
                        {f}
                      </span>
                    ))}
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
