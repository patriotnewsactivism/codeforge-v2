/**
 * planner.ts — CodeForge ACSE Autonomous Engineering Planner
 *
 * Phase 3 of the Autonomous Software Completion Engine.
 * Converts X-Ray findings and completion scores into a dependency-aware
 * execution DAG of work items.
 *
 * Flow:
 *   1. Read completion scores + gap analysis
 *   2. AI generates a structured work plan with dependency edges
 *   3. Topological sort determines execution order
 *   4. Independent items are batched for parallel execution
 *   5. startAutonomousExecution kicks off the pipeline
 *
 * Each work item includes:
 *   - Title, description, category, priority
 *   - Impact score, effort estimate, risk level
 *   - Dependency edges (which items must complete first)
 *   - Affected files
 */

import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, mutation, query } from "./_generated/server";
import { callAIWithFallback, getModelForRole } from "./ai";

// ─── TYPES ──────────────────────────────────────────────────────────────────

interface WorkItemInput {
  title: string;
  description: string;
  category: string;
  priority: "critical" | "high" | "medium" | "low";
  impact: number;
  effort: "trivial" | "small" | "medium" | "large" | "epic";
  risk: "low" | "medium" | "high";
  dependsOn: number[]; // indices into the array
  filesAffected: string[];
  estimatedTokens?: number;
}

// ─── DB OPERATIONS ──────────────────────────────────────────────────────────

export const createWorkItem = mutation({
  args: {
    projectId: v.id("projects"),
    scoreId: v.optional(v.id("completionScores")),
    title: v.string(),
    description: v.string(),
    category: v.string(),
    priority: v.union(
      v.literal("critical"),
      v.literal("high"),
      v.literal("medium"),
      v.literal("low"),
    ),
    impact: v.number(),
    effort: v.union(
      v.literal("trivial"),
      v.literal("small"),
      v.literal("medium"),
      v.literal("large"),
      v.literal("epic"),
    ),
    risk: v.union(v.literal("low"), v.literal("medium"), v.literal("high")),
    dependsOn: v.array(v.string()),
    filesAffected: v.array(v.string()),
    estimatedTokens: v.optional(v.number()),
  },
  returns: v.id("workItems"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("workItems", {
      ...args,
      status: "planned",
      createdAt: Date.now(),
    });
  },
});

export const updateWorkItemStatus = mutation({
  args: {
    workItemId: v.id("workItems"),
    status: v.union(
      v.literal("planned"),
      v.literal("queued"),
      v.literal("in_progress"),
      v.literal("review"),
      v.literal("done"),
      v.literal("skipped"),
    ),
    assignedAgentId: v.optional(v.string()),
    buildSessionId: v.optional(v.id("buildSessions")),
    result: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { workItemId, ...patch } = args;
    const cleaned: Record<string, unknown> = {};
    for (const [k, val] of Object.entries(patch)) {
      if (val !== undefined) cleaned[k] = val;
    }
    if (args.status === "in_progress" && !cleaned.startedAt) {
      cleaned.startedAt = Date.now();
    }
    if (args.status === "done" || args.status === "skipped") {
      cleaned.completedAt = Date.now();
    }
    await ctx.db.patch(workItemId, cleaned);
    return null;
  },
});

export const listWorkItems = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workItems")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .take(100);
  },
});

export const listWorkItemsByStatus = query({
  args: {
    projectId: v.id("projects"),
    status: v.union(
      v.literal("planned"),
      v.literal("queued"),
      v.literal("in_progress"),
      v.literal("review"),
      v.literal("done"),
      v.literal("skipped"),
    ),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("workItems")
      .withIndex("by_project_and_status", q =>
        q.eq("projectId", args.projectId).eq("status", args.status),
      )
      .take(50);
  },
});

export const getWorkItemStats = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("workItems")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .take(200);

    const byStatus: Record<string, number> = {};
    const byCategory: Record<string, number> = {};
    const byPriority: Record<string, number> = {};

    for (const item of all) {
      byStatus[item.status] = (byStatus[item.status] ?? 0) + 1;
      byCategory[item.category] = (byCategory[item.category] ?? 0) + 1;
      byPriority[item.priority] = (byPriority[item.priority] ?? 0) + 1;
    }

    return {
      total: all.length,
      byStatus,
      byCategory,
      byPriority,
      completionPercent:
        all.length > 0
          ? Math.round(((byStatus.done ?? 0) / all.length) * 100)
          : 0,
    };
  },
});

export const clearWorkItems = mutation({
  args: { projectId: v.id("projects") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("workItems")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .take(200);
    for (const item of items) {
      await ctx.db.delete(item._id);
    }
    return null;
  },
});

// ─── TOPOLOGICAL SORT ───────────────────────────────────────────────────────

/**
 * Kahn's algorithm for topological sort.
 * Returns an array of batches — items in the same batch can run in parallel.
 */
function topologicalBatches(
  items: { id: string; dependsOn: string[] }[],
): string[][] {
  const inDegree: Record<string, number> = {};
  const adjacency: Record<string, string[]> = {};
  const idSet = new Set(items.map(i => i.id));

  for (const item of items) {
    inDegree[item.id] = 0;
    adjacency[item.id] = [];
  }

  for (const item of items) {
    for (const dep of item.dependsOn) {
      if (idSet.has(dep)) {
        adjacency[dep].push(item.id);
        inDegree[item.id]++;
      }
    }
  }

  const batches: string[][] = [];
  let queue = Object.entries(inDegree)
    .filter(([, deg]) => deg === 0)
    .map(([id]) => id);

  while (queue.length > 0) {
    batches.push([...queue]);
    const nextQueue: string[] = [];
    for (const node of queue) {
      for (const neighbor of adjacency[node]) {
        inDegree[neighbor]--;
        if (inDegree[neighbor] === 0) {
          nextQueue.push(neighbor);
        }
      }
    }
    queue = nextQueue;
  }

  return batches;
}

// ─── PLAN GENERATION ────────────────────────────────────────────────────────

const PLANNER_SYSTEM_PROMPT = `You are an expert software engineering planner. Given a gap analysis of a repository, generate a structured work plan.

Each work item must include:
- title: short descriptive title
- description: detailed description of what needs to be done
- category: one of "security", "feature", "test", "docs", "infra", "performance", "refactor"
- priority: "critical", "high", "medium", or "low"
- impact: 0-100 (how much this improves production readiness)
- effort: "trivial", "small", "medium", "large", or "epic"
- risk: "low", "medium", or "high"
- dependsOn: array of indices (0-based) of items this depends on
- filesAffected: array of file paths likely affected

Rules:
1. Order items by dependency — items with no dependencies first
2. Group related items into dependency chains
3. Critical security fixes always come first
4. Tests should depend on the features they test
5. Documentation should depend on the features it documents
6. Maximum 20 items per plan

OUTPUT ONLY valid JSON array of work items. No markdown, no explanation.`;

export const generatePlan = action({
  args: { projectId: v.id("projects") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    // 1. Fetch latest scores
    const scores = await ctx.runQuery(api.completionScore.getLatestScores, {
      projectId: args.projectId,
    });

    if (!scores) {
      return "No scores available. Run full analysis first.";
    }

    // 2. Fetch X-Ray report
    const xray = await ctx.runQuery(api.xray.getLatestXRay, {
      projectId: args.projectId,
    });

    // 3. Get file listing for context
    const files = await ctx.runQuery(api.files.listByProject, {
      projectId: args.projectId,
    });
    const fileList = files
      .filter((f: any) => !f.isDirectory)
      .map((f: any) => f.path)
      .join("\n");

    // 4. Build context for the planner
    const plannerContext = JSON.stringify(
      {
        scores: {
          overall: scores.overall,
          completion: scores.completion,
          productionReadiness: scores.productionReadiness,
          security: scores.security,
          maintainability: scores.maintainability,
          performance: scores.performance,
          deployment: scores.deployment,
        },
        gaps: JSON.parse(scores.gapAnalysis),
        findings: JSON.parse(scores.findings).slice(0, 30),
        xraySummary: xray?.summary ?? "No X-Ray summary available.",
      },
      null,
      2,
    );

    // 5. Emit thought
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "planner",
      agentName: "Engineering Planner",
      type: "plan",
      content: `📋 Generating engineering plan from ${scores.overall}/100 overall score...`,
      isStreaming: false,
    });

    // 6. Call AI to generate the plan
    const model = await getModelForRole(ctx, "architect");
    const { text } = await callAIWithFallback(
      [
        { role: "system", content: PLANNER_SYSTEM_PROMPT },
        {
          role: "user",
          content: `Repository analysis:\n${plannerContext}\n\nFile listing:\n${fileList}\n\nGenerate a structured work plan to bring this repository to production readiness.`,
        },
      ],
      { model },
    );

    // 7. Parse the AI response
    let workItems: WorkItemInput[] = [];
    try {
      const jsonMatch =
        text.match(/```(?:json)?\s*([\s\S]*?)```/) ??
        text.match(/(\[[\s\S]*\])/);
      const jsonStr = jsonMatch ? jsonMatch[1] : text.trim();
      workItems = JSON.parse(jsonStr!);
    } catch {
      return `Failed to parse plan: ${text.slice(0, 200)}`;
    }

    if (!Array.isArray(workItems) || workItems.length === 0) {
      return "No work items generated.";
    }

    // 8. Clear existing work items
    await ctx.runMutation(api.planner.clearWorkItems, {
      projectId: args.projectId,
    });

    // 9. Create work items in DB, mapping index-based deps to IDs
    const createdIds: string[] = [];
    for (let i = 0; i < workItems.length; i++) {
      const item = workItems[i];
      // Map dependsOn indices to actual IDs
      const resolvedDeps = (item.dependsOn ?? [])
        .filter(idx => idx >= 0 && idx < createdIds.length)
        .map(idx => createdIds[idx]);

      const validPriority = ["critical", "high", "medium", "low"].includes(
        item.priority,
      )
        ? item.priority
        : "medium";
      const validEffort = [
        "trivial",
        "small",
        "medium",
        "large",
        "epic",
      ].includes(item.effort)
        ? item.effort
        : "medium";
      const validRisk = ["low", "medium", "high"].includes(item.risk)
        ? item.risk
        : "medium";
      const validCategory = item.category || "feature";

      const id: Id<"workItems"> = await ctx.runMutation(
        api.planner.createWorkItem,
        {
          projectId: args.projectId,
          scoreId: scores._id,
          title: item.title || `Work Item ${i + 1}`,
          description: item.description || "",
          category: validCategory,
          priority: validPriority as "critical" | "high" | "medium" | "low",
          impact: Math.min(100, Math.max(0, item.impact ?? 50)),
          effort: validEffort as
            | "trivial"
            | "small"
            | "medium"
            | "large"
            | "epic",
          risk: validRisk as "low" | "medium" | "high",
          dependsOn: resolvedDeps,
          filesAffected: item.filesAffected ?? [],
          estimatedTokens: item.estimatedTokens,
        },
      );
      createdIds.push(id);
    }

    // 10. Emit completion
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "planner",
      agentName: "Engineering Planner",
      type: "done",
      content: `✅ Engineering plan created: ${createdIds.length} work items generated.`,
      isStreaming: false,
    });

    return `Plan created: ${createdIds.length} work items.`;
  },
});

// ─── EXECUTION ORDER ────────────────────────────────────────────────────────

export const getExecutionOrder = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const items = await ctx.db
      .query("workItems")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .take(200);

    const mapped = items.map(item => ({
      id: item._id as string,
      dependsOn: item.dependsOn,
    }));

    const batches = topologicalBatches(mapped);

    return {
      batches,
      totalItems: items.length,
      pendingItems: items.filter(
        i => i.status === "planned" || i.status === "queued",
      ).length,
      items: items.map(i => ({
        id: i._id,
        title: i.title,
        status: i.status,
        priority: i.priority,
        category: i.category,
        impact: i.impact,
        effort: i.effort,
        dependsOn: i.dependsOn,
      })),
    };
  },
});

// ─── AUTONOMOUS EXECUTION ───────────────────────────────────────────────────

export const startAutonomousExecution = action({
  args: { projectId: v.id("projects") },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    // 1. Get execution order
    const order = await ctx.runQuery(api.planner.getExecutionOrder, {
      projectId: args.projectId,
    });

    if (order.totalItems === 0) {
      return "No work items to execute. Generate a plan first.";
    }

    if (order.pendingItems === 0) {
      return "All work items already completed.";
    }

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "acse-executor",
      agentName: "ACSE Executor",
      type: "plan",
      content: `🏭 Starting autonomous execution: ${order.pendingItems} work items across ${order.batches.length} dependency batches...`,
      isStreaming: false,
    });

    let completedCount = 0;

    // 2. Execute batches in order
    for (let batchIdx = 0; batchIdx < order.batches.length; batchIdx++) {
      const batch = order.batches[batchIdx];

      // Get the actual items for this batch
      const batchItems = order.items.filter(
        i =>
          batch.includes(i.id as string) &&
          (i.status === "planned" || i.status === "queued"),
      );

      if (batchItems.length === 0) continue;

      await ctx.runMutation(api.agentThoughts.emit, {
        projectId: args.projectId,
        agentId: "acse-executor",
        agentName: "ACSE Executor",
        type: "broadcast",
        content: `📦 Batch ${batchIdx + 1}/${order.batches.length}: Executing ${batchItems.length} items (${batchItems.map(i => i.title).join(", ")})`,
        isStreaming: false,
      });

      // Execute each item in the batch (sequentially to stay within Convex limits)
      for (const item of batchItems) {
        try {
          // Mark as in_progress
          await ctx.runMutation(api.planner.updateWorkItemStatus, {
            workItemId: item.id,
            status: "in_progress",
          });

          // Run the agent mission for this work item via executeWorkItem
          const result: string = await ctx.runAction(
            api.engine.executeWorkItem,
            {
              projectId: args.projectId,
              workItemId: item.id as Id<"workItems">,
            },
          );

          // Mark as done
          await ctx.runMutation(api.planner.updateWorkItemStatus, {
            workItemId: item.id,
            status: "done",
            result: result.slice(0, 1000),
          });

          completedCount++;
        } catch (err) {
          const errorMsg = err instanceof Error ? err.message : String(err);
          await ctx.runMutation(api.planner.updateWorkItemStatus, {
            workItemId: item.id,
            status: "skipped",
            result: `Error: ${errorMsg}`,
          });
        }
      }
    }

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "acse-executor",
      agentName: "ACSE Executor",
      type: "complete",
      content: `✅ Autonomous execution complete: ${completedCount}/${order.pendingItems} work items executed.`,
      isStreaming: false,
    });

    return `Execution complete: ${completedCount}/${order.pendingItems} items.`;
  },
});

export const getWorkItem = query({
  args: { workItemId: v.id("workItems") },
  handler: async (ctx, args) => ctx.db.get(args.workItemId),
});
