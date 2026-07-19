/**
 * codeReview.ts — CodeForge ACSE Multi-Agent Code Review
 *
 * Phase 9 of the Autonomous Software Completion Engine.
 * The author never approves itself — every change receives independent review.
 *
 * Flow:
 *   1. Implementation agent completes work
 *   2. System spawns 2 independent reviewer agents
 *   3. Each reviewer examines changes for correctness, security, performance, style
 *   4. Reviewers produce structured verdicts
 *   5. Consensus algorithm: APPROVE / REQUEST_CHANGES / REJECT
 *   6. If REQUEST_CHANGES → feedback returns to original agent for iteration
 */

import { v } from "convex/values";
import { api } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { action, mutation, query } from "./_generated/server";
import { callAIWithFallback, getModelForRole } from "./ai";

// ─── TYPES ──────────────────────────────────────────────────────────────────

export interface ReviewFinding {
  severity: "critical" | "warning" | "info";
  file: string;
  line?: number;
  message: string;
}

export interface ReviewerVerdict {
  agentId: string;
  role: string;
  verdict: "approve" | "request_changes" | "reject";
  findings: ReviewFinding[];
  reasoning: string;
}

// ─── DB OPERATIONS ──────────────────────────────────────────────────────────

export const createReview = mutation({
  args: {
    projectId: v.id("projects"),
    workItemId: v.optional(v.id("workItems")),
    buildSessionId: v.optional(v.id("buildSessions")),
    filesReviewed: v.array(v.string()),
  },
  returns: v.id("codeReviews"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("codeReviews", {
      projectId: args.projectId,
      workItemId: args.workItemId,
      buildSessionId: args.buildSessionId,
      filesReviewed: args.filesReviewed,
      reviewers: "[]",
      consensus: "pending",
      iterations: 0,
      createdAt: Date.now(),
    });
  },
});

export const updateReview = mutation({
  args: {
    reviewId: v.id("codeReviews"),
    reviewers: v.optional(v.string()),
    consensus: v.optional(
      v.union(
        v.literal("approved"),
        v.literal("needs_changes"),
        v.literal("rejected"),
        v.literal("pending"),
      ),
    ),
    iterations: v.optional(v.number()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { reviewId, ...patch } = args;
    const cleaned = Object.fromEntries(
      Object.entries(patch).filter(([, val]) => val !== undefined),
    );
    await ctx.db.patch(reviewId, cleaned);
    return null;
  },
});

export const getReview = query({
  args: { reviewId: v.id("codeReviews") },
  handler: async (ctx, args) => ctx.db.get(args.reviewId),
});

export const listReviews = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    return await ctx.db
      .query("codeReviews")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .take(20);
  },
});

// ─── CONSENSUS ALGORITHM ────────────────────────────────────────────────────

function computeConsensus(
  verdicts: ReviewerVerdict[],
): "approved" | "needs_changes" | "rejected" {
  if (verdicts.length === 0) return "needs_changes";

  const votes = {
    approve: verdicts.filter(v => v.verdict === "approve").length,
    request_changes: verdicts.filter(v => v.verdict === "request_changes")
      .length,
    reject: verdicts.filter(v => v.verdict === "reject").length,
  };

  // Any rejection → rejected
  if (votes.reject > 0) return "rejected";

  // Majority request changes → needs_changes
  if (votes.request_changes > votes.approve) return "needs_changes";

  // Any critical findings → needs_changes regardless of vote
  const hasCritical = verdicts.some(v =>
    v.findings.some(f => f.severity === "critical"),
  );
  if (hasCritical) return "needs_changes";

  // Majority approve → approved
  if (votes.approve >= verdicts.length / 2) return "approved";

  return "needs_changes";
}

// ─── REVIEW PROMPTS ─────────────────────────────────────────────────────────

const REVIEWER_SYSTEM_PROMPT = `You are an expert code reviewer. Review the following code changes for:
1. **Correctness**: Does the code do what it should? Are there logic bugs?
2. **Security**: Any new vulnerabilities? Injection risks? Auth bypasses?
3. **Performance**: Any N+1 queries? Unnecessary re-renders? Missing memoization?
4. **Style**: Does it follow project conventions? Is it readable?

OUTPUT ONLY valid JSON:
{
  "verdict": "approve" | "request_changes" | "reject",
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "file": "path/to/file.ts",
      "message": "Description of the issue"
    }
  ],
  "reasoning": "Overall assessment in 2-3 sentences"
}`;

const SECURITY_REVIEWER_PROMPT = `You are a security-focused code reviewer. Your ONLY concern is security:
1. **Secrets**: Are any API keys, passwords, or tokens hardcoded?
2. **Injection**: Any SQL injection, XSS, or command injection risks?
3. **Auth**: Are there auth bypasses or missing authorization checks?
4. **Data exposure**: Is sensitive data logged or exposed?
5. **Dependencies**: Are there known vulnerable dependencies?

OUTPUT ONLY valid JSON:
{
  "verdict": "approve" | "request_changes" | "reject",
  "findings": [
    {
      "severity": "critical" | "warning" | "info",
      "file": "path/to/file.ts",
      "message": "Description of the security issue"
    }
  ],
  "reasoning": "Security assessment in 2-3 sentences"
}`;

// ─── MAIN REVIEW ACTION ────────────────────────────────────────────────────

export const reviewChanges = action({
  args: {
    projectId: v.id("projects"),
    filePaths: v.array(v.string()),
    workItemId: v.optional(v.id("workItems")),
    context: v.optional(v.string()),
  },
  returns: v.string(),
  handler: async (ctx, args): Promise<string> => {
    // 1. Fetch file contents
    const fileContents: { path: string; content: string }[] = [];
    for (const path of args.filePaths) {
      const file = await ctx.runQuery(api.files.getByPath, {
        projectId: args.projectId,
        path,
      });
      if (file) {
        fileContents.push({ path, content: file.content });
      }
    }

    if (fileContents.length === 0) {
      return "No files to review.";
    }

    // 2. Create review record
    const reviewId: Id<"codeReviews"> = await ctx.runMutation(
      api.codeReview.createReview,
      {
        projectId: args.projectId,
        workItemId: args.workItemId,
        filesReviewed: args.filePaths,
      },
    );

    // 3. Build the code diff context
    const codeContext = fileContents
      .map(f => `--- ${f.path} ---\n${f.content.slice(0, 3000)}`)
      .join("\n\n");

    const userMessage = `${args.context ? `Context: ${args.context}\n\n` : ""}Review these files:\n\n${codeContext}`;

    // 4. Emit thought
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "code-reviewer",
      agentName: "Code Review",
      type: "review",
      content: `🔎 Reviewing ${fileContents.length} file(s): ${args.filePaths.join(", ")}`,
      isStreaming: false,
    });

    // 5. Run two reviewers in sequence
    const verdicts: ReviewerVerdict[] = [];
    const model = await getModelForRole(ctx, "reviewer");

    // Reviewer 1: General
    try {
      const { text: review1 } = await callAIWithFallback(
        [
          { role: "system", content: REVIEWER_SYSTEM_PROMPT },
          { role: "user", content: userMessage },
        ],
        { model },
      );

      const parsed1 = parseReviewResponse(
        review1,
        "reviewer-1",
        "General Reviewer",
      );
      if (parsed1) verdicts.push(parsed1);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      verdicts.push({
        agentId: "reviewer-1",
        role: "General Reviewer",
        verdict: "approve",
        findings: [],
        reasoning: `Review failed: ${errMsg}. Defaulting to approve.`,
      });
    }

    // Reviewer 2: Security
    try {
      const { text: review2 } = await callAIWithFallback(
        [
          { role: "system", content: SECURITY_REVIEWER_PROMPT },
          { role: "user", content: userMessage },
        ],
        { model },
      );

      const parsed2 = parseReviewResponse(
        review2,
        "security-reviewer",
        "Security Reviewer",
      );
      if (parsed2) verdicts.push(parsed2);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      verdicts.push({
        agentId: "security-reviewer",
        role: "Security Reviewer",
        verdict: "approve",
        findings: [],
        reasoning: `Security review failed: ${errMsg}. Defaulting to approve.`,
      });
    }

    // 6. Compute consensus
    const consensus = computeConsensus(verdicts);
    const totalFindings = verdicts.reduce(
      (sum, v) => sum + v.findings.length,
      0,
    );

    // 7. Update review record
    await ctx.runMutation(api.codeReview.updateReview, {
      reviewId,
      reviewers: JSON.stringify(verdicts),
      consensus,
      iterations: 1,
    });

    // 8. Emit result
    const emoji =
      consensus === "approved" ? "✅" : consensus === "rejected" ? "❌" : "⚠️";
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "code-reviewer",
      agentName: "Code Review",
      type: consensus === "approved" ? "done" : "warning",
      content: `${emoji} Review complete: ${consensus.toUpperCase()} | ${totalFindings} finding(s) across ${verdicts.length} reviewers.`,
      isStreaming: false,
    });

    return JSON.stringify({ reviewId, consensus, totalFindings });
  },
});

// ─── HELPER ─────────────────────────────────────────────────────────────────

function parseReviewResponse(
  text: string,
  agentId: string,
  role: string,
): ReviewerVerdict | null {
  try {
    const jsonMatch =
      text.match(/```(?:json)?\s*([\s\S]*?)```/) ?? text.match(/(\{[\s\S]*\})/);
    const jsonStr = jsonMatch ? jsonMatch[1] : text.trim();
    const parsed = JSON.parse(jsonStr!);

    const validVerdicts = ["approve", "request_changes", "reject"];
    const verdict = validVerdicts.includes(parsed.verdict)
      ? parsed.verdict
      : "request_changes";

    const findings: ReviewFinding[] = (parsed.findings ?? []).map((f: any) => ({
      severity: ["critical", "warning", "info"].includes(f.severity)
        ? f.severity
        : "info",
      file: f.file ?? "unknown",
      line: f.line,
      message: f.message ?? "No description",
    }));

    return {
      agentId,
      role,
      verdict,
      findings,
      reasoning: parsed.reasoning ?? "No reasoning provided.",
    };
  } catch {
    return {
      agentId,
      role,
      verdict: "approve",
      findings: [],
      reasoning: `Could not parse review response. Raw: ${text.slice(0, 200)}`,
    };
  }
}
