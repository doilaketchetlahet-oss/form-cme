-- Standalone prize registration. Copy configuration once, preserve all entries and
-- awards, and release legacy CME forms so their normal deletion works again.
-- No legacy survey, question, response or container is deleted by this migration.
alter table prize_campaigns add column if not exists form_fields jsonb;
alter table prize_campaigns add column if not exists form_title text not null default 'Đăng ký nhận quà';
alter table prize_campaigns add column if not exists form_description text not null default 'Điền thông tin để nhận một lượt quay và khám phá phần quà dành cho bạn.';
alter table prize_campaigns add column if not exists thank_you_message text not null default 'Cảm ơn bạn! Lượt quay của bạn đã sẵn sàng.';
alter table prize_campaigns add column if not exists legacy_form_id uuid;
alter table prize_campaigns add column if not exists deleted_at timestamptz;
do $$begin
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='prize_items' and column_name='image_url') then
    alter table prize_items add column image_url text not null default '';
    -- Supply illustrations once for unchanged demo gifts; never restore removed images.
    update prize_items p set image_url='/prize-draw/gifts/' || case p.name
      when 'Bình nước' then 'bottle.svg' when 'Túi vải' then 'bag.svg'
      when 'Ô cầm tay' then 'umbrella.svg' when 'Bộ quà đặc biệt' then 'gift.svg' end
    from prize_campaigns c where c.id=p.campaign_id and c.is_demo
      and p.name in ('Bình nước','Túi vải','Ô cầm tay','Bộ quà đặc biệt');
  end if;
end$$;
alter table prize_entries add column if not exists prize_image_url text;
alter table prize_campaigns alter column survey_id drop not null;
-- Campaigns now open/close manually. Retain historical dates without enforcing them.
alter table prize_campaigns alter column starts_at drop not null;
alter table prize_campaigns alter column ends_at drop not null;
alter table prize_campaigns drop constraint if exists prize_campaigns_survey_id_fkey;
alter table prize_campaigns drop constraint if exists prize_campaigns_phone_question_id_fkey;
alter table prize_entries drop constraint if exists prize_entries_response_id_fkey;
drop trigger if exists guard_prize_survey on surveys;
drop trigger if exists guard_prize_question on survey_questions;
drop policy if exists prize_response_boundary on survey_responses;
drop function if exists guard_prize_form();
drop function if exists is_prize_form(uuid);

update prize_campaigns c set
  form_fields=coalesce((select jsonb_agg(to_jsonb(q)-'survey_id' order by q.position) from survey_questions q where q.survey_id=c.survey_id),'[]'::jsonb),
  form_title=s.title,thank_you_message=coalesce(nullif(s.thank_you_message,''),c.thank_you_message),
  banner_url=coalesce(nullif(c.banner_url,''),s.banner_url,''),legacy_form_id=c.survey_id
from surveys s where s.id=c.survey_id and c.form_fields is null;
update surveys s set prize_campaign_id=null from prize_campaigns c where s.prize_campaign_id=c.id and c.form_fields is not null;
update prize_campaigns set survey_id=null where form_fields is not null;
alter table prize_campaigns alter column form_fields set not null;
create unique index if not exists prize_campaigns_legacy_form on prize_campaigns(legacy_form_id) where legacy_form_id is not null;

-- Keep archived CME response copies private after detaching. Admins can still
-- remove the old form; the independent entry/award ledger survives that deletion.
create or replace function is_prize_form(p_survey uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists(select 1 from prize_campaigns where legacy_form_id=p_survey);
$$;
revoke all on function is_prize_form(uuid) from public;
grant execute on function is_prize_form(uuid) to anon, authenticated, service_role;
create policy prize_response_boundary on survey_responses as restrictive for all to anon, authenticated
  using (not is_prize_form(survey_id) or can_manage_forms())
  with check (not is_prize_form(survey_id) or can_manage_forms());

-- Image writes go through the permission-checked server. Public reads are images only.
do $$begin
  if to_regclass('storage.buckets') is not null then
    insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
      values('prize-assets','prize-assets',true,5242880,array['image/webp'])
      on conflict(id) do nothing;
  end if;
end$$;

create or replace function prize_draw_admin(p_action text, p_id uuid, p_data jsonb, p_actor text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  c prize_campaigns%rowtype; q uuid; fields jsonb;
  item jsonb; old_item prize_items%rowtype; new_id uuid; n integer; used integer; ordinal integer := 0;
begin
  if p_action = 'create' then
    q := gen_random_uuid();
    fields := jsonb_build_array(
      jsonb_build_object('id',gen_random_uuid(),'position',0,'type','text','text','Họ và tên','required',true,'allow_multiple',false,'options',null,'show_if',null),
      jsonb_build_object('id',q,'position',1,'type','phone','text','Số điện thoại','required',true,'allow_multiple',false,'options',null,'show_if',null),
      jsonb_build_object('id',gen_random_uuid(),'position',2,'type','text','text','Đơn vị / Công ty','required',false,'allow_multiple',false,'options',null,'show_if',null));
    insert into prize_campaigns(phone_question_id,name,is_demo,created_by,form_fields,form_title)
      values(q,p_data->>'name',coalesce((p_data->>'is_demo')::boolean,true),p_actor,fields,'Đăng ký nhận quà') returning * into c;
  else
    select * into c from prize_campaigns where id=p_id for update;
    if not found or c.deleted_at is not null then raise exception 'NOT_FOUND'; end if;
    if p_action = 'delete' then
      if (p_data->>'revision')::integer is distinct from c.revision then raise exception 'STALE_REVISION'; end if;
      update prize_campaigns set deleted_at=now(),status='closed',revision=revision+1 where id=c.id;
      return c.id;
    end if;
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
    fields := coalesce(p_data->'form_fields',c.form_fields);
    if jsonb_typeof(fields)<>'array' or jsonb_array_length(fields) not between 1 and 30 then raise exception 'INVALID_FORM'; end if;
    if not exists(select 1 from jsonb_array_elements(fields) f where f->>'id'=c.phone_question_id::text and f->>'type'='phone' and f->>'required'='true' and coalesce(f->'show_if','null'::jsonb)='null'::jsonb) then raise exception 'PHONE_QUESTION_INVALID'; end if;
    if fields is distinct from c.form_fields and exists(select 1 from prize_entries where campaign_id=c.id) then raise exception 'FORM_LOCKED'; end if;
    update prize_campaigns set form_fields=fields,form_title=coalesce(p_data->>'form_title',c.form_title),
      form_description=coalesce(p_data->>'form_description',c.form_description),
      thank_you_message=coalesce(p_data->>'thank_you_message',c.thank_you_message),name=p_data->>'name',status=p_data->>'status',
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
    insert into prize_items(id,campaign_id,name,color,image_url,total,remaining,position)
      values(new_id,c.id,item->>'name',item->>'color',coalesce(item->>'image_url',''),n,n-used,ordinal)
      on conflict(id) do update set name=excluded.name,color=excluded.color,image_url=excluded.image_url,total=excluded.total,remaining=excluded.remaining,position=excluded.position;
    ordinal := ordinal+1;
  end loop;
  return c.id;
end;
$$;

create or replace function prize_draw_register(p_id uuid,p_hash text,p_phone text,p_answers jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c prize_campaigns%rowtype; e prize_entries%rowtype;
begin
  select * into c from prize_campaigns where id=p_id for update;
  if not found or c.deleted_at is not null then raise exception 'NOT_FOUND'; end if;
  select * into e from prize_entries where campaign_id=c.id and token_hash=p_hash;
  if found then return to_jsonb(e); end if;
  if exists(select 1 from prize_entries where campaign_id=c.id and phone=p_phone) then raise exception 'PHONE_USED'; end if;
  if c.status<>'active' then raise exception 'NOT_ACTIVE'; end if;
  if not exists(select 1 from prize_items where campaign_id=c.id and remaining>0) then raise exception 'SOLD_OUT'; end if;
  if p_answers->>c.phone_question_id::text is distinct from p_phone then raise exception 'PHONE_QUESTION_INVALID'; end if;
  insert into prize_entries(campaign_id,phone,token_hash,answers)
    values(c.id,p_phone,p_hash,p_answers) returning * into e;
  return to_jsonb(e);
end;
$$;

create or replace function prize_draw_spin(p_id uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c prize_campaigns%rowtype; e prize_entries%rowtype; p prize_items%rowtype; total_left bigint; ticket bigint;
begin
  -- Same campaign lock used by registration, stock edits and redemption.
  select * into c from prize_campaigns where id=p_id for update;
  if not found or c.deleted_at is not null then raise exception 'NOT_FOUND'; end if;
  select * into e from prize_entries where campaign_id=c.id and token_hash=p_hash for update;
  if not found then raise exception 'REGISTRATION_REQUIRED'; end if;
  if e.prize_id is not null then return to_jsonb(e); end if;
  if c.status<>'active' then raise exception 'NOT_ACTIVE'; end if;
  select sum(remaining) into total_left from prize_items where campaign_id=c.id;
  if coalesce(total_left,0)=0 then raise exception 'SOLD_OUT'; end if;
  ticket := floor(random()*total_left)::bigint;
  select pi.* into p from prize_items pi join (
    select id,sum(remaining) over(order by position,id) cumulative from prize_items where campaign_id=c.id and remaining>0
  ) weighted on weighted.id=pi.id where weighted.cumulative>ticket order by pi.position,pi.id limit 1;
  update prize_items set remaining=remaining-1 where id=p.id;
  update prize_entries set prize_id=p.id,prize_name=p.name,prize_color=p.color,prize_image_url=p.image_url,drawn_at=now() where id=e.id returning * into e;
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

-- Bind API validation to the configuration revision under the same campaign lock.
create or replace function prize_draw_register_current(p_id uuid,p_hash text,p_phone text,p_answers jsonb,p_revision integer)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c prize_campaigns%rowtype; e prize_entries%rowtype;
begin
  select * into c from prize_campaigns where id=p_id for update;
  if not found or c.deleted_at is not null then raise exception 'NOT_FOUND'; end if;
  select * into e from prize_entries where campaign_id=c.id and token_hash=p_hash;
  if found then return to_jsonb(e); end if;
  if p_revision is distinct from c.revision then raise exception 'STALE_REVISION'; end if;
  return prize_draw_register(p_id,p_hash,p_phone,p_answers);
end;
$$;
revoke all on function prize_draw_register_current(uuid,text,text,jsonb,integer) from public,anon,authenticated;
grant execute on function prize_draw_register_current(uuid,text,text,jsonb,integer) to service_role;
