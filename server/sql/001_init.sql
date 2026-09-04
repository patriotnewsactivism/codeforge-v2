begin;

create extension if not exists pgcrypto;

create table if not exists users (
  id text primary key default gen_random_uuid()::text,
  name text,
  image text,
  email text,
  phone text,
  github_token text,
  onboarded boolean not null default false,
  plan text,
  subscription_status text,
  ai_profile text,
  password_hash text,
  password_reset_required boolean not null default false,
  email_verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists users_email_lower_uidx
  on users(lower(email))
  where email is not null;

create table if not exists projects (
  id text primary key default gen_random_uuid()::text,
  name text not null,
  description text,
  owner_id text not null references users(id) on delete cascade,
  github_repo text,
  language text,
  last_opened_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists projects_owner_idx
  on projects(owner_id, last_opened_at desc);

create table if not exists files (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  path text not null,
  name text not null,
  content text not null default '',
  language text,
  is_directory boolean not null default false,
  parent_path text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, path)
);

create index if not exists files_project_idx on files(project_id);

create table if not exists chat_sessions (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  title text,
  model text not null default 'auto',
  total_tokens_used bigint not null default 0,
  total_cost numeric(18, 8) not null default 0,
  is_archived boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists chat_sessions_project_idx
  on chat_sessions(project_id, created_at desc);

create table if not exists chat_messages (
  id text primary key default gen_random_uuid()::text,
  session_id text not null references chat_sessions(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  user_id text references users(id) on delete set null,
  role text not null check (role in ('user', 'assistant', 'system')),
  content text not null,
  model text,
  tokens_used bigint,
  cost numeric(18, 8),
  is_error boolean not null default false,
  file_contexts jsonb,
  agent_id text,
  agent_role text,
  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_idx
  on chat_messages(session_id, created_at asc);

create table if not exists collaborators (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  user_name text not null,
  active_file text,
  cursor_line integer,
  cursor_column integer,
  last_seen_at timestamptz not null default now(),
  color text not null default '#888888',
  created_at timestamptz not null default now(),
  unique(project_id, user_id)
);

create table if not exists project_invites (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  invited_by text not null references users(id) on delete cascade,
  invite_code text not null unique,
  expires_at timestamptz not null,
  is_public boolean not null default false,
  session_name text,
  created_at timestamptz not null default now()
);

create table if not exists suggestions (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  title text not null,
  description text not null,
  category text not null,
  priority text not null,
  status text not null,
  implementation_prompt text not null,
  generated_at timestamptz not null default now(),
  impact_score double precision,
  auto_approved boolean,
  created_at timestamptz not null default now()
);

create index if not exists suggestions_project_status_idx
  on suggestions(project_id, status);

create table if not exists change_history (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  suggestion_id text references suggestions(id) on delete set null,
  build_step_id text,
  file_path text not null,
  previous_content text not null,
  new_content text not null,
  action text not null check (action in ('create', 'edit', 'delete')),
  happened_at timestamptz not null default now(),
  undone boolean not null default false
);

create table if not exists build_sessions (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  status text not null,
  goal text,
  current_step text,
  total_steps integer,
  completed_steps integer,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists build_steps (
  id text primary key default gen_random_uuid()::text,
  build_session_id text not null references build_sessions(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  step_number integer not null,
  action text not null,
  description text not null,
  files_changed jsonb not null default '[]'::jsonb,
  status text not null,
  error_message text,
  happened_at timestamptz not null default now()
);

create table if not exists orchestrator_sessions (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  goal text not null,
  state text not null,
  plan text,
  complexity text,
  total_tasks integer,
  completed_tasks integer,
  failed_tasks integer,
  total_tokens_used bigint,
  cost_budget_tokens bigint,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  error text
);

create table if not exists agent_tasks (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  build_session_id text references build_sessions(id) on delete set null,
  orchestrator_session_id text references orchestrator_sessions(id) on delete set null,
  parent_task_id text references agent_tasks(id) on delete set null,
  agent_id text not null,
  agent_name text not null,
  agent_icon text not null,
  role text,
  task text not null,
  status text not null,
  result text,
  files_changed jsonb,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  provider text,
  worktree_path text,
  cost_budget_tokens bigint,
  cost_spent_tokens bigint,
  recovery_checkpoints jsonb,
  dependencies jsonb
);

create index if not exists agent_tasks_project_status_idx
  on agent_tasks(project_id, status);

create table if not exists agent_memories (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  category text not null,
  content text not null,
  importance double precision not null,
  usage_count integer not null default 0,
  last_used_at timestamptz not null default now(),
  source_task_id text references agent_tasks(id) on delete set null,
  source_retro_id text,
  decay_factor double precision not null default 1,
  embedding text,
  is_approved boolean,
  created_at timestamptz not null default now()
);

create table if not exists task_retrospectives (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  trigger_task_id text references agent_tasks(id) on delete set null,
  build_session_id text references build_sessions(id) on delete set null,
  quality_score double precision not null,
  what_worked jsonb not null default '[]'::jsonb,
  what_failed jsonb not null default '[]'::jsonb,
  improvements jsonb not null default '[]'::jsonb,
  memories_created jsonb not null default '[]'::jsonb,
  raw_analysis text not null,
  agents_involved jsonb not null default '[]'::jsonb,
  happened_at timestamptz not null default now()
);

create table if not exists refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  token_hash text not null unique,
  expires_at timestamptz not null,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists refresh_tokens_user_idx
  on refresh_tokens(user_id, expires_at desc);

create table if not exists password_reset_codes (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  code_hash text not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  attempts integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists realtime_tickets (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references users(id) on delete cascade,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists jobs (
  id uuid primary key default gen_random_uuid(),
  project_id text references projects(id) on delete cascade,
  user_id text references users(id) on delete set null,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  result jsonb,
  status text not null default 'pending'
    check (status in ('pending', 'processing', 'completed', 'failed')),
  priority integer not null default 100,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  available_at timestamptz not null default now(),
  lease_token uuid,
  leased_until timestamptz,
  error text,
  idempotency_key text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create index if not exists jobs_claim_idx
  on jobs(status, priority, available_at, created_at);

create unique index if not exists jobs_idempotency_uidx
  on jobs(idempotency_key)
  where idempotency_key is not null;

create table if not exists legacy_convex_documents (
  table_name text not null,
  convex_id text not null,
  creation_time double precision,
  document jsonb not null,
  imported_at timestamptz not null default now(),
  primary key(table_name, convex_id)
);

create index if not exists legacy_convex_table_idx
  on legacy_convex_documents(table_name);

create or replace function claim_codeforge_jobs(
  p_limit integer default 5,
  p_lease_seconds integer default 900
)
returns setof jobs
language plpgsql
as $$
begin
  return query
  with candidates as (
    select job.id
    from jobs as job
    where job.status = 'pending'
      and job.available_at <= now()
      and job.attempts < job.max_attempts
    order by job.priority asc, job.created_at asc
    for update skip locked
    limit greatest(1, least(p_limit, 50))
  ),
  claimed as (
    update jobs as job
    set status = 'processing',
        attempts = attempts + 1,
        started_at = coalesce(started_at, now()),
        lease_token = gen_random_uuid(),
        leased_until = now() + make_interval(
          secs => greatest(30, least(p_lease_seconds, 86400))
        ),
        updated_at = now()
    from candidates
    where job.id = candidates.id
    returning job.*
  )
  select * from claimed;
end;
$$;


create or replace function complete_codeforge_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_result jsonb default '{}'::jsonb
)
returns boolean
language plpgsql
as $$
declare
  updated_count integer;
begin
  update jobs
  set status = 'completed',
      result = coalesce(p_result, '{}'::jsonb),
      lease_token = null,
      leased_until = null,
      completed_at = now(),
      updated_at = now()
  where id = p_job_id
    and status = 'processing'
    and lease_token = p_lease_token;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function fail_codeforge_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_error text,
  p_retry_delay_seconds integer default 30
)
returns boolean
language plpgsql
as $$
declare
  updated_count integer;
begin
  update jobs
  set status = case
        when attempts >= max_attempts then 'failed'
        else 'pending'
      end,
      error = left(coalesce(p_error, 'Unknown job failure'), 12000),
      available_at = case
        when attempts >= max_attempts then available_at
        else now() + make_interval(
          secs => greatest(1, least(p_retry_delay_seconds, 86400))
        )
      end,
      completed_at = case
        when attempts >= max_attempts then now()
        else null
      end,
      lease_token = null,
      leased_until = null,
      updated_at = now()
  where id = p_job_id
    and status = 'processing'
    and lease_token = p_lease_token;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function reap_codeforge_jobs()
returns table(requeued bigint, failed bigint)
language plpgsql
as $$
declare
  requeued_count bigint := 0;
  failed_count bigint := 0;
begin
  with updated as (
    update jobs
    set status = case
          when attempts >= max_attempts then 'failed'
          else 'pending'
        end,
        error = case
          when attempts >= max_attempts
            then coalesce(error, 'Worker lease expired')
          else error
        end,
        completed_at = case
          when attempts >= max_attempts then now()
          else null
        end,
        lease_token = null,
        leased_until = null,
        available_at = case
          when attempts >= max_attempts then available_at
          else now() + interval '30 seconds'
        end,
        updated_at = now()
    where status = 'processing'
      and leased_until < now()
    returning status
  )
  select
    count(*) filter (where status = 'pending'),
    count(*) filter (where status = 'failed')
  into requeued_count, failed_count
  from updated;

  return query select requeued_count, failed_count;
end;
$$;


commit;
