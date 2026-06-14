/**
 * cinema.ts — CodeForge Live Mission Cinema
 *
 * Real-time visual replay of any past mission.
 * Every agent spawn, tool call, thought, debate, and sentry event is stored
 * as a timestamped "cinema frame". The frontend can scrub through the timeline,
 * pause at any frame, and see the exact agent state at that moment.
 *
 * Frame types: spawn | tool_call | thought | debate | sentry | message | complete | error
 */

import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

// ─── MUTATIONS ───────────────────────────────────────────────────────────────

export const recordFrame = mutation({
  args: {
    projectId: v.id("projects"),
    missionId: v.id("buildSessions"),
    buildSessionId: v.optional(v.id("buildSessions")),
    frameType: v.union(
      v.literal("spawn"),
      v.literal("tool_call"),
      v.literal("tool_result"),
      v.literal("thought"),
      v.literal("debate"),
      v.literal("sentry"),
      v.literal("message"),
      v.literal("memory_read"),
      v.literal("memory_write"),
      v.literal("complete"),
      v.literal("error"),
    ),
    agentId: v.string(),
    agentName: v.string(),
    agentRole: v.optional(v.string()),
    parentAgentId: v.optional(v.string()),
    spawnDepth: v.optional(v.number()),
    payload: v.string(),            // JSON — type-specific data
    durationMs: v.optional(v.number()),
    success: v.optional(v.boolean()),
  },
  returns: v.id("cinemaFrames"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("cinemaFrames", {
      ...args,
      ts: Date.now(),
    });
  },
});

export const finalizeReplay = mutation({
  args: {
    missionId: v.id("buildSessions"),
    totalFrames: v.number(),
    durationMs: v.number(),
    agentCount: v.number(),
    toolCallCount: v.number(),
    peakDepth: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // store summary on the mission record itself
    const mission = await ctx.db.get(args.missionId);
    if (mission) {
      await ctx.db.patch(args.missionId, {
        cinemaStats: {
          totalFrames: args.totalFrames,
          durationMs: args.durationMs,
          agentCount: args.agentCount,
          toolCallCount: args.toolCallCount,
          peakDepth: args.peakDepth,
          recordedAt: Date.now(),
        },
      } as any);
    }
    return null;
  },
});

// ─── QUERIES ─────────────────────────────────────────────────────────────────

export const getFrames = query({
  args: {
    missionId: v.id("buildSessions"),
    fromTs: v.optional(v.number()),    // for pagination / scrubbing
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("cinemaFrames")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .order("asc")
      .take(2000);

    if (args.fromTs) {
      const idx = all.findIndex((f) => f.ts >= args.fromTs!);
      return all.slice(idx >= 0 ? idx : 0, (idx >= 0 ? idx : 0) + (args.limit ?? 200));
    }
    return all.slice(0, args.limit ?? 200);
  },
});

export const getAgentTree = query({
  args: { missionId: v.id("buildSessions") },
  handler: async (ctx, args) => {
    const spawnFrames = await ctx.db
      .query("cinemaFrames")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .filter((q) => q.eq(q.field("frameType"), "spawn"))
      .collect();

    // Build adjacency list: parentAgentId → children
    const tree: Record<string, { agentId: string; agentName: string; role: string; depth: number; ts: number }[]> = {};
    for (const f of spawnFrames) {
      const parent = f.parentAgentId ?? "root";
      if (!tree[parent]) tree[parent] = [];
      tree[parent].push({
        agentId: f.agentId,
        agentName: f.agentName,
        role: f.agentRole ?? "unknown",
        depth: f.spawnDepth ?? 0,
        ts: f.ts,
      });
    }
    return tree;
  },
});

export const getTimelineSummary = query({
  args: { missionId: v.id("buildSessions") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("cinemaFrames")
      .withIndex("by_mission", (q) => q.eq("missionId", args.missionId))
      .collect();

    if (!all.length) return null;

    const byType = all.reduce((acc, f) => {
      acc[f.frameType] = (acc[f.frameType] ?? 0) + 1;
      return acc;
    }, {} as Record<string, number>);

    const agents = [...new Set(all.map((f) => f.agentId))];
    const peakDepth = Math.max(...all.map((f) => f.spawnDepth ?? 0));

    return {
      totalFrames: all.length,
      startTs: all[0].ts,
      endTs: all[all.length - 1].ts,
      durationMs: all[all.length - 1].ts - all[0].ts,
      byType,
      agentCount: agents.length,
      peakDepth,
    };
  },
});

// ─── ACTION: buildCinemaFromExisting ─────────────────────────────────────────
// Backfills cinema frames from existing toolCalls + agentThoughts for a mission
// (for missions that ran before Cinema was added)

export const buildCinemaFromExisting = action({
  args: {
    projectId: v.id("projects"),
    missionId: v.id("buildSessions"),
  },
  returns: v.object({ framesCreated: v.number() }),
  handler: async (ctx, args) => {
    // Pull tool calls and thoughts from existing tables
    const thoughts = await ctx.runQuery(api.intelligence.listThoughts, {
      projectId: args.projectId,
    });
    const toolCalls = await ctx.runQuery(api.intelligence.listToolCalls, {
      projectId: args.projectId,
    });

    let created = 0;

    // Thoughts → frames
    for (const t of thoughts.slice(0, 500)) {
      await ctx.runMutation(api.cinema.recordFrame, {
        projectId: args.projectId,
        missionId: args.missionId,
        frameType: t.type === "error" ? "error" : t.type === "complete" ? "complete" : "thought",
        agentId: t.agentId,
        agentName: t.agentName,
        payload: JSON.stringify({ content: t.content }),
      });
      created++;
    }

    // Tool calls → frames
    for (const tc of toolCalls.slice(0, 500)) {
      await ctx.runMutation(api.cinema.recordFrame, {
        projectId: args.projectId,
        missionId: args.missionId,
        frameType: "tool_call",
        agentId: tc.agentId ?? "unknown",
        agentName: tc.agentName ?? "Agent",
        payload: JSON.stringify({ tool: tc.tool, args: tc.args, status: tc.status, output: tc.output }),
        success: tc.status === "completed",
      });
      created++;
    }

    return { framesCreated: created };
  },
});
