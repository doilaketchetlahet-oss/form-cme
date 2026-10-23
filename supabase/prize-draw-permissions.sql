-- Explicit opt-in, including owners. Existing owner-only admin_members RLS
-- protects this column from self-grants by other roles. Safe to run again.
alter table public.admin_members
  add column if not exists prize_draw_enabled boolean not null default false;

notify pgrst, 'reload schema';
