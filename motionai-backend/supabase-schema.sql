-- MotionAI — Supabase Schema
-- Run this in the Supabase SQL editor to create the required tables.
-- This schema supports:
--   1. anonymous projects (user_id is null)
--   2. authenticated project history (user_id references auth.users)

-- ────────────────────────────────────────────────────────────────────────────
-- projects
-- ────────────────────────────────────────────────────────────────────────────
create table if not exists projects (
  id                uuid primary key default gen_random_uuid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  user_id           uuid references auth.users(id) on delete set null,
  title             text        not null,
  style             text        not null check (style in ('modern','minimal','bold','corporate')),
  duration          int         not null check (duration between 3 and 60),
  resolution        text        not null check (resolution in ('720p','1080p')),
  latest_job_id     text,
  latest_video_url  text,
  -- Stores the EnrichedBrief JSON; reused on edit calls to skip the enrich LLM step
  enriched_brief    jsonb
);

alter table projects
  add column if not exists user_id uuid references auth.users(id) on delete set null;

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

create index if not exists projects_user_id_updated_at_idx
  on projects(user_id, updated_at desc);

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

alter table projects enable row level security;
alter table messages enable row level security;

drop policy if exists "Users can view own projects or anonymous projects" on projects;
create policy "Users can view own projects or anonymous projects"
  on projects
  for select
  using (
    user_id is null
    or auth.uid() = user_id
  );

drop policy if exists "Authenticated users can insert owned or anonymous projects" on projects;
create policy "Authenticated users can insert owned or anonymous projects"
  on projects
  for insert
  with check (
    user_id is null
    or auth.uid() = user_id
  );

drop policy if exists "Users can update own projects or anonymous projects" on projects;
create policy "Users can update own projects or anonymous projects"
  on projects
  for update
  using (
    user_id is null
    or auth.uid() = user_id
  )
  with check (
    user_id is null
    or auth.uid() = user_id
  );

drop policy if exists "Users can view messages for accessible projects" on messages;
create policy "Users can view messages for accessible projects"
  on messages
  for select
  using (
    exists (
      select 1
      from projects
      where projects.id = messages.project_id
        and (
          projects.user_id is null
          or projects.user_id = auth.uid()
        )
    )
  );

drop policy if exists "Users can insert messages for accessible projects" on messages;
create policy "Users can insert messages for accessible projects"
  on messages
  for insert
  with check (
    exists (
      select 1
      from projects
      where projects.id = messages.project_id
        and (
          projects.user_id is null
          or projects.user_id = auth.uid()
        )
    )
  );
