/**
 * autoLearn.ts — Immediate Post-Build Learning Extraction
 *
 * Ported from Autonomous-Coder and adapted for Convex.
 *
 * Unlike the Reflection Agent (which runs nightly), AutoLearn runs
 * immediately after every completed build session. It:
 *   1. Analyzes what happened in the build (agents, scores, files, heal cycles)
 *   2. Extracts 4 types of knowledge:
 *      - Patterns: what worked (stack choices, code patterns, architectures)
 *      - Anti-patterns: what failed (avoid this approach for this type of goal)
 *      - Shortcuts: reusable snippets / boilerplate that consistently score well
 *      - Meta-insights: which agents perform best for which categories of task
 *   3. Stores all learnings as agentMemories for immediate injection into
 *      the next build — no waiting for the nightly reflection cycle
 *
 * Also provides getSmartContext() which injects accumulated wisdom into
 * any agent's prompt before it runs.
 */

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import { internalAction, query } from "./_generated/server";
import { callAIWithFallback, getModelForRole } from "./ai";

declare const process: { env: Record<string, string | undefined> };

// ─── BYOK resolver (same pattern as other CodeForge modules) ────────────────

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

// ─── Extract & Store Learnings ──────────────────────────────────────────────

const EXTRACT_LEARNINGS_PROMPT = `You are a meta-learning AI. Analyze this completed build and extract
high-value, generalizable knowledge that will help future builds succeed faster.

Focus on:
- What stack / architecture choices made this succeed?
- What code patterns appeared in the best-scoring files?
- What should be avoided for similar goals in the future?
- Which agent performed best and why?

OUTPUT JSON (no markdown, no extra text):
{
  "patterns": ["Pattern 1: description", "Pattern 2: description"],
  "antiPatterns": ["Avoid X when building Y because Z"],
  "shortcuts": ["Reusable snippet or boilerplate description"],
  "metaInsights": ["Agent X worked best here because...", "This type of goal always needs..."],
  "qualityScore": 8
}`;

export const extractLearnings = internalAction({
  args: {
    projectId: v.id("projects"),
    missionId: v.optional(v.string()),
    buildSessionId: v.optional(v.id("buildSessions")),
    goal: v.string(),
    agentSequence: v.array(v.string()),
    filesChanged: v.array(v.string()),
    healCycles: v.number(),
    success: v.boolean(),
  },
  handler: async (ctx, args): Promise<void> => {
    const { callerPlan, userKeys } = await resolveByok(ctx);

    const model = await getModelForRole(ctx, "reflection");

    try {
      const userMessage = `GOAL: ${args.goal}
AGENTS USED: ${args.agentSequence.join(" → ")}
FILES CHANGED: ${args.filesChanged.join(", ")}
HEAL CYCLES: ${args.healCycles}
SUCCESS: ${args.success}`;

      const { text: content } = await callAIWithFallback(
        [
          { role: "system", content: EXTRACT_LEARNINGS_PROMPT },
          { role: "user", content: userMessage },
        ],
        {
          model,
          callerPlan,
          userKeys,
        },
      );

      // Parse the JSON response
      let learnings: any;
      try {
        const cleaned = content
          .replace(/```json\n?/g, "")
          .replace(/```/g, "")
          .trim();
        learnings = JSON.parse(cleaned);
      } catch {
        console.log("[autoLearn] Failed to parse AI response, skipping");
        return;
      }

      // Store patterns as memories
      const stores: Array<{
        category: string;
        content: string;
        importance: number;
      }> = [];

      for (const p of learnings.patterns ?? []) {
        stores.push({ category: "pattern", content: p, importance: 0.8 });
      }
      for (const p of learnings.antiPatterns ?? []) {
        stores.push({
          category: "anti_pattern",
          content: `ANTI-PATTERN: ${p}`,
          importance: 0.9,
        });
      }
      for (const p of learnings.shortcuts ?? []) {
        stores.push({
          category: "tool",
          content: `SHORTCUT: ${p}`,
          importance: 0.7,
        });
      }
      for (const p of learnings.metaInsights ?? []) {
        stores.push({ category: "insight", content: p, importance: 0.75 });
      }

      // Persist all learnings
      for (const entry of stores) {
        await ctx.runMutation(api.memory.saveMemory, {
          projectId: args.projectId,
          category: entry.category as any,
          content: entry.content,
          importance: entry.importance,
        });
      }

      console.log(
        `[autoLearn] Stored ${stores.length} learnings for build session`,
      );
    } catch (e) {
      console.error("[autoLearn] Failed to extract learnings:", e);
    }
  },
});

// ─── Smart Context Injection ────────────────────────────────────────────────
// Call this before every agent run to give them accumulated wisdom

export const getSmartContext = internalAction({
  args: {
    projectId: v.id("projects"),
    goal: v.string(),
    agentRole: v.optional(v.string()),
    maxMemories: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<string> => {
    try {
      const max = args.maxMemories ?? 12;

      // Fetch memories sorted by importance, then cap to maxMemories so the
      // injected context stays bounded regardless of how many are stored.
      const allMemories = await ctx.runQuery(
        api.intelligence.getActiveMemories,
        {
          projectId: args.projectId,
        },
      );

      if (!allMemories || allMemories.length === 0) return "";

      const memories = allMemories.slice(0, max);

      // Categorize
      const patterns = memories
        .filter((m: any) => m.category === "pattern")
        .slice(0, 4);
      const antiPatterns = memories
        .filter((m: any) => m.category === "anti_pattern")
        .slice(0, 3);
      const insights = memories
        .filter(
          (m: any) =>
            m.category === "insight" ||
            m.category === "tool" ||
            m.category === "skill",
        )
        .slice(0, 3);

      if (
        patterns.length === 0 &&
        antiPatterns.length === 0 &&
        insights.length === 0
      )
        return "";

      const lines = ["\n\n━━━ ACCUMULATED BUILD WISDOM ━━━"];
      if (patterns.length > 0) {
        lines.push("\n✓ PROVEN PATTERNS (apply these):");
        for (const p of patterns) lines.push(`  • ${p.content}`);
      }
      if (antiPatterns.length > 0) {
        lines.push("\n✗ KNOWN FAILURES (avoid these):");
        for (const f of antiPatterns) lines.push(`  • ${f.content}`);
      }
      if (insights.length > 0) {
        lines.push("\n💡 META INSIGHTS:");
        for (const m of insights) lines.push(`  • ${m.content}`);
      }
      lines.push("━━━ END WISDOM ━━━\n");
      return lines.join("\n");
    } catch {
      return "";
    }
  },
});

// ─── Query: list recent learnings for the UI ────────────────────────────────

export const listRecentLearnings = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const memories = await ctx.db
      .query("agentMemories")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .take(args.limit ?? 20);

    return memories.filter(
      m =>
        m.category === "pattern" ||
        m.category === "anti_pattern" ||
        m.category === "insight" ||
        m.category === "tool" ||
        m.category === "skill",
    );
  },
});
