/**
 * benchmark.ts — Agent vs Agent Benchmarks
 *
 * Pit two different model assignments against the same task.
 * Score output quality, speed, cost, sentry violations, and debate outcomes.
 * The Strategist uses results to auto-tune model assignments.
 *
 * A benchmark run:
 *   1. Takes a task description + two model configs (A vs B)
 *   2. Runs both through the same prompt in parallel
 *   3. A third "Judge" agent (strong model) scores both outputs blind
 *   4. Results stored — Strategist can query "which model wins at coding?"
 */

import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import { callAIWithFallback } from "./ai";

// ─── BYOK: Resolve caller plan + API keys ────────────────────────────────────
// Lifetime users get their stored keys injected into AI calls.
// Weekly/monthly/free users use platform process.env keys (no userKeys passed).
async function resolveByok(
  ctx: any,
  userId?: string
): Promise<{ callerPlan: string; userKeys?: Record<string, string> }> {
  try {
    const sub = await ctx.runQuery(api.limits.getMyLimits, {});
    const callerPlan: string = sub?.plan ?? "free";
    if (callerPlan !== "lifetime") return { callerPlan };
    if (!userId) return { callerPlan };

    const userKeys: Record<string, string> = await ctx.runQuery(
      api.apiKeys.getAllKeysForUser,
      { userId }
    );
    if (!userKeys || Object.keys(userKeys).length === 0) {
      throw new Error(
        "⚠️ Lifetime plan requires your own API key. " +
          "Add one in Settings → API Keys to use AI features."
      );
    }
    return { callerPlan, userKeys };
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("⚠️")) throw err;
    return { callerPlan: "free" };
  }
}



// ─── DB ──────────────────────────────────────────────────────────────────────

export const saveBenchmark = mutation({
  args: {
    projectId: v.id("projects"),
    taskDescription: v.string(),
    agentRole: v.string(),
    modelA: v.string(),
    modelB: v.string(),
    outputA: v.string(),
    outputB: v.string(),
    scoreA: v.number(),
    scoreB: v.number(),
    winner: v.union(v.literal("A"), v.literal("B"), v.literal("tie")),
    judgeReasoning: v.string(),
    latencyAMs: v.number(),
    latencyBMs: v.number(),
    tokensA: v.optional(v.number()),
    tokensB: v.optional(v.number()),
    dimensions: v.object({
      correctness: v.object({ a: v.number(), b: v.number() }),
      codeQuality: v.object({ a: v.number(), b: v.number() }),
      conciseness: v.object({ a: v.number(), b: v.number() }),
      followsInstructions: v.object({ a: v.number(), b: v.number() }),
    }),
  },
  returns: v.id("benchmarkRuns"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("benchmarkRuns", {
      ...args,
      timestamp: Date.now(),
    });
  },
});

export const listBenchmarks = query({
  args: {
    projectId: v.id("projects"),
    agentRole: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("benchmarkRuns")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(args.limit ?? 50);
    if (args.agentRole) return all.filter((b) => b.agentRole === args.agentRole);
    return all;
  },
});

export const getModelLeaderboard = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("benchmarkRuns")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();

    // Aggregate wins per model per role
    const stats: Record<string, Record<string, { wins: number; losses: number; ties: number; avgScore: number; runs: number }>> = {};

    for (const run of all) {
      for (const [model, side] of [[run.modelA, "A"], [run.modelB, "B"]] as const) {
        if (!stats[run.agentRole]) stats[run.agentRole] = {};
        if (!stats[run.agentRole][model]) {
          stats[run.agentRole][model] = { wins: 0, losses: 0, ties: 0, avgScore: 0, runs: 0 };
        }
        const s = stats[run.agentRole][model];
        s.runs++;
        const score = side === "A" ? run.scoreA : run.scoreB;
        s.avgScore = (s.avgScore * (s.runs - 1) + score) / s.runs;
        if (run.winner === "tie") s.ties++;
        else if (run.winner === side) s.wins++;
        else s.losses++;
      }
    }

    return stats;
  },
});

// ─── CORE ACTION: runBenchmark ────────────────────────────────────────────────

export const runBenchmark = action({
  args: {
    projectId: v.id("projects"),
    agentRole: v.string(),
    taskDescription: v.string(),
    systemPrompt: v.string(),
    modelA: v.string(),
    modelB: v.string(),
  },
  returns: v.object({
    benchmarkId: v.id("benchmarkRuns"),
    winner: v.union(v.literal("A"), v.literal("B"), v.literal("tie")),
    scoreA: v.number(),
    scoreB: v.number(),
    judgeReasoning: v.string(),
    recommendation: v.string(),
  }),
  handler: async (ctx, args) => {
    const fullPrompt = `${args.systemPrompt}\n\nTask: ${args.taskDescription}`;

    // Run A and B in "parallel" (sequential in Convex, but fast enough)
    const startA = Date.now();
    // BYOK: resolve caller plan + keys for lifetime users
    const byok = await resolveByok(ctx);
    const { text: outputA, usage: usageA } = await callAIWithFallback(fullPrompt, {
      model: args.modelA,
      temperature: 0.3,
      callerPlan: byok?.callerPlan,
      userKeys: byok?.userKeys,
    });
    const latencyAMs = Date.now() - startA;

    const startB = Date.now();
    const { text: outputB, usage: usageB } = await callAIWithFallback(fullPrompt, {
      model: args.modelB,
      temperature: 0.3,
      callerPlan: byok?.callerPlan,
      userKeys: byok?.userKeys,
    });
    const latencyBMs = Date.now() - startB;

    // Judge: blind scoring (doesn't know which is A or B)
    const judgePrompt = `You are a blind judge evaluating two AI coding agent outputs for the same task.
You do NOT know which model produced which output.

Task: ${args.taskDescription}
Agent role: ${args.agentRole}

=== OUTPUT 1 ===
${outputA.slice(0, 3000)}

=== OUTPUT 2 ===
${outputB.slice(0, 3000)}

Score each output on 4 dimensions (1-10):
- correctness: Does it correctly solve the task?
- codeQuality: Is the code clean, idiomatic, well-structured?
- conciseness: Is it appropriately brief without being incomplete?
- followsInstructions: Did it stay on task without adding unrequested things?

JSON only:
{
  "output1": {
    "correctness": <1-10>,
    "codeQuality": <1-10>,
    "conciseness": <1-10>,
    "followsInstructions": <1-10>,
    "overall": <1-10>
  },
  "output2": {
    "correctness": <1-10>,
    "codeQuality": <1-10>,
    "conciseness": <1-10>,
    "followsInstructions": <1-10>,
    "overall": <1-10>
  },
  "winner": "output1" | "output2" | "tie",
  "reasoning": "2-3 sentence explanation of why the winner is better"
}`;

    const { text: judgeRaw } = await callAIWithFallback(judgePrompt, {
      model: "grok-4",   // always use strong model as judge
      temperature: 0.1,
      callerPlan: byok?.callerPlan,
      userKeys: byok?.userKeys,
    });

    let scoreA = 5, scoreB = 5;
    let winner: "A" | "B" | "tie" = "tie";
    let judgeReasoning = judgeRaw;
    let dimensions = {
      correctness: { a: 5, b: 5 },
      codeQuality: { a: 5, b: 5 },
      conciseness: { a: 5, b: 5 },
      followsInstructions: { a: 5, b: 5 },
    };

    try {
      const jsonMatch = judgeRaw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? judgeRaw.match(/(\{[\s\S]*\})/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[1]! : judgeRaw.trim());
      scoreA = parsed.output1?.overall ?? 5;
      scoreB = parsed.output2?.overall ?? 5;
      winner = parsed.winner === "output1" ? "A" : parsed.winner === "output2" ? "B" : "tie";
      judgeReasoning = parsed.reasoning ?? judgeRaw;
      dimensions = {
        correctness: { a: parsed.output1?.correctness ?? 5, b: parsed.output2?.correctness ?? 5 },
        codeQuality: { a: parsed.output1?.codeQuality ?? 5, b: parsed.output2?.codeQuality ?? 5 },
        conciseness: { a: parsed.output1?.conciseness ?? 5, b: parsed.output2?.conciseness ?? 5 },
        followsInstructions: { a: parsed.output1?.followsInstructions ?? 5, b: parsed.output2?.followsInstructions ?? 5 },
      };
    } catch { /* use defaults */ }

    const benchmarkId = await ctx.runMutation(api.benchmark.saveBenchmark, {
      projectId: args.projectId,
      taskDescription: args.taskDescription,
      agentRole: args.agentRole,
      modelA: args.modelA,
      modelB: args.modelB,
      outputA: outputA.slice(0, 5000),
      outputB: outputB.slice(0, 5000),
      scoreA,
      scoreB,
      winner,
      judgeReasoning,
      latencyAMs,
      latencyBMs,
      tokensA: usageA?.totalTokens,
      tokensB: usageB?.totalTokens,
      dimensions,
    });

    const winnerModel = winner === "A" ? args.modelA : winner === "B" ? args.modelB : null;
    const recommendation = winnerModel
      ? `Use ${winnerModel} for ${args.agentRole} (scored ${winner === "A" ? scoreA : scoreB}/10 vs ${winner === "A" ? scoreB : scoreA}/10)`
      : `Both models are equivalent for ${args.agentRole} — keep current assignment`;

    // Broadcast
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "benchmark-runner",
      agentName: "⚔️ Benchmark",
      type: "finding",
      content: `Benchmark [${args.agentRole}]: ${args.modelA} (${scoreA}) vs ${args.modelB} (${scoreB}) → ${winner === "tie" ? "TIE" : `${winnerModel} wins`}\n${recommendation}`,
      isStreaming: false,
    });

    return { benchmarkId, winner, scoreA, scoreB, judgeReasoning, recommendation };
  },
});




