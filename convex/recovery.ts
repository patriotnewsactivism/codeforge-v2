/**
 * recovery.ts — Event-Sourced Session Recovery
 *
 * No work is ever lost. Every agent action emits an event. Any crash,
 * disconnect, or failure resumes seamlessly by replaying events.
 *
 * Ported from autonomous-coder's session recovery pattern:
 *   - Every agent action emits: { sessionId, seq, type, payload, timestamp }
 *   - Events stored in append-only `sessionEvents` table
 *   - Recovery: replay events to reconstruct agent state at any point
 *   - Checkpointing: periodic state snapshots for fast recovery
 *   - Cross-device resume: user switches browser → session continues
 */

import { v } from "convex/values";
import { internalQuery, mutation, query } from "./_generated/server";

// ─── Event Types ────────────────────────────────────────────────────────────

export type SessionEventType =
  | "mission_start"
  | "mission_complete"
  | "mission_failed"
  | "task_dispatched"
  | "task_complete"
  | "task_failed"
  | "file_created"
  | "file_modified"
  | "file_deleted"
  | "agent_spawned"
  | "agent_complete"
  | "agent_failed"
  | "tool_call"
  | "tool_result"
  | "error"
  | "checkpoint"
  | "user_intervention"
  | "plan_created"
  | "plan_updated";

// ─── Queries ────────────────────────────────────────────────────────────────

/** Get all events for a session, ordered by sequence number. */
export const getSessionEvents = query({
  args: {
    sessionId: v.string(),
    afterSeq: v.optional(v.number()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    let events = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session", q => q.eq("sessionId", args.sessionId))
      .order("asc")
      .take(args.limit ?? 500);

    if (args.afterSeq !== undefined) {
      events = events.filter(e => e.seq > args.afterSeq!);
    }
    return events;
  },
});

/** Get the latest checkpoint for a session (for fast recovery). */
export const getLatestCheckpoint = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session_and_type", q =>
        q.eq("sessionId", args.sessionId).eq("type", "checkpoint"),
      )
      .order("desc")
      .take(1);
    return events[0] ?? null;
  },
});

/** Get session recovery state: last event seq + checkpoint. */
export const getRecoveryState = query({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const events = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session", q => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(1);

    const checkpoint = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session_and_type", q =>
        q.eq("sessionId", args.sessionId).eq("type", "checkpoint"),
      )
      .order("desc")
      .take(1);

    return {
      lastSeq: events[0]?.seq ?? 0,
      lastEventAt: events[0]?.timestamp ?? null,
      checkpointSeq: checkpoint[0]?.seq ?? 0,
      checkpointData: checkpoint[0]?.payload ?? null,
      eventCount: events.length,
    };
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────

/** Emit a session event (append-only). */
export const emitEvent = mutation({
  args: {
    sessionId: v.string(),
    projectId: v.id("projects"),
    type: v.string(),
    payload: v.optional(v.string()),
    agentId: v.optional(v.string()),
    metadata: v.optional(v.string()),
  },
  returns: v.number(), // returns the sequence number
  handler: async (ctx, args) => {
    // Get the next sequence number for this session
    const lastEvents = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session", q => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(1);
    const nextSeq = (lastEvents[0]?.seq ?? 0) + 1;

    await ctx.db.insert("sessionEvents", {
      sessionId: args.sessionId,
      projectId: args.projectId,
      seq: nextSeq,
      type: args.type as any,
      payload: args.payload,
      agentId: args.agentId,
      metadata: args.metadata,
      timestamp: Date.now(),
    });

    return nextSeq;
  },
});

/** Create a checkpoint (state snapshot for fast recovery). */
export const createCheckpoint = mutation({
  args: {
    sessionId: v.string(),
    projectId: v.id("projects"),
    state: v.string(), // JSON-serialized agent/session state
    filesSnapshot: v.optional(v.array(v.string())), // file paths at checkpoint
  },
  handler: async (ctx, args) => {
    const lastEvents = await ctx.db
      .query("sessionEvents")
      .withIndex("by_session", q => q.eq("sessionId", args.sessionId))
      .order("desc")
      .take(1);
    const nextSeq = (lastEvents[0]?.seq ?? 0) + 1;

    await ctx.db.insert("sessionEvents", {
      sessionId: args.sessionId,
      projectId: args.projectId,
      seq: nextSeq,
      type: "checkpoint",
      payload: args.state,
      metadata: JSON.stringify({ files: args.filesSnapshot ?? [] }),
      timestamp: Date.now(),
    });

    return { seq: nextSeq };
  },
});

/** Mark a session as recoverable (agent heartbeat). */
export const heartbeat = mutation({
  args: {
    sessionId: v.string(),
    agentId: v.string(),
    status: v.string(), // "alive" | "stale" | "dead"
  },
  handler: async (ctx, args) => {
    // Upsert agent heartbeat record
    const existing = await ctx.db
      .query("agentHeartbeats")
      .withIndex("by_session_and_agent", q =>
        q.eq("sessionId", args.sessionId).eq("agentId", args.agentId),
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeenAt: Date.now(),
        status: args.status,
      });
    } else {
      await ctx.db.insert("agentHeartbeats", {
        sessionId: args.sessionId,
        agentId: args.agentId,
        lastSeenAt: Date.now(),
        status: args.status,
      });
    }
  },
});

/** Detect stale agents (no heartbeat for 30s). */
export const detectStaleAgents = internalQuery({
  args: { sessionId: v.string() },
  handler: async (ctx, args) => {
    const cutoff = Date.now() - 30_000;
    const heartbeats = await ctx.db
      .query("agentHeartbeats")
      .withIndex("by_session", q => q.eq("sessionId", args.sessionId))
      .collect();
    return heartbeats.filter(
      h => h.lastSeenAt < cutoff && h.status === "alive",
    );
  },
});
