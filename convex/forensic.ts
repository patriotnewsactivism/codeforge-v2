/**
 * forensic.ts — CodeForge Forensic Agent
 *
 * Layer 4 of the Learning Loop: Root cause analysis.
 *
 * Triggered when:
 *   - A mission fails or produces low-quality output
 *   - An agent loop errors out or hits a tool call violation
 *   - CI fails on a deployment
 *   - A Sentry violation of severity "high" or "critical" is logged
 *
 * Flow:
 *   1. Collect all tool calls, agent thoughts, errors from the failed run
 *   2. Identify the root cause (model failure, bad prompt, wrong tool, logic error)
 *   3. Classify the failure type
 *   4. Propose a concrete mutation (prompt patch, tool restriction, retry strategy)
 *   5. Write a ForensicReport and feed it to the Mutation Engine
 */

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
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
      internal.apiKeys.getAllKeysForUser,
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

// ─── TYPES ──────────────────────────────────────────────────────────────────

export type FailureClass =
  | "prompt_failure" // agent misunderstood its instructions
  | "model_failure" // model returned garbage / hallucinated
  | "tool_failure" // tool returned error or unexpected result
  | "logic_error" // agent took wrong sequence of actions
  | "scope_creep" // agent did more than instructed
  | "context_overflow" // agent lost track of context mid-run
  | "sentry_violation" // attempted a disallowed operation
  | "ci_failure" // code passed agents but failed CI
  | "unknown";

export interface ForensicReport {
  missionId: string;
  failureClass: FailureClass;
  rootCause: string;
  evidenceQuotes: string[]; // exact quotes from tool calls / thoughts that prove it
  proposedMutation: string; // what should change to prevent this
  mutationTarget:
    | "prompt"
    | "tool_policy"
    | "retry_strategy"
    | "model_assignment"
    | "none";
  severity: "low" | "medium" | "high" | "critical";
  confidence: number; // 0–100
}

// ─── DB ──────────────────────────────────────────────────────────────────────

export const saveReport = mutation({
  args: {
    projectId: v.id("projects"),
    missionId: v.optional(v.id("buildSessions")),
    buildSessionId: v.optional(v.id("buildSessions")),
    failureClass: v.string(),
    rootCause: v.string(),
    evidenceQuotes: v.array(v.string()),
    proposedMutation: v.string(),
    mutationTarget: v.union(
      v.literal("prompt"),
      v.literal("tool_policy"),
      v.literal("retry_strategy"),
      v.literal("model_assignment"),
      v.literal("none"),
    ),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    confidence: v.number(),
    appliedAt: v.optional(v.number()),
  },
  returns: v.id("forensicReports"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("forensicReports", {
      ...args,
      timestamp: Date.now(),
      mutationApplied: false,
    });
  },
});

export const markMutationApplied = mutation({
  args: { reportId: v.id("forensicReports") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.reportId, {
      mutationApplied: true,
      appliedAt: Date.now(),
    });
    return null;
  },
});

export const listReports = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
    unappliedOnly: v.optional(v.boolean()),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("forensicReports")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .take(args.limit ?? 50);
    if (args.unappliedOnly) return all.filter(r => !r.mutationApplied);
    return all;
  },
});

export const getReport = query({
  args: { reportId: v.id("forensicReports") },
  handler: async (ctx, args) => ctx.db.get(args.reportId),
});

// ─── CORE ACTION: runForensicAnalysis ────────────────────────────────────────

export const runForensicAnalysis = action({
  args: {
    projectId: v.id("projects"),
    missionId: v.optional(v.id("buildSessions")),
    buildSessionId: v.optional(v.id("buildSessions")),
    // Provide as much evidence as available
    failureSummary: v.string(), // human-readable description of what went wrong
    agentThoughts: v.optional(v.array(v.string())), // recent thought stream entries
    toolCallErrors: v.optional(v.array(v.string())), // tool call error messages
    sentryViolations: v.optional(v.array(v.string())), // sentry violation details
    ciLogs: v.optional(v.string()), // CI failure output
    agentsInvolved: v.optional(v.array(v.string())),
  },
  returns: v.object({
    reportId: v.id("forensicReports"),
    failureClass: v.string(),
    rootCause: v.string(),
    proposedMutation: v.string(),
    mutationTarget: v.string(),
    severity: v.string(),
    confidence: v.number(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    reportId: any;
    failureClass: string;
    rootCause: string;
    proposedMutation: string;
    mutationTarget: string;
    severity: string;
    confidence: number;
  }> => {
    // Build evidence block
    const thoughtsBlock = args.agentThoughts?.length
      ? `\nAgent thoughts (recent):\n${args.agentThoughts
          .slice(-10)
          .map(t => `  - ${t}`)
          .join("\n")}`
      : "";
    const errorsBlock = args.toolCallErrors?.length
      ? `\nTool call errors:\n${args.toolCallErrors
          .slice(-10)
          .map(e => `  - ${e}`)
          .join("\n")}`
      : "";
    const sentryBlock = args.sentryViolations?.length
      ? `\nSentry violations:\n${args.sentryViolations.map(v => `  - ${v}`).join("\n")}`
      : "";
    const ciBlock = args.ciLogs
      ? `\nCI logs (tail):\n${args.ciLogs.slice(-2000)}`
      : "";
    const agentsBlock = args.agentsInvolved?.length
      ? `\nAgents involved: ${args.agentsInvolved.join(", ")}`
      : "";

    const prompt = `You are the Forensic Agent in CodeForge — an autonomous coding platform.
A mission has failed. Your job: perform root cause analysis and propose a concrete fix.

FAILURE SUMMARY:
${args.failureSummary}
${agentsBlock}${thoughtsBlock}${errorsBlock}${sentryBlock}${ciBlock}

Failure classes:
- prompt_failure: agent misunderstood its instructions
- model_failure: model hallucinated or returned garbage output
- tool_failure: a tool call errored or returned unexpected data
- logic_error: agent took the wrong sequence of actions
- scope_creep: agent did more than instructed (added unrequested features, edited wrong files)
- context_overflow: agent lost track of what it was doing mid-run
- sentry_violation: agent attempted a disallowed operation
- ci_failure: code looked OK but failed CI/tests
- unknown: cannot determine

Mutation targets:
- prompt: change the system prompt for a specific agent role
- tool_policy: tighten/loosen what tools an agent role can access
- retry_strategy: change how we retry after this type of failure
- model_assignment: assign a different model to this agent role
- none: the failure is environmental / one-off, no mutation needed

Respond with JSON only:
{
  "failureClass": "<one of the classes above>",
  "rootCause": "1-2 sentence precise root cause",
  "evidenceQuotes": ["quote from evidence 1", "quote 2"],
  "proposedMutation": "Specific, actionable change. E.g.: 'Add to Coder system prompt: always read existing files before creating new ones'",
  "mutationTarget": "<one of the targets above>",
  "severity": "low" | "medium" | "high" | "critical",
  "confidence": <0-100>
}`;

    // BYOK: resolve caller plan + keys for lifetime users
    const byok = await resolveByok(ctx);
    const { text: raw } = await callAIWithFallback(prompt, {
      model: await getModelForRole(ctx, "orchestrator"), // Strong model — forensic needs deep reasoning
      temperature: 0.2,
      callerPlan: byok?.callerPlan,
      userKeys: byok?.userKeys,
    });

    // Parse
    let report: ForensicReport = {
      missionId: args.missionId ?? "unknown",
      failureClass: "unknown",
      rootCause: raw,
      evidenceQuotes: [],
      proposedMutation: "Manual review required.",
      mutationTarget: "none",
      severity: "medium",
      confidence: 0,
    };

    try {
      const jsonMatch =
        raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[1]! : raw.trim());
      report = {
        missionId: args.missionId ?? "unknown",
        failureClass: parsed.failureClass ?? "unknown",
        rootCause: parsed.rootCause ?? raw,
        evidenceQuotes: parsed.evidenceQuotes ?? [],
        proposedMutation: parsed.proposedMutation ?? "No mutation proposed.",
        mutationTarget: parsed.mutationTarget ?? "none",
        severity: parsed.severity ?? "medium",
        confidence: Math.min(100, Math.max(0, parsed.confidence ?? 0)),
      };
    } catch {
      /* use defaults */
    }

    const reportId: any = await ctx.runMutation(api.forensic.saveReport, {
      projectId: args.projectId,
      missionId: args.missionId,
      buildSessionId: args.buildSessionId,
      failureClass: report.failureClass,
      rootCause: report.rootCause,
      evidenceQuotes: report.evidenceQuotes,
      proposedMutation: report.proposedMutation,
      mutationTarget: report.mutationTarget as any,
      severity: report.severity as any,
      confidence: report.confidence,
    });

    // Broadcast finding
    const severityEmoji =
      report.severity === "critical"
        ? "🔴"
        : report.severity === "high"
          ? "🟠"
          : report.severity === "medium"
            ? "🟡"
            : "🟢";

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "forensic-agent",
      agentName: "🔍 Forensic",
      type: "finding",
      content: `${severityEmoji} Root cause: ${report.failureClass} — ${report.rootCause}\n💡 Proposed: ${report.proposedMutation}`,
      isStreaming: false,
    });

    // Auto-feed to mutation engine if high/critical and not "none"
    if (
      (report.severity === "high" || report.severity === "critical") &&
      report.mutationTarget !== "none"
    ) {
      await ctx.runAction(api.mutation.applyMutation, {
        projectId: args.projectId,
        reportId,
        proposedMutation: report.proposedMutation,
        mutationTarget: report.mutationTarget as any,
        severity: report.severity as any,
        autoApply: false, // always queue for Reflection to approve first
      });
    }

    return {
      reportId,
      failureClass: report.failureClass,
      rootCause: report.rootCause,
      proposedMutation: report.proposedMutation,
      mutationTarget: report.mutationTarget,
      severity: report.severity,
      confidence: report.confidence,
    };
  },
});
