import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { MODEL_PROFILES, MODELS } from "./ai";

export const deleteAccount = mutation({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) {
      throw new Error("Not authenticated");
    }

    const authAccounts = await ctx.db
      .query("authAccounts")
      .filter(q => q.eq(q.field("userId"), userId))
      .collect();
    for (const account of authAccounts) {
      await ctx.db.delete(account._id);
    }

    const authSessions = await ctx.db
      .query("authSessions")
      .filter(q => q.eq(q.field("userId"), userId))
      .collect();
    for (const session of authSessions) {
      await ctx.db.delete(session._id);
    }

    await ctx.db.delete(userId);

    return { success: true };
  },
});

export const completeOnboarding = mutation({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.patch(userId, { onboarded: true });
  },
});

export const getProfile = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return null;
    return await ctx.db.get(userId);
  },
});

export const updateAiProfile = mutation({
  args: { aiProfile: v.string() },
  handler: async (ctx, { aiProfile }) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.patch(userId, { aiProfile });
    return { success: true };
  },
});

export const getAiProfileInternal = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return "dons_pick";
    const user = await ctx.db.get(userId);
    return user?.aiProfile ?? "dons_pick";
  },
});

// Real live model roster for the Mission Control "Model roster" panel --
// reflects the user's ACTUAL selected swarm profile (e.g. dons_pick),
// not a hardcoded snapshot. Replaces a static mock array that still showed
// the old Viktor's Pick roster (DeepSeek/Cerebras/Mistral) after the
// profile was switched to Don's Pick (Qwen Max + Qwen3 Coder Plus).
export const getModelRoster = query({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx);
    let profile = "dons_pick";
    if (userId) {
      const user = await ctx.db.get(userId);
      profile = user?.aiProfile ?? "dons_pick";
    }
    const map = MODEL_PROFILES[profile] ?? MODEL_PROFILES.dons_pick;
    const roleKeys: Array<{ role: string; key: string }> = [
      { role: "Orchestrator", key: "orchestrator" },
      { role: "Coder", key: "coder" },
      { role: "Reviewer", key: "reviewer" },
      { role: "Debugger", key: "debugger" },
    ];
    return roleKeys.map(({ role, key }) => {
      const modelId = map[key] ?? map.default;
      const catalog = MODELS[modelId];
      const inputCost = catalog?.inputCostPer1M ?? 0;
      const isFree = inputCost === 0;
      return {
        role,
        model: catalog?.name ?? modelId,
        provider: catalog?.provider ?? "unknown",
        badge: isFree ? "\ud83d\udfe2 Free" : "\ud83d\udcb2 Cheap",
        isFree,
      };
    });
  },
});
