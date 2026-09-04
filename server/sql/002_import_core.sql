begin;

insert into users (
  id,
  name,
  image,
  email,
  phone,
  github_token,
  onboarded,
  plan,
  subscription_status,
  ai_profile,
  password_reset_required,
  created_at
)
select
  convex_id,
  document->>'name',
  document->>'image',
  document->>'email',
  document->>'phone',
  document->>'githubToken',
  coalesce((document->>'onboarded')::boolean, false),
  document->>'plan',
  document->>'subscriptionStatus',
  document->>'aiProfile',
  true,
  coalesce(
    to_timestamp(creation_time / 1000.0),
    now()
  )
from legacy_convex_documents
where table_name = 'users'
on conflict (id) do update
set name = excluded.name,
    image = excluded.image,
    email = excluded.email,
    phone = excluded.phone,
    github_token = excluded.github_token,
    onboarded = excluded.onboarded,
    plan = excluded.plan,
    subscription_status = excluded.subscription_status,
    ai_profile = excluded.ai_profile,
    updated_at = now();

insert into projects (
  id,
  name,
  description,
  owner_id,
  github_repo,
  language,
  last_opened_at,
  created_at
)
select
  convex_id,
  document->>'name',
  document->>'description',
  document->>'ownerId',
  document->>'githubRepo',
  document->>'language',
  coalesce(
    to_timestamp((document->>'lastOpenedAt')::double precision / 1000.0),
    now()
  ),
  coalesce(
    to_timestamp(creation_time / 1000.0),
    now()
  )
from legacy_convex_documents
where table_name = 'projects'
  and document->>'ownerId' in (select id from users)
on conflict (id) do update
set name = excluded.name,
    description = excluded.description,
    github_repo = excluded.github_repo,
    language = excluded.language,
    last_opened_at = excluded.last_opened_at,
    updated_at = now();

insert into files (
  id,
  project_id,
  path,
  name,
  content,
  language,
  is_directory,
  parent_path,
  created_at
)
select
  convex_id,
  document->>'projectId',
  document->>'path',
  document->>'name',
  coalesce(document->>'content', ''),
  document->>'language',
  coalesce((document->>'isDirectory')::boolean, false),
  document->>'parentPath',
  coalesce(
    to_timestamp(creation_time / 1000.0),
    now()
  )
from legacy_convex_documents
where table_name = 'files'
  and document->>'projectId' in (select id from projects)
on conflict (id) do update
set path = excluded.path,
    name = excluded.name,
    content = excluded.content,
    language = excluded.language,
    is_directory = excluded.is_directory,
    parent_path = excluded.parent_path,
    updated_at = now();

insert into chat_sessions (
  id,
  project_id,
  user_id,
  title,
  model,
  total_tokens_used,
  total_cost,
  is_archived,
  created_at
)
select
  convex_id,
  document->>'projectId',
  document->>'userId',
  document->>'title',
  coalesce(document->>'model', 'auto'),
  coalesce((document->>'totalTokensUsed')::bigint, 0),
  coalesce((document->>'totalCost')::numeric, 0),
  coalesce((document->>'isArchived')::boolean, false),
  coalesce(
    to_timestamp(
      coalesce(
        (document->>'createdAt')::double precision,
        creation_time
      ) / 1000.0
    ),
    now()
  )
from legacy_convex_documents
where table_name = 'chatSessions'
  and document->>'projectId' in (select id from projects)
  and document->>'userId' in (select id from users)
on conflict (id) do update
set title = excluded.title,
    model = excluded.model,
    total_tokens_used = excluded.total_tokens_used,
    total_cost = excluded.total_cost,
    is_archived = excluded.is_archived,
    updated_at = now();

insert into chat_messages (
  id,
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
  agent_role,
  created_at
)
select
  convex_id,
  document->>'sessionId',
  document->>'projectId',
  nullif(document->>'userId', ''),
  document->>'role',
  coalesce(document->>'content', ''),
  document->>'model',
  nullif(document->>'tokensUsed', '')::bigint,
  nullif(document->>'cost', '')::numeric,
  coalesce((document->>'isError')::boolean, false),
  document->'fileContexts',
  document->>'agentId',
  document->>'agentRole',
  coalesce(
    to_timestamp(creation_time / 1000.0),
    now()
  )
from legacy_convex_documents
where table_name = 'chatMessages'
  and document->>'sessionId' in (select id from chat_sessions)
  and document->>'projectId' in (select id from projects)
on conflict (id) do nothing;

insert into collaborators (
  id,
  project_id,
  user_id,
  user_name,
  active_file,
  cursor_line,
  cursor_column,
  last_seen_at,
  color,
  created_at
)
select
  convex_id,
  document->>'projectId',
  document->>'userId',
  coalesce(document->>'userName', 'Collaborator'),
  document->>'activeFile',
  nullif(document->>'cursorLine', '')::integer,
  nullif(document->>'cursorColumn', '')::integer,
  coalesce(
    to_timestamp((document->>'lastSeenAt')::double precision / 1000.0),
    now()
  ),
  coalesce(document->>'color', '#888888'),
  coalesce(to_timestamp(creation_time / 1000.0), now())
from legacy_convex_documents
where table_name = 'collaborators'
  and document->>'projectId' in (select id from projects)
  and document->>'userId' in (select id from users)
on conflict (id) do nothing;

insert into build_sessions (
  id,
  project_id,
  user_id,
  status,
  goal,
  current_step,
  total_steps,
  completed_steps,
  started_at,
  finished_at,
  created_at
)
select
  convex_id,
  document->>'projectId',
  document->>'userId',
  document->>'status',
  document->>'goal',
  document->>'currentStep',
  nullif(document->>'totalSteps', '')::integer,
  nullif(document->>'completedSteps', '')::integer,
  coalesce(
    to_timestamp((document->>'startedAt')::double precision / 1000.0),
    now()
  ),
  case
    when document ? 'finishedAt'
      then to_timestamp((document->>'finishedAt')::double precision / 1000.0)
    else null
  end,
  coalesce(to_timestamp(creation_time / 1000.0), now())
from legacy_convex_documents
where table_name = 'buildSessions'
  and document->>'projectId' in (select id from projects)
  and document->>'userId' in (select id from users)
on conflict (id) do nothing;

insert into orchestrator_sessions (
  id,
  project_id,
  goal,
  state,
  plan,
  complexity,
  total_tasks,
  completed_tasks,
  failed_tasks,
  total_tokens_used,
  cost_budget_tokens,
  started_at,
  finished_at,
  error
)
select
  convex_id,
  document->>'projectId',
  document->>'goal',
  document->>'state',
  document->>'plan',
  document->>'complexity',
  nullif(document->>'totalTasks', '')::integer,
  nullif(document->>'completedTasks', '')::integer,
  nullif(document->>'failedTasks', '')::integer,
  nullif(document->>'totalTokensUsed', '')::bigint,
  nullif(document->>'costBudgetTokens', '')::bigint,
  coalesce(
    to_timestamp((document->>'startedAt')::double precision / 1000.0),
    now()
  ),
  case
    when document ? 'finishedAt'
      then to_timestamp((document->>'finishedAt')::double precision / 1000.0)
    else null
  end,
  document->>'error'
from legacy_convex_documents
where table_name = 'orchestratorSessions'
  and document->>'projectId' in (select id from projects)
on conflict (id) do nothing;

commit;
