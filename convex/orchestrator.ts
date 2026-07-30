/**
 * orchestrator.ts — Task Decomposition & Dispatch Engine
 *
 * The brain of CodeForge's autonomous swarm. Given a user request:
 *   1. Classifies complexity (simple → moderate → complex → epic)
 *   2. Decomposes into a DAG of specialized agent tasks
 *   3. Creates an orchestratorSession to track lifecycle
 *   4. Dispatches tasks respecting dependency order
 *   5. Monitors progress and re-plans on failure
 *
 * Ported from autonomous-coder's superagent.ts + spawnEngine.ts patterns,
 * adapted for Convex's reactive architecture.
 */

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalMutation,
  query,
} from "./_generated/server";
import { callAIWithFallback, getModelForRole } from "./ai";
import { resolveByok } from "./lib/byok";
import { type AgentCapability, selectProvider } from "./providers/types";

// Self-references require codegen to be typed. Cast until `npx convex codegen` runs.
const selfApi = api as any;
const selfInternal = internal as any;

// ─── Types ──────────────────────────────────────────────────────────────────

export interface TaskNode {
  id: string;
  title: string;
  description: string;
  type: AgentCapability;
  role: string;
  dependencies: string[];
  estimatedTokens: number;
  files: string[];
  acceptanceCriteria: string[];
}

export interface TaskPlan {
  complexity: "simple" | "moderate" | "complex" | "epic";
  tasks: TaskNode[];
  estimatedTotalTokens: number;
  parallelismFactor: number;
}

// ─── Queries ────────────────────────────────────────────────────────────────

export const listSessions = query({
  args: { projectId: v.id("projects"), limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("orchestratorSessions")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .take(args.limit ?? 20);
  },
});

export const getActiveSession = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const active = await ctx.db
      .query("orchestratorSessions")
      .withIndex("by_project_and_state", q =>
        q.eq("projectId", args.projectId).eq("state", "monitoring"),
      )
      .first();
    if (active) return active;
    return await ctx.db
      .query("orchestratorSessions")
      .withIndex("by_project_and_state", q =>
        q.eq("projectId", args.projectId).eq("state", "dispatching"),
      )
      .first();
  },
});

export const getSessionTasks = query({
  args: { sessionId: v.id("orchestratorSessions") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentTasks")
      .withIndex("by_orchestrator_session", q =>
        q.eq("orchestratorSessionId", args.sessionId),
      )
      .collect();
  },
});

export const getSession = query({
  args: { sessionId: v.id("orchestratorSessions") },
  handler: async (ctx, args) => {
    return await ctx.db.get(args.sessionId);
  },
});

// ─── Mutations ──────────────────────────────────────────────────────────────

export const updateSessionState = internalMutation({
  args: {
    sessionId: v.id("orchestratorSessions"),
    state: v.union(
      v.literal("planning"),
      v.literal("dispatching"),
      v.literal("monitoring"),
      v.literal("aggregating"),
      v.literal("complete"),
      v.literal("failed"),
    ),
    error: v.optional(v.string()),
    completedTasks: v.optional(v.number()),
    failedTasks: v.optional(v.number()),
    totalTokensUsed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { state: args.state };
    if (args.error) patch.error = args.error;
    if (args.completedTasks !== undefined)
      patch.completedTasks = args.completedTasks;
    if (args.failedTasks !== undefined) patch.failedTasks = args.failedTasks;
    if (args.totalTokensUsed !== undefined)
      patch.totalTokensUsed = args.totalTokensUsed;
    if (args.state === "complete" || args.state === "failed") {
      patch.finishedAt = Date.now();
    }
    await ctx.db.patch(args.sessionId, patch);
  },
});

// ─── Planning Prompt ────────────────────────────────────────────────────────

const ORCHESTRATOR_PROMPT = `You are the Orchestrator — a master software engineering planner.
Given a user's goal and project context, decompose the work into a directed acyclic graph (DAG)
of specialized agent tasks that can execute in parallel where possible.

Available agent roles and their specialties:
- architect: system design, file structure, API contracts, schema design
- coder: writing implementation code (frontend + backend)
- tester: writing unit/integration tests, test infrastructure
- reviewer: code quality, security audit, best practices
- debugger: error diagnosis, root cause analysis, fixes
- devops: CI/CD, deployment config, infrastructure
- researcher: documentation lookup, API references, best practices

Complexity classification:
- simple: single-file change, bug fix, small feature (< 1 task)
- moderate: multi-file feature, needs planning (2-4 tasks)
- complex: cross-cutting feature, new subsystem (5-10 tasks)
- epic: full application, multi-system platform (10-20 tasks, use shards)

OUTPUT JSON (no markdown fences, no extra text):
{
  "complexity": "moderate",
  "tasks": [
    {
      "id": "t1",
      "title": "Design database schema",
      "description": "Create the Convex schema tables for...",
      "type": "plan",
      "role": "architect",
      "dependencies": [],
      "estimatedTokens": 4000,
      "files": ["convex/schema.ts"],
      "acceptanceCriteria": ["Tables defined with proper indexes", "Types exported"]
    },
    {
      "id": "t2",
      "title": "Implement CRUD mutations",
      "description": "Write create/read/update/delete mutations for...",
      "type": "code",
      "role": "coder",
      "dependencies": ["t1"],
      "estimatedTokens": 8000,
      "files": ["convex/items.ts"],
      "acceptanceCriteria": ["All CRUD ops work", "Auth checked"]
    }
  ],
  "estimatedTotalTokens": 12000,
  "parallelismFactor": 2
}

Rules:
- Tasks with no dependencies can run in parallel
- Keep task IDs short (t1, t2, t3...)
- Each task should be completable by one agent in one pass
- Include specific file paths the task will create/modify
- Acceptance criteria must be verifiable
- For "simple" complexity, return exactly 1 task
- Never exceed 20 tasks
- Prefer fewer, larger tasks over many tiny ones`;

// ─── Main Orchestration Action ──────────────────────────────────────────────

export const orchestrate = action({
  args: {
    projectId: v.id("projects"),
    goal: v.string(),
    costBudgetTokens: v.optional(v.number()),
  },
  returns: v.object({
    sessionId: v.id("orchestratorSessions"),
    complexity: v.string(),
    taskCount: v.number(),
  }),
  handler: async (ctx, args) => {
    // 1. Create the orchestrator session
    const sessionId = await ctx.runMutation(
      selfInternal.orchestrator.createSession,
      {
        projectId: args.projectId,
        goal: args.goal,
        costBudgetTokens: args.costBudgetTokens,
      },
    );

    // 2. Gather project context
    let projectContext = "";
    try {
      const files = await ctx.runQuery(api.files.listByProject, {
        projectId: args.projectId,
      });
      const fileList = (files as any[])
        .filter((f: any) => !f.isDirectory)
        .slice(0, 50)
        .map((f: any) => f.path)
        .join("\n");
      projectContext = `Project files:\n${fileList}`;
    } catch {
      projectContext = "(unable to load project files)";
    }

    // 3. Resolve BYOK + model
    const userId = await ctx.runQuery(api.auth.currentUser, {});
    const byok = await resolveByok(
      ctx,
      userId?._id ? String(userId._id) : undefined,
    );
    const model = await getModelForRole(ctx, "orchestrator");

    // 4. Decompose the goal into a task DAG
    const { text: planJson } = await callAIWithFallback(
      [
        { role: "system", content: ORCHESTRATOR_PROMPT },
        {
          role: "user",
          content: `GOAL: ${args.goal}\n\n${projectContext}\n\nBudget: ${args.costBudgetTokens ?? "unlimited"} tokens`,
        },
      ],
      { model, ...byok },
    );

    let plan: TaskPlan;
    try {
      const cleaned = planJson
        .replace(/```json\n?/g, "")
        .replace(/```/g, "")
        .trim();
      plan = JSON.parse(cleaned) as TaskPlan;
      if (!plan.tasks || plan.tasks.length === 0) throw new Error("Empty plan");
    } catch {
      // Fallback: single-task plan
      plan = {
        complexity: "simple",
        tasks: [
          {
            id: "t1",
            title: args.goal.slice(0, 60),
            description: args.goal,
            type: "code",
            role: "coder",
            dependencies: [],
            estimatedTokens: 8000,
            files: [],
            acceptanceCriteria: ["Task completed successfully"],
          },
        ],
        estimatedTotalTokens: 8000,
        parallelismFactor: 1,
      };
    }

    // 5. Store the plan and update session
    await ctx.runMutation(selfInternal.orchestrator.storePlan, {
      sessionId,
      plan: JSON.stringify(plan),
      complexity: plan.complexity,
      totalTasks: plan.tasks.length,
    });

    // 6. Dispatch tasks (schedule the dispatcher)
    await ctx.scheduler.runAfter(0, selfInternal.orchestrator.dispatchTasks, {
      sessionId,
      projectId: args.projectId,
    });

    return {
      sessionId,
      complexity: plan.complexity,
      taskCount: plan.tasks.length,
    };
  },
});

// ─── Internal Helpers ───────────────────────────────────────────────────────

export const createSession = internalMutation({
  args: {
    projectId: v.id("projects"),
    goal: v.string(),
    costBudgetTokens: v.optional(v.number()),
  },
  returns: v.id("orchestratorSessions"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("orchestratorSessions", {
      projectId: args.projectId,
      goal: args.goal,
      state: "planning",
      costBudgetTokens: args.costBudgetTokens,
      startedAt: Date.now(),
    });
  },
});

export const storePlan = internalMutation({
  args: {
    sessionId: v.id("orchestratorSessions"),
    plan: v.string(),
    complexity: v.string(),
    totalTasks: v.number(),
  },
  handler: async (ctx, args) => {
    await ctx.db.patch(args.sessionId, {
      plan: args.plan,
      complexity: args.complexity,
      totalTasks: args.totalTasks,
      completedTasks: 0,
      failedTasks: 0,
      state: "dispatching",
    });
  },
});

/**
 * Dispatch tasks in dependency order. Runs all tasks whose dependencies
 * are satisfied, then schedules a monitor tick to check progress.
 */
export const dispatchTasks = internalAction({
  args: {
    sessionId: v.id("orchestratorSessions"),
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const session = await ctx.runQuery(selfApi.orchestrator.getSession, {
      sessionId: args.sessionId,
    });
    if (!session?.plan) return;

    const plan: TaskPlan = JSON.parse(session.plan);
    const existingTasks = await ctx.runQuery(
      selfApi.orchestrator.getSessionTasks,
      { sessionId: args.sessionId },
    );

    // Map existing tasks by their task node ID (stored in agentId field)
    const completedIds = new Set(
      existingTasks
        .filter((t: any) => t.status === "done")
        .map((t: any) => t.agentId.replace("orch:", "")),
    );
    const dispatchedIds = new Set(
      existingTasks.map((t: any) => t.agentId.replace("orch:", "")),
    );

    // Find tasks ready to dispatch (all deps completed, not yet dispatched)
    const ready = plan.tasks.filter(
      t =>
        !dispatchedIds.has(t.id) &&
        t.dependencies.every(dep => completedIds.has(dep)),
    );

    // Dispatch ready tasks
    for (const task of ready) {
      const provider = selectProvider(task.type);

      await ctx.runMutation(selfInternal.orchestrator.createTask, {
        sessionId: args.sessionId,
        projectId: args.projectId,
        taskNode: JSON.stringify(task),
        provider: provider.id,
      });

      // Execute via engine
      const taskPrompt = `[ORCHESTRATOR TASK: ${task.title}]\n\nRole: ${task.role}\nType: ${task.type}\n\nDescription:\n${task.description}\n\nExpected files: ${task.files.join(", ")}\n\nAcceptance criteria:\n${task.acceptanceCriteria.map(c => `- ${c}`).join("\n")}\n\nImplement this task completely.`;

      try {
        await ctx.runAction(api.engine.runMission, {
          projectId: args.projectId,
          prompt: taskPrompt,
          role: task.role,
        });

        // Mark task done
        await ctx.runMutation(selfInternal.orchestrator.markTaskDone, {
          sessionId: args.sessionId,
          taskId: task.id,
        });
      } catch (err) {
        await ctx.runMutation(selfInternal.orchestrator.markTaskFailed, {
          sessionId: args.sessionId,
          taskId: task.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    // Check if all tasks are complete
    const updatedTasks = await ctx.runQuery(
      selfApi.orchestrator.getSessionTasks,
      { sessionId: args.sessionId },
    );
    const done = updatedTasks.filter((t: any) => t.status === "done").length;
    const failed = updatedTasks.filter((t: any) => t.status === "error").length;
    const total = plan.tasks.length;

    if (done + failed >= total) {
      await ctx.runMutation(selfInternal.orchestrator.updateSessionState, {
        sessionId: args.sessionId,
        state: failed > 0 ? "failed" : "complete",
        completedTasks: done,
        failedTasks: failed,
        error: failed > 0 ? `${failed} task(s) failed` : undefined,
      });
    } else {
      // Schedule next dispatch tick for remaining tasks
      await ctx.scheduler.runAfter(5, selfInternal.orchestrator.dispatchTasks, {
        sessionId: args.sessionId,
        projectId: args.projectId,
      });
    }
  },
});

export const createTask = internalMutation({
  args: {
    sessionId: v.id("orchestratorSessions"),
    projectId: v.id("projects"),
    taskNode: v.string(),
    provider: v.string(),
  },
  handler: async (ctx, args) => {
    const task: TaskNode = JSON.parse(args.taskNode);
    const roleIcons: Record<string, string> = {
      architect: "🏗️",
      coder: "⚡",
      tester: "🧪",
      reviewer: "🔍",
      debugger: "🐛",
      devops: "🚀",
      researcher: "📚",
    };

    return await ctx.db.insert("agentTasks", {
      projectId: args.projectId,
      orchestratorSessionId: args.sessionId,
      agentId: `orch:${task.id}`,
      agentName: `${task.role} — ${task.title}`,
      agentIcon: roleIcons[task.role] ?? "🤖",
      role: task.role,
      task: task.description,
      status: "running",
      startedAt: Date.now(),
      provider: args.provider,
      costBudgetTokens: task.estimatedTokens,
      dependencies: task.dependencies,
    });
  },
});

export const markTaskDone = internalMutation({
  args: {
    sessionId: v.id("orchestratorSessions"),
    taskId: v.string(),
  },
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_orchestrator_session", q =>
        q.eq("orchestratorSessionId", args.sessionId),
      )
      .collect();
    const task = tasks.find(t => t.agentId === `orch:${args.taskId}`);
    if (task) {
      await ctx.db.patch(task._id, {
        status: "done",
        finishedAt: Date.now(),
      });
    }
  },
});

export const markTaskFailed = internalMutation({
  args: {
    sessionId: v.id("orchestratorSessions"),
    taskId: v.string(),
    error: v.string(),
  },
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_orchestrator_session", q =>
        q.eq("orchestratorSessionId", args.sessionId),
      )
      .collect();
    const task = tasks.find(t => t.agentId === `orch:${args.taskId}`);
    if (task) {
      await ctx.db.patch(task._id, {
        status: "error",
        result: args.error,
        finishedAt: Date.now(),
      });
    }
  },
});
