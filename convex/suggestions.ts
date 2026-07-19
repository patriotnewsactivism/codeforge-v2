import { getAuthUserId } from "@convex-dev/auth/server";
import { v, ConvexError } from "convex/values";
import { api, internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { callAIWithFallback } from "./ai";

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

declare const process: { env: Record<string, string | undefined> };

async function callAI(
  prompt: string,
  options?: {
    model?: string;
    maxTokens?: number;
    callerPlan?: string;
    userKeys?: Record<string, string>;
  },
) {
  return await callAIWithFallback(prompt, {
    model: options?.model,
    maxTokens: options?.maxTokens,
    callerPlan: options?.callerPlan,
    userKeys: options?.userKeys,
  });
}

// ─── QUERIES ─────────────────────────────────────────────────────────────────

export const listByProject = query({
  args: { projectId: v.id("projects") },
  returns: v.array(
    v.object({
      _id: v.id("suggestions"),
      _creationTime: v.number(),
      projectId: v.id("projects"),
      title: v.string(),
      description: v.string(),
      category: v.string(),
      priority: v.union(
        v.literal("high"),
        v.literal("medium"),
        v.literal("low"),
      ),
      status: v.union(
        v.literal("pending"),
        v.literal("implementing"),
        v.literal("done"),
        v.literal("dismissed"),
      ),
      implementationPrompt: v.string(),
      generatedAt: v.number(),
      impactScore: v.optional(v.number()),
      autoApproved: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("suggestions")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .collect();
  },
});

export const listPending = query({
  args: { projectId: v.id("projects") },
  returns: v.array(
    v.object({
      _id: v.id("suggestions"),
      _creationTime: v.number(),
      projectId: v.id("projects"),
      title: v.string(),
      description: v.string(),
      category: v.string(),
      priority: v.union(
        v.literal("high"),
        v.literal("medium"),
        v.literal("low"),
      ),
      status: v.union(
        v.literal("pending"),
        v.literal("implementing"),
        v.literal("done"),
        v.literal("dismissed"),
      ),
      implementationPrompt: v.string(),
      generatedAt: v.number(),
      impactScore: v.optional(v.number()),
      autoApproved: v.optional(v.boolean()),
    }),
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("suggestions")
      .withIndex("by_project_and_status", q =>
        q.eq("projectId", args.projectId).eq("status", "pending"),
      )
      .order("desc")
      .collect();
  },
});

export const getAutonomousMode = query({
  args: { projectId: v.id("projects") },
  returns: v.union(
    v.object({
      _id: v.id("projectSettings"),
      _creationTime: v.number(),
      projectId: v.id("projects"),
      autonomousMode: v.boolean(),
      autonomousLevel: v.optional(v.string()),
      autoIntervalMinutes: v.number(),
      lastAutoRunAt: v.optional(v.number()),
      projectSoul: v.optional(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    return await ctx.db
      .query("projectSettings")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .unique();
  },
});

// ─── MUTATIONS ────────────────────────────────────────────────────────────────

export const updateStatus = mutation({
  args: {
    suggestionId: v.id("suggestions"),
    status: v.union(
      v.literal("pending"),
      v.literal("implementing"),
      v.literal("done"),
      v.literal("dismissed"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.patch(args.suggestionId, { status: args.status });
    return null;
  },
});

export const addSuggestion = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    priority: v.union(v.literal("high"), v.literal("medium"), v.literal("low")),
    implementationPrompt: v.string(),
    impactScore: v.optional(v.number()),
    autoApproved: v.optional(v.boolean()),
  },
  returns: v.union(v.id("suggestions"), v.null()),
  handler: async (ctx, args) => {
    // DB-level dedup: skip if a suggestion with the same title already exists
    // (regardless of status) to prevent duplicates across multiple generate runs
    const existing = await ctx.db
      .query("suggestions")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .collect();
    const normalised = args.title.toLowerCase().trim();
    const dupe = existing.find(
      s => s.title.toLowerCase().trim() === normalised,
    );
    if (dupe) return null; // already exists, skip silently
    return await ctx.db.insert("suggestions", {
      ...args,
      status: "pending",
      generatedAt: Date.now(),
    });
  },
});

export const setAutonomousMode = mutation({
  args: {
    projectId: v.id("projects"),
    autonomousMode: v.boolean(),
    autonomousLevel: v.optional(v.string()),
    autoIntervalMinutes: v.optional(v.number()),
    projectSoul: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("projectSettings")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .unique();

    if (existing) {
      await ctx.db.patch(existing._id, {
        autonomousMode: args.autonomousMode,
        autonomousLevel:
          (args as any).autonomousLevel ?? (existing as any).autonomousLevel,
        autoIntervalMinutes:
          args.autoIntervalMinutes ?? existing.autoIntervalMinutes,
        projectSoul: args.projectSoul ?? existing.projectSoul,
      });
    } else {
      await ctx.db.insert("projectSettings", {
        projectId: args.projectId,
        autonomousMode: args.autonomousMode,
        autonomousLevel: args.autonomousLevel ?? "autonomous",
        autoIntervalMinutes: args.autoIntervalMinutes ?? 15,
        projectSoul: args.projectSoul,
        lastAutoRunAt: undefined,
      });
    }
    return null;
  },
});

export const markAutoRunAt = mutation({
  args: { projectId: v.id("projects") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projectSettings")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { lastAutoRunAt: Date.now() });
    }
    return null;
  },
});

// ─── INTERNAL (no-auth, used by scheduled jobs / cron) ───────────────────────

export const updateStatusInternal = internalMutation({
  args: {
    suggestionId: v.id("suggestions"),
    status: v.union(
      v.literal("pending"),
      v.literal("implementing"),
      v.literal("done"),
      v.literal("dismissed"),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch(args.suggestionId, { status: args.status });
    return null;
  },
});

export const markAutoRunAtInternal = internalMutation({
  args: { projectId: v.id("projects") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("projectSettings")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .unique();
    if (existing) {
      await ctx.db.patch(existing._id, { lastAutoRunAt: Date.now() });
    }
    return null;
  },
});

export const getAllAutonomousProjects = internalQuery({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("projectSettings"),
      _creationTime: v.number(),
      projectId: v.id("projects"),
      autonomousMode: v.boolean(),
      autonomousLevel: v.optional(v.string()),
      autoIntervalMinutes: v.number(),
      lastAutoRunAt: v.optional(v.number()),
      projectSoul: v.optional(v.string()),
    }),
  ),
  handler: async ctx => {
    return await ctx.db
      .query("projectSettings")
      .filter(q => q.eq(q.field("autonomousMode"), true))
      .collect();
  },
});

// ─── ACTIONS ─────────────────────────────────────────────────────────────────

// Proactive analysis: scan the project, generate smart ranked suggestions
// Never proposes something already done or dismissed
export const generateSuggestions = action({
  args: { projectId: v.id("projects") },
  returns: v.number(),
  handler: async (ctx, args) => {
    const files = await ctx.runQuery(api.files.listByProject, {
      projectId: args.projectId,
    });
    const existing = await ctx.runQuery(api.suggestions.listByProject, {
      projectId: args.projectId,
    });
    const settings = await ctx.runQuery(api.suggestions.getAutonomousMode, {
      projectId: args.projectId,
    });

    // Collect implemented + dismissed so we never re-suggest them
    const blocklist = new Set(
      existing
        .filter((s: any) => s.status === "done" || s.status === "dismissed")
        .map((s: any) => s.title.toLowerCase()),
    );
    const pendingTitles = existing
      .filter((s: any) => s.status === "pending" || s.status === "implementing")
      .map((s: any) => s.title);

    const fileSummary = files
      .filter((f: any) => !f.isDirectory)
      .map((f: any) => `--- ${f.path} ---\n${f.content.slice(0, 800)}`)
      .join("\n\n");

    const soulSection = settings?.projectSoul
      ? `\nCORE PROJECT SOUL (NEVER VIOLATE):\n${settings.projectSoul}\n`
      : "";

    const prompt = `You are a senior product engineer analyzing a codebase to suggest the next best improvements.

${soulSection}
PROJECT FILES:
${fileSummary}

Already implemented (do NOT re-suggest): ${[...blocklist].join(", ") || "none"}
Already queued (do NOT re-suggest): ${pendingTitles.join(", ") || "none"}

Your job: suggest 4-6 high-impact improvements that would make this project genuinely better.
Rules:
- NEVER suggest removing or replacing core features — only additions and enhancements
- Rank by user value, not complexity
- Be specific — each implementationPrompt must be a complete instruction set an agent can execute
- Consider: UX polish, missing features, mobile experience, performance, error states, empty states, accessibility
- impactScore: 1-10 (10 = highest impact to users)

Return ONLY a JSON array (no markdown, no code fences):
[
  {
    "title": "Short feature name",
    "description": "One sentence describing what it does and why users will love it",
    "category": "ui|functionality|performance|ux|security|mobile",
    "priority": "high|medium|low",
    "impactScore": 8,
    "implementationPrompt": "Full, detailed instructions for an AI agent to implement this. Include which files to modify, what the behavior should be, edge cases to handle."
  }
]`;

    try {
      const byok = await resolveByok(ctx);
      const aiResponse = await callAI(prompt, { maxTokens: 4000, ...byok });
      const text = aiResponse.text;
      // Log cost entry if we got usage data
      if (aiResponse.usage) {
        // DeepSeek V3 via OpenRouter pricing: $0.28/M input, $1.14/M output
        const inputCost = (aiResponse.usage.promptTokens / 1_000_000) * 0.28;
        const outputCost =
          (aiResponse.usage.completionTokens / 1_000_000) * 1.14;
        await ctx.runMutation(api.costEntries.log, {
          model: "deepseek/deepseek-chat",
          inputTokens: aiResponse.usage.promptTokens,
          outputTokens: aiResponse.usage.completionTokens,
          cost: inputCost + outputCost,
          operation: "generate_suggestions",
        });
      }
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (!jsonMatch) return 0;

      const suggestions = JSON.parse(jsonMatch[0]) as Array<{
        title: string;
        description: string;
        category: string;
        priority: string;
        impactScore?: number;
        implementationPrompt: string;
      }>;

      let added = 0;
      for (const s of suggestions) {
        if (blocklist.has(s.title.toLowerCase())) continue;
        const priority = (
          ["high", "medium", "low"].includes(s.priority) ? s.priority : "medium"
        ) as "high" | "medium" | "low";
        const category = [
          "ui",
          "functionality",
          "performance",
          "ux",
          "security",
          "mobile",
        ].includes(s.category)
          ? s.category
          : "functionality";
        const impactScore =
          typeof s.impactScore === "number" ? s.impactScore : 5;
        const newId = await ctx.runMutation(api.suggestions.addSuggestion, {
          projectId: args.projectId,
          title: s.title,
          description: s.description,
          category,
          priority,
          implementationPrompt: s.implementationPrompt,
          impactScore,
          autoApproved: isLowRisk({ priority, impactScore, category }),
        });
        if (newId !== null) added++;
      }
      return added;
    } catch (e) {
      console.error("generateSuggestions failed:", e);
      return 0;
    }
  },
});

// One-click implement: marks as implementing then fires the full agent swarm
export const implementSuggestion = action({
  args: {
    projectId: v.id("projects"),
    suggestionId: v.id("suggestions"),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    // Get the suggestion
    const suggestion: any = await ctx
      .runQuery(api.suggestions.listByProject, {
        projectId: args.projectId,
      })
      .then(list => list.find((s: any) => s._id === args.suggestionId));

    if (!suggestion) throw new Error("Suggestion not found");

    // Mark as implementing
    await ctx.runMutation(api.suggestions.updateStatus, {
      suggestionId: args.suggestionId,
      status: "implementing",
    });

    // Get project soul (if set) and inject into agent prompt
    const settings = await ctx.runQuery(api.suggestions.getAutonomousMode, {
      projectId: args.projectId,
    });

    const soulGuard: string = settings?.projectSoul
      ? `\n\nCRITICAL: This project has a core soul/identity. Do NOT violate it:\n${settings.projectSoul}\n`
      : "";

    const enrichedPrompt = `${suggestion.implementationPrompt}${soulGuard}

IMPORTANT: This is an additive improvement. Do NOT remove or break any existing functionality. Only add to what's already there.`;

    try {
      const result: string = await ctx.runAction(api.agents.runMultiAgent, {
        projectId: args.projectId,
        prompt: enrichedPrompt,
      });

      await ctx.runMutation(api.suggestions.updateStatus, {
        suggestionId: args.suggestionId,
        status: "done",
      });

      return result;
    } catch (e) {
      await ctx.runMutation(api.suggestions.updateStatus, {
        suggestionId: args.suggestionId,
        status: "pending",
      });
      // Re-throw as ConvexError so the real failure reason reaches the
      // client instead of Convex's generic sanitized "Server Error" message
      // (plain Error/exceptions thrown from actions get their details
      // stripped in production; only ConvexError payloads pass through).
      const message = e instanceof Error ? e.message : String(e);
      throw new ConvexError(`implementSuggestion failed: ${message}`);
    }
  },
});

/**
 * Classifies whether a suggestion is safe to build without human approval.
 *
 * Low-risk  = additive, contained changes (low/medium priority, modest impact).
 * High-risk = anything high priority, high impact, or touching security —
 *             these are held for human approval unless the project is in
 *             "full" autonomous mode.
 */
export function isLowRisk(suggestion: {
  priority?: string;
  impactScore?: number;
  category?: string;
}): boolean {
  if (suggestion.priority === "high") return false;
  if ((suggestion.impactScore ?? 5) >= 8) return false;
  if (suggestion.category === "security") return false;
  return true;
}

// Autonomous build cycle: picks the top pending suggestion and builds it
// Called by a scheduled job when autonomousMode is ON
//
// autonomousLevel gates how aggressive the cycle is (values match the UI
// selector in AgentActivityPanel):
//   "manual" / "suggest" → never auto-builds (autonomousMode is off here)
//   "apply" / "autonomous" → auto-builds only low-risk suggestions; high-risk
//                items are left pending for human approval (the default)
//   "autopilot" → full autonomy: auto-builds the single highest-value
//                suggestion regardless of risk
const FULL_AUTONOMY_LEVEL = "autopilot";
const NON_BUILDING_LEVELS = new Set(["suggest"]);

// Floor on how often any single project may auto-run, regardless of the
// autoIntervalMinutes it stores. Prevents a misconfigured project from
// triggering a cycle on every tick and running up compute/quota.
const MIN_AUTO_INTERVAL_MINUTES = 10;

// Global cap on how many cycles a single tick may launch. Bounds the agent
// fan-out (and therefore cost/quota) even when many projects come due at once;
// the rest simply wait for the next tick.
const MAX_CYCLES_PER_TICK = 3;

// Cron tick: called every 5 minutes, fires runAutonomousCycleInternal for each
// project whose interval has elapsed (up to MAX_CYCLES_PER_TICK per tick). Uses
// the scheduler so each project runs independently and errors in one don't
// block others.
export const tickAutonomousCycles = internalAction({
  args: {},
  returns: v.null(),
  handler: async (ctx): Promise<null> => {
    const activeProjects = await ctx.runQuery(
      internal.suggestions.getAllAutonomousProjects,
      {},
    );
    const now = Date.now();

    let launched = 0;
    for (const settings of activeProjects) {
      if (launched >= MAX_CYCLES_PER_TICK) break;

      const level = settings.autonomousLevel ?? "autonomous";
      if (level === "manual" || level === "suggest") continue;

      const requestedMinutes = settings.autoIntervalMinutes ?? 15;
      const effectiveMinutes = Math.max(
        requestedMinutes,
        MIN_AUTO_INTERVAL_MINUTES,
      );
      const intervalMs = effectiveMinutes * 60 * 1000;
      const lastRun = settings.lastAutoRunAt ?? 0;

      if (now - lastRun >= intervalMs) {
        await ctx.scheduler.runAfter(
          0,
          internal.suggestions.runAutonomousCycleInternal,
          { projectId: settings.projectId },
        );
        launched++;
      }
    }

    return null;
  },
});

// Internal version of runAutonomousCycle — uses internal mutations so it
// works from the cron context where no user auth is available.
export const runAutonomousCycleInternal = internalAction({
  args: { projectId: v.id("projects") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const settings = await ctx.runQuery(api.suggestions.getAutonomousMode, {
      projectId: args.projectId,
    });

    if (!settings?.autonomousMode) return "Autonomous mode is off — skipping";

    const level = settings.autonomousLevel ?? "autonomous";
    if (NON_BUILDING_LEVELS.has(level)) {
      return `Autonomous level is "${level}" — generating ideas only, not auto-building`;
    }
    const fullAutonomy = level === FULL_AUTONOMY_LEVEL;

    const pending = await ctx.runQuery(api.suggestions.listPending, {
      projectId: args.projectId,
    });

    if (pending.length < 3) {
      await ctx.runAction(api.suggestions.generateSuggestions, {
        projectId: args.projectId,
      });
    }

    const freshPending: any[] = await ctx.runQuery(
      api.suggestions.listPending,
      {
        projectId: args.projectId,
      },
    );

    if (freshPending.length === 0) return "No pending suggestions to implement";

    const eligible = fullAutonomy
      ? freshPending
      : freshPending.filter((s: any) => isLowRisk(s));

    if (eligible.length === 0) {
      return `${freshPending.length} suggestion(s) awaiting approval — none are low-risk enough to auto-build at this level. Switch to Full Autopilot or approve one manually.`;
    }

    const priorityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const top = eligible.sort((a: any, b: any) => {
      const scoreA = (a.impactScore ?? 5) + (priorityRank[a.priority] ?? 1) * 2;
      const scoreB = (b.impactScore ?? 5) + (priorityRank[b.priority] ?? 1) * 2;
      return scoreB - scoreA;
    })[0];

    if (!top) return "No suggestion to implement";

    await ctx.runMutation(internal.suggestions.markAutoRunAtInternal, {
      projectId: args.projectId,
    });

    await ctx.runMutation(internal.suggestions.updateStatusInternal, {
      suggestionId: top._id,
      status: "implementing",
    });

    const soulGuard: string = settings.projectSoul
      ? `\n\nCRITICAL: This project has a core soul/identity. Do NOT violate it:\n${settings.projectSoul}\n`
      : "";

    const enrichedPrompt = `${top.implementationPrompt}${soulGuard}

IMPORTANT: This is an additive improvement. Do NOT remove or break any existing functionality. Only add to what's already there.`;

    try {
      const result: string = await ctx.runAction(api.agents.runMultiAgent, {
        projectId: args.projectId,
        prompt: enrichedPrompt,
      });

      await ctx.runMutation(internal.suggestions.updateStatusInternal, {
        suggestionId: top._id,
        status: "done",
      });

      await ctx.runAction(api.suggestions.generateSuggestions, {
        projectId: args.projectId,
      });

      return `Built: "${top.title}" — ${result}`;
    } catch (e) {
      await ctx.runMutation(internal.suggestions.updateStatusInternal, {
        suggestionId: top._id,
        status: "pending",
      });
      throw e;
    }
  },
});

export const runAutonomousCycle = action({
  args: { projectId: v.id("projects") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    const settings = await ctx.runQuery(api.suggestions.getAutonomousMode, {
      projectId: args.projectId,
    });

    if (!settings?.autonomousMode) {
      return "Autonomous mode is off — skipping";
    }

    const level = settings.autonomousLevel ?? "autonomous";
    if (NON_BUILDING_LEVELS.has(level)) {
      return `Autonomous level is "${level}" — generating ideas only, not auto-building`;
    }
    const fullAutonomy = level === FULL_AUTONOMY_LEVEL;

    // 1. Generate fresh suggestions if we have fewer than 3 pending
    const pending = await ctx.runQuery(api.suggestions.listPending, {
      projectId: args.projectId,
    });

    if (pending.length < 3) {
      await ctx.runAction(api.suggestions.generateSuggestions, {
        projectId: args.projectId,
      });
    }

    // 2. Pick the top suggestion (highest impactScore, then highest priority)
    const freshPending: any[] = await ctx.runQuery(
      api.suggestions.listPending,
      {
        projectId: args.projectId,
      },
    );

    if (freshPending.length === 0) {
      return "No pending suggestions to implement";
    }

    // Unless in full autopilot, only low-risk suggestions are eligible for
    // auto-build; high-risk ones stay pending until a human approves them.
    const eligible = fullAutonomy
      ? freshPending
      : freshPending.filter((s: any) => isLowRisk(s));

    if (eligible.length === 0) {
      const heldBack = freshPending.length;
      return `${heldBack} suggestion(s) awaiting approval — none are low-risk enough to auto-build at this level. Switch to Full Autopilot or approve one manually.`;
    }

    const priorityRank: Record<string, number> = { high: 3, medium: 2, low: 1 };
    const top = eligible.sort((a: any, b: any) => {
      const scoreA = (a.impactScore ?? 5) + (priorityRank[a.priority] ?? 1) * 2;
      const scoreB = (b.impactScore ?? 5) + (priorityRank[b.priority] ?? 1) * 2;
      return scoreB - scoreA;
    })[0];

    if (!top) return "No suggestion to implement";

    // 3. Build it
    await ctx.runMutation(api.suggestions.markAutoRunAt, {
      projectId: args.projectId,
    });

    const result: string = await ctx.runAction(
      api.suggestions.implementSuggestion,
      {
        projectId: args.projectId,
        suggestionId: top._id,
      },
    );

    // 4. Immediately generate more suggestions to keep the queue full
    await ctx.runAction(api.suggestions.generateSuggestions, {
      projectId: args.projectId,
    });

    return `Built: "${top.title}" — ${result}`;
  },
});
