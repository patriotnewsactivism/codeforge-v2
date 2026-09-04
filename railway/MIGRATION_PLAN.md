# CodeForge: Convex → Railway/Postgres Rebuild

**Status: Phase 1 (scaffold) — approved by Don 2026-09-04: "rebuild on railway, no convex."**

## Target architecture

| Service (Railway project `CodeForge`) | Public | Role |
|---|---|---|
| codeforge-app | ✅ | Frontend + Fastify API + WebSocket server |
| codeforge-orchestrator | ❌ | Long-running agent execution (existing repo has its own Dockerfile) |
| codeforge-postgres | ❌ | Canonical DB: projects/files/chat/builds/agents/auth/jobs |

No Redis. Job queue is a `jobs` table with `FOR UPDATE SKIP LOCKED`
(see `server/jobs.sql`). Add Redis later only if horizontal scaling requires it.

## Phases

1. **Schema (done in this branch):** `migrations/0001_convex_to_postgres.sql` —
   all 51 schema tables + 4 `@convex-dev/auth` tables, translated from
   `convex/schema.ts`. UUID PKs; `convex_id TEXT UNIQUE` on every table maps
   old document IDs during import. 109 indexes preserved.
2. **API:** port the ~180 Convex queries/mutations to Fastify REST routes
   (`server/index.ts` shows the pattern: auth hook + example projects route).
3. **Realtime:** Convex subscriptions → WebSocket fan-out (`/ws` stub) fed by a
   transactional outbox on core tables.
4. **Jobs:** Convex actions/scheduled jobs → `jobs` table + worker loop
   (`server/jobs.ts` registry).
5. **Data migration:** export Convex → insert into Postgres.
   ⚠️ BLOCKED: the `enchanted-terrier-643` Convex deployment is disabled for
   free-plan limits, so `npx convex export` likely fails until billing is
   resolved. Schema work does not depend on this; data import does.
6. **Cutover:** repoint code.donmatthews.live from Vercel/Convex to the
   Railway service. Only after 1–5 verify live.

## Convex type → Postgres mapping

- `v.id("t")` → `UUID` + FK where cross-table
- `v.number()` → `DOUBLE PRECISION` (Convex numbers are float64)
- `v.array/object/record` → `JSONB`
- `v.union(v.literal(...))` → `TEXT` (app-level validation)
- timestamps stored as epoch-ms numbers → stay `DOUBLE PRECISION` for
  migration fidelity; Phase 2+ may migrate hot ones to `TIMESTAMPTZ`.

## Env vars (set on Railway before first deploy)

- `DATABASE_URL` — Postgres connection string
- `JWT_SECRET` — replaces @convex-dev/auth session issuance
