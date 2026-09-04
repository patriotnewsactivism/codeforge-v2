import { existsSync } from "node:fs";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import staticPlugin from "@fastify/static";
import websocket from "@fastify/websocket";
import Fastify from "fastify";
import { z } from "zod";
import {
  AuthError,
  login,
  logout,
  refreshSession,
  register,
  requestPasswordReset,
  requireUser,
  resetPassword,
} from "./auth.js";
import { config } from "./config.js";
import { assertProjectAccess } from "./access.js";
import { one, pool, sql } from "./db.js";
import {
  attachSocket,
  consumeRealtimeTicket,
  createRealtimeTicket,
  startRealtimeListener,
} from "./realtime.js";
import { executeRpc, RpcNotImplementedError } from "./rpc.js";
import { registerSwarmRoutes } from "./swarm-routes.js";

const app = Fastify({
  logger: true,
  bodyLimit: 4 * 1024 * 1024,
});

await app.register(cookie);
await app.register(cors, {
  origin: config.APP_ORIGIN,
  credentials: true,
});
await app.register(websocket);
await registerSwarmRoutes(app);

app.setErrorHandler((error, _request, reply) => {
  if (error instanceof AuthError) {
    void reply.code(error.statusCode).send({
      error: error.message,
      code: error.code,
    });
    return;
  }

  if (error instanceof RpcNotImplementedError) {
    void reply.code(501).send({
      error: error.message,
      code: "NOT_IMPLEMENTED",
      rpc: error.rpcName,
    });
    return;
  }

  if (error instanceof z.ZodError) {
    void reply.code(400).send({
      error: "Invalid request",
      issues: error.issues,
    });
    return;
  }

  const statusCode =
    typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? Number((error as { statusCode: number }).statusCode)
      : 500;

  if (statusCode >= 500) {
    app.log.error(error);
  }

  void reply.code(statusCode).send({
    error:
      statusCode >= 500
        ? "Internal server error"
        : error instanceof Error
          ? error.message
          : String(error),
  });
});

app.get("/healthz", async () => ({
  status: "ok",
  service: "codeforge-app",
}));

app.get("/readyz", async (_request, reply) => {
  try {
    await sql("select 1");
    return {
      status: "ready",
    };
  } catch (error) {
    return reply.code(503).send({
      status: "not_ready",
      error: error instanceof Error ? error.message : "Database error",
    });
  }
});

app.post("/api/auth/register", async (request, reply) => {
  const body = z
    .object({
      name: z.string().min(1).max(160),
      email: z.string().email(),
      password: z.string().min(8).max(256),
    })
    .parse(request.body);

  return register(body, reply);
});

app.post("/api/auth/login", async (request, reply) => {
  const body = z
    .object({
      email: z.string().email(),
      password: z.string().min(1).max(256),
    })
    .parse(request.body);

  return login(body.email, body.password, reply);
});

app.post("/api/auth/refresh", async (request, reply) =>
  refreshSession(request, reply),
);

app.post("/api/auth/logout", async (request, reply) => {
  await logout(request, reply);
  return reply.code(204).send();
});

app.post("/api/auth/password-reset/request", async (request) => {
  const body = z
    .object({
      email: z.string().email(),
    })
    .parse(request.body);

  await requestPasswordReset(body.email);

  return {
    ok: true,
  };
});

app.post("/api/auth/password-reset/confirm", async (request) => {
  const body = z
    .object({
      email: z.string().email(),
      code: z.string().min(4).max(32),
      newPassword: z.string().min(8).max(256),
    })
    .parse(request.body);

  await resetPassword(body);

  return {
    ok: true,
  };
});

app.get("/api/auth/me", async (request) => requireUser(request));

app.post("/api/realtime/ticket", async (request) => {
  const user = await requireUser(request);

  return {
    ticket: await createRealtimeTicket(user.id),
  };
});

app.post("/api/swarm-tasks", async (request, reply) => {
  const user = await requireUser(request);
  const body = z
    .object({
      projectId: z.string().min(1),
      prompt: z.string().min(1).max(100_000),
      priority: z
        .enum(["low", "normal", "high", "critical"])
        .default("normal"),
    })
    .parse(request.body);

  await assertProjectAccess(user.id, body.projectId);

  const result = await sql(
    `insert into swarm_tasks(
       project_id,
       user_id,
       prompt,
       priority,
       status
     )
     values($1, $2, $3, $4, 'pending')
     returning *`,
    [body.projectId, user.id, body.prompt, body.priority],
  );

  const row = one(result);
  return reply.code(202).send({
    id: String(row.id),
    status: String(row.status),
  });
});

app.get("/api/swarm-tasks/:taskId", async (request) => {
  const user = await requireUser(request);
  const params = z
    .object({
      taskId: z.string().min(1),
    })
    .parse(request.params);

  const result = await sql(
    `select *
     from swarm_tasks
     where id = $1`,
    [params.taskId],
  );

  const task = result.rows[0];

  if (!task) {
    throw Object.assign(new Error("Swarm task not found"), {
      statusCode: 404,
    });
  }

  await assertProjectAccess(user.id, String(task.project_id));

  return {
    id: String(task.id),
    projectId: String(task.project_id),
    prompt: String(task.prompt),
    status: String(task.status),
    priority: String(task.priority),
    errorMessage: task.error_message ?? null,
    totalAgentsSpawned: task.total_agents_spawned ?? null,
    totalFilesChanged: task.total_files_changed ?? null,
    rootAgentId: task.root_agent_id ?? null,
    startedAt: new Date(task.started_at).getTime(),
    completedAt: task.completed_at
      ? new Date(task.completed_at).getTime()
      : null,
  };
});

app.get(
  "/ws",
  {
    websocket: true,
  },
  (socket, request) => {
    void (async () => {
      const query = z
        .object({
          ticket: z.string().uuid(),
        })
        .safeParse(request.query);

      if (!query.success) {
        socket.close(1008, "Invalid realtime ticket");
        return;
      }

      const userId = await consumeRealtimeTicket(query.data.ticket);

      if (!userId) {
        socket.close(1008, "Realtime ticket expired");
        return;
      }

      attachSocket(socket, userId);
      socket.send(JSON.stringify({ type: "ready" }));
    })().catch((error) => {
      app.log.error(error);
      socket.close(1011, "Realtime initialization failed");
    });
  },
);

app.post("/api/rpc", async (request) => {
  const user = await requireUser(request);
  const body = z
    .object({
      name: z.string().min(3).max(200),
      args: z.record(z.unknown()).default({}),
      kind: z.enum(["query", "mutation", "action"]).default("query"),
    })
    .parse(request.body);

  return executeRpc(body.name, body.args, user);
});

await startRealtimeListener();

if (existsSync(config.STATIC_DIR)) {
  await app.register(staticPlugin, {
    root: config.STATIC_DIR,
    prefix: "/",
  });

  app.setNotFoundHandler((request, reply) => {
    if (request.url.startsWith("/api/") || request.url.startsWith("/ws")) {
      void reply.code(404).send({
        error: "Not found",
      });
      return;
    }

    void reply.sendFile("index.html");
  });
}

const shutdown = async (signal: string) => {
  app.log.info({ signal }, "shutting down");
  await app.close();
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", () => {
  void shutdown("SIGINT");
});
process.on("SIGTERM", () => {
  void shutdown("SIGTERM");
});

await app.listen({
  host: "0.0.0.0",
  port: config.PORT,
});
