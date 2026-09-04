begin;

create table if not exists swarm_tasks (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  user_id text not null references users(id) on delete cascade,
  prompt text not null,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'completed', 'failed')),
  priority text not null default 'normal',
  worker_id text,
  heartbeat_at timestamptz,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  error_message text,
  total_agents_spawned integer,
  total_files_changed integer,
  root_agent_id text,
  started_at timestamptz not null default now(),
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists swarm_tasks_poll_idx
  on swarm_tasks(status, created_at);

create table if not exists swarm_agents (
  id text primary key default gen_random_uuid()::text,
  task_id text not null references swarm_tasks(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  agent_uid text not null,
  parent_agent_uid text,
  role text not null,
  status text not null,
  assignment text not null,
  depth integer not null default 0,
  files_owned jsonb not null default '[]'::jsonb,
  result text,
  error_message text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id, agent_uid)
);

create index if not exists swarm_agents_task_idx
  on swarm_agents(task_id, created_at);

create table if not exists swarm_events (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references swarm_tasks(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  agent_uid text not null,
  agent_role text not null,
  event_type text not null,
  content text not null,
  metadata text,
  created_at timestamptz not null default now()
);

create index if not exists swarm_events_task_idx
  on swarm_events(task_id, created_at);

create table if not exists sandbox_results (
  id uuid primary key default gen_random_uuid(),
  task_id text not null references swarm_tasks(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  agent_uid text not null,
  command text not null,
  stdout text,
  stderr text,
  exit_code integer not null,
  duration_ms integer not null,
  created_at timestamptz not null default now()
);

create table if not exists swarm_memories (
  id text primary key default gen_random_uuid()::text,
  project_id text not null references projects(id) on delete cascade,
  category text not null,
  title text not null,
  content text not null,
  importance double precision not null default 0.5,
  usage_count integer not null default 0,
  last_used_at timestamptz not null default now(),
  source_task_id text references swarm_tasks(id) on delete set null,
  source_agent_role text,
  decay_factor double precision not null default 1,
  created_at timestamptz not null default now()
);

create index if not exists swarm_memories_project_idx
  on swarm_memories(project_id, category, last_used_at desc);

create table if not exists swarm_retrospectives (
  id text primary key default gen_random_uuid()::text,
  task_id text not null references swarm_tasks(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  task_summary text not null,
  total_agents integer not null,
  total_files integer not null,
  duration_ms integer not null,
  sandbox_passed_first boolean not null,
  review_passed_first boolean not null,
  retry_count integer not null,
  what_worked jsonb not null default '[]'::jsonb,
  what_failed jsonb not null default '[]'::jsonb,
  improvements jsonb not null default '[]'::jsonb,
  new_memories jsonb not null default '[]'::jsonb,
  quality_score double precision not null,
  created_at timestamptz not null default now()
);

create table if not exists swarm_agent_messages (
  id text primary key default gen_random_uuid()::text,
  task_id text not null references swarm_tasks(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  from_agent_uid text not null,
  from_agent_role text not null,
  to_agent_uid text,
  to_agent_role text,
  message_type text not null,
  content text not null,
  created_at timestamptz not null default now()
);

create index if not exists swarm_messages_recipient_idx
  on swarm_agent_messages(task_id, to_agent_uid, created_at);

create table if not exists code_chunks (
  id uuid primary key default gen_random_uuid(),
  project_id text not null references projects(id) on delete cascade,
  file_path text not null,
  chunk_index integer not null,
  chunk_type text not null default 'code',
  name text,
  content text not null,
  start_line integer not null,
  end_line integer not null,
  language text,
  search_document tsvector generated always as (
    to_tsvector('simple', coalesce(file_path, '') || ' ' || coalesce(content, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(project_id, file_path, chunk_index)
);

create index if not exists code_chunks_search_idx
  on code_chunks using gin(search_document);

create table if not exists swarm_git_branches (
  id text primary key default gen_random_uuid()::text,
  task_id text not null references swarm_tasks(id) on delete cascade,
  project_id text not null references projects(id) on delete cascade,
  branch_name text not null,
  base_branch text not null default 'main',
  commit_sha text,
  pr_number integer,
  pr_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(task_id)
);

commit;
