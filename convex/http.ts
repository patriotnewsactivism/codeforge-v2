import { httpRouter } from "convex/server";
import { internal } from "./_generated/api";
import { httpAction } from "./_generated/server";
import { auth } from "./auth";
import { stripeWebhook } from "./stripe";

declare const process: { env: Record<string, string | undefined> };

// ─── Auth helper ─────────────────────────────────────────────────────────────

function verifyOrchestratorSecret(req: Request): boolean {
  const secret = process.env.RAILWAY_ORCHESTRATOR_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("Authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

function unauthorized(): Response {
  return new Response(JSON.stringify({ error: "Unauthorized" }), {
    status: 401,
    headers: { "Content-Type": "application/json" },
  });
}

function ok(data: unknown): Response {
  return new Response(JSON.stringify(data), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

function serverError(e: unknown): Response {
  const msg = e instanceof Error ? e.message : String(e);
  return new Response(JSON.stringify({ error: msg }), {
    status: 500,
    headers: { "Content-Type": "application/json" },
  });
}

// ─── Router ──────────────────────────────────────────────────────────────────

const http = httpRouter();
auth.addHttpRoutes(http);

// ─── Health check ─────────────────────────────────────────────────────────────

http.route({
  path: "/api/health",
  method: "GET",
  handler: httpAction(async (_ctx, _req) => {
    return new Response(
      JSON.stringify({
        ok: true,
        version: "2.0.0",
        uptime: null,
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json" },
      },
    );
  }),
});

// Stripe webhook
http.route({
  path: "/stripe/webhook",
  method: "POST",
  handler: stripeWebhook,
});

// ═══════════════════════════════════════════════════════════════
// SWARM ROUTES — used by Railway orchestrator
// ═══════════════════════════════════════════════════════════════

// GET /api/swarm/tasks/pending
http.route({
  path: "/api/swarm/tasks/pending",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const tasks = await ctx.runQuery(internal.swarm.getPendingTasks, {});
      return ok({ tasks });
    } catch (e) {
      return serverError(e);
    }
  }),
});

// POST /api/swarm/tasks/status
http.route({
  path: "/api/swarm/tasks/status",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as {
        taskId: string;
        status: string;
        errorMessage?: string;
        totalAgentsSpawned?: number;
        totalFilesChanged?: number;
        rootAgentId?: string;
      };
      const result = await ctx.runMutation(internal.swarm.updateTaskStatus, {
        taskId: body.taskId,
        status: body.status as "queued" | "running" | "done" | "error",
        errorMessage: body.errorMessage,
        totalAgentsSpawned: body.totalAgentsSpawned,
        totalFilesChanged: body.totalFilesChanged,
        rootAgentId: body.rootAgentId,
      });
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// POST /api/swarm/agents/spawn
http.route({
  path: "/api/swarm/agents/spawn",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as {
        taskId: string;
        projectId: string;
        agentUid: string;
        parentAgentUid?: string;
        role: string;
        assignment: string;
        depth: number;
        filesOwned?: string[];
      };
      const result = await ctx.runMutation(internal.swarm.spawnAgent, body);
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// POST /api/swarm/agents/status
http.route({
  path: "/api/swarm/agents/status",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as {
        taskId: string;
        agentUid: string;
        status: string;
        result?: string;
        errorMessage?: string;
      };
      const result = await ctx.runMutation(internal.swarm.updateAgentStatus, {
        taskId: body.taskId,
        agentUid: body.agentUid,
        status: body.status as "queued" | "running" | "done" | "error",
        result: body.result,
        errorMessage: body.errorMessage,
      });
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// GET /api/swarm/task/agents
http.route({
  path: "/api/swarm/task/agents",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const url = new URL(req.url);
      const taskId = url.searchParams.get("taskId") ?? "";
      const agents = await ctx.runQuery(internal.swarm.getTaskAgents, {
        taskId,
      });
      return ok({ agents });
    } catch (e) {
      return serverError(e);
    }
  }),
});

// POST /api/swarm/events
http.route({
  path: "/api/swarm/events",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as {
        taskId: string;
        projectId: string;
        agentUid: string;
        agentRole: string;
        type: string;
        content: string;
        metadata?: string;
      };
      const result = await ctx.runMutation(internal.swarm.logEvent, body);
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// POST /api/swarm/events/batch
http.route({
  path: "/api/swarm/events/batch",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as { events: unknown[] };
      const result = await ctx.runMutation(internal.swarm.logEventsBatch, {
        events: body.events as Parameters<
          typeof internal.swarm.logEventsBatch
        >[0]["events"] extends infer T
          ? T
          : never[],
      });
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// GET /api/swarm/project/files
http.route({
  path: "/api/swarm/project/files",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const url = new URL(req.url);
      const projectId = url.searchParams.get("projectId") ?? "";
      const files = await ctx.runQuery(internal.swarm.getProjectFiles, {
        projectId,
      });
      return ok({ files });
    } catch (e) {
      return serverError(e);
    }
  }),
});

// POST /api/swarm/files/write
http.route({
  path: "/api/swarm/files/write",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as {
        projectId: string;
        path: string;
        content: string;
      };
      const result = await ctx.runMutation(internal.swarm.writeFile, body);
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// POST /api/swarm/sandbox
http.route({
  path: "/api/swarm/sandbox",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as {
        taskId: string;
        projectId: string;
        agentUid: string;
        command: string;
        stdout?: string;
        stderr?: string;
        exitCode: number;
        durationMs: number;
      };
      const result = await ctx.runMutation(
        internal.swarm.logSandboxResult,
        body,
      );
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// ── Memory routes ────────────────────────────────────────────────────────────

// GET /api/memory/top
http.route({
  path: "/api/memory/top",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const url = new URL(req.url);
      const projectId = url.searchParams.get("projectId") ?? "";
      const limit = parseInt(url.searchParams.get("limit") ?? "20");
      const category = url.searchParams.get("category") ?? undefined;
      const result = await ctx.runQuery(internal.swarm.getTopMemories, {
        projectId,
        limit,
        category,
      });
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// POST /api/memory/create
http.route({
  path: "/api/memory/create",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as {
        projectId: string;
        category: string;
        title: string;
        content: string;
        importance?: number;
        sourceTaskId?: string;
        sourceAgentRole?: string;
      };
      const result = await ctx.runMutation(internal.swarm.createMemory, body);
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// POST /api/memory/use
http.route({
  path: "/api/memory/use",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as { memoryId: string };
      const result = await ctx.runMutation(internal.swarm.useMemory, body);
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// ── Retrospective routes ──────────────────────────────────────────────────────

// POST /api/retrospective/create
http.route({
  path: "/api/retrospective/create",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as Parameters<typeof ctx.runMutation>[1];
      const result = await ctx.runMutation(
        internal.swarm.createRetrospective,
        body as {
          taskId: string;
          projectId: string;
          taskSummary: string;
          totalAgents: number;
          totalFiles: number;
          durationMs: number;
          sandboxPassedFirst: boolean;
          reviewPassedFirst: boolean;
          retryCount: number;
          whatWorked: string[];
          whatFailed: string[];
          improvements: string[];
          newMemories: string[];
          qualityScore: number;
        },
      );
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// ── Agent message bus routes ──────────────────────────────────────────────────

// POST /api/agents/message
http.route({
  path: "/api/agents/message",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as {
        taskId: string;
        projectId: string;
        fromAgentUid: string;
        fromAgentRole: string;
        toAgentUid?: string;
        toAgentRole?: string;
        messageType: string;
        content: string;
      };
      const result = await ctx.runMutation(
        internal.swarm.sendAgentMessage,
        body,
      );
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// GET /api/agents/messages
http.route({
  path: "/api/agents/messages",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const url = new URL(req.url);
      const taskId = url.searchParams.get("taskId") ?? "";
      const agentUid = url.searchParams.get("agentUid") ?? "";
      const agentRole = url.searchParams.get("agentRole") ?? "";
      const result = await ctx.runQuery(internal.swarm.getMessagesForAgent, {
        taskId,
        agentUid,
        agentRole,
      });
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// ── RAG routes ────────────────────────────────────────────────────────────────

// POST /api/rag/index
http.route({
  path: "/api/rag/index",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as {
        projectId: string;
        files: Array<{ path: string; content: string; language?: string }>;
      };
      let totalChunks = 0;
      for (const file of body.files) {
        const result = await ctx.runMutation(internal.swarm.ragIndexFile, {
          projectId: body.projectId,
          path: file.path,
          content: file.content,
          language: file.language,
        });
        totalChunks += result.chunks;
      }
      return ok({ totalChunks, filesIndexed: body.files.length });
    } catch (e) {
      return serverError(e);
    }
  }),
});

// POST /api/rag/index-file
http.route({
  path: "/api/rag/index-file",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as {
        projectId: string;
        path: string;
        content: string;
        language?: string;
      };
      const result = await ctx.runMutation(internal.swarm.ragIndexFile, body);
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// GET /api/rag/search
http.route({
  path: "/api/rag/search",
  method: "GET",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const url = new URL(req.url);
      const projectId = url.searchParams.get("projectId") ?? "";
      const query = url.searchParams.get("query") ?? "";
      const limit = parseInt(url.searchParams.get("limit") ?? "15");
      const result = await ctx.runQuery(internal.swarm.ragSearch, {
        projectId,
        query,
        limit,
      });
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// ── Git routes ────────────────────────────────────────────────────────────────

// POST /api/git/branch
http.route({
  path: "/api/git/branch",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as {
        taskId: string;
        projectId: string;
        branchName: string;
        baseBranch?: string;
      };
      const result = await ctx.runMutation(
        internal.swarm.createGitBranch,
        body,
      );
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// POST /api/git/commit
http.route({
  path: "/api/git/commit",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as { taskId: string; commitSHA: string };
      const result = await ctx.runMutation(internal.swarm.addGitCommit, body);
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// POST /api/git/pr
http.route({
  path: "/api/git/pr",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    if (!verifyOrchestratorSecret(req)) return unauthorized();
    try {
      const body = (await req.json()) as {
        taskId: string;
        prNumber: number;
        prUrl: string;
      };
      const result = await ctx.runMutation(internal.swarm.setGitPR, body);
      return ok(result);
    } catch (e) {
      return serverError(e);
    }
  }),
});

// ═══════════════════════════════════════════════════════════════
// ERROR INGESTION — Sentry / Datadog / Bugsnag / custom webhook
// POST /api/error-ingest?projectId=<id>&source=sentry&autoFix=true
// Body: raw JSON payload from the error tracker
// ═══════════════════════════════════════════════════════════════

http.route({
  path: "/api/error-ingest",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    try {
      const url = new URL(req.url);
      const projectId = url.searchParams.get("projectId") ?? "";
      const source = url.searchParams.get("source") ?? "webhook";
      const repoFullName = url.searchParams.get("repo") ?? undefined;
      const autoFix = url.searchParams.get("autoFix") !== "false";

      if (!projectId) {
        return new Response(
          JSON.stringify({ error: "projectId query param required" }),
          {
            status: 400,
            headers: { "Content-Type": "application/json" },
          },
        );
      }

      const rawPayload = await req.text();

      // Delegate to the full ingest+autofix action
      const result = await ctx.runAction(
        internal.errorIngestion.ingestFromWebhookInternal,
        {
          projectId:
            projectId as unknown as import("./_generated/dataModel").Id<"projects">,
          source,
          rawPayload,
          autoFix,
          repoFullName,
        },
      );

      return new Response(JSON.stringify({ ok: true, ...result }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    } catch (e) {
      return serverError(e);
    }
  }),
});

export default http;
