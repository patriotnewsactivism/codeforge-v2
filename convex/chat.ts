import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";
import { callAIWithFallback, DEFAULT_MODEL, estimateCost, MODELS } from "./ai";

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

// ─── Session Management ──────────────────────────────────────────────────────

export const getOrCreateSession = mutation({
  args: { projectId: v.id("projects"), model: v.optional(v.string()) },
  returns: v.id("chatSessions"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const existing = await ctx.db
      .query("chatSessions")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .collect();

    const userSession = existing.find(
      s => s.userId === userId && !s.isArchived,
    );
    if (userSession) return userSession._id;

    return await ctx.db.insert("chatSessions", {
      projectId: args.projectId,
      userId,
      model: args.model ?? DEFAULT_MODEL,
      totalTokensUsed: 0,
      totalCost: 0,
      createdAt: Date.now(),
    });
  },
});

export const createSession = mutation({
  args: {
    projectId: v.id("projects"),
    title: v.optional(v.string()),
    model: v.optional(v.string()),
  },
  returns: v.id("chatSessions"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    return await ctx.db.insert("chatSessions", {
      projectId: args.projectId,
      userId,
      title: args.title ?? "New Chat",
      model: args.model ?? DEFAULT_MODEL,
      totalTokensUsed: 0,
      totalCost: 0,
      createdAt: Date.now(),
    });
  },
});

export const listSessions = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];

    const sessions = await ctx.db
      .query("chatSessions")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .collect();

    return sessions
      .filter(s => s.userId === userId && !s.isArchived)
      .sort((a, b) => {
        const bt = b.createdAt ?? b._creationTime;
        const at = a.createdAt ?? a._creationTime;
        // Tie-break on _creationTime so ordering is deterministic when two
        // sessions share the same createdAt millisecond.
        return bt !== at ? bt - at : b._creationTime - a._creationTime;
      });
  },
});

export const renameSession = mutation({
  args: { sessionId: v.id("chatSessions"), title: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId)
      throw new Error("Not your session");
    await ctx.db.patch(args.sessionId, { title: args.title });
    return null;
  },
});

export const deleteSession = mutation({
  args: { sessionId: v.id("chatSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId)
      throw new Error("Not your session");

    const messages = await ctx.db
      .query("chatMessages")
      .withIndex("by_session", q => q.eq("sessionId", args.sessionId))
      .collect();
    for (const msg of messages) await ctx.db.delete(msg._id);
    await ctx.db.delete(args.sessionId);
    return null;
  },
});

export const archiveSession = mutation({
  args: { sessionId: v.id("chatSessions") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    const session = await ctx.db.get(args.sessionId);
    if (!session || session.userId !== userId)
      throw new Error("Not your session");
    await ctx.db.patch(args.sessionId, { isArchived: true });
    return null;
  },
});

export const getSession = query({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args) => ctx.db.get(args.sessionId),
});

export const updateModel = mutation({
  args: { sessionId: v.id("chatSessions"), model: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.patch(args.sessionId, { model: args.model });
    return null;
  },
});

// ─── Messages ─────────────────────────────────────────────────────────────────

export const listMessages = query({
  args: { sessionId: v.id("chatSessions") },
  handler: async (ctx, args) =>
    ctx.db
      .query("chatMessages")
      .withIndex("by_session", q => q.eq("sessionId", args.sessionId))
      .collect(),
});

export const addMessage = mutation({
  args: {
    sessionId: v.id("chatSessions"),
    projectId: v.id("projects"),
    role: v.union(
      v.literal("user"),
      v.literal("assistant"),
      v.literal("system"),
    ),
    content: v.string(),
    model: v.optional(v.string()),
    tokensUsed: v.optional(v.number()),
    cost: v.optional(v.number()),
    isError: v.optional(v.boolean()),
    userId: v.optional(v.id("users")),
    fileContexts: v.optional(
      v.array(v.object({ path: v.string(), content: v.string() })),
    ),
  },
  returns: v.id("chatMessages"),
  handler: async (ctx, args) => {
    if (args.tokensUsed || args.cost) {
      const session = await ctx.db.get(args.sessionId);
      if (session) {
        await ctx.db.patch(args.sessionId, {
          totalTokensUsed: session.totalTokensUsed + (args.tokensUsed ?? 0),
          totalCost: session.totalCost + (args.cost ?? 0),
        });
      }
    }
    return await ctx.db.insert("chatMessages", {
      sessionId: args.sessionId,
      projectId: args.projectId,
      role: args.role,
      content: args.content,
      model: args.model,
      tokensUsed: args.tokensUsed,
      cost: args.cost,
      isError: args.isError,
      userId: args.userId,
      fileContexts: args.fileContexts,
    });
  },
});

// ─── AI Chat Action ───────────────────────────────────────────────────────────

export const sendMessage = action({
  args: {
    sessionId: v.id("chatSessions"),
    projectId: v.id("projects"),
    content: v.string(),
    model: v.string(),
    fileContext: v.optional(v.string()),
    fileContexts: v.optional(
      v.array(v.object({ path: v.string(), content: v.string() })),
    ),
    userId: v.id("users"),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    // Build file context string
    let combinedContext = "";
    if (args.fileContexts?.length) {
      combinedContext = args.fileContexts
        .map(f => `--- ${f.path} ---\n${f.content}`)
        .join("\n\n");
    } else if (args.fileContext) {
      combinedContext = args.fileContext;
    }

    // Usage gate
    try {
      const gate = await ctx.runQuery(api.limits.checkCanRun, {
        action: "ai_request",
      });
      if (!gate.allowed) {
        const hint = (gate as any).upgradeHint ?? "";
        throw new Error(`🚫 ${gate.reason}${hint ? ` ${hint}` : ""}`);
      }
    } catch (e) {
      if (e instanceof Error && e.message.startsWith("🚫")) throw e;
    }

    // Save user message
    await ctx.runMutation(api.chat.addMessage, {
      sessionId: args.sessionId,
      projectId: args.projectId,
      role: "user",
      content: args.content,
      userId: args.userId,
      fileContexts: args.fileContexts,
    });

    // ── BYOK: resolve caller plan + user keys ─────────────────────────────
    const byok = await resolveByok(ctx, String(args.userId));

    // ── SMART ROUTING ──────────────────────────────────────────────────────
    // Code-action keywords → dispatch to engine.runMission (full agent loop)
    // Questions/explanations → direct AI response (fast, cheap)
    const isCodeRequest =
      /\b(build|create|add|make|implement|fix|refactor|update|write|generate|change|edit|delete|remove|style|design|migrate|rename|move|replace|convert|upgrade|optimize|improve|debug|deploy)\b/i.test(
        args.content,
      );

    // ── PATH A: Direct AI (questions, explanations, reviews) ───────────────
    if (!isCodeRequest) {
      const systemPrompt =
        "You are CodeForge, an expert software engineer assistant. " +
        "Answer questions clearly and concisely. When reviewing code, be specific and actionable. " +
        "Format code blocks with proper syntax highlighting markers.";

      const userMessage = combinedContext
        ? `CONTEXT:\n${combinedContext.slice(0, 6000)}\n\nQUESTION: ${args.content}`
        : args.content;

      try {
        const { text: result, modelUsed } = await callAIWithFallback(
          userMessage,
          {
            model: args.model,
            systemPrompt,
            callerPlan: byok.callerPlan,
            userKeys: byok.userKeys,
          },
        );

        const inputEst = estimateCost(
          args.content + combinedContext,
          modelUsed,
          false,
        );
        const outputEst = estimateCost(result, modelUsed, true);

        await ctx.runMutation(api.chat.addMessage, {
          sessionId: args.sessionId,
          projectId: args.projectId,
          role: "assistant",
          content: result,
          model: modelUsed,
          tokensUsed: inputEst.tokens + outputEst.tokens,
          cost: inputEst.cost + outputEst.cost,
        });

        await ctx.runMutation(api.limits.trackUsage, {
          userId: String(args.userId),
          action: "ai_request",
          costUsd: inputEst.cost + outputEst.cost,
        });

        return result;
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : String(err);
        await ctx.runMutation(api.chat.addMessage, {
          sessionId: args.sessionId,
          projectId: args.projectId,
          role: "assistant",
          content: `❌ AI error: ${errMsg}`,
          isError: true,
        });
        throw err;
      }
    }

    // ── PATH B: Agent mission (build/fix/create requests) ──────────────────
    try {
      const missionGate = await ctx.runQuery(api.limits.checkCanRun, {
        action: "start_mission",
      });
      if (!missionGate.allowed) {
        const hint = (missionGate as any).upgradeHint ?? "";
        const msg = `🚫 ${missionGate.reason}${hint ? ` ${hint}` : ""}`;
        await ctx.runMutation(api.chat.addMessage, {
          sessionId: args.sessionId,
          projectId: args.projectId,
          role: "assistant",
          content: msg,
          isError: true,
        });
        return msg;
      }

      await ctx.runMutation(api.limits.trackUsage, {
        userId: String(args.userId),
        action: "start_mission",
      });

      // Fire off the agent engine
      const result: string = await ctx.runAction(api.engine.runMission, {
        projectId: args.projectId,
        prompt: args.content,
        model: args.model,
      });

      const summary = `✅ Mission complete.\n\n${result}`;

      await ctx.runMutation(api.chat.addMessage, {
        sessionId: args.sessionId,
        projectId: args.projectId,
        role: "assistant",
        content: summary,
        model: args.model,
      });

      return summary;
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await ctx.runMutation(api.chat.addMessage, {
        sessionId: args.sessionId,
        projectId: args.projectId,
        role: "assistant",
        content: `❌ Mission failed: ${errMsg}`,
        isError: true,
      });
      throw err;
    }
  },
});

// ─── Model list (for frontend model picker) ───────────────────────────────────

export const listModels = query({
  args: {},
  handler: async _ctx => {
    return Object.values(MODELS).map(m => ({
      id: m.id,
      name: m.name,
      tier: m.tier,
      inputCostPer1M: m.inputCostPer1M,
      outputCostPer1M: m.outputCostPer1M,
    }));
  },
});
