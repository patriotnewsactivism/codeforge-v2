/**
 * mutation.ts — CodeForge Mutation Engine
 *
 * Layer 4 of the Learning Loop: applies approved changes from Forensic reports.
 *
 * When the Forensic Agent identifies a root cause, it proposes a mutation.
 * The Mutation Engine:
 *   1. Receives the proposed mutation from Forensic
 *   2. Queues it for Reflection Agent approval (nightly batch) OR applies immediately
 *      if the Reflection Agent has already approved it
 *   3. Applies mutations to: agent prompts, tool policies, model assignments,
 *      retry strategies — all persisted in the mutationLog table
 *   4. Each mutation is versioned — old versions are kept for rollback
 *
 * Critical: mutations are ADDITIVE patches, not full replacements.
 * A prompt mutation adds a line to the system prompt. It never rewrites it.
 */

import { v } from "convex/values";
import { api } from "./_generated/api";
import { action, mutation, query } from "./_generated/server";
import { callAIWithFallback, getModelForRole } from "./ai";

// ─── DB ──────────────────────────────────────────────────────────────────────

export const queueMutation = mutation({
  args: {
    projectId: v.id("projects"),
    reportId: v.id("forensicReports"),
    proposedMutation: v.string(),
    mutationTarget: v.union(
      v.literal("prompt"),
      v.literal("tool_policy"),
      v.literal("retry_strategy"),
      v.literal("model_assignment"),
      v.literal("none"),
    ),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    autoApply: v.boolean(),
  },
  returns: v.id("mutationLog"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("mutationLog", {
      ...args,
      status: args.autoApply ? "pending_apply" : "pending_review",
      createdAt: Date.now(),
      version: 1,
      rollbackAvailable: false,
    });
  },
});

export const updateMutationStatus = mutation({
  args: {
    mutationId: v.id("mutationLog"),
    status: v.union(
      v.literal("pending_review"),
      v.literal("pending_apply"),
      v.literal("applied"),
      v.literal("rejected"),
      v.literal("rolled_back"),
    ),
    appliedAt: v.optional(v.number()),
    appliedPatch: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { mutationId, ...patch } = args;
    const filtered = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined),
    );
    await ctx.db.patch(mutationId, filtered);
    return null;
  },
});

export const listMutations = query({
  args: {
    projectId: v.id("projects"),
    status: v.optional(
      v.union(
        v.literal("pending_review"),
        v.literal("pending_apply"),
        v.literal("applied"),
        v.literal("rejected"),
        v.literal("rolled_back"),
      ),
    ),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("mutationLog")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .take(args.limit ?? 50);
    if (args.status) return all.filter(m => m.status === args.status);
    return all;
  },
});

export const getActiveMutations = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("mutationLog")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .collect();
    return all.filter(m => m.status === "applied");
  },
});

// ─── CORE ACTION: applyMutation ───────────────────────────────────────────────

export const applyMutation = action({
  args: {
    projectId: v.id("projects"),
    reportId: v.id("forensicReports"),
    proposedMutation: v.string(),
    mutationTarget: v.union(
      v.literal("prompt"),
      v.literal("tool_policy"),
      v.literal("retry_strategy"),
      v.literal("model_assignment"),
      v.literal("none"),
    ),
    severity: v.union(
      v.literal("low"),
      v.literal("medium"),
      v.literal("high"),
      v.literal("critical"),
    ),
    autoApply: v.boolean(),
  },
  returns: v.object({
    mutationId: v.id("mutationLog"),
    status: v.string(),
    patch: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    if (args.mutationTarget === "none") {
      // Nothing to apply — just log it as rejected
      const mutationId = await ctx.runMutation(api.mutation.queueMutation, {
        ...args,
        autoApply: false,
      });
      await ctx.runMutation(api.mutation.updateMutationStatus, {
        mutationId,
        status: "rejected",
        rejectionReason: "Mutation target is 'none' — no change needed.",
      });
      return { mutationId, status: "rejected" };
    }

    // Queue the mutation
    const mutationId = await ctx.runMutation(api.mutation.queueMutation, args);

    if (!args.autoApply) {
      // Queued for Reflection Agent to review tonight
      await ctx.runMutation(api.agentThoughts.emit, {
        projectId: args.projectId,
        agentId: "mutation-engine",
        agentName: "⚙️ Mutation Engine",
        type: "action",
        content: `📋 Mutation queued for nightly review: [${args.mutationTarget}] ${args.proposedMutation.slice(0, 100)}…`,
        isStreaming: false,
      });
      return { mutationId, status: "pending_review" };
    }

    // Auto-apply: generate the patch using AI
    const patchPrompt = `You are the Mutation Engine in CodeForge — an autonomous coding platform.
A Forensic Agent has identified a failure and proposed a fix. Your job: convert the proposal into
a precise, minimal, machine-readable patch.

Mutation target: ${args.mutationTarget}
Proposed mutation: ${args.proposedMutation}

Output a single JSON object — the patch to apply:

For "prompt":
{
  "type": "prompt",
  "agentRole": "<role name>",
  "insertLine": "<the exact line to append to that agent's system prompt>",
  "rationale": "<why this helps>"
}

For "tool_policy":
{
  "type": "tool_policy",
  "agentRole": "<role>",
  "change": "allow" | "deny",
  "tool": "<tool name>",
  "rationale": "<why>"
}

For "model_assignment":
{
  "type": "model_assignment",
  "agentRole": "<role>",
  "newModel": "<model identifier>",
  "rationale": "<why>"
}

For "retry_strategy":
{
  "type": "retry_strategy",
  "failureClass": "<failure class>",
  "strategy": "<what to do differently on retry>",
  "maxRetries": <number>
}

JSON only, no other text.`;

    const { text: patchRaw } = await callAIWithFallback(patchPrompt, {
      model: getModelForRole("reviewer"),
      temperature: 0.1,
    });

    let patch = patchRaw;
    try {
      const jsonMatch =
        patchRaw.match(/```(?:json)?\s*([\s\S]*?)```/) ??
        patchRaw.match(/(\{[\s\S]*\})/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[1]! : patchRaw.trim());
      patch = JSON.stringify(parsed, null, 2);
    } catch {
      /* use raw */
    }

    await ctx.runMutation(api.mutation.updateMutationStatus, {
      mutationId,
      status: "applied",
      appliedAt: Date.now(),
      appliedPatch: patch,
    });

    await ctx.runMutation(api.forensic.markMutationApplied, {
      reportId: args.reportId,
    });

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "mutation-engine",
      agentName: "⚙️ Mutation Engine",
      type: "complete",
      content: `✅ Mutation applied [${args.mutationTarget}]: ${args.proposedMutation.slice(0, 120)}`,
      isStreaming: false,
    });

    return { mutationId, status: "applied", patch };
  },
});

// ─── ACTION: rollbackMutation ────────────────────────────────────────────────

export const rollbackMutation = action({
  args: {
    projectId: v.id("projects"),
    mutationId: v.id("mutationLog"),
    reason: v.string(),
  },
  returns: v.object({ success: v.boolean() }),
  handler: async (ctx, args) => {
    await ctx.runMutation(api.mutation.updateMutationStatus, {
      mutationId: args.mutationId,
      status: "rolled_back",
      rejectionReason: args.reason,
    });

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "mutation-engine",
      agentName: "⚙️ Mutation Engine",
      type: "error",
      content: `⏮️ Mutation rolled back: ${args.reason}`,
      isStreaming: false,
    });

    return { success: true };
  },
});
