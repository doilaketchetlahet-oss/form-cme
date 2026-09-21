import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildStandings,
  clampRoomSettings,
  findRoomByCode,
  generateRoomCode,
  loadPlayers,
  normalizeTeams,
  TEAM_PALETTE,
  type FlapRoom,
} from "@/lib/flap/race";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ code: string }> };

type FlapStateEvent = {
  type: "state";
  status: FlapRoom["status"];
  startedAt?: string | null;
  round?: number;
};

/** Broadcast chỉ giúp màn LED cập nhật ngay; API polling vẫn là nguồn dữ liệu chuẩn. */
async function broadcastRoomEvent(admin: SupabaseClient, roomCode: string, event: FlapStateEvent) {
  const channel = admin.channel(`flap:${roomCode}`);
  try {
    await channel.send({ type: "broadcast", event: "flap", payload: event });
  } catch {
    // Mất Broadcast không được làm hỏng thao tác của MC.
  } finally {
    void admin.removeChannel(channel);
  }
}

/** Chốt vòng khi đồng hồ hết giờ, kể cả khi MC không mở trang điều khiển. */
async function finishExpiredRoom(admin: SupabaseClient, room: FlapRoom): Promise<FlapRoom> {
  const startedAt = room.started_at ? Date.parse(room.started_at) : Number.NaN;
  const expired = room.status === "running" && Number.isFinite(startedAt) && Date.now() >= startedAt + room.duration_sec * 1000;
  if (!expired) return room;

  const { error } = await admin.rpc("flap_finish_round", {
    p_room_id: room.id,
    p_reset: false,
  });
  if (error) return room;

  const refreshed = await findRoomByCode(admin, room.code);
  if (!refreshed) return room;
  await broadcastRoomEvent(admin, refreshed.code, {
    type: "state",
    status: refreshed.status,
    startedAt: refreshed.started_at,
    round: refreshed.round,
  });
  return refreshed;
}

/** Admin/Owner token check for writing actions. */
async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anonKey) return false;
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData } = await supabase.auth.getUser(token);
  const email = userData.user?.email?.trim().toLowerCase();
  if (!email) return false;
  const { data: member } = await supabase
    .from("admin_members")
    .select("role, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();
  return member?.role === "owner" || member?.role === "admin";
}

/** GET /api/flap/[code] — trạng thái phòng + bảng xếp hạng (LED/điện thoại đọc). */
export async function GET(_request: NextRequest, context: RouteContext) {
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { code } = await context.params;
  const foundRoom = await findRoomByCode(admin, code);
  if (!foundRoom) return NextResponse.json({ error: "not_found" }, { status: 404 });
  const room = await finishExpiredRoom(admin, foundRoom);

  const players = await loadPlayers(admin, room.id);
  const standings = buildStandings(room.teams, players, room.score_mode, room.track_length);

  return NextResponse.json({
    room: {
      id: room.id,
      code: room.code,
      title: room.title,
      status: room.status,
      score_mode: room.score_mode,
      teams: room.teams,
      teams_locked: room.teams_locked,
      track_length: room.track_length,
      duration_sec: room.duration_sec,
      started_at: room.started_at,
      ended_at: room.ended_at,
      round: room.round,
    },
    standings,
    playerCount: players.length,
  });
}

/** POST /api/flap/[code] — tạo phòng (nếu chưa có) hoặc cập nhật/điều khiển. */
export async function POST(request: NextRequest, context: RouteContext) {
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? "");

  // Tạo phòng: cho phép admin đã đăng nhập (MC tạo trước sự kiện).
  const { code } = await context.params;
  const cleanCode = code.trim().toUpperCase().slice(0, 12);
  const wantCreate = action === "create";

  if (wantCreate) {
    if (!(await isAdminRequest(request))) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    const existing = await findRoomByCode(admin, cleanCode);
    if (existing) {
      return NextResponse.json({ room: existing, created: false });
    }
    const teams = normalizeTeams(body?.teams);
    const settings = clampRoomSettings(body ?? {});
    const finalTeams =
      teams.length >= 2
        ? teams
        : [
            { id: "team-1", name: "Đội 1", color: TEAM_PALETTE[0], capacity: null },
            { id: "team-2", name: "Đội 2", color: TEAM_PALETTE[1], capacity: null },
          ];

    const ownerToken = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim() ?? null;
    let ownerEmail: string | null = null;
    if (ownerToken) {
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      if (url && anonKey) {
        const client = createClient(url, anonKey, {
          auth: { persistSession: false },
          global: { headers: { Authorization: `Bearer ${ownerToken}` } },
        });
        const { data } = await client.auth.getUser(ownerToken);
        ownerEmail = data.user?.email ?? null;
      }
    }

    const { data, error } = await admin
      .from("flap_rooms")
      .insert({
        code: cleanCode || generateRoomCode(),
        title: typeof body?.title === "string" && body.title.trim() ? body.title.trim().slice(0, 120) : undefined,
        teams: finalTeams,
        owner_email: ownerEmail,
        ...settings,
      })
      .select("*")
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "create_failed", detail: error?.message }, { status: 500 });
    }
    return NextResponse.json({ room: data as FlapRoom, created: true });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}

/** PUT /api/flap/[code] — điều khiển phòng (MC). */
export async function PUT(request: NextRequest, context: RouteContext) {
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { code } = await context.params;
  const room = await findRoomByCode(admin, code);
  if (!room) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? "");

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };

  switch (action) {
    case "start":
      if (room.status === "finished") {
        return NextResponse.json({ error: "reset_required" }, { status: 409 });
      }
      patch.status = "running";
      patch.started_at = new Date().toISOString();
      break;
    case "pause":
      patch.status = "paused";
      break;
    case "resume":
      patch.status = "running";
      break;
    case "lock_teams":
      patch.teams_locked = true;
      break;
    case "unlock_teams":
      patch.teams_locked = false;
      break;
    case "settings": {
      const settings = clampRoomSettings(body ?? {});
      Object.assign(patch, settings);
      if (body?.title) patch.title = String(body.title).slice(0, 120);
      if (Array.isArray(body?.teams)) {
        const teams = normalizeTeams(body.teams);
        if (teams.length >= 2) patch.teams = teams;
      }
      break;
    }
    case "remove_player": {
      const playerId = String(body?.player_id ?? "");
      if (!playerId) return NextResponse.json({ error: "missing_player" }, { status: 400 });
      await admin.from("flap_players").delete().eq("id", playerId).eq("room_id", room.id);
      return NextResponse.json({ ok: true });
    }
    case "reset": {
      // Xoá hết người chơi + về trạng thái chờ, giữ nguyên cấu hình đội.
      await admin.from("flap_players").delete().eq("room_id", room.id);
      patch.status = "lobby";
      patch.started_at = null;
      patch.ended_at = null;
      patch.round = room.round + 1;
      break;
    }
    case "finish": {
      const { data, error } = await admin.rpc("flap_finish_round", {
        p_room_id: room.id,
        // Kết thúc phải giữ bảng điểm/winner trên LED. MC chủ động bấm Reset
        // khi muốn xoá người chơi và mở vòng mới.
        p_reset: body?.reset === true,
      });
      if (error) return NextResponse.json({ error: "finish_failed", detail: error.message }, { status: 500 });
      if (!data) return NextResponse.json({ error: "round_not_running" }, { status: 409 });
      const refreshed = await findRoomByCode(admin, room.code);
      if (refreshed) {
        await broadcastRoomEvent(admin, refreshed.code, {
          type: "state",
          status: refreshed.status,
          startedAt: refreshed.started_at,
          round: refreshed.round,
        });
      }
      return NextResponse.json({ ok: true, summary: data });
    }
    default:
      return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }

  const { data, error } = await admin
    .from("flap_rooms")
    .update(patch)
    .eq("id", room.id)
    .select("*")
    .single();

  if (error) return NextResponse.json({ error: "update_failed", detail: error.message }, { status: 500 });
  await broadcastRoomEvent(admin, room.code, {
    type: "state",
    status: (data as FlapRoom).status,
    startedAt: (data as FlapRoom).started_at,
    round: (data as FlapRoom).round,
  });
  return NextResponse.json({ room: data as FlapRoom });
}
