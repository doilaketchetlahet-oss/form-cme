import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import { buildStandings, findRoomByCode, hashToken, loadPlayers, MAX_SCORE_PER_BATCH, MAX_TOTAL_SCORE } from "@/lib/flap/race";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ code: string }> };

/**
 * POST /api/flap/[code]/score — trọng tài cộng điểm.
 *
 * Chống gian lận:
 * - Bắt buộc token phiên khớp hash đã lưu.
 * - Giới hạn điểm mỗi lần gửi (MAX_SCORE_PER_BATCH).
 * - Giới hạn tổng tốc độ theo thời gian thực (MAX_SCORE_PER_SECOND),
 *   server tự tính từ lần gửi trước, client không thể khai khống.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { code } = await context.params;
  const room = await findRoomByCode(admin, code);
  if (!room) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as
    | { playerId?: unknown; token?: unknown; delta?: unknown }
    | null;

  const playerId = typeof body?.playerId === "string" ? body.playerId : "";
  const token = typeof body?.token === "string" ? body.token : "";
  const deltaRaw = Number(body?.delta);
  if (!playerId || !token) return NextResponse.json({ error: "missing_auth" }, { status: 400 });
  if (!Number.isFinite(deltaRaw) || deltaRaw <= 0) {
    return NextResponse.json({ error: "nothing_to_add" }, { status: 400 });
  }

  const { data: player } = await admin
    .from("flap_players")
    .select("id, room_id, team_id, score, active, token_hash, last_seen_at")
    .eq("id", playerId)
    .eq("room_id", room.id)
    .eq("token_hash", hashToken(token))
    .maybeSingle();

  if (!player) return NextResponse.json({ error: "invalid_session" }, { status: 401 });
  if (!player.active) return NextResponse.json({ error: "inactive" }, { status: 403 });

  if (room.status !== "running") {
    // Không nhận điểm ngoài lượt chơi; trả trạng thái để client tự tạm dừng.
    return NextResponse.json({ error: "not_running", status: room.status }, { status: 409 });
  }

  // Trần theo thời gian: tính từ lần gửi trước để client không thể bù dồn.
  const elapsed = Math.max(0, Date.now() - Date.parse(player.last_seen_at as string)) / 1000;
  const allowance = Math.floor(elapsed * 12) + 4;
  const delta = Math.max(0, Math.min(Math.floor(deltaRaw), MAX_SCORE_PER_BATCH, allowance));
  if (delta === 0) {
    return NextResponse.json({ ok: true, score: player.score, throttled: true });
  }

  const { data: newScore, error } = await admin.rpc("flap_add_score", {
    p_player_id: playerId,
    p_token_hash: hashToken(token),
    p_delta: delta,
    p_max_delta: MAX_SCORE_PER_BATCH,
    p_max_total: MAX_TOTAL_SCORE,
  });

  if (error) return NextResponse.json({ error: "add_failed", detail: error.message }, { status: 500 });

  const players = await loadPlayers(admin, room.id);
  const standings = buildStandings(room.teams, players, room.score_mode, room.track_length);

  // Đẩy hình sang màn LED ngay (không chờ nhịp polling 2s).
  try {
    const channel = admin.channel(`flap:${room.code}`);
    await channel.send({
      type: "broadcast",
      event: "flap",
      payload: { type: "standings", standings },
    });
    void admin.removeChannel(channel);
  } catch {
    // Broadcast lỗi không ảnh hưởng kết quả: LED vẫn đồng bộ qua polling.
  }

  return NextResponse.json({
    ok: true,
    score: newScore ?? player.score,
    standings,
  });
}
