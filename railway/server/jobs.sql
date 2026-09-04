-- Postgres-backed job queue replacing Convex actions/scheduled jobs.
-- One row per job; workers claim with FOR UPDATE SKIP LOCKED — no Redis needed.
CREATE TABLE IF NOT EXISTS jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  kind TEXT NOT NULL,              -- e.g. "build.executeStep", "suggestions.generate"
  payload JSONB NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'queued',   -- queued|running|done|error
  run_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  attempts INT NOT NULL DEFAULT 0,
  max_attempts INT NOT NULL DEFAULT 3,
  last_error TEXT,
  locked_by TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_jobs_claim ON jobs (status, run_at) WHERE status = 'queued';
CREATE INDEX IF NOT EXISTS idx_jobs_kind ON jobs (kind);
