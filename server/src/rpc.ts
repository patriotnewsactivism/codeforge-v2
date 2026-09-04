import type { AuthUser } from "./auth.js";
import { executePortedRpc } from "./rpc-port.js";
import {
  assertProjectAccess,
  assertProjectOwner,
} from "./access.js";
import { one, sql, withTransaction } from "./db.js";
import { notifyProject } from "./realtime.js";

type RpcArgs = Record<string, unknown>;

export class RpcNotImplementedError extends Error {
  constructor(public readonly rpcName: string) {
    super(
      `RPC ${rpcName} is not migrated yet. The Convex export is preserved in legacy_convex_documents.`,
    );
  }
}

function asString(value: unknown, name: string): string {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${name} is required`);
  }

  return value;
}

function optionalString(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function millis(value: Date | string | null | undefined): number | undefined {
  if (!value) {
    return undefined;
  }

  return new Date(value).getTime();
}

function projectShape(row: Record<string, unknown>) {
  return {
    _id: String(row.id),
    _creationTime: millis(String(row.created_at)) ?? Date.now(),
    name: String(row.name),
    description: row.description ?? undefined,
    ownerId: String(row.owner_id),
    githubRepo: row.github_repo ?? undefined,
    language: row.language ?? undefined,
    lastOpenedAt: millis(String(row.last_opened_at)) ?? Date.now(),
  };
}

function fileShape(row: Record<string, unknown>) {
  return {
    _id: String(row.id),
    _creationTime: millis(String(row.created_at)) ?? Date.now(),
    projectId: String(row.project_id),
    path: String(row.path),
    name: String(row.name),
    content: String(row.content ?? ""),
    language: row.language ?? undefined,
    isDirectory: Boolean(row.is_directory),
    parentPath: row.parent_path ?? undefined,
  };
}

function sessionShape(row: Record<string, unknown>) {
  return {
    _id: String(row.id),
    _creationTime: millis(String(row.created_at)) ?? Date.now(),
    projectId: String(row.project_id),
    userId: String(row.user_id),
    title: row.title ?? undefined,
    model: String(row.model),
    totalTokensUsed: Number(row.total_tokens_used ?? 0),
    totalCost: Number(row.total_cost ?? 0),
    createdAt: millis(String(row.created_at)),
    isArchived: Boolean(row.is_archived),
  };
}

function messageShape(row: Record<string, unknown>) {
  return {
    _id: String(row.id),
    _creationTime: millis(String(row.created_at)) ?? Date.now(),
    sessionId: String(row.session_id),
    projectId: String(row.project_id),
    userId: row.user_id ?? undefined,
    role: String(row.role),
    content: String(row.content),
    model: row.model ?? undefined,
    tokensUsed:
      row.tokens_used == null ? undefined : Number(row.tokens_used),
    cost: row.cost == null ? undefined : Number(row.cost),
    isError: Boolean(row.is_error),
    fileContexts: row.file_contexts ?? undefined,
    agentId: row.agent_id ?? undefined,
    agentRole: row.agent_role ?? undefined,
  };
}

function currentUserShape(user: AuthUser) {
  return {
    _id: user.id,
    name: user.name ?? undefined,
    image: user.image ?? undefined,
    email: user.email ?? undefined,
    onboarded: user.onboarded,
    plan: user.plan ?? undefined,
    subscriptionStatus: user.subscriptionStatus ?? undefined,
    aiProfile: user.aiProfile ?? undefined,
  };
}

async function projectsRpc(
  name: string,
  args: RpcArgs,
  user: AuthUser,
): Promise<unknown> {
  if (name === "projects.list") {
    const result = await sql(
      `select distinct p.*
       from projects p
       left join collaborators c
         on c.project_id = p.id
        and c.user_id = $1
       where p.owner_id = $1
          or c.user_id = $1
       order by p.last_opened_at desc`,
      [user.id],
    );

    return result.rows.map((row) => projectShape(row));
  }

  const projectId = asString(args.projectId, "projectId");

  if (name === "projects.get") {
    await assertProjectAccess(user.id, projectId);
    const result = await sql(
      `select *
       from projects
       where id = $1`,
      [projectId],
    );

    return result.rows[0] ? projectShape(result.rows[0]) : null;
  }

  if (name === "projects.remove") {
    await assertProjectOwner(user.id, projectId);
    await sql("delete from projects where id = $1", [projectId]);
    await notifyProject({
      type: "project.deleted",
      projectId,
      entity: "project",
      id: projectId,
    });
    return null;
  }

  if (name === "projects.updateLastOpened") {
    await assertProjectAccess(user.id, projectId);
    await sql(
      `update projects
       set last_opened_at = now(),
           updated_at = now()
       where id = $1`,
      [projectId],
    );
    return null;
  }

  if (name === "projects.setGithubRepo") {
    await assertProjectOwner(user.id, projectId);
    await sql(
      `update projects
       set github_repo = $1,
           updated_at = now()
       where id = $2`,
      [asString(args.githubRepo, "githubRepo"), projectId],
    );
    return null;
  }

  throw new RpcNotImplementedError(name);
}

async function createProject(
  args: RpcArgs,
  user: AuthUser,
): Promise<string> {
  return withTransaction(async (client) => {
    const project = await client.query(
      `insert into projects(
         name,
         description,
         owner_id,
         github_repo,
         last_opened_at
       )
       values($1, $2, $3, $4, now())
       returning id`,
      [
        asString(args.name, "name"),
        optionalString(args.description),
        user.id,
        optionalString(args.githubRepo),
      ],
    );

    const projectId = String(project.rows[0].id);
    const starterFiles = [
      {
        path: "index.html",
        name: "index.html",
        language: "html",
        content:
          '<!doctype html><html><head><meta charset="utf-8"><title>CodeForge</title></head><body><h1>Hello, CodeForge!</h1><script src="script.js"></script></body></html>',
      },
      {
        path: "style.css",
        name: "style.css",
        language: "css",
        content: "body { font-family: system-ui, sans-serif; }",
      },
      {
        path: "script.js",
        name: "script.js",
        language: "javascript",
        content: 'console.log("CodeForge project loaded");',
      },
    ];

    for (const file of starterFiles) {
      await client.query(
        `insert into files(
           project_id,
           path,
           name,
           content,
           language,
           is_directory
         )
         values($1, $2, $3, $4, $5, false)`,
        [
          projectId,
          file.path,
          file.name,
          file.content,
          file.language,
        ],
      );
    }

    return projectId;
  });
}

async function filesRpc(
  name: string,
  args: RpcArgs,
  user: AuthUser,
): Promise<unknown> {
  if (name === "files.updateContent" || name === "files.update") {
    const fileId = asString(args.fileId, "fileId");
    const current = await sql(
      `select project_id
       from files
       where id = $1`,
      [fileId],
    );

    if (!current.rows[0]) {
      throw new Error("File not found");
    }

    const projectId = String(current.rows[0].project_id);
    await assertProjectAccess(user.id, projectId);

    await sql(
      `update files
       set content = $1,
           language = coalesce($2, language),
           updated_at = now()
       where id = $3`,
      [
        asString(args.content, "content"),
        optionalString(args.language),
        fileId,
      ],
    );

    await notifyProject({
      type: "file.updated",
      projectId,
      entity: "file",
      id: fileId,
    });

    return null;
  }

  if (name === "files.rename") {
    const fileId = asString(args.fileId, "fileId");
    const current = await sql(
      "select project_id from files where id = $1",
      [fileId],
    );

    if (!current.rows[0]) {
      throw new Error("File not found");
    }

    const projectId = String(current.rows[0].project_id);
    await assertProjectAccess(user.id, projectId);

    await sql(
      `update files
       set name = $1,
           path = $2,
           updated_at = now()
       where id = $3`,
      [
        asString(args.newName, "newName"),
        asString(args.newPath, "newPath"),
        fileId,
      ],
    );

    await notifyProject({
      type: "file.renamed",
      projectId,
      entity: "file",
      id: fileId,
    });

    return null;
  }

  if (name === "files.remove") {
    const fileId = asString(args.fileId, "fileId");
    const current = await sql(
      "select project_id from files where id = $1",
      [fileId],
    );

    if (!current.rows[0]) {
      return null;
    }

    const projectId = String(current.rows[0].project_id);
    await assertProjectAccess(user.id, projectId);
    await sql("delete from files where id = $1", [fileId]);
    await notifyProject({
      type: "file.deleted",
      projectId,
      entity: "file",
      id: fileId,
    });
    return null;
  }

  const projectId = asString(args.projectId, "projectId");
  await assertProjectAccess(user.id, projectId);

  if (name === "files.listByProject") {
    const result = await sql(
      `select *
       from files
       where project_id = $1
       order by path asc`,
      [projectId],
    );

    return result.rows.map((row) => fileShape(row));
  }

  if (name === "files.getByPath") {
    const result = await sql(
      `select *
       from files
       where project_id = $1
         and path = $2
       limit 1`,
      [projectId, asString(args.path, "path")],
    );

    return result.rows[0] ? fileShape(result.rows[0]) : null;
  }

  if (name === "files.create") {
    const result = await sql(
      `insert into files(
         project_id,
         path,
         name,
         content,
         language,
         is_directory,
         parent_path
       )
       values($1, $2, $3, $4, $5, $6, $7)
       returning id`,
      [
        projectId,
        asString(args.path, "path"),
        asString(args.name, "name"),
        optionalString(args.content) ?? "",
        optionalString(args.language),
        Boolean(args.isDirectory),
        optionalString(args.parentPath),
      ],
    );

    const id = String(one(result).id);
    await notifyProject({
      type: "file.created",
      projectId,
      entity: "file",
      id,
    });
    return id;
  }

  if (name === "files.bulkInsert") {
    const files = Array.isArray(args.files) ? args.files : [];

    await withTransaction(async (client) => {
      for (const raw of files) {
        const file = raw as Record<string, unknown>;
        const path = asString(file.path, "files[].path");
        const fileName = asString(file.name, "files[].name");

        await client.query(
          `insert into files(
             project_id,
             path,
             name,
             content,
             language,
             is_directory,
             parent_path
           )
           values($1, $2, $3, $4, $5, $6, $7)
           on conflict(project_id, path)
           do update
           set name = excluded.name,
               content = excluded.content,
               language = excluded.language,
               is_directory = excluded.is_directory,
               parent_path = excluded.parent_path,
               updated_at = now()`,
          [
            projectId,
            path,
            fileName,
            optionalString(file.content) ?? "",
            optionalString(file.language),
            file.type === "folder",
            path.includes("/")
              ? path.split("/").slice(0, -1).join("/")
              : null,
          ],
        );
      }
    });

    await notifyProject({
      type: "files.bulk_updated",
      projectId,
      entity: "project",
      id: projectId,
    });

    return {
      inserted: files.length,
    };
  }

  throw new RpcNotImplementedError(name);
}

async function chatRpc(
  name: string,
  args: RpcArgs,
  user: AuthUser,
): Promise<unknown> {
  if (
    name === "chat.renameSession" ||
    name === "chat.deleteSession" ||
    name === "chat.archiveSession" ||
    name === "chat.updateModel" ||
    name === "chat.getSession" ||
    name === "chat.listMessages"
  ) {
    const sessionId = asString(args.sessionId, "sessionId");
    const sessionResult = await sql(
      `select *
       from chat_sessions
       where id = $1`,
      [sessionId],
    );
    const session = sessionResult.rows[0];

    if (!session || String(session.user_id) !== user.id) {
      throw new Error("Chat session not found");
    }

    const projectId = String(session.project_id);
    await assertProjectAccess(user.id, projectId);

    if (name === "chat.getSession") {
      return sessionShape(session);
    }

    if (name === "chat.listMessages") {
      const result = await sql(
        `select *
         from chat_messages
         where session_id = $1
         order by created_at asc`,
        [sessionId],
      );

      return result.rows.map((row) => messageShape(row));
    }

    if (name === "chat.renameSession") {
      await sql(
        `update chat_sessions
         set title = $1,
             updated_at = now()
         where id = $2`,
        [asString(args.title, "title"), sessionId],
      );
    }

    if (name === "chat.archiveSession") {
      await sql(
        `update chat_sessions
         set is_archived = true,
             updated_at = now()
         where id = $1`,
        [sessionId],
      );
    }

    if (name === "chat.updateModel") {
      await sql(
        `update chat_sessions
         set model = $1,
             updated_at = now()
         where id = $2`,
        [asString(args.model, "model"), sessionId],
      );
    }

    if (name === "chat.deleteSession") {
      await sql("delete from chat_sessions where id = $1", [sessionId]);
    }

    await notifyProject({
      type: "chat.session_updated",
      projectId,
      entity: "chatSession",
      id: sessionId,
    });

    return null;
  }

  const projectId = asString(args.projectId, "projectId");
  await assertProjectAccess(user.id, projectId);

  if (name === "chat.listSessions") {
    const result = await sql(
      `select *
       from chat_sessions
       where project_id = $1
         and user_id = $2
         and is_archived = false
       order by created_at desc`,
      [projectId, user.id],
    );

    return result.rows.map((row) => sessionShape(row));
  }

  if (name === "chat.getOrCreateSession") {
    const existing = await sql(
      `select *
       from chat_sessions
       where project_id = $1
         and user_id = $2
         and is_archived = false
       order by created_at desc
       limit 1`,
      [projectId, user.id],
    );

    if (existing.rows[0]) {
      return String(existing.rows[0].id);
    }

    const created = await sql(
      `insert into chat_sessions(
         project_id,
         user_id,
         model,
         total_tokens_used,
         total_cost
       )
       values($1, $2, $3, 0, 0)
       returning id`,
      [
        projectId,
        user.id,
        optionalString(args.model) ?? "auto",
      ],
    );

    return String(one(created).id);
  }

  if (name === "chat.createSession") {
    const created = await sql(
      `insert into chat_sessions(
         project_id,
         user_id,
         title,
         model
       )
       values($1, $2, $3, $4)
       returning id`,
      [
        projectId,
        user.id,
        optionalString(args.title) ?? "New Chat",
        optionalString(args.model) ?? "auto",
      ],
    );

    return String(one(created).id);
  }

  if (name === "chat.addMessage") {
    const sessionId = asString(args.sessionId, "sessionId");
    const role = asString(args.role, "role");

    if (!["user", "assistant", "system"].includes(role)) {
      throw new Error("role must be user, assistant, or system");
    }

    const session = await sql(
      `select project_id, user_id
       from chat_sessions
       where id = $1`,
      [sessionId],
    );

    if (
      !session.rows[0] ||
      String(session.rows[0].project_id) !== projectId ||
      String(session.rows[0].user_id) !== user.id
    ) {
      throw new Error("Chat session not found");
    }

    const result = await sql(
      `insert into chat_messages(
         session_id,
         project_id,
         user_id,
         role,
         content,
         model,
         tokens_used,
         cost,
         is_error,
         file_contexts,
         agent_id,
         agent_role
       )
       values(
         $1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12
       )
       returning id`,
      [
        sessionId,
        projectId,
        user.id,
        role,
        asString(args.content, "content"),
        optionalString(args.model),
        typeof args.tokensUsed === "number" ? args.tokensUsed : null,
        typeof args.cost === "number" ? args.cost : null,
        Boolean(args.isError),
        JSON.stringify(args.fileContexts ?? null),
        optionalString(args.agentId),
        optionalString(args.agentRole),
      ],
    );

    const id = String(one(result).id);

    await notifyProject({
      type: "chat.message_created",
      projectId,
      entity: "chatMessage",
      id,
    });

    return id;
  }

  throw new RpcNotImplementedError(name);
}


async function usersRpc(
  name: string,
  args: RpcArgs,
  user: AuthUser,
): Promise<unknown> {
  if (name === "users.getProfile") {
    return currentUserShape(user);
  }

  if (name === "users.completeOnboarding") {
    await sql(
      `update users
       set onboarded = true,
           updated_at = now()
       where id = $1`,
      [user.id],
    );
    return null;
  }

  if (name === "users.updateAiProfile") {
    await sql(
      `update users
       set ai_profile = $1,
           updated_at = now()
       where id = $2`,
      [asString(args.aiProfile, "aiProfile"), user.id],
    );

    return {
      success: true,
    };
  }

  if (name === "users.deleteAccount") {
    await sql("delete from users where id = $1", [user.id]);
    return {
      success: true,
    };
  }

  throw new RpcNotImplementedError(name);
}

export async function executeRpc(
  name: string,
  args: RpcArgs,
  user: AuthUser,
): Promise<unknown> {
  if (name === "auth.currentUser") {
    return currentUserShape(user);
  }

  if (name === "auth.enabledOAuthProviders") {
    return {
      github: false,
      google: false,
    };
  }

  if (name === "projects.create") {
    const projectId = await createProject(args, user);
    await notifyProject({
      type: "project.created",
      projectId,
      entity: "project",
      id: projectId,
    });
    return projectId;
  }

  if (name.startsWith("projects.")) {
    return projectsRpc(name, args, user);
  }

  if (name.startsWith("files.")) {
    return filesRpc(name, args, user);
  }

  try {
    return await executePortedRpc(name, args, user);
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("not a batch-1 RPC")
    ) {
      // fall through to the module handlers below
    } else {
      throw error;
    }
  }

  if (name.startsWith("chat.")) {
    return chatRpc(name, args, user);
  }

  if (name.startsWith("users.")) {
    return usersRpc(name, args, user);
  }

  throw new RpcNotImplementedError(name);
}
