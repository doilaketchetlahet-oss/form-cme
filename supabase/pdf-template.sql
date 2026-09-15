-- Invitation PDF template (background image + placed fields) per form.
-- Run once in the Supabase SQL editor.

alter table surveys
  add column if not exists pdf_template jsonb;

notify pgrst, 'reload schema';
