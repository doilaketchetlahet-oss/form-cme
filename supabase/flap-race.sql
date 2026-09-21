-- ============================================================
--  FLAP RACE — "Lắc điện thoại, Đại bàng tung cánh"
--  Điện thoại đếm lắc -> API là trọng tài -> Postgres là sổ cái ->
--  Supabase Realtime Broadcast là kênh hiển thị màn LED.
--
--  Chạy 1 lần trong Supabase SQL Editor.
-- ============================================================

create extension if not exists pgcrypto;

-- ------------------------------------------------------------
-- BẢNG: flap_rooms (phòng chơi do MC tạo)
-- ------------------------------------------------------------
create table if not exists public.flap_rooms (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique,                 -- mã ngắn để vào phòng / QR
  title         text not null default 'Lắc điện thoại - Đại bàng tung cánh',
  status        text not null default 'lobby' check (status in ('lobby', 'countdown', 'running', 'paused', 'finished')),
  score_mode    text not null default 'average' check (score_mode in ('total', 'average')),
  teams         jsonb not null default '[]'::jsonb,   -- [{ id, name, color, capacity }]
  teams_locked  boolean not null default false,
  track_length  integer not null default 1000,        -- số điểm để về đích
  duration_sec  integer not null default 60,          -- thời lượng mỗi lượt
  started_at    timestamptz,
  ended_at      timestamptz,
  round         integer not null default 1,
  owner_email   text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists idx_flap_rooms_code on public.flap_rooms(code);

-- ------------------------------------------------------------
-- BẢNG: flap_players (mỗi điện thoại tham gia)
--   token_hash: chỉ lưu hash của session token, không lưu token gốc.
-- ------------------------------------------------------------
create table if not exists public.flap_players (
  id            uuid primary key default gen_random_uuid(),
  room_id       uuid not null references public.flap_rooms(id) on delete cascade,
  team_id       text not null,
  nickname      text,
  token_hash    text not null,
  score         integer not null default 0,           -- điểm đã chốt trong sổ cái
  sensor_ok     boolean not null default true,        -- false = chơi bằng chạm dự phòng
  active        boolean not null default true,
  rate_tokens   numeric not null default 12,          -- token bucket chống flood request
  rate_refilled_at timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists idx_flap_players_room on public.flap_players(room_id);
create index if not exists idx_flap_players_team on public.flap_players(room_id, team_id);
create index if not exists idx_flap_players_token on public.flap_players(token_hash);

-- Cho phép tra cứu nhanh theo token mà không lộ danh sách.
create unique index if not exists idx_flap_players_room_token on public.flap_players(room_id, token_hash);

-- Tương thích phòng chơi đã tạo từ phiên bản đầu tiên của game.
alter table public.flap_players
  add column if not exists rate_tokens numeric not null default 12,
  add column if not exists rate_refilled_at timestamptz not null default now();

-- ------------------------------------------------------------
-- BẢNG: flap_rounds (lịch sử từng lượt chơi)
-- ------------------------------------------------------------
create table if not exists public.flap_rounds (
  id           uuid primary key default gen_random_uuid(),
  room_id      uuid not null references public.flap_rooms(id) on delete cascade,
  round        integer not null default 1,
  score_mode   text not null default 'average',
  track_length integer not null default 1000,
  results      jsonb not null default '[]'::jsonb,    -- [{ team_id, name, total, players, average }]
  winner_team  text,
  started_at   timestamptz,
  ended_at     timestamptz not null default now()
);

create index if not exists idx_flap_rounds_room on public.flap_rounds(room_id, round desc);

-- ------------------------------------------------------------
-- RLS: KHÔNG mở cho anon. Mọi truy cập đi qua API service_role.
-- ------------------------------------------------------------
alter table public.flap_rooms   enable row level security;
alter table public.flap_players enable row level security;
alter table public.flap_rounds  enable row level security;

drop policy if exists "flap rooms admin read" on public.flap_rooms;
create policy "flap rooms admin read" on public.flap_rooms
  for select to authenticated using (is_admin_member());

drop policy if exists "flap rooms admin write" on public.flap_rooms;
create policy "flap rooms admin write" on public.flap_rooms
  for all to authenticated using (can_manage_forms()) with check (can_manage_forms());

drop policy if exists "flap players admin read" on public.flap_players;
create policy "flap players admin read" on public.flap_players
  for select to authenticated using (is_admin_member());

drop policy if exists "flap rounds admin read" on public.flap_rounds;
create policy "flap rounds admin read" on public.flap_rounds
  for select to authenticated using (is_admin_member());

-- ------------------------------------------------------------
-- RPC: cộng điểm có trần (rate limit) — chống gian lận.
--   Khoá hàng người chơi và dùng token bucket ngay trong transaction, nên nhiều
--   request song song cũng không thể cộng vượt tốc độ quy định.
-- ------------------------------------------------------------
drop function if exists public.flap_add_score(uuid, text, integer, integer, integer);
drop function if exists public.flap_add_score(uuid, text, integer, integer, integer, integer);

create or replace function public.flap_add_score(
  p_player_id  uuid,
  p_room_id    uuid,
  p_token_hash text,
  p_delta      integer,
  p_max_delta  integer default 40,
  p_max_total  integer default 100000,
  p_max_per_second integer default 12
)
returns table(score integer, accepted_delta integer)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta          integer;
  v_new            integer;
  v_score          integer;
  v_tokens         numeric;
  v_refilled_at    timestamptz;
  v_max_per_second integer;
  v_room_status    text;
  v_started_at     timestamptz;
  v_duration_sec   integer;
begin
  -- Khoá phòng trước, để không có điểm nào lọt qua sau khi MC/hệ thống kết
  -- thúc vòng. Sau đó mới khoá hàng người chơi để xử lý token bucket.
  select r.status, r.started_at, r.duration_sec
    into v_room_status, v_started_at, v_duration_sec
    from public.flap_rooms r
   where r.id = p_room_id
   for update;

  if not found
     or v_room_status <> 'running'
     or (v_started_at is not null and now() >= v_started_at + make_interval(secs => v_duration_sec)) then
    return;
  end if;

  select p.score, p.rate_tokens, p.rate_refilled_at
    into v_score, v_tokens, v_refilled_at
    from public.flap_players p
   where p.id = p_player_id
     and p.room_id = p_room_id
     and p.token_hash = p_token_hash
     and p.active = true
   for update;

  if not found then
    return;
  end if;

  v_max_per_second := greatest(1, coalesce(p_max_per_second, 12));
  v_tokens := least(
    v_max_per_second::numeric,
    greatest(0, coalesce(v_tokens, v_max_per_second))
      + greatest(0, extract(epoch from now() - coalesce(v_refilled_at, now()))) * v_max_per_second
  );
  v_delta := least(
    greatest(0, coalesce(p_delta, 0)),
    greatest(0, coalesce(p_max_delta, 40)),
    floor(v_tokens)::integer,
    greatest(0, coalesce(p_max_total, 100000) - v_score)
  );

  update public.flap_players p
     set score        = least(p.score + v_delta, p_max_total),
         rate_tokens  = greatest(0, v_tokens - v_delta),
         rate_refilled_at = now(),
         last_seen_at = now()
   where p.id = p_player_id
     and p.token_hash = p_token_hash
     and p.active = true
  returning p.score into v_new;

  return query select v_new as score, v_delta as accepted_delta;
end;
$$;

-- ------------------------------------------------------------
-- RPC: chốt lượt chơi — ghi lịch sử + reset điểm người chơi.
-- ------------------------------------------------------------
create or replace function public.flap_finish_round(p_room_id uuid, p_reset boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_room    public.flap_rooms;
  v_results jsonb;
  v_winner  text;
  v_round   integer;
begin
  -- Khoá phòng để hai request kết thúc cùng lúc không ghi trùng lịch sử vòng.
  select * into v_room from public.flap_rooms where id = p_room_id for update;
  if not found then
    return null;
  end if;

  -- Một vòng chỉ được chốt khi đang chạy/tạm dừng. Request tới muộn sau khi
  -- đồng hồ hết giờ sẽ nhận null thay vì tạo thêm một bản ghi kết quả rỗng.
  if v_room.status not in ('running', 'paused') then
    return null;
  end if;

  select coalesce(jsonb_agg(row order by row.total desc), '[]'::jsonb)
    into v_results
    from (
      select jsonb_build_object(
               'team_id',  p.team_id,
               'total',    sum(p.score),
               'players',  count(*),
               'average',  round(avg(p.score)::numeric, 1)
             ) as row
        from public.flap_players p
       where p.room_id = p_room_id
       group by p.team_id
    ) t;

  -- Xếp theo chế độ tính điểm hiện tại của phòng.
  if v_room.score_mode = 'average' then
    select r->>'team_id'
      into v_winner
      from jsonb_array_elements(v_results) r
     order by (r->>'average')::numeric desc
     limit 1;
  else
    select r->>'team_id'
      into v_winner
      from jsonb_array_elements(v_results) r
     order by (r->>'total')::numeric desc
     limit 1;
  end if;

  v_round := v_room.round;

  insert into public.flap_rounds (room_id, round, score_mode, track_length, results, winner_team, started_at, ended_at)
  values (p_room_id, v_round, v_room.score_mode, v_room.track_length, v_results, v_winner, v_room.started_at, now());

  if p_reset then
    update public.flap_players set score = 0 where room_id = p_room_id;
    update public.flap_rooms
       set status = 'lobby', ended_at = now(), round = v_round + 1, started_at = null, updated_at = now()
     where id = p_room_id;
  else
    update public.flap_rooms
       set status = 'finished', ended_at = now(), updated_at = now()
     where id = p_room_id;
  end if;

  return jsonb_build_object('round', v_round, 'winner', v_winner, 'results', v_results);
end;
$$;

notify pgrst, 'reload schema';
