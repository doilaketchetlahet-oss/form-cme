-- Form CME standalone schema
-- Run this in a fresh Supabase SQL editor.

create extension if not exists pgcrypto;

-- Owner-scoped form container. Name kept as `quizzes` for compatibility with
-- the split app code, but the UI treats each row as a form/event container.
create table if not exists quizzes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  description text,
  owner_id text not null,
  accent_color text,
  logo_url text,
  brand_name text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_quizzes_owner on quizzes(owner_id);

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

create table if not exists surveys (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid references quizzes(id) on delete cascade,
  form_type text not null default 'registration' check (form_type in ('registration', 'poster_scoring', 'feedback')),
  position numeric not null default 0,
  title text not null default 'Form đăng ký',
  is_anonymous boolean not null default true,
  thank_you_message text not null default 'Cảm ơn bạn đã đăng ký!',
  banner_url text,
  accent_color text default '#10b981',
  redirect_url text,
  redirect_delay int not null default 5,
  email_subject text,
  email_body text,
  checkin_pin text,
  checkin_theme jsonb,
  scoring_config jsonb,
  payment_config jsonb,
  vip_checkin_enabled boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists survey_questions (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid references surveys(id) on delete cascade,
  position int not null,
  type text not null check (
    type in (
      'rating',
      'nps',
      'choice',
      'text',
      'paragraph',
      'phone',
      'date',
      'province',
      'section',
      'image_banner',
      'file_upload',
      'signature',
      'face_checkin'
    )
  ),
  text text not null,
  options text[],
  required boolean not null default false,
  allow_multiple boolean not null default false,
  show_if jsonb,
  is_hall_selector boolean not null default false,
  created_at timestamptz default now()
);

create table if not exists survey_responses (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid references surveys(id) on delete cascade,
  answers jsonb not null default '{}',
  submitted_at timestamptz default now(),
  checked_in boolean not null default false,
  checked_in_at timestamptz,
  hall text,
  email text,
  email_status text check (email_status in ('pending', 'sent', 'failed')),
  email_sent_at timestamptz,
  email_last_attempt_at timestamptz,
  email_error text,
  session_checkins jsonb,
  payment_status text not null default 'not_required'
    check (payment_status in ('not_required', 'pending', 'paid', 'cancelled', 'expired', 'failed')),
  payment_amount integer,
  payment_order_code bigint,
  payment_link_id text,
  payment_checkout_url text,
  payment_reference text,
  payment_payer_name text,
  payment_payer_bank text,
  payment_payer_account text,
  payment_transaction_datetime text,
  paid_at timestamptz,
  payment_raw jsonb,
  payment_error text
);

create unique index if not exists uq_survey_response_email
  on survey_responses (survey_id, lower(email))
  where email is not null;

create index if not exists idx_surveys_quiz on surveys(quiz_id, position);
create index if not exists idx_survey_questions_survey on survey_questions(survey_id, position);
create index if not exists idx_survey_responses_survey on survey_responses(survey_id, submitted_at desc);
create index if not exists idx_survey_responses_hall on survey_responses(survey_id, hall);
create unique index if not exists uq_survey_responses_payment_order_code
  on survey_responses(payment_order_code)
  where payment_order_code is not null;
create index if not exists idx_survey_responses_payment_status
  on survey_responses(survey_id, payment_status);

create table if not exists checkin_logs (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid references surveys(id) on delete cascade,
  response_id uuid references survey_responses(id) on delete cascade,
  action text not null check (action in ('checkin', 'undo_checkin', 'session_checkin', 'session_uncheckin')),
  method text not null check (method in ('qr', 'face', 'manual', 'bulk')),
  hall text,
  session_name text,
  created_at timestamptz default now()
);

create index if not exists idx_checkin_logs_survey_created
  on checkin_logs(survey_id, created_at desc);
create index if not exists idx_checkin_logs_response_created
  on checkin_logs(response_id, created_at desc);

create table if not exists face_registrations (
  id uuid primary key default gen_random_uuid(),
  response_id uuid not null references survey_responses(id) on delete cascade,
  survey_id uuid not null references surveys(id) on delete cascade,
  photo_url text not null,
  embedding float8[] not null,
  created_at timestamptz default now(),
  constraint uq_face_reg_response unique (response_id)
);

create index if not exists idx_face_reg_survey on face_registrations(survey_id);

-- Atomic helpers for per-session check-in from scanner/attendee screens.
create or replace function checkin_session(resp_id uuid, session_name text)
returns void
language sql
security definer
set search_path = public
as $$
  update survey_responses
  set session_checkins = coalesce(session_checkins, '{}'::jsonb)
    || jsonb_build_object(session_name, now())
  where id = resp_id;
$$;

create or replace function uncheckin_session(resp_id uuid, session_name text)
returns void
language sql
security definer
set search_path = public
as $$
  update survey_responses
  set session_checkins = coalesce(session_checkins, '{}'::jsonb) - session_name
  where id = resp_id;
$$;

-- Realtime
alter table survey_responses replica identity full;
do $$
begin
  alter publication supabase_realtime add table survey_responses;
exception when duplicate_object then
  null;
end $$;

-- Storage bucket for uploads/signatures/theme/face photos.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'survey-uploads',
  'survey-uploads',
  true,
  10485760,
  array['image/jpeg', 'image/jpg', 'image/png', 'image/webp', 'image/gif']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- RLS
alter table quizzes enable row level security;
alter table admin_members enable row level security;
alter table surveys enable row level security;
alter table survey_questions enable row level security;
alter table survey_responses enable row level security;
alter table face_registrations enable row level security;
alter table checkin_logs enable row level security;

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

drop policy if exists "public read surveys" on surveys;
create policy "public read surveys" on surveys for select using (true);

drop policy if exists "owners write surveys" on surveys;
drop policy if exists "admins write surveys" on surveys;
create policy "admins write surveys" on surveys
  for all to authenticated
  using (can_manage_forms())
  with check (can_manage_forms());

drop policy if exists "public read survey_questions" on survey_questions;
create policy "public read survey_questions" on survey_questions for select using (true);

drop policy if exists "owners write survey_questions" on survey_questions;
drop policy if exists "admins write survey_questions" on survey_questions;
create policy "admins write survey_questions" on survey_questions
  for all to authenticated
  using (can_manage_forms())
  with check (can_manage_forms());

drop policy if exists "public insert survey_responses" on survey_responses;
create policy "public insert survey_responses" on survey_responses
  for insert with check (true);

drop policy if exists "public read survey_responses" on survey_responses;
create policy "public read survey_responses" on survey_responses
  for select using (true);

drop policy if exists "public update survey_responses" on survey_responses;
create policy "public update survey_responses" on survey_responses
  for update using (true) with check (true);

drop policy if exists "public delete survey_responses" on survey_responses;
create policy "public delete survey_responses" on survey_responses
  for delete using (true);

drop policy if exists "public insert checkin logs" on checkin_logs;
create policy "public insert checkin logs" on checkin_logs
  for insert with check (true);

drop policy if exists "public read checkin logs" on checkin_logs;
create policy "public read checkin logs" on checkin_logs
  for select using (true);

drop policy if exists "public insert face registrations" on face_registrations;
create policy "public insert face registrations" on face_registrations
  for insert with check (true);

drop policy if exists "public read face registrations" on face_registrations;
create policy "public read face registrations" on face_registrations
  for select using (true);

drop policy if exists "public upload survey files" on storage.objects;
create policy "public upload survey files" on storage.objects
  for insert with check (bucket_id = 'survey-uploads');

drop policy if exists "public read survey files" on storage.objects;
create policy "public read survey files" on storage.objects
  for select using (bucket_id = 'survey-uploads');

drop policy if exists "authenticated delete survey files" on storage.objects;
create policy "authenticated delete survey files" on storage.objects
  for delete to authenticated using (bucket_id = 'survey-uploads');

-- Reusable email templates (shared across the admin workspace)
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

-- Events group multiple forms belonging to the same real-world event
create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  owner_email text,
  name text not null,
  event_date date,
  form_ids jsonb not null default '[]'::jsonb,
  from_name text,
  from_email text,
  reply_to text,
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
