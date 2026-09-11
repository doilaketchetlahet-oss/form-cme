-- Per-event sender identity (From / Reply-to).
-- Run once in the Supabase SQL editor.

alter table events
  add column if not exists from_name text,
  add column if not exists from_email text,
  add column if not exists reply_to text;

notify pgrst, 'reload schema';
