import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

// Frontend-only demo of the Mission Control redesign. All mission data is
// mocked; the Live/Shipped toggle switches between the two demo states.

const LIVE_SCORE = 89;
const AUTONOMY_LABEL = "Full Autopilot";

const CYAN = "oklch(0.75 0.18 190)";
const EMERALD = "#34d399";
const AMBER = "#fbbf24";
const MUTED = "oklch(0.55 0.02 260)";
const INK = "oklch(0.13 0.02 260)";

type SubtaskStatus = "done" | "running" | "healed" | "queued";
interface Subtask {
  status: SubtaskStatus;
  text: string;
  agent: string;
  icon: string;
}

const SUBTASKS: Subtask[] = [
  {
    status: "done",
    text: "Scaffold project structure & dependencies",
    agent: "Planner",
    icon: "🗺️",
  },
  {
    status: "done",
    text: "Build auth (sign up / in / out)",
    agent: "Logic Agent",
    icon: "⚙️",
  },
  {
    status: "done",
    text: "Design recipe list + detail UI",
    agent: "UI Agent",
    icon: "🎨",
  },
  {
    status: "running",
    text: "Implement recipe search & filters",
    agent: "Logic Agent",
    icon: "⚙️",
  },
  {
    status: "healed",
    text: "Fix failing checkout test (auto-retried 2×)",
    agent: "Test Agent",
    icon: "🧪",
  },
  {
    status: "queued",
    text: "Final review & deploy to production",
    agent: "Reviewer",
    icon: "🔎",
  },
];

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
  name: string;
  status: AgentStatus;
  depth: number;
  model: string;
  freeTag: string;
}

const SWARM: SwarmAgent[] = [
  {
    name: "Planner",
    status: "done",
    depth: 0,
    model: "DeepSeek V3",
    freeTag: "$0.27/1M · no rate wall",
  },
  {
    name: "UI Agent",
    status: "done",
    depth: 1,
    model: "GLM 4.7 (Cerebras)",
    freeTag: "Free · ~1M tok/day",
  },
  {
    name: "Logic Agent",
    status: "active",
    depth: 1,
    model: "GLM 4.7 (Cerebras)",
    freeTag: "Free · ~1M tok/day",
  },
  {
    name: "Test Agent",
    status: "active",
    depth: 1,
    model: "GPT-OSS 120B (Cerebras)",
    freeTag: "Free · ~1M tok/day",
  },
  {
    name: "Reviewer",
    status: "queued",
    depth: 1,
    model: "GPT-OSS 120B (Cerebras)",
    freeTag: "Free · ~1M tok/day",
  },
];

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

const ROSTER = [
  {
    role: "Orchestrator",
    model: "DeepSeek V3",
    provider: "DeepSeek",
    badge: "💲 Cheap",
    badgeColor: "#60a5fa",
    badgeBg: "rgba(96,165,250,.1)",
  },
  {
    role: "Coder",
    model: "GLM 4.7",
    provider: "Cerebras",
    badge: "🟢 Free",
    badgeColor: EMERALD,
    badgeBg: "rgba(52,211,153,.1)",
  },
  {
    role: "Reviewer",
    model: "GPT-OSS 120B",
    provider: "Cerebras",
    badge: "🟢 Free",
    badgeColor: EMERALD,
    badgeBg: "rgba(52,211,153,.1)",
  },
  {
    role: "Debugger",
    model: "DeepSeek R1",
    provider: "DeepSeek",
    badge: "💲 Cheap",
    badgeColor: "#60a5fa",
    badgeBg: "rgba(96,165,250,.1)",
  },
  {
    role: "Tester",
    model: "GPT-OSS 120B",
    provider: "Cerebras",
    badge: "🟢 Free",
    badgeColor: EMERALD,
    badgeBg: "rgba(52,211,153,.1)",
  },
  {
    role: "Utility",
    model: "Codestral",
    provider: "Mistral",
    badge: "🟢 Free",
    badgeColor: EMERALD,
    badgeBg: "rgba(52,211,153,.1)",
  },
];

interface FeedEntry {
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

const LIVE_FEED: FeedEntry[] = [
  {
    time: "14:00:02",
    type: "plan",
    color: "#a78bfa",
    icon: "🗺️",
    agent: "Planner",
    content:
      "Breaking goal into 6 subtasks: auth, UI, search, tests, review, deploy.",
    reasoning:
      "Goal mentions auth, browsing, and search explicitly — split so each has an owning agent and a testable exit condition.",
  },
  {
    time: "14:00:05",
    type: "spawn",
    color: "#818cf8",
    icon: "⚡",
    agent: "Planner",
    content: "Spawned UI Agent, Logic Agent, Test Agent, Reviewer.",
    reasoning:
      "4 parallel-safe subtasks with little file overlap — spawning one agent per domain avoids merge conflicts.",
  },
  {
    time: "14:00:41",
    type: "code",
    color: "#4ade80",
    icon: "⚙️",
    agent: "Logic Agent",
    content: "Created convex/recipes.ts — CRUD mutations + query.",
    reasoning:
      "Matched the existing convex/*.ts mutation + query pattern from memory rather than inventing a new shape.",
  },
  {
    time: "14:00:52",
    type: "code",
    color: "#4ade80",
    icon: "🎨",
    agent: "UI Agent",
    content: "Created src/components/RecipeCard.tsx, RecipeList.tsx",
    reasoning:
      "Split card vs list so RecipeCard can be reused on both the list and detail views.",
  },
  {
    time: "14:01:10",
    type: "memory",
    color: "#c084fc",
    icon: "🧠",
    agent: "Logic Agent",
    content: "Reusing pattern: Convex mutation validation (used 4× before).",
    reasoning:
      "This project has used the same zod-style validation shape 4 times before with no bugs — cheaper and safer than re-deriving it.",
  },
  {
    time: "14:01:44",
    type: "test",
    color: "#22d3ee",
    icon: "🧪",
    agent: "Test Agent",
    content: "Running 41 tests against recipes + auth…",
    reasoning:
      "Full suite run triggered because both a schema (recipes.ts) and an auth-adjacent file changed in this batch.",
  },
  {
    time: "14:01:52",
    type: "self-heal",
    color: AMBER,
    icon: "⚠️",
    agent: "Test Agent",
    content: "checkout.test.ts failed — TypeError: undefined price",
    isHeal: true,
    resolved: "Auto-patched null check, retried — now passing (attempt 2/2)",
    reasoning:
      "Stack trace pointed at a missing null guard on recipe.price; applied the same guard pattern already used in RecipeCard.tsx.",
  },
  {
    time: "14:02:31",
    type: "code",
    color: "#4ade80",
    icon: "⚙️",
    agent: "Logic Agent",
    content: "Editing src/lib/search.ts — added fuzzy match + debounce",
    reasoning:
      "Plain substring search missed typos in manual testing; fuzzy match plus a 200ms debounce avoids re-querying on every keystroke.",
  },
  {
    time: "14:02:40",
    type: "review",
    color: "#fb923c",
    icon: "🔎",
    agent: "Reviewer",
    content: "Reviewing recipe-search diff (3 files)…",
    isRunning: true,
    reasoning:
      "Reviewer runs after every Logic Agent commit that touches a shared file (search.ts is imported by 2 components).",
  },
];

const SHIPPED_FEED: FeedEntry[] = [
  ...LIVE_FEED.slice(0, -1),
  {
    time: "14:02:40",
    type: "review",
    color: "#fb923c",
    icon: "🔎",
    agent: "Reviewer",
    content: "Reviewed recipe-search diff (3 files) — approved.",
  },
  {
    time: "14:04:12",
    type: "test",
    color: "#22d3ee",
    icon: "🧪",
    agent: "Test Agent",
    content: "41/41 tests passing · 94% coverage.",
    reasoning:
      "Re-ran full suite post-review to confirm the reviewer's approved diff didn't regress anything.",
  },
  {
    time: "14:05:03",
    type: "commit",
    color: "#facc15",
    icon: "📦",
    agent: "Reviewer",
    content: 'Committed "feat: recipe search + auth" — 18 files changed.',
    reasoning:
      "Squashed the swarm's working commits into one reviewable commit for a cleaner history.",
  },
  {
    time: "14:06:50",
    type: "deploy",
    color: EMERALD,
    icon: "🚀",
    agent: "DevOps",
    content: "Deployed to recipe-share-mvp.codeforge.app",
    reasoning:
      "All tests green + review approved satisfies the auto-deploy gate for this project.",
  },
  {
    time: "14:07:42",
    type: "done",
    color: EMERALD,
    icon: "✅",
    agent: "Planner",
    content: "Mission complete — 18 files, 0 errors, shipped in 7m 42s.",
    reasoning:
      "All 6 plan subtasks reached done with no open blockers — nothing left to schedule.",
  },
];

interface DiffLine {
  t: "ctx" | "add" | "del";
  s: string;
}
interface TouchedFile {
  path: string;
  action: "created" | "modified";
  diff?: DiffLine[];
}

const FILES: TouchedFile[] = [
  { path: "convex/recipes.ts", action: "created" },
  {
    path: "convex/schema.ts",
    action: "modified",
    diff: [
      { t: "ctx", s: "  files: defineTable({ ... })," },
      {
        t: "add",
        s: '+ recipes: defineTable({ title: v.string(), price: v.optional(v.number()), authorId: v.id("users") }),',
      },
      { t: "add", s: '+   .index("by_author", ["authorId"]),' },
    ],
  },
  { path: "src/components/RecipeCard.tsx", action: "created" },
  { path: "src/components/RecipeList.tsx", action: "created" },
  { path: "src/components/SearchBar.tsx", action: "created" },
  {
    path: "src/lib/search.ts",
    action: "modified",
    diff: [
      { t: "del", s: "- return items.filter(i => i.title.includes(query));" },
      { t: "add", s: "+ const debounced = useDebounce(query, 200);" },
      {
        t: "add",
        s: '+ return fuzzyMatch(items, debounced, ["title", "ingredients"]);',
      },
    ],
  },
  { path: "src/pages/Auth.tsx", action: "created" },
];

const MEMORIES = [
  "Convex mutation validation pattern",
  "Avoid unbounded useEffect fetch (past bug)",
  "Preferred shadcn dialog for modals",
  "Tailwind dark theme tokens",
  "Debounce pattern for search inputs",
];

const SECRETS = [
  { name: "CONVEX_DEPLOYMENT", set: true },
  { name: "DEEPSEEK_API_KEY", set: true },
  { name: "CEREBRAS_API_KEY", set: true },
  { name: "RESEND_API_KEY", set: true },
  { name: "STRIPE_SECRET_KEY", set: false },
];

const RETRO = {
  worked: [
    "Cerebras free tier held steady under full swarm load",
    "Reused auth + validation patterns saved ~40% build time",
    "Zero manual interventions needed",
  ],
  failed: [
    "First checkout test failed on a null price field (auto-fixed in 1 retry)",
  ],
  newMemories: [
    "Null-check pattern for price fields",
    "Recipe schema shape",
    "Search debounce timing",
  ],
  duration: "7m 42s",
  cost: "$2.14",
};

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

export function MissionControlPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [mode, setMode] = useState<"simple" | "advanced">("advanced");
  const [view, setView] = useState<"live" | "shipped">("live");
  const [rightTab, setRightTab] = useState<"ship" | "deploy" | "errors">(
    "ship",
  );
  const [previewMode, setPreviewMode] = useState<"desktop" | "mobile">(
    "desktop",
  );
  const [expandedFeed, setExpandedFeed] = useState<Record<number, boolean>>({});
  const [expandedFile, setExpandedFile] = useState<string | null>(null);

  const isAdvanced = mode === "advanced";
  const isShipped = view === "shipped";
  const isLive = !isShipped;
  const score = isShipped ? 100 : LIVE_SCORE;
  const canShip = score >= 90;

  const radius = 54;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference * (1 - score / 100);

  const pillDotColor = isShipped ? EMERALD : "#f59e0b";
  const pillTextColor = isShipped ? EMERALD : AMBER;
  const topStatusLabel = isShipped
    ? "Shipped ✅"
    : `${AUTONOMY_LABEL} · Building`;

  const feed = isShipped ? SHIPPED_FEED : LIVE_FEED;
  const files = useMemo(
    () =>
      isShipped
        ? [...FILES, { path: "railway.json", action: "created" as const }]
        : FILES,
    [isShipped],
  );

  const missions = [
    {
      label: "Payment checkout",
      status: "done" as AgentStatus,
      time: "2 days ago",
      current: false,
    },
    {
      label: "Recipe search + auth",
      status: (isShipped ? "done" : "active") as AgentStatus,
      time: isShipped ? "shipped" : "now",
      current: true,
    },
    {
      label: "Social sharing + comments",
      status: "queued" as AgentStatus,
      time: "queued",
      current: false,
    },
  ];

  const integrations = [
    { name: "GitHub", icon: "🐙", connected: true },
    { name: "Convex", icon: "🟣", connected: true },
    { name: "Vercel", icon: "▲", connected: isShipped },
    { name: "Stripe", icon: "💳", connected: false },
  ];

  const checkpoints = [
    { time: "14:00:05", label: "Scaffold + auth complete" },
    { time: "14:01:10", label: "Recipe CRUD + UI complete" },
    { time: "14:01:52", label: "Pre-fix checkpoint (before test failure)" },
    { time: "14:02:31", label: "Search + fuzzy match added" },
    ...(isShipped
      ? [{ time: "14:07:42", label: "Shipped to production" }]
      : []),
  ];

  const deployHistory = [
    ...(isShipped
      ? [
          {
            label: "Deployed — recipe search + auth",
            tag: "live",
            tagColor: EMERALD,
          },
        ]
      : []),
    {
      label: "Deployed — payment checkout",
      tag: isShipped ? "previous" : "live",
      tagColor: isShipped ? MUTED : EMERALD,
    },
  ];

  const errorIncidents = isShipped
    ? [
        {
          title: "TypeError: undefined price in checkout",
          source: "Production · Sentry",
          time: "2m after deploy",
        },
        {
          title: "404 on /api/recipes/search (cold start)",
          source: "Production · Sentry",
          time: "5m after deploy",
        },
      ]
    : [];

  const filesTouchedLabel = isShipped
    ? `${files.length} of ${files.length}`
    : "7 of 14";
  const freeRoleCount = ROSTER.filter(r => r.badge.includes("Free")).length;

  return (
    <div className="h-screen flex flex-col bg-background text-foreground overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2.5 bg-[oklch(0.09_0.02_260)] border-b border-border shrink-0">
        <button
          type="button"
          onClick={() => navigate(`/project/${projectId}`)}
          className="text-primary font-extrabold text-[15px] bg-transparent border-0 cursor-pointer"
          title="Back to IDE"
        >
          {"</>"}
        </button>
        <span className="text-[13px] text-[oklch(0.60_0.02_260)]">
          Recipe Share — MVP
        </span>
        <span className="text-[oklch(0.30_0.02_260)]">/</span>
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
      <div className="relative overflow-hidden px-5 pt-2.5 pb-2 bg-[oklch(0.11_0.02_260)] border-b border-border shrink-0 max-h-[34vh]">
        <div
          className="absolute -top-[140px] left-1/2 -translate-x-1/2 w-[600px] h-[220px] pointer-events-none blur-[40px]"
          style={{
            background:
              "radial-gradient(closest-side, rgba(251,146,60,.28), rgba(244,114,182,.18) 55%, transparent 75%)",
          }}
        />
        <div className="relative max-w-[900px] mx-auto">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2 flex-1 min-w-0 bg-[oklch(0.15_0.02_260)] border border-[oklch(0.27_0.02_260)] rounded-xl px-3 py-[7px] shadow-[0_8px_20px_rgba(0,0,0,.3)]">
              <span className="text-sm text-[oklch(0.55_0.02_260)] shrink-0">
                ＋
              </span>
              <span className="flex-1 min-w-0 text-xs italic text-[oklch(0.90_0.01_260)] truncate">
                "Build a recipe-sharing app with user auth, recipe CRUD, and
                search."
              </span>
              <span className="flex items-center gap-[5px] px-2 py-[3px] rounded-2xl bg-[rgba(251,146,60,.15)] border border-[rgba(251,146,60,.3)] text-[9.5px] font-bold text-[#fb923c] whitespace-nowrap shrink-0">
                🐝 4 agents
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
            <div className="flex items-center gap-1.5 shrink-0">
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
          <div className="flex items-center justify-center gap-1.5 mt-[7px] flex-wrap">
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
          <p className="text-center mt-[5px] mb-0 text-[9.5px] text-[oklch(0.48_0.02_260)]">
            {isShipped
              ? "Shipped in 7m 42s · Full Autopilot"
              : "Started 6 min ago · Full Autopilot ON"}
          </p>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden min-h-0">
        {/* Mission history rail */}
        <div className="w-[172px] shrink-0 bg-[oklch(0.09_0.02_260)] border-r border-border overflow-y-auto px-2 py-3">
          <div
            className={`${SECTION_LABEL} px-1.5 pb-2 tracking-[.06em] text-[oklch(0.55_0.02_260)]`}
          >
            Missions
          </div>
          <div className="flex flex-col gap-[3px]">
            {missions.map(ms => {
              const st = AGENT_STYLE[ms.status];
              return (
                <div
                  key={ms.label}
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
        </div>

        {/* Plan + swarm + checkpoints */}
        <div className="w-[280px] shrink-0 bg-[oklch(0.11_0.02_260)] border-r border-border overflow-y-auto px-3 py-3.5 flex flex-col gap-[18px]">
          <div>
            <div className={`${SECTION_LABEL} mb-2`}>Mission Plan</div>
            <div className="flex flex-col gap-1.5">
              {SUBTASKS.map(t => {
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
                      <div className="text-[11.5px] leading-[1.4]">
                        {t.text}
                      </div>
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
                {SWARM.map(a => {
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
                      key={a.name}
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
                          {a.name}
                        </span>
                        <span
                          className="text-[9px] font-bold uppercase"
                          style={{ color: st.text }}
                        >
                          {st.label}
                        </span>
                      </div>
                      <div className="text-[9.5px] text-[oklch(0.50_0.02_260)] ml-3.5 mt-px">
                        {a.model} · {a.freeTag}
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
              {checkpoints.map(cp => (
                <div key={cp.time} className="flex gap-2">
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
        </div>

        {/* Live feed */}
        <div className="flex-1 flex flex-col min-w-0 bg-[oklch(0.115_0.02_260)]">
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
            {feed.map((f, i) => (
              <div
                key={`${f.time}-${f.type}`}
                className="flex gap-2.5 px-2.5 py-2 rounded-lg min-w-0 max-w-full cursor-pointer"
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
                <span className="font-mono text-[10px] text-[oklch(0.45_0.02_260)] w-14 shrink-0 mt-px">
                  {f.time}
                </span>
                <span className="shrink-0 mt-px">{f.icon}</span>
                <div className="min-w-0 flex-1">
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
                    <span className="ml-auto text-[8.5px] text-[oklch(0.42_0.02_260)]">
                      why?
                    </span>
                  </div>
                  <div
                    className="leading-normal mt-0.5 break-words"
                    style={{
                      color: f.isHeal ? "#fca5a5" : "oklch(0.85 0.01 260)",
                    }}
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
        </div>

        {/* Right panel */}
        <div className="w-[300px] shrink-0 bg-[oklch(0.11_0.02_260)] border-l border-border overflow-y-auto px-3.5 py-4 flex flex-col gap-[18px]">
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
                      ? "Your app is built and shipped. All 18 files are live — the swarm is standing by for the next mission."
                      : `Your app is ${score}% built. Estimated 4 minutes left — the swarm is finishing search and running final tests.`}
                  </p>
                )}
              </div>

              {isAdvanced && (
                <div className="flex flex-col gap-[9px] shrink-0">
                  <ProgressRow
                    label="Plan"
                    value="100%"
                    color={EMERALD}
                    width="100%"
                  />
                  <ProgressRow
                    label="Files"
                    value={isShipped ? "18 / 18" : "14 / 18"}
                    width={isShipped ? "100%" : "78%"}
                  />
                  <ProgressRow
                    label="Tests"
                    value="41 / 41 passing"
                    color={EMERALD}
                    width="100%"
                  />
                  <ProgressRow
                    label="Review"
                    value={isShipped ? "approved" : "in progress"}
                    color={isShipped ? EMERALD : AMBER}
                    width={isShipped ? "100%" : "60%"}
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
                  {files.map(fl => (
                    <div key={fl.path}>
                      <div
                        className="flex items-center gap-1.5 text-[10.5px] font-mono text-[oklch(0.65_0.02_260)]"
                        style={{ cursor: fl.diff ? "pointer" : "default" }}
                        onClick={() =>
                          fl.diff &&
                          setExpandedFile(p => (p === fl.path ? null : fl.path))
                        }
                      >
                        <span
                          className="shrink-0"
                          style={{
                            color: fl.action === "created" ? EMERALD : CYAN,
                          }}
                        >
                          {fl.action === "created" ? "+" : "±"}
                        </span>
                        <span className="truncate flex-1 min-w-0">
                          {fl.path}
                        </span>
                        {fl.diff && (
                          <span className="text-[9px] text-[oklch(0.45_0.02_260)] shrink-0">
                            {expandedFile === fl.path
                              ? "hide diff"
                              : "view diff"}
                          </span>
                        )}
                      </div>
                      {expandedFile === fl.path && fl.diff && (
                        <div className="mt-1 mb-0.5 ml-3.5 px-2 py-1.5 bg-[oklch(0.09_0.02_260)] border border-[oklch(0.22_0.02_260)] rounded-md font-mono text-[9.5px] leading-[1.6]">
                          {fl.diff.map(dl => (
                            <div
                              key={dl.s}
                              className="whitespace-pre-wrap break-words"
                              style={{
                                color:
                                  dl.t === "add"
                                    ? EMERALD
                                    : dl.t === "del"
                                      ? "#f87171"
                                      : "oklch(0.55 0.02 260)",
                              }}
                            >
                              {dl.s}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <div className={`${SECTION_LABEL} mb-2`}>
                  🧠 Memory reused ({MEMORIES.length})
                </div>
                <div className="flex flex-wrap gap-[5px]">
                  {MEMORIES.map(m => (
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
                  <span className={SECTION_LABEL}>Model roster</span>
                  <span className="text-[9.5px] px-[7px] py-0.5 rounded-[10px] bg-[rgba(52,211,153,.12)] text-[#34d399] font-bold">
                    {freeRoleCount}/{ROSTER.length} free-tier
                  </span>
                </div>
                <div className="flex flex-col gap-[5px] mb-2">
                  {ROSTER.map(r => (
                    <div
                      key={r.role}
                      className="flex items-center gap-1.5 text-[10.5px]"
                    >
                      <span className="w-[62px] shrink-0 text-[oklch(0.55_0.02_260)]">
                        {r.role}
                      </span>
                      <span className="flex-1 min-w-0 text-[oklch(0.88_0.01_260)] truncate">
                        {r.model}{" "}
                        <span className="text-[oklch(0.50_0.02_260)]">
                          ({r.provider})
                        </span>
                      </span>
                      <span
                        className="text-[9px] font-bold px-1.5 py-0.5 rounded-lg whitespace-nowrap shrink-0"
                        style={{ background: r.badgeBg, color: r.badgeColor }}
                      >
                        {r.badge}
                      </span>
                    </div>
                  ))}
                </div>
                <p className="m-0 text-[9.5px] text-[oklch(0.48_0.02_260)] leading-normal">
                  Utility calls moved off Groq's free tier (6K tok/min cap,
                  stalls fast) onto Cerebras + Mistral — ~1000× the daily
                  headroom at $0.
                </p>
              </div>

              {isAdvanced && isLive && (
                <div>
                  <div
                    className={`${SECTION_LABEL} mb-2 flex items-center justify-between`}
                  >
                    <span>Budget</span>
                    <span className="font-normal normal-case text-[oklch(0.55_0.02_260)]">
                      $2.14 / $5.00
                    </span>
                  </div>
                  <div className="h-[5px] bg-[oklch(0.20_0.02_260)] rounded-[3px] overflow-hidden mb-3">
                    <div className="h-full w-[43%] bg-[#fbbf24]" />
                  </div>
                  <div className={`${SECTION_LABEL} mb-1.5`}>
                    Autonomy level
                  </div>
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
                    <span>⏱ {RETRO.duration}</span>
                    <span>💲 {RETRO.cost}</span>
                    <span>🖐 0 interventions</span>
                  </div>
                  <div className="text-[9.5px] font-bold uppercase text-[#34d399] mb-[5px]">
                    What worked
                  </div>
                  {RETRO.worked.map(w => (
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
                  {RETRO.failed.map(w => (
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
                  <div className="flex flex-wrap gap-[5px]">
                    {RETRO.newMemories.map(nm => (
                      <span
                        key={nm}
                        className="text-[9.5px] px-2 py-1 rounded-xl bg-[rgba(192,132,252,.12)] text-[#c084fc] border border-[rgba(192,132,252,.2)]"
                      >
                        {nm}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}

          {rightTab === "deploy" && (
            <>
              <div>
                <div className={`${SECTION_LABEL} mb-2`}>Domain</div>
                <div className="flex items-center gap-1.5 bg-[rgba(255,255,255,.04)] border border-border rounded-md px-[9px] py-[7px] mb-1.5">
                  <span className="text-[#34d399]">●</span>
                  <span className="text-[10.5px] font-mono text-[oklch(0.85_0.01_260)] flex-1 min-w-0 truncate">
                    recipe-share-mvp.codeforge.app
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
                <div className={`${SECTION_LABEL} mb-2`}>
                  Environment secrets
                </div>
                <div className="flex flex-col gap-[5px] mb-2">
                  {SECRETS.map(sec => (
                    <div
                      key={sec.name}
                      className="flex items-center gap-[7px] text-[10.5px] font-mono"
                    >
                      <span
                        style={{
                          color: sec.set ? EMERALD : "oklch(0.35 0.02 260)",
                        }}
                      >
                        ●
                      </span>
                      <span className="flex-1 min-w-0 text-[oklch(0.75_0.02_260)] truncate">
                        {sec.name}
                      </span>
                      <span className="text-[oklch(0.45_0.02_260)] tracking-[1px]">
                        {sec.set ? "••••••" : "not set"}
                      </span>
                    </div>
                  ))}
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
                      key={err.title}
                      className="p-2 rounded-[7px] bg-[rgba(52,211,153,.05)] border border-[rgba(52,211,153,.15)]"
                    >
                      <div className="text-[10.5px] text-[oklch(0.85_0.01_260)] leading-[1.4]">
                        {err.title}
                      </div>
                      <div className="flex items-center justify-between mt-1">
                        <span className="text-[9px] text-[oklch(0.50_0.02_260)]">
                          {err.source} · {err.time}
                        </span>
                        <span className="text-[9px] font-bold text-[#34d399]">
                          ✓ auto-fixed
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-[11px] text-[oklch(0.55_0.02_260)] leading-normal m-0">
                  Monitoring starts once this mission ships. No production
                  errors reported yet.
                </p>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="flex items-center gap-5 px-4 py-[9px] border-t border-border bg-[oklch(0.09_0.02_260)] shrink-0">
        <div className="flex items-center gap-1.5">
          <StatusDot live={isLive} color={pillDotColor} size={10} />
          <span
            className="text-[11px] font-bold uppercase"
            style={{ color: pillTextColor }}
          >
            {topStatusLabel}
          </span>
        </div>
        <div className="flex items-center gap-5 text-[11px] text-[oklch(0.65_0.02_260)] flex-1">
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
            Tests <strong className="text-[#34d399]">41/41</strong>
          </span>
        </div>
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
  );
}
