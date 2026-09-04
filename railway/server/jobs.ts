/** Postgres job queue — claim/complete/fail helpers + job handler registry. */
import pg from "pg";

export interface Job {
  id: string;
  kind: string;
  payload: Record<string, unknown>;
  attempts: number;
  max_attempts: number;
}

export async function claimNextJob(pool: pg.Pool, workerId: string): Promise<Job | null> {
  const { rows } = await pool.query<Job>(
    `UPDATE jobs SET status = 'running', locked_by = $1, attempts = attempts + 1, updated_at = now()
     WHERE id = (
       SELECT id FROM jobs
       WHERE status = 'queued' AND run_at <= now()
       ORDER BY run_at
       FOR UPDATE SKIP LOCKED
       LIMIT 1
     )
     RETURNING id, kind, payload, attempts, max_attempts`,
    [workerId],
  );
  return rows[0] ?? null;
}

export async function completeJob(pool: pg.Pool, id: string, _result: unknown): Promise<void> {
  await pool.query(`UPDATE jobs SET status = 'done', updated_at = now() WHERE id = $1`, [id]);
}

export async function failJob(pool: pg.Pool, id: string, error: string, maxAttempts = 3): Promise<void> {
  await pool.query(
    `UPDATE jobs SET status = CASE WHEN attempts >= $2 THEN 'error' ELSE 'queued' END,
       last_error = $3, updated_at = now() WHERE id = $1`,
    [id, maxAttempts, error],
  );
}

export type JobContext = { pool: pg.Pool };
export type JobHandler = (payload: Record<string, unknown>, ctx: JobContext) => Promise<unknown>;

/** Registry — Phase 2+ ports each Convex action/scheduled job into this map. */
export const JOBS: Record<string, JobHandler> = {
  // "build.executeStep": async (payload, { pool }) => { ... },
  // "suggestions.generate": async (payload, { pool }) => { ... },
};
