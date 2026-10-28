-- ============================================================
--  FONT TỰ TẢI LÊN (font thương hiệu của khách)
--  Chỉ nhận TTF/OTF (librsvg/pango không đọc được WOFF/WOFF2).
--  File nằm trong bucket private `form-fonts`; server cấp signed URL ngắn hạn.
--  Chạy 1 lần trong Supabase SQL Editor (an toàn khi chạy lại).
-- ============================================================

create table if not exists public.custom_fonts (
  id           uuid primary key default gen_random_uuid(),
  owner_email  text not null,
  family       text not null,              -- tên family đọc từ bảng name của font
  weight       text not null default 'regular' check (weight in ('regular', 'bold')),
  storage_path text not null,
  file_name    text not null,
  size_bytes   integer not null default 0,
  has_vietnamese boolean not null default false,
  created_at   timestamptz not null default now()
);

create index if not exists idx_custom_fonts_owner on public.custom_fonts(owner_email, family);

-- Không mở cho anon/authenticated: API service-role là cửa duy nhất.
alter table public.custom_fonts enable row level security;
revoke all on public.custom_fonts from anon, authenticated;
