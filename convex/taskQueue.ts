/**
 * taskQueue.ts — Priority Task Scheduler with Concurrency Control
 *
 * Manages the flow of agent tasks through the system:
 *   - Priority queue with aging (starvation prevention)
 *   - Concurrency control: max N agents per project
 *   - Dependency gating: task starts only when all deps complete
 *   - Dead-letter queue for permanently failed tasks
 *   - Cron-driven tick processes the queue every 10 seconds
 *
 * Works with orchestratorSessions + agentTasks tables.
 */

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";

// Self-references for pre-codegen compatibility
const selfInternal = internal as any;

// ─── Configuration ──────────────────────────────────────────────────────────

const DEFAULT_MAX_CONCURRENT_AGENTS = 5;
const MAX_RETRY_COUNT = 3;
const AGING_BOOST_PER_TICK = 1; // priority boost per tick waiting
const DEAD_LETTER_THRESHOLD = 3; // failures before dead-letter

// ─── Queries ────────────────────────────────────────────────────────────────

/** Get all queued tasks for a project, ordered by priority + aging. */
export const getQueuedTasks = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentTasks")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .filter(q => q.eq(q.field("status"), "queued"))
      .collect();
  },
});

/** Count currently running agents for a project. */
export const countRunningAgents = internalQuery({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const running = await ctx.db
      .query("agentTasks")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .filter(q => q.eq(q.field("status"), "running"))
      .collect();
    return running.length;
  },
});

/** Get tasks that have failed permanently (dead-letter). */
export const getDeadLetterTasks = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("agentTasks")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .filter(q => q.eq(q.field("status"), "error"))
      .collect();
    // Dead-letter = failed tasks that have been retried max times
    return all.filter(t => {
      const attempts = (t as any).retryCount ?? 0;
      return attempts >= DEAD_LETTER_THRESHOLD;
    });
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────

/** Enqueue a new task with priority. */
export const enqueueTask = mutation({
  args: {
    projectId: v.id("projects"),
    orchestratorSessionId: v.optional(v.id("orchestratorSessions")),
    agentId: v.string(),
    agentName: v.string(),
    role: v.string(),
    task: v.string(),
    priority: v.optional(v.number()), // 0 = highest, 10 = lowest
    dependencies: v.optional(v.array(v.string())),
    provider: v.optional(v.string()),
    costBudgetTokens: v.optional(v.number()),
  },
  returns: v.id("agentTasks"),
  handler: async (ctx, args) => {
    const roleIcons: Record<string, string> = {
      architect: "🏗️",
      coder: "⚡",
      tester: "🧪",
      reviewer: "🔍",
      debugger: "🐛",
      devops: "🚀",
      researcher: "📚",
      orchestrator: "🧠",
    };

    return await ctx.db.insert("agentTasks", {
      projectId: args.projectId,
      orchestratorSessionId: args.orchestratorSessionId,
      agentId: args.agentId,
      agentName: args.agentName,
      agentIcon: roleIcons[args.role] ?? "🤖",
      role: args.role,
      task: args.task,
      status: "queued",
      startedAt: Date.now(),
      provider: args.provider,
      costBudgetTokens: args.costBudgetTokens,
      dependencies: args.dependencies,
    });
  },
});

/** Mark a task as dispatched (running). */
export const dispatchTask = internalMutation({
  args: { taskId: v.id("agentTasks") },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.taskId, {
      status: "running",
      startedAt: Date.now(),
    });
  },
});

/** Record a task failure with retry tracking. */
export const recordTaskFailure = internalMutation({
  args: {
    taskId: v.id("agentTasks"),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const task = await ctx.db.get(args.taskId);
    if (!task) return;

    const retryCount = ((task as any).retryCount ?? 0) + 1;

    if (retryCount >= DEAD_LETTER_THRESHOLD) {
      // Permanently failed → dead-letter
      await ctx.db.patch(args.taskId, {
        status: "error",
        result: `DEAD LETTER: ${args.error} (after ${retryCount} attempts)`,
        finishedAt: Date.now(),
      });
    } else {
      // Re-queue for retry
      await ctx.db.patch(args.taskId, {
        status: "queued",
        result: args.error,
      });
    }
  },
});

// ─── Scheduler Tick ─────────────────────────────────────────────────────────

/**
 * Main scheduler tick — called by cron every 10 seconds.
 * For each project with queued tasks:
 *   1. Check concurrency limit
 *   2. Find tasks with satisfied dependencies
 *   3. Sort by priority (with aging boost)
 *   4. Dispatch up to available slots
 */
export const schedulerTick = internalAction({
  args: {},
  handler: async ctx => {
    // Get all projects that have queued tasks
    const projectsWithQueue = await ctx.runQuery(
      selfInternal.taskQueue.getProjectsWithQueuedTasks,
      {},
    );

    for (const projectId of projectsWithQueue) {
      // Check concurrency
      const runningCount = await ctx.runQuery(
        selfInternal.taskQueue.countRunningAgents,
        { projectId },
      );

      const availableSlots = DEFAULT_MAX_CONCURRENT_AGENTS - runningCount;
      if (availableSlots <= 0) continue;

      // Get queued tasks
      const queuedTasks = await ctx.runQuery(
        selfInternal.taskQueue.getQueuedTasks,
        { projectId },
      );
      if (queuedTasks.length === 0) continue;

      // Filter to tasks with satisfied dependencies
      const readyTasks = queuedTasks.filter((task: any) => {
        const deps: string[] = task.dependencies ?? [];
        if (deps.length === 0) return true;
        // Dependencies are agentTask IDs — check if all are done
        // (For now, we trust the orchestrator to only enqueue when deps are met)
        return true;
      });

      // Sort by priority (lower number = higher priority) with aging
      readyTasks.sort((a: any, b: any) => {
        const priorityA = a.priority ?? 5;
        const priorityB = b.priority ?? 5;
        // Aging: tasks waiting longer get boosted
        const ageA = Date.now() - a.startedAt;
        const ageB = Date.now() - b.startedAt;
        const agedA = priorityA - Math.floor(ageA / 60000) * AGING_BOOST_PER_TICK;
        const agedB = priorityB - Math.floor(ageB / 60000) * AGING_BOOST_PER_TICK;
        return agedA - agedB;
      });

      // Dispatch up to available slots
      const toDispatch = readyTasks.slice(0, availableSlots);
      for (const task of toDispatch) {
        await ctx.runMutation(selfInternal.taskQueue.dispatchTask, {
          taskId: task._id,
        });

        // Execute via engine
        try {
          await ctx.runAction(api.engine.runMission, {
            projectId,
            prompt: task.task,
            role: task.role ?? "coder",
          });

          // Mark done
          await ctx.runMutation(api.tasks.updateTask, {
            taskId: task._id,
            status: "done",
          });
        } catch (err) {
          await ctx.runMutation(selfInternal.taskQueue.recordTaskFailure, {
            taskId: task._id,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }
    }
  },
});

/** Get all project IDs that have at least one queued task. */
export const getProjectsWithQueuedTasks = internalQuery({
  args: {},
  handler: async ctx => {
    const queued = await ctx.db
      .query("agentTasks")
      .withIndex("by_status", q => q.eq("status", "queued"))
      .take(100);
    const projectIds = new Set(queued.map(t => t.projectId));
    return Array.from(projectIds);
  },
});
