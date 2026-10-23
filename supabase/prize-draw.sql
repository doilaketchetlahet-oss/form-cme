-- Registration-linked prize draw. Re-runnable; no sample data is inserted here.
create table if not exists prize_campaigns (
  id uuid primary key default gen_random_uuid(),
  survey_id uuid not null unique references surveys(id) on delete restrict,
  phone_question_id uuid not null references survey_questions(id) on delete restrict,
  name text not null,
  status text not null default 'draft' check (status in ('draft','active','paused','closed')),
  is_demo boolean not null default true,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  accent_color text not null default '#0284c7',
  banner_url text not null default '',
  instructions text not null default 'Vui lòng đưa mã nhận quà cho nhân viên tại booth.',
  track_redemption boolean not null default true,
  revision integer not null default 1,
  created_by text not null,
  created_at timestamptz not null default now(),
  check (ends_at > starts_at)
);
alter table surveys add column if not exists prize_campaign_id uuid references prize_campaigns(id) on delete restrict;
create table if not exists prize_items (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references prize_campaigns(id) on delete restrict,
  name text not null,
  color text not null,
  total integer not null check (total between 0 and 100000),
  remaining integer not null check (remaining >= 0 and remaining <= total),
  position integer not null
);
create index if not exists prize_items_campaign on prize_items(campaign_id, position);
create table if not exists prize_entries (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references prize_campaigns(id) on delete restrict,
  -- Deleting a registration must never erase a draw or allow the phone to replay.
  response_id uuid references survey_responses(id) on delete set null,
  phone text not null check (phone ~ '^0[3-9][0-9]{8}$'),
  token_hash text not null check (token_hash ~ '^[a-f0-9]{64}$'),
  answers jsonb not null,
  prize_id uuid references prize_items(id) on delete restrict,
  prize_name text,
  prize_color text,
  claim_code text not null unique default upper(replace(gen_random_uuid()::text, '-', '')),
  created_at timestamptz not null default now(),
  drawn_at timestamptz,
  redeemed_at timestamptz,
  redeemed_by text,
  unique(campaign_id, phone),
  unique(campaign_id, token_hash)
);
create index if not exists prize_entries_campaign on prize_entries(campaign_id, created_at desc);
alter table prize_campaigns enable row level security;
alter table prize_items enable row level security;
alter table prize_entries enable row level security;
revoke all on prize_campaigns, prize_items, prize_entries from public, anon, authenticated;
grant all on prize_campaigns, prize_items, prize_entries to service_role;

-- Existing public registration policies remain in place for unrelated forms.
-- RESTRICTIVE prevents those permissive policies from bypassing prize registration.
create or replace function is_prize_form(p_survey uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from prize_campaigns where survey_id = p_survey);
$$;
revoke all on function is_prize_form(uuid) from public;
grant execute on function is_prize_form(uuid) to anon, authenticated, service_role;
drop policy if exists prize_response_boundary on survey_responses;
create policy prize_response_boundary on survey_responses as restrictive for all to anon, authenticated
  using (not is_prize_form(survey_id) or can_manage_forms())
  with check (not is_prize_form(survey_id) or can_manage_forms());

-- Prize ledgers are read through the admin API, including for viewers.
-- Protect the association and the identity question even from older editors.
create or replace function guard_prize_form() returns trigger
language plpgsql security definer set search_path = public as $$
declare c prize_campaigns%rowtype;
begin
  if tg_table_name='surveys' then
    select * into c from prize_campaigns where survey_id=new.id;
    if found and (new.prize_campaign_id is distinct from c.id or new.form_type<>'feedback'
      or coalesce((new.payment_config->>'enabled')::boolean,false) or new.vip_checkin_enabled)
      then raise exception 'Form quay quà phải giữ loại khảo sát và liên kết chương trình, không bật thanh toán/khuôn mặt.'; end if;
  else
    select * into c from prize_campaigns where phone_question_id=new.id;
    if found and (new.survey_id<>c.survey_id or new.type<>'phone' or not new.required or new.show_if is not null)
      then raise exception 'Câu hỏi SĐT của vòng quay phải giữ nguyên, bắt buộc và luôn hiển thị.'; end if;
    if exists(select 1 from prize_campaigns where survey_id=new.survey_id) and
      (new.type in ('file_upload','signature','face_checkin') or new.is_hall_selector)
      then raise exception 'Form quay quà không hỗ trợ tệp, chữ ký, khuôn mặt hoặc hội trường.'; end if;
  end if;
  return new;
end;
$$;
revoke all on function guard_prize_form() from public,anon,authenticated;
drop trigger if exists guard_prize_survey on surveys;
create trigger guard_prize_survey before update on surveys for each row execute function guard_prize_form();
drop trigger if exists guard_prize_question on survey_questions;
create trigger guard_prize_question before insert or update on survey_questions for each row execute function guard_prize_form();

create or replace function prize_draw_admin(p_action text, p_id uuid, p_data jsonb, p_actor text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c prize_campaigns%rowtype; s surveys%rowtype; q uuid; container uuid;
  item jsonb; old_item prize_items%rowtype; new_id uuid; n integer; used integer; ordinal integer := 0;
begin
  if p_action = 'create' then
    if nullif(p_data->>'survey_id','') is not null then
      select * into s from surveys where id = (p_data->>'survey_id')::uuid for update;
      if not found or s.prize_campaign_id is not null then raise exception 'FORM_UNAVAILABLE'; end if;
      if s.form_type <> 'feedback' or coalesce((s.payment_config->>'enabled')::boolean,false) or s.vip_checkin_enabled
        or exists(select 1 from survey_responses where survey_id = s.id)
        then raise exception 'FORM_UNAVAILABLE'; end if;
      q := (p_data->>'phone_question_id')::uuid;
      if not exists(select 1 from survey_questions where id=q and survey_id=s.id and type='phone' and required and show_if is null)
        then raise exception 'PHONE_QUESTION_INVALID'; end if;
      if exists(select 1 from survey_questions where survey_id=s.id and (type in ('file_upload','signature','face_checkin') or is_hall_selector))
        then raise exception 'FORM_UNAVAILABLE'; end if;
    else
      insert into quizzes(title,owner_id) values(p_data->>'name',p_actor) returning id into container;
      insert into surveys(quiz_id,title,form_type,thank_you_message)
        values(container,p_data->>'name','feedback','Cảm ơn bạn! Mời bạn quay nhận quà.') returning * into s;
      insert into survey_questions(survey_id,position,type,text,required) values(s.id,0,'text','Họ và tên',true);
      insert into survey_questions(survey_id,position,type,text,required) values(s.id,1,'phone','Số điện thoại',true) returning id into q;
      insert into survey_questions(survey_id,position,type,text,required) values(s.id,2,'text','Đơn vị / Công ty',false);
    end if;
    insert into prize_campaigns(survey_id,phone_question_id,name,is_demo,starts_at,ends_at,created_by)
      values(s.id,q,p_data->>'name',coalesce((p_data->>'is_demo')::boolean,true),(p_data->>'starts_at')::timestamptz,(p_data->>'ends_at')::timestamptz,p_actor) returning * into c;
    update surveys set prize_campaign_id=c.id where id=s.id;
  else
    select * into c from prize_campaigns where id=p_id for update;
    if not found then raise exception 'NOT_FOUND'; end if;
    if p_action = 'redeem' then
      if not c.track_redemption then raise exception 'REDEMPTION_DISABLED'; end if;
      update prize_entries set redeemed_at=now(),redeemed_by=p_actor
        where id=(p_data->>'entry_id')::uuid and campaign_id=c.id and prize_id is not null and redeemed_at is null;
      if not found and not exists(select 1 from prize_entries where id=(p_data->>'entry_id')::uuid and campaign_id=c.id and redeemed_at is not null)
        then raise exception 'NOT_FOUND'; end if;
      return c.id;
    end if;
    if p_action <> 'save' then raise exception 'BAD_ACTION'; end if;
    if (p_data->>'revision')::integer is distinct from c.revision then raise exception 'STALE_REVISION'; end if;
    update prize_campaigns set name=p_data->>'name',status=p_data->>'status',
      starts_at=(p_data->>'starts_at')::timestamptz,ends_at=(p_data->>'ends_at')::timestamptz,
      accent_color=p_data->>'accent_color',banner_url=p_data->>'banner_url',instructions=p_data->>'instructions',
      track_redemption=(p_data->>'track_redemption')::boolean,revision=revision+1 where id=c.id;
  end if;
  if jsonb_array_length(p_data->'items') not between 1 and 12 then raise exception 'INVALID_ITEMS'; end if;
  -- Once someone has registered, keep stable prize IDs and never remove history.
  if exists(select 1 from prize_entries where campaign_id=c.id) and exists(
    select 1 from prize_items pi where pi.campaign_id=c.id and not exists(
      select 1 from jsonb_array_elements(p_data->'items') v where v->>'id'=pi.id::text)) then raise exception 'PRIZES_LOCKED'; end if;
  delete from prize_items pi where pi.campaign_id=c.id and not exists(
    select 1 from jsonb_array_elements(p_data->'items') v where v->>'id'=pi.id::text);
  for item in select value from jsonb_array_elements(p_data->'items') loop
    new_id := coalesce(nullif(item->>'id','')::uuid,gen_random_uuid());
    select * into old_item from prize_items where id=new_id;
    if found and old_item.campaign_id<>c.id then raise exception 'INVALID_ITEMS'; end if;
    used := coalesce(old_item.total-old_item.remaining,0);
    n := (item->>'total')::integer;
    if n<used then raise exception 'BELOW_DISTRIBUTED'; end if;
    insert into prize_items(id,campaign_id,name,color,total,remaining,position)
      values(new_id,c.id,item->>'name',item->>'color',n,n-used,ordinal)
      on conflict(id) do update set name=excluded.name,color=excluded.color,total=excluded.total,remaining=excluded.remaining,position=excluded.position;
    ordinal := ordinal+1;
  end loop;
  return c.id;
end;
$$;

create or replace function prize_draw_register(p_id uuid,p_hash text,p_phone text,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c prize_campaigns%rowtype; e prize_entries%rowtype; response uuid; s surveys%rowtype;
begin
  select * into c from prize_campaigns where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into e from prize_entries where campaign_id=c.id and token_hash=p_hash;
  if found then return to_jsonb(e); end if;
  if exists(select 1 from prize_entries where campaign_id=c.id and phone=p_phone) then raise exception 'PHONE_USED'; end if;
  if c.status<>'active' then raise exception 'NOT_ACTIVE'; end if;
  if not c.is_demo and (now()<c.starts_at or now()>=c.ends_at) then raise exception 'OUTSIDE_WINDOW'; end if;
  if not exists(select 1 from prize_items where campaign_id=c.id and remaining>0) then raise exception 'SOLD_OUT'; end if;
  select * into s from surveys where id=c.survey_id;
  if s.is_closed or s.close_at<=now() then raise exception 'FORM_CLOSED'; end if;
  if not exists(select 1 from survey_questions where id=c.phone_question_id and survey_id=c.survey_id and type='phone' and required and show_if is null)
    or p_answers->>c.phone_question_id::text is distinct from p_phone then raise exception 'PHONE_QUESTION_INVALID'; end if;
  insert into survey_responses(survey_id,answers) values(c.survey_id,p_answers) returning id into response;
  insert into prize_entries(campaign_id,response_id,phone,token_hash,answers)
    values(c.id,response,p_phone,p_hash,p_answers) returning * into e;
  return to_jsonb(e);
end;
$$;

create or replace function prize_draw_spin(p_id uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c prize_campaigns%rowtype; e prize_entries%rowtype; p prize_items%rowtype; total_left bigint; ticket bigint;
begin
  -- Same campaign lock used by registration, stock edits and redemption.
  select * into c from prize_campaigns where id=p_id for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  select * into e from prize_entries where campaign_id=c.id and token_hash=p_hash for update;
  if not found then raise exception 'REGISTRATION_REQUIRED'; end if;
  if e.prize_id is not null then return to_jsonb(e); end if;
  if c.status<>'active' then raise exception 'NOT_ACTIVE'; end if;
  if not c.is_demo and (now()<c.starts_at or now()>=c.ends_at) then raise exception 'OUTSIDE_WINDOW'; end if;
  select sum(remaining) into total_left from prize_items where campaign_id=c.id;
  if coalesce(total_left,0)=0 then raise exception 'SOLD_OUT'; end if;
  ticket := floor(random()*total_left)::bigint;
  select pi.* into p from prize_items pi join (
    select id,sum(remaining) over(order by position,id) cumulative from prize_items where campaign_id=c.id and remaining>0
  ) weighted on weighted.id=pi.id where weighted.cumulative>ticket order by pi.position,pi.id limit 1;
  update prize_items set remaining=remaining-1 where id=p.id;
  update prize_entries set prize_id=p.id,prize_name=p.name,prize_color=p.color,drawn_at=now() where id=e.id returning * into e;
  return to_jsonb(e);
end;
$$;

revoke all on function prize_draw_admin(text,uuid,jsonb,text) from public,anon,authenticated;
revoke all on function prize_draw_register(uuid,text,text,jsonb) from public,anon,authenticated;
revoke all on function prize_draw_spin(uuid,text) from public,anon,authenticated;
grant execute on function prize_draw_admin(text,uuid,jsonb,text) to service_role;
grant execute on function prize_draw_register(uuid,text,text,jsonb) to service_role;
grant execute on function prize_draw_spin(uuid,text) to service_role;
notify pgrst, 'reload schema';
