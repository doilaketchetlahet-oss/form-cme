-- Standalone SMTP mail merge. No links to surveys, responses or QR check-in.
begin;
create table if not exists public.mail_merge_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  name text not null,
  template jsonb not null,
  smtp_public jsonb not null,
  smtp_secret text not null,
  status text not null default 'draft' check (status in ('draft','running','paused','completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.mail_merge_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.mail_merge_campaigns(id) on delete cascade,
  source_row integer not null,
  email text not null,
  fields jsonb not null,
  status text not null check (status in ('pending','sending','sent','failed','uncertain','skipped')),
  attempt_id uuid,
  claimed_at timestamptz,
  sent_at timestamptz,
  message_id text,
  open_token_hash text,
  opened_at timestamptz,
  open_count integer not null default 0 check (open_count >= 0 and open_count <= 1),
  last_opened_at timestamptz,
  last_error text,
  unique(campaign_id, source_row)
);
alter table public.mail_merge_recipients add column if not exists open_token_hash text;
alter table public.mail_merge_recipients add column if not exists opened_at timestamptz;
alter table public.mail_merge_recipients add column if not exists open_count integer not null default 0;
alter table public.mail_merge_recipients add column if not exists last_opened_at timestamptz;
alter table public.mail_merge_campaigns add column if not exists previous_campaign_id uuid references public.mail_merge_campaigns(id) on delete set null;
update public.mail_merge_recipients set open_count=case when opened_at is null then 0 else 1 end where open_count is null or open_count not in (0,1);
alter table public.mail_merge_recipients drop constraint if exists mail_merge_recipients_open_count_check;
alter table public.mail_merge_recipients add constraint mail_merge_recipients_open_count_check check (open_count >= 0 and open_count <= 1);
create index if not exists mail_merge_owner_idx on public.mail_merge_campaigns(owner_email, created_at desc);
create index if not exists mail_merge_queue_idx on public.mail_merge_recipients(campaign_id, status, source_row);
alter table public.mail_merge_campaigns enable row level security;
alter table public.mail_merge_recipients enable row level security;
-- SMTP secrets and recipient data are accessible only via authorized server APIs.
revoke all on public.mail_merge_campaigns, public.mail_merge_recipients from anon, authenticated;
grant all on public.mail_merge_campaigns, public.mail_merge_recipients to service_role;

create or replace function public.save_mail_merge(
  p_id uuid, p_owner text, p_name text, p_template jsonb, p_smtp jsonb, p_secret text, p_rows jsonb
) returns uuid language plpgsql security definer set search_path=public as $$
declare c mail_merge_campaigns%rowtype;
begin
  select * into c from mail_merge_campaigns where id=p_id for update;
  if found then
    if c.owner_email <> p_owner then raise exception 'NOT_FOUND'; end if;
    if c.status <> 'draft' then raise exception 'LOCKED_CAMPAIGN'; end if;
    update mail_merge_campaigns set name=p_name, template=p_template, smtp_public=p_smtp,
      smtp_secret=p_secret, updated_at=now() where id=p_id;
    delete from mail_merge_recipients where campaign_id=p_id;
  else
    insert into mail_merge_campaigns(id,owner_email,name,template,smtp_public,smtp_secret)
      values(p_id,p_owner,p_name,p_template,p_smtp,p_secret);
  end if;
  insert into mail_merge_recipients(campaign_id,source_row,email,fields,status,last_error)
    select p_id, source_row,email,fields,status,last_error from jsonb_to_recordset(p_rows)
      as r(source_row integer,email text,fields jsonb,status text,last_error text);
  return p_id;
end; $$;

-- Each edited sending campaign becomes a separate draft. Old recipient IDs,
-- tracking tokens and SMTP results stay attached to their original campaign.
create or replace function public.revise_mail_merge(p_source uuid,p_owner text,p_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare c mail_merge_campaigns%rowtype; existing mail_merge_campaigns%rowtype;
begin
  if p_id is null or p_id=p_source then raise exception 'INVALID_ID'; end if;
  select * into c from mail_merge_campaigns where id=p_source and owner_email=p_owner for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- Retrying the same request must never make another batch or reset its rows.
  select * into existing from mail_merge_campaigns where id=p_id;
  if found then
    if existing.owner_email <> p_owner or existing.previous_campaign_id is distinct from p_source then raise exception 'NOT_FOUND'; end if;
    return p_id;
  end if;
  if c.status='running' or exists(select 1 from mail_merge_recipients where campaign_id=p_source and status='sending') then
    raise exception 'ACTIVE_DELIVERY';
  end if;
  insert into mail_merge_campaigns(id,owner_email,name,template,smtp_public,smtp_secret,previous_campaign_id)
    values(p_id,p_owner,left(c.name,145) || ' · Đợt mới',c.template,c.smtp_public,c.smtp_secret,p_source);
  insert into mail_merge_recipients(campaign_id,source_row,email,fields,status,last_error)
    select p_id,source_row,email,fields,case when status='skipped' then 'skipped' else 'pending' end,
      case when status='skipped' then last_error else null end
    from mail_merge_recipients where campaign_id=p_source;
  return p_id;
end; $$;

create or replace function public.control_mail_merge(p_id uuid,p_owner text,p_action text,p_recipient uuid default null)
returns text language plpgsql security definer set search_path=public as $$
declare c mail_merge_campaigns%rowtype;
begin
  select * into c from mail_merge_campaigns where id=p_id and owner_email=p_owner for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  -- Interrupted requests are ambiguous: SMTP may have accepted the message.
  update mail_merge_recipients set status='uncertain', last_error='Chưa xác nhận kết quả SMTP. Kiểm tra hộp thư trước khi gửi lại.'
    where campaign_id=p_id and status='sending' and claimed_at < now()-interval '3 minutes';
  if p_action='refresh' then
    if exists(select 1 from mail_merge_recipients where campaign_id=p_id and status='uncertain') then
      update mail_merge_campaigns set status='paused',updated_at=now() where id=p_id and status='running';
    end if;
  elsif p_action='pause' then
    update mail_merge_campaigns set status=case when status='running' then 'paused' else status end,updated_at=now() where id=p_id;
  elsif p_action='start' then
    if exists(select 1 from mail_merge_recipients where campaign_id=p_id and status='uncertain') then raise exception 'UNCERTAIN_DELIVERY'; end if;
    if not exists(select 1 from mail_merge_recipients where campaign_id=p_id and status in ('pending','sending')) then raise exception 'EMPTY_QUEUE'; end if;
    update mail_merge_campaigns set status='running',updated_at=now() where id=p_id;
  elsif p_action='retry_failed' then
    if c.status='running' then raise exception 'LOCKED_CAMPAIGN'; end if;
    update mail_merge_recipients set status='pending',last_error=null,attempt_id=null,claimed_at=null,
      open_token_hash=null,opened_at=null,open_count=0,last_opened_at=null where campaign_id=p_id and status='failed';
    update mail_merge_campaigns set status='paused',updated_at=now() where id=p_id;
  elsif p_action in ('resolve_sent','resolve_retry') then
    if c.status='running' then raise exception 'LOCKED_CAMPAIGN'; end if;
    update mail_merge_recipients set status=case when p_action='resolve_sent' then 'sent' else 'pending' end,
      sent_at=case when p_action='resolve_sent' then now() else null end, last_error=null,attempt_id=null,claimed_at=null,
      open_token_hash=case when p_action='resolve_sent' then open_token_hash else null end,
      opened_at=case when p_action='resolve_sent' then opened_at else null end,
      open_count=case when p_action='resolve_sent' then open_count else 0 end,
      last_opened_at=case when p_action='resolve_sent' then last_opened_at else null end
      where id=p_recipient and campaign_id=p_id and status='uncertain';
    if not found then raise exception 'NOT_FOUND'; end if;
  else raise exception 'INVALID_ACTION';
  end if;
  return (select status from mail_merge_campaigns where id=p_id);
end; $$;

create or replace function public.claim_mail_merge(p_id uuid,p_owner text)
returns jsonb language plpgsql security definer set search_path=public as $$
declare c mail_merge_campaigns%rowtype; r mail_merge_recipients%rowtype; open_token text;
begin
  select * into c from mail_merge_campaigns where id=p_id and owner_email=p_owner for update;
  if not found then raise exception 'NOT_FOUND'; end if;
  update mail_merge_recipients set status='uncertain',last_error='Chưa xác nhận kết quả SMTP. Kiểm tra hộp thư trước khi gửi lại.'
    where campaign_id=p_id and status='sending' and claimed_at < now()-interval '3 minutes';
  if exists(select 1 from mail_merge_recipients where campaign_id=p_id and status='uncertain') then
    update mail_merge_campaigns set status='paused',updated_at=now() where id=p_id;
    return null;
  end if;
  if c.status <> 'running' then return null; end if;
  -- A campaign has at most one in-flight SMTP message across tabs/devices.
  if exists(select 1 from mail_merge_recipients where campaign_id=p_id and status='sending') then return null; end if;
  select * into r from mail_merge_recipients where campaign_id=p_id and status='pending' order by source_row limit 1 for update;
  if not found then
    update mail_merge_campaigns set status='completed',updated_at=now() where id=p_id;
    return null;
  end if;
  -- Generate a fresh opaque token for this delivery attempt. Only its hash is
  -- stored; the raw token is returned to the server and embedded in the mail.
  if coalesce(c.template ->> 'trackingEnabled', 'true') <> 'false' then
    -- Two UUIDs provide 256 bits of entropy without requiring a pgcrypto
    -- gen_random_bytes implementation in local migration test runtimes.
    open_token := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
  end if;
  update mail_merge_recipients set status='sending',attempt_id=gen_random_uuid(),claimed_at=now(),
    open_token_hash=case when open_token is null then null else md5(open_token) end
    where id=r.id returning * into r;
  return jsonb_build_object('recipient',to_jsonb(r),'open_token',open_token,'template',c.template,'smtp_public',c.smtp_public,'smtp_secret',c.smtp_secret);
end; $$;

create or replace function public.record_mail_merge_open(p_recipient uuid,p_token_hash text)
returns boolean language plpgsql security definer set search_path=public as $$
begin
  if p_token_hash is null or p_token_hash !~ '^[0-9a-f]{32}$' then return false; end if;
  -- A mailbox may request the same image many times. Count one unique open per
  -- recipient while retaining the most recent timestamp for operator context.
  update mail_merge_recipients set
    opened_at=coalesce(opened_at, now()),
    open_count=case when opened_at is null then 1 else open_count end,
    last_opened_at=now()
    where id=p_recipient and status in ('sending','sent','uncertain') and open_token_hash=p_token_hash;
  return found;
end; $$;

create or replace function public.finish_mail_merge(p_id uuid,p_owner text,p_attempt uuid,p_status text,p_message text,p_error text)
returns boolean language plpgsql security definer set search_path=public as $$
declare campaign uuid;
begin
  if p_status not in ('sent','failed','uncertain') then raise exception 'INVALID_STATUS'; end if;
  select r.campaign_id into campaign from mail_merge_recipients r join mail_merge_campaigns c on c.id=r.campaign_id
    where r.id=p_id and c.owner_email=p_owner;
  if not found then raise exception 'NOT_FOUND'; end if;
  perform 1 from mail_merge_campaigns where id=campaign for update;
  update mail_merge_recipients set status=p_status,message_id=p_message,last_error=p_error,
    sent_at=case when p_status='sent' then now() else null end
    where id=p_id and attempt_id=p_attempt and status in ('sending','uncertain');
  if not found then return false; end if;
  if p_status <> 'sent' then update mail_merge_campaigns set status='paused',updated_at=now() where id=campaign; end if;
  return true;
end; $$;

revoke all on function public.save_mail_merge(uuid,text,text,jsonb,jsonb,text,jsonb),
  public.revise_mail_merge(uuid,text,uuid),
  public.control_mail_merge(uuid,text,text,uuid),public.claim_mail_merge(uuid,text),
  public.finish_mail_merge(uuid,text,uuid,text,text,text),public.record_mail_merge_open(uuid,text) from public,anon,authenticated;
grant execute on function public.save_mail_merge(uuid,text,text,jsonb,jsonb,text,jsonb),
  public.revise_mail_merge(uuid,text,uuid),
  public.control_mail_merge(uuid,text,text,uuid),public.claim_mail_merge(uuid,text),
  public.finish_mail_merge(uuid,text,uuid,text,text,text),public.record_mail_merge_open(uuid,text) to service_role;
notify pgrst,'reload schema';
commit;
