-- CodeForge Convex → PostgreSQL migration DDL
-- Generated from convex/schema.ts (51 tables) + @convex-dev/auth standard tables.
-- PKs are UUIDs; each table keeps its Convex document ID in convex_id TEXT UNIQUE
-- for data-migration mapping. Convex numbers (float64) → DOUBLE PRECISION.
-- Arrays/objects/unions-of-objects → JSONB; union-of-literals → TEXT (app-validated).

CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name TEXT,
  image TEXT,
  email TEXT,
  email_verification_time DOUBLE PRECISION,
  phone TEXT,
  phone_verification_time DOUBLE PRECISION,
  is_anonymous BOOLEAN,
  github_token TEXT,
  onboarded BOOLEAN,
  plan TEXT,
  subscription_status TEXT,
  ai_profile TEXT
);
CREATE INDEX idx_users_email ON users ("email");
CREATE INDEX idx_users_phone ON users ("phone");

CREATE TABLE projects (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  name TEXT NOT NULL,
  description TEXT,
  owner_id UUID NOT NULL,
  github_repo TEXT,
  language TEXT,
  last_opened_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_projects_by_owner ON projects ("owner_id");
CREATE INDEX idx_projects_by_owner_and_name ON projects ("owner_id", "name");
ALTER TABLE projects ADD CONSTRAINT fk_projects_owner_id FOREIGN KEY (owner_id) REFERENCES users(id);

CREATE TABLE files (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  path TEXT NOT NULL,
  name TEXT NOT NULL,
  content TEXT NOT NULL,
  language TEXT,
  is_directory BOOLEAN NOT NULL,
  parent_path TEXT
);
CREATE INDEX idx_files_by_project ON files ("project_id");
CREATE INDEX idx_files_by_project_and_path ON files ("project_id", "path");
ALTER TABLE files ADD CONSTRAINT fk_files_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE chatSessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  title TEXT,
  model TEXT NOT NULL,
  total_tokens_used DOUBLE PRECISION NOT NULL,
  total_cost DOUBLE PRECISION NOT NULL,
  created_at DOUBLE PRECISION,
  is_archived BOOLEAN
);
CREATE INDEX idx_chatSessions_by_project ON chatSessions ("project_id");
CREATE INDEX idx_chatSessions_by_user ON chatSessions ("user_id");
ALTER TABLE chatSessions ADD CONSTRAINT fk_chatSessions_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE chatSessions ADD CONSTRAINT fk_chatSessions_user_id FOREIGN KEY (user_id) REFERENCES users(id);

CREATE TABLE chatMessages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id UUID NOT NULL,
  project_id UUID NOT NULL,
  user_id UUID,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  model TEXT,
  tokens_used DOUBLE PRECISION,
  cost DOUBLE PRECISION,
  is_error BOOLEAN,
  file_contexts JSONB,
  agent_id TEXT,
  agent_role TEXT
);
CREATE INDEX idx_chatMessages_by_session ON chatMessages ("session_id");
ALTER TABLE chatMessages ADD CONSTRAINT fk_chatMessages_session_id FOREIGN KEY (session_id) REFERENCES chatSessions(id);
ALTER TABLE chatMessages ADD CONSTRAINT fk_chatMessages_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE chatMessages ADD CONSTRAINT fk_chatMessages_user_id FOREIGN KEY (user_id) REFERENCES users(id);

CREATE TABLE collaborators (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  user_name TEXT NOT NULL,
  active_file TEXT,
  cursor_line DOUBLE PRECISION,
  cursor_column DOUBLE PRECISION,
  last_seen_at DOUBLE PRECISION NOT NULL,
  color TEXT NOT NULL
);
CREATE INDEX idx_collaborators_by_project ON collaborators ("project_id");
CREATE INDEX idx_collaborators_by_project_and_user ON collaborators ("project_id", "user_id");
ALTER TABLE collaborators ADD CONSTRAINT fk_collaborators_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE collaborators ADD CONSTRAINT fk_collaborators_user_id FOREIGN KEY (user_id) REFERENCES users(id);

CREATE TABLE projectInvites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  invited_by UUID NOT NULL,
  invite_code TEXT NOT NULL,
  expires_at DOUBLE PRECISION NOT NULL,
  is_public BOOLEAN,
  session_name TEXT
);
CREATE INDEX idx_projectInvites_by_code ON projectInvites ("invite_code");
CREATE INDEX idx_projectInvites_by_project ON projectInvites ("project_id");
ALTER TABLE projectInvites ADD CONSTRAINT fk_projectInvites_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE projectInvites ADD CONSTRAINT fk_projectInvites_invited_by FOREIGN KEY (invited_by) REFERENCES users(id);

CREATE TABLE suggestions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  implementation_prompt TEXT NOT NULL,
  generated_at DOUBLE PRECISION NOT NULL,
  impact_score DOUBLE PRECISION,
  auto_approved BOOLEAN
);
CREATE INDEX idx_suggestions_by_project ON suggestions ("project_id");
CREATE INDEX idx_suggestions_by_project_and_status ON suggestions ("project_id", "status");
ALTER TABLE suggestions ADD CONSTRAINT fk_suggestions_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE changeHistory (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  suggestion_id UUID,
  build_step_id UUID,
  file_path TEXT NOT NULL,
  previous_content TEXT NOT NULL,
  new_content TEXT NOT NULL,
  action TEXT NOT NULL,
  timestamp DOUBLE PRECISION NOT NULL,
  undone BOOLEAN
);
CREATE INDEX idx_changeHistory_by_project ON changeHistory ("project_id");
CREATE INDEX idx_changeHistory_by_suggestion ON changeHistory ("suggestion_id");
ALTER TABLE changeHistory ADD CONSTRAINT fk_changeHistory_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE changeHistory ADD CONSTRAINT fk_changeHistory_suggestion_id FOREIGN KEY (suggestion_id) REFERENCES suggestions(id);
ALTER TABLE changeHistory ADD CONSTRAINT fk_changeHistory_build_step_id FOREIGN KEY (build_step_id) REFERENCES buildSteps(id);

CREATE TABLE buildSessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  user_id UUID NOT NULL,
  status TEXT NOT NULL,
  goal TEXT,
  current_step TEXT,
  total_steps DOUBLE PRECISION,
  completed_steps DOUBLE PRECISION,
  started_at DOUBLE PRECISION NOT NULL,
  finished_at DOUBLE PRECISION
);
CREATE INDEX idx_buildSessions_by_project ON buildSessions ("project_id");
ALTER TABLE buildSessions ADD CONSTRAINT fk_buildSessions_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE buildSessions ADD CONSTRAINT fk_buildSessions_user_id FOREIGN KEY (user_id) REFERENCES users(id);

CREATE TABLE buildSteps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  build_session_id UUID NOT NULL,
  project_id UUID NOT NULL,
  step_number DOUBLE PRECISION NOT NULL,
  action TEXT NOT NULL,
  description TEXT NOT NULL,
  files_changed JSONB NOT NULL,
  status TEXT NOT NULL,
  error_message TEXT,
  timestamp DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_buildSteps_by_build_session ON buildSteps ("build_session_id");
CREATE INDEX idx_buildSteps_by_project ON buildSteps ("project_id");
ALTER TABLE buildSteps ADD CONSTRAINT fk_buildSteps_build_session_id FOREIGN KEY (build_session_id) REFERENCES buildSessions(id);
ALTER TABLE buildSteps ADD CONSTRAINT fk_buildSteps_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE orchestratorSessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  goal TEXT NOT NULL,
  state TEXT NOT NULL,
  plan TEXT,
  complexity TEXT,
  total_tasks DOUBLE PRECISION,
  completed_tasks DOUBLE PRECISION,
  failed_tasks DOUBLE PRECISION,
  total_tokens_used DOUBLE PRECISION,
  cost_budget_tokens DOUBLE PRECISION,
  started_at DOUBLE PRECISION NOT NULL,
  finished_at DOUBLE PRECISION,
  error TEXT
);
CREATE INDEX idx_orchestratorSessions_by_project ON orchestratorSessions ("project_id");
CREATE INDEX idx_orchestratorSessions_by_project_and_state ON orchestratorSessions ("project_id", "state");
ALTER TABLE orchestratorSessions ADD CONSTRAINT fk_orchestratorSessions_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE agentTasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  build_session_id UUID,
  orchestrator_session_id UUID,
  parent_task_id UUID,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  agent_icon TEXT NOT NULL,
  role TEXT,
  task TEXT NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  files_changed JSONB,
  started_at DOUBLE PRECISION NOT NULL,
  finished_at DOUBLE PRECISION,
  provider TEXT,
  worktree_path TEXT,
  cost_budget_tokens DOUBLE PRECISION,
  cost_spent_tokens DOUBLE PRECISION,
  recovery_checkpoints JSONB,
  dependencies JSONB
);
CREATE INDEX idx_agentTasks_by_project ON agentTasks ("project_id");
CREATE INDEX idx_agentTasks_by_build_session ON agentTasks ("build_session_id");
CREATE INDEX idx_agentTasks_by_orchestrator_session ON agentTasks ("orchestrator_session_id");
CREATE INDEX idx_agentTasks_by_parent_task ON agentTasks ("parent_task_id");
CREATE INDEX idx_agentTasks_by_status ON agentTasks ("status");
ALTER TABLE agentTasks ADD CONSTRAINT fk_agentTasks_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE agentTasks ADD CONSTRAINT fk_agentTasks_build_session_id FOREIGN KEY (build_session_id) REFERENCES buildSessions(id);
ALTER TABLE agentTasks ADD CONSTRAINT fk_agentTasks_orchestrator_session_id FOREIGN KEY (orchestrator_session_id) REFERENCES orchestratorSessions(id);

CREATE TABLE agentMemories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  category TEXT NOT NULL,
  content TEXT NOT NULL,
  importance DOUBLE PRECISION NOT NULL,
  usage_count DOUBLE PRECISION NOT NULL,
  last_used_at DOUBLE PRECISION NOT NULL,
  source_task_id UUID,
  source_retro_id UUID,
  decay_factor DOUBLE PRECISION NOT NULL,
  embedding TEXT,
  is_approved BOOLEAN
);
CREATE INDEX idx_agentMemories_by_project ON agentMemories ("project_id");
CREATE INDEX idx_agentMemories_by_project_and_category ON agentMemories ("project_id", "category");
CREATE INDEX idx_agentMemories_by_project_and_importance ON agentMemories ("project_id", "importance");
ALTER TABLE agentMemories ADD CONSTRAINT fk_agentMemories_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE agentMemories ADD CONSTRAINT fk_agentMemories_source_task_id FOREIGN KEY (source_task_id) REFERENCES agentTasks(id);
ALTER TABLE agentMemories ADD CONSTRAINT fk_agentMemories_source_retro_id FOREIGN KEY (source_retro_id) REFERENCES taskRetrospectives(id);

CREATE TABLE taskRetrospectives (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  trigger_task_id UUID,
  build_session_id UUID,
  quality_score DOUBLE PRECISION NOT NULL,
  what_worked JSONB NOT NULL,
  what_failed JSONB NOT NULL,
  improvements JSONB NOT NULL,
  memories_created JSONB NOT NULL,
  raw_analysis TEXT NOT NULL,
  agents_involved JSONB NOT NULL,
  timestamp DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_taskRetrospectives_by_project ON taskRetrospectives ("project_id");
CREATE INDEX idx_taskRetrospectives_by_project_and_time ON taskRetrospectives ("project_id", "timestamp");
ALTER TABLE taskRetrospectives ADD CONSTRAINT fk_taskRetrospectives_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE taskRetrospectives ADD CONSTRAINT fk_taskRetrospectives_trigger_task_id FOREIGN KEY (trigger_task_id) REFERENCES agentTasks(id);
ALTER TABLE taskRetrospectives ADD CONSTRAINT fk_taskRetrospectives_build_session_id FOREIGN KEY (build_session_id) REFERENCES buildSessions(id);
ALTER TABLE taskRetrospectives ADD CONSTRAINT fk_taskRetrospectives_memories_created FOREIGN KEY (memories_created) REFERENCES agentMemories(id);

CREATE TABLE agentMessages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  build_session_id UUID,
  from_agent_id TEXT NOT NULL,
  from_agent_name TEXT NOT NULL,
  from_agent_icon TEXT NOT NULL,
  to_agent_id TEXT,
  to_agent_name TEXT,
  message_type TEXT NOT NULL,
  content TEXT NOT NULL,
  related_files JSONB,
  timestamp DOUBLE PRECISION NOT NULL,
  acknowledged BOOLEAN
);
CREATE INDEX idx_agentMessages_by_project ON agentMessages ("project_id");
CREATE INDEX idx_agentMessages_by_build_session ON agentMessages ("build_session_id");
CREATE INDEX idx_agentMessages_by_project_and_time ON agentMessages ("project_id", "timestamp");
ALTER TABLE agentMessages ADD CONSTRAINT fk_agentMessages_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE agentMessages ADD CONSTRAINT fk_agentMessages_build_session_id FOREIGN KEY (build_session_id) REFERENCES buildSessions(id);

CREATE TABLE gitCommits (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  sha TEXT NOT NULL,
  message TEXT NOT NULL,
  branch TEXT NOT NULL,
  files_changed JSONB NOT NULL,
  agent_id TEXT,
  build_session_id UUID,
  timestamp DOUBLE PRECISION NOT NULL,
  pushed_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_gitCommits_by_project ON gitCommits ("project_id");
CREATE INDEX idx_gitCommits_by_project_and_branch ON gitCommits ("project_id", "branch");
ALTER TABLE gitCommits ADD CONSTRAINT fk_gitCommits_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE gitCommits ADD CONSTRAINT fk_gitCommits_build_session_id FOREIGN KEY (build_session_id) REFERENCES buildSessions(id);

CREATE TABLE gitBranches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  name TEXT NOT NULL,
  is_active BOOLEAN NOT NULL,
  head_sha TEXT,
  pr_url TEXT,
  pr_number DOUBLE PRECISION,
  status TEXT NOT NULL,
  created_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_gitBranches_by_project ON gitBranches ("project_id");
CREATE INDEX idx_gitBranches_by_project_and_name ON gitBranches ("project_id", "name");
ALTER TABLE gitBranches ADD CONSTRAINT fk_gitBranches_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE sessionEvents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id TEXT NOT NULL,
  project_id UUID NOT NULL,
  seq DOUBLE PRECISION NOT NULL,
  type TEXT NOT NULL,
  payload TEXT,
  agent_id TEXT,
  metadata TEXT,
  timestamp DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_sessionEvents_by_session ON sessionEvents ("session_id", "seq");
CREATE INDEX idx_sessionEvents_by_session_and_type ON sessionEvents ("session_id", "type");
CREATE INDEX idx_sessionEvents_by_project ON sessionEvents ("project_id");
ALTER TABLE sessionEvents ADD CONSTRAINT fk_sessionEvents_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE agentHeartbeats (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  session_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  last_seen_at DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL
);
CREATE INDEX idx_agentHeartbeats_by_session ON agentHeartbeats ("session_id");
CREATE INDEX idx_agentHeartbeats_by_session_and_agent ON agentHeartbeats ("session_id", "agent_id");

CREATE TABLE knowledgeEntities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  file_path TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  start_line DOUBLE PRECISION,
  end_line DOUBLE PRECISION,
  exports JSONB,
  signature TEXT,
  doc_comment TEXT,
  last_modified DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_knowledgeEntities_by_project ON knowledgeEntities ("project_id");
CREATE INDEX idx_knowledgeEntities_by_project_and_file ON knowledgeEntities ("project_id", "file_path");
CREATE INDEX idx_knowledgeEntities_by_project_and_kind ON knowledgeEntities ("project_id", "kind");
CREATE INDEX idx_knowledgeEntities_by_project_and_name ON knowledgeEntities ("project_id", "name");
ALTER TABLE knowledgeEntities ADD CONSTRAINT fk_knowledgeEntities_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE knowledgeEdges (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  from_entity TEXT NOT NULL,
  to_entity TEXT NOT NULL,
  relation TEXT NOT NULL
);
CREATE INDEX idx_knowledgeEdges_by_project ON knowledgeEdges ("project_id");
CREATE INDEX idx_knowledgeEdges_by_project_and_from ON knowledgeEdges ("project_id", "from_entity");
CREATE INDEX idx_knowledgeEdges_by_project_and_to ON knowledgeEdges ("project_id", "to_entity");
ALTER TABLE knowledgeEdges ADD CONSTRAINT fk_knowledgeEdges_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE editSets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  description TEXT NOT NULL,
  agent_id TEXT,
  file_count DOUBLE PRECISION NOT NULL,
  snapshots TEXT NOT NULL,
  status TEXT NOT NULL,
  error TEXT,
  created_at DOUBLE PRECISION NOT NULL,
  applied_at DOUBLE PRECISION
);
CREATE INDEX idx_editSets_by_project ON editSets ("project_id");
ALTER TABLE editSets ADD CONSTRAINT fk_editSets_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE codebaseIndex (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  file_id UUID NOT NULL,
  path TEXT NOT NULL,
  language TEXT NOT NULL,
  term_frequency TEXT NOT NULL,
  tags JSONB NOT NULL,
  token_count DOUBLE PRECISION NOT NULL,
  indexed_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_codebaseIndex_by_project ON codebaseIndex ("project_id");
CREATE INDEX idx_codebaseIndex_by_project_and_path ON codebaseIndex ("project_id", "path");
ALTER TABLE codebaseIndex ADD CONSTRAINT fk_codebaseIndex_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE codebaseIndex ADD CONSTRAINT fk_codebaseIndex_file_id FOREIGN KEY (file_id) REFERENCES files(id);

CREATE TABLE agentThoughts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID,
  build_session_id UUID,
  mission_id TEXT,
  agent_id TEXT,
  agent_name TEXT,
  type TEXT,
  content TEXT NOT NULL,
  is_streaming BOOLEAN,
  timestamp DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_agentThoughts_by_project ON agentThoughts ("project_id");
CREATE INDEX idx_agentThoughts_by_build_session ON agentThoughts ("build_session_id");
ALTER TABLE agentThoughts ADD CONSTRAINT fk_agentThoughts_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE agentThoughts ADD CONSTRAINT fk_agentThoughts_build_session_id FOREIGN KEY (build_session_id) REFERENCES buildSessions(id);

CREATE TABLE projectSettings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  autonomous_mode BOOLEAN NOT NULL,
  autonomous_level TEXT,
  auto_interval_minutes DOUBLE PRECISION NOT NULL,
  last_auto_run_at DOUBLE PRECISION,
  project_soul TEXT
);
CREATE INDEX idx_projectSettings_by_project ON projectSettings ("project_id");
ALTER TABLE projectSettings ADD CONSTRAINT fk_projectSettings_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE toolCalls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  mission_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  tool TEXT NOT NULL,
  args TEXT NOT NULL,
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  timestamp DOUBLE PRECISION NOT NULL,
  finished_at DOUBLE PRECISION
);
CREATE INDEX idx_toolCalls_by_project ON toolCalls ("project_id");
CREATE INDEX idx_toolCalls_by_mission ON toolCalls ("mission_id");
ALTER TABLE toolCalls ADD CONSTRAINT fk_toolCalls_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  plan_key TEXT NOT NULL,
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  current_period_end DOUBLE PRECISION,
  status TEXT NOT NULL,
  updated_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_subscriptions_by_user ON subscriptions ("user_id");
CREATE INDEX idx_subscriptions_by_stripe_customer ON subscriptions ("stripe_customer_id");
ALTER TABLE subscriptions ADD CONSTRAINT fk_subscriptions_user_id FOREIGN KEY (user_id) REFERENCES users(id);

CREATE TABLE userApiKeys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  masked_key TEXT NOT NULL,
  is_valid BOOLEAN,
  validated_at DOUBLE PRECISION,
  added_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_userApiKeys_by_user ON userApiKeys ("user_id");
CREATE INDEX idx_userApiKeys_by_user_and_provider ON userApiKeys ("user_id", "provider");
ALTER TABLE userApiKeys ADD CONSTRAINT fk_userApiKeys_user_id FOREIGN KEY (user_id) REFERENCES users(id);

CREATE TABLE userUsage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id TEXT NOT NULL,
  date TEXT NOT NULL,
  ai_requests DOUBLE PRECISION NOT NULL,
  missions DOUBLE PRECISION NOT NULL,
  agents_spawned DOUBLE PRECISION NOT NULL,
  compute_cost_usd DOUBLE PRECISION NOT NULL,
  period_start DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_userUsage_by_user_date ON userUsage ("user_id", "date");
CREATE INDEX idx_userUsage_by_user ON userUsage ("user_id");

CREATE TABLE userSpend (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id TEXT NOT NULL,
  period_key TEXT NOT NULL,
  total_cost_usd DOUBLE PRECISION NOT NULL,
  cap_usd DOUBLE PRECISION NOT NULL,
  capped_at DOUBLE PRECISION,
  plan TEXT NOT NULL
);
CREATE INDEX idx_userSpend_by_user_period ON userSpend ("user_id", "period_key");

CREATE TABLE sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  project_id UUID,
  name TEXT NOT NULL,
  model TEXT NOT NULL,
  total_input_tokens DOUBLE PRECISION,
  total_output_tokens DOUBLE PRECISION,
  total_cost DOUBLE PRECISION,
  is_active BOOLEAN NOT NULL
);
CREATE INDEX idx_sessions_by_user ON sessions ("user_id");
CREATE INDEX idx_sessions_by_user_active ON sessions ("user_id", "is_active");
CREATE INDEX idx_sessions_by_project ON sessions ("project_id");
ALTER TABLE sessions ADD CONSTRAINT fk_sessions_user_id FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE sessions ADD CONSTRAINT fk_sessions_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE githubSettings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  token TEXT NOT NULL,
  username TEXT,
  avatar_url TEXT
);
CREATE INDEX idx_githubSettings_by_user ON githubSettings ("user_id");
ALTER TABLE githubSettings ADD CONSTRAINT fk_githubSettings_user_id FOREIGN KEY (user_id) REFERENCES users(id);

CREATE TABLE costEntries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  build_session_id UUID,
  model TEXT NOT NULL,
  input_tokens DOUBLE PRECISION NOT NULL,
  output_tokens DOUBLE PRECISION NOT NULL,
  cost DOUBLE PRECISION NOT NULL,
  operation TEXT NOT NULL
);
CREATE INDEX idx_costEntries_by_user ON costEntries ("user_id");
ALTER TABLE costEntries ADD CONSTRAINT fk_costEntries_user_id FOREIGN KEY (user_id) REFERENCES users(id);
ALTER TABLE costEntries ADD CONSTRAINT fk_costEntries_build_session_id FOREIGN KEY (build_session_id) REFERENCES buildSessions(id);

CREATE TABLE projectShares (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  token TEXT NOT NULL,
  expiry TEXT NOT NULL,
  expires_at DOUBLE PRECISION,
  has_password BOOLEAN NOT NULL,
  password_hash TEXT,
  is_active BOOLEAN NOT NULL,
  view_count DOUBLE PRECISION NOT NULL,
  last_viewed_at DOUBLE PRECISION,
  created_at DOUBLE PRECISION NOT NULL,
  updated_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_projectShares_by_project ON projectShares ("project_id");
CREATE INDEX idx_projectShares_by_token ON projectShares ("token");
ALTER TABLE projectShares ADD CONSTRAINT fk_projectShares_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE ragChunks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  file_path TEXT NOT NULL,
  chunk_type TEXT NOT NULL,
  name TEXT,
  content TEXT NOT NULL,
  start_line DOUBLE PRECISION NOT NULL,
  end_line DOUBLE PRECISION NOT NULL,
  embedding TEXT,
  language TEXT
);
CREATE INDEX idx_ragChunks_by_project ON ragChunks ("project_id");
CREATE INDEX idx_ragChunks_by_project_and_file ON ragChunks ("project_id", "file_path");
ALTER TABLE ragChunks ADD CONSTRAINT fk_ragChunks_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE debates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  build_session_id UUID,
  proposal TEXT NOT NULL,
  proponent_argument TEXT NOT NULL,
  opponent_argument TEXT NOT NULL,
  moderator_reasoning TEXT NOT NULL,
  verdict TEXT NOT NULL,
  refinements JSONB,
  escalation_reason TEXT,
  confidence DOUBLE PRECISION NOT NULL,
  duration_ms DOUBLE PRECISION NOT NULL,
  timestamp DOUBLE PRECISION NOT NULL,
  human_approved BOOLEAN NOT NULL,
  approved_at DOUBLE PRECISION
);
CREATE INDEX idx_debates_by_project ON debates ("project_id");
CREATE INDEX idx_debates_by_project_and_verdict ON debates ("project_id", "verdict");
CREATE INDEX idx_debates_by_project_and_time ON debates ("project_id", "timestamp");
ALTER TABLE debates ADD CONSTRAINT fk_debates_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE debates ADD CONSTRAINT fk_debates_build_session_id FOREIGN KEY (build_session_id) REFERENCES buildSessions(id);

CREATE TABLE deployments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  branch_name TEXT NOT NULL,
  pr_number DOUBLE PRECISION,
  pr_url TEXT,
  commit_sha TEXT NOT NULL,
  commit_message TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  triggered_by_agent_id TEXT NOT NULL,
  build_session_id UUID,
  deployment_certificate TEXT,
  status TEXT NOT NULL,
  ci_summary TEXT,
  human_approved BOOLEAN NOT NULL,
  approved_by TEXT,
  canary_percent DOUBLE PRECISION NOT NULL,
  created_at DOUBLE PRECISION NOT NULL,
  deployed_at DOUBLE PRECISION,
  error TEXT
);
CREATE INDEX idx_deployments_by_project ON deployments ("project_id");
CREATE INDEX idx_deployments_by_project_and_status ON deployments ("project_id", "status");
ALTER TABLE deployments ADD CONSTRAINT fk_deployments_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE deployments ADD CONSTRAINT fk_deployments_build_session_id FOREIGN KEY (build_session_id) REFERENCES buildSessions(id);

CREATE TABLE sentryViolations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  agent_id TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  tool TEXT NOT NULL,
  args TEXT NOT NULL,
  violation_type TEXT NOT NULL,
  details TEXT NOT NULL,
  severity TEXT NOT NULL,
  blocked BOOLEAN NOT NULL,
  timestamp DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_sentryViolations_by_project ON sentryViolations ("project_id");
CREATE INDEX idx_sentryViolations_by_project_and_severity ON sentryViolations ("project_id", "severity");
CREATE INDEX idx_sentryViolations_by_project_and_time ON sentryViolations ("project_id", "timestamp");
ALTER TABLE sentryViolations ADD CONSTRAINT fk_sentryViolations_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE forensicReports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  mission_id UUID,
  build_session_id UUID,
  failure_class TEXT NOT NULL,
  root_cause TEXT NOT NULL,
  evidence_quotes JSONB NOT NULL,
  proposed_mutation TEXT NOT NULL,
  mutation_target TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  timestamp DOUBLE PRECISION NOT NULL,
  mutation_applied BOOLEAN NOT NULL,
  applied_at DOUBLE PRECISION
);
CREATE INDEX idx_forensicReports_by_project ON forensicReports ("project_id");
CREATE INDEX idx_forensicReports_by_project_and_severity ON forensicReports ("project_id", "severity");
CREATE INDEX idx_forensicReports_by_project_and_time ON forensicReports ("project_id", "timestamp");
ALTER TABLE forensicReports ADD CONSTRAINT fk_forensicReports_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE forensicReports ADD CONSTRAINT fk_forensicReports_mission_id FOREIGN KEY (mission_id) REFERENCES buildSessions(id);
ALTER TABLE forensicReports ADD CONSTRAINT fk_forensicReports_build_session_id FOREIGN KEY (build_session_id) REFERENCES buildSessions(id);

CREATE TABLE mutationLog (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  report_id UUID NOT NULL,
  proposed_mutation TEXT NOT NULL,
  mutation_target TEXT NOT NULL,
  severity TEXT NOT NULL,
  auto_apply BOOLEAN NOT NULL,
  status TEXT NOT NULL,
  applied_patch TEXT,
  rejection_reason TEXT,
  version DOUBLE PRECISION NOT NULL,
  rollback_available BOOLEAN NOT NULL,
  created_at DOUBLE PRECISION NOT NULL,
  applied_at DOUBLE PRECISION
);
CREATE INDEX idx_mutationLog_by_project ON mutationLog ("project_id");
CREATE INDEX idx_mutationLog_by_project_and_status ON mutationLog ("project_id", "status");
ALTER TABLE mutationLog ADD CONSTRAINT fk_mutationLog_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE mutationLog ADD CONSTRAINT fk_mutationLog_report_id FOREIGN KEY (report_id) REFERENCES forensicReports(id);

CREATE TABLE reflectionSessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  mutations_reviewed DOUBLE PRECISION NOT NULL,
  mutations_approved DOUBLE PRECISION NOT NULL,
  mutations_rejected DOUBLE PRECISION NOT NULL,
  retrospectives_read DOUBLE PRECISION NOT NULL,
  forensic_reports_read DOUBLE PRECISION NOT NULL,
  lessons_learned JSONB NOT NULL,
  overall_health_score DOUBLE PRECISION NOT NULL,
  summary TEXT NOT NULL,
  next_actions JSONB NOT NULL,
  timestamp DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_reflectionSessions_by_project ON reflectionSessions ("project_id");
CREATE INDEX idx_reflectionSessions_by_project_and_time ON reflectionSessions ("project_id", "timestamp");
ALTER TABLE reflectionSessions ADD CONSTRAINT fk_reflectionSessions_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE cinemaFrames (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  mission_id UUID NOT NULL,
  build_session_id UUID,
  frame_type TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_name TEXT NOT NULL,
  agent_role TEXT,
  parent_agent_id TEXT,
  spawn_depth DOUBLE PRECISION,
  payload TEXT NOT NULL,
  duration_ms DOUBLE PRECISION,
  success BOOLEAN,
  ts DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_cinemaFrames_by_mission ON cinemaFrames ("mission_id");
CREATE INDEX idx_cinemaFrames_by_project ON cinemaFrames ("project_id");
CREATE INDEX idx_cinemaFrames_by_mission_ts ON cinemaFrames ("mission_id", "ts");
ALTER TABLE cinemaFrames ADD CONSTRAINT fk_cinemaFrames_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE cinemaFrames ADD CONSTRAINT fk_cinemaFrames_mission_id FOREIGN KEY (mission_id) REFERENCES buildSessions(id);
ALTER TABLE cinemaFrames ADD CONSTRAINT fk_cinemaFrames_build_session_id FOREIGN KEY (build_session_id) REFERENCES buildSessions(id);

CREATE TABLE globalInsights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  user_id UUID NOT NULL,
  pattern TEXT NOT NULL,
  detail TEXT NOT NULL,
  insight_type TEXT NOT NULL,
  example_code TEXT,
  occurrence_count DOUBLE PRECISION NOT NULL,
  project_ids JSONB NOT NULL,
  confidence DOUBLE PRECISION NOT NULL,
  tags JSONB NOT NULL,
  created_at DOUBLE PRECISION NOT NULL,
  updated_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_globalInsights_by_user ON globalInsights ("user_id");
CREATE INDEX idx_globalInsights_by_user_type ON globalInsights ("user_id", "insight_type");
ALTER TABLE globalInsights ADD CONSTRAINT fk_globalInsights_user_id FOREIGN KEY (user_id) REFERENCES users(id);

CREATE TABLE benchmarkRuns (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  task_description TEXT NOT NULL,
  agent_role TEXT NOT NULL,
  model_a TEXT NOT NULL,
  model_b TEXT NOT NULL,
  output_a TEXT NOT NULL,
  output_b TEXT NOT NULL,
  score_a DOUBLE PRECISION NOT NULL,
  score_b DOUBLE PRECISION NOT NULL,
  winner TEXT NOT NULL,
  judge_reasoning TEXT NOT NULL,
  latency_a_ms DOUBLE PRECISION NOT NULL,
  latency_b_ms DOUBLE PRECISION NOT NULL,
  tokens_a DOUBLE PRECISION,
  tokens_b DOUBLE PRECISION,
  dimensions JSONB NOT NULL,
  timestamp DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_benchmarkRuns_by_project ON benchmarkRuns ("project_id");
CREATE INDEX idx_benchmarkRuns_by_project_role ON benchmarkRuns ("project_id", "agent_role");
ALTER TABLE benchmarkRuns ADD CONSTRAINT fk_benchmarkRuns_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE errorIncidents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  source TEXT NOT NULL,
  error_type TEXT NOT NULL,
  error_message TEXT NOT NULL,
  stack_trace TEXT,
  affected_file TEXT,
  affected_function TEXT,
  environment TEXT,
  occurrence_count DOUBLE PRECISION NOT NULL,
  raw_payload TEXT,
  fingerprint TEXT NOT NULL,
  status TEXT NOT NULL,
  error_class TEXT,
  fix_attempts DOUBLE PRECISION,
  max_fix_attempts DOUBLE PRECISION,
  last_fix_error TEXT,
  escalated BOOLEAN,
  forensic_report_id UUID,
  pr_url TEXT,
  fix_summary TEXT,
  auto_fix_attempted BOOLEAN NOT NULL,
  created_at DOUBLE PRECISION NOT NULL,
  last_seen_at DOUBLE PRECISION NOT NULL,
  updated_at DOUBLE PRECISION
);
CREATE INDEX idx_errorIncidents_by_project ON errorIncidents ("project_id");
CREATE INDEX idx_errorIncidents_by_project_status ON errorIncidents ("project_id", "status");
CREATE INDEX idx_errorIncidents_by_project_fingerprint ON errorIncidents ("project_id", "fingerprint");
ALTER TABLE errorIncidents ADD CONSTRAINT fk_errorIncidents_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE errorIncidents ADD CONSTRAINT fk_errorIncidents_forensic_report_id FOREIGN KEY (forensic_report_id) REFERENCES forensicReports(id);

CREATE TABLE importJobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  repo_url TEXT NOT NULL,
  repo_full_name TEXT NOT NULL,
  branch TEXT NOT NULL,
  status TEXT NOT NULL,
  files_imported DOUBLE PRECISION,
  detected_stack JSONB,
  brief_generated BOOLEAN,
  error TEXT,
  started_at DOUBLE PRECISION NOT NULL,
  completed_at DOUBLE PRECISION
);
CREATE INDEX idx_importJobs_by_project ON importJobs ("project_id");
ALTER TABLE importJobs ADD CONSTRAINT fk_importJobs_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE xrayReports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  status TEXT NOT NULL,
  languages TEXT,
  dependencies TEXT,
  apis TEXT,
  database TEXT,
  tests TEXT,
  security TEXT,
  tech_debt TEXT,
  infrastructure TEXT,
  file_stats TEXT,
  summary TEXT,
  error TEXT,
  created_at DOUBLE PRECISION NOT NULL,
  completed_at DOUBLE PRECISION
);
CREATE INDEX idx_xrayReports_by_project ON xrayReports ("project_id");
ALTER TABLE xrayReports ADD CONSTRAINT fk_xrayReports_project_id FOREIGN KEY (project_id) REFERENCES projects(id);

CREATE TABLE completionScores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  xray_report_id UUID NOT NULL,
  overall DOUBLE PRECISION NOT NULL,
  completion DOUBLE PRECISION NOT NULL,
  production_readiness DOUBLE PRECISION NOT NULL,
  security DOUBLE PRECISION NOT NULL,
  maintainability DOUBLE PRECISION NOT NULL,
  performance DOUBLE PRECISION NOT NULL,
  deployment DOUBLE PRECISION NOT NULL,
  findings TEXT NOT NULL,
  gap_analysis TEXT NOT NULL,
  created_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_completionScores_by_project ON completionScores ("project_id");
CREATE INDEX idx_completionScores_by_xray_report ON completionScores ("xray_report_id");
ALTER TABLE completionScores ADD CONSTRAINT fk_completionScores_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE completionScores ADD CONSTRAINT fk_completionScores_xray_report_id FOREIGN KEY (xray_report_id) REFERENCES xrayReports(id);

CREATE TABLE workItems (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  score_id UUID,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  category TEXT NOT NULL,
  priority TEXT NOT NULL,
  impact DOUBLE PRECISION NOT NULL,
  effort TEXT NOT NULL,
  risk TEXT NOT NULL,
  depends_on JSONB NOT NULL,
  status TEXT NOT NULL,
  assigned_agent_id TEXT,
  build_session_id UUID,
  files_affected JSONB NOT NULL,
  estimated_tokens DOUBLE PRECISION,
  result TEXT,
  created_at DOUBLE PRECISION NOT NULL,
  started_at DOUBLE PRECISION,
  completed_at DOUBLE PRECISION
);
CREATE INDEX idx_workItems_by_project ON workItems ("project_id");
CREATE INDEX idx_workItems_by_project_and_status ON workItems ("project_id", "status");
CREATE INDEX idx_workItems_by_project_and_priority ON workItems ("project_id", "priority");
ALTER TABLE workItems ADD CONSTRAINT fk_workItems_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE workItems ADD CONSTRAINT fk_workItems_score_id FOREIGN KEY (score_id) REFERENCES completionScores(id);
ALTER TABLE workItems ADD CONSTRAINT fk_workItems_build_session_id FOREIGN KEY (build_session_id) REFERENCES buildSessions(id);

CREATE TABLE codeReviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  project_id UUID NOT NULL,
  work_item_id UUID,
  build_session_id UUID,
  files_reviewed JSONB NOT NULL,
  reviewers TEXT NOT NULL,
  consensus TEXT NOT NULL,
  iterations DOUBLE PRECISION NOT NULL,
  created_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_codeReviews_by_project ON codeReviews ("project_id");
CREATE INDEX idx_codeReviews_by_work_item ON codeReviews ("work_item_id");
ALTER TABLE codeReviews ADD CONSTRAINT fk_codeReviews_project_id FOREIGN KEY (project_id) REFERENCES projects(id);
ALTER TABLE codeReviews ADD CONSTRAINT fk_codeReviews_work_item_id FOREIGN KEY (work_item_id) REFERENCES workItems(id);
ALTER TABLE codeReviews ADD CONSTRAINT fk_codeReviews_build_session_id FOREIGN KEY (build_session_id) REFERENCES buildSessions(id);

-- ── @convex-dev/auth standard tables (from the authTables spread) ──
CREATE TABLE authAccounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL
);
CREATE UNIQUE INDEX idx_authaccounts_provider ON authAccounts (provider, provider_account_id);

CREATE TABLE authSessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  session_token TEXT NOT NULL UNIQUE,
  user_id UUID NOT NULL REFERENCES users(id),
  expires_at DOUBLE PRECISION NOT NULL
);
CREATE INDEX idx_authsessions_user ON authSessions (user_id);

CREATE TABLE verificationCodes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  email TEXT,
  phone TEXT,
  code TEXT,
  expires_at DOUBLE PRECISION NOT NULL,
  error TEXT
);
CREATE INDEX idx_verificationcodes_email ON verificationCodes (email);
CREATE INDEX idx_verificationcodes_phone ON verificationCodes (phone);

CREATE TABLE refreshTokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  convex_id TEXT UNIQUE,
  session_id UUID NOT NULL REFERENCES authSessions(id),
  refresh_token TEXT NOT NULL UNIQUE,
  expires_at DOUBLE PRECISION NOT NULL
);
