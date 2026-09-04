# CodeForge: Convex → Railway/Postgres Rebuild

**Status: Phase 2 (bundle applied) — approved by Don 2026-09-04: "rebuild on railway, no convex."**

> **2026-09-04 update:** the full migration bundle (server/, src/lib/backend-*,
> Dockerfile.railway, migration gates, orchestrator cutover scripts) has been
> applied to this branch on top of the Phase 1 scaffold. Both coexist:
> `server/sql/001-003` is the operative schema for the new runtime;
> `railway/migrations/0001_convex_to_postgres.sql` remains as the complete
> 51-table + authTables reference DDL (superset — useful when porting the
> remaining RPCs, since it covers every Convex table the bundle's core schema
> does not yet normalize). Real validation this session: both server packages
> `npm install` + `tsc --noEmit` CLEAN (19 strict-null errors found and fixed
> in the bundle's server sources first), SQL structurally verified, secret
> scan clean. NOT deployed; NOT on main. Convex stays live until
> `rpc-coverage.mjs` passes and the manual gates in the bundle README clear.
> Note: `.env.local` + `.env.local.backup` are tracked on origin/main —
> private repo, but rotation recommended before/after cutover.

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
