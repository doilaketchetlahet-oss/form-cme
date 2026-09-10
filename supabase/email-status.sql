-- Add QR email delivery tracking to an existing Form CME Supabase project.
-- Run this once in Supabase SQL editor.

alter table survey_responses
  add column if not exists email_status text check (email_status in ('pending', 'sent', 'failed')),
  add column if not exists email_sent_at timestamptz,
  add column if not exists email_last_attempt_at timestamptz,
  add column if not exists email_error text,
  add column if not exists resend_email_id text;

create index if not exists idx_survey_responses_email_status
  on survey_responses (survey_id, email_status);

notify pgrst, 'reload schema';
