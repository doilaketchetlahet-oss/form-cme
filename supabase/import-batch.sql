-- ============================================================
--  ĐỢT IMPORT (nhóm người được thêm từ cùng một file Excel/CSV)
--  Giúp lọc/chọn nhanh đúng nhóm vừa import thay vì dò từng tên.
--  Chạy 1 lần trong Supabase SQL Editor (an toàn khi chạy lại).
-- ============================================================

alter table public.survey_responses
  add column if not exists import_batch text;

create index if not exists idx_survey_responses_batch
  on public.survey_responses(survey_id, import_batch);
