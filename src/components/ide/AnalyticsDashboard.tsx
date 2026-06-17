/**
 * AnalyticsDashboard.tsx — CodeForge Analytics Dashboard
 * 8-panel analytics view powered by api.dashboard.getDashboard
 */
import { useQuery } from "convex/react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Brain,
  CheckCircle2,
  DollarSign,
  GitPullRequest,
  Loader2,
  Shield,
  Swords,
  TrendingUp,
  Trophy,
  XCircle,
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

// ── Mini bar component ────────────────────────────────────────────────────────
function MiniBar({
  value,
  max,
  color = "bg-primary",
}: {
  value: number;
  max: number;
  color?: string;
}) {
  const pct = max > 0 ? Math.round((value / max) * 100) : 0;
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="text-[10px] text-muted-foreground w-6 text-right">
        {value}
      </span>
    </div>
  );
}

// ── Stat card ─────────────────────────────────────────────────────────────────
function StatCard({
  icon,
  label,
  value,
  sub,
  color = "text-primary",
}: {
  icon: React.ReactNode;
  label: string;
  value: string | number;
  sub?: string;
  color?: string;
}) {
  return (
    <div className="bg-card border border-border rounded-lg p-3">
      <div className="flex items-center gap-2 mb-1">
        <span className={color}>{icon}</span>
        <span className="text-[10px] text-muted-foreground uppercase tracking-wide">
          {label}
        </span>
      </div>
      <p className="text-xl font-bold text-foreground">{value}</p>
      {sub && <p className="text-[10px] text-muted-foreground mt-0.5">{sub}</p>}
    </div>
  );
}

interface AnalyticsDashboardProps {
  projectId: Id<"projects">;
}

export function AnalyticsDashboard({ projectId }: AnalyticsDashboardProps) {
  const data = useQuery(api.dashboard.getDashboard, { projectId });

  if (!data) {
    return (
      <div className="h-full flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const {
    missionStats,
    deployStats,
    violationStats,
    debateStats,
    learningStats,
    memoryStats,
    incidentStats,
    benchmarkStats,
    costStats,
  } = data as any;

  return (
    <div className="h-full flex flex-col bg-background">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border bg-[oklch(0.10_0.02_260)] shrink-0">
        <BarChart3 className="h-4 w-4 text-primary" />
        <span className="text-xs font-semibold text-foreground">
          Analytics Dashboard
        </span>
        <Badge variant="outline" className="ml-auto text-[10px]">
          Live
        </Badge>
      </div>

      <ScrollArea className="flex-1 px-3 py-3">
        <div className="space-y-4 max-w-2xl mx-auto">
          {/* ── Panel 1: Mission Stats ──────────────────────────────────── */}
          <section>
            <h3 className="text-[11px] font-semibold text-foreground mb-2 flex items-center gap-2">
              <Activity className="h-3.5 w-3.5 text-cyan-400" />
              Mission Success Rate
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Success rate"
                value={`${missionStats?.successRate ?? 0}%`}
                sub={`${missionStats?.completed ?? 0} completed`}
                color="text-green-400"
              />
              <StatCard
                icon={<XCircle className="h-4 w-4" />}
                label="Failed"
                value={missionStats?.failed ?? 0}
                sub="missions"
                color="text-red-400"
              />
              <StatCard
                icon={<Loader2 className="h-4 w-4" />}
                label="Running"
                value={missionStats?.running ?? 0}
                color="text-yellow-400"
              />
              <StatCard
                icon={<TrendingUp className="h-4 w-4" />}
                label="Last 7d"
                value={missionStats?.last7Days ?? 0}
                sub="missions"
                color="text-blue-400"
              />
            </div>
          </section>

          {/* ── Panel 2: Deployment Pipeline ───────────────────────────── */}
          <section>
            <h3 className="text-[11px] font-semibold text-foreground mb-2 flex items-center gap-2">
              <GitPullRequest className="h-3.5 w-3.5 text-violet-400" />
              Deployment Pipeline
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">
              <StatCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Deployed"
                value={deployStats?.deployed ?? 0}
                color="text-green-400"
              />
              <StatCard
                icon={<Loader2 className="h-4 w-4" />}
                label="Awaiting"
                value={deployStats?.awaitingApproval ?? 0}
                sub="approval"
                color="text-yellow-400"
              />
              <StatCard
                icon={<XCircle className="h-4 w-4" />}
                label="CI Failed"
                value={deployStats?.ciFailed ?? 0}
                color="text-red-400"
              />
              <StatCard
                icon={<TrendingUp className="h-4 w-4" />}
                label="Rolled back"
                value={deployStats?.rolledBack ?? 0}
                color="text-orange-400"
              />
            </div>
            {/* Recent deploys */}
            {deployStats?.recent?.length > 0 && (
              <div className="border border-border rounded-lg overflow-hidden">
                {deployStats.recent.map((d: any, i: number) => (
                  <div
                    key={d.id}
                    className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
                      i < deployStats.recent.length - 1
                        ? "border-b border-border"
                        : ""
                    }`}
                  >
                    <Badge
                      variant="outline"
                      className={`text-[9px] px-1 shrink-0 ${
                        d.status === "deployed"
                          ? "text-green-400 border-green-500/30"
                          : d.status === "ci_failed"
                            ? "text-red-400 border-red-500/30"
                            : "text-muted-foreground"
                      }`}
                    >
                      {d.status}
                    </Badge>
                    <span className="font-mono text-[10px] truncate text-muted-foreground">
                      {d.branch}
                    </span>
                    {d.prUrl && (
                      <a
                        href={d.prUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="ml-auto text-violet-400 text-[9px] shrink-0 hover:underline"
                      >
                        PR ↗
                      </a>
                    )}
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Panel 3: Sentry Violations ─────────────────────────────── */}
          <section>
            <h3 className="text-[11px] font-semibold text-foreground mb-2 flex items-center gap-2">
              <Shield className="h-3.5 w-3.5 text-red-400" />
              Sentry Violations
            </h3>
            <div className="grid grid-cols-2 gap-2 mb-2">
              <StatCard
                icon={<Shield className="h-4 w-4" />}
                label="Total blocked"
                value={violationStats?.blocked ?? 0}
                sub={`of ${violationStats?.total ?? 0} total`}
                color="text-red-400"
              />
              <StatCard
                icon={<AlertTriangle className="h-4 w-4" />}
                label="Last 24h"
                value={violationStats?.last24h ?? 0}
                color="text-orange-400"
              />
            </div>
            {/* Severity breakdown */}
            {violationStats?.bySeverity && (
              <div className="border border-border rounded-lg p-3 space-y-1.5">
                <p className="text-[10px] text-muted-foreground mb-2">
                  By severity
                </p>
                {[
                  { key: "critical", color: "bg-red-500" },
                  { key: "high", color: "bg-orange-500" },
                  { key: "medium", color: "bg-yellow-500" },
                  { key: "low", color: "bg-blue-500" },
                ].map(({ key, color }) => (
                  <div key={key} className="flex items-center gap-2">
                    <span className="text-[10px] text-muted-foreground w-14 capitalize">
                      {key}
                    </span>
                    <MiniBar
                      value={violationStats.bySeverity[key] ?? 0}
                      max={violationStats.total || 1}
                      color={color}
                    />
                  </div>
                ))}
              </div>
            )}
          </section>

          {/* ── Panel 4: Debate Verdicts ───────────────────────────────── */}
          <section>
            <h3 className="text-[11px] font-semibold text-foreground mb-2 flex items-center gap-2">
              <Swords className="h-3.5 w-3.5 text-orange-400" />
              Debate Engine
            </h3>
            <div className="grid grid-cols-3 gap-2 mb-2">
              <StatCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Proceed"
                value={debateStats?.byVerdict?.PROCEED ?? 0}
                color="text-green-400"
              />
              <StatCard
                icon={<Zap className="h-4 w-4" />}
                label="Refine"
                value={debateStats?.byVerdict?.REFINE ?? 0}
                color="text-yellow-400"
              />
              <StatCard
                icon={<XCircle className="h-4 w-4" />}
                label="Block"
                value={debateStats?.byVerdict?.BLOCK ?? 0}
                color="text-red-400"
              />
            </div>
            {debateStats?.avgConfidence !== undefined && (
              <div className="border border-border rounded-lg px-3 py-2 text-xs text-muted-foreground">
                Avg confidence:{" "}
                <span className="text-foreground font-semibold">
                  {debateStats.avgConfidence}%
                </span>
                <span className="ml-4">
                  Total debates:{" "}
                  <span className="text-foreground font-semibold">
                    {debateStats.total ?? 0}
                  </span>
                </span>
              </div>
            )}
          </section>

          {/* ── Panel 5: Learning Loop Health ─────────────────────────── */}
          <section>
            <h3 className="text-[11px] font-semibold text-foreground mb-2 flex items-center gap-2">
              <Brain className="h-3.5 w-3.5 text-violet-400" />
              Learning Loop
            </h3>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <StatCard
                icon={<TrendingUp className="h-4 w-4" />}
                label="Health score"
                value={
                  learningStats?.latestHealthScore
                    ? `${learningStats.latestHealthScore}/10`
                    : "—"
                }
                color="text-green-400"
              />
              <StatCard
                icon={<Brain className="h-4 w-4" />}
                label="Mutations"
                value={learningStats?.pendingMutations ?? 0}
                sub="pending review"
                color="text-violet-400"
              />
              <StatCard
                icon={<CheckCircle2 className="h-4 w-4" />}
                label="Applied"
                value={learningStats?.appliedMutations ?? 0}
                color="text-green-400"
              />
              <StatCard
                icon={<Activity className="h-4 w-4" />}
                label="Reflections"
                value={learningStats?.totalReflections ?? 0}
                color="text-cyan-400"
              />
            </div>
          </section>

          {/* ── Panel 6: Memory Breakdown ──────────────────────────────── */}
          {memoryStats?.byCategory && (
            <section>
              <h3 className="text-[11px] font-semibold text-foreground mb-2 flex items-center gap-2">
                <Brain className="h-3.5 w-3.5 text-purple-400" />
                Memory ({memoryStats.total ?? 0} total)
              </h3>
              <div className="border border-border rounded-lg p-3 space-y-1.5">
                {Object.entries(
                  memoryStats.byCategory as Record<string, number>,
                )
                  .sort(([, a], [, b]) => b - a)
                  .map(([cat, count]) => (
                    <div key={cat} className="flex items-center gap-2">
                      <span className="text-[10px] text-muted-foreground w-24 truncate capitalize">
                        {cat}
                      </span>
                      <MiniBar
                        value={count}
                        max={memoryStats.total || 1}
                        color="bg-purple-500"
                      />
                    </div>
                  ))}
              </div>
            </section>
          )}

          {/* ── Panel 7: Error Ingestion ───────────────────────────────── */}
          {incidentStats && (
            <section>
              <h3 className="text-[11px] font-semibold text-foreground mb-2 flex items-center gap-2">
                <AlertTriangle className="h-3.5 w-3.5 text-red-400" />
                Error Auto-Fix
              </h3>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <StatCard
                  icon={<AlertTriangle className="h-4 w-4" />}
                  label="Incidents"
                  value={incidentStats.total ?? 0}
                  color="text-red-400"
                />
                <StatCard
                  icon={<GitPullRequest className="h-4 w-4" />}
                  label="PRs opened"
                  value={incidentStats.prOpened ?? 0}
                  color="text-violet-400"
                />
                <StatCard
                  icon={<CheckCircle2 className="h-4 w-4" />}
                  label="Resolved"
                  value={incidentStats.resolved ?? 0}
                  color="text-green-400"
                />
                <StatCard
                  icon={<TrendingUp className="h-4 w-4" />}
                  label="Auto-fix rate"
                  value={`${incidentStats.autoFixRate ?? 0}%`}
                  color="text-cyan-400"
                />
              </div>
            </section>
          )}

          {/* ── Panel 8: Benchmark Leaderboard ────────────────────────── */}
          {benchmarkStats?.leaderboard?.length > 0 && (
            <section>
              <h3 className="text-[11px] font-semibold text-foreground mb-2 flex items-center gap-2">
                <Trophy className="h-3.5 w-3.5 text-yellow-400" />
                Model Leaderboard
              </h3>
              <div className="border border-border rounded-lg overflow-hidden">
                {benchmarkStats.leaderboard.map((entry: any, i: number) => (
                  <div
                    key={entry.model}
                    className={`flex items-center gap-3 px-3 py-2 text-xs ${
                      i < benchmarkStats.leaderboard.length - 1
                        ? "border-b border-border"
                        : ""
                    }`}
                  >
                    <span
                      className={`text-[10px] font-bold w-4 ${i === 0 ? "text-yellow-400" : i === 1 ? "text-slate-300" : "text-amber-600"}`}
                    >
                      #{i + 1}
                    </span>
                    <span className="font-mono text-[10px] text-foreground flex-1 truncate">
                      {entry.model}
                    </span>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className="text-green-400 text-[10px]">
                        {entry.wins}W
                      </span>
                      <span className="text-red-400 text-[10px]">
                        {entry.losses}L
                      </span>
                      <span className="text-muted-foreground text-[10px]">
                        {entry.winRate}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {/* ── Cost Breakdown ─────────────────────────────────────────── */}
          {costStats && (
            <section>
              <h3 className="text-[11px] font-semibold text-foreground mb-2 flex items-center gap-2">
                <DollarSign className="h-3.5 w-3.5 text-green-400" />
                Cost Breakdown
              </h3>
              <div className="grid grid-cols-2 gap-2">
                <StatCard
                  icon={<DollarSign className="h-4 w-4" />}
                  label="Total spend"
                  value={`$${(costStats.totalCost ?? 0).toFixed(4)}`}
                  color="text-green-400"
                />
                <StatCard
                  icon={<Activity className="h-4 w-4" />}
                  label="Total tokens"
                  value={(costStats.totalTokens ?? 0).toLocaleString()}
                  color="text-blue-400"
                />
              </div>
              {costStats.byModel &&
                Object.keys(costStats.byModel).length > 0 && (
                  <div className="border border-border rounded-lg p-3 mt-2 space-y-1.5">
                    <p className="text-[10px] text-muted-foreground mb-2">
                      By model
                    </p>
                    {Object.entries(
                      costStats.byModel as Record<
                        string,
                        { cost: number; tokens: number }
                      >,
                    )
                      .sort(([, a], [, b]) => b.cost - a.cost)
                      .slice(0, 6)
                      .map(([model, { cost, tokens }]) => (
                        <div
                          key={model}
                          className="flex items-center gap-2 text-[10px]"
                        >
                          <span className="font-mono text-muted-foreground truncate flex-1">
                            {model}
                          </span>
                          <span className="text-foreground shrink-0">
                            ${cost.toFixed(4)}
                          </span>
                          <span className="text-muted-foreground shrink-0">
                            {tokens.toLocaleString()}t
                          </span>
                        </div>
                      ))}
                  </div>
                )}
            </section>
          )}
        </div>
      </ScrollArea>
    </div>
  );
}
