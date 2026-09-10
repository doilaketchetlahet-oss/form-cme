-- Add role-based admin authorization to an existing Form CME Supabase project.
-- Run this once in Supabase SQL editor, then insert your first owner email:
--
-- insert into admin_members (email, role)
-- values ('you@example.com', 'owner')
-- on conflict (email) do update set role = 'owner', active = true;

create extension if not exists pgcrypto;

create table if not exists admin_members (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  role text not null check (role in ('owner', 'admin', 'viewer')),
  active boolean not null default true,
  created_at timestamptz default now()
);

create index if not exists idx_admin_members_email_active
  on admin_members (lower(email), active);

create or replace function current_admin_role()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select am.role
  from admin_members am
  where am.active = true
    and lower(am.email) = lower(coalesce(auth.jwt() ->> 'email', ''))
  limit 1;
$$;

create or replace function is_admin_member()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_admin_role() is not null;
$$;

create or replace function can_manage_forms()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select current_admin_role() in ('owner', 'admin');
$$;

alter table admin_members enable row level security;
alter table quizzes enable row level security;
alter table surveys enable row level security;
alter table survey_questions enable row level security;

drop policy if exists "admin members read own or owner" on admin_members;
create policy "admin members read own or owner" on admin_members
  for select to authenticated
  using (
    lower(email) = lower(coalesce(auth.jwt() ->> 'email', ''))
    or current_admin_role() = 'owner'
  );

drop policy if exists "owners insert admin members" on admin_members;
create policy "owners insert admin members" on admin_members
  for insert to authenticated
  with check (current_admin_role() = 'owner');

drop policy if exists "owners update admin members" on admin_members;
create policy "owners update admin members" on admin_members
  for update to authenticated
  using (current_admin_role() = 'owner')
  with check (current_admin_role() = 'owner');

drop policy if exists "owners delete admin members" on admin_members;
create policy "owners delete admin members" on admin_members
  for delete to authenticated
  using (current_admin_role() = 'owner');

drop policy if exists "owners read quizzes" on quizzes;
drop policy if exists "admin members read quizzes" on quizzes;
create policy "admin members read quizzes" on quizzes
  for select to authenticated
  using (is_admin_member());

drop policy if exists "owners insert quizzes" on quizzes;
drop policy if exists "admins insert quizzes" on quizzes;
create policy "admins insert quizzes" on quizzes
  for insert to authenticated
  with check (can_manage_forms());

drop policy if exists "owners update quizzes" on quizzes;
drop policy if exists "admins update quizzes" on quizzes;
create policy "admins update quizzes" on quizzes
  for update to authenticated
  using (can_manage_forms())
  with check (can_manage_forms());

drop policy if exists "owners delete quizzes" on quizzes;
drop policy if exists "admins delete quizzes" on quizzes;
create policy "admins delete quizzes" on quizzes
  for delete to authenticated
  using (can_manage_forms());

drop policy if exists "owners write surveys" on surveys;
drop policy if exists "admins write surveys" on surveys;
create policy "admins write surveys" on surveys
  for all to authenticated
  using (can_manage_forms())
  with check (can_manage_forms());

drop policy if exists "owners write survey_questions" on survey_questions;
drop policy if exists "admins write survey_questions" on survey_questions;
create policy "admins write survey_questions" on survey_questions
  for all to authenticated
  using (can_manage_forms())
  with check (can_manage_forms());
