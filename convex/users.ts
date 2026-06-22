import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

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
    if (!userId) return "viktor";
    const user = await ctx.db.get(userId);
    return user?.aiProfile ?? "viktor";
  },
});
