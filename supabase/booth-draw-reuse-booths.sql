-- Booth draw: vacated booths return to the draw, reserved booths stay reserved.
-- Run once in Supabase SQL Editor on projects that already ran booth-draw.sql
-- (and booth-draw-auto-final.sql). Safe to re-run.
--
-- Before: "Chuyển sang gian trống" during drawing left the old booth empty but
-- permanently excluded (it still had a draw-history row), so the last company
-- of a full pool got "không còn gian hàng trống". A move could also take a booth
-- held ("gán trước") for a company that had not drawn yet.

-- A booth may appear in the draw history more than once: its first company
-- can move away, after which the booth is drawn again. Current occupancy is
-- enforced by booth_assignments (one company per booth).
alter table booth_draw_results drop constraint if exists booth_draw_results_session_id_booth_id_key;
create index if not exists idx_booth_draw_results_booth on booth_draw_results(session_id, booth_id);

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
  v_auto_company booth_companies%rowtype;
  v_auto_booth booth_zones%rowtype;
  v_auto_result booth_draw_results%rowtype;
  v_remaining_companies integer;
  v_remaining_booths integer;
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

  if v_company.preferred_booth_id is not null then
    select z.* into v_booth
    from booth_zones z
    where z.id = v_company.preferred_booth_id
      and z.session_id = p_session_id
      and z.pool_id = v_company.pool_id
      and z.active = true
      and not exists (
        select 1 from booth_assignments a
        where a.session_id = p_session_id and a.booth_id = z.id
      )
    for update;
  else
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
        select 1
        from booth_companies reserved
        where reserved.session_id = p_session_id
          and reserved.pool_id = v_company.pool_id
          and reserved.preferred_booth_id = z.id
          and reserved.active = true
          and not exists (
            select 1 from booth_assignments assigned
            where assigned.session_id = p_session_id
              and assigned.company_id = reserved.id
          )
      )
    order by gen_random_uuid()
    limit 1
    for update skip locked;
  end if;

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

  -- When this draw leaves exactly one company and one booth in the pool,
  -- assign that unavoidable final pairing in the same locked transaction.
  -- Availability always means "no current assignment": a booth vacated by a
  -- move returns to the draw instead of being lost.
  select count(*) into v_remaining_companies
  from booth_companies c
  where c.session_id = p_session_id
    and c.pool_id = v_company.pool_id
    and c.active = true
    and not exists (
      select 1 from booth_assignments a
      where a.session_id = p_session_id and a.company_id = c.id
    );

  select count(*) into v_remaining_booths
  from booth_zones z
  where z.session_id = p_session_id
    and z.pool_id = v_company.pool_id
    and z.active = true
    and not exists (
      select 1 from booth_assignments a
      where a.session_id = p_session_id and a.booth_id = z.id
    );

  if v_remaining_companies = 1 and v_remaining_booths = 1 then
    select c.* into v_auto_company
    from booth_companies c
    where c.session_id = p_session_id
      and c.pool_id = v_company.pool_id
      and c.active = true
      and not exists (
        select 1 from booth_assignments a
        where a.session_id = p_session_id and a.company_id = c.id
      )
    limit 1
    for update;

    select z.* into v_auto_booth
    from booth_zones z
    where z.session_id = p_session_id
      and z.pool_id = v_company.pool_id
      and z.active = true
      and not exists (
        select 1 from booth_assignments a
        where a.session_id = p_session_id and a.booth_id = z.id
      )
    limit 1
    for update;

    insert into booth_draw_results (
      session_id, pool_id, company_id, booth_id, request_key, drawn_by
    ) values (
      p_session_id, v_auto_company.pool_id, v_auto_company.id,
      v_auto_booth.id, gen_random_uuid(), p_actor
    ) returning * into v_auto_result;

    insert into booth_assignments (
      session_id, pool_id, company_id, booth_id, original_result_id, source, updated_by
    ) values (
      p_session_id, v_auto_company.pool_id, v_auto_company.id,
      v_auto_booth.id, v_auto_result.id, 'draw', p_actor
    );

    return query select v_auto_result.id, v_auto_company.id, v_auto_company.name,
      v_auto_booth.id, v_auto_booth.booth_code, v_pool.id, v_pool.name, v_pool.color;
  end if;
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
  -- A booth held for a company that has not drawn yet stays held.
  if exists (
    select 1 from booth_companies reserved
    where reserved.session_id = p_session_id
      and reserved.preferred_booth_id = p_target_booth_id
      and reserved.active = true
      and reserved.id <> p_company_id
      and not exists (
        select 1 from booth_assignments assigned
        where assigned.session_id = p_session_id and assigned.company_id = reserved.id
      )
  ) then raise exception 'BOOTH_RESERVED'; end if;

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
revoke all on function move_booth_assignment(uuid, uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function draw_booth_for_company(uuid, uuid, uuid, text) to service_role;
grant execute on function move_booth_assignment(uuid, uuid, uuid, text, text) to service_role;

notify pgrst, 'reload schema';
