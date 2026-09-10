-- Add PayOS payment support to Form CME.
-- Run once in Supabase SQL editor before enabling payment in the dashboard.

alter table surveys
  add column if not exists payment_config jsonb;

alter table survey_responses
  add column if not exists payment_status text not null default 'not_required'
    check (payment_status in ('not_required', 'pending', 'paid', 'cancelled', 'expired', 'failed')),
  add column if not exists payment_amount integer,
  add column if not exists payment_order_code bigint,
  add column if not exists payment_link_id text,
  add column if not exists payment_checkout_url text,
  add column if not exists payment_reference text,
  add column if not exists payment_payer_name text,
  add column if not exists payment_payer_bank text,
  add column if not exists payment_payer_account text,
  add column if not exists payment_transaction_datetime text,
  add column if not exists paid_at timestamptz,
  add column if not exists payment_raw jsonb,
  add column if not exists payment_error text;

create unique index if not exists uq_survey_responses_payment_order_code
  on survey_responses(payment_order_code)
  where payment_order_code is not null;

create index if not exists idx_survey_responses_payment_status
  on survey_responses(survey_id, payment_status);
