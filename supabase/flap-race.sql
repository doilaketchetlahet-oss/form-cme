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
  last_seen_at  timestamptz not null default now(),
  created_at    timestamptz not null default now()
);

create index if not exists idx_flap_players_room on public.flap_players(room_id);
create index if not exists idx_flap_players_team on public.flap_players(room_id, team_id);
create index if not exists idx_flap_players_token on public.flap_players(token_hash);

-- Cho phép tra cứu nhanh theo token mà không lộ danh sách.
create unique index if not exists idx_flap_players_room_token on public.flap_players(room_id, token_hash);

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
--   Trả về tổng điểm mới của người chơi, hoặc null nếu bị từ chối.
-- ------------------------------------------------------------
create or replace function public.flap_add_score(
  p_player_id  uuid,
  p_token_hash text,
  p_delta      integer,
  p_max_delta  integer default 40,
  p_max_total  integer default 100000
)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_delta integer;
  v_new   integer;
begin
  v_delta := greatest(0, least(coalesce(p_delta, 0), p_max_delta));
  if v_delta = 0 then
    return null;
  end if;

  update public.flap_players
     set score        = least(score + v_delta, p_max_total),
         last_seen_at = now()
   where id = p_player_id
     and token_hash = p_token_hash
     and active = true
  returning score into v_new;

  return v_new;
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
  select * into v_room from public.flap_rooms where id = p_room_id;
  if not found then
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
