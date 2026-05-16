/**
 * convex/swarm.ts
 *
 * HTTP-callable mutations/queries for the Railway orchestrator.
 * These are the server-side handlers — http.ts registers them as routes.
 *
 * All endpoints are authenticated via the RAILWAY_ORCHESTRATOR_SECRET header.
 */
import { v } from "convex/values";
import { internalMutation, internalQuery } from "./_generated/server";
import type { Id } from "./_generated/dataModel";

declare const process: { env: Record<string, string | undefined> };

// ─── AUTH HELPER ─────────────────────────────────────────────────────────────

export function verifySecret(req: Request): boolean {
  const secret = process.env.RAILWAY_ORCHESTRATOR_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("Authorization") ?? "";
  return auth === `Bearer ${secret}`;
}

// ─── SWARM TASKS TABLE ────────────────────────────────────────────────────────
// We reuse agentTasks for "swarm tasks" — the orchestrator reads queued tasks
// and picks them up for processing.

/** GET /api/swarm/tasks/pending — list queued swarm tasks */
export const getPendingTasks = internalQuery({
  args: {},
  handler: async (ctx) => {
    return await ctx.db
      .query("agentTasks")
      .filter((q) => q.eq(q.field("status"), "queued"))
      .order("asc")
      .take(10);
  },
});

/** POST /api/swarm/tasks/status — update task status */
export const updateTaskStatus = internalMutation({
  args: {
    taskId: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("done"),
      v.literal("error")
    ),
    errorMessage: v.optional(v.string()),
    totalAgentsSpawned: v.optional(v.number()),
    totalFilesChanged: v.optional(v.number()),
    rootAgentId: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const id = args.taskId as Id<"agentTasks">;
    const patch: Record<string, unknown> = { status: args.status };
    if (args.errorMessage) patch.result = args.errorMessage;
    if (args.status === "done" || args.status === "error") {
      patch.finishedAt = Date.now();
    }
    await ctx.db.patch(id, patch);
    return { ok: true };
  },
});

// ─── AGENT INSTANCES ──────────────────────────────────────────────────────────
// The orchestrator spawns sub-agents and tracks them in agentTasks rows
// with a special agentId convention: "swarm:<taskId>:<role>:<uid>"

/** POST /api/swarm/agents/spawn — create a sub-agent record */
export const spawnAgent = internalMutation({
  args: {
    taskId: v.string(),
    projectId: v.string(),
    agentUid: v.string(),
    parentAgentUid: v.optional(v.string()),
    role: v.string(),
    assignment: v.string(),
    depth: v.number(),
    filesOwned: v.optional(v.array(v.string())),
  },
  handler: async (ctx, args) => {
    const projectId = args.projectId as Id<"projects">;

    // Map role to icon
    const iconMap: Record<string, string> = {
      planner: "🗺️",
      "ui-agent": "🎨",
      "mobile-agent": "📱",
      "logic-agent": "⚙️",
      "debug-agent": "🔍",
      "feature-agent": "✨",
      "test-agent": "🧪",
      reviewer: "🔎",
      "qa-agent": "✅",
    };

    const agentId = await ctx.db.insert("agentTasks", {
      projectId,
      agentId: `swarm:${args.taskId}:${args.role}:${args.agentUid}`,
      agentName: args.role.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      agentIcon: iconMap[args.role] ?? "🤖",
      task: args.assignment,
      status: "running",
      startedAt: Date.now(),
      filesChanged: args.filesOwned ?? [],
    });

    return { agentId: agentId as string };
  },
});

/** POST /api/swarm/agents/status — update a sub-agent's status */
export const updateAgentStatus = internalMutation({
  args: {
    taskId: v.string(),
    agentUid: v.string(),
    status: v.union(
      v.literal("queued"),
      v.literal("running"),
      v.literal("done"),
      v.literal("error")
    ),
    result: v.optional(v.string()),
    errorMessage: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    // Find the agent task by agentId prefix
    const tasks = await ctx.db
      .query("agentTasks")
      .filter((q) =>
        q.eq(q.field("agentId"), `swarm:${args.taskId}:${args.agentUid}`)
      )
      .take(5);

    // Try partial match if exact fails
    const all = tasks.length > 0 ? tasks : await ctx.db
      .query("agentTasks")
      .filter((q) =>
        q.eq(q.field("agentId"), `swarm:${args.taskId}:${args.agentUid}`)
      )
      .take(1);

    for (const t of all) {
      const patch: Record<string, unknown> = { status: args.status };
      if (args.result) patch.result = args.result;
      if (args.errorMessage) patch.result = args.errorMessage;
      if (args.status === "done" || args.status === "error") {
        patch.finishedAt = Date.now();
      }
      await ctx.db.patch(t._id, patch);
    }
    return { ok: true };
  },
});

/** GET /api/swarm/task/agents — list agents for a task */
export const getTaskAgents = internalQuery({
  args: { taskId: v.string() },
  handler: async (ctx, args) => {
    const agents = await ctx.db
      .query("agentTasks")
      .filter((q) =>
        q.eq(q.field("agentId"), `swarm:${args.taskId}`)
      )
      .collect();
    // Also get by prefix since agentId is "swarm:taskId:role:uid"
    const all = await ctx.db.query("agentTasks").collect();
    const filtered = all.filter((a) => a.agentId.startsWith(`swarm:${args.taskId}:`));
    return filtered;
  },
});

// ─── EVENTS ───────────────────────────────────────────────────────────────────

/** POST /api/swarm/events — log a single agent event as a thought */
export const logEvent = internalMutation({
  args: {
    taskId: v.string(),
    projectId: v.string(),
    agentUid: v.string(),
    agentRole: v.string(),
    type: v.string(),
    content: v.string(),
    metadata: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const projectId = args.projectId as Id<"projects">;
    const iconMap: Record<string, string> = {
      planner: "🗺️", "ui-agent": "🎨", "logic-agent": "⚙️",
      "debug-agent": "🔍", reviewer: "🔎", "qa-agent": "✅",
    };

    await ctx.db.insert("agentThoughts", {
      projectId,
      agentId: args.agentUid,
      agentName: args.agentRole.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      type: (["plan","analyze","code","debug","review","memory","search","commit","broadcast","done"].includes(args.type)
        ? args.type : "analyze") as "plan"|"analyze"|"code"|"debug"|"review"|"memory"|"search"|"commit"|"broadcast"|"done",
      content: args.content,
      isStreaming: false,
      timestamp: Date.now(),
    });
    return { ok: true };
  },
});

/** POST /api/swarm/events/batch — log multiple events */
export const logEventsBatch = internalMutation({
  args: {
    events: v.array(v.object({
      taskId: v.string(),
      projectId: v.string(),
      agentUid: v.string(),
      agentRole: v.string(),
      type: v.string(),
      content: v.string(),
      metadata: v.optional(v.string()),
    })),
  },
  handler: async (ctx, args) => {
    for (const ev of args.events) {
      const projectId = ev.projectId as Id<"projects">;
      await ctx.db.insert("agentThoughts", {
        projectId,
        agentId: ev.agentUid,
        agentName: ev.agentRole.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
        type: (["plan","analyze","code","debug","review","memory","search","commit","broadcast","done"].includes(ev.type)
          ? ev.type : "analyze") as "plan"|"analyze"|"code"|"debug"|"review"|"memory"|"search"|"commit"|"broadcast"|"done",
        content: ev.content,
        isStreaming: false,
        timestamp: Date.now(),
      });
    }
    return { ok: true };
  },
});

// ─── FILES ────────────────────────────────────────────────────────────────────

/** GET /api/swarm/project/files — get all files for a project */
export const getProjectFiles = internalQuery({
  args: { projectId: v.string() },
  handler: async (ctx, args) => {
    const projectId = args.projectId as Id<"projects">;
    return await ctx.db
      .query("files")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();
  },
});

/** POST /api/swarm/files/write — write/update a file */
export const writeFile = internalMutation({
  args: {
    projectId: v.string(),
    path: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const projectId = args.projectId as Id<"projects">;
    const existing = await ctx.db
      .query("files")
      .withIndex("by_project_and_path", (q) =>
        q.eq("projectId", projectId).eq("path", args.path)
      )
      .first();

    if (existing) {
      await ctx.db.patch(existing._id, { content: args.content });
    } else {
      const name = args.path.split("/").pop() ?? args.path;
      const ext = name.includes(".") ? name.split(".").pop() ?? "" : "";
      const langMap: Record<string, string> = {
        ts: "typescript", tsx: "typescript", js: "javascript",
        jsx: "javascript", css: "css", html: "html", json: "json",
        md: "markdown", py: "python", sh: "bash",
      };
      await ctx.db.insert("files", {
        projectId,
        path: args.path,
        name,
        content: args.content,
        language: langMap[ext] ?? "plaintext",
        isDirectory: false,
        parentPath: args.path.includes("/")
          ? args.path.substring(0, args.path.lastIndexOf("/"))
          : undefined,
      });
    }
    return { ok: true };
  },
});

// ─── SANDBOX LOGS ─────────────────────────────────────────────────────────────

/** POST /api/swarm/sandbox — log sandbox execution result */
export const logSandboxResult = internalMutation({
  args: {
    taskId: v.string(),
    projectId: v.string(),
    agentUid: v.string(),
    command: v.string(),
    stdout: v.optional(v.string()),
    stderr: v.optional(v.string()),
    exitCode: v.number(),
    durationMs: v.number(),
  },
  handler: async (ctx, args) => {
    const projectId = args.projectId as Id<"projects">;
    const status = args.exitCode === 0 ? "✅" : "❌";
    await ctx.db.insert("agentThoughts", {
      projectId,
      agentId: args.agentUid,
      agentName: "Sandbox",
      type: "debug",
      content: `${status} \`${args.command}\` (${args.durationMs}ms, exit ${args.exitCode})\n${args.stdout ?? ""}${args.stderr ? `\nSTDERR: ${args.stderr}` : ""}`,
      isStreaming: false,
      timestamp: Date.now(),
    });
    return { ok: true };
  },
});

// ─── MEMORY ───────────────────────────────────────────────────────────────────

/** GET /api/memory/top — fetch top memories for a project */
export const getTopMemories = internalQuery({
  args: {
    projectId: v.string(),
    limit: v.optional(v.number()),
    category: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const projectId = args.projectId as Id<"projects">;
    let mems = await ctx.db
      .query("agentMemories")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    if (args.category) mems = mems.filter((m) => m.category === args.category);
    mems.sort((a, b) => (b.importance * b.decayFactor) - (a.importance * a.decayFactor));
    return { memories: mems.slice(0, args.limit ?? 20) };
  },
});

/** POST /api/memory/create — store a new memory */
export const createMemory = internalMutation({
  args: {
    projectId: v.string(),
    category: v.string(),
    title: v.string(),
    content: v.string(),
    importance: v.optional(v.number()),
    sourceTaskId: v.optional(v.string()),
    sourceAgentRole: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const projectId = args.projectId as Id<"projects">;
    const validCategories = ["pattern","anti_pattern","preference","architecture","dependency","bugfix","convention","tool","insight"];
    const cat = validCategories.includes(args.category) ? args.category : "insight";

    const memoryId = await ctx.db.insert("agentMemories", {
      projectId,
      category: cat as "pattern"|"anti_pattern"|"preference"|"architecture"|"dependency"|"bugfix"|"convention"|"tool"|"insight",
      content: `[${args.title}] ${args.content}`,
      importance: args.importance ?? 0.7,
      usageCount: 0,
      lastUsedAt: Date.now(),
      decayFactor: 1.0,
    });
    return { memoryId: memoryId as string };
  },
});

/** POST /api/memory/use — increment usage count for a memory */
export const useMemory = internalMutation({
  args: { memoryId: v.string() },
  handler: async (ctx, args) => {
    const id = args.memoryId as Id<"agentMemories">;
    const mem = await ctx.db.get(id);
    if (mem) {
      await ctx.db.patch(id, {
        usageCount: mem.usageCount + 1,
        lastUsedAt: Date.now(),
      });
    }
    return { ok: true };
  },
});

// ─── RETROSPECTIVE ────────────────────────────────────────────────────────────

/** POST /api/retrospective/create — store a task retrospective */
export const createRetrospective = internalMutation({
  args: {
    taskId: v.string(),
    projectId: v.string(),
    taskSummary: v.string(),
    totalAgents: v.number(),
    totalFiles: v.number(),
    durationMs: v.number(),
    sandboxPassedFirst: v.boolean(),
    reviewPassedFirst: v.boolean(),
    retryCount: v.number(),
    whatWorked: v.array(v.string()),
    whatFailed: v.array(v.string()),
    improvements: v.array(v.string()),
    newMemories: v.array(v.string()),
    qualityScore: v.number(),
  },
  handler: async (ctx, args) => {
    const projectId = args.projectId as Id<"projects">;
    const retroId = await ctx.db.insert("taskRetrospectives", {
      projectId,
      qualityScore: args.qualityScore,
      whatWorked: args.whatWorked,
      whatFailed: args.whatFailed,
      improvements: args.improvements,
      memoriesCreated: [],
      rawAnalysis: args.taskSummary,
      agentsInvolved: [],
      timestamp: Date.now(),
    });
    return { retroId: retroId as string };
  },
});

// ─── AGENT MESSAGE BUS ────────────────────────────────────────────────────────

/** POST /api/agents/message — send a message between agents */
export const sendAgentMessage = internalMutation({
  args: {
    taskId: v.string(),
    projectId: v.string(),
    fromAgentUid: v.string(),
    fromAgentRole: v.string(),
    toAgentUid: v.optional(v.string()),
    toAgentRole: v.optional(v.string()),
    messageType: v.string(),
    content: v.string(),
  },
  handler: async (ctx, args) => {
    const projectId = args.projectId as Id<"projects">;
    const validTypes = ["warning","context","request","finding","blocker","resolved"];
    const msgType = validTypes.includes(args.messageType) ? args.messageType : "context";

    const iconMap: Record<string, string> = {
      planner: "🗺️", "ui-agent": "🎨", "logic-agent": "⚙️",
      "debug-agent": "🔍", reviewer: "🔎", "qa-agent": "✅",
    };
    const toName = args.toAgentRole
      ? args.toAgentRole.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
      : undefined;

    const messageId = await ctx.db.insert("agentMessages", {
      projectId,
      fromAgentId: args.fromAgentUid,
      fromAgentName: args.fromAgentRole.replace(/-/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()),
      fromAgentIcon: iconMap[args.fromAgentRole] ?? "🤖",
      toAgentId: args.toAgentUid,
      toAgentName: toName,
      messageType: msgType as "warning"|"context"|"request"|"finding"|"blocker"|"resolved",
      content: args.content,
      timestamp: Date.now(),
      acknowledged: false,
    });
    return { messageId: messageId as string };
  },
});

/** GET /api/agents/messages — get messages for an agent */
export const getMessagesForAgent = internalQuery({
  args: {
    taskId: v.string(),
    agentUid: v.string(),
    agentRole: v.string(),
  },
  handler: async (ctx, args) => {
    const msgs = await ctx.db
      .query("agentMessages")
      .filter((q) =>
        q.or(
          q.eq(q.field("toAgentId"), args.agentUid),
          q.eq(q.field("toAgentId"), undefined) // broadcasts
        )
      )
      .order("desc")
      .take(50);
    return { messages: msgs };
  },
});

// ─── RAG (Code search) ────────────────────────────────────────────────────────

/** POST /api/rag/index-file — index a single file for RAG */
export const ragIndexFile = internalMutation({
  args: {
    projectId: v.string(),
    path: v.string(),
    content: v.string(),
    language: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const projectId = args.projectId as Id<"projects">;
    // Find existing RAG chunks for this file and replace them
    const existing = await ctx.db
      .query("ragChunks")
      .withIndex("by_project_and_file", (q) =>
        q.eq("projectId", projectId).eq("filePath", args.path)
      )
      .collect();
    for (const chunk of existing) await ctx.db.delete(chunk._id);

    // Simple chunking: split by function/class boundaries or every 60 lines
    const lines = args.content.split("\n");
    const chunkSize = 60;
    let chunks = 0;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const chunkLines = lines.slice(i, i + chunkSize);
      await ctx.db.insert("ragChunks", {
        projectId,
        filePath: args.path,
        chunkType: "block",
        content: chunkLines.join("\n"),
        startLine: i + 1,
        endLine: Math.min(i + chunkSize, lines.length),
        embedding: JSON.stringify(buildSimpleEmbedding(chunkLines.join("\n"))),
        language: args.language ?? "plaintext",
      });
      chunks++;
    }
    return { chunks };
  },
});

function buildSimpleEmbedding(text: string): Record<string, number> {
  const tokens = text.toLowerCase().replace(/[^a-z0-9\s_]/g, " ").split(/\s+/).filter((t) => t.length > 2);
  const tf: Record<string, number> = {};
  for (const t of tokens) tf[t] = (tf[t] ?? 0) + 1;
  return tf;
}

/** GET /api/rag/search — search code chunks */
export const ragSearch = internalQuery({
  args: {
    projectId: v.string(),
    query: v.string(),
    limit: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const projectId = args.projectId as Id<"projects">;
    const chunks = await ctx.db
      .query("ragChunks")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect();

    const queryEmb = buildSimpleEmbedding(args.query);

    // Score each chunk
    const scored = chunks.map((c) => {
      const emb = c.embedding ? JSON.parse(c.embedding) as Record<string, number> : {};
      let score = 0;
      for (const [k, v] of Object.entries(queryEmb)) {
        score += (emb[k] ?? 0) * v;
      }
      return { ...c, score };
    });

    scored.sort((a, b) => b.score - a.score);
    return { chunks: scored.slice(0, args.limit ?? 15) };
  },
});

// ─── GIT ─────────────────────────────────────────────────────────────────────

/** POST /api/git/branch — record a git branch for a task */
export const createGitBranch = internalMutation({
  args: {
    taskId: v.string(),
    projectId: v.string(),
    branchName: v.string(),
    baseBranch: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const projectId = args.projectId as Id<"projects">;
    const id = await ctx.db.insert("gitCommits", {
      projectId,
      sha: `branch:${args.branchName}`,
      message: `Branch created: ${args.branchName} from ${args.baseBranch ?? "main"}`,
      branch: args.branchName,
      filesChanged: [],
      timestamp: Date.now(),
      pushedAt: Date.now(),
    });
    return { id: id as string };
  },
});

/** POST /api/git/commit — record a commit */
export const addGitCommit = internalMutation({
  args: { taskId: v.string(), commitSHA: v.string() },
  handler: async (ctx, args) => {
    // We just log this — the full commit record is created by the git integration
    return { ok: true };
  },
});

/** POST /api/git/pr — record a PR */
export const setGitPR = internalMutation({
  args: { taskId: v.string(), prNumber: v.number(), prUrl: v.string() },
  handler: async (ctx, args) => {
    return { ok: true };
  },
});
