import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { config } from "./config.js";
import { one, sql, withTransaction } from "./db.js";

function requireOrchestrator(request: FastifyRequest): void {
  if (!config.RAILWAY_ORCHESTRATOR_SECRET) {
    throw Object.assign(
      new Error("Orchestrator integration is disabled"),
      { statusCode: 503 },
    );
  }

  const authorization = request.headers.authorization ?? "";
  const [scheme, token] = authorization.split(" ", 2);

  if (
    scheme?.toLowerCase() !== "bearer" ||
    token !== config.RAILWAY_ORCHESTRATOR_SECRET
  ) {
    throw Object.assign(new Error("Orchestrator access denied"), {
      statusCode: 401,
    });
  }
}

function milliseconds(value: unknown): number {
  if (value instanceof Date) {
    return value.getTime();
  }

  return new Date(String(value)).getTime();
}

function swarmTask(row: Record<string, unknown>) {
  return {
    _id: String(row.id),
    projectId: String(row.project_id),
    userId: String(row.user_id),
    prompt: String(row.prompt),
    status: String(row.status),
    priority: String(row.priority),
    startedAt: milliseconds(row.started_at),
  };
}

function swarmAgent(row: Record<string, unknown>) {
  return {
    _id: String(row.id),
    taskId: String(row.task_id),
    projectId: String(row.project_id),
    agentUid: String(row.agent_uid),
    parentAgentUid: row.parent_agent_uid ?? undefined,
    role: String(row.role),
    status: String(row.status),
    assignment: String(row.assignment),
    depth: Number(row.depth),
    filesOwned: row.files_owned ?? [],
    result: row.result ?? undefined,
    errorMessage: row.error_message ?? undefined,
  };
}

function chunkFile(
  content: string,
  chunkSize = 200,
): Array<{ content: string; startLine: number; endLine: number }> {
  const lines = content.split("\n");
  const chunks = [];

  for (let index = 0; index < lines.length; index += chunkSize) {
    const slice = lines.slice(index, index + chunkSize);
    chunks.push({
      content: slice.join("\n"),
      startLine: index + 1,
      endLine: index + slice.length,
    });
  }

  return chunks.length > 0
    ? chunks
    : [{ content: "", startLine: 1, endLine: 1 }];
}

async function indexOneFile(input: {
  projectId: string;
  path: string;
  content: string;
  language?: string;
}): Promise<number> {
  const chunks = chunkFile(input.content);

  await withTransaction(async (client) => {
    await client.query(
      `delete from code_chunks
       where project_id = $1
         and file_path = $2`,
      [input.projectId, input.path],
    );

    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index]!;
      await client.query(
        `insert into code_chunks(
           project_id,
           file_path,
           chunk_index,
           content,
           start_line,
           end_line,
           language
         )
         values($1, $2, $3, $4, $5, $6, $7)`,
        [
          input.projectId,
          input.path,
          index,
          chunk.content,
          chunk.startLine,
          chunk.endLine,
          input.language ?? null,
        ],
      );
    }
  });

  return chunks.length;
}

export async function registerSwarmRoutes(
  app: FastifyInstance,
): Promise<void> {
  app.addHook("onRequest", async (request) => {
    if (
      request.url.startsWith("/api/swarm/") ||
      request.url.startsWith("/api/memory/") ||
      request.url.startsWith("/api/retrospective/") ||
      request.url.startsWith("/api/agents/") ||
      request.url.startsWith("/api/rag/") ||
      request.url.startsWith("/api/git/")
    ) {
      requireOrchestrator(request);
    }
  });

  app.get("/api/swarm/tasks/pending", async () => {
    const result = await sql(
      `select *
       from swarm_tasks
       where status = 'pending'
       order by
         case priority
           when 'critical' then 0
           when 'high' then 1
           when 'normal' then 2
           else 3
         end,
         created_at asc
       limit 25`,
    );

    return {
      tasks: result.rows.map((row) => swarmTask(row)),
    };
  });

  app.post("/api/swarm/claim", async (request) => {
    const body = z
      .object({
        taskId: z.string().min(1),
        workerId: z.string().min(1).max(300),
      })
      .parse(request.body);

    const result = await sql(
      `update swarm_tasks
       set status = 'running',
           worker_id = $2,
           heartbeat_at = now(),
           attempts = attempts + 1,
           updated_at = now()
       where id = $1
         and status = 'pending'
       returning id`,
      [body.taskId, body.workerId],
    );

    return {
      claimed: result.rowCount === 1,
    };
  });

  app.post("/api/swarm/heartbeat", async (request) => {
    const body = z
      .object({
        taskId: z.string().min(1),
        workerId: z.string().min(1).max(300),
      })
      .parse(request.body);

    await sql(
      `update swarm_tasks
       set heartbeat_at = now(),
           updated_at = now()
       where id = $1
         and worker_id = $2
         and status = 'running'`,
      [body.taskId, body.workerId],
    );

    return { ok: true };
  });

  app.post("/api/swarm/reclaim", async () => {
    return withTransaction(async (client) => {
      const stale = await client.query(
        `select id, attempts, max_attempts
         from swarm_tasks
         where status = 'running'
           and heartbeat_at < now() - interval '2 minutes'
         for update skip locked`,
      );

      const requeued: string[] = [];
      const failed: string[] = [];

      for (const row of stale.rows) {
        const terminal = Number(row.attempts) >= Number(row.max_attempts);
        await client.query(
          `update swarm_tasks
           set status = $2,
               worker_id = null,
               heartbeat_at = null,
               error_message = case
                 when $2 = 'failed' then coalesce(error_message, 'Worker heartbeat expired')
                 else error_message
               end,
               completed_at = case when $2 = 'failed' then now() else null end,
               updated_at = now()
           where id = $1`,
          [row.id, terminal ? "failed" : "pending"],
        );

        (terminal ? failed : requeued).push(String(row.id));
      }

      return { requeued, failed };
    });
  });

  app.post("/api/swarm/tasks/status", async (request) => {
    const body = z
      .object({
        taskId: z.string().min(1),
        status: z.enum(["pending", "running", "completed", "failed"]),
        errorMessage: z.string().optional(),
        totalAgentsSpawned: z.number().int().optional(),
        totalFilesChanged: z.number().int().optional(),
        rootAgentId: z.string().optional(),
      })
      .parse(request.body);

    await sql(
      `update swarm_tasks
       set status = $2,
           error_message = coalesce($3, error_message),
           total_agents_spawned = coalesce($4, total_agents_spawned),
           total_files_changed = coalesce($5, total_files_changed),
           root_agent_id = coalesce($6, root_agent_id),
           completed_at = case
             when $2 in ('completed', 'failed') then now()
             else completed_at
           end,
           updated_at = now()
       where id = $1`,
      [
        body.taskId,
        body.status,
        body.errorMessage ?? null,
        body.totalAgentsSpawned ?? null,
        body.totalFilesChanged ?? null,
        body.rootAgentId ?? null,
      ],
    );

    return { ok: true };
  });

  app.post("/api/swarm/agents/spawn", async (request) => {
    const body = z
      .object({
        taskId: z.string().min(1),
        projectId: z.string().min(1),
        agentUid: z.string().min(1),
        parentAgentUid: z.string().optional(),
        role: z.string().min(1),
        assignment: z.string().min(1),
        depth: z.number().int().min(0),
        filesOwned: z.array(z.string()).optional(),
      })
      .parse(request.body);

    const result = await sql(
      `insert into swarm_agents(
         task_id,
         project_id,
         agent_uid,
         parent_agent_uid,
         role,
         status,
         assignment,
         depth,
         files_owned
       )
       values($1, $2, $3, $4, $5, 'running', $6, $7, $8::jsonb)
       on conflict(task_id, agent_uid)
       do update
       set status = 'running',
           assignment = excluded.assignment,
           files_owned = excluded.files_owned,
           updated_at = now()
       returning id`,
      [
        body.taskId,
        body.projectId,
        body.agentUid,
        body.parentAgentUid ?? null,
        body.role,
        body.assignment,
        body.depth,
        JSON.stringify(body.filesOwned ?? []),
      ],
    );

    return {
      agentId: String(one(result).id),
    };
  });

  app.post("/api/swarm/agents/status", async (request) => {
    const body = z
      .object({
        taskId: z.string().min(1),
        agentUid: z.string().min(1),
        status: z.string().min(1),
        result: z.string().optional(),
        errorMessage: z.string().optional(),
      })
      .parse(request.body);

    await sql(
      `update swarm_agents
       set status = $3,
           result = coalesce($4, result),
           error_message = coalesce($5, error_message),
           updated_at = now()
       where task_id = $1
         and agent_uid = $2`,
      [
        body.taskId,
        body.agentUid,
        body.status,
        body.result ?? null,
        body.errorMessage ?? null,
      ],
    );

    return { ok: true };
  });

  app.get("/api/swarm/task/agents", async (request) => {
    const query = z
      .object({
        taskId: z.string().min(1),
      })
      .parse(request.query);

    const result = await sql(
      `select *
       from swarm_agents
       where task_id = $1
       order by created_at asc`,
      [query.taskId],
    );

    return {
      agents: result.rows.map((row) => swarmAgent(row)),
    };
  });

  app.post("/api/swarm/events", async (request) => {
    const body = z
      .object({
        taskId: z.string().min(1),
        projectId: z.string().min(1),
        agentUid: z.string().min(1),
        agentRole: z.string().min(1),
        type: z.string().min(1),
        content: z.string(),
        metadata: z.string().optional(),
      })
      .parse(request.body);

    await sql(
      `insert into swarm_events(
         task_id,
         project_id,
         agent_uid,
         agent_role,
         event_type,
         content,
         metadata
       )
       values($1, $2, $3, $4, $5, $6, $7)`,
      [
        body.taskId,
        body.projectId,
        body.agentUid,
        body.agentRole,
        body.type,
        body.content,
        body.metadata ?? null,
      ],
    );

    return { ok: true };
  });

  app.post("/api/swarm/events/batch", async (request) => {
    const body = z
      .object({
        events: z.array(
          z.object({
            taskId: z.string().min(1),
            projectId: z.string().min(1),
            agentUid: z.string().min(1),
            agentRole: z.string().min(1),
            type: z.string().min(1),
            content: z.string(),
            metadata: z.string().optional(),
          }),
        ),
      })
      .parse(request.body);

    await withTransaction(async (client) => {
      for (const event of body.events) {
        await client.query(
          `insert into swarm_events(
             task_id,
             project_id,
             agent_uid,
             agent_role,
             event_type,
             content,
             metadata
           )
           values($1, $2, $3, $4, $5, $6, $7)`,
          [
            event.taskId,
            event.projectId,
            event.agentUid,
            event.agentRole,
            event.type,
            event.content,
            event.metadata ?? null,
          ],
        );
      }
    });

    return { ok: true };
  });

  app.get("/api/swarm/project/files", async (request) => {
    const query = z
      .object({
        projectId: z.string().min(1),
      })
      .parse(request.query);

    const result = await sql(
      `select *
       from files
       where project_id = $1
       order by path asc`,
      [query.projectId],
    );

    return {
      files: result.rows.map((row) => ({
        _id: String(row.id),
        projectId: String(row.project_id),
        path: String(row.path),
        name: String(row.name),
        content: String(row.content ?? ""),
        language: row.language ?? undefined,
        isDirectory: Boolean(row.is_directory),
      })),
    };
  });

  app.post("/api/swarm/files/write", async (request) => {
    const body = z
      .object({
        projectId: z.string().min(1),
        path: z.string().min(1),
        content: z.string(),
      })
      .parse(request.body);

    const name = body.path.split("/").filter(Boolean).at(-1) ?? body.path;

    await sql(
      `insert into files(project_id, path, name, content, is_directory)
       values($1, $2, $3, $4, false)
       on conflict(project_id, path)
       do update
       set name = excluded.name,
           content = excluded.content,
           updated_at = now()`,
      [body.projectId, body.path, name, body.content],
    );

    return { ok: true };
  });

  app.post("/api/swarm/sandbox", async (request) => {
    const body = z
      .object({
        taskId: z.string().min(1),
        projectId: z.string().min(1),
        agentUid: z.string().min(1),
        command: z.string(),
        stdout: z.string().optional(),
        stderr: z.string().optional(),
        exitCode: z.number().int(),
        durationMs: z.number().int().nonnegative(),
      })
      .parse(request.body);

    await sql(
      `insert into sandbox_results(
         task_id,
         project_id,
         agent_uid,
         command,
         stdout,
         stderr,
         exit_code,
         duration_ms
       )
       values($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        body.taskId,
        body.projectId,
        body.agentUid,
        body.command,
        body.stdout ?? null,
        body.stderr ?? null,
        body.exitCode,
        body.durationMs,
      ],
    );

    return { ok: true };
  });

  app.get("/api/memory/top", async (request) => {
    const query = z
      .object({
        projectId: z.string().min(1),
        limit: z.coerce.number().int().min(1).max(100).default(20),
        category: z.string().optional(),
      })
      .parse(request.query);

    const result = await sql(
      `select *
       from swarm_memories
       where project_id = $1
         and ($2::text is null or category = $2)
       order by (importance * decay_factor) desc, last_used_at desc
       limit $3`,
      [query.projectId, query.category ?? null, query.limit],
    );

    return {
      memories: result.rows.map((row) => ({
        _id: String(row.id),
        category: String(row.category),
        title: String(row.title ?? row.category),
        content: String(row.content),
        importance: Number(row.importance),
        usageCount: Number(row.usage_count),
      })),
    };
  });

  app.post("/api/memory/create", async (request) => {
    const body = z
      .object({
        projectId: z.string().min(1),
        category: z.string().min(1),
        title: z.string().min(1),
        content: z.string().min(1),
        importance: z.number().min(0).max(1).default(0.5),
        sourceTaskId: z.string().optional(),
        sourceAgentRole: z.string().optional(),
      })
      .parse(request.body);

    const result = await sql(
      `insert into swarm_memories(
         project_id,
         category,
         title,
         content,
         importance,
         usage_count,
         last_used_at,
         source_task_id,
         source_agent_role,
         decay_factor
       )
       values($1, $2, $3, $4, $5, 0, now(), $6, $7, 1)
       returning id`,
      [
        body.projectId,
        body.category,
        body.title,
        body.content,
        body.importance,
        body.sourceTaskId ?? null,
        body.sourceAgentRole ?? null,
      ],
    );

    return { memoryId: String(one(result).id) };
  });

  app.post("/api/memory/use", async (request) => {
    const body = z
      .object({
        memoryId: z.string().min(1),
      })
      .parse(request.body);

    await sql(
      `update swarm_memories
       set usage_count = usage_count + 1,
           last_used_at = now()
       where id = $1`,
      [body.memoryId],
    );

    return { ok: true };
  });

  app.post("/api/retrospective/create", async (request) => {
    const body = z
      .object({
        taskId: z.string().min(1),
        projectId: z.string().min(1),
        taskSummary: z.string(),
        totalAgents: z.number().int(),
        totalFiles: z.number().int(),
        durationMs: z.number().int().nonnegative(),
        sandboxPassedFirst: z.boolean(),
        reviewPassedFirst: z.boolean(),
        retryCount: z.number().int().nonnegative(),
        whatWorked: z.array(z.string()),
        whatFailed: z.array(z.string()),
        improvements: z.array(z.string()),
        newMemories: z.array(z.string()),
        qualityScore: z.number(),
      })
      .parse(request.body);

    const result = await sql(
      `insert into swarm_retrospectives(
         task_id,
         project_id,
         task_summary,
         total_agents,
         total_files,
         duration_ms,
         sandbox_passed_first,
         review_passed_first,
         retry_count,
         what_worked,
         what_failed,
         improvements,
         new_memories,
         quality_score
       )
       values(
         $1, $2, $3, $4, $5, $6, $7, $8, $9,
         $10::jsonb, $11::jsonb, $12::jsonb, $13::jsonb, $14
       )
       returning id`,
      [
        body.taskId,
        body.projectId,
        body.taskSummary,
        body.totalAgents,
        body.totalFiles,
        body.durationMs,
        body.sandboxPassedFirst,
        body.reviewPassedFirst,
        body.retryCount,
        JSON.stringify(body.whatWorked),
        JSON.stringify(body.whatFailed),
        JSON.stringify(body.improvements),
        JSON.stringify(body.newMemories),
        body.qualityScore,
      ],
    );

    return { retroId: String(one(result).id) };
  });

  app.post("/api/agents/message", async (request) => {
    const body = z
      .object({
        taskId: z.string().min(1),
        projectId: z.string().min(1),
        fromAgentUid: z.string().min(1),
        fromAgentRole: z.string().min(1),
        toAgentUid: z.string().optional(),
        toAgentRole: z.string().optional(),
        messageType: z.string().min(1),
        content: z.string(),
      })
      .parse(request.body);

    const result = await sql(
      `insert into swarm_agent_messages(
         task_id,
         project_id,
         from_agent_uid,
         from_agent_role,
         to_agent_uid,
         to_agent_role,
         message_type,
         content
       )
       values($1, $2, $3, $4, $5, $6, $7, $8)
       returning id`,
      [
        body.taskId,
        body.projectId,
        body.fromAgentUid,
        body.fromAgentRole,
        body.toAgentUid ?? null,
        body.toAgentRole ?? null,
        body.messageType,
        body.content,
      ],
    );

    return { messageId: String(one(result).id) };
  });

  app.get("/api/agents/messages", async (request) => {
    const query = z
      .object({
        taskId: z.string().min(1),
        agentUid: z.string().min(1),
        agentRole: z.string().min(1),
      })
      .parse(request.query);

    const result = await sql(
      `select *
       from swarm_agent_messages
       where task_id = $1
         and (
           to_agent_uid is null
           or to_agent_uid = $2
           or to_agent_role = $3
         )
       order by created_at asc`,
      [query.taskId, query.agentUid, query.agentRole],
    );

    return {
      messages: result.rows.map((row) => ({
        _id: String(row.id),
        fromAgentUid: String(row.from_agent_uid),
        fromAgentRole: String(row.from_agent_role),
        messageType: String(row.message_type),
        content: String(row.content),
        timestamp: milliseconds(row.created_at),
      })),
    };
  });

  app.post("/api/rag/index", async (request) => {
    const body = z
      .object({
        projectId: z.string().min(1),
        files: z.array(
          z.object({
            path: z.string().min(1),
            content: z.string(),
            language: z.string().optional(),
          }),
        ),
      })
      .parse(request.body);

    let totalChunks = 0;

    for (const file of body.files) {
      totalChunks += await indexOneFile({
        projectId: body.projectId,
        ...file,
      });
    }

    return {
      totalChunks,
      filesIndexed: body.files.length,
    };
  });

  app.post("/api/rag/index-file", async (request) => {
    const body = z
      .object({
        projectId: z.string().min(1),
        path: z.string().min(1),
        content: z.string(),
        language: z.string().optional(),
      })
      .parse(request.body);

    return {
      chunks: await indexOneFile(body),
    };
  });

  app.get("/api/rag/search", async (request) => {
    const query = z
      .object({
        projectId: z.string().min(1),
        query: z.string().min(1),
        limit: z.coerce.number().int().min(1).max(100).default(15),
      })
      .parse(request.query);

    const result = await sql(
      `select
         *,
         ts_rank(search_document, websearch_to_tsquery('simple', $2)) as rank
       from code_chunks
       where project_id = $1
         and search_document @@ websearch_to_tsquery('simple', $2)
       order by rank desc, file_path asc, chunk_index asc
       limit $3`,
      [query.projectId, query.query, query.limit],
    );

    return {
      chunks: result.rows.map((row) => ({
        filePath: String(row.file_path),
        chunkType: String(row.chunk_type),
        name: row.name ?? undefined,
        content: String(row.content),
        startLine: Number(row.start_line),
        endLine: Number(row.end_line),
      })),
    };
  });

  app.post("/api/git/branch", async (request) => {
    const body = z
      .object({
        taskId: z.string().min(1),
        projectId: z.string().min(1),
        branchName: z.string().min(1),
        baseBranch: z.string().min(1).default("main"),
      })
      .parse(request.body);

    const result = await sql(
      `insert into swarm_git_branches(
         task_id,
         project_id,
         branch_name,
         base_branch
       )
       values($1, $2, $3, $4)
       on conflict(task_id)
       do update
       set project_id = excluded.project_id,
           branch_name = excluded.branch_name,
           base_branch = excluded.base_branch,
           updated_at = now()
       returning id`,
      [
        body.taskId,
        body.projectId,
        body.branchName,
        body.baseBranch,
      ],
    );

    return { id: String(one(result).id) };
  });

  app.post("/api/git/commit", async (request) => {
    const body = z
      .object({
        taskId: z.string().min(1),
        commitSHA: z.string().min(1),
      })
      .parse(request.body);

    await sql(
      `update swarm_git_branches
       set commit_sha = $2,
           updated_at = now()
       where task_id = $1`,
      [body.taskId, body.commitSHA],
    );

    return { ok: true };
  });

  app.post("/api/git/pr", async (request) => {
    const body = z
      .object({
        taskId: z.string().min(1),
        prNumber: z.number().int().positive(),
        prUrl: z.string().url(),
      })
      .parse(request.body);

    await sql(
      `update swarm_git_branches
       set pr_number = $2,
           pr_url = $3,
           updated_at = now()
       where task_id = $1`,
      [body.taskId, body.prNumber, body.prUrl],
    );

    return { ok: true };
  });
}
