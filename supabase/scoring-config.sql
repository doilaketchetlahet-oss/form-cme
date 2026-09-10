-- Add poster scoring configuration to existing Form CME projects.
-- Run once in Supabase SQL editor before saving scoring settings in dashboard.

alter table surveys
add column if not exists scoring_config jsonb;
