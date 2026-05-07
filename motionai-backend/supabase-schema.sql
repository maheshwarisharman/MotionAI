-- MotionAI — Supabase Schema
-- Run this in the Supabase SQL editor to create the required tables.
-- RLS is disabled here; enable and add policies when you add auth.

-- ────────────────────────────────────────────────────────────────────────────
-- projects
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists projects (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  title             text        not null,
  style             text        not null check (style in ('modern','minimal','bold','corporate')),
  duration          int         not null check (duration between 3 and 60),
  resolution        text        not null check (resolution in ('720p','1080p')),
  latest_job_id     text,
  latest_video_url  text,
  -- Stores the EnrichedBrief JSON; reused on edit calls to skip the enrich LLM step
  enriched_brief    jsonb
);

-- Keep updated_at current automatically
create or replace function update_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists projects_updated_at on projects;
create trigger projects_updated_at
  before update on projects
  for each row execute function update_updated_at();

-- ────────────────────────────────────────────────────────────────────────────
-- messages
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists messages (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references projects(id) on delete cascade,
  created_at    timestamptz not null default now(),
  role          text not null check (role in ('user','assistant')),
  content       text not null,
  job_id        text,
  message_type  text not null check (message_type in ('initial_generate','edit','completion','error'))
);

create index if not exists messages_project_id_idx on messages(project_id, created_at);
