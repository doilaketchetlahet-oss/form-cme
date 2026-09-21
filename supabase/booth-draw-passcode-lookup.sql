-- Let a public user reopen their active booth project using only its passcode.
-- Existing rows remain null and are upgraded after their passcode is verified.

alter table booth_draw_sessions add column if not exists passcode_lookup text;

create unique index if not exists idx_booth_sessions_passcode_lookup
  on booth_draw_sessions(passcode_lookup)
  where passcode_lookup is not null;
