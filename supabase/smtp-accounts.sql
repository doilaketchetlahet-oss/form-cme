-- ============================================================
--  KHO TÀI KHOẢN SMTP (mỗi khách/sự kiện dùng hộp thư riêng)
--  Ví dụ Microsoft 365: smtp.office365.com:587, STARTTLS.
--
--  Mật khẩu KHÔNG lưu dạng thô: server mã hoá AES-256-GCM bằng
--  MAIL_MERGE_ENCRYPTION_KEY (hoặc SUPABASE_SERVICE_ROLE_KEY dự phòng),
--  gắn với owner_email nên không thể copy sang tài khoản khác.
--
--  Chạy 1 lần trong Supabase SQL Editor (an toàn khi chạy lại).
-- ============================================================

create table if not exists public.smtp_accounts (
  id          uuid primary key default gen_random_uuid(),
  owner_email text not null,
  name        text not null,
  config      jsonb not null,
  secret      text not null,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_smtp_accounts_owner on public.smtp_accounts(owner_email);

-- Mỗi form có thể chọn một tài khoản SMTP riêng.
alter table public.surveys
  add column if not exists smtp_account_id uuid
  references public.smtp_accounts(id) on delete set null;

-- Không mở cho anon: toàn bộ truy cập đi qua API service_role.
alter table public.smtp_accounts enable row level security;

drop policy if exists "smtp accounts admin read" on public.smtp_accounts;
create policy "smtp accounts admin read" on public.smtp_accounts
  for select to authenticated using (is_admin_member());

drop policy if exists "smtp accounts admin write" on public.smtp_accounts;
create policy "smtp accounts admin write" on public.smtp_accounts
  for all to authenticated using (can_manage_forms()) with check (can_manage_forms());
