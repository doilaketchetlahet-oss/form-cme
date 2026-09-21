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
  is_closed boolean not null default false,
  close_at timestamptz,
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

-- Booth allocation tool. Client access is intentionally denied by RLS;
-- authenticated admin APIs use the server-only service role.
create table if not exists booth_draw_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references events(id) on delete cascade,
  name text not null default 'Bốc thăm gian hàng',
  status text not null default 'draft'
    check (status in ('draft', 'active', 'exchange', 'finalized')),
  map_path text,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists booth_pools (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references booth_draw_sessions(id) on delete cascade,
  code text not null,
  name text not null,
  color text not null default '#0ea5e9',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique (session_id, code)
);

create table if not exists booth_companies (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references booth_draw_sessions(id) on delete cascade,
  pool_id uuid not null references booth_pools(id) on delete cascade,
  name text not null,
  draw_order integer not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (session_id, name)
);

create table if not exists booth_zones (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references booth_draw_sessions(id) on delete cascade,
  pool_id uuid not null references booth_pools(id) on delete cascade,
  booth_code text not null,
  x numeric not null default 5 check (x >= 0 and x <= 100),
  y numeric not null default 5 check (y >= 0 and y <= 100),
  width numeric not null default 10 check (width > 0 and width <= 100),
  height numeric not null default 8 check (height > 0 and height <= 100),
  rotation numeric not null default 0,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  unique (session_id, booth_code)
);

-- Original draws are immutable. Current positions are updated separately so
-- exchanges never erase the result that each company actually drew.
create table if not exists booth_draw_results (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references booth_draw_sessions(id) on delete cascade,
  pool_id uuid not null references booth_pools(id) on delete no action,
  company_id uuid not null references booth_companies(id) on delete no action,
  booth_id uuid not null references booth_zones(id) on delete no action,
  request_key uuid not null unique,
  drawn_by text,
  drawn_at timestamptz not null default now(),
  unique (session_id, company_id),
  unique (session_id, booth_id)
);

create table if not exists booth_assignments (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references booth_draw_sessions(id) on delete cascade,
  pool_id uuid not null references booth_pools(id) on delete no action,
  company_id uuid not null references booth_companies(id) on delete no action,
  booth_id uuid not null references booth_zones(id) on delete no action,
  original_result_id uuid not null references booth_draw_results(id) on delete no action,
  source text not null default 'draw' check (source in ('draw', 'swap', 'move')),
  updated_by text,
  updated_at timestamptz not null default now(),
  constraint booth_assignments_session_company_key unique (session_id, company_id)
    deferrable initially immediate,
  constraint booth_assignments_session_booth_key unique (session_id, booth_id)
    deferrable initially immediate
);

create table if not exists booth_exchange_logs (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references booth_draw_sessions(id) on delete cascade,
  pool_id uuid not null references booth_pools(id) on delete no action,
  action text not null check (action in ('swap', 'move')),
  company_a_id uuid not null references booth_companies(id) on delete no action,
  company_b_id uuid references booth_companies(id) on delete no action,
  booth_a_before_id uuid not null references booth_zones(id) on delete no action,
  booth_b_before_id uuid references booth_zones(id) on delete no action,
  booth_a_after_id uuid not null references booth_zones(id) on delete no action,
  booth_b_after_id uuid references booth_zones(id) on delete no action,
  reason text,
  created_by text,
  created_at timestamptz not null default now()
);

create index if not exists idx_booth_sessions_event on booth_draw_sessions(event_id, created_at desc);
create index if not exists idx_booth_pools_session on booth_pools(session_id, sort_order);
create index if not exists idx_booth_companies_pool on booth_companies(pool_id, draw_order);
create index if not exists idx_booth_zones_pool on booth_zones(pool_id, booth_code);
create index if not exists idx_booth_draw_results_session on booth_draw_results(session_id, drawn_at);
create index if not exists idx_booth_exchange_logs_session on booth_exchange_logs(session_id, created_at desc);

alter table booth_draw_sessions enable row level security;
alter table booth_pools enable row level security;
alter table booth_companies enable row level security;
alter table booth_zones enable row level security;
alter table booth_draw_results enable row level security;
alter table booth_assignments enable row level security;
alter table booth_exchange_logs enable row level security;

create or replace function draw_booth_for_company(
  p_session_id uuid,
  p_company_id uuid,
  p_request_key uuid,
  p_actor text
)
returns table (
  result_id uuid,
  company_id uuid,
  company_name text,
  booth_id uuid,
  booth_code text,
  pool_id uuid,
  pool_name text,
  pool_color text
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_session booth_draw_sessions%rowtype;
  v_company booth_companies%rowtype;
  v_booth booth_zones%rowtype;
  v_pool booth_pools%rowtype;
  v_result booth_draw_results%rowtype;
begin
  select * into v_session
  from booth_draw_sessions
  where id = p_session_id
  for update;

  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_session.status = 'finalized' then raise exception 'SESSION_FINALIZED'; end if;

  select * into v_company
  from booth_companies
  where id = p_company_id and session_id = p_session_id and active = true
  for update;
  if not found then raise exception 'COMPANY_NOT_FOUND'; end if;

  select r.* into v_result
  from booth_draw_results r
  where r.session_id = p_session_id
    and (r.request_key = p_request_key or r.company_id = p_company_id)
  order by (r.request_key = p_request_key) desc
  limit 1;

  if found then
    select * into v_booth from booth_zones where id = v_result.booth_id;
    select * into v_pool from booth_pools where id = v_result.pool_id;
    return query select v_result.id, v_company.id, v_company.name, v_booth.id,
      v_booth.booth_code, v_pool.id, v_pool.name, v_pool.color;
    return;
  end if;

  select z.* into v_booth
  from booth_zones z
  where z.session_id = p_session_id
    and z.pool_id = v_company.pool_id
    and z.active = true
    and not exists (
      select 1 from booth_assignments a
      where a.session_id = p_session_id and a.booth_id = z.id
    )
    and not exists (
      select 1 from booth_draw_results r
      where r.session_id = p_session_id and r.booth_id = z.id
    )
  order by gen_random_uuid()
  limit 1
  for update skip locked;

  if not found then raise exception 'NO_AVAILABLE_BOOTHS'; end if;

  insert into booth_draw_results (
    session_id, pool_id, company_id, booth_id, request_key, drawn_by
  ) values (
    p_session_id, v_company.pool_id, v_company.id, v_booth.id, p_request_key, p_actor
  ) returning * into v_result;

  insert into booth_assignments (
    session_id, pool_id, company_id, booth_id, original_result_id, source, updated_by
  ) values (
    p_session_id, v_company.pool_id, v_company.id, v_booth.id, v_result.id, 'draw', p_actor
  );

  update booth_draw_sessions
  set status = case when status = 'draft' then 'active' else status end,
      updated_at = now()
  where id = p_session_id;

  select * into v_pool from booth_pools where id = v_company.pool_id;
  return query select v_result.id, v_company.id, v_company.name, v_booth.id,
    v_booth.booth_code, v_pool.id, v_pool.name, v_pool.color;
end;
$$;

create or replace function swap_booth_assignments(
  p_session_id uuid,
  p_company_a_id uuid,
  p_company_b_id uuid,
  p_reason text,
  p_actor text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_a booth_assignments%rowtype;
  v_b booth_assignments%rowtype;
begin
  select status into v_status from booth_draw_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_status = 'finalized' then raise exception 'SESSION_FINALIZED'; end if;
  if p_company_a_id = p_company_b_id then raise exception 'SAME_COMPANY'; end if;

  select * into v_a from booth_assignments
  where session_id = p_session_id and company_id = p_company_a_id for update;
  select * into v_b from booth_assignments
  where session_id = p_session_id and company_id = p_company_b_id for update;
  if v_a.id is null or v_b.id is null then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;
  if v_a.pool_id <> v_b.pool_id then raise exception 'POOL_MISMATCH'; end if;

  set constraints booth_assignments_session_booth_key deferred;
  update booth_assignments
  set booth_id = case
      when company_id = p_company_a_id then v_b.booth_id
      else v_a.booth_id
    end,
    source = 'swap', updated_by = p_actor, updated_at = now()
  where session_id = p_session_id
    and company_id in (p_company_a_id, p_company_b_id);

  insert into booth_exchange_logs (
    session_id, pool_id, action, company_a_id, company_b_id,
    booth_a_before_id, booth_b_before_id, booth_a_after_id, booth_b_after_id,
    reason, created_by
  ) values (
    p_session_id, v_a.pool_id, 'swap', p_company_a_id, p_company_b_id,
    v_a.booth_id, v_b.booth_id, v_b.booth_id, v_a.booth_id,
    nullif(trim(p_reason), ''), p_actor
  );

  update booth_draw_sessions set status = 'exchange', updated_at = now() where id = p_session_id;
end;
$$;

create or replace function move_booth_assignment(
  p_session_id uuid,
  p_company_id uuid,
  p_target_booth_id uuid,
  p_reason text,
  p_actor text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_assignment booth_assignments%rowtype;
  v_target booth_zones%rowtype;
begin
  select status into v_status from booth_draw_sessions where id = p_session_id for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_status = 'finalized' then raise exception 'SESSION_FINALIZED'; end if;

  select * into v_assignment from booth_assignments
  where session_id = p_session_id and company_id = p_company_id for update;
  if not found then raise exception 'ASSIGNMENT_NOT_FOUND'; end if;

  select * into v_target from booth_zones
  where id = p_target_booth_id and session_id = p_session_id and active = true for update;
  if not found then raise exception 'BOOTH_NOT_FOUND'; end if;
  if v_assignment.pool_id <> v_target.pool_id then raise exception 'POOL_MISMATCH'; end if;
  if exists (
    select 1 from booth_assignments
    where session_id = p_session_id and booth_id = p_target_booth_id
  ) then raise exception 'BOOTH_OCCUPIED'; end if;

  update booth_assignments
  set booth_id = p_target_booth_id, source = 'move', updated_by = p_actor, updated_at = now()
  where id = v_assignment.id;

  insert into booth_exchange_logs (
    session_id, pool_id, action, company_a_id,
    booth_a_before_id, booth_a_after_id, reason, created_by
  ) values (
    p_session_id, v_assignment.pool_id, 'move', p_company_id,
    v_assignment.booth_id, p_target_booth_id, nullif(trim(p_reason), ''), p_actor
  );

  update booth_draw_sessions set status = 'exchange', updated_at = now() where id = p_session_id;
end;
$$;

revoke all on function draw_booth_for_company(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function swap_booth_assignments(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function move_booth_assignment(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function draw_booth_for_company(uuid, uuid, uuid, text) to service_role;
grant execute on function swap_booth_assignments(uuid, uuid, uuid, text, text) to service_role;
grant execute on function move_booth_assignment(uuid, uuid, uuid, text, text) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'booth-maps',
  'booth-maps',
  false,
  10485760,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

notify pgrst, 'reload schema';
