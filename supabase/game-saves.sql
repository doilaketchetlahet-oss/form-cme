-- ============================================================
--  GAME SAVES — đồng bộ workspace/state game theo tài khoản (P3)
--  Chạy trong Supabase Dashboard > SQL Editor (sau games.sql)
-- ============================================================

-- Mỗi user có 1 "bản lưu" state studio (workspaces, projects, combos,
-- assets, themes, settings...). Ảnh upload đã được thay bằng URL Storage
-- trước khi lưu nên blob nhẹ.
create table if not exists public.game_saves (
  user_id     uuid primary key references auth.users(id) on delete cascade,
  data        jsonb not null default '{}'::jsonb,
  rev         integer not null default 0,
  updated_at  timestamptz default now()
);

alter table public.game_saves enable row level security;

drop policy if exists "game_saves_self_read" on public.game_saves;
create policy "game_saves_self_read"
  on public.game_saves for select
  using (auth.uid() = user_id);

drop policy if exists "game_saves_self_insert" on public.game_saves;
create policy "game_saves_self_insert"
  on public.game_saves for insert
  with check (auth.uid() = user_id);

drop policy if exists "game_saves_self_update" on public.game_saves;
create policy "game_saves_self_update"
  on public.game_saves for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- ============================================================
--  STORAGE cho ảnh/nhạc/video upload
--  Bucket "game-assets" được API tự tạo (public) ở lần upload đầu.
--  Upload đi qua service_role nên không cần policy cho anon.
--  Nếu muốn tạo tay: Storage > New bucket > tên "game-assets" > Public.
-- ============================================================
