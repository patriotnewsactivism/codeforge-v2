/**
 * debate.ts — CodeForge Debate Engine
 *
 * All architectural decisions flow through a structured 3-agent debate.
 * No destructive operation, major refactor, or architectural choice is made
 * without Proponent → Opponent → Moderator consensus.
 *
 * Verdict: PROCEED | REFINE | ESCALATE
 *
 * PROCEED   — change is approved, execute immediately
 * REFINE    — good idea but needs adjustment, Moderator provides specific changes
 * ESCALATE  — too risky or uncertain, requires human gate before proceeding
 */

import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, mutation, query } from "./_generated/server";
import { callAIWithFallback, getModelForRole } from "./ai";

// ─── BYOK: Resolve caller plan + API keys ────────────────────────────────────
// Lifetime users get their stored keys injected into AI calls.
// Weekly/monthly/free users use platform process.env keys (no userKeys passed).
async function resolveByok(
  ctx: any,
  userId?: string,
): Promise<{ callerPlan: string; userKeys?: Record<string, string> }> {
  try {
    const sub = await ctx.runQuery(api.limits.getMyLimits, {});
    const callerPlan: string = sub?.plan ?? "free";
    if (callerPlan !== "lifetime") return { callerPlan };
    if (!userId) return { callerPlan };

    const userKeys: Record<string, string> = await ctx.runQuery(
      api.apiKeys.getAllKeysForUser,
      { userId },
    );
    if (!userKeys || Object.keys(userKeys).length === 0) {
      throw new Error(
        "⚠️ Lifetime plan requires your own API key. " +
          "Add one in Settings → API Keys to use AI features.",
      );
    }
    return { callerPlan, userKeys };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("⚠️")) throw err;
    return { callerPlan: "free" };
  }
}

// ─── TYPES ─────────────────────────────────────────────────────────────────

export type DebateVerdict = "PROCEED" | "REFINE" | "ESCALATE";

export interface DebateResult {
  debateId: Id<"debates">;
  verdict: DebateVerdict;
  proponentArgument: string;
  opponentArgument: string;
  moderatorReasoning: string;
  refinements?: string[];
  escalationReason?: string;
  confidence: number;
}

// ─── DB MUTATIONS & QUERIES ────────────────────────────────────────────────

export const saveDebate = mutation({
  args: {
    projectId: v.id("projects"),
    buildSessionId: v.optional(v.id("buildSessions")),
    proposal: v.string(),
    proponentArgument: v.string(),
    opponentArgument: v.string(),
    moderatorReasoning: v.string(),
    verdict: v.union(
      v.literal("PROCEED"),
      v.literal("REFINE"),
      v.literal("ESCALATE"),
    ),
    refinements: v.optional(v.array(v.string())),
    escalationReason: v.optional(v.string()),
    confidence: v.number(),
    durationMs: v.number(),
  },
  returns: v.id("debates"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("debates", {
      ...args,
      timestamp: Date.now(),
      humanApproved: false,
    });
  },
});

export const approveEscalation = mutation({
  args: { debateId: v.id("debates") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.debateId, {
      humanApproved: true,
      approvedAt: Date.now(),
    });
    return null;
  },
});

export const listDebates = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("debates")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .take(args.limit ?? 50);
  },
});

export const getDebate = query({
  args: { debateId: v.id("debates") },
  handler: async (ctx, args) => ctx.db.get(args.debateId),
});

// ─── CORE DEBATE ACTION ────────────────────────────────────────────────────

export const runDebate = action({
  args: {
    projectId: v.id("projects"),
    proposal: v.string(),
    context: v.optional(v.string()), // codebase context, file list, etc.
    buildSessionId: v.optional(v.id("buildSessions")),
    operationType: v.optional(
      v.union(
        // helps calibrate verdict thresholds
        v.literal("architectural"), // high stakes — schema, infra, stack
        v.literal("destructive"), // delete files, drop tables
        v.literal("refactor"), // code restructure
        v.literal("feature"), // new feature addition
        v.literal("bugfix"), // bug fix
        v.literal("style"), // cosmetic/formatting
      ),
    ),
  },
  returns: v.object({
    debateId: v.id("debates"),
    verdict: v.union(
      v.literal("PROCEED"),
      v.literal("REFINE"),
      v.literal("ESCALATE"),
    ),
    proponentArgument: v.string(),
    opponentArgument: v.string(),
    moderatorReasoning: v.string(),
    refinements: v.optional(v.array(v.string())),
    escalationReason: v.optional(v.string()),
    confidence: v.number(),
  }),
  handler: async (ctx, args): Promise<DebateResult> => {
    const startMs = Date.now();
    const opType = args.operationType ?? "feature";
    const contextBlock = args.context
      ? `\n\nProject context:\n${args.context.slice(0, 3000)}`
      : "";

    // ── Round 1: Proponent ─────────────────────────────────────────────────
    const proponentPrompt = `You are the Proponent agent in a CodeForge architectural debate.
Your job: argue FOR the following proposal. Be specific, cite technical benefits, and anticipate objections.

Proposal: ${args.proposal}
Operation type: ${opType}${contextBlock}

Respond with a focused argument (3–5 sentences max). Be concrete — cite real engineering benefits.
Do NOT hedge. You are arguing FOR this change.`;

    // BYOK: resolve caller plan + keys for lifetime users
    const byok = await resolveByok(ctx);
    const { text: proponentArgument } = await callAIWithFallback(
      proponentPrompt,
      {
        model: await getModelForRole(ctx, "architect"),
        temperature: 0.4,
        callerPlan: byok?.callerPlan,
        userKeys: byok?.userKeys,
      },
    );

    // ── Round 2: Opponent ──────────────────────────────────────────────────
    const opponentPrompt = `You are the Opponent agent in a CodeForge architectural debate.
Your job: find real flaws, risks, and edge cases in the following proposal. Be specific and technical.

Proposal: ${args.proposal}
Operation type: ${opType}${contextBlock}

Proponent argued: ${proponentArgument}

Respond with your strongest objections (3–5 sentences max). Focus on concrete risks: data loss, 
breaking changes, performance regressions, security issues, or architectural debt.
Do NOT agree with the proponent. You are finding problems.`;

    const { text: opponentArgument } = await callAIWithFallback(
      opponentPrompt,
      {
        model: await getModelForRole(ctx, "reviewer"),
        temperature: 0.4,
        callerPlan: byok?.callerPlan,
        userKeys: byok?.userKeys,
      },
    );

    // ── Round 3: Moderator ─────────────────────────────────────────────────
    // Verdict thresholds vary by operation type
    const thresholdNote =
      opType === "destructive" || opType === "architectural"
        ? "This is a HIGH-STAKES operation. Default to ESCALATE unless proponent's case is overwhelming."
        : opType === "bugfix" || opType === "style"
          ? "This is a LOW-RISK operation. Default to PROCEED unless opponent raises a concrete critical issue."
          : "Apply balanced judgment.";

    const moderatorPrompt = `You are the Moderator agent in a CodeForge architectural debate.
You have heard both sides. Your job: render a fair, evidence-based verdict.

Proposal: ${args.proposal}
Operation type: ${opType}
${thresholdNote}

Proponent argued: ${proponentArgument}

Opponent argued: ${opponentArgument}

You MUST respond with valid JSON only — no other text:
{
  "verdict": "PROCEED" | "REFINE" | "ESCALATE",
  "reasoning": "2–4 sentence explanation of your decision",
  "confidence": <integer 0-100>,
  "refinements": ["specific change 1", "specific change 2"],  // only if verdict=REFINE
  "escalationReason": "why human review is needed"             // only if verdict=ESCALATE
}

Verdict definitions:
- PROCEED: benefits clearly outweigh risks, safe to execute now
- REFINE: good idea but needs specific adjustments before execution
- ESCALATE: too risky, uncertain, or irreversible — requires human approval`;

    const { text: moderatorRaw } = await callAIWithFallback(moderatorPrompt, {
      model: await getModelForRole(ctx, "orchestrator"),
      temperature: 0.2,
      callerPlan: byok?.callerPlan,
      userKeys: byok?.userKeys,
    });

    // Parse moderator JSON
    let verdict: DebateVerdict = "ESCALATE";
    let moderatorReasoning = moderatorRaw;
    let refinements: string[] | undefined;
    let escalationReason: string | undefined;
    let confidence = 50;

    try {
      const jsonMatch =
        moderatorRaw.match(/```(?:json)?\s*([\s\S]*?)```/) ??
        moderatorRaw.match(/(\{[\s\S]*\})/);
      const parsed = JSON.parse(
        jsonMatch ? jsonMatch[1]! : moderatorRaw.trim(),
      );

      verdict = (
        ["PROCEED", "REFINE", "ESCALATE"].includes(parsed.verdict)
          ? parsed.verdict
          : "ESCALATE"
      ) as DebateVerdict;
      moderatorReasoning = parsed.reasoning ?? moderatorRaw;
      confidence = Math.min(100, Math.max(0, parsed.confidence ?? 50));
      if (parsed.refinements?.length) refinements = parsed.refinements;
      if (parsed.escalationReason) escalationReason = parsed.escalationReason;
    } catch {
      // JSON parse failed — default to ESCALATE (safe)
      verdict = "ESCALATE";
      escalationReason =
        "Moderator response could not be parsed — defaulting to human review.";
      confidence = 0;
    }

    const durationMs = Date.now() - startMs;

    // Persist the debate record
    const debateId = await ctx.runMutation(api.debate.saveDebate, {
      projectId: args.projectId,
      buildSessionId: args.buildSessionId,
      proposal: args.proposal,
      proponentArgument,
      opponentArgument,
      moderatorReasoning,
      verdict,
      refinements,
      escalationReason,
      confidence,
      durationMs,
    });

    // Broadcast to agent thought stream
    const verdictEmoji =
      verdict === "PROCEED" ? "✅" : verdict === "REFINE" ? "🔧" : "🚨";
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "debate-engine",
      agentName: "Debate Engine",
      type: "finding",
      content: `${verdictEmoji} Debate verdict: ${verdict} (${confidence}% confidence)\n${moderatorReasoning}`,
      isStreaming: false,
    });

    return {
      debateId,
      verdict,
      proponentArgument,
      opponentArgument,
      moderatorReasoning,
      refinements,
      escalationReason,
      confidence,
    };
  },
});

// ─── CONVENIENCE: requireDebate ────────────────────────────────────────────
// Wraps runDebate and throws if verdict is ESCALATE (pending human approval).
// Use this inside engine.ts before any destructive tool call.

export const requireDebate = action({
  args: {
    projectId: v.id("projects"),
    proposal: v.string(),
    context: v.optional(v.string()),
    operationType: v.optional(
      v.union(
        v.literal("architectural"),
        v.literal("destructive"),
        v.literal("refactor"),
        v.literal("feature"),
        v.literal("bugfix"),
        v.literal("style"),
      ),
    ),
  },
  returns: v.object({
    allowed: v.boolean(),
    verdict: v.union(
      v.literal("PROCEED"),
      v.literal("REFINE"),
      v.literal("ESCALATE"),
    ),
    debateId: v.id("debates"),
    message: v.string(),
    refinements: v.optional(v.array(v.string())),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    allowed: boolean;
    verdict: "PROCEED" | "REFINE" | "ESCALATE";
    debateId: Id<"debates">;
    message: string;
    refinements?: string[];
  }> => {
    const result = await ctx.runAction(api.debate.runDebate, {
      projectId: args.projectId,
      proposal: args.proposal,
      context: args.context,
      operationType: args.operationType,
    });

    if (result.verdict === "PROCEED") {
      return {
        allowed: true,
        verdict: "PROCEED" as const,
        debateId: result.debateId,
        message: `✅ Debate approved: ${result.moderatorReasoning}`,
      };
    }

    if (result.verdict === "REFINE") {
      return {
        allowed: false,
        verdict: "REFINE" as const,
        debateId: result.debateId,
        message: `🔧 Debate requires refinement: ${result.moderatorReasoning}`,
        refinements: result.refinements,
      };
    }

    // ESCALATE
    return {
      allowed: false,
      verdict: "ESCALATE" as const,
      debateId: result.debateId,
      message: `🚨 Escalated to human review: ${result.escalationReason ?? result.moderatorReasoning}`,
    };
  },
});
