-- 004: Batch-1 RPC port support (2026-09-04)
-- project_settings: normalized home for suggestions.setAutonomousMode data
create table if not exists project_settings (
  id text primary key default gen_random_uuid()::text,
  project_id text not null unique references projects(id) on delete cascade,
  autonomous_mode boolean not null default false,
  autonomous_level text,
  auto_interval_minutes integer not null default 15,
  last_auto_run_at timestamptz,
  project_soul text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Legacy-store read indexes (legacy_convex_documents is 107k+ rows)
create index if not exists legacy_docs_project_idx
  on legacy_convex_documents (table_name, (document->>'projectId'));

create index if not exists legacy_docs_time_idx
  on legacy_convex_documents (table_name, creation_time);
