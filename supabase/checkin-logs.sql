-- Add check-in event logs to an existing Form CME Supabase project.
-- Run this once in Supabase SQL editor.

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

alter table checkin_logs enable row level security;

drop policy if exists "public insert checkin logs" on checkin_logs;
create policy "public insert checkin logs" on checkin_logs
  for insert with check (true);

drop policy if exists "public read checkin logs" on checkin_logs;
create policy "public read checkin logs" on checkin_logs
  for select using (true);

notify pgrst, 'reload schema';
