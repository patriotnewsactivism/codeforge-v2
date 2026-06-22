/**
 * errorIngestion.ts — Live Error Ingestion
 *
 * Connect your production error tracker (Sentry, Datadog, Bugsnag, custom).
 * When a real production error fires, CodeForge AUTOMATICALLY:
 *   1. Receives the error via webhook (POST /api/error-ingest)
 *   2. Deduplicates (same error within 10 min = same incident)
 *   3. Forensic Agent diagnoses the root cause in the codebase
 *   4. Spawns a Fixer agent to write a patch
 *   5. Opens a PR with the fix
 *   6. Notifies the user
 *
 * Bug reported at 3am → PR open by 3:05am. Zero human involvement.
 */

import { v } from "convex/values";
import { api, internal } from "./_generated/api";
import {
  action,
  internalAction,
  internalQuery,
  mutation,
  query,
} from "./_generated/server";
import { callAIWithFallback, getModelForRole } from "./ai";

// ─── DB ──────────────────────────────────────────────────────────────────────

export const recordIncident = mutation({
  args: {
    projectId: v.id("projects"),
    source: v.union(
      v.literal("sentry"),
      v.literal("datadog"),
      v.literal("bugsnag"),
      v.literal("cloudwatch"),
      v.literal("webhook"),
      v.literal("manual"),
    ),
    errorType: v.string(),
    errorMessage: v.string(),
    stackTrace: v.optional(v.string()),
    affectedFile: v.optional(v.string()),
    affectedFunction: v.optional(v.string()),
    environment: v.optional(v.string()), // "production", "staging"
    occurrenceCount: v.number(),
    rawPayload: v.optional(v.string()), // raw webhook body
    fingerprint: v.string(), // for deduplication
  },
  returns: v.id("errorIncidents"),
  handler: async (ctx, args) => {
    // Deduplication: same fingerprint within last 10 minutes
    const tenMinAgo = Date.now() - 10 * 60 * 1000;
    const existing = await ctx.db
      .query("errorIncidents")
      .withIndex("by_project_fingerprint", q =>
        q.eq("projectId", args.projectId).eq("fingerprint", args.fingerprint),
      )
      .filter(q => q.gte(q.field("createdAt"), tenMinAgo))
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, {
        occurrenceCount: existing.occurrenceCount + 1,
        lastSeenAt: Date.now(),
      });
      return existing._id;
    }

    return await ctx.db.insert("errorIncidents", {
      ...args,
      status: "new",
      createdAt: Date.now(),
      lastSeenAt: Date.now(),
      autoFixAttempted: false,
    });
  },
});

export const updateIncidentStatus = mutation({
  args: {
    incidentId: v.id("errorIncidents"),
    status: v.union(
      v.literal("new"),
      v.literal("analyzing"),
      v.literal("fixing"),
      v.literal("pr_opened"),
      v.literal("resolved"),
      v.literal("wont_fix"),
    ),
    prUrl: v.optional(v.string()),
    fixSummary: v.optional(v.string()),
    forensicReportId: v.optional(v.id("forensicReports")),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const { incidentId, ...patch } = args;
    await ctx.db.patch(incidentId, {
      ...Object.fromEntries(
        Object.entries(patch).filter(([, v]) => v !== undefined),
      ),
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const listIncidents = query({
  args: {
    projectId: v.id("projects"),
    status: v.optional(v.string()),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const all = await ctx.db
      .query("errorIncidents")
      .withIndex("by_project", q => q.eq("projectId", args.projectId))
      .order("desc")
      .take(args.limit ?? 50);
    if (args.status) return all.filter(i => i.status === args.status);
    return all;
  },
});

export const getIncidentById = internalQuery({
  args: { incidentId: v.id("errorIncidents") },
  handler: async (ctx, args) => ctx.db.get(args.incidentId),
});

// ─── CORE ACTION: autoFix ─────────────────────────────────────────────────────

export const autoFix = action({
  args: {
    projectId: v.id("projects"),
    incidentId: v.id("errorIncidents"),
    repoFullName: v.optional(v.string()),
  },
  returns: v.object({
    success: v.boolean(),
    prUrl: v.optional(v.string()),
    fixSummary: v.optional(v.string()),
    error: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    success: boolean;
    prUrl?: string;
    fixSummary?: string;
    error?: string;
  }> => {
    const incident: any = await ctx.runQuery(
      internal.errorIngestion.getIncidentById,
      { incidentId: args.incidentId },
    );
    if (!incident) return { success: false, error: "Incident not found" };

    await ctx.runMutation(api.errorIngestion.updateIncidentStatus, {
      incidentId: args.incidentId,
      status: "analyzing",
    });

    // Broadcast
    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "error-ingestion",
      agentName: "🚨 Error Ingestion",
      type: "action",
      content: `Analyzing production error: ${incident.errorType} — ${incident.errorMessage.slice(0, 100)}`,
      isStreaming: false,
    });

    // ── Step 1: Find the relevant file in the project ─────────────────────
    let codeContext = "";
    if (incident.affectedFile) {
      const file = await ctx.runQuery(api.files.getByPath, {
        projectId: args.projectId,
        path: incident.affectedFile,
      });
      if (file)
        codeContext = `\nAffected file content:\n\`\`\`\n${(file as any).content?.slice(0, 3000) ?? ""}\n\`\`\``;
    }

    // ── Step 2: Forensic analysis ─────────────────────────────────────────
    const forensicResult = await ctx.runAction(
      api.forensic.runForensicAnalysis,
      {
        projectId: args.projectId,
        failureSummary: `Production error [${incident.source}]: ${incident.errorType}\n${incident.errorMessage}`,
        toolCallErrors: incident.stackTrace ? [incident.stackTrace] : undefined,
      },
    );

    await ctx.runMutation(api.errorIngestion.updateIncidentStatus, {
      incidentId: args.incidentId,
      status: "fixing",
      forensicReportId: forensicResult.reportId,
    });

    // ── Step 3: Generate the fix ──────────────────────────────────────────
    const fixPrompt = `You are a senior engineer fixing a production error in a live codebase.

Error type: ${incident.errorType}
Error message: ${incident.errorMessage}
Affected file: ${incident.affectedFile ?? "unknown"}
Affected function: ${incident.affectedFunction ?? "unknown"}
Environment: ${incident.environment ?? "production"}

Stack trace:
${incident.stackTrace?.slice(0, 2000) ?? "Not available"}
${codeContext}

Root cause analysis: ${forensicResult.rootCause}

Write ONLY the fixed code for the affected file/function.
- Minimal change — fix the bug, don't refactor
- Preserve all existing functionality
- Add a comment explaining what you fixed
- If you cannot determine the fix with confidence, say so explicitly

Output the complete fixed code block.`;

    const { text: fixCode } = await callAIWithFallback(fixPrompt, {
      model: await getModelForRole(ctx, "coder"),
      temperature: 0.2,
    });

    // ── Step 4: Apply fix to project file ────────────────────────────────
    if (incident.affectedFile) {
      const file = await ctx.runQuery(api.files.getByPath, {
        projectId: args.projectId,
        path: incident.affectedFile,
      });
      if (file) {
        await ctx.runMutation(api.files.updateContent, {
          fileId: (file as any)._id,
          content: fixCode,
        });
      }
    }

    // ── Step 5: Open a PR via GitOps bridge ───────────────────────────────
    let prUrl: string | undefined;
    if (args.repoFullName) {
      const branch = `fix/auto-${incident.errorType
        .toLowerCase()
        .replace(/[^a-z0-9]/g, "-")
        .slice(0, 30)}-${Date.now()}`;
      const pipelineResult = await ctx.runAction(api.gitops.launchPipeline, {
        projectId: args.projectId,
        repoFullName: args.repoFullName,
        branchName: branch,
        commitMessage: `fix: auto-patch ${incident.errorType} — ${incident.errorMessage.slice(0, 60)}`,
        agentId: "error-ingestion-agent",
      });
      prUrl = pipelineResult.prUrl;
    }

    const fixSummary = `Auto-fixed ${incident.errorType}: ${forensicResult.rootCause}`;

    await ctx.runMutation(api.errorIngestion.updateIncidentStatus, {
      incidentId: args.incidentId,
      status: prUrl ? "pr_opened" : "resolved",
      prUrl,
      fixSummary,
    });

    await ctx.runMutation(api.agentThoughts.emit, {
      projectId: args.projectId,
      agentId: "error-ingestion",
      agentName: "🚨 Error Ingestion",
      type: "complete",
      content: `✅ Auto-fix complete${prUrl ? ` — PR opened: ${prUrl}` : ""}.\n${fixSummary}`,
      isStreaming: false,
    });

    return { success: true, prUrl, fixSummary };
  },
});

// ─── ACTION: ingestFromWebhook ────────────────────────────────────────────────
// Parses raw webhook payloads from Sentry, Datadog, Bugsnag

export const ingestFromWebhook = action({
  args: {
    projectId: v.id("projects"),
    source: v.string(),
    rawPayload: v.string(),
    autoFix: v.boolean(),
    repoFullName: v.optional(v.string()),
  },
  returns: v.object({
    incidentId: v.optional(v.id("errorIncidents")),
    autoFixTriggered: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    incidentId?: any;
    autoFixTriggered: boolean;
    error?: string;
  }> => {
    let payload: Record<string, any>;
    try {
      payload = JSON.parse(args.rawPayload);
    } catch {
      return { autoFixTriggered: false, error: "Invalid JSON payload" };
    }

    // ── Parse by source ───────────────────────────────────────────────────
    let errorType = "UnknownError";
    let errorMessage = "Unknown error";
    let stackTrace: string | undefined;
    let affectedFile: string | undefined;

    if (args.source === "sentry") {
      // Sentry webhook format
      const event = payload.event ?? payload;
      errorType = event.exception?.values?.[0]?.type ?? event.level ?? "Error";
      errorMessage =
        event.exception?.values?.[0]?.value ?? event.message ?? "Unknown";
      stackTrace = event.exception?.values?.[0]?.stacktrace?.frames
        ?.map((f: any) => `  at ${f.function} (${f.filename}:${f.lineno})`)
        ?.join("\n");
      affectedFile =
        event.exception?.values?.[0]?.stacktrace?.frames?.slice(-1)?.[0]
          ?.filename;
    } else if (args.source === "datadog") {
      errorType = payload.title ?? "DatadogAlert";
      errorMessage = payload.body ?? payload.text ?? "No message";
    } else if (args.source === "bugsnag") {
      errorType = payload.error?.errorClass ?? "Error";
      errorMessage = payload.error?.message ?? "Unknown";
      stackTrace = payload.error?.stacktrace
        ?.map((f: any) => `  at ${f.method} (${f.file}:${f.lineNumber})`)
        .join("\n");
      affectedFile = payload.error?.stacktrace?.[0]?.file;
    } else {
      // Generic webhook
      errorType = payload.type ?? payload.name ?? "Error";
      errorMessage =
        payload.message ??
        payload.description ??
        JSON.stringify(payload).slice(0, 200);
      stackTrace = payload.stackTrace ?? payload.stack;
      affectedFile = payload.file ?? payload.filename;
    }

    const fingerprint = `${args.projectId}:${errorType}:${affectedFile ?? ""}`;

    const incidentId: any = await ctx.runMutation(
      api.errorIngestion.recordIncident,
      {
        projectId: args.projectId,
        source: args.source as any,
        errorType,
        errorMessage,
        stackTrace,
        affectedFile,
        environment: payload.environment ?? payload.env ?? "production",
        occurrenceCount: 1,
        rawPayload: args.rawPayload.slice(0, 5000),
        fingerprint,
      },
    );

    let autoFixTriggered = false;
    if (args.autoFix) {
      // Fire and forget — don't await (let it run async)
      ctx
        .runAction(api.errorIngestion.autoFix, {
          projectId: args.projectId,
          incidentId,
          repoFullName: args.repoFullName,
        })
        .catch(() => {});
      autoFixTriggered = true;
    }

    return { incidentId, autoFixTriggered };
  },
});

// ── Internal alias used by http.ts httpAction ─────────────────────────────────
// httpActions can only call ctx.runAction(internal.*) — this wraps the public action.
export const ingestFromWebhookInternal = internalAction({
  args: {
    projectId: v.id("projects"),
    source: v.string(),
    rawPayload: v.string(),
    autoFix: v.boolean(),
    repoFullName: v.optional(v.string()),
  },
  returns: v.object({
    incidentId: v.optional(v.id("errorIncidents")),
    autoFixTriggered: v.boolean(),
    error: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    incidentId?: any;
    autoFixTriggered: boolean;
    error?: string;
  }> => {
    // Delegate to the full public action handler (same logic, internal surface)
    return await ctx.runAction(api.errorIngestion.ingestFromWebhook, args);
  },
});
