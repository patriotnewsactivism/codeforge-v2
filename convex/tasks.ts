import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export const listTasks = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("agentTasks")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .take(50);
  },
});

export const createTask = mutation({
  args: {
    projectId: v.id("projects"),
    buildSessionId: v.optional(v.id("buildSessions")),
    agentId: v.string(),
    agentName: v.string(),
    agentIcon: v.string(),
    task: v.string(),
  },
  handler: async (ctx, args) => {
    return await ctx.db.insert("agentTasks", {
      ...args,
      status: "queued",
      startedAt: Date.now(),
    });
  },
});

export const updateTask = mutation({
  args: {
    taskId: v.id("agentTasks"),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("done"),
      v.literal("error"),
    ),
    result: v.optional(v.string()),
    filesChanged: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const patch: Record<string, unknown> = { status: args.status };
    if (args.result !== undefined) patch.result = args.result;
    if (args.filesChanged !== undefined) patch.filesChanged = args.filesChanged;
    if (args.status === "done" || args.status === "error") {
      patch.finishedAt = Date.now();
    }
    await ctx.db.patch(args.taskId, patch);
    return null;
  },
});
