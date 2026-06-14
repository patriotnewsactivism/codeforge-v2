/**
 * reflection.ts — CodeForge Reflection Agent
 *
 * Layer 4 of the Learning Loop: nightly prompt mutation + topology evaluation.
 *
 * The Reflection Agent runs on a schedule (nightly). It:
 *   1. Reads all pending mutations from the Mutation Engine
 *   2. Reviews the last N retrospectives and forensic reports
 *   3. Decides which mutations to apply, reject, or defer
 *   4. Synthesizes a "lessons learned" memory entry for each project
 *   5. Optionally triggers the Strategist for weekly topology evaluation
 *
 * The Reflection Agent is the only agent that can approve mutations.
 * It cannot approve its own retrospectives (same no-self-approval rule).
 *
 * This file also exports runWeeklyStrategy() for the Strategist role.
 */

import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { callAIWithFallback, getModelForRole } from "./ai";

// ─── DB ──────────────────────────────────────────────────────────────────────

export const saveReflectionSession = mutation({
  args: {
    projectId: v.id("projects"),
    mutationsReviewed: v.number(),
    mutationsApproved: v.number(),
    mutationsRejected: v.number(),
    retrospectivesRead: v.number(),
    forensicReportsRead: v.number(),
    lessonsLearned: v.array(v.string()),
    overallHealthScore: v.number(),   // 1–10
    summary: v.string(),
    nextActions: v.array(v.string()),
  },
  returns: v.id("reflectionSessions"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("reflectionSessions", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

export const listReflectionSessions = query({
  args: { projectId: v.id("projects"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("reflectionSessions")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(args.limit ?? 10);
  },
});

// ─── CORE ACTION: runNightlyReflection ───────────────────────────────────────

export const runNightlyReflection = action({
  args: {
    projectId: v.id("projects"),
    maxMutationsToReview: v.optional(v.number()),
  },
  returns: v.object({
    sessionId: v.id("reflectionSessions"),
    mutationsApproved: v.number(),
    mutationsRejected: v.number(),
    lessonsLearned: v.number(),
    healthScore: v.number(),
    summary: v.string(),
  }),
  handler: async (ctx, args) => {
    const maxMutations = args.maxMutationsToReview ?? 20;

    // ── 1. Load pending mutations ─────────────────────────────────────────
    const pendingMutations = await ctx.runQuery(api.mutation.listMutations, {
      projectId: args.projectId,
      status: "pending_review",
      limit: maxMutations,
    });

    // ── 2. Load recent retrospectives ────────────────────────────────────
    const retros = await ctx.runQuery(api.memory.listRetrospectives, {
      projectId: args.projectId,
    });
    const recentRetros = retros.slice(0, 10);

    // ── 3. Load recent forensic reports ──────────────────────────────────
    const forensicReports = await ctx.runQuery(api.forensic.listReports, {
      projectId: args.projectId,
      limit: 10,
    });

    // ── 4. Build context for Reflection ──────────────────────────────────
    const mutationBlock = pendingMutations.length
      ? pendingMutations.map((m, i) =>
          `[${i + 1}] Target: ${m.mutationTarget} | Severity: ${m.severity}\n    Proposed: ${m.proposedMutation}`
        ).join("\n")
      : "No pending mutations.";

    const retroBlock = recentRetros.length
      ? recentRetros.map((r) =>
          `Score ${r.qualityScore}/10 — Failed: ${r.whatFailed.slice(0, 2).join("; ")} | Worked: ${r.whatWorked.slice(0, 2).join("; ")}`
        ).join("\n")
      : "No recent retrospectives.";

    const forensicBlock = forensicReports.length
      ? forensicReports.map((r) =>
          `[${r.failureClass}] ${r.rootCause} → ${r.proposedMutation.slice(0, 80)}`
        ).join("\n")
      : "No forensic reports.";

    const reflectionPrompt = `You are the Reflection Agent in CodeForge — an autonomous coding platform's self-improvement system.
You run nightly. Your job: review pending mutations, learn from retrospectives, and make the system smarter.

═══ PENDING MUTATIONS (${pendingMutations.length}) ═══
${mutationBlock}

═══ RECENT RETROSPECTIVES (${recentRetros.length}) ═══
${retroBlock}

═══ RECENT FORENSIC REPORTS (${forensicReports.length}) ═══
${forensicBlock}

Your tasks:
1. For each pending mutation, decide: APPROVE or REJECT (with reason)
2. Extract 2-5 "lessons learned" — concrete insights that apply across future missions
3. Give the system an overall health score (1-10)
4. List 2-3 next actions for the system to prioritize

Rules:
- Only approve mutations that are specific, safe, and reversible
- Reject mutations that are vague ("be better"), too broad, or could break working behavior
- Lessons learned should be project-agnostic patterns ("Always read files before editing them")

Respond with JSON only:
{
  "mutationDecisions": [
    { "index": 1, "decision": "APPROVE" | "REJECT", "reason": "..." }
  ],
  "lessonsLearned": ["lesson 1", "lesson 2"],
  "healthScore": <1-10>,
  "summary": "2-3 sentence overall assessment",
  "nextActions": ["action 1", "action 2"]
}`;

    const { text: raw } = await callAIWithFallback(reflectionPrompt, {
      model: getModelForRole("orchestrator"),
      temperature: 0.3,
    });

    // Parse
    let decisions: Array<{ index: number; decision: string; reason: string }> = [];
    let lessonsLearned: string[] = [];
    let healthScore = 5;
    let summary = "Reflection complete.";
    let nextActions: string[] = [];

    try {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[1]! : raw.trim());
      decisions = parsed.mutationDecisions ?? [];
      lessonsLearned = parsed.lessonsLearned ?? [];
      healthScore = Math.min(10, Math.max(1, parsed.healthScore ?? 5));
      summary = parsed.summary ?? summary;
      nextActions = parsed.nextActions ?? [];
    } catch { /* use defaults */ }

    // ── 5. Apply approved mutations, reject others ────────────────────────
    let approved = 0;
    let rejected = 0;

    for (const decision of decisions) {
      const idx = decision.index - 1;
      const m = pendingMutations[idx];
      if (!m) continue;

      if (decision.decision === "APPROVE") {
        await ctx.runAction(api.mutation.applyMutation, {
          projectId: args.projectId,
          reportId: m.reportId,
          proposedMutation: m.proposedMutation,
          mutationTarget: m.mutationTarget as any,
          severity: m.severity as any,
          autoApply: true,
        });
        approved++;
      } else {
        await ctx.runMutation(api.mutation.updateMutationStatus, {
          mutationId: m._id,
          status: "rejected",
          rejectionReason: decision.reason,
        });
        rejected++;
      }
    }

    // ── 6. Persist lessons as agentMemories ──────────────────────────────
    for (const lesson of lessonsLearned) {
      await ctx.runMutation(api.memory.saveMemory, {
        projectId: args.projectId,
        category: "insight",
        content: lesson,
        importance: 0.7,
        source: "reflection-agent",
      });
    }

    // ── 7. Save reflection session ────────────────────────────────────────
    const sessionId = await ctx.runMutation(api.reflection.saveReflectionSession, {
      projectId: args.projectId,
      mutationsReviewed: pendingMutations.length,
      mutationsApproved: approved,
      mutationsRejected: rejected,
      retrospectivesRead: recentRetros.length,
      forensicReportsRead: forensicReports.length,
      lessonsLearned,
      overallHealthScore: healthScore,
      summary,
      nextActions,
    });

    // ── 8. Broadcast summary ──────────────────────────────────────────────
    const healthEmoji = healthScore >= 8 ? "💚" : healthScore >= 5 ? "💛" : "🔴";
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "reflection-agent",
      agentName: "🌙 Reflection",
      type: "complete",
      content: `${healthEmoji} Nightly reflection complete. Health: ${healthScore}/10. Approved ${approved} mutations, rejected ${rejected}. ${lessonsLearned.length} lessons learned.\n${summary}`,
      isStreaming: false,
    });

    return {
      sessionId,
      mutationsApproved: approved,
      mutationsRejected: rejected,
      lessonsLearned: lessonsLearned.length,
      healthScore,
      summary,
    };
  },
});

// ─── WEEKLY STRATEGIST ───────────────────────────────────────────────────────
// Runs weekly. Evaluates agent topology — are we using the right models,
// the right roles, the right spawn patterns? Proposes structural changes.

export const runWeeklyStrategy = action({
  args: { projectId: v.id("projects") },
  returns: v.object({
    recommendations: v.array(v.string()),
    topologyChanges: v.array(v.string()),
    summary: v.string(),
  }),
  handler: async (ctx, args) => {
    // Pull last 4 reflection sessions for trend data
    const sessions = await ctx.runQuery(api.reflection.listReflectionSessions, {
      projectId: args.projectId,
      limit: 4,
    });

    const sessionBlock = sessions.length
      ? sessions.map((s) =>
          `Health ${s.overallHealthScore}/10 | Mutations approved: ${s.mutationsApproved} | Lessons: ${s.lessonsLearned.join("; ")}`
        ).join("\n")
      : "No prior reflection sessions.";

    // Pull applied mutations to understand what's changed
    const appliedMutations = await ctx.runQuery(api.mutation.getActiveMutations, {
      projectId: args.projectId,
    });

    const mutationBlock = appliedMutations.length
      ? appliedMutations.slice(0, 10).map((m) =>
          `[${m.mutationTarget}] ${m.proposedMutation.slice(0, 80)}`
        ).join("\n")
      : "No active mutations.";

    const prompt = `You are the Strategist in CodeForge — the weekly topology evaluator.
You look at the bigger picture: are the agents structured correctly? Are we using the right models?
Are there recurring failure patterns that indicate a deeper architectural problem?

═══ LAST 4 REFLECTION SESSIONS ═══
${sessionBlock}

═══ ACTIVE MUTATIONS (${appliedMutations.length}) ═══
${mutationBlock}

Available agent roles: orchestrator, architect, coder, reviewer, debugger, tester, devops, forensic, reflection, strategist
Available models: grok-4 (strong), deepseek-v3 (code), grok-3-fast (fast/cheap), kimi-k2 (balanced)

Your tasks:
1. Identify any topology problems (wrong model for a role, missing role, underutilized role)
2. Propose 2-4 concrete topology changes
3. Give 3-5 strategic recommendations for the next week
4. Write a brief strategic summary

JSON only:
{
  "topologyChanges": ["change 1", "change 2"],
  "recommendations": ["rec 1", "rec 2"],
  "summary": "2-3 sentence strategic assessment"
}`;

    const { text: raw } = await callAIWithFallback(prompt, {
      model: getModelForRole("orchestrator"),
      temperature: 0.4,
    });

    let topologyChanges: string[] = [];
    let recommendations: string[] = [];
    let summary = "Weekly strategy complete.";

    try {
      const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[1]! : raw.trim());
      topologyChanges = parsed.topologyChanges ?? [];
      recommendations = parsed.recommendations ?? [];
      summary = parsed.summary ?? summary;
    } catch { /* use defaults */ }

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "strategist-agent",
      agentName: "♟️ Strategist",
      type: "complete",
      content: `📊 Weekly strategy: ${summary}\n${recommendations.slice(0, 3).map((r) => `→ ${r}`).join("\n")}`,
      isStreaming: false,
    });

    return { recommendations, topologyChanges, summary };
  },
});



