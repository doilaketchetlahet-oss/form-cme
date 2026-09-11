-- Events group multiple forms that belong to the same real-world event.
-- Run once in the Supabase SQL editor. Requires the admin authorization
-- functions (is_admin_member / can_manage_forms) to already exist.

create extension if not exists pgcrypto;

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  owner_email text,
  name text not null,
  event_date date,
  form_ids jsonb not null default '[]'::jsonb,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_events_updated
  on events (updated_at desc);

alter table events enable row level security;

drop policy if exists "admin members read events" on events;
create policy "admin members read events" on events
  for select to authenticated
  using (is_admin_member());

drop policy if exists "admins write events" on events;
create policy "admins write events" on events
  for all to authenticated
  using (can_manage_forms())
  with check (can_manage_forms());
