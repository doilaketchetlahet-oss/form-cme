import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import {
  buildStandings,
  findRoomByCode,
  generateSessionToken,
  hashToken,
  loadPlayers,
} from "@/lib/flap/race";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ code: string }> };

/**
 * POST /api/flap/[code]/join — người chơi vào phòng và nhận token phiên.
 *
 * Token chỉ trả về đúng một lần; server lưu hash để các lần gửi điểm sau
 * không thể giả mạo người chơi khác.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { code } = await context.params;
  const room = await findRoomByCode(admin, code);
  if (!room) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as
    | { team_id?: unknown; nickname?: unknown; sensor_ok?: unknown }
    | null;

  const teamId = typeof body?.team_id === "string" ? body.team_id.trim() : "";
  const team = room.teams.find((t) => t.id === teamId);
  if (!team) return NextResponse.json({ error: "unknown_team" }, { status: 400 });

  // Cho phép vào giữa lượt miễn là phòng chưa kết thúc; người vào sau điểm
  // bắt đầu từ 0 nên không phá vỡ tính công bằng (chế độ trung bình/máy).
  if (room.status === "finished") {
    return NextResponse.json({ error: "room_finished" }, { status: 409 });
  }

  const nickname =
    typeof body?.nickname === "string" && body.nickname.trim()
      ? body.nickname.trim().slice(0, 32)
      : null;

  if (room.teams_locked) {
    const players = await loadPlayers(admin, room.id);
    const inTeam = players.filter((p) => p.team_id === teamId && p.active).length;
    if (team.capacity && inTeam >= team.capacity) {
      return NextResponse.json({ error: "team_full" }, { status: 409 });
    }
  }

  const token = generateSessionToken();
  const { data, error } = await admin
    .from("flap_players")
    .insert({
      room_id: room.id,
      team_id: teamId,
      nickname,
      token_hash: hashToken(token),
      sensor_ok: body?.sensor_ok !== false,
    })
    .select("id, team_id, nickname, score")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "join_failed", detail: error?.message }, { status: 500 });
  }

  return NextResponse.json({
    playerId: data.id,
    token,
    team: { id: team.id, name: team.name, color: team.color },
    nickname: data.nickname,
    room: {
      code: room.code,
      title: room.title,
      status: room.status,
      score_mode: room.score_mode,
      teams: room.teams,
      track_length: room.track_length,
      duration_sec: room.duration_sec,
    },
  });
}

/** GET /api/flap/[code]/join — thông tin phòng để hiện màn chọn đội. */
export async function GET(_request: NextRequest, context: RouteContext) {
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { code } = await context.params;
  const room = await findRoomByCode(admin, code);
  if (!room) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const players = await loadPlayers(admin, room.id);
  const standings = buildStandings(room.teams, players, room.score_mode, room.track_length);

  return NextResponse.json({
    room: {
      code: room.code,
      title: room.title,
      status: room.status,
      score_mode: room.score_mode,
      teams: room.teams,
      teams_locked: room.teams_locked,
      track_length: room.track_length,
      duration_sec: room.duration_sec,
      round: room.round,
    },
    standings,
    playerCount: players.length,
  });
}
