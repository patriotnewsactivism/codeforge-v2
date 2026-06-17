/**
 * crossProject.ts — Cross-Project Intelligence
 *
 * Memories, bug patterns, and lessons don't stay siloed per project.
 * A fix discovered in Project A surfaces as a warning in Project B
 * when the same anti-pattern appears.
 *
 * How it works:
 *   - globalInsights table stores canonicalized patterns across all projects
 *   - After every Reflection session, extractGlobalInsights() distills
 *     project-level lessons into global ones
 *   - When agents start a new mission, injectCrossProjectContext() injects
 *     the top matching global insights into the system prompt
 *   - matchAntiPatterns() scans new file content and warns if known bad
 *     patterns from other projects are detected
 */

import { v } from "convex/values";
import { api } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";
import { callAIWithFallback, getModelForRole } from "./ai";

// ─── MUTATIONS & QUERIES ─────────────────────────────────────────────────────

export const upsertGlobalInsight = mutation({
  args: {
    userId: v.id("users"),
    pattern: v.string(), // canonical short description
    detail: v.string(), // full explanation
    insightType: v.union(
      v.literal("anti_pattern"), // something that breaks
      v.literal("best_practice"), // something that works well
      v.literal("architecture"), // structural insight
      v.literal("gotcha"), // subtle footgun
      v.literal("performance"), // perf pattern
      v.literal("security"), // security insight
    ),
    exampleCode: v.optional(v.string()),
    occurrenceCount: v.number(),
    projectIds: v.array(v.string()), // which projects this came from
    confidence: v.number(), // 0-100
    tags: v.array(v.string()), // e.g. ["react", "typescript", "convex"]
  },
  returns: v.id("globalInsights"),
  handler: async (ctx, args) => {
    // Check if identical pattern already exists
    const existing = await ctx.db
      .query("globalInsights")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .filter(q => q.eq(q.field("pattern"), args.pattern))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        occurrenceCount: existing.occurrenceCount + args.occurrenceCount,
        projectIds: [...new Set([...existing.projectIds, ...args.projectIds])],
        confidence: Math.min(
          100,
          Math.round((existing.confidence + args.confidence) / 2),
        ),
        updatedAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("globalInsights", {
      ...args,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    });
  },
});

export const listGlobalInsights = query({
  args: {
    userId: v.id("users"),
    insightType: v.optional(
      v.union(
        v.literal("anti_pattern"),
        v.literal("best_practice"),
        v.literal("architecture"),
        v.literal("gotcha"),
        v.literal("performance"),
        v.literal("security"),
      ),
    ),
    minConfidence: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let all = await ctx.db
      .query("globalInsights")
      .withIndex("by_user", q => q.eq("userId", args.userId))
      .collect();

    if (args.insightType)
      all = all.filter(i => i.insightType === args.insightType);
    if (args.minConfidence)
      all = all.filter(i => i.confidence >= args.minConfidence!);
    all.sort((a, b) => b.occurrenceCount - a.occurrenceCount);
    return all.slice(0, args.limit ?? 50);
  },
});

// ─── ACTION: extractGlobalInsights ───────────────────────────────────────────
// Called after each Reflection session. Distills project memories into global patterns.

export const extractGlobalInsights = action({
  args: {
    projectId: v.id("projects"),
    userId: v.id("users"),
    recentLessons: v.array(v.string()), // from Reflection session
  },
  returns: v.object({ extracted: v.number() }),
  handler: async (ctx, args) => {
    if (!args.recentLessons.length) return { extracted: 0 };

    // Load the project's existing memories for context
    const memories = await ctx.runQuery(api.memory.listMemories, {
      projectId: args.projectId,
      limit: 20,
    });

    const memoryBlock = memories
      .map((m: any) => `[${m.category}] ${m.content}`)
      .join("\n");

    const prompt = `You are the Cross-Project Intelligence system in CodeForge.
Your job: take project-specific lessons and canonicalize them into universal programming patterns
that would apply across ANY project, not just this one.

Recent lessons from this project:
${args.recentLessons.map(l => `- ${l}`).join("\n")}

Project memories for context:
${memoryBlock}

For each lesson that is UNIVERSAL (applies to any project), produce a global insight.
Skip lessons that are project-specific (specific file names, domain logic, etc.)

Output JSON array (may be empty if nothing is universal):
[
  {
    "pattern": "Short canonical title (under 10 words)",
    "detail": "Full explanation of the pattern/anti-pattern",
    "insightType": "anti_pattern" | "best_practice" | "architecture" | "gotcha" | "performance" | "security",
    "exampleCode": "optional short code snippet illustrating the pattern",
    "confidence": <50-95>,
    "tags": ["tag1", "tag2"]
  }
]

JSON only, no other text.`;

    const { text: raw } = await callAIWithFallback(prompt, {
      model: getModelForRole("reviewer"),
      temperature: 0.3,
    });

    let insights: Array<{
      pattern: string;
      detail: string;
      insightType: string;
      exampleCode?: string;
      confidence: number;
      tags: string[];
    }> = [];

    try {
      const jsonMatch =
        raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\[[\s\S]*\])/);
      insights = JSON.parse(jsonMatch ? jsonMatch[1]! : raw.trim());
    } catch {
      return { extracted: 0 };
    }

    let extracted = 0;
    for (const insight of insights) {
      await ctx.runMutation(api.crossProject.upsertGlobalInsight, {
        userId: args.userId,
        pattern: insight.pattern,
        detail: insight.detail,
        insightType: insight.insightType as any,
        exampleCode: insight.exampleCode,
        occurrenceCount: 1,
        projectIds: [args.projectId],
        confidence: insight.confidence ?? 70,
        tags: insight.tags ?? [],
      });
      extracted++;
    }

    return { extracted };
  },
});

// ─── ACTION: injectCrossProjectContext ────────────────────────────────────────
// Called at mission start. Returns top insights to inject into agent system prompts.

export const injectCrossProjectContext = action({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    taskDescription: v.string(),
    techStack: v.optional(v.array(v.string())), // ["react", "typescript", "convex"]
  },
  returns: v.object({
    injectedInsights: v.array(v.string()),
    warningCount: v.number(),
  }),
  handler: async (ctx, args) => {
    const allInsights = await ctx.runQuery(
      api.crossProject.listGlobalInsights,
      {
        userId: args.userId,
        minConfidence: 60,
        limit: 100,
      },
    );

    if (!allInsights.length) return { injectedInsights: [], warningCount: 0 };

    // Filter by tag relevance to tech stack
    const stack = args.techStack ?? [];
    const relevant = allInsights.filter(
      (i: any) =>
        !stack.length ||
        i.tags.some((t: any) =>
          stack.some((s: any) => s.toLowerCase().includes(t.toLowerCase())),
        ),
    );

    // Score by occurrenceCount * confidence
    const ranked = relevant
      .sort(
        (a: any, b: any) =>
          b.occurrenceCount * b.confidence - a.occurrenceCount * a.confidence,
      )
      .slice(0, 8);

    const warnings = ranked.filter(
      (i: any) =>
        i.insightType === "anti_pattern" ||
        i.insightType === "gotcha" ||
        i.insightType === "security",
    );
    const bestPractices = ranked.filter(
      (i: any) =>
        i.insightType === "best_practice" || i.insightType === "architecture",
    );

    const injectedInsights = [
      ...warnings.map(
        (i: any) =>
          `⚠️ KNOWN PITFALL (seen in ${i.occurrenceCount} project${i.occurrenceCount > 1 ? "s" : ""}): ${i.pattern} — ${i.detail}`,
      ),
      ...bestPractices.map(
        (i: any) => `✅ PROVEN PATTERN: ${i.pattern} — ${i.detail}`,
      ),
    ];

    return {
      injectedInsights,
      warningCount: warnings.length,
    };
  },
});

// ─── ACTION: matchAntiPatterns ────────────────────────────────────────────────
// Called when an agent writes a file. Scans content for known anti-patterns.

export const matchAntiPatterns = action({
  args: {
    userId: v.id("users"),
    projectId: v.id("projects"),
    filePath: v.string(),
    fileContent: v.string(),
  },
  returns: v.object({
    matches: v.array(
      v.object({
        pattern: v.string(),
        detail: v.string(),
        severity: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const antiPatterns = await ctx.runQuery(
      api.crossProject.listGlobalInsights,
      {
        userId: args.userId,
        insightType: "anti_pattern",
        minConfidence: 70,
        limit: 30,
      },
    );

    if (!antiPatterns.length) return { matches: [] };

    const prompt = `You are the Cross-Project Intelligence anti-pattern scanner.
Given a file and a list of known anti-patterns, identify which (if any) are present.

File: ${args.filePath}
Content (first 3000 chars):
${args.fileContent.slice(0, 3000)}

Known anti-patterns:
${antiPatterns.map((p: any, i: number) => `[${i + 1}] ${p.pattern}: ${p.detail}${p.exampleCode ? "\nExample: " + p.exampleCode : ""}`).join("\n\n")}

List ONLY the anti-patterns that are CLEARLY present in this file.
JSON array (empty if none found):
[{ "index": <1-based>, "explanation": "why this applies here" }]`;

    const { text: raw } = await callAIWithFallback(prompt, {
      model: getModelForRole("reviewer"),
      temperature: 0.1,
    });

    let matchedIndexes: Array<{ index: number; explanation: string }> = [];
    try {
      const jsonMatch =
        raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\[[\s\S]*\])/);
      matchedIndexes = JSON.parse(jsonMatch ? jsonMatch[1]! : raw.trim());
    } catch {
      return { matches: [] };
    }

    const matches = matchedIndexes
      .filter(m => m.index >= 1 && m.index <= antiPatterns.length)
      .map(m => ({
        pattern: antiPatterns[m.index - 1].pattern,
        detail: `${antiPatterns[m.index - 1].detail} (${m.explanation})`,
        severity:
          antiPatterns[m.index - 1].insightType === "security"
            ? "critical"
            : "warning",
      }));

    return { matches };
  },
});
