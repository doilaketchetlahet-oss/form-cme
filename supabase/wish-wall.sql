-- ============================================================
--  WISH WALL — "Trao lời chúc, nhận yêu thương"
--  Bảng chọn vật phẩm -> gõ/vẽ lời chúc -> gửi. Lời chúc bay ra khỏi
--  màn hình tablet, được tấm khiên trên màn LED hứng lấy rồi trôi nhẹ.
--
--  Postgres là sổ cái, API là trọng tài, Supabase Realtime Broadcast là
--  kênh hiển thị cho màn LED. Mất mạng thì LED tự đồng bộ lại từ API.
--
--  Chạy 1 lần trong Supabase SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- BẢNG: wish_events (chương trình do admin tạo)
--   settings: jsonb cấu hình giao diện (theme, biểu tượng, khiên, hình ghép)
-- ------------------------------------------------------------
create table if not exists public.wish_events (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,
  title         text not null default 'Trao lời chúc, nhận yêu thương',
  subtitle      text not null default '',
  status        text not null default 'live' check (status in ('draft', 'live', 'paused', 'ended')),
  moderation    boolean not null default false,
  settings      jsonb not null default '{}'::jsonb,
  owner_email   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_wish_events_code on public.wish_events(code);

-- ------------------------------------------------------------
-- BẢNG: wishes (mỗi lời chúc)
--   kind     : symbol (vật phẩm) | text (chữ) | drawing (nét vẽ)
--   drawing  : { strokes: [{ c, w, p: [x,y,x,y,...] }] } — toạ độ 0..1
--   status   : pending | approved | rejected | hidden (kiểm duyệt)
--   edge     : cạnh tablet để biết lời chúc bay vào từ đâu trên màn LED
--   ip_hash  : hash IP chỉ để chống spam, không lưu IP gốc
-- ------------------------------------------------------------
create table if not exists public.wishes (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.wish_events(id) on delete cascade,
  kind          text not null default 'symbol' check (kind in ('symbol', 'text', 'drawing')),
  symbol        text not null default '❤️',
  content       text not null default '',
  drawing       jsonb,
  color         text not null default '#38bdf8',
  nickname      text not null default '',
  edge          text not null default 'center' check (edge in ('left', 'right', 'center')),
  status        text not null default 'approved' check (status in ('pending', 'approved', 'rejected', 'hidden')),
  ip_hash       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_wishes_event_status on public.wishes(event_id, status, created_at);
create index if not exists idx_wishes_event_created on public.wishes(event_id, created_at);
create index if not exists idx_wishes_ip on public.wishes(ip_hash, created_at);

-- ------------------------------------------------------------
-- RLS: KHÔNG mở cho anon. Mọi truy cập đi qua API service_role.
-- (Tablet/LED là khách công khai nên không được đọc thẳng bảng.)
-- ------------------------------------------------------------
alter table public.wish_events enable row level security;
alter table public.wishes      enable row level security;

drop policy if exists "wish events admin read" on public.wish_events;
create policy "wish events admin read" on public.wish_events
  for select to authenticated using (is_admin_member());

drop policy if exists "wish events admin write" on public.wish_events;
create policy "wish events admin write" on public.wish_events
  for all to authenticated using (can_manage_forms()) with check (can_manage_forms());

drop policy if exists "wishes admin read" on public.wishes;
create policy "wishes admin read" on public.wishes
  for select to authenticated using (is_admin_member());

drop policy if exists "wishes admin write" on public.wishes;
create policy "wishes admin write" on public.wishes
  for all to authenticated using (can_manage_forms()) with check (can_manage_forms());

-- ------------------------------------------------------------
-- STORAGE: bucket công khai cho ảnh khiên / hình ghép / nền do admin tải lên.
-- ------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('wish-assets', 'wish-assets', true, 6000000,
        array['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'])
on conflict (id) do nothing;

notify pgrst, 'reload schema';
