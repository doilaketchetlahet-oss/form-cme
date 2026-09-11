-- Email tracking, scheduled campaigns and retry support for Form CME.
-- Run once in the Supabase SQL editor.

-- Per-response delivery tracking (in addition to email-status.sql)
alter table survey_responses
  add column if not exists email_delivered_at timestamptz,
  add column if not exists email_opened_at timestamptz,
  add column if not exists email_bounced_at timestamptz,
  add column if not exists email_last_event text,
  add column if not exists email_provider text;

-- Per-form provider override (null = use global EMAIL_PROVIDER env)
alter table surveys
  add column if not exists email_provider text check (email_provider in ('resend', 'smtp'));

-- Webhook event log from the mail provider
create table if not exists email_events (
  id uuid primary key default gen_random_uuid(),
  response_id uuid,
  provider_message_id text,
  event_type text not null,
  payload jsonb,
  created_at timestamptz default now()
);

create index if not exists idx_email_events_message
  on email_events (provider_message_id);
create index if not exists idx_email_events_response
  on email_events (response_id, created_at desc);

-- Scheduled / batch email campaigns
create table if not exists email_campaigns (
  id uuid primary key default gen_random_uuid(),
  owner_email text,
  name text not null,
  event_id uuid,
  survey_id uuid,
  email_subject text,
  email_body text,
  filter jsonb not null default '{}'::jsonb,
  send_at timestamptz,
  status text not null default 'draft'
    check (status in ('draft', 'scheduled', 'sending', 'sent', 'failed', 'cancelled')),
  total int not null default 0,
  sent int not null default 0,
  failed int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index if not exists idx_email_campaigns_status
  on email_campaigns (status, send_at);

-- One job per recipient
create table if not exists email_jobs (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid references email_campaigns(id) on delete cascade,
  response_id uuid,
  status text not null default 'pending'
    check (status in ('pending', 'sent', 'failed', 'skipped')),
  attempts int not null default 0,
  last_error text,
  sent_at timestamptz,
  created_at timestamptz default now()
);

create index if not exists idx_email_jobs_campaign
  on email_jobs (campaign_id, status);

notify pgrst, 'reload schema';
