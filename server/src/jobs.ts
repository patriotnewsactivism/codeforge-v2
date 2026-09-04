import { one, sql } from "./db.js";

export interface Job {
  id: string;
  project_id: string | null;
  user_id: string | null;
  kind: string;
  payload: Record<string, unknown>;
  status: string;
  attempts: number;
  max_attempts: number;
  lease_token: string | null;
}

export async function enqueueJob(input: {
  projectId?: string;
  userId?: string;
  kind: string;
  payload?: Record<string, unknown>;
  idempotencyKey?: string;
  priority?: number;
}): Promise<string> {
  try {
    const result = await sql(
      `insert into jobs(
         project_id,
         user_id,
         kind,
         payload,
         idempotency_key,
         priority
       )
       values($1, $2, $3, $4::jsonb, $5, $6)
       returning id`,
      [
        input.projectId ?? null,
        input.userId ?? null,
        input.kind,
        JSON.stringify(input.payload ?? {}),
        input.idempotencyKey ?? null,
        input.priority ?? 100,
      ],
    );

    return String(one(result).id);
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "code" in error &&
      error.code === "23505" &&
      input.idempotencyKey
    ) {
      const existing = await sql(
        `select id
         from jobs
         where idempotency_key = $1`,
        [input.idempotencyKey],
      );

      return String(one(existing).id);
    }

    throw error;
  }
}


export async function claimJobs(
  limit = 5,
  leaseSeconds = 900,
): Promise<Job[]> {
  const result = await sql(
    `select *
     from claim_codeforge_jobs($1, $2)`,
    [limit, leaseSeconds],
  );

  return result.rows.map((row) => ({
    id: String(row.id),
    project_id: row.project_id ? String(row.project_id) : null,
    user_id: row.user_id ? String(row.user_id) : null,
    kind: String(row.kind),
    payload: (row.payload ?? {}) as Record<string, unknown>,
    status: String(row.status),
    attempts: Number(row.attempts),
    max_attempts: Number(row.max_attempts),
    lease_token: row.lease_token ? String(row.lease_token) : null,
  }));
}

export async function completeJob(
  job: Job,
  result: Record<string, unknown> = {},
): Promise<void> {
  if (!job.lease_token) {
    throw new Error(`Job ${job.id} has no lease token`);
  }

  const response = await sql(
    `select complete_codeforge_job(
       $1::uuid,
       $2::uuid,
       $3::jsonb
     ) as completed`,
    [job.id, job.lease_token, JSON.stringify(result)],
  );

  if (!response.rows[0]?.completed) {
    throw new Error(`Could not complete job ${job.id}; lease was lost`);
  }
}

export async function failJob(
  job: Job,
  error: string,
  retryDelaySeconds = 30,
): Promise<void> {
  if (!job.lease_token) {
    throw new Error(`Job ${job.id} has no lease token`);
  }

  const response = await sql(
    `select fail_codeforge_job(
       $1::uuid,
       $2::uuid,
       $3,
       $4
     ) as failed`,
    [job.id, job.lease_token, error, retryDelaySeconds],
  );

  if (!response.rows[0]?.failed) {
    throw new Error(`Could not fail job ${job.id}; lease was lost`);
  }
}

export async function reapJobs(): Promise<{
  requeued: number;
  failed: number;
}> {
  const result = await sql(
    "select * from reap_codeforge_jobs()",
  );

  return {
    requeued: Number(result.rows[0]?.requeued ?? 0),
    failed: Number(result.rows[0]?.failed ?? 0),
  };
}
