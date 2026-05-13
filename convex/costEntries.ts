/**
 * COST ENTRIES — Per-call cost tracking
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";

export const log = mutation({
  args: {
    buildSessionId: v.optional(v.id("buildSessions")),
    model: v.string(),
    inputTokens: v.number(),
    outputTokens: v.number(),
    cost: v.number(),
    operation: v.string(),
  },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");
    await ctx.db.insert("costEntries", {
      userId,
      ...args,
    });
  },
});

export const getByUser = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return [];
    return await ctx.db
      .query("costEntries")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .order("desc")
      .take(100);
  },
});

export const getTotalCost = query({
  args: {},
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) return { totalCost: 0, totalEntries: 0 };
    const entries = await ctx.db
      .query("costEntries")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    return {
      totalCost: entries.reduce((sum, e) => sum + e.cost, 0),
      totalEntries: entries.length,
    };
  },
});
