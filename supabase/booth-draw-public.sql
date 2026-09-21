-- Public/free booth draw sessions and bulk booth sizing.
-- Run after supabase/booth-draw.sql on existing projects.

alter table booth_draw_sessions alter column event_id drop not null;
alter table booth_draw_sessions add column if not exists access_mode text not null default 'admin';
alter table booth_draw_sessions add column if not exists passcode_hash text;
alter table booth_draw_sessions add column if not exists expires_at timestamptz;
alter table booth_draw_sessions add column if not exists starts_at timestamptz;
alter table booth_draw_sessions add column if not exists ends_at timestamptz;
alter table booth_draw_sessions add column if not exists venue text;
alter table booth_draw_sessions add column if not exists public_note text;
alter table booth_draw_sessions add column if not exists share_token uuid default gen_random_uuid();
alter table booth_draw_sessions add column if not exists share_enabled boolean not null default true;
alter table booth_draw_sessions alter column share_token set default gen_random_uuid();
update booth_draw_sessions set share_token = gen_random_uuid() where share_token is null;
alter table booth_draw_sessions alter column share_token set not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booth_draw_sessions_access_mode_check'
  ) then
    alter table booth_draw_sessions
      add constraint booth_draw_sessions_access_mode_check
      check (access_mode in ('admin', 'public'));
  end if;
end;
$$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'booth_public_access_check'
  ) then
    alter table booth_draw_sessions
      add constraint booth_public_access_check
      check (access_mode = 'admin' or (passcode_hash is not null and expires_at is not null));
  end if;
end;
$$;

create index if not exists idx_booth_sessions_expiry on booth_draw_sessions(expires_at)
  where access_mode = 'public';
create unique index if not exists idx_booth_sessions_share_token on booth_draw_sessions(share_token);

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

revoke all on function apply_booth_style_to_pool(uuid, uuid, numeric, numeric, numeric)
  from public, anon, authenticated;
grant execute on function apply_booth_style_to_pool(uuid, uuid, numeric, numeric, numeric)
  to service_role;

notify pgrst, 'reload schema';
