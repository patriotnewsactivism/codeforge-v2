/**
 * CodeForge Railway backend — Phase 1 scaffold (Convex replacement).
 *
 * Approved direction (Don, 2026-09-04): rebuild on Railway with Postgres,
 * no Convex. This file is the skeleton: health/readiness, DB pool, JWT auth
 * hook, WebSocket upgrade stub, and a Postgres job-queue worker loop that
 * replaces Convex actions/scheduled jobs.
 *
 * NOT yet implemented (tracked in ../MIGRATION_PLAN.md):
 *   - the ~180 Convex query/mutation endpoints as REST routes
 *   - Convex subscription → WebSocket event fan-out
 *   - data migration from the disabled Convex deployment
 *   - domain cutover from code.donmatthews.live (Vercel/Convex)
 */
import Fastify from "fastify";
import fastifyWebsocket from "@fastify/websocket";
import pg from "pg";
import jwt from "jsonwebtoken";
import { claimNextJob, completeJob, failJob, JOBS } from "./jobs.js";

const PORT = Number(process.env.PORT ?? 8080);
const DATABASE_URL = process.env.DATABASE_URL;
const JWT_SECRET = process.env.JWT_SECRET ?? "dev-only-secret";

if (!DATABASE_URL) {
  console.error("FATAL: DATABASE_URL is not set");
  process.exit(1);
}

const pool = new pg.Pool({ connectionString: DATABASE_URL, max: 10 });
const app = Fastify({ logger: true });

// ── auth: replace @convex-dev/auth with our own JWT ─────────────────────────
declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
  }
}
app.addHook("onRequest", async (req) => {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return;
  try {
    const claims = jwt.verify(header.slice(7), JWT_SECRET) as { sub: string };
    req.userId = claims.sub;
  } catch {
    // invalid token == anonymous; route handlers enforce auth themselves
  }
});
function requireAuth(req: { userId?: string }): asserts req is { userId: string } {
  if (!req.userId) throw new Error("UNAUTHORIZED");
}

// ── health ───────────────────────────────────────────────────────────────────
app.get("/api/health", async () => ({ ok: true, service: "codeforge-app" }));
app.get("/api/ready", async (_req, reply) => {
  try {
    await pool.query("SELECT 1");
    return { ready: true };
  } catch (e) {
    return reply.code(503).send({ ready: false, error: String(e) });
  }
});

// ── WebSocket: replaces Convex subscriptions ────────────────────────────────
await app.register(fastifyWebsocket);
app.get("/ws", { websocket: true }, (socket, req) => {
  // Phase 2: per-project event streams. A transactional outbox on core
  // tables feeds this; clients subscribe by projectId.
  socket.send(JSON.stringify({ type: "hello", userId: req.userId ?? null }));
});

// ── example resource route (pattern for the ~180 endpoints) ────────────────
app.get("/api/projects", async (req, reply) => {
  try {
    requireAuth(req);
  } catch {
    return reply.code(401).send({ error: "UNAUTHORIZED" });
  }
  const { rows } = await pool.query(
    "SELECT id, name, description, last_opened_at FROM projects WHERE owner_id = $1 ORDER BY last_opened_at DESC",
    [req.userId],
  );
  return rows;
});

// ── job worker loop: replaces Convex scheduled/actions ──────────────────────
let running = true;
async function workerLoop(workerId: string) {
  while (running) {
    const job = await claimNextJob(pool, workerId);
    if (!job) {
      await new Promise((r) => setTimeout(r, 2000));
      continue;
    }
    const handler = JOBS[job.kind];
    if (!handler) {
      await failJob(pool, job.id, `no handler for kind ${job.kind}`);
      continue;
    }
    try {
      const result = await handler(job.payload, { pool });
      await completeJob(pool, job.id, result);
    } catch (e) {
      await failJob(pool, job.id, String(e), job.max_attempts);
    }
  }
}

app.listen({ port: PORT, host: "0.0.0.0" }).then(() => {
  for (let i = 0; i < 2; i++) void workerLoop(`worker-${i}`);
});
