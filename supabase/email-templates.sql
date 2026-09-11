-- Reusable email templates for Form CME (existing projects).
-- Run once in the Supabase SQL editor. Requires the admin authorization
-- functions (is_admin_member / can_manage_forms) to already exist.

create extension if not exists pgcrypto;

create table if not exists email_templates (
  id uuid primary key default gen_random_uuid(),
  owner_email text,
  name text not null,
  subject text,
  body text not null,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_email_templates_updated
  on email_templates (updated_at desc);

alter table email_templates enable row level security;

drop policy if exists "admin members read email templates" on email_templates;
create policy "admin members read email templates" on email_templates
  for select to authenticated
  using (is_admin_member());

drop policy if exists "admins write email templates" on email_templates;
create policy "admins write email templates" on email_templates
  for all to authenticated
  using (can_manage_forms())
  with check (can_manage_forms());
