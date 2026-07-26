/**
 * INTELLIGENCE LAYER — Queries for agent memories, retrospectives, missions
 * Adapted for v2 table names: agentMemories, taskRetrospectives, agentTasks, toolCalls
 */
import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

// ─── MEMORIES ─────────────────────────────────────────────────────

export const listMemories = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query("agentMemories")
      .withIndex("by_project", q => q.eq("projectId", projectId))
      .order("desc")
      .take(100);
  },
});

export const getActiveMemories = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query("agentMemories")
      .withIndex("by_project", q => q.eq("projectId", projectId))
      .order("desc")
      .take(50);
  },
});

export const deleteMemory = mutation({
  args: { memoryId: v.id("agentMemories") },
  handler: async (ctx, { memoryId }) => {
    await ctx.db.delete(memoryId);
  },
});

// ─── RETROSPECTIVES ───────────────────────────────────────────────

export const listRetrospectives = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query("taskRetrospectives")
      .withIndex("by_project", q => q.eq("projectId", projectId))
      .order("desc")
      .take(20);
  },
});

// ─── AGENT RUNS / TASKS ───────────────────────────────────────────

export const listAgentTasks = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query("agentTasks")
      .withIndex("by_project", q => q.eq("projectId", projectId))
      .order("desc")
      .take(50);
  },
});

// ─── TOOL CALLS ───────────────────────────────────────────────────

export const listToolCalls = query({
  args: { missionId: v.string() },
  handler: async (ctx, { missionId }) => {
    return await ctx.db
      .query("toolCalls")
      .withIndex("by_mission", q => q.eq("missionId", missionId))
      .order("asc")
      .take(200);
  },
});

// ─── AGENT THOUGHTS ───────────────────────────────────────────────

export const listThoughts = query({
  args: {
    projectId: v.id("projects"),
    buildSessionId: v.optional(v.id("buildSessions")),
  },
  handler: async (ctx, { projectId, buildSessionId }) => {
    if (buildSessionId) {
      return await ctx.db
        .query("agentThoughts")
        .withIndex("by_build_session", q =>
          q.eq("buildSessionId", buildSessionId),
        )
        .order("asc")
        .take(100);
    }
    return await ctx.db
      .query("agentThoughts")
      .withIndex("by_project", q => q.eq("projectId", projectId))
      .order("desc")
      .take(50);
  },
});

// ─── AGENT MESSAGES (INTER-AGENT COMMS) ──────────────────────────

export const listAgentMessages = query({
  args: {
    projectId: v.id("projects"),
    buildSessionId: v.optional(v.id("buildSessions")),
  },
  handler: async (ctx, { projectId, buildSessionId }) => {
    if (buildSessionId) {
      return await ctx.db
        .query("agentMessages")
        .withIndex("by_build_session", q =>
          q.eq("buildSessionId", buildSessionId),
        )
        .order("asc")
        .take(100);
    }
    return await ctx.db
      .query("agentMessages")
      .withIndex("by_project", q => q.eq("projectId", projectId))
      .order("desc")
      .take(50);
  },
});

// ─── BUILD SESSIONS ───────────────────────────────────────────────

export const listBuildSessions = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    return await ctx.db
      .query("buildSessions")
      .withIndex("by_project", q => q.eq("projectId", projectId))
      .order("desc")
      .take(20);
  },
});

// ─── COST SUMMARY ─────────────────────────────────────────────────

export const getCostSummary = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, { projectId }) => {
    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_project", q => q.eq("projectId", projectId))
      .collect();

    // Calculate cost from token usage fields if available
    let totalBudgetTokens = 0;
    let totalSpentTokens = 0;
    let tasksWithBudget = 0;

    for (const task of tasks) {
      if (task.costBudgetTokens !== undefined) {
        totalBudgetTokens += task.costBudgetTokens;
        tasksWithBudget++;
      }
      if (task.costSpentTokens !== undefined) {
        totalSpentTokens += task.costSpentTokens;
      }
    }

    // Estimate USD cost: ~$0.002 per 1K tokens (average across providers)
    const estimatedCostUsd = (totalSpentTokens / 1000) * 0.002;

    return {
      totalAgentRuns: tasks.length,
      activeAgents: tasks.filter(t => t.status === "running").length,
      totalBudgetTokens,
      totalSpentTokens,
      estimatedCostUsd: Number(estimatedCostUsd.toFixed(4)),
      tasksWithBudget,
    };
  },
});
