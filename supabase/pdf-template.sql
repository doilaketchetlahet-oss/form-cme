-- Invitation PDF template (background image + placed fields) per form.
-- Run once in the Supabase SQL editor.

alter table surveys
  add column if not exists pdf_template jsonb,
  add column if not exists pdf_attach_email boolean not null default false;

notify pgrst, 'reload schema';
