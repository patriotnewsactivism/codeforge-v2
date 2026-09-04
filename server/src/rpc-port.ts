/**
 * Batch-1 port of Convex RPCs to the PostgreSQL bridge (2026-09-04).
 *
 * Serves the read/CRUD RPCs whose data already exists either in a
 * normalized core table or in the raw-preservation `legacy_convex_documents`
 * store. LLM-driven RPCs (chat.sendMessage, engine.runMission,
 * suggestions.generate/implement/runAutonomousCycle, planner.*, cinema.*,
 * deployVercel.*, github.*, stripe.*, apiKeys.*, errorIngestion.*) remain
 * RpcNotImplementedError until their integrations are ported.
 */
import type { AuthUser } from "./auth.js";
import { assertProjectAccess, assertProjectOwner } from "./access.js";
import { sql, withTransaction } from "./db.js";

type RpcArgs = Record<string, unknown>;

// ─── helpers ─────────────────────────────────────────────────────────────────

function asString(value: unknown, name: string): string {
  if (typeof value === "string" && value.length > 0) {
    return value;
  }
  throw new Error(`${name} is required`);
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function optionalNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function millis(value: Date | string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }
  return new Date(value).getTime();
}

// ─── legacy store reads ──────────────────────────────────────────────────────

async function legacyList(
  tableName: string,
  projectId: string,
  opts: {
    order?: "asc" | "desc";
    limit?: number;
    buildSessionId?: string | null;
    extraWhere?: string;
    extraParams?: unknown[];
  } = {},
): Promise<unknown[]> {
  const params: unknown[] = [tableName, projectId];
  let where =
    "table_name = $1 and document->>'projectId' = $2 and document ? '_id'";

  if (opts.buildSessionId) {
    params.push(opts.buildSessionId);
    where += ` and document->>'buildSessionId' = $${params.length}`;
  }

  if (opts.extraWhere) {
    const extra = opts.extraParams ?? [];
    for (const p of extra) {
      params.push(p);
    }
    where += ` and (${opts.extraWhere.replace(
      "$#",
      () => `$${params.length}`,
    )})`;
  }

  params.push(opts.limit ?? 100);
  const limitRef = `$${params.length}`;

  const result = await sql(
    `select document
     from legacy_convex_documents
     where ${where}
     order by creation_time ${opts.order === "asc" ? "asc" : "desc"}
     limit ${limitRef}`,
    params,
  );

  return result.rows.map((row) => row.document);
}

async function legacyFirst(
  tableName: string,
  projectId: string,
): Promise<unknown | null> {
  const rows = await legacyList(tableName, projectId, { limit: 1 });
  return rows[0] ?? null;
}

// ─── normalized row shapes (mirror Convex doc fields) ─────────────────────────

function taskShape(row: Record<string, unknown>) {
  return {
    _id: String(row.id),
    _creationTime: millis(String(row.created_at)),
    projectId: String(row.project_id),
    buildSessionId: row.build_session_id ?? undefined,
    orchestratorSessionId: row.orchestrator_session_id ?? undefined,
    parentTaskId: row.parent_task_id ?? undefined,
    agentId: String(row.agent_id),
    agentName: String(row.agent_name),
    agentIcon: String(row.agent_icon),
    role: row.role ?? undefined,
    task: String(row.task),
    status: String(row.status),
    result: row.result ?? undefined,
    filesChanged: row.files_changed ?? undefined,
    startedAt: millis(String(row.started_at)),
    finishedAt: millis(row.finished_at as Date | null),
    provider: row.provider ?? undefined,
    worktreePath: row.worktree_path ?? undefined,
    costBudgetTokens: row.cost_budget_tokens ?? undefined,
    costSpentTokens: row.cost_spent_tokens ?? undefined,
    recoveryCheckpoints: row.recovery_checkpoints ?? undefined,
    dependencies: row.dependencies ?? undefined,
  };
}

function sessionShape(row: Record<string, unknown>) {
  return {
    _id: String(row.id),
    _creationTime: millis(String(row.created_at)),
    projectId: String(row.project_id),
    userId: String(row.user_id),
    status: String(row.status),
    goal: row.goal ?? undefined,
    currentStep: row.current_step ?? undefined,
    totalSteps: row.total_steps ?? undefined,
    completedSteps: row.completed_steps ?? undefined,
    startedAt: millis(String(row.started_at)),
    finishedAt: millis(row.finished_at as Date | null),
  };
}

function stepShape(row: Record<string, unknown>) {
  return {
    _id: String(row.id),
    _creationTime: millis(String(row.created_at)),
    buildSessionId: String(row.build_session_id),
    projectId: String(row.project_id),
    stepNumber: Number(row.step_number),
    action: String(row.action),
    description: String(row.description),
    filesChanged: row.files_changed ?? [],
    status: String(row.status),
    errorMessage: row.error_message ?? undefined,
    happenedAt: millis(String(row.happened_at)),
  };
}

function memoryShape(row: Record<string, unknown>) {
  return {
    _id: String(row.id),
    _creationTime: millis(String(row.created_at)),
    projectId: String(row.project_id),
    category: String(row.category),
    content: String(row.content),
    importance: Number(row.importance),
    usageCount: Number(row.usage_count),
    lastUsedAt: millis(String(row.last_used_at)),
    sourceTaskId: row.source_task_id ?? undefined,
    sourceRetroId: row.source_retro_id ?? undefined,
    decayFactor: Number(row.decay_factor),
    embedding: row.embedding ?? undefined,
    isApproved: row.is_approved ?? undefined,
  };
}

function retroShape(row: Record<string, unknown>) {
  return {
    _id: String(row.id),
    _creationTime: millis(String(row.created_at)),
    projectId: String(row.project_id),
    triggerTaskId: row.trigger_task_id ?? undefined,
    buildSessionId: row.build_session_id ?? undefined,
    qualityScore: Number(row.quality_score),
    whatWorked: row.what_worked ?? [],
    whatFailed: row.what_failed ?? [],
    improvements: row.improvements ?? [],
    memoriesCreated: row.memories_created ?? [],
    rawAnalysis: String(row.raw_analysis),
    agentsInvolved: row.agents_involved ?? [],
    happenedAt: millis(String(row.happened_at)),
  };
}

function suggestionShape(row: Record<string, unknown>) {
  return {
    _id: String(row.id),
    _creationTime: millis(String(row.created_at)),
    projectId: String(row.project_id),
    title: String(row.title),
    description: String(row.description),
    category: String(row.category),
    priority: String(row.priority),
    status: String(row.status),
    implementationPrompt: String(row.implementation_prompt),
    generatedAt: millis(String(row.generated_at)),
    impactScore: row.impact_score ?? undefined,
    autoApproved: row.auto_approved ?? undefined,
  };
}

function changeShape(row: Record<string, unknown>) {
  return {
    _id: String(row.id),
    _creationTime: millis(String(row.happened_at)),
    projectId: String(row.project_id),
    suggestionId: row.suggestion_id ?? undefined,
    buildStepId: row.build_step_id ?? undefined,
    filePath: String(row.file_path),
    previousContent: String(row.previous_content),
    newContent: String(row.new_content),
    action: String(row.action),
    happenedAt: millis(String(row.happened_at)),
    undone: Boolean(row.undone),
  };
}

function collaboratorShape(row: Record<string, unknown>) {
  return {
    _id: String(row.id),
    _creationTime: millis(String(row.created_at)),
    projectId: String(row.project_id),
    userId: String(row.user_id),
    userName: String(row.user_name),
    activeFile: row.active_file ?? undefined,
    cursorLine: row.cursor_line ?? undefined,
    cursorColumn: row.cursor_column ?? undefined,
    lastSeenAt: millis(String(row.last_seen_at)),
    color: String(row.color),
  };
}

const PRESENCE_COLORS = [
  "#22d3ee",
  "#a78bfa",
  "#f472b6",
  "#fbbf24",
  "#34d399",
  "#60a5fa",
  "#f87171",
  "#c084fc",
];

async function userDisplayName(user: AuthUser): Promise<string> {
  const result = await sql<{ name: string | null; email: string }>(
    "select name, email from users where id = $1",
    [user.id],
  );
  const row = result.rows[0];
  return row?.name || row?.email || "Anonymous";
}

// ─── module handlers ─────────────────────────────────────────────────────────

async function memoryRpc(
  name: string,
  args: RpcArgs,
  user: AuthUser,
): Promise<unknown> {
  const projectId = asString(args.projectId, "projectId");
  await assertProjectAccess(user.id, projectId);

  if (name === "memory.listMemories") {
    const category = optionalString(args.category);
    const limit = optionalNumber(args.limit) ?? 50;
    const result = await sql(
      "select * from agent_memories where project_id = $1 order by importance * decay_factor desc",
      [projectId],
    );
    let rows = result.rows;
    if (category) {
      rows = rows.filter((row) => row.category === category);
    }
    return rows.slice(0, limit).map((row) => memoryShape(row));
  }

  if (name === "memory.listRetrospectives") {
    const result = await sql(
      "select * from task_retrospectives where project_id = $1 order by happened_at desc limit 20",
      [projectId],
    );
    return result.rows.map((row) => retroShape(row));
  }

  if (name === "memory.listAgentMessages") {
    const buildSessionId = optionalString(args.buildSessionId);
    return legacyList("agentMessages", projectId, {
      order: buildSessionId ? "asc" : "desc",
      limit: buildSessionId ? 100 : 50,
      buildSessionId,
    });
  }

  if (name === "memory.getMemoryStats") {
    const memories = await sql<{ category: string }>(
      "select category from agent_memories where project_id = $1",
      [projectId],
    );
    const retros = await sql<{ quality_score: number }>(
      "select quality_score from task_retrospectives where project_id = $1",
      [projectId],
    );

    const byCategory: Record<string, number> = {};
    for (const row of memories.rows) {
      byCategory[row.category] = (byCategory[row.category] ?? 0) + 1;
    }

    const avgScore =
      retros.rows.length > 0
        ? retros.rows.reduce((s, r) => s + Number(r.quality_score), 0) /
          retros.rows.length
        : 0;

    return {
      totalMemories: memories.rows.length,
      totalRetrospectives: retros.rows.length,
      avgQualityScore: Math.round(avgScore * 10) / 10,
      byCategory,
    };
  }

  const memoryId = asString(args.memoryId, "memoryId");

  if (name === "memory.deleteMemory") {
    const result = await sql<{ project_id: string }>(
      "delete from agent_memories where id = $1 returning project_id",
      [memoryId],
    );
    if (result.rows[0]) {
      await assertProjectOwner(user.id, result.rows[0].project_id);
    }
    return null;
  }

  if (name === "memory.approveMemory") {
    const isApproved = Boolean(args.isApproved);
    const result = await sql<{ project_id: string }>(
      "update agent_memories set is_approved = $2 where id = $1 returning project_id",
      [memoryId, isApproved],
    );
    if (result.rows[0]) {
      await assertProjectOwner(user.id, result.rows[0].project_id);
    }
    return null;
  }

  throw new Error(`memory RPC not ported: ${name}`);
}

async function swarmReadsRpc(
  name: string,
  args: RpcArgs,
  user: AuthUser,
): Promise<unknown> {
  if (name === "tasks.listTasks" || name === "intelligence.listAgentTasks") {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectAccess(user.id, projectId);
    const result = await sql(
      "select * from agent_tasks where project_id = $1 order by created_at desc limit 50",
      [projectId],
    );
    return result.rows.map((row) => taskShape(row));
  }

  if (
    name === "missions.listByProject" ||
    name === "intelligence.listBuildSessions"
  ) {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectAccess(user.id, projectId);
    const result = await sql(
      "select * from build_sessions where project_id = $1 order by created_at desc limit 20",
      [projectId],
    );
    return result.rows.map((row) => sessionShape(row));
  }

  if (name === "buildLoop.getActiveSession") {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectAccess(user.id, projectId);
    const result = await sql(
      "select * from build_sessions where project_id = $1 and status in ('running','paused') order by created_at desc limit 1",
      [projectId],
    );
    return result.rows[0] ? sessionShape(result.rows[0]) : null;
  }

  if (name === "buildLoop.listSteps") {
    const buildSessionId = asString(args.buildSessionId, "buildSessionId");
    const result = await sql(
      "select * from build_steps where build_session_id = $1 order by step_number asc limit 200",
      [buildSessionId],
    );
    const projectId = String(result.rows[0]?.project_id ?? "");
    if (projectId) {
      await assertProjectAccess(user.id, projectId);
    }
    return result.rows.map((row) => stepShape(row));
  }

  if (name === "agentThoughts.listRecent") {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectAccess(user.id, projectId);
    return legacyList("agentThoughts", projectId, {
      order: "asc",
      limit: optionalNumber(args.limit) ?? 100,
      buildSessionId: optionalString(args.buildSessionId),
    });
  }

  if (name === "intelligence.listThoughts") {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectAccess(user.id, projectId);
    const buildSessionId = optionalString(args.buildSessionId);
    return legacyList("agentThoughts", projectId, {
      order: buildSessionId ? "asc" : "desc",
      limit: buildSessionId ? 100 : 50,
      buildSessionId,
    });
  }

  if (name === "intelligence.listAgentMessages") {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectAccess(user.id, projectId);
    const buildSessionId = optionalString(args.buildSessionId);
    return legacyList("agentMessages", projectId, {
      order: buildSessionId ? "asc" : "desc",
      limit: buildSessionId ? 100 : 50,
      buildSessionId,
    });
  }

  if (name === "engine.listToolCalls") {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectAccess(user.id, projectId);
    const missionId = optionalString(args.missionId);
    if (missionId) {
      return legacyList("toolCalls", projectId, {
        order: "asc",
        limit: optionalNumber(args.limit) ?? 200,
        extraWhere: "document->>'missionId' = $#",
        extraParams: [missionId],
      });
    }
    return legacyList("toolCalls", projectId, {
      order: "asc",
      limit: optionalNumber(args.limit) ?? 200,
    });
  }

  if (name === "intelligence.listToolCalls") {
    const missionId = asString(args.missionId, "missionId");
    const result = await sql(
      `select document from legacy_convex_documents
       where table_name = 'toolCalls' and document->>'missionId' = $1
       order by creation_time asc limit 200`,
      [missionId],
    );
    return result.rows.map((row) => row.document);
  }

  if (name === "intelligence.getCostSummary") {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectAccess(user.id, projectId);
    const result = await sql<{
      total: number;
      running: number;
      budget: string | null;
      spent: string | null;
      with_budget: number;
    }>(
      `select
         count(*)::int as total,
         count(*) filter (where status = 'running')::int as running,
         coalesce(sum(cost_budget_tokens), 0) as budget,
         coalesce(sum(cost_spent_tokens), 0) as spent,
         count(cost_budget_tokens)::int as with_budget
       from agent_tasks
       where project_id = $1`,
      [projectId],
    );
    const row = result.rows[0];
    const totalSpentTokens = Number(row?.spent ?? 0);
    return {
      totalAgentRuns: Number(row?.total ?? 0),
      activeAgents: Number(row?.running ?? 0),
      totalBudgetTokens: Number(row?.budget ?? 0),
      totalSpentTokens,
      estimatedCostUsd: Number(((totalSpentTokens / 1000) * 0.002).toFixed(4)),
      tasksWithBudget: Number(row?.with_budget ?? 0),
    };
  }

  throw new Error(`swarm-read RPC not ported: ${name}`);
}

async function changeHistoryRpc(
  name: string,
  args: RpcArgs,
  user: AuthUser,
): Promise<unknown> {
  if (name === "changeHistory.listByProject") {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectAccess(user.id, projectId);
    const limit = optionalNumber(args.limit) ?? 500;
    const result = await sql(
      "select * from change_history where project_id = $1 order by happened_at desc limit $2",
      [projectId, limit],
    );
    return result.rows.map((row) => changeShape(row));
  }

  if (name === "changeHistory.undoChange") {
    const changeId = asString(args.changeId, "changeId");
    return withTransaction(async (client) => {
      const changeResult = await client.query(
        "select * from change_history where id = $1 for update",
        [changeId],
      );
      const change = changeResult.rows[0] as
        | (Record<string, unknown> & { undone: boolean })
        | undefined;

      if (!change) {
        throw new Error("Change not found");
      }
      await assertProjectOwner(user.id, String(change.project_id));
      if (change.undone) {
        throw new Error("Already undone");
      }

      const filePath = String(change.file_path);
      const action = String(change.action);
      const previousContent = String(change.previous_content);

      const filesResult = await client.query(
        "select id from files where project_id = $1 and path = $2 limit 1",
        [change.project_id, filePath],
      );
      const fileId = filesResult.rows[0]?.id as string | undefined;

      if (action === "create") {
        if (fileId) {
          await client.query("delete from files where id = $1", [fileId]);
        }
      } else if (action === "delete") {
        const name = filePath.split("/").pop() ?? filePath;
        const parentPath = filePath.includes("/")
          ? filePath.substring(0, filePath.lastIndexOf("/"))
          : null;
        await client.query(
          `insert into files (project_id, path, name, content, is_directory, parent_path)
           values ($1, $2, $3, $4, false, $5)`,
          [change.project_id, filePath, name, previousContent, parentPath],
        );
      } else if (fileId) {
        await client.query("update files set content = $2 where id = $1", [
          fileId,
          previousContent,
        ]);
      }

      await client.query(
        "update change_history set undone = true where id = $1",
        [changeId],
      );
      return null;
    });
  }

  throw new Error(`changeHistory RPC not ported: ${name}`);
}

async function suggestionsRpc(
  name: string,
  args: RpcArgs,
  user: AuthUser,
): Promise<unknown> {
  if (name === "suggestions.listByProject") {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectAccess(user.id, projectId);
    const result = await sql(
      "select * from suggestions where project_id = $1 order by created_at desc limit 200",
      [projectId],
    );
    return result.rows.map((row) => suggestionShape(row));
  }

  if (name === "suggestions.updateStatus") {
    const suggestionId = asString(args.suggestionId, "suggestionId");
    const status = asString(args.status, "status");
    if (!["pending", "implementing", "done", "dismissed"].includes(status)) {
      throw new Error("Invalid status");
    }
    const result = await sql<{ project_id: string }>(
      "update suggestions set status = $2 where id = $1 returning project_id",
      [suggestionId, status],
    );
    if (result.rows[0]) {
      await assertProjectOwner(user.id, result.rows[0].project_id);
    }
    return null;
  }

  if (name === "suggestions.getAutonomousMode") {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectAccess(user.id, projectId);

    const normalized = await sql(
      "select * from project_settings where project_id = $1 limit 1",
      [projectId],
    );
    if (normalized.rows[0]) {
      const row = normalized.rows[0];
      return {
        _id: String(row.id),
        _creationTime: millis(String(row.created_at)),
        projectId,
        autonomousMode: Boolean(row.autonomous_mode),
        autonomousLevel: row.autonomous_level ?? undefined,
        autoIntervalMinutes: Number(row.auto_interval_minutes),
        lastAutoRunAt: millis(row.last_auto_run_at as Date | null),
        projectSoul: row.project_soul ?? undefined,
      };
    }
    return legacyFirst("projectSettings", projectId);
  }

  if (name === "suggestions.setAutonomousMode") {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectOwner(user.id, projectId);
    const autonomousMode = Boolean(args.autonomousMode);
    const autonomousLevel =
      optionalString(args.autonomousLevel) ?? "autonomous";
    const autoIntervalMinutes = optionalNumber(args.autoIntervalMinutes) ?? 15;
    const projectSoul = optionalString(args.projectSoul);

    await sql(
      `insert into project_settings (
         project_id, autonomous_mode, autonomous_level,
         auto_interval_minutes, project_soul
       )
       values ($1, $2, $3, $4, $5)
       on conflict (project_id) do update set
         autonomous_mode = excluded.autonomous_mode,
         autonomous_level = excluded.autonomous_level,
         auto_interval_minutes = excluded.auto_interval_minutes,
         project_soul = excluded.project_soul,
         updated_at = now()`,
      [
        projectId,
        autonomousMode,
        autonomousLevel,
        autoIntervalMinutes,
        projectSoul,
      ],
    );
    return null;
  }

  throw new Error(`suggestions RPC not ported: ${name}`);
}

async function collaborationRpc(
  name: string,
  args: RpcArgs,
  user: AuthUser,
): Promise<unknown> {
  if (name === "collaboration.heartbeat") {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectAccess(user.id, projectId);
    const activeFile = optionalString(args.activeFile);
    const cursorLine = optionalNumber(args.cursorLine);
    const cursorColumn = optionalNumber(args.cursorColumn);
    const userName = await userDisplayName(user);

    const updated = await sql(
      `update collaborators set
         active_file = $3,
         cursor_line = $4,
         cursor_column = $5,
         last_seen_at = now(),
         user_name = $6
       where project_id = $1 and user_id = $2
       returning id`,
      [projectId, user.id, activeFile, cursorLine, cursorColumn, userName],
    );

    if (updated.rows.length === 0) {
      const count = await sql<{ count: number }>(
        "select count(*)::int as count from collaborators where project_id = $1",
        [projectId],
      );
      const color =
        PRESENCE_COLORS[
          Number(count.rows[0]?.count ?? 0) % PRESENCE_COLORS.length
        ];
      await sql(
        `insert into collaborators (
           project_id, user_id, user_name, active_file,
           cursor_line, cursor_column, color
         )
         values ($1, $2, $3, $4, $5, $6, $7)
         on conflict (project_id, user_id) do update set last_seen_at = now()`,
        [
          projectId,
          user.id,
          userName,
          activeFile,
          cursorLine,
          cursorColumn,
          color,
        ],
      );
    }
    return null;
  }

  if (name === "collaboration.listActive") {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectAccess(user.id, projectId);
    const result = await sql(
      `select * from collaborators
       where project_id = $1 and last_seen_at > now() - interval '30 seconds'`,
      [projectId],
    );
    return result.rows.map((row) => collaboratorShape(row));
  }

  if (name === "collaboration.leave") {
    const projectId = asString(args.projectId, "projectId");
    await sql(
      "delete from collaborators where project_id = $1 and user_id = $2",
      [projectId, user.id],
    );
    return null;
  }

  if (name === "collaboration.createInvite") {
    const projectId = asString(args.projectId, "projectId");
    await assertProjectOwner(user.id, projectId);

    const inviteCode = `cf-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
    await sql(
      `insert into project_invites (project_id, invited_by, invite_code, expires_at)
       values ($1, $2, $3, now() + interval '24 hours')`,
      [projectId, user.id, inviteCode],
    );
    return inviteCode;
  }

  if (name === "collaboration.joinByInvite") {
    const inviteCode = asString(args.inviteCode, "inviteCode");
    const invite = await sql(
      `select * from project_invites
       where invite_code = $1 and expires_at > now()
       limit 1`,
      [inviteCode],
    );
    const row = invite.rows[0];
    if (!row) {
      return null;
    }
    const projectId = String(row.project_id);

    const existing = await sql(
      "select 1 from collaborators where project_id = $1 and user_id = $2 limit 1",
      [projectId, user.id],
    );
    if (existing.rows.length === 0) {
      const userName = await userDisplayName(user);
      const count = await sql<{ count: number }>(
        "select count(*)::int as count from collaborators where project_id = $1",
        [projectId],
      );
      const color =
        PRESENCE_COLORS[
          Number(count.rows[0]?.count ?? 0) % PRESENCE_COLORS.length
        ];
      await sql(
        `insert into collaborators (project_id, user_id, user_name, color)
         values ($1, $2, $3, $4)
         on conflict (project_id, user_id) do update set last_seen_at = now()`,
        [projectId, user.id, userName, color],
      );
    }
    return projectId;
  }

  throw new Error(`collaboration RPC not ported: ${name}`);
}

async function legacyViewsRpc(
  name: string,
  args: RpcArgs,
  user: AuthUser,
): Promise<unknown> {
  const projectId = asString(args.projectId, "projectId");
  await assertProjectAccess(user.id, projectId);

  if (name === "codeReview.listReviews") {
    return legacyList("codeReviews", projectId, { limit: 20 });
  }

  if (name === "xray.getLatestXRay") {
    return legacyFirst("xrayReports", projectId);
  }

  if (name === "completionScore.getLatestScores") {
    return legacyFirst("completionScores", projectId);
  }

  if (name === "costEntries.listByProject") {
    const sessions = await sql(
      "select id from build_sessions where project_id = $1",
      [projectId],
    );
    const sessionIds = sessions.rows.map((row) => String(row.id));
    if (sessionIds.length === 0) {
      return [];
    }
    const result = await sql(
      `select document from legacy_convex_documents
       where table_name = 'costEntries'
         and document->>'userId' = $1
         and document->>'buildSessionId' = any($2::text[])
       order by creation_time desc`,
      [user.id, sessionIds],
    );
    return result.rows.map((row) => row.document);
  }

  if (name === "dashboard.getDashboard") {
    const [deployments, sentryViolations, debates, reflections, forensics, mutations] =
      await Promise.all([
        legacyList("deployments", projectId, { limit: 20 }),
        legacyList("sentryViolations", projectId, { limit: 200 }),
        legacyList("debates", projectId, { limit: 100 }),
        legacyList("reflectionSessions", projectId, { limit: 10 }),
        legacyList("forensicReports", projectId, { limit: 20 }),
        legacyList("mutationLog", projectId, { limit: 500 }),
      ]);

    const sessions = await sql(
      "select * from build_sessions where project_id = $1 order by created_at desc limit 100",
      [projectId],
    );
    const missions = sessions.rows;
    const now = Date.now();
    const day = 86_400_000;
    const week = 7 * day;

    const missionStats = {
      total: missions.length,
      completed: missions.filter((m) => m.status === "completed").length,
      failed: missions.filter((m) => m.status === "error").length,
      running: missions.filter((m) => m.status === "running").length,
      last7Days: missions.filter(
        (m) => millis(String(m.created_at))! > now - week,
      ).length,
      successRate: missions.length
        ? Math.round(
            (missions.filter((m) => m.status === "completed").length /
              missions.length) *
              100,
          )
        : 0,
    };

    const violations = sentryViolations as Array<Record<string, unknown>>;
    const violationStats = {
      total: violations.length,
      blocked: violations.filter((v) => v.blocked).length,
      last24h: violations.filter(
        (v) => typeof v.timestamp === "number" && v.timestamp > now - day,
      ).length,
      bySeverity: {
        critical: violations.filter((v) => v.severity === "critical").length,
        high: violations.filter((v) => v.severity === "high").length,
        medium: violations.filter((v) => v.severity === "medium").length,
        low: violations.filter((v) => v.severity === "low").length,
      },
      byType: violations.reduce<Record<string, number>>(
        (acc, v) => {
          const type = String(v.violationType ?? "unknown");
          acc[type] = (acc[type] ?? 0) + 1;
          return acc;
        },
        {},
      ),
      heatmap: (() => {
        const buckets = Array(24).fill(0);
        for (const v of violations) {
          if (typeof v.timestamp === "number" && v.timestamp > now - week) {
            const hour = new Date(v.timestamp).getUTCHours();
            buckets[hour] += 1;
          }
        }
        return buckets;
      })(),
    };

    const debateDocs = debates as Array<Record<string, unknown>>;
    const debateStats = {
      total: debateDocs.length,
      proceed: debateDocs.filter((d) => d.verdict === "PROCEED").length,
      refine: debateDocs.filter((d) => d.verdict === "REFINE").length,
      escalate: debateDocs.filter((d) => d.verdict === "ESCALATE").length,
      avgConfidence: debateDocs.length
        ? Math.round(
            debateDocs.reduce((s, d) => s + Number(d.confidence ?? 0), 0) /
              debateDocs.length,
          )
        : 0,
      avgDurationMs: debateDocs.length
        ? Math.round(
            debateDocs.reduce((s, d) => s + Number(d.durationMs ?? 0), 0) /
              debateDocs.length,
          )
        : 0,
    };

    const reflectionDocs = reflections as Array<Record<string, unknown>>;
    const learningStats = {
      reflectionSessions: reflectionDocs.length,
      latestHealthScore:
        (reflectionDocs[0]?.overallHealthScore as number | undefined) ?? null,
      healthTrend: reflectionDocs.slice(0, 5).map((r) => ({
        score: (r.overallHealthScore as number | undefined) ?? null,
        ts: r.timestamp ?? null,
      })),
      forensicReports: (forensics as unknown[]).length,
      recentMutations: (mutations as unknown[]).slice(0, 20),
    };

    return {
      missionStats,
      deployStats: {
        total: (deployments as unknown[]).length,
        recent: (deployments as Array<Record<string, unknown>>).slice(0, 5),
      },
      violationStats,
      debateStats,
      learningStats,
    };
  }

  throw new Error(`legacy-view RPC not ported: ${name}`);
}

// ─── static catalog RPCs ─────────────────────────────────────────────────────

const MODEL_CATALOG = [
  { id: "claude-opus-4-8", name: "Claude Opus 4.8", tier: "strong", inputCostPer1M: 5.0, outputCostPer1M: 25.0 },
  { id: "claude-sonnet-4-6", name: "Claude Sonnet 4.6", tier: "strong", inputCostPer1M: 3.0, outputCostPer1M: 15.0 },
  { id: "claude-haiku-4-5", name: "Claude Haiku 4.5", tier: "balanced", inputCostPer1M: 1.0, outputCostPer1M: 5.0 },
  { id: "deepseek-v3", name: "DeepSeek V3", tier: "balanced", inputCostPer1M: 0.27, outputCostPer1M: 1.1 },
  { id: "deepseek-chat", name: "DeepSeek V3", tier: "balanced", inputCostPer1M: 0.27, outputCostPer1M: 1.1 },
  { id: "groq-llama-3.3-70b", name: "Llama 3.3 70B (Groq)", tier: "balanced", inputCostPer1M: 0.059, outputCostPer1M: 0.079 },
  { id: "groq-llama-3.1-8b", name: "Llama 3.1 8B (Groq)", tier: "fast", inputCostPer1M: 0.05, outputCostPer1M: 0.08 },
  { id: "cerebras-gpt-oss-120b", name: "GPT-OSS 120B (Cerebras)", tier: "fast", inputCostPer1M: 0.0, outputCostPer1M: 0.0 },
  { id: "cohere-command-r-plus", name: "Command R+ (Cohere)", tier: "strong", inputCostPer1M: 2.5, outputCostPer1M: 10.0 },
  { id: "mistral-codestral", name: "Codestral (Mistral)", tier: "balanced", inputCostPer1M: 0.3, outputCostPer1M: 0.9 },
  { id: "openrouter/gpt-oss-20b:free", name: "GPT-OSS 20B (OpenRouter)", tier: "fast", inputCostPer1M: 0.0, outputCostPer1M: 0.0 },
  { id: "openrouter/nemotron-3-super-120b-a12b:free", name: "Nemotron 3 Super (OpenRouter)", tier: "fast", inputCostPer1M: 0.0, outputCostPer1M: 0.0 },
];

const FOUNDER_EMAILS = new Set(["patriotnewsactivism@gmail.com"]);

const PLAN_LIMITS = {
  founder: { aiRequestsPerDay: 999_999, missionsPerDay: 999_999, maxConcurrentAgents: 100, maxSpawnDepth: 6, maxSpawnsPerMission: 1000, maxProjects: 999_999, hardCapUsdMonthly: 500, includedComputeUsd: 500 },
  free: { aiRequestsPerDay: 15, missionsPerDay: 2, maxConcurrentAgents: 1, maxSpawnDepth: 1, maxSpawnsPerMission: 3, maxProjects: 2, hardCapUsdMonthly: 0.25, includedComputeUsd: 0 },
  weekly: { aiRequestsPerDay: 250, missionsPerDay: 20, maxConcurrentAgents: 5, maxSpawnDepth: 3, maxSpawnsPerMission: 30, maxProjects: 15, hardCapUsdMonthly: 6.0, includedComputeUsd: 5.0 },
  monthly: { aiRequestsPerDay: 600, missionsPerDay: 60, maxConcurrentAgents: 12, maxSpawnDepth: 4, maxSpawnsPerMission: 80, maxProjects: 30, hardCapUsdMonthly: 18.0, includedComputeUsd: 15.0 },
  lifetime: { aiRequestsPerDay: 1500, missionsPerDay: 150, maxConcurrentAgents: 32, maxSpawnDepth: 5, maxSpawnsPerMission: 250, maxProjects: 200, hardCapUsdMonthly: 50.0, includedComputeUsd: 50.0 },
} as const;

type PlanKey = keyof typeof PLAN_LIMITS;

async function catalogRpc(
  name: string,
  _args: RpcArgs,
  user: AuthUser,
): Promise<unknown> {
  if (name === "chat.listModels") {
    return MODEL_CATALOG;
  }

  if (name === "limits.getMyLimits") {
    const profile = await sql<{ email: string | null }>(
      "select email from users where id = $1",
      [user.id],
    );

    if (profile.rows[0]?.email && FOUNDER_EMAILS.has(profile.rows[0].email)) {
      return {
        plan: "founder",
        limits: PLAN_LIMITS.founder,
        usage: null,
        spend: null,
      };
    }

    const sub = await sql(
      `select document from legacy_convex_documents
       where table_name = 'subscriptions' and document->>'userId' = $1
       order by creation_time desc limit 1`,
      [user.id],
    );
    const planKey = (
      sub.rows[0]?.document as { planKey?: string } | undefined
    )?.planKey;
    const plan: PlanKey =
      planKey && planKey in PLAN_LIMITS ? (planKey as PlanKey) : "free";

    return {
      plan,
      limits: PLAN_LIMITS[plan],
      usage: null,
      spend: null,
    };
  }

  throw new Error(`catalog RPC not ported: ${name}`);
}

// ─── dispatch ─────────────────────────────────────────────────────────────────

export async function executePortedRpc(
  name: string,
  args: RpcArgs,
  user: AuthUser,
): Promise<unknown> {
  const handled =
    [
      "memory.",
      "tasks.",
      "missions.",
      "buildLoop.",
      "agentThoughts.",
      "intelligence.",
      "changeHistory.",
      "suggestions.",
      "collaboration.",
      "engine.listToolCalls",
      "codeReview.listReviews",
      "xray.getLatestXRay",
      "completionScore.getLatestScores",
      "costEntries.listByProject",
      "dashboard.getDashboard",
      "chat.listModels",
      "limits.getMyLimits",
    ].findIndex((prefix) => name.startsWith(prefix)) >= 0;

  if (!handled) {
    throw new Error("not a batch-1 RPC");
  }

  if (name.startsWith("memory.")) {
    return memoryRpc(name, args, user);
  }

  if (
    name.startsWith("tasks.") ||
    name.startsWith("missions.") ||
    name.startsWith("buildLoop.") ||
    name.startsWith("agentThoughts.") ||
    name.startsWith("intelligence.") ||
    name.startsWith("engine.listToolCalls")
  ) {
    return swarmReadsRpc(name, args, user);
  }

  if (name.startsWith("changeHistory.")) {
    return changeHistoryRpc(name, args, user);
  }

  if (name.startsWith("suggestions.")) {
    return suggestionsRpc(name, args, user);
  }

  if (name.startsWith("collaboration.")) {
    return collaborationRpc(name, args, user);
  }

  if (
    name === "codeReview.listReviews" ||
    name === "xray.getLatestXRay" ||
    name === "completionScore.getLatestScores" ||
    name === "costEntries.listByProject" ||
    name === "dashboard.getDashboard"
  ) {
    return legacyViewsRpc(name, args, user);
  }

  return catalogRpc(name, args, user);
}
