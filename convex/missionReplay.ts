import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const recordMissionSnapshot = mutation({
  args: {
    projectId: v.id("projects"),
    stepNumber: v.number(),
    agentId: v.string(),
    agentName: v.string(),
    actionType: v.string(), // 'plan' | 'edit_file' | 'run_test' | 'verify' | 'commit'
    description: v.string(),
    diff: v.optional(v.string()),
    targetFile: v.optional(v.string()),
    status: v.string(), // 'pending' | 'success' | 'failed'
    tokensUsed: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    // Create an agent task tracking event matching mission timeline schema
    const taskId = await ctx.db.insert("agentTasks", {
      projectId: args.projectId,
      agentId: args.agentId,
      agentName: args.agentName,
      agentIcon: args.actionType === "edit_file" ? "✏️" : args.actionType === "run_test" ? "🧪" : "🤖",
      task: `[Step ${args.stepNumber}] ${args.actionType}: ${args.description}`,
      status: args.status === "failed" ? "failed" : args.status === "success" ? "done" : "running",
      filesChanged: args.targetFile ? [args.targetFile] : [],
      result: args.diff ? `Diff applied (${args.diff.length} bytes)` : undefined,
      startedAt: Date.now(),
      finishedAt: args.status !== "pending" ? Date.now() : undefined,
    });

    return {
      snapshotId: taskId,
      step: args.stepNumber,
      timestamp: Date.now(),
    };
  },
});

export const getMissionReplayTimeline = query({
  args: {
    projectId: v.id("projects"),
  },
  handler: async (ctx, args) => {
    const tasks = await ctx.db
      .query("agentTasks")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .collect();

    const timeline = tasks.map((task, index) => ({
      step: index + 1,
      id: task._id,
      agentId: task.agentId,
      agentName: task.agentName,
      agentIcon: task.agentIcon,
      taskDescription: task.task,
      status: task.status,
      filesChanged: task.filesChanged ?? [],
      result: task.result,
      timestamp: task.startedAt ?? task._creationTime,
      durationMs: task.finishedAt && task.startedAt ? task.finishedAt - task.startedAt : 0,
    }));

    return timeline.sort((a, b) => a.timestamp - b.timestamp);
  },
});
