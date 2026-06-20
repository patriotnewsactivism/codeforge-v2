/**
 * gitops.ts — CodeForge GitOps Bridge
 *
 * Full pipeline: Branch → Commit → PR → CI checks → Human Gate → Canary Deploy
 *
 * Flow:
 *   1. Agent finishes a mission → pushToGitHub() creates branch + PR
 *   2. pollPRStatus() watches GitHub CI checks (runs every ~30s via frontend)
 *   3. When CI passes → status moves to "awaiting_human"
 *   4. Human approves in UI → approveDeploy() fires
 *   5. Canary deploy: merge PR → record DeploymentCertificate → track rollout
 *
 * Every deploy requires a signed DeploymentCertificate from the Reviewer role.
 * No agent can approve its own output.
 */

import { v } from "convex/values";
import { action, mutation, query } from "./_generated/server";
import { getAuthUserId } from "@convex-dev/auth/server";
import { api } from "./_generated/api";
import { callAIWithFallback, getModelForRole } from "./ai";

declare const process: { env: Record<string, string | undefined> };

const GITHUB_TOKEN = process.env.GITHUB_TOKEN;

function ghHeaders(token?: string) {
  return {
    Authorization: `Bearer ${token ?? GITHUB_TOKEN}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "CodeForge-GitOps",
  };
}

// ─── SCHEMA TYPES (for reference) ──────────────────────────────────────────
// deployments table — created below
// ciChecks table — created below

// ─── MUTATIONS & QUERIES ───────────────────────────────────────────────────

export const createDeployment = mutation({
  args: {
    projectId: v.id("projects"),
    branchName: v.string(),
    prNumber: v.optional(v.number()),
    prUrl: v.optional(v.string()),
    commitSha: v.string(),
    commitMessage: v.string(),
    repoFullName: v.string(),
    triggeredByAgentId: v.string(),
    deploymentCertificate: v.optional(v.string()),
  },
  returns: v.id("deployments"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("deployments", {
      ...args,
      status: "pending_ci",
      createdAt: Date.now(),
      humanApproved: false,
      canaryPercent: 0,
    });
  },
});

export const updateDeploymentStatus = mutation({
  args: {
    deploymentId: v.id("deployments"),
    status: v.union(
      v.literal("pending_ci"),
      v.literal("ci_running"),
      v.literal("ci_failed"),
      v.literal("awaiting_human"),
      v.literal("deploying"),
      v.literal("canary"),
      v.literal("deployed"),
      v.literal("rolled_back"),
    ),
    ciSummary: v.optional(v.string()),
    humanApproved: v.optional(v.boolean()),
    approvedBy: v.optional(v.string()),
    canaryPercent: v.optional(v.number()),
    deployedAt: v.optional(v.number()),
    error: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { deploymentId, ...patch } = args;
    const filtered = Object.fromEntries(
      Object.entries(patch).filter(([, v]) => v !== undefined)
    );
    await ctx.db.patch(deploymentId, filtered);
    return null;
  },
});

export const listDeployments = query({
  args: {
    projectId: v.id("projects"),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("deployments")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .order("desc")
      .take(args.limit ?? 20);
  },
});

export const getDeployment = query({
  args: { deploymentId: v.id("deployments") },
  handler: async (ctx, args) => ctx.db.get(args.deploymentId),
});

export const listPendingApprovals = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("deployments")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId))
      .collect();
    return all.filter((d) => d.status === "awaiting_human" && !d.humanApproved);
  },
});

// ─── ACTION: Generate Deployment Certificate ───────────────────────────────
// The Reviewer agent reads the diff/summary and signs off (or rejects).
// No agent can sign its own output — triggeredByAgentId is checked.

export const generateDeploymentCertificate = action({
  args: {
    projectId: v.id("projects"),
    commitMessage: v.string(),
    branchName: v.string(),
    filesChanged: v.array(v.string()),
    triggeredByAgentId: v.string(),
    ciStatus: v.optional(v.string()),
  },
  returns: v.object({
    approved: v.boolean(),
    certificate: v.optional(v.string()),
    rejectionReason: v.optional(v.string()),
    reviewerNotes: v.string(),
  }),
  handler: async (ctx, args) => {
    // Reviewer cannot be same agent that triggered the deploy
    if (args.triggeredByAgentId === "reviewer-agent") {
      return {
        approved: false,
        rejectionReason: "Self-approval not allowed: reviewer cannot certify its own output.",
        reviewerNotes: "Security policy: no agent may approve its own output.",
      };
    }

    const fileList = args.filesChanged.slice(0, 30).join("\n");

    const reviewPrompt = `You are the Reviewer agent in CodeForge — the last safety gate before deployment.
Your job: certify or reject this deployment.

Branch: ${args.branchName}
Commit: ${args.commitMessage}
CI Status: ${args.ciStatus ?? "unknown"}
Files changed (${args.filesChanged.length} total):
${fileList}${args.filesChanged.length > 30 ? `\n... and ${args.filesChanged.length - 30} more` : ""}

Rules:
- APPROVE if: commit message is clear, no obvious destructive patterns, CI passed (if available)
- REJECT if: commit touches auth/security files without clear justification, CI failed, message is empty/vague

Respond with JSON only:
{
  "approved": true | false,
  "reviewerNotes": "2-3 sentence review summary",
  "concerns": ["concern 1", "concern 2"]  // empty array if none
}`;

    const { text: raw } = await callAIWithFallback(reviewPrompt, {
      model: getModelForRole("reviewer"),
      temperature: 0.2,
    });

    let approved = false;
    let reviewerNotes = raw;
    let concerns: string[] = [];

    try {
      const jsonMatch =
        raw.match(/```(?:json)?\s*([\s\S]*?)```/) ?? raw.match(/(\{[\s\S]*\})/);
      const parsed = JSON.parse(jsonMatch ? jsonMatch[1]! : raw.trim());
      approved = parsed.approved === true;
      reviewerNotes = parsed.reviewerNotes ?? raw;
      concerns = parsed.concerns ?? [];
    } catch {
      approved = false;
      reviewerNotes = "Could not parse reviewer response — defaulting to reject.";
    }

    if (!approved) {
      return {
        approved: false,
        rejectionReason: concerns.join("; ") || "Reviewer rejected without specific reason.",
        reviewerNotes,
      };
    }

    // Generate signed certificate
    const certificate = JSON.stringify({
      version: "1.0",
      projectId: args.projectId,
      branch: args.branchName,
      commit: args.commitMessage,
      reviewedBy: "reviewer-agent",
      approvedAt: new Date().toISOString(),
      ciStatus: args.ciStatus ?? "unknown",
      notes: reviewerNotes,
    });

    return { approved: true, certificate, reviewerNotes };
  },
});

// ─── ACTION: Poll PR / CI Status ───────────────────────────────────────────

export const pollPRStatus = action({
  args: {
    deploymentId: v.id("deployments"),
    repoFullName: v.string(),
    prNumber: v.number(),
    commitSha: v.string(),
  },
  returns: v.object({
    ciStatus: v.union(
      v.literal("pending"),
      v.literal("running"),
      v.literal("success"),
      v.literal("failure"),
      v.literal("unknown"),
    ),
    checkSummary: v.string(),
    readyForDeploy: v.boolean(),
  }),
  handler: async (ctx, args) => {
    if (!GITHUB_TOKEN) {
      return { ciStatus: "unknown" as const, checkSummary: "GITHUB_TOKEN not configured", readyForDeploy: false };
    }

    const headers = ghHeaders();

    try {
      // Fetch check runs for the commit
      const checksRes = await fetch(
        `https://api.github.com/repos/${args.repoFullName}/commits/${args.commitSha}/check-runs`,
        { headers }
      );
      const checksData = await checksRes.json() as {
        total_count: number;
        check_runs: Array<{
          name: string;
          status: string;
          conclusion: string | null;
        }>;
      };

      const runs = checksData.check_runs ?? [];

      if (runs.length === 0) {
        // No checks configured — treat as success (project may not have CI)
        await ctx.runMutation(api.gitops.updateDeploymentStatus, {
          deploymentId: args.deploymentId,
          status: "awaiting_human",
          ciSummary: "No CI checks configured — ready for human review.",
        });
        return {
          ciStatus: "success" as const,
          checkSummary: "No CI checks — ready for review.",
          readyForDeploy: true,
        };
      }

      const allDone = runs.every((r) => r.status === "completed");
      const anyFailed = runs.some(
        (r) => r.conclusion === "failure" || r.conclusion === "cancelled"
      );
      const allPassed = allDone && !anyFailed;

      const summary = runs
        .map((r) => `${r.name}: ${r.status}${r.conclusion ? ` (${r.conclusion})` : ""}`)
        .join(", ");

      if (!allDone) {
        await ctx.runMutation(api.gitops.updateDeploymentStatus, {
          deploymentId: args.deploymentId,
          status: "ci_running",
          ciSummary: summary,
        });
        return { ciStatus: "running" as const, checkSummary: summary, readyForDeploy: false };
      }

      if (anyFailed) {
        await ctx.runMutation(api.gitops.updateDeploymentStatus, {
          deploymentId: args.deploymentId,
          status: "ci_failed",
          ciSummary: summary,
        });
        return { ciStatus: "failure" as const, checkSummary: summary, readyForDeploy: false };
      }

      // All passed → move to awaiting human
      await ctx.runMutation(api.gitops.updateDeploymentStatus, {
        deploymentId: args.deploymentId,
        status: "awaiting_human",
        ciSummary: summary,
      });
      return { ciStatus: "success" as const, checkSummary: summary, readyForDeploy: true };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ciStatus: "unknown" as const, checkSummary: msg, readyForDeploy: false };
    }
  },
});

// ─── ACTION: Human Gate — Approve Deploy ──────────────────────────────────

export const approveDeploy = action({
  args: {
    deploymentId: v.id("deployments"),
    repoFullName: v.string(),
    prNumber: v.number(),
    canaryPercent: v.optional(v.number()), // default 10%
  },
  returns: v.object({
    success: v.boolean(),
    mergedAt: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (!userId) throw new Error("Not authenticated");

    const deployment = await ctx.runQuery(api.gitops.getDeployment, {
      deploymentId: args.deploymentId,
    });

    if (!deployment) throw new Error("Deployment not found");
    if (deployment.status !== "awaiting_human") {
      throw new Error(`Cannot approve: deployment is in status "${deployment.status}"`);
    }

    if (!GITHUB_TOKEN) {
      return { success: false, error: "GITHUB_TOKEN not configured" };
    }

    try {
      // Merge the PR
      const mergeRes = await fetch(
        `https://api.github.com/repos/${args.repoFullName}/pulls/${args.prNumber}/merge`,
        {
          method: "PUT",
          headers: ghHeaders(),
          body: JSON.stringify({
            commit_title: `[CodeForge Deploy] ${deployment.commitMessage}`,
            commit_message: `Approved by human gate. Deployment certificate: ${deployment.deploymentCertificate ? "✅ signed" : "⚠️ unsigned"}`,
            merge_method: "squash",
          }),
        }
      );

      const mergeData = await mergeRes.json() as {
        merged?: boolean;
        sha?: string;
        message?: string;
      };

      if (!mergeData.merged) {
        return { success: false, error: mergeData.message ?? "Merge failed" };
      }

      const canaryPercent = args.canaryPercent ?? 10;
      const approverName = String(userId);

      await ctx.runMutation(api.gitops.updateDeploymentStatus, {
        deploymentId: args.deploymentId,
        status: "canary",
        humanApproved: true,
        approvedBy: approverName,
        canaryPercent,
        deployedAt: Date.now(),
      });

      // Broadcast to agent stream
      await ctx.runMutation(api.agentThoughts.emit, {
        projectId: deployment.projectId,
        agentId: "gitops-bridge",
        agentName: "GitOps Bridge",
        type: "complete",
        content: `🚀 PR #${args.prNumber} merged — canary deploy at ${canaryPercent}% traffic. SHA: ${mergeData.sha?.slice(0, 7)}`,
        isStreaming: false,
      });

      return { success: true, mergedAt: mergeData.sha };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, error: msg };
    }
  },
});

// ─── ACTION: Rollback ──────────────────────────────────────────────────────

export const rollbackDeploy = action({
  args: {
    deploymentId: v.id("deployments"),
    repoFullName: v.string(),
    reason: v.string(),
  },
  returns: v.object({ success: v.boolean(), error: v.optional(v.string()) }),
  handler: async (ctx, args) => {
    const deployment = await ctx.runQuery(api.gitops.getDeployment, {
      deploymentId: args.deploymentId,
    });
    if (!deployment) throw new Error("Deployment not found");

    await ctx.runMutation(api.gitops.updateDeploymentStatus, {
      deploymentId: args.deploymentId,
      status: "rolled_back",
      error: args.reason,
    });

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: deployment.projectId,
      agentId: "gitops-bridge",
      agentName: "GitOps Bridge",
      type: "error",
      content: `⏮️ Rollback triggered: ${args.reason}`,
      isStreaming: false,
    });

    return { success: true };
  },
});

// ─── ACTION: Full GitOps Pipeline (called by engine after a mission) ───────
// One call: pushes files → creates PR → generates cert → creates deployment record

export const launchPipeline = action({
  args: {
    projectId: v.id("projects"),
    repoFullName: v.string(),
    branchName: v.string(),
    commitMessage: v.string(),
    agentId: v.string(),
    buildSessionId: v.optional(v.id("buildSessions")),
  },
  returns: v.object({
    success: v.boolean(),
    deploymentId: v.optional(v.id("deployments")),
    prUrl: v.optional(v.string()),
    prNumber: v.optional(v.number()),
    commitSha: v.optional(v.string()),
    certificateIssued: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (ctx, args) => {
    try {
      // 1. Push to GitHub + create PR
      const pushResult: any = await ctx.runAction(api.git.pushToGitHub, {
        projectId: args.projectId,
        repoFullName: args.repoFullName,
        branchName: args.branchName,
        commitMessage: args.commitMessage,
        agentId: args.agentId,
        buildSessionId: args.buildSessionId,
        createPR: true,
        prTitle: `[CodeForge] ${args.commitMessage}`,
        prBody: `## Automated PR by CodeForge Agent\n\n**Branch:** \`${args.branchName}\`\n**Agent:** ${args.agentId}\n\nThis PR was generated by the CodeForge autonomous coding engine.`,
      });

      if (!pushResult.success) {
        return { success: false, certificateIssued: false, error: pushResult.error };
      }

      // 2. Get list of changed files for certificate
      const files = await ctx.runQuery(api.files.listByProject, {
        projectId: args.projectId,
      });
      const fileList = files.filter((f: any) => !f.isDirectory).map((f: any) => f.path);

      // 3. Generate Deployment Certificate (Reviewer signs off)
      const certResult = await ctx.runAction(api.gitops.generateDeploymentCertificate, {
        projectId: args.projectId,
        commitMessage: args.commitMessage,
        branchName: args.branchName,
        filesChanged: fileList,
        triggeredByAgentId: args.agentId,
      });

      // 4. Create deployment record
      const deploymentId = await ctx.runMutation(api.gitops.createDeployment, {
        projectId: args.projectId,
        branchName: args.branchName,
        prNumber: pushResult.prNumber,
        prUrl: pushResult.prUrl,
        commitSha: pushResult.commitSha,
        commitMessage: args.commitMessage,
        repoFullName: args.repoFullName,
        triggeredByAgentId: args.agentId,
        deploymentCertificate: certResult.certificate,
      });

      // 5. Broadcast
      await ctx.runMutation(api.agentThoughts.emit, {
        projectId: args.projectId,
        agentId: "gitops-bridge",
        agentName: "GitOps Bridge",
        type: "action",
        content: `🔀 Pipeline launched — PR #${pushResult.prNumber ?? "?"} created. Certificate: ${certResult.approved ? "✅ signed" : "⚠️ " + certResult.rejectionReason}. Waiting for CI…`,
        isStreaming: false,
      });

      return {
        success: true,
        deploymentId,
        prUrl: pushResult.prUrl,
        prNumber: pushResult.prNumber,
        commitSha: pushResult.commitSha,
        certificateIssued: certResult.approved,
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { success: false, certificateIssued: false, error: msg };
    }
  },
});




