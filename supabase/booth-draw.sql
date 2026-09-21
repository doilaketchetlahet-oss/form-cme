-- Booth draw / allocation tool for Form CME.
-- Run once in Supabase SQL Editor after supabase/events.sql.

create extension if not exists pgcrypto;

create table if not exists booth_draw_sessions (
  id uuid primary key default gen_random_uuid(),
  event_id uuid references events(id) on delete cascade,
  name text not null default 'Bốc thăm gian hàng',
  status text not null default 'draft'
    check (status in ('draft', 'active', 'exchange', 'finalized')),
  access_mode text not null default 'admin'
    check (access_mode in ('admin', 'public')),
  passcode_hash text,
  expires_at timestamptz,
  starts_at timestamptz,
  ends_at timestamptz,
  venue text,
  public_note text,
  share_token uuid not null default gen_random_uuid(),
  share_enabled boolean not null default true,
  constraint booth_public_access_check check (
    access_mode = 'admin' or (passcode_hash is not null and expires_at is not null)
  ),
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

-- Immutable draw history. Current positions live in booth_assignments so swaps
-- never overwrite what was originally drawn.
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
create index if not exists idx_booth_sessions_expiry on booth_draw_sessions(expires_at)
  where access_mode = 'public';
create unique index if not exists idx_booth_sessions_share_token on booth_draw_sessions(share_token);
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

-- Draw one booth from the company's own pool. Locking the session serializes
-- spins, while the unique constraints provide a final no-duplicate guard.
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

create or replace function apply_booth_style_to_pool(
  p_session_id uuid,
  p_pool_id uuid,
  p_width numeric,
  p_height numeric,
  p_rotation numeric
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_count integer;
begin
  select status into v_status
  from booth_draw_sessions
  where id = p_session_id
  for update;
  if not found then raise exception 'SESSION_NOT_FOUND'; end if;
  if v_status = 'finalized' then raise exception 'SESSION_FINALIZED'; end if;
  if p_width <= 0 or p_width > 100 or p_height <= 0 or p_height > 100 then
    raise exception 'INVALID_SIZE';
  end if;
  if not exists (
    select 1 from booth_pools where id = p_pool_id and session_id = p_session_id
  ) then raise exception 'POOL_MISMATCH'; end if;

  update booth_zones
  set width = p_width,
      height = p_height,
      rotation = greatest(-180, least(180, p_rotation)),
      x = least(x, 100 - p_width),
      y = least(y, 100 - p_height)
  where session_id = p_session_id and pool_id = p_pool_id;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

revoke all on function draw_booth_for_company(uuid, uuid, uuid, text) from public, anon, authenticated;
revoke all on function swap_booth_assignments(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function move_booth_assignment(uuid, uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function apply_booth_style_to_pool(uuid, uuid, numeric, numeric, numeric) from public, anon, authenticated;
grant execute on function draw_booth_for_company(uuid, uuid, uuid, text) to service_role;
grant execute on function swap_booth_assignments(uuid, uuid, uuid, text, text) to service_role;
grant execute on function move_booth_assignment(uuid, uuid, uuid, text, text) to service_role;
grant execute on function apply_booth_style_to_pool(uuid, uuid, numeric, numeric, numeric) to service_role;

-- Private map images. They are uploaded/read only through the authenticated API.
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
