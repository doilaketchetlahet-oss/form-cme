-- Project sharing: private capability links, one shared edition per owner/project.
-- Re-runnable; existing projects and game_saves are untouched.
create table if not exists public.game_project_shares (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  project_id text not null,
  module_id text not null,
  play_token text not null unique,
  edit_token text unique,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  rev integer not null default 1 check (rev > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, project_id)
);
alter table public.game_project_shares enable row level security;
-- All access goes through the API: readers never receive an edit token,
-- and an account cannot enumerate another account's shares or snapshots.
revoke all on public.game_project_shares from public, anon, authenticated;
grant all on public.game_project_shares to service_role;
