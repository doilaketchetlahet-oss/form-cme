-- One registration/QR, independent sessions with eligibility and check-in windows.
-- Re-runnable on existing projects; no event/response rows are rewritten.
begin;

create or replace function public.record_session_checkin(
  p_survey_id uuid, p_response_id uuid, p_session_key text,
  p_action text, p_method text default 'qr'
) returns jsonb
language plpgsql security definer set search_path = public
as $$
declare
  attendee survey_responses%rowtype;
  form surveys%rowtype;
  config jsonb;
  session jsonb;
  answer jsonb;
  checked_at text;
  allowed boolean;
  recorded_at timestamptz;
begin
  if p_action is null or p_method is null or p_action not in ('preview', 'checkin', 'undo') or p_method not in ('qr', 'face', 'manual')
     or p_session_key is null or length(trim(p_session_key)) = 0 or length(p_session_key) > 120 then
    return jsonb_build_object('ok', false, 'code', 'bad_request');
  end if;
  select * into attendee from survey_responses where id = p_response_id and survey_id = p_survey_id for update;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  recorded_at := clock_timestamp();
  select * into form from surveys where id = p_survey_id;
  config := form.checkin_theme -> 'sessionConfig';
  if config is not null and config <> 'null'::jsonb then
    if jsonb_typeof(config -> 'sessions') is distinct from 'array' then
      return jsonb_build_object('ok', false, 'code', 'invalid_config');
    end if;
    select item into session from jsonb_array_elements(config -> 'sessions') item where item ->> 'id' = p_session_key limit 1;
    if session is null and p_action <> 'undo' then
      return jsonb_build_object('ok', false, 'code', 'invalid_session');
    end if;
    if p_action <> 'undo' and coalesce((form.checkin_theme ->> 'sessionsEnabled')::boolean, false) = false then
      return jsonb_build_object('ok', false, 'code', 'disabled');
    end if;
  end if;
  session := coalesce(session, jsonb_build_object('id', p_session_key, 'name', p_session_key, 'hall', coalesce(attendee.hall, '')));
  checked_at := attendee.session_checkins ->> p_session_key;

  -- Operators may undo a recorded arrival after the window or eligibility changes.
  if p_action = 'undo' then
    if checked_at is not null then
      update survey_responses set session_checkins = coalesce(session_checkins, '{}'::jsonb) - p_session_key where id = attendee.id;
      insert into checkin_logs (survey_id, response_id, action, method, hall, session_name)
      values (p_survey_id, attendee.id, 'session_uncheckin', p_method, nullif(session ->> 'hall', ''), p_session_key);
    end if;
    return jsonb_build_object('ok', true, 'code', 'unchecked', 'session', session, 'checkedInAt', null);
  end if;

  if coalesce(to_jsonb(attendee) ->> 'payment_status', 'not_required') not in ('not_required', 'paid') then
    return jsonb_build_object('ok', false, 'code', 'payment_pending', 'session', session);
  end if;
  if config ->> 'questionId' is not null then
    if not exists (select 1 from survey_questions where id::text = config ->> 'questionId' and survey_id = p_survey_id and type = 'choice' and required and not is_hall_selector and show_if is null) then
      return jsonb_build_object('ok', false, 'code', 'invalid_config');
    end if;
    answer := attendee.answers -> (config ->> 'questionId');
    if jsonb_typeof(answer) = 'number' then answer := jsonb_build_array(answer); end if;
    if jsonb_typeof(answer) is distinct from 'array' or jsonb_typeof(session -> 'optionIndexes') is distinct from 'array' then
      return jsonb_build_object('ok', false, 'code', 'denied', 'session', session);
    end if;
    select exists (
      select 1 from jsonb_array_elements(answer) choice
      join jsonb_array_elements(session -> 'optionIndexes') permitted on choice = permitted
      where jsonb_typeof(choice) = 'number'
    ) into allowed;
    if not allowed then return jsonb_build_object('ok', false, 'code', 'denied', 'session', session); end if;
  end if;
  if checked_at is not null then
    return jsonb_build_object('ok', true, 'code', 'already', 'session', session, 'checkedInAt', checked_at);
  end if;
  if nullif(session ->> 'opensAt', '') is not null and recorded_at < (session ->> 'opensAt')::timestamptz then
    return jsonb_build_object('ok', false, 'code', 'not_open', 'session', session);
  end if;
  if nullif(session ->> 'closesAt', '') is not null and recorded_at >= (session ->> 'closesAt')::timestamptz then
    return jsonb_build_object('ok', false, 'code', 'closed', 'session', session);
  end if;
  if p_action = 'preview' then return jsonb_build_object('ok', true, 'code', 'ready', 'session', session); end if;

  update survey_responses set session_checkins = coalesce(session_checkins, '{}'::jsonb) || jsonb_build_object(p_session_key, recorded_at) where id = attendee.id;
  insert into checkin_logs (survey_id, response_id, action, method, hall, session_name)
  values (p_survey_id, attendee.id, 'session_checkin', p_method, nullif(session ->> 'hall', ''), p_session_key);
  return jsonb_build_object('ok', true, 'code', 'checked_in', 'session', session, 'checkedInAt', recorded_at);
exception when invalid_datetime_format or datetime_field_overflow then
  return jsonb_build_object('ok', false, 'code', 'invalid_config');
end;
$$;

revoke all on function public.record_session_checkin(uuid, uuid, text, text, text) from public, anon, authenticated;
grant execute on function public.record_session_checkin(uuid, uuid, text, text, text) to service_role;

-- Legacy forms retain existing RPC behavior. Configured sessions can only be
-- written through the server's validated, atomic entry point (including old RPCs).
create or replace function public.guard_managed_session_checkins()
returns trigger language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role'
     and exists (select 1 from surveys where (id = new.survey_id or (tg_op = 'UPDATE' and id = old.survey_id)) and checkin_theme -> 'sessionConfig' is not null and checkin_theme -> 'sessionConfig' <> 'null'::jsonb) then
    if tg_op = 'INSERT' then
      if (new.session_checkins is not null and new.session_checkins <> '{}'::jsonb) or new.checked_in or new.checked_in_at is not null then
        raise exception 'Managed session check-ins must use the check-in API' using errcode = '42501';
      end if;
    elsif new.session_checkins is distinct from old.session_checkins or new.survey_id is distinct from old.survey_id
       or new.checked_in is distinct from old.checked_in or new.checked_in_at is distinct from old.checked_in_at then
      raise exception 'Managed session check-ins must use the check-in API' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_managed_session_checkins on public.survey_responses;
create trigger guard_managed_session_checkins before insert or update on public.survey_responses
for each row execute function public.guard_managed_session_checkins();

notify pgrst, 'reload schema';
commit;
