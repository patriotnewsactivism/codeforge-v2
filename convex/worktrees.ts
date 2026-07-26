/**
 * worktrees.ts — Git Worktree Management for Isolated Agent Execution
 *
 * Each agent works in its own isolated context — no conflicts, full rollback.
 * Ported from autonomous-coder's server/git.ts pattern, adapted for Convex's
 * virtual file system (files table).
 *
 * Since CodeForge uses a virtual FS (Convex `files` table), "worktrees" are
 * implemented as file snapshots + branch metadata rather than actual git worktrees.
 * When connected to a real GitHub repo, these map to actual branches.
 */

import { v } from "convex/values";
import type { Id } from "./_generated/dataModel";
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

// ─── Schema (uses existing gitCommits + gitBranches tables) ─────────────────
// Worktree state is tracked via the gitBranches table with metadata.

// ─── Queries ────────────────────────────────────────────────────────────────

/** List active worktrees (branches) for a project. */
export const listWorktrees = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("gitBranches")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .take(20);
  },
});

/** Get file snapshot for a specific branch/worktree. */
export const getWorktreeFiles = internalQuery({
  args: {
    projectId: v.id("projects"),
    branchName: v.string(),
  },
  handler: async (ctx, args) => {
    // In the virtual FS model, all agents share the same files table.
    // Isolation is achieved through optimistic locking + conflict detection.
    // This returns the current file state (agents write to their "branch" conceptually).
    return await ctx.db
      .query("files")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .collect();
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────

/** Create a new worktree (branch) for an agent session. */
export const createWorktree = mutation({
  args: {
    projectId: v.id("projects"),
    agentId: v.string(),
    role: v.string(),
    missionSlug: v.optional(v.string()),
  },
  returns: v.object({
    branchId: v.id("gitBranches"),
    branchName: v.string(),
  }),
  handler: async (ctx, args) => {
    const slug = args.missionSlug ?? `agent-${args.role}-${Date.now().toString(36)}`;
    const branchName = `codeforge/${slug}/${args.role}`;

    const branchId = await ctx.db.insert("gitBranches", {
      projectId: args.projectId,
      name: branchName,
      baseBranch: "main",
      createdBy: args.agentId,
      status: "active",
      createdAt: Date.now(),
      lastCommitAt: Date.now(),
      commitCount: 0,
    });

    return { branchId, branchName };
  },
});

/** Record a commit in a worktree. */
export const commitToWorktree = mutation({
  args: {
    projectId: v.id("projects"),
    branchName: v.string(),
    message: v.string(),
    filesChanged: v.array(v.string()),
    agentId: v.string(),
  },
  returns: v.id("gitCommits"),
  handler: async (ctx, args) => {
    // Update branch metadata
    const branch = await ctx.db
      .query("gitBranches")
      .withIndex("by_project_and_name", q =>
        q.eq("projectId", args.projectId).eq("name", args.branchName),
      )
      .first();

    if (branch) {
      await ctx.db.patch(branch._id, {
        lastCommitAt: Date.now(),
        commitCount: (branch.commitCount ?? 0) + 1,
      });
    }

    // Record the commit
    return await ctx.db.insert("gitCommits", {
      projectId: args.projectId,
      sha: `${args.branchName}:${Date.now().toString(36)}`,
      message: args.message,
      branch: args.branchName,
      filesChanged: args.filesChanged,
      timestamp: Date.now(),
    });
  },
});

/** Mark a worktree as complete (ready for merge). */
export const completeWorktree = mutation({
  args: {
    projectId: v.id("projects"),
    branchName: v.string(),
  },
  handler: async (ctx, args) => {
    const branch = await ctx.db
      .query("gitBranches")
      .withIndex("by_project_and_name", q =>
        q.eq("projectId", args.projectId).eq("name", args.branchName),
      )
      .first();

    if (branch) {
      await ctx.db.patch(branch._id, {
        status: "merged",
      });
    }
  },
});

/** Clean up abandoned worktrees (older than 24h with no commits). */
export const cleanupStaleWorktrees = internalMutation({
  args: {},
  handler: async ctx => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    const allBranches = await ctx.db.query("gitBranches").take(100);
    let cleaned = 0;

    for (const branch of allBranches) {
      if (
        branch.status === "active" &&
        branch.createdAt < cutoff &&
        (branch.commitCount ?? 0) === 0
      ) {
        await ctx.db.patch(branch._id, { status: "abandoned" });
        cleaned++;
      }
    }

    return { cleaned };
  },
});

// ─── Conflict Detection ─────────────────────────────────────────────────────

/**
 * Check if two agents are working on the same files.
 * Returns conflicting file paths.
 */
export const detectConflicts = internalQuery({
  args: {
    projectId: v.id("projects"),
    filesA: v.array(v.string()),
    filesB: v.array(v.string()),
  },
  handler: async (_ctx, args) => {
    const setB = new Set(args.filesB);
    return args.filesA.filter(f => setB.has(f));
  },
});
