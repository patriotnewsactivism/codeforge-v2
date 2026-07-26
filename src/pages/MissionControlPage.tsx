import { useQuery } from "convex/react";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../../convex/_generated/api";
import type { Id } from "../../convex/_generated/dataModel";

// Mission Control — wired to real Convex reactive queries. The Live/Shipped
// toggle switches between the in-progress view and an "everything done" view
// derived from the same underlying data.

const AUTONOMY_LABEL = "Full Autopilot";

const CYAN = "oklch(0.75 0.18 190)";
const EMERALD = "#34d399";
const AMBER = "#fbbf24";
const MUTED = "oklch(0.55 0.02 260)";
const INK = "oklch(0.13 0.02 260)";

const VALID_CONVEX_ID = /^[a-z0-9]+$/i;

type SubtaskStatus = "done" | "running" | "healed" | "queued";
interface Subtask {
  status: SubtaskStatus;
  text: string;
  agent: string;
  icon: string;
}

const SUBTASK_STYLE: Record<
  SubtaskStatus,
  { icon: string; color: string; rowBg: string }
> = {
  done: { icon: "✓", color: EMERALD, rowBg: "transparent" },
  running: { icon: "◐", color: CYAN, rowBg: "rgba(34,211,238,.06)" },
  healed: { icon: "✓", color: AMBER, rowBg: "rgba(251,191,36,.06)" },
  queued: { icon: "○", color: MUTED, rowBg: "transparent" },
};

type AgentStatus = "done" | "active" | "queued";
interface SwarmAgent {
  id: string;
  name: string;
  icon: string;
  status: AgentStatus;
  depth: number;
  summary: string;
}

const AGENT_STYLE: Record<
  AgentStatus,
  { dot: string; text: string; label: string; pulse: boolean }
> = {
  done: {
    dot: EMERALD,
    text: "oklch(0.80 0.01 260)",
    label: "done",
    pulse: false,
  },
  active: { dot: CYAN, text: CYAN, label: "active", pulse: true },
  queued: { dot: MUTED, text: MUTED, label: "waiting", pulse: false },
};

interface FeedEntry {
  id: string;
  time: string;
  type: string;
  color: string;
  icon: string;
  agent: string;
  content: string;
  reasoning?: string;
  isHeal?: boolean;
  resolved?: string;
  isRunning?: boolean;
}

// Map an agentThought `type` to feed styling.
const THOUGHT_STYLE: Record<string, { icon: string; color: string }> = {
  plan: { icon: "🗺️", color: "#a78bfa" },
  analyze: { icon: "🔍", color: "#818cf8" },
  code: { icon: "⚙️", color: "#4ade80" },
  debug: { icon: "🐛", color: "#f87171" },
  review: { icon: "🔎", color: "#fb923c" },
  memory: { icon: "🧠", color: "#c084fc" },
  search: { icon: "🔎", color: "#22d3ee" },
  commit: { icon: "📦", color: "#facc15" },
  broadcast: { icon: "📡", color: "#818cf8" },
  done: { icon: "✅", color: EMERALD },
  complete: { icon: "✅", color: EMERALD },
  action: { icon: "⚡", color: "#818cf8" },
  error: { icon: "⚠️", color: "#f87171" },
  warning: { icon: "⚠️", color: AMBER },
  thinking: { icon: "💭", color: "#a78bfa" },
  finding: { icon: "💡", color: "#facc15" },
};

const CATEGORY_ICON: Record<string, string> = {
  security: "🔒",
  feature: "⚙️",
  test: "🧪",
  docs: "📄",
  infra: "🏗️",
  performance: "⚡",
};

interface TouchedFile {
  path: string;
  action: "created" | "modified";
}

function fmtTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-GB", { hour12: false });
}

function fmtRelative(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function workItemToSubtaskStatus(status: string): SubtaskStatus {
  if (status === "done") return "done";
  if (status === "in_progress" || status === "review") return "running";
  return "queued";
}

const SECTION_LABEL =
  "text-[10px] font-bold uppercase tracking-[.06em] text-[oklch(0.60_0.02_260)]";

function ToggleGroup({
  options,
  onSelect,
}: {
  options: { label: string; active: boolean; value: string }[];
  onSelect: (value: string) => void;
}) {
  return (
    <div className="flex rounded-lg overflow-hidden border border-border">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          onClick={() => onSelect(o.value)}
          className="px-3 py-1.5 text-[11px] font-semibold border-0"
          style={{
            background: o.active ? CYAN : "transparent",
            color: o.active ? INK : "oklch(0.60 0.02 260)",
          }}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function StatusDot({
  live,
  color,
  size,
}: {
  live: boolean;
  color: string;
  size: number;
}) {
  return (
    <span
      className="relative inline-block"
      style={{ width: size, height: size }}
    >
      {live && (
        <span
          className="absolute inset-0 rounded-full opacity-75 animate-ping [animation-duration:1.4s]"
          style={{ background: color }}
        />
      )}
      <span
        className="absolute inset-0 rounded-full"
        style={{ background: color }}
      />
    </span>
  );
}

function ProgressRow({
  label,
  value,
  color,
  width,
}: {
  label: string;
  value: string;
  color?: string;
  width: string;
}) {
  return (
    <>
      <div className="flex items-center justify-between text-[11px]">
        <span className="text-[oklch(0.60_0.02_260)]">{label}</span>
        <span className="font-semibold" style={color ? { color } : undefined}>
          {value}
        </span>
      </div>
      <div className="h-[5px] bg-[oklch(0.20_0.02_260)] rounded-[3px] overflow-hidden">
        <div className="h-full" style={{ width, background: color ?? CYAN }} />
      </div>
    </>
  );
}

type MobilePane = "feed" | "plan" | "status";

export function MissionControlPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const typedProjectId =
    projectId && VALID_CONVEX_ID.test(projectId)
      ? (projectId as Id<"projects">)
      : null;
  const qArgs = typedProjectId ? { projectId: typedProjectId } : "skip";

  // ── Real Convex reactive queries ──────────────────────────────────────────
  const project = useQuery(api.projects.get, qArgs);
  const thoughts = useQuery(
    api.agentThoughts.listRecent,
    typedProjectId ? { projectId: typedProjectId, limit: 150 } : "skip",
  );
  const tasks = useQuery(api.tasks.listTasks, qArgs);
  const workItems = useQuery(api.planner.listWorkItems, qArgs);
  const memories = useQuery(
    api.memory.listMemories,
    typedProjectId ? { projectId: typedProjectId, limit: 8 } : "skip",
  );
  const retros = useQuery(api.memory.listRetrospectives, qArgs);
  const reviews = useQuery(api.codeReview.listReviews, qArgs);
  const toolCalls = useQuery(
    api.engine.listToolCalls,
    typedProjectId ? { projectId: typedProjectId, limit: 200 } : "skip",
  );
  const costSummary = useQuery(api.intelligence.getCostSummary, qArgs);
  const buildSessions = useQuery(api.intelligence.listBuildSessions, qArgs);

  const [mode, setMode] = useState<"simple" | "advanced">("advanced");
  const [view, setView] = useState<"live" | "shipped">("live");
  const [rightTab, setRightTab] = useState<"ship" | "deploy" | "errors">(
    "ship",
  );
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">(
    "desktop",
  );
  const [expandedFeed, setExpandedFeed] = useState<Record<number, boolean>>({});
  const [mobilePane, setMobilePane] = useState<MobilePane>("feed");

  const hasLiveActivity =
    (thoughts?.length ?? 0) > 0 || (toolCalls?.length ?? 0) > 0;


  const isAdvanced = mode === "advanced";
  const isShipped = view === "shipped";
  const isLive = !isShipped;

  // ── Derived data ──────────────────────────────────────────────────────────

  // Mission plan (subtasks) from planner work items, in creation order.
  const subtasks: Subtask[] = useMemo(
    () =>
      [...(workItems ?? [])].reverse().map(w => ({
        status: workItemToSubtaskStatus(w.status),
        text: w.title,
        agent: w.assignedAgentId ?? "Planner",
        icon: CATEGORY_ICON[w.category] ?? "⚙️",
      })),
    [workItems],
  );

  // Agent swarm derived from unique agents across agent tasks.
  const swarm: SwarmAgent[] = useMemo(() => {
    const byAgent = new Map<
      string,
      {
        name: string;
        icon: string;
        statuses: string[];
        total: number;
        done: number;
      }
    >();
    for (const t of tasks ?? []) {
      const key = t.agentId;
      if (!byAgent.has(key)) {
        byAgent.set(key, {
          name: t.agentName,
          icon: t.agentIcon,
          statuses: [],
          total: 0,
          done: 0,
        });
      }
      const a = byAgent.get(key);
      if (!a) continue;
      a.statuses.push(t.status);
      a.total += 1;
      if (t.status === "done") a.done += 1;
    }
    return Array.from(byAgent.entries()).map(([id, a]) => {
      const status: AgentStatus = a.statuses.includes("running")
        ? "active"
        : a.statuses.length > 0 && a.statuses.every(s => s === "done")
          ? "done"
          : "queued";
      const isOrchestrator =
        /orchestrator|planner/i.test(id) ||
        /orchestrator|planner/i.test(a.name);
      return {
        id,
        name: a.name,
        icon: a.icon,
        status,
        depth: isOrchestrator ? 0 : 1,
        summary: `${a.done}/${a.total} tasks done`,
      };
    });
  }, [tasks]);

  const activeAgentCount = swarm.filter(a => a.status === "active").length;

  // Live build feed from agent thoughts (chronological, oldest first).
  const feed: FeedEntry[] = useMemo(() => {
    const mapped = (thoughts ?? []).map(t => {
      const type = t.type ?? "thinking";
      const style = THOUGHT_STYLE[type] ?? { icon: "💭", color: "#a78bfa" };
      return {
        id: t._id,
        time: fmtTime(t.timestamp),
        type,
        color: style.color,
        icon: style.icon,
        agent: t.agentName ?? "Agent",
        content: t.content,
        isRunning: t.isStreaming ?? false,
        isHeal: type === "warning" || type === "error",
      };
    });
    return isShipped ? mapped.filter(f => !f.isRunning) : mapped;
  }, [thoughts, isShipped]);

  // Files touched, unioned across task filesChanged + create_file tool calls.
  const files: TouchedFile[] = useMemo(() => {
    const map = new Map<string, "created" | "modified">();
    for (const t of tasks ?? []) {
      for (const f of t.filesChanged ?? []) {
        if (!map.has(f)) map.set(f, "modified");
      }
    }
    for (const c of toolCalls ?? []) {
      if (c.tool !== "create_file" && c.tool !== "write_file") continue;
      try {
        const args = JSON.parse(c.args) as Record<string, unknown>;
        const p = args.path ?? args.filePath ?? args.file;
        if (typeof p === "string") map.set(p, "created");
      } catch {
        // ignore malformed tool-call args
      }
    }
    return Array.from(map.entries()).map(([path, action]) => ({
      path,
      action,
    }));
  }, [tasks, toolCalls]);

  // Missions rail from build sessions (most recent first).
  const missions = useMemo(
    () =>
      (buildSessions ?? []).map((s, i) => {
        const status: AgentStatus =
          s.status === "running"
            ? "active"
            : s.status === "completed"
              ? "done"
              : "queued";
        return {
          label:
            s.currentStep ??
            `Build session ${(buildSessions ?? []).length - i}`,
          status,
          time: fmtRelative(s.startedAt),
          current: i === 0 && s.status === "running",
        };
      }),
    [buildSessions],
  );

  // Checkpoints from completed tasks.
  const checkpoints = useMemo(
    () =>
      (tasks ?? [])
        .filter(t => t.status === "done" && t.finishedAt)
        .map(t => ({
          time: fmtTime(t.finishedAt ?? t.startedAt),
          label: t.task,
        })),
    [tasks],
  );

  // Production error incidents from errored tasks.
  const errorIncidents = useMemo(
    () =>
      (tasks ?? [])
        .filter(t => t.status === "error")
        .map(t => ({
          title: t.result ?? t.task,
          source: `${t.agentName} · agent`,
          time: t.finishedAt ? fmtRelative(t.finishedAt) : "",
        })),
    [tasks],
  );

  // Deploy history from completed build sessions.
  const deployHistory = useMemo(
    () =>
      (buildSessions ?? [])
        .filter(s => s.status === "completed")
        .map((s, i) => ({
          label: `Build completed ${fmtRelative(s.startedAt)}`,
          tag: i === 0 ? "latest" : "previous",
          tagColor: i === 0 ? EMERALD : MUTED,
        })),
    [buildSessions],
  );

  const memoryItems = useMemo(
    () => (memories ?? []).map(m => m.content),
    [memories],
  );

  const latestRetro = (retros ?? [])[0];
  const latestReview = (reviews ?? [])[0];

  const missionDuration = useMemo(() => {
    const s = (buildSessions ?? [])[0];
    if (!s?.finishedAt) return null;
    const secs = Math.round((s.finishedAt - s.startedAt) / 1000);
    const m = Math.floor(secs / 60);
    const r = secs % 60;
    return m > 0 ? `${m}m ${r}s` : `${r}s`;
  }, [buildSessions]);

  // ── Progress metrics ──────────────────────────────────────────────────────
  const totalTasks = (tasks ?? []).length;
  const doneTaskCount = (tasks ?? []).filter(t => t.status === "done").length;
  const taskPct =
    totalTasks > 0 ? Math.round((doneTaskCount / totalTasks) * 100) : 0;

  const totalWork = (workItems ?? []).length;
  const doneWork = (workItems ?? []).filter(w => w.status === "done").length;
  const planPct = totalWork > 0 ? Math.round((doneWork / totalWork) * 100) : 0;

  const baseScore = totalTasks > 0 ? taskPct : planPct;
  const score = isShipped ? 100 : baseScore;
  const canShip = score >= 90;

  const agentRuns = costSummary?.totalAgentRuns ?? 0;

  const reviewLabel = latestReview ? latestReview.consensus : "none yet";
  const reviewPct = latestReview
    ? latestReview.consensus === "approved"
      ? 100
      : latestReview.consensus === "pending"
        ? 40
        : 70
    : 0;
  const reviewColor = latestReview?.consensus === "approved" ? EMERALD : AMBER;

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - score / 100);

  const pillDotColor = isShipped ? EMERALD : "#f59e0b";
  const pillTextColor = isShipped ? EMERALD : AMBER;
  const topStatusLabel = !hasLiveActivity
    ? "No missions run yet"
    : isShipped
      ? "Shipped ✅"
      : `${AUTONOMY_LABEL} · Building`;

  const filesTouchedLabel = `${files.length} file${files.length === 1 ? "" : "s"}`;

  const integrations = [
    { name: "GitHub", icon: "🐙", connected: true },
    { name: "Convex", icon: "🟣", connected: true },
    { name: "Vercel", icon: "▲", connected: isShipped },
    { name: "Stripe", icon: "💳", connected: false },
  ];

  const heroPrompt = project?.description ?? "Describe your next mission…";

  // ── Reusable pane content — shared between the desktop 4-column layout
  // and the mobile single-pane + bottom-tab layout below, so the two
  // layouts never drift out of sync with each other.

  const missionsRailContent = (
    <>
      <div
        className={`${SECTION_LABEL} px-1.5 pb-2 tracking-[.06em] text-[oklch(0.55_0.02_260)]`}
      >
        Missions
      </div>
      <div className="flex flex-col gap-[3px]">
        {missions.length === 0 && (
          <div className="px-2 py-2 text-[10px] text-[oklch(0.48_0.02_260)]">
            No build sessions yet.
          </div>
        )}
        {missions.map(ms => {
          const st = AGENT_STYLE[ms.status];
          return (
            <div
              key={`${ms.label}-${ms.time}`}
              className="px-2 py-2 rounded-[7px] border border-transparent"
              style={{
                background: ms.current
                  ? "rgba(255,255,255,.06)"
                  : "transparent",
              }}
            >
              <div className="flex items-center gap-1.5">
                <span
                  className={`w-1.5 h-1.5 rounded-full shrink-0 inline-block${st.pulse ? " animate-pulse [animation-duration:1.2s]" : ""}`}
                  style={{ background: st.dot }}
                />
                <span
                  className="text-[11px] font-semibold leading-[1.3]"
                  style={{ color: st.text }}
                >
                  {ms.label}
                </span>
              </div>
              <div className="text-[9px] text-[oklch(0.48_0.02_260)] ml-3 mt-0.5">
                {ms.time}
              </div>
            </div>
          );
        })}
      </div>
    </>
  );

  const planColumnContent = (
    <>
      <div>
        <div className={`${SECTION_LABEL} mb-2`}>Mission Plan</div>
        <div className="flex flex-col gap-1.5">
          {subtasks.length === 0 && (
            <div className="px-2 py-2 text-[10px] text-[oklch(0.48_0.02_260)]">
              No plan generated yet.
            </div>
          )}
          {subtasks.map(t => {
            const st = isShipped
              ? { icon: "✓", color: EMERALD, rowBg: "transparent" }
              : SUBTASK_STYLE[t.status];
            return (
              <div
                key={t.text}
                className="flex items-start gap-2 px-2 py-[7px] rounded-[7px]"
                style={{ background: st.rowBg }}
              >
                <span
                  className="text-[13px] w-4 shrink-0 mt-px"
                  style={{ color: st.color }}
                >
                  {st.icon}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11.5px] leading-[1.4]">{t.text}</div>
                  <div className="text-[10px] text-[oklch(0.55_0.02_260)] mt-0.5">
                    {t.icon} {t.agent}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {isAdvanced && (
        <div>
          <div className={`${SECTION_LABEL} mb-2`}>Agent Swarm</div>
          <div className="flex flex-col gap-0.5">
            {swarm.length === 0 && (
              <div className="px-2 py-2 text-[10px] text-[oklch(0.48_0.02_260)]">
                No agents deployed yet.
              </div>
            )}
            {swarm.map(a => {
              const st = isShipped
                ? {
                    dot: EMERALD,
                    text: "oklch(0.80 0.01 260)",
                    label: "done",
                    pulse: false,
                  }
                : AGENT_STYLE[a.status];
              return (
                <div
                  key={a.id}
                  className="px-2 py-1.5"
                  style={{
                    marginLeft: a.depth * 16,
                    borderLeft:
                      a.depth > 0
                        ? "2px solid oklch(0.25 0.02 260)"
                        : "2px solid transparent",
                  }}
                >
                  <div className="flex items-center gap-[7px] text-[11.5px]">
                    <span
                      className={`w-[7px] h-[7px] rounded-full shrink-0 inline-block${st.pulse ? " animate-pulse [animation-duration:1.2s]" : ""}`}
                      style={{ background: st.dot }}
                    />
                    <span
                      className="flex-1 font-semibold"
                      style={{ color: st.text }}
                    >
                      {a.icon} {a.name}
                    </span>
                    <span
                      className="text-[9px] font-bold uppercase"
                      style={{ color: st.text }}
                    >
                      {st.label}
                    </span>
                  </div>
                  <div className="text-[9.5px] text-[oklch(0.50_0.02_260)] ml-3.5 mt-px">
                    {a.summary}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      <div>
        <div className={`${SECTION_LABEL} mb-2`}>Checkpoints</div>
        <div className="flex flex-col">
          {checkpoints.length === 0 && (
            <div className="text-[10px] text-[oklch(0.48_0.02_260)]">
              No completed tasks yet.
            </div>
          )}
          {checkpoints.map(cp => (
            <div key={`${cp.time}-${cp.label}`} className="flex gap-2">
              <div className="flex flex-col items-center shrink-0 w-[7px]">
                <span className="w-[7px] h-[7px] rounded-full bg-primary shrink-0" />
                <span className="w-px flex-1 bg-[oklch(0.22_0.02_260)] mt-[3px]" />
              </div>
              <div className="flex-1 min-w-0 pb-3">
                <div className="flex items-center justify-between gap-1.5">
                  <span className="text-[10.5px] text-[oklch(0.80_0.01_260)] leading-[1.3]">
                    {cp.label}
                  </span>
                  <button
                    type="button"
                    className="text-[9px] text-[oklch(0.55_0.02_260)] bg-[rgba(255,255,255,.05)] border-0 rounded-[5px] px-1.5 py-0.5 shrink-0 whitespace-nowrap"
                  >
                    Restore
                  </button>
                </div>
                <div className="text-[9px] text-[oklch(0.45_0.02_260)] font-mono mt-px">
                  {cp.time}
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );

  const feedColumnContent = (
    <>
      <div className="flex items-center gap-2 px-4 py-[9px] border-b border-border shrink-0">
        <span className="text-[#a78bfa]">🧠</span>
        <span className="text-[11px] font-bold uppercase tracking-[.05em] text-[oklch(0.60_0.02_260)]">
          Live Build Feed
        </span>
        <span className="ml-auto text-[10px] text-[oklch(0.55_0.02_260)] flex items-center gap-[5px]">
          <span className="w-1.5 h-1.5 rounded-full bg-primary inline-block animate-pulse [animation-duration:1.5s]" />
          autoscroll
        </span>
      </div>
      <div className="flex-1 overflow-y-auto px-3.5 py-2.5 flex flex-col gap-1.5 text-xs">
        {thoughts === undefined && (
          <div className="text-[11px] text-[oklch(0.55_0.02_260)] py-4 text-center">
            Loading activity…
          </div>
        )}
        {thoughts !== undefined && feed.length === 0 && (
          <div className="text-[11px] text-[oklch(0.55_0.02_260)] py-4 text-center">
            No agent activity yet.
          </div>
        )}
        {feed.map((f, i) => (
          <div
            key={f.id}
            className="flex gap-2.5 px-2.5 py-2 rounded-lg min-w-0 max-w-full shrink-0 cursor-pointer"
            style={{
              background: f.isHeal
                ? "rgba(251,191,36,.07)"
                : "rgba(255,255,255,.02)",
              border: f.isHeal
                ? "1px solid rgba(251,191,36,.2)"
                : "1px solid transparent",
            }}
            onClick={() => setExpandedFeed(s => ({ ...s, [i]: !s[i] }))}
          >
            <span className="font-mono text-[10px] text-[oklch(0.45_0.02_260)] mt-px shrink-0 whitespace-nowrap">
              {f.time}
            </span>
            <span className="mt-px shrink-0">{f.icon}</span>
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex items-baseline gap-[7px]">
                <span
                  className="text-[9.5px] font-extrabold tracking-[.04em] uppercase"
                  style={{ color: f.color }}
                >
                  [{f.type}]
                </span>
                <span className="text-[10.5px] text-[oklch(0.55_0.02_260)]">
                  {f.agent}
                </span>
                {f.reasoning && (
                  <span className="ml-auto text-[8.5px] text-[oklch(0.42_0.02_260)]">
                    why?
                  </span>
                )}
              </div>
              <div
                className="leading-normal mt-0.5 break-words"
                style={{ color: f.isHeal ? "#fca5a5" : "oklch(0.85 0.01 260)" }}
              >
                {f.content}
                {f.isRunning && (
                  <span
                    className="inline-block w-1.5 h-3 ml-0.5 align-middle animate-pulse [animation-duration:1s]"
                    style={{ background: "oklch(0.85 0.01 260)" }}
                  />
                )}
              </div>
              {f.isHeal && f.resolved && (
                <div className="text-[#34d399] leading-normal mt-[3px] font-semibold">
                  ↳ {f.resolved}
                </div>
              )}
              {expandedFeed[i] && f.reasoning && (
                <div className="mt-[5px] pt-[5px] border-t border-[rgba(255,255,255,.06)] text-[10.5px] italic text-[oklch(0.55_0.02_260)] leading-normal">
                  {f.reasoning}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </>
  );

  const rightPanelContent = (
    <>
      <div className="flex rounded-lg overflow-hidden border border-border shrink-0">
        {(["ship", "deploy", "errors"] as const).map(tab => (
          <button
            key={tab}
            type="button"
            onClick={() => setRightTab(tab)}
            className="flex-1 py-1.5 text-[10px] font-bold uppercase border-0"
            style={{
              background: rightTab === tab ? CYAN : "transparent",
              color: rightTab === tab ? INK : MUTED,
            }}
          >
            {tab}
          </button>
        ))}
      </div>

      {rightTab === "ship" && (
        <>
          <div className="flex flex-col items-center gap-2 shrink-0">
            <div className="relative w-32 h-32">
              <svg
                width="128"
                height="128"
                viewBox="0 0 128 128"
                role="img"
                aria-label={`Ship score ${score}%`}
              >
                <defs>
                  <linearGradient
                    id="shipRing"
                    x1="0%"
                    y1="0%"
                    x2="100%"
                    y2="100%"
                  >
                    <stop offset="0%" stopColor="#fb923c" />
                    <stop offset="100%" stopColor="#f472b6" />
                  </linearGradient>
                </defs>
                <circle
                  cx="64"
                  cy="64"
                  r={radius}
                  fill="none"
                  stroke="oklch(0.22 0.02 260)"
                  strokeWidth="10"
                />
                <circle
                  cx="64"
                  cy="64"
                  r={radius}
                  fill="none"
                  stroke="url(#shipRing)"
                  strokeWidth="10"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  transform="rotate(-90 64 64)"
                />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center gap-0.5">
                <span className="text-[26px] font-extrabold text-foreground leading-none">
                  {score}%
                </span>
                <span className="text-[10px] text-[oklch(0.60_0.02_260)] tracking-[.03em]">
                  SHIP SCORE
                </span>
              </div>
            </div>
            {!isAdvanced && (
              <p className="text-xs text-[oklch(0.75_0.02_260)] text-center leading-normal m-0">
                {isShipped
                  ? `Your app is built and shipped. ${files.length} files are live — the swarm is standing by for the next mission.`
                  : `Your app is ${score}% built. The swarm is working through ${totalTasks - doneTaskCount} remaining task${totalTasks - doneTaskCount === 1 ? "" : "s"}.`}
              </p>
            )}
          </div>

          {isAdvanced && (
            <div className="flex flex-col gap-[9px] shrink-0">
              <ProgressRow
                label="Plan"
                value={`${doneWork}/${totalWork}`}
                color={planPct === 100 && totalWork > 0 ? EMERALD : undefined}
                width={`${planPct}%`}
              />
              <ProgressRow
                label="Files"
                value={`${files.length}`}
                width={files.length > 0 ? "100%" : "0%"}
              />
              <ProgressRow
                label="Tasks"
                value={`${doneTaskCount}/${totalTasks}`}
                color={taskPct === 100 && totalTasks > 0 ? EMERALD : undefined}
                width={`${taskPct}%`}
              />
              <ProgressRow
                label="Review"
                value={reviewLabel}
                color={reviewColor}
                width={`${reviewPct}%`}
              />
              <ProgressRow
                label="Deploy"
                value={isShipped ? "live" : "pending"}
                color={isShipped ? EMERALD : MUTED}
                width={isShipped ? "100%" : "0%"}
              />
            </div>
          )}

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <span className={SECTION_LABEL}>Files touched</span>
              <span className="text-[10px] text-[oklch(0.50_0.02_260)]">
                {filesTouchedLabel}
              </span>
            </div>
            <div className="flex flex-col gap-1">
              {files.length === 0 && (
                <div className="text-[10px] text-[oklch(0.48_0.02_260)]">
                  No files touched yet.
                </div>
              )}
              {files.map(fl => (
                <div
                  key={fl.path}
                  className="flex items-center gap-1.5 text-[10.5px] font-mono text-[oklch(0.65_0.02_260)]"
                >
                  <span
                    className="shrink-0"
                    style={{
                      color: fl.action === "created" ? EMERALD : CYAN,
                    }}
                  >
                    {fl.action === "created" ? "+" : "±"}
                  </span>
                  <span className="truncate flex-1 min-w-0">{fl.path}</span>
                </div>
              ))}
            </div>
          </div>

          <div>
            <div className={`${SECTION_LABEL} mb-2`}>
              🧠 Memory reused ({memoryItems.length})
            </div>
            <div className="flex flex-wrap gap-[5px]">
              {memoryItems.length === 0 && (
                <span className="text-[10px] text-[oklch(0.48_0.02_260)]">
                  No memories saved yet.
                </span>
              )}
              {memoryItems.map(m => (
                <span
                  key={m}
                  className="text-[9.5px] px-2 py-1 rounded-xl bg-[rgba(192,132,252,.12)] text-[#c084fc] border border-[rgba(192,132,252,.2)]"
                >
                  {m}
                </span>
              ))}
            </div>
          </div>

          <div>
            <div className="flex items-center gap-1.5 mb-2">
              <span className={SECTION_LABEL}>Agent roster</span>
              <span className="text-[9.5px] px-[7px] py-0.5 rounded-[10px] bg-[rgba(52,211,153,.12)] text-[#34d399] font-bold">
                {swarm.length} agent{swarm.length === 1 ? "" : "s"}
              </span>
            </div>
            <div className="flex flex-col gap-[5px] mb-2">
              {swarm.length === 0 && (
                <div className="text-[10px] text-[oklch(0.48_0.02_260)]">
                  No agents deployed yet.
                </div>
              )}
              {swarm.map(a => {
                const st = AGENT_STYLE[a.status];
                return (
                  <div
                    key={a.id}
                    className="flex items-center gap-1.5 text-[10.5px]"
                  >
                    <span className="w-[92px] shrink-0 text-[oklch(0.55_0.02_260)] truncate">
                      {a.icon} {a.name}
                    </span>
                    <span className="flex-1 min-w-0 text-[oklch(0.88_0.01_260)] truncate">
                      {a.summary}
                    </span>
                    <span
                      className="text-[9px] font-bold px-1.5 py-0.5 rounded-lg whitespace-nowrap shrink-0 uppercase"
                      style={{ color: st.dot }}
                    >
                      {st.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          {isAdvanced && isLive && (
            <div>
              <div
                className={`${SECTION_LABEL} mb-2 flex items-center justify-between`}
              >
                <span>Usage</span>
                <span className="font-normal normal-case text-[oklch(0.55_0.02_260)]">
                  {agentRuns} agent run{agentRuns === 1 ? "" : "s"}
                </span>
              </div>
              <div className="h-[5px] bg-[oklch(0.20_0.02_260)] rounded-[3px] overflow-hidden mb-3">
                <div
                  className="h-full bg-[#fbbf24]"
                  style={{ width: `${score}%` }}
                />
              </div>
              <div className={`${SECTION_LABEL} mb-1.5`}>Autonomy level</div>
              <select className="w-full bg-[rgba(255,255,255,.05)] border border-border text-[oklch(0.90_0.01_260)] text-[11px] font-semibold px-2 py-1.5 rounded-md">
                <option>Full Autopilot</option>
              </select>
            </div>
          )}

          {isAdvanced && isShipped && (
            <div>
              <div className={`${SECTION_LABEL} mb-2`}>
                Mission retrospective
              </div>
              <div className="flex gap-3 text-[10.5px] text-[oklch(0.65_0.02_260)] mb-2.5">
                <span>⏱ {missionDuration ?? "—"}</span>
                <span>🤖 {agentRuns} runs</span>
                {latestRetro && <span>★ {latestRetro.qualityScore}/10</span>}
              </div>
              {latestRetro ? (
                <>
                  <div className="text-[9.5px] font-bold uppercase text-[#34d399] mb-[5px]">
                    What worked
                  </div>
                  {latestRetro.whatWorked.map(w => (
                    <div
                      key={w}
                      className="text-[10.5px] text-[oklch(0.75_0.02_260)] leading-normal mb-[3px]"
                    >
                      ✓ {w}
                    </div>
                  ))}
                  <div className="text-[9.5px] font-bold uppercase text-[#fbbf24] mt-2 mb-[5px]">
                    What failed (self-healed)
                  </div>
                  {latestRetro.whatFailed.map(w => (
                    <div
                      key={w}
                      className="text-[10.5px] text-[oklch(0.75_0.02_260)] leading-normal mb-[3px]"
                    >
                      ⚠ {w}
                    </div>
                  ))}
                  <div className="text-[9.5px] font-bold uppercase text-[#c084fc] mt-2 mb-[5px]">
                    🧠 New memories saved
                  </div>
                  <div className="text-[10.5px] text-[oklch(0.75_0.02_260)]">
                    {latestRetro.memoriesCreated.length} memor
                    {latestRetro.memoriesCreated.length === 1 ? "y" : "ies"}{" "}
                    saved
                  </div>
                </>
              ) : (
                <p className="text-[10.5px] text-[oklch(0.55_0.02_260)] m-0">
                  No retrospective recorded yet.
                </p>
              )}
            </div>
          )}
        </>
      )}

      {rightTab === "deploy" && (
        <>
          <div>
            <div className={`${SECTION_LABEL} mb-2`}>Domain</div>
            <div className="flex items-center gap-1.5 bg-[rgba(255,255,255,.04)] border border-border rounded-md px-[9px] py-[7px] mb-1.5">
              <span className="text-[oklch(0.45_0.02_260)]">●</span>
              <span className="text-[10.5px] font-mono text-[oklch(0.65_0.02_260)] flex-1 min-w-0 truncate">
                Not configured
              </span>
            </div>
            <button
              type="button"
              className="w-full py-1.5 text-[10.5px] text-[oklch(0.65_0.02_260)] bg-[rgba(255,255,255,.04)] border border-dashed border-[oklch(0.30_0.02_260)] rounded-md"
            >
              + Add custom domain
            </button>
          </div>

          <div>
            <div className={`${SECTION_LABEL} mb-2`}>Environment secrets</div>
            <div className="flex flex-col gap-[5px] mb-2">
              <div className="text-[10px] text-[oklch(0.48_0.02_260)]">
                No environment secrets configured.
              </div>
            </div>
            <button
              type="button"
              className="w-full py-1.5 text-[10.5px] text-[oklch(0.65_0.02_260)] bg-[rgba(255,255,255,.04)] border border-dashed border-[oklch(0.30_0.02_260)] rounded-md"
            >
              + Add secret
            </button>
          </div>

          <div>
            <div className={`${SECTION_LABEL} mb-2`}>Deploy history</div>
            <div className="flex flex-col gap-1.5">
              {deployHistory.length === 0 && (
                <div className="text-[10px] text-[oklch(0.48_0.02_260)]">
                  No completed builds yet.
                </div>
              )}
              {deployHistory.map(dh => (
                <div
                  key={dh.label}
                  className="flex items-center gap-[7px] text-[10.5px]"
                >
                  <span className="flex-1 min-w-0 text-[oklch(0.75_0.02_260)]">
                    {dh.label}
                  </span>
                  <span
                    className="text-[9px] font-bold px-1.5 py-0.5 rounded-lg bg-[rgba(255,255,255,.06)] whitespace-nowrap"
                    style={{ color: dh.tagColor }}
                  >
                    {dh.tag}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {rightTab === "errors" && (
        <div>
          <div className="flex items-center gap-1.5 mb-2">
            <span className={SECTION_LABEL}>Production error monitor</span>
            <span className="text-[9px] font-bold px-[7px] py-0.5 rounded-[10px] bg-[rgba(52,211,153,.12)] text-[#34d399]">
              auto-fix ON
            </span>
          </div>
          {errorIncidents.length > 0 ? (
            <div className="flex flex-col gap-2">
              {errorIncidents.map(err => (
                <div
                  key={`${err.title}-${err.time}`}
                  className="p-2 rounded-[7px] bg-[rgba(251,191,36,.05)] border border-[rgba(251,191,36,.15)]"
                >
                  <div className="text-[10.5px] text-[oklch(0.85_0.01_260)] leading-[1.4]">
                    {err.title}
                  </div>
                  <div className="flex items-center justify-between mt-1">
                    <span className="text-[9px] text-[oklch(0.50_0.02_260)]">
                      {err.source}
                      {err.time ? ` · ${err.time}` : ""}
                    </span>
                    <span className="text-[9px] font-bold text-[#fbbf24]">
                      ⚠ error
                    </span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-[11px] text-[oklch(0.55_0.02_260)] leading-normal m-0">
              No agent errors reported. Monitoring continues.
            </p>
          )}
        </div>
      )}
    </>
  );

  const MOBILE_TABS: { id: MobilePane; label: string; icon: string }[] = [
    { id: "feed", label: "Feed", icon: "🧠" },
    { id: "plan", label: "Plan", icon: "🗺️" },
    { id: "status", label: "Status", icon: "🚀" },
  ];

  if (!typedProjectId) {
    return (
      <div className="h-screen flex items-center justify-center bg-background text-foreground">
        <div className="text-center">
          <div className="text-sm font-bold mb-1">Invalid project</div>
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="text-primary text-xs bg-transparent border-0 cursor-pointer"
          >
            Back to dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-2 sm:gap-3 px-3 sm:px-4 py-2.5 bg-[oklch(0.09_0.02_260)] border-b border-border shrink-0 flex-wrap">
        <button
          type="button"
          onClick={() => navigate(`/project/${projectId}`)}
          className="text-primary font-extrabold text-[15px] bg-transparent border-0 cursor-pointer"
          title="Back to IDE"
        >
          {"</>"}
        </button>
        <span className="text-[13px] text-[oklch(0.60_0.02_260)] hidden sm:inline">
          {project?.name ?? "Project"}
        </span>
        <span className="text-[oklch(0.30_0.02_260)] hidden sm:inline">/</span>
        <span className="text-sm font-bold">Mission Control</span>
        <div className="flex-1" />
        <div
          className="flex items-center gap-1.5 px-2.5 py-1 rounded-[20px]"
          style={{
            background: isShipped
              ? "rgba(52,211,153,.12)"
              : "rgba(245,158,11,.12)",
            border: isShipped
              ? "1px solid rgba(52,211,153,.3)"
              : "1px solid rgba(245,158,11,.25)",
          }}
        >
          <StatusDot live={isLive} color={pillDotColor} size={8} />
          <span
            className="text-[11px] font-bold uppercase tracking-[.04em]"
            style={{ color: pillTextColor }}
          >
            {topStatusLabel}
          </span>
        </div>
        <ToggleGroup
          options={[
            { label: "Live", value: "live", active: isLive },
            { label: "Shipped", value: "shipped", active: isShipped },
          ]}
          onSelect={v => setView(v as "live" | "shipped")}
        />
        <ToggleGroup
          options={[
            { label: "Simple", value: "simple", active: !isAdvanced },
            { label: "Advanced", value: "advanced", active: isAdvanced },
          ]}
          onSelect={v => setMode(v as "simple" | "advanced")}
        />
      </div>

      {/* Hero composer */}
      <div className="relative overflow-hidden px-3 sm:px-5 pt-2.5 pb-2 bg-[oklch(0.11_0.02_260)] border-b border-border shrink-0 max-h-[34vh]">
        <div
          className="absolute -top-[140px] left-1/2 -translate-x-1/2 w-[600px] h-[220px] pointer-events-none blur-[40px]"
          style={{
            background:
              "radial-gradient(closest-side, rgba(251,146,60,.28), rgba(244,114,182,.18) 55%, transparent 75%)",
          }}
        />
        <div className="relative max-w-[900px] mx-auto">
          <div className="flex items-center gap-2 sm:gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0 bg-[oklch(0.15_0.02_260)] border border-[oklch(0.27_0.02_260)] rounded-xl px-3 py-[7px] shadow-[0_8px_20px_rgba(0,0,0,.3)]">
              <span className="text-sm text-[oklch(0.55_0.02_260)] shrink-0">
                ＋
              </span>
              <span className="flex-1 min-w-0 text-xs italic text-[oklch(0.90_0.01_260)] truncate">
                "{heroPrompt}"
              </span>
              <span className="hidden sm:flex items-center gap-[5px] px-2 py-[3px] rounded-2xl bg-[rgba(251,146,60,.15)] border border-[rgba(251,146,60,.3)] text-[9.5px] font-bold text-[#fb923c] whitespace-nowrap shrink-0">
                🐝 {activeAgentCount} agent{activeAgentCount === 1 ? "" : "s"}
              </span>
              <button
                type="button"
                className="w-7 h-7 rounded-full border-0 shrink-0 flex items-center justify-center text-[13px] font-extrabold"
                style={{
                  background: "linear-gradient(135deg,#fb923c,#f472b6)",
                  color: INK,
                }}
              >
                ↑
              </button>
            </div>
            <div className="hidden sm:flex items-center gap-1.5 shrink-0">
              <div className="flex rounded-md overflow-hidden border border-[oklch(0.27_0.02_260)]">
                <button
                  type="button"
                  onClick={() => setPreviewMode("desktop")}
                  className="px-1.5 py-1 text-[9px] border-0 text-[oklch(0.75_0.02_260)]"
                  style={{
                    background:
                      previewMode === "desktop"
                        ? "rgba(255,255,255,.1)"
                        : "transparent",
                  }}
                >
                  🖥
                </button>
                <button
                  type="button"
                  onClick={() => setPreviewMode("mobile")}
                  className="px-1.5 py-1 text-[9px] border-0 text-[oklch(0.75_0.02_260)]"
                  style={{
                    background:
                      previewMode === "mobile"
                        ? "rgba(255,255,255,.1)"
                        : "transparent",
                  }}
                >
                  📱
                </button>
              </div>
            </div>
          </div>
          <div className="hidden sm:flex items-center justify-center gap-1.5 mt-[7px] flex-wrap">
            {["🌐 Web", "📱 Mobile", "🔌 API"].map(chip => (
              <span
                key={chip}
                className="flex items-center gap-1 px-[9px] py-[3px] rounded-2xl bg-[rgba(255,255,255,.06)] border border-[oklch(0.27_0.02_260)] text-[9.5px] text-[oklch(0.85_0.01_260)] whitespace-nowrap shrink-0"
              >
                {chip}
              </span>
            ))}
            <span className="flex items-center gap-1 px-[9px] py-[3px] rounded-2xl bg-[rgba(34,211,238,.14)] border border-[rgba(34,211,238,.3)] text-[9.5px] text-[#22d3ee] font-semibold whitespace-nowrap shrink-0">
              🐝 Full-Stack Swarm ✓
            </span>
            <span className="flex items-center gap-1 px-[9px] py-[3px] rounded-2xl bg-[rgba(255,255,255,.06)] border border-[oklch(0.27_0.02_260)] text-[9.5px] text-[oklch(0.85_0.01_260)] whitespace-nowrap shrink-0">
              🐛 Autofix
            </span>
            <span className="w-px h-3 bg-border mx-0.5" />
            {integrations.map(ig => (
              <span
                key={ig.name}
                className="flex items-center gap-[3px] px-2 py-[3px] rounded-2xl text-[9px] whitespace-nowrap shrink-0"
                style={{
                  background: ig.connected
                    ? "rgba(52,211,153,.1)"
                    : "transparent",
                  border: ig.connected
                    ? "1px solid rgba(52,211,153,.25)"
                    : "1px dashed oklch(0.30 0.02 260)",
                  color: ig.connected ? EMERALD : MUTED,
                }}
              >
                {ig.icon} {ig.name}
              </span>
            ))}
          </div>
          <p className="hidden sm:block text-center mt-[5px] mb-0 text-[9.5px] text-[oklch(0.48_0.02_260)]">
            {isShipped
              ? missionDuration
                ? `Shipped in ${missionDuration} · ${AUTONOMY_LABEL}`
                : `Shipped · ${AUTONOMY_LABEL}`
              : `${agentRuns} agent run${agentRuns === 1 ? "" : "s"} · ${AUTONOMY_LABEL} ON`}
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Desktop: 4-column layout (mission rail / plan / feed / ship status) */}
        <div className="hidden xl:flex flex-1 overflow-hidden min-h-0">
          <div className="w-[172px] shrink-0 bg-[oklch(0.09_0.02_260)] border-r border-border overflow-y-auto px-2 py-3">
            {missionsRailContent}
          </div>

          <div className="w-[280px] shrink-0 bg-[oklch(0.11_0.02_260)] border-r border-border overflow-y-auto px-3 py-3.5 flex flex-col gap-[18px]">
            {planColumnContent}
          </div>

          <div className="flex-1 flex flex-col min-w-0 bg-[oklch(0.115_0.02_260)]">
            {feedColumnContent}
          </div>

          <div className="w-[300px] shrink-0 bg-[oklch(0.11_0.02_260)] border-l border-border overflow-y-auto px-3.5 py-4 flex flex-col gap-[18px]">
            {rightPanelContent}
          </div>
        </div>

        {/* Mobile: single active pane + bottom tab bar */}
        <div className="flex xl:hidden flex-1 flex-col overflow-hidden min-h-0">
          <div className="flex-1 overflow-y-auto">
            {mobilePane === "feed" && (
              <div className="h-full flex flex-col bg-[oklch(0.115_0.02_260)]">
                {feedColumnContent}
              </div>
            )}
            {mobilePane === "plan" && (
              <div className="px-3 py-3.5 flex flex-col gap-[18px]">
                {missionsRailContent}
                {planColumnContent}
              </div>
            )}
            {mobilePane === "status" && (
              <div className="px-3.5 py-4 flex flex-col gap-[18px]">
                {rightPanelContent}
              </div>
            )}
          </div>
          <div className="shrink-0 flex border-t border-border bg-[oklch(0.09_0.02_260)]">
            {MOBILE_TABS.map(t => (
              <button
                key={t.id}
                type="button"
                onClick={() => setMobilePane(t.id)}
                className="flex-1 flex flex-col items-center gap-0.5 py-2"
                style={{ color: mobilePane === t.id ? CYAN : MUTED }}
              >
                <span className="text-base leading-none">{t.icon}</span>
                <span className="text-[10px] font-semibold">{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center gap-3 sm:gap-5 px-3 sm:px-4 py-[9px] border-t border-border bg-[oklch(0.09_0.02_260)] shrink-0 flex-wrap">
        <div className="flex items-center gap-1.5">
          <StatusDot live={isLive} color={pillDotColor} size={10} />
          <span
            className="text-[11px] font-bold uppercase"
            style={{ color: pillTextColor }}
          >
            {topStatusLabel}
          </span>
        </div>
        <div className="hidden sm:flex items-center gap-5 text-[11px] text-[oklch(0.65_0.02_260)] flex-1">
          <span>
            Ship score <strong className="text-foreground">{score}%</strong>
          </span>
          <span>
            Files{" "}
            <strong className="text-foreground">
              {filesTouchedLabel} modified
            </strong>
          </span>
          <span>
            Tasks{" "}
            <strong className="text-[#34d399]">
              {doneTaskCount}/{totalTasks}
            </strong>
          </span>
        </div>
        <div className="flex items-center gap-2 ml-auto sm:ml-0">
          {isLive && (
            <button
              type="button"
              className="px-3 py-1.5 rounded-md bg-[rgba(239,68,68,.18)] text-[#f87171] border-0 text-[11px] font-semibold"
            >
              ⏸ Pause
            </button>
          )}
          <button
            type="button"
            className="px-3 py-1.5 rounded-md bg-transparent text-[oklch(0.60_0.02_260)] border-0 text-[11px]"
          >
            ↺ Rollback
          </button>
          <button
            type="button"
            className="px-3.5 py-1.5 rounded-md border-0 text-[11px] font-bold"
            style={{
              background: isShipped
                ? EMERALD
                : canShip
                  ? "linear-gradient(135deg,#fb923c,#f472b6)"
                  : "rgba(255,255,255,.06)",
              color: isShipped || canShip ? INK : "oklch(0.45 0.02 260)",
            }}
          >
            {isShipped ? "✅ Shipped" : "🚀 Ship Now"}
          </button>
        </div>
      </div>
    </div>
  );
}
