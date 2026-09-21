import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import {
  buildStandings,
  findRoomByCode,
  hashToken,
  loadScoreRows,
  MAX_SCORE_PER_BATCH,
  MAX_SCORE_PER_SECOND,
  MAX_TOTAL_SCORE,
} from "@/lib/flap/race";
import { broadcastFlap } from "@/lib/flap/broadcast";

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
 *   được thực hiện atomically trong Postgres để request song song không vượt trần.
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { code } = await context.params;

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

  const room = await findRoomByCode(admin, code);
  if (!room) return NextResponse.json({ error: "not_found" }, { status: 404 });
  // Hết giờ: chốt vòng ở luồng nền để không làm chậm phản hồi.
  const startedAt = room.started_at ? Date.parse(room.started_at) : Number.NaN;
  if (room.status === "running" && Number.isFinite(startedAt) && Date.now() >= startedAt + room.duration_sec * 1000) {
    void admin
      .rpc("flap_finish_round", { p_room_id: room.id, p_reset: false })
      .then(() => broadcastFlap(room.code, { type: "reset" }));
    return NextResponse.json({ error: "not_running", status: "finished" }, { status: 409 });
  }

  if (room.status !== "running") {
    // Không nhận điểm ngoài lượt chơi; trả trạng thái để client tự tạm dừng.
    return NextResponse.json({ error: "not_running", status: room.status }, { status: 409 });
  }

  const tokenHash = hashToken(token);
  const { data, error } = await admin.rpc("flap_add_score", {
    p_player_id: playerId,
    p_room_id: room.id,
    p_token_hash: tokenHash,
    p_delta: Math.floor(deltaRaw),
    p_max_delta: MAX_SCORE_PER_BATCH,
    p_max_total: MAX_TOTAL_SCORE,
    p_max_per_second: MAX_SCORE_PER_SECOND,
  });

  if (error) return NextResponse.json({ error: "add_failed", detail: error.message }, { status: 500 });

  const result = Array.isArray(data) ? data[0] : null;
  // RPC trả rỗng khi token sai/hết hạn hoặc đã hết giờ.
  if (!result) return NextResponse.json({ error: "invalid_session" }, { status: 401 });

  const newScore = typeof result.score === "number" ? result.score : 0;
  const acceptedDelta = typeof result.accepted_delta === "number" ? result.accepted_delta : 0;

  // Bị chặn bởi trần tốc độ: trả ngay.
  if (acceptedDelta <= 0) {
    return NextResponse.json({ ok: true, score: newScore, throttled: true });
  }

  // Trang người chơi chỉ cần `score` để hiển thị, không cần bảng xếp hạng.
  // Bảng xếp hạng được đọc và phát cho màn LED ở luồng nền, nhờ đó phản hồi
  // cho điện thoại nhanh hơn (bớt một vòng gọi Supabase).
  void (async () => {
    try {
      const scoreRows = await loadScoreRows(admin, room.id);
      const standings = buildStandings(room.teams, scoreRows, room.score_mode, room.track_length);
      await broadcastFlap(room.code, { type: "standings", standings });
    } catch (err) {
      console.warn("flap background standings failed:", err instanceof Error ? err.message : err);
    }
  })();

  return NextResponse.json({ ok: true, score: newScore });
}
