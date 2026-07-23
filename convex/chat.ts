import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { api, internal } from "./_generated/api";
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

/**
 * Determines if a user message is an imperative code-action request (should
 * trigger an agent mission) vs. a question/explanation (direct AI response).
 *
 * Rules:
 * 1. Explicit `@build` or `/build` prefix always triggers a mission.
 * 2. Messages starting with question words (how, what, why, explain, etc.)
 *    are always direct AI — even if they contain action verbs like "build".
 * 3. Short messages (<6 words) with action verbs are missions.
 * 4. Longer messages need both an action verb AND lack question patterns.
 */
function shouldTriggerMission(content: string): boolean {
  const trimmed = content.trim();

  // Explicit triggers
  if (/^[@/]build\b/i.test(trimmed)) return true;
  if (/^[@/]agent\b/i.test(trimmed)) return true;

  // Question patterns — always direct AI
  const questionPatterns =
    /^(how|what|why|where|when|which|who|can you|could you|would you|should i|is it|is there|are there|does|do|explain|tell me|describe|show me|help me understand|i('m| am) (confused|wondering|curious|unsure|not sure))/i;
  if (questionPatterns.test(trimmed)) return false;

  // Action verb detection
  const actionVerbs =
    /\b(build|create|add|make|implement|fix|refactor|update|write|generate|change|edit|delete|remove|style|design|migrate|rename|move|replace|convert|upgrade|optimize|improve|debug|deploy|set up|setup|install|configure|scaffold|wire up|connect|integrate)\b/i;
  const hasActionVerb = actionVerbs.test(trimmed);

  if (!hasActionVerb) return false;

  // If it ends with a question mark, it's a question
  if (trimmed.endsWith("?")) return false;

  return true;
}

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
    // Build file context string from open files
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

    // ── Fetch conversation history ────────────────────────────────────────
    const allMessages = await ctx.runQuery(api.chat.listMessages, {
      sessionId: args.sessionId,
    });
    // Keep last 20 messages for context (10 exchanges)
    const recentMessages = (allMessages ?? []).slice(-20);

    // ── Fetch ALL project files for context (truncated) ───────────────────
    const projectFiles = await ctx.runQuery(api.files.listByProject, {
      projectId: args.projectId,
    });
    const codeFiles = projectFiles.filter((f: any) => !f.isDirectory);
    // Build truncated project overview: full content for small files, first
    // 300 chars for larger ones. Cap total at ~8000 chars.
    let projectContext = "";
    let charBudget = 8000;
    for (const f of codeFiles) {
      if (charBudget <= 0) break;
      const content = f.content ?? "";
      const truncated =
        content.length <= 500 ? content : content.slice(0, 300) + "\n// ...";
      const entry = `--- ${f.path} ---\n${truncated}\n\n`;
      projectContext += entry;
      charBudget -= entry.length;
    }

    // ── SMART ROUTING ──────────────────────────────────────────────────────
    const isCodeRequest = shouldTriggerMission(args.content);

    // ── PATH A: Direct AI (questions, explanations, reviews) ───────────────
    if (!isCodeRequest) {
      const systemPrompt =
        `You are CodeForge AI, an expert software engineer assistant embedded in a web-based IDE. ` +
        `You help developers understand, debug, and improve their code. ` +
        `Answer questions clearly and concisely. Use markdown formatting with proper syntax-highlighted code blocks. ` +
        `When reviewing code, be specific and actionable — suggest exact code changes. ` +
        `You have full access to the user's project files listed below.\n\n` +
        `PROJECT FILES:\n${projectContext}`;

      // Build a proper messages array with conversation history
      const messages: {
        role: "system" | "user" | "assistant";
        content: string;
      }[] = [{ role: "system", content: systemPrompt }];

      // Add conversation history (excluding the current message which we just added)
      for (const msg of recentMessages.slice(0, -1)) {
        if (msg.role === "user" || msg.role === "assistant") {
          messages.push({
            role: msg.role,
            content: msg.content.slice(0, 2000), // Truncate long messages
          });
        }
      }

      // Add the current user message with any open-file context
      const userMessage = combinedContext
        ? `CURRENTLY OPEN FILES:\n${combinedContext.slice(0, 6000)}\n\nUSER MESSAGE: ${args.content}`
        : args.content;
      messages.push({ role: "user", content: userMessage });

      try {
        const { text: result, modelUsed } = await callAIWithFallback(messages, {
          model: args.model,
          callerPlan: byok.callerPlan,
          userKeys: byok.userKeys,
        });

        const inputEst = estimateCost(
          args.content + combinedContext + projectContext,
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

      // Notify the user that a mission is starting
      await ctx.runMutation(api.chat.addMessage, {
        sessionId: args.sessionId,
        projectId: args.projectId,
        role: "assistant",
        content: `🚀 **Starting agent mission...**\n\nI'm launching an AI agent to work on: *${args.content.slice(0, 100)}*\n\nYou can watch progress in the **Activity** panel. I'll post a summary here when it's done.`,
      });

      // Strip @build / /build prefix before sending to engine
      const cleanPrompt = args.content
        .replace(/^[@/](build|agent)\s*/i, "")
        .trim();

      // Fire off the agent engine
      const result: string = await ctx.runAction(api.engine.runMission, {
        projectId: args.projectId,
        prompt: cleanPrompt,
        model: args.model,
      });

      // Build a structured summary
      const toolCalls = await ctx.runQuery(api.engine.listToolCalls, {
        projectId: args.projectId,
        limit: 50,
      });
      const recentCalls = (toolCalls ?? []).slice(-30);
      const filesCreated = new Set<string>();
      const filesEdited = new Set<string>();
      const filesDeleted = new Set<string>();
      for (const tc of recentCalls) {
        try {
          const parsedArgs = JSON.parse(tc.args);
          if (tc.tool === "create_file" && parsedArgs.path)
            filesCreated.add(parsedArgs.path);
          if (tc.tool === "edit_file" && parsedArgs.path)
            filesEdited.add(parsedArgs.path);
          if (tc.tool === "delete_file" && parsedArgs.path)
            filesDeleted.add(parsedArgs.path);
        } catch {
          /* ignore parse errors */
        }
      }

      let summary = `✅ **Mission complete!**\n\n${result}`;
      if (filesCreated.size > 0) {
        summary += `\n\n**Files created:** ${[...filesCreated].map(f => `\`${f}\``).join(", ")}`;
      }
      if (filesEdited.size > 0) {
        summary += `\n\n**Files modified:** ${[...filesEdited].map(f => `\`${f}\``).join(", ")}`;
      }
      if (filesDeleted.size > 0) {
        summary += `\n\n**Files deleted:** ${[...filesDeleted].map(f => `\`${f}\``).join(", ")}`;
      }

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
        content: `❌ **Mission failed:** ${errMsg}`,
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
