/**
 * dashboard.ts — CodeForge Analytics Dashboard
 *
 * Single query that powers the entire dashboard UI.
 * All the rich data across 35+ tables, aggregated into one response.
 *
 * Panels:
 *   - Mission success/failure rates over time
 *   - Agent performance by role (avg quality score, tool call counts)
 *   - Mutation impact (health score before vs after)
 *   - Deployment pipeline status + history
 *   - Sentry violation heatmap
 *   - Cost per mission (tokens × model pricing)
 *   - Cross-project insight count
 *   - Benchmark leaderboard
 *   - Error ingestion stats
 *   - Learning loop health
 */

import { v } from "convex/values";
import { query, action } from "./_generated/server";
import { api } from "./_generated/api";
import { getAuthUserId } from "@convex-dev/auth/server";

// ─── MAIN DASHBOARD QUERY ─────────────────────────────────────────────────────

export const getDashboard = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    const week = 7 * day;

    // ── Missions ─────────────────────────────────────────────────────────
    const missions = await ctx.db
      .query("buildSessions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(100);

    const missionStats = {
      total: missions.length,
      completed: missions.filter((m: any) => m.status === "completed").length,
      failed: missions.filter((m: any) => m.status === "error").length,
      running: missions.filter((m: any) => m.status === "running").length,
      last7Days: missions.filter((m: any) => m._creationTime > now - week).length,
      successRate: missions.length
        ? Math.round(
            (missions.filter((m: any) => m.status === "completed").length / missions.length) * 100
          )
        : 0,
    };

    // ── Deployments ───────────────────────────────────────────────────────
    const deployments = await ctx.db
      .query("deployments")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(20);

    const deployStats = {
      total: deployments.length,
      deployed: deployments.filter((d) => d.status === "deployed" || d.status === "canary").length,
      awaitingApproval: deployments.filter((d) => d.status === "awaiting_human").length,
      ciFailed: deployments.filter((d) => d.status === "ci_failed").length,
      rolledBack: deployments.filter((d) => d.status === "rolled_back").length,
      recent: deployments.slice(0, 5).map((d) => ({
        id: d._id,
        branch: d.branchName,
        status: d.status,
        prUrl: d.prUrl,
        createdAt: d.createdAt,
      })),
    };

    // ── Sentry Violations ─────────────────────────────────────────────────
    const violations = await ctx.db
      .query("sentryViolations")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(200);

    const violationStats = {
      total: violations.length,
      blocked: violations.filter((v) => v.blocked).length,
      last24h: violations.filter((v) => v.timestamp > now - day).length,
      bySeverity: {
        critical: violations.filter((v) => v.severity === "critical").length,
        high: violations.filter((v) => v.severity === "high").length,
        medium: violations.filter((v) => v.severity === "medium").length,
        low: violations.filter((v) => v.severity === "low").length,
      },
      byType: violations.reduce((acc, v) => {
        acc[v.violationType] = (acc[v.violationType] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      // Heatmap: violations by hour of day (last 7 days)
      heatmap: (() => {
        const buckets = Array(24).fill(0);
        for (const v of violations.filter((v) => v.timestamp > now - week)) {
          const hour = new Date(v.timestamp).getUTCHours();
          buckets[hour]++;
        }
        return buckets;
      })(),
    };

    // ── Debates ───────────────────────────────────────────────────────────
    const debates = await ctx.db
      .query("debates")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(100);

    const debateStats = {
      total: debates.length,
      proceed: debates.filter((d) => d.verdict === "PROCEED").length,
      refine: debates.filter((d) => d.verdict === "REFINE").length,
      escalate: debates.filter((d) => d.verdict === "ESCALATE").length,
      avgConfidence: debates.length
        ? Math.round(debates.reduce((s, d) => s + d.confidence, 0) / debates.length)
        : 0,
      avgDurationMs: debates.length
        ? Math.round(debates.reduce((s, d) => s + d.durationMs, 0) / debates.length)
        : 0,
    };

    // ── Learning Loop ─────────────────────────────────────────────────────
    const reflections = await ctx.db
      .query("reflectionSessions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(10);

    const forensicReports = await ctx.db
      .query("forensicReports")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(20);

    const mutations = await ctx.db
      .query("mutationLog")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const learningStats = {
      reflectionSessions: reflections.length,
      latestHealthScore: reflections[0]?.overallHealthScore ?? null,
      healthTrend: reflections.slice(0, 5).map((r) => ({
        score: r.overallHealthScore,
        ts: r.timestamp,
      })).reverse(),
      forensicReports: forensicReports.length,
      openForensic: forensicReports.filter((r) => !r.mutationApplied).length,
      mutationsApplied: mutations.filter((m) => m.status === "applied").length,
      mutationsPending: mutations.filter((m) => m.status === "pending_review").length,
      totalLessonsLearned: reflections.reduce((s, r) => s + r.lessonsLearned.length, 0),
    };

    // ── Memories ──────────────────────────────────────────────────────────
    const memories = await ctx.db
      .query("agentMemories")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    const memoryStats = {
      total: memories.length,
      byCategory: memories.reduce((acc, m) => {
        acc[m.category] = (acc[m.category] ?? 0) + 1;
        return acc;
      }, {} as Record<string, number>),
      avgImportance: memories.length
        ? Math.round((memories.reduce((s, m) => s + m.importance, 0) / memories.length) * 100)
        : 0,
    };

    // ── Error Incidents ───────────────────────────────────────────────────
    const incidents = await ctx.db
      .query("errorIncidents")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(50);

    const incidentStats = {
      total: incidents.length,
      open: incidents.filter((i) => i.status === "new" || i.status === "analyzing" || i.status === "fixing").length,
      autofixed: incidents.filter((i) => i.status === "pr_opened" || i.status === "resolved").length,
      last24h: incidents.filter((i) => i.createdAt > now - day).length,
    };

    // ── Benchmarks ────────────────────────────────────────────────────────
    const benchmarks = await ctx.db
      .query("benchmarkRuns")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(20);

    const benchmarkStats = {
      total: benchmarks.length,
      recent: benchmarks.slice(0, 3).map((b) => ({
        role: b.agentRole,
        modelA: b.modelA,
        modelB: b.modelB,
        winner: b.winner,
        scoreA: b.scoreA,
        scoreB: b.scoreB,
      })),
    };

    return {
      generatedAt: now,
      missions: missionStats,
      deployments: deployStats,
      violations: violationStats,
      debates: debateStats,
      learning: learningStats,
      memories: memoryStats,
      incidents: incidentStats,
      benchmarks: benchmarkStats,
    };
  },
});

// ─── MISSION TIMELINE (for time-series charts) ────────────────────────────────

export const getMissionTimeline = query({
  args: {
    projectId: v.id("projects"),
    days: v.optional(v.number()),  // default 30
  },
  handler: async (ctx, args) => {
    const days = args.days ?? 30;
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const missions = await ctx.db
      .query("buildSessions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .filter((q) => q.gte(q.field("_creationTime"), since))
      .collect();

    // Group by day
    const byDay: Record<string, { success: number; fail: number; total: number }> = {};
    for (const m of missions) {
      const day = new Date(m._creationTime).toISOString().slice(0, 10);
      if (!byDay[day]) byDay[day] = { success: 0, fail: 0, total: 0 };
      byDay[day].total++;
      if ((m as any).status === "completed") byDay[day].success++;
      if ((m as any).status === "error") byDay[day].fail++;
    }

    return Object.entries(byDay)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, counts]) => ({ date, ...counts }));
  },
});

// ─── COST BREAKDOWN ───────────────────────────────────────────────────────────

export const getCostBreakdown = query({
  args: {
    projectId: v.id("projects"),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const days = args.days ?? 30;
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    // costEntries is indexed by user, not project — get all and filter by session
    const sessions = await ctx.db
      .query("buildSessions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    const sessionIds = new Set(sessions.map((s) => s._id));

    const allCosts = await ctx.db
      .query("costEntries")
      .filter((q) => q.gte(q.field("_creationTime"), since))
      .take(500);
    const costs = allCosts.filter((c: any) => c.buildSessionId && sessionIds.has(c.buildSessionId));

    const byModel = costs.reduce((acc, c: any) => {
      const model = c.model ?? "unknown";
      if (!acc[model]) acc[model] = { tokens: 0, cost: 0, calls: 0 };
      acc[model].tokens += (c.inputTokens ?? 0) + (c.outputTokens ?? 0);
      acc[model].cost += c.cost ?? 0;
      acc[model].calls++;
      return acc;
    }, {} as Record<string, { tokens: number; cost: number; calls: number }>);

    const totalCost = Object.values(byModel).reduce((s, m) => s + m.cost, 0);

    return {
      totalCostUsd: Math.round(totalCost * 10000) / 10000,
      byModel,
      periodDays: days,
    };
  },
});



