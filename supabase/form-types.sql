-- Add form types so registration/check-in, poster scoring, and feedback forms
-- can have separate behavior in the app.
-- Run once in Supabase SQL editor.

alter table surveys
add column if not exists form_type text not null default 'registration';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'surveys_form_type_check'
  ) then
    alter table surveys
    add constraint surveys_form_type_check
    check (form_type in ('registration', 'poster_scoring', 'feedback'));
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'surveys'
      and column_name = 'scoring_config'
  ) then
    execute $sql$
      update surveys
      set form_type = 'poster_scoring'
      where form_type = 'registration'
        and scoring_config ->> 'enabled' = 'true'
    $sql$;
  end if;
end $$;
