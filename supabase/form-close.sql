-- Close a form manually or on a schedule (no more responses).
-- Run once in the Supabase SQL editor.

alter table surveys
  add column if not exists is_closed boolean not null default false,
  add column if not exists close_at timestamptz;

notify pgrst, 'reload schema';
