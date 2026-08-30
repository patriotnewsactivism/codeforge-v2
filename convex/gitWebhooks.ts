import { v } from "convex/values";
import { mutation, query } from "./_generated/server";

export interface GitConflictAnalysis {
  hasConflict: boolean;
  conflictingFiles: string[];
  suggestedResolution?: string;
}

export const detectBranchConflicts = query({
  args: {
    baseBranch: v.string(),
    headBranch: v.string(),
    baseFiles: v.array(v.object({ path: v.string(), hash: v.string() })),
    headFiles: v.array(v.object({ path: v.string(), hash: v.string() })),
    ancestorFiles: v.optional(v.array(v.object({ path: v.string(), hash: v.string() }))),
  },
  handler: async (_ctx, args) => {
    const baseMap = new Map(args.baseFiles.map(f => [f.path, f.hash]));
    const headMap = new Map(args.headFiles.map(f => [f.path, f.hash]));
    const ancestorMap = new Map((args.ancestorFiles || []).map(f => [f.path, f.hash]));

    const conflictingFiles: string[] = [];

    for (const [path, headHash] of headMap.entries()) {
      const baseHash = baseMap.get(path);
      const ancHash = ancestorMap.get(path);

      if (baseHash && baseHash !== headHash) {
        if (ancHash && baseHash !== ancHash && headHash !== ancHash) {
          conflictingFiles.push(path);
        } else if (!ancHash) {
          conflictingFiles.push(path);
        }
      }
    }

    return {
      hasConflict: conflictingFiles.length > 0,
      conflictingFiles,
      suggestedResolution: conflictingFiles.length > 0
        ? `Resolve parallel edits in: ${conflictingFiles.join(", ")}. Recommended rebase onto ${args.baseBranch}.`
        : `Clean merge possible between ${args.headBranch} and ${args.baseBranch}.`,
    };
  },
});

export const recordGitWebhookEvent = mutation({
  args: {
    projectId: v.id("projects"),
    provider: v.string(), // 'github' | 'gitlab'
    event: v.string(),    // 'pull_request' | 'push' | 'merge_request'
    action: v.string(),   // 'opened' | 'synchronize' | 'closed'
    prNumber: v.optional(v.number()),
    sourceBranch: v.string(),
    targetBranch: v.string(),
    sender: v.string(),
    payloadSummary: v.string(),
  },
  handler: async (ctx, args) => {
    // Ensure project exists
    const project = await ctx.db.get(args.projectId);
    if (!project) {
      throw new Error("Project not found");
    }

    const now = Date.now();
    // Touch project metadata for PR sync
    await ctx.db.patch(args.projectId, {
      updatedAt: now,
    });

    return {
      status: "processed",
      recordedAt: now,
      prNumber: args.prNumber,
      action: args.action,
    };
  },
});
