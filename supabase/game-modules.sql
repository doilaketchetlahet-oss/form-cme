-- ============================================================
--  GAMES — catalog module + gói + quyền sở hữu (P2)
--  Chạy trong Supabase Dashboard > SQL Editor (sau auth.sql)
-- ============================================================

-- ─────────────────────────────────────────────
-- BẢNG: modules (catalog 18 game)
-- ─────────────────────────────────────────────
create table if not exists public.modules (
  id          text primary key,
  name        text not null,
  icon        text,
  tagline     text,
  category    text,
  accent      text,
  is_free     boolean not null default false,
  price       integer not null default 0,          -- đơn giá mua lẻ (VND)
  sort        integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz default now()
);

-- ─────────────────────────────────────────────
-- BẢNG: plans (gói) + plan_modules (gói gồm game nào)
-- ─────────────────────────────────────────────
create table if not exists public.plans (
  id           text primary key,
  name         text not null,
  price        integer not null default 0,          -- giá / kỳ (VND)
  term_months  integer not null default 12,
  sort         integer not null default 0,
  is_active    boolean not null default true,
  created_at   timestamptz default now()
);

create table if not exists public.plan_modules (
  plan_id    text not null references public.plans(id) on delete cascade,
  module_id  text not null references public.modules(id) on delete cascade,
  primary key (plan_id, module_id)
);

-- ─────────────────────────────────────────────
-- BẢNG: entitlements (quyền mở 1 module cho 1 user)
--   source: free | plan | purchase | grant
--   expires_at = null  -> vĩnh viễn
-- ─────────────────────────────────────────────
create table if not exists public.entitlements (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  module_id   text not null references public.modules(id) on delete cascade,
  source      text not null default 'purchase' check (source in ('free', 'plan', 'purchase', 'grant')),
  order_id    uuid,
  expires_at  timestamptz,
  created_at  timestamptz default now(),
  unique (user_id, module_id)
);

create index if not exists idx_entitlements_user on public.entitlements(user_id);

-- ─────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────
alter table public.modules       enable row level security;
alter table public.plans         enable row level security;
alter table public.plan_modules  enable row level security;
alter table public.entitlements  enable row level security;

-- Catalog/gói: ai cũng đọc được bản đang hoạt động.
drop policy if exists "modules_public_read" on public.modules;
create policy "modules_public_read"
  on public.modules for select using (is_active = true);

drop policy if exists "plans_public_read" on public.plans;
create policy "plans_public_read"
  on public.plans for select using (is_active = true);

drop policy if exists "plan_modules_public_read" on public.plan_modules;
create policy "plan_modules_public_read"
  on public.plan_modules for select using (true);

-- Quyền sở hữu: chỉ đọc của chính mình. Ghi qua service_role (API/webhook).
drop policy if exists "entitlements_self_read" on public.entitlements;
create policy "entitlements_self_read"
  on public.entitlements for select using (auth.uid() = user_id);

-- ─────────────────────────────────────────────
-- SEED: 18 module (giá & free có thể sửa trong /admin sau)
-- ─────────────────────────────────────────────
insert into public.modules (id, name, icon, tagline, category, accent, is_free, sort) values
('balloon', 'Balloon Pop', '🎈', 'Tap the balloons before they float away!', 'casual', 'from-sky-400 to-cyan-400', true, 1),
('bridgedash', 'Bridge Dash', '🌉', 'Drag planks, jump for treats, keep the runner going!', 'platformer', 'from-amber-300 via-sky-300 to-emerald-300', false, 2),
('catchdrop', 'Hứng Đồ', '🧺', 'Dang tay hứng vitamin, né đồ xấu — webcam!', 'ar', 'from-emerald-400 via-teal-400 to-sky-500', false, 3),
('connect', 'Nối Ô Chữ', '🔗', 'Kéo nối từ bên trái với từ bên phải.', 'puzzle', 'from-cyan-400 to-blue-500', false, 4),
('decodeletters', 'Giải mã chữ cái', '🔤', 'Chọn dòng, trả lời quiz, mở 1 ô ảnh bí mật.', 'quiz', 'from-amber-400 to-orange-500', false, 5),
('handslice', 'Chém Hoa Quả', '🍉', 'Vung tay chém hoa quả bằng webcam!', 'ar', 'from-lime-400 to-emerald-500', false, 6),
('hidden', 'Hidden Object', '🔍', 'Find every hidden item before the clock stops.', 'hidden', 'from-rose-400 to-red-500', false, 7),
('jigsaw', 'Ghép Tranh', '🧩', 'Kéo mảnh từ khay ghép vào đúng chỗ trên bảng.', 'puzzle', 'from-violet-400 to-indigo-500', false, 8),
('picword', 'Đuổi hình bắt chữ', '🖼️', 'Nhìn hình, đoán từ — gõ trên bàn phím ảo.', 'quiz', 'from-amber-400 to-pink-500', false, 9),
('pulsecourier', 'Pulse Courier', '💠', 'Chọn đúng tuyến, xuyên tầng cản, giao năng lượng đến đích!', 'arcade', 'from-cyan-400 via-blue-500 to-violet-600', false, 10),
('quiz', 'Quiz Board', '❓', 'Câu hỏi trắc nghiệm tương tác trên tivi cảm ứng', 'quiz', 'from-amber-400 to-orange-500', true, 11),
('spotdiff', 'Spot the Difference', '👀', 'Hai bức ảnh — tìm hết điểm khác biệt trước khi hết giờ!', 'puzzle', 'from-violet-400 to-fuchsia-500', false, 12),
('trucxanh', 'Trúc Xanh', '🎴', 'Lật cặp thẻ, mở dần ảnh ẩn phía dưới.', 'memory', 'from-green-400 to-emerald-500', false, 13),
('unlock', 'Mở Khoá Ô Chữ', '🔓', 'Trả lời câu hỏi để mở ô và lộ bức tranh ẩn.', 'quiz', 'from-purple-500 to-fuchsia-500', false, 14),
('vaccineshot', 'Bắn Vắc-xin', '💉', 'Kéo tay như dây ná, bắn vắc-xin diệt virus!', 'ar', 'from-sky-400 to-blue-500', false, 15),
('virusblock', 'Chặn Virus 3D', '🛡️', 'Vẽ vòng tay để chặn virus bay tới!', 'ar', 'from-emerald-400 to-teal-600', false, 16),
('wheel', 'Lucky Wheel', '🎡', 'Spin to win prizes, pick a winner, or choose a challenge.', 'wheel', 'from-violet-400 to-indigo-500', false, 17),
('wordsearch', 'Tìm chữ bí mật', '🔍', 'Tìm từ ẩn trong bảng chữ cái.', 'puzzle', 'from-teal-400 to-cyan-600', false, 18)
on conflict (id) do update set
  name = excluded.name,
  icon = excluded.icon,
  tagline = excluded.tagline,
  category = excluded.category,
  accent = excluded.accent,
  sort = excluded.sort;

-- Giá mua lẻ (placeholder — chỉnh trong /admin)
update public.modules set price = 200000 where id in ('trucxanh','connect','unlock','wordsearch','picword','decodeletters','wheel');
update public.modules set price = 250000 where id in ('jigsaw','spotdiff','hidden');
update public.modules set price = 300000 where id in ('handslice','catchdrop','vaccineshot','virusblock','bridgedash','pulsecourier');

-- ─────────────────────────────────────────────
-- SEED: gói
-- ─────────────────────────────────────────────
insert into public.plans (id, name, price, term_months, sort) values
('free',     'Free',     0,       0,  1),
('standard', 'Standard', 990000,  12, 2),
('pro',      'Pro',      1990000, 12, 3),
('premium',  'Premium',  2990000, 12, 4)
on conflict (id) do update set
  name = excluded.name, price = excluded.price,
  term_months = excluded.term_months, sort = excluded.sort;

-- plan_modules
insert into public.plan_modules (plan_id, module_id) values
('free', 'quiz'), ('free', 'balloon'),
('standard','quiz'), ('standard','balloon'), ('standard','trucxanh'), ('standard','connect'),
('standard','unlock'), ('standard','wordsearch'), ('standard','picword'), ('standard','decodeletters'),
('standard','wheel'),
('pro','quiz'), ('pro','balloon'), ('pro','trucxanh'), ('pro','connect'), ('pro','unlock'),
('pro','wordsearch'), ('pro','picword'), ('pro','decodeletters'), ('pro','wheel'),
('pro','jigsaw'), ('pro','spotdiff'), ('pro','hidden'), ('pro','handslice'), ('pro','catchdrop'),
('pro','vaccineshot'), ('pro','virusblock'),
('premium','quiz'), ('premium','balloon'), ('premium','trucxanh'), ('premium','connect'),
('premium','unlock'), ('premium','wordsearch'), ('premium','picword'), ('premium','decodeletters'),
('premium','wheel'), ('premium','jigsaw'), ('premium','spotdiff'), ('premium','hidden'),
('premium','handslice'), ('premium','catchdrop'), ('premium','vaccineshot'), ('premium','virusblock'),
('premium','bridgedash'), ('premium','pulsecourier')
on conflict (plan_id, module_id) do nothing;
