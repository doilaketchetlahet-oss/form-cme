import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { authorizeAdminApi } from "@/lib/server/admin-api";
import { normalizeSessionConfig } from "@/lib/checkin-sessions";

export const runtime = "nodejs";

const MESSAGES: Record<string, string> = {
  denied: "Người này không đăng ký tham dự buổi này.",
  payment_pending: "Đăng ký chưa hoàn tất thanh toán.",
  not_open: "Chưa đến giờ mở check-in của buổi này.",
  closed: "Buổi này đã đóng check-in.",
  disabled: "Điểm danh theo buổi đang tắt.",
  invalid_session: "Buổi check-in không tồn tại hoặc đã được gỡ khỏi cấu hình.",
  invalid_config: "Cấu hình quyền tham dự hoặc giờ check-in không hợp lệ. Kiểm tra lại form.",
  not_found: "Mã không hợp lệ hoặc thuộc form khác.",
  bad_request: "Yêu cầu check-in không hợp lệ.",
  hall_required: "Chọn hội trường tại quầy quét trước khi check-in buổi này.",
  hall_unassigned: "Khách chưa được phân hội trường. Cập nhật danh sách trước khi check-in.",
  wrong_hall: "Khách được phân hội trường khác. Kiểm tra hội trường trên hồ sơ đăng ký.",
  session_required: "Form này điểm danh theo buổi. Mở link quét/điểm danh của từng buổi từ Danh sách khách.",
  write_failed: "Không ghi nhận được check-in. Kiểm tra kết nối rồi thử lại.",
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// Ids travel in the PostgREST query string; keep each request well under 8KB.
const MAX_BULK = 150;

type GeneralBody = {
  mode: "general";
  responseId?: string;
  responseIds?: string[];
  action: "checkin" | "undo";
  method: "qr" | "face" | "manual" | "bulk";
  hall?: string | null;
  pin?: string | null;
};

type GeneralRow = { id: string; checked_in: boolean | null; checked_in_at: string | null; hall: string | null; payment_status?: string | null };

function isGeneralBody(body: Record<string, unknown>): body is GeneralBody {
  if (body.mode !== "general" || body.sessionId !== undefined) return false;
  if (!["checkin", "undo"].includes(body.action as string) || !["qr", "face", "manual", "bulk"].includes(body.method as string)) return false;
  if (body.hall != null && (typeof body.hall !== "string" || body.hall.length > 160)) return false;
  if (body.responseIds !== undefined) {
    const ids = body.responseIds;
    return body.responseId === undefined && body.action === "checkin" && Array.isArray(ids) && ids.length > 0 && ids.length <= MAX_BULK
      && ids.every((id) => typeof id === "string" && UUID.test(id)) && new Set(ids).size === ids.length;
  }
  return typeof body.responseId === "string" && UUID.test(body.responseId);
}

function isPaymentSettled(status: unknown) {
  return !status || status === "not_required" || status === "paid";
}

export async function POST(request: Request, context: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await context.params;
  const body = await request.json().catch(() => null);
  const validBody = !!body && typeof body === "object" && !Array.isArray(body);
  const general = validBody && body.mode === "general";
  if (!UUID.test(surveyId) || !validBody || (general ? !isGeneralBody(body) : (
    body.mode !== undefined || typeof body.responseId !== "string" || !UUID.test(body.responseId)
    || typeof body.sessionId !== "string" || !body.sessionId.trim() || body.sessionId.length > 120
    || (body.hall != null && (typeof body.hall !== "string" || body.hall.length > 160))
    || !["preview", "checkin", "undo"].includes(body.action) || !["qr", "face", "manual"].includes(body.method)))) {
    return NextResponse.json({ ok: false, error: MESSAGES.bad_request }, { status: 400 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "Thiếu cấu hình Supabase server." }, { status: 503 });
  const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: survey, error: loadError } = await service.from("surveys").select("checkin_pin, checkin_theme").eq("id", surveyId).maybeSingle();
  if (loadError) return NextResponse.json({ ok: false, error: "Không tải được cấu hình check-in." }, { status: 503 });
  if (!survey) return NextResponse.json({ ok: false, error: MESSAGES.not_found }, { status: 404 });
  const pin = survey.checkin_pin?.trim();
  if (pin && body.pin !== pin) {
    const auth = await authorizeAdminApi(request, true);
    if ("error" in auth) return NextResponse.json({ ok: false, error: "Nhập lại mã PIN hoặc đăng nhập tài khoản quản trị để check-in." }, { status: 403 });
  }
  if (general) return generalCheckin(service, surveyId, survey.checkin_theme, body as GeneralBody);
  const checkHall = normalizeSessionConfig(survey.checkin_theme?.sessionConfig)?.sessions.find((session) => session.id === body.sessionId)?.checkHall;
  const { data, error } = await service.rpc("record_session_checkin", {
    p_survey_id: surveyId, p_response_id: body.responseId, p_session_key: body.sessionId,
    p_action: body.action, p_method: body.method,
    // Existing sessions work before the hall migration; enabled hall checks must
    // use the new overload and fail closed if it has not been installed.
    ...(checkHall ? { p_hall: body.hall?.trim() || null } : {}),
  });
  if (error) return NextResponse.json({ ok: false, error: "Không ghi nhận được check-in. Kiểm tra kết nối và cập nhật database theo supabase/checkin-sessions.sql." }, { status: 503 });
  if (!data || typeof data !== "object") return NextResponse.json({ ok: false, error: "Không nhận được kết quả check-in." }, { status: 503 });
  if (!data.ok) {
    const status = data.code === "not_found" ? 404 : data.code === "denied" ? 403 : data.code === "bad_request" ? 400 : 409;
    return NextResponse.json({ ...data, error: MESSAGES[data.code] ?? MESSAGES.bad_request }, { status });
  }
  return NextResponse.json(data);
}

/**
 * Forms without managed sessions (general counter / per-hall entry). The server
 * clock is authoritative, a guest's first arrival time is never overwritten,
 * unpaid registrations are refused and a failed write is never reported as success.
 */
async function generalCheckin(service: SupabaseClient, surveyId: string, theme: { sessionConfig?: unknown } | null, body: GeneralBody) {
  if (normalizeSessionConfig(theme?.sessionConfig)) {
    return NextResponse.json({ ok: false, code: "session_required", error: MESSAGES.session_required }, { status: 409 });
  }
  const operatorHall = body.hall?.trim() || null;
  const bulk = Array.isArray(body.responseIds);
  const ids = bulk ? body.responseIds! : [body.responseId!];
  const { data: found, error: readError } = await service.from("survey_responses")
    .select("id, checked_in, checked_in_at, hall, payment_status").eq("survey_id", surveyId).in("id", ids);
  if (readError || !Array.isArray(found)) return NextResponse.json({ ok: false, error: MESSAGES.write_failed }, { status: 503 });
  const rows = new Map((found as GeneralRow[]).map((row) => [row.id, row]));
  const logHall = (row: GeneralRow) => operatorHall ?? (body.method === "qr" ? null : row.hall ?? null);
  const writeLogs = async (entries: { row: GeneralRow; action: "checkin" | "undo_checkin" }[]) => {
    if (!entries.length) return;
    const { error } = await service.from("checkin_logs").insert(entries.map(({ row, action }) => ({
      survey_id: surveyId, response_id: row.id, action, method: body.method, hall: logHall(row), session_name: null,
    })));
    if (error) console.warn("Failed to write check-in log:", error.message);
  };

  if (body.action === "undo") {
    const row = rows.get(ids[0]);
    if (!row) return NextResponse.json({ ok: false, code: "not_found", error: MESSAGES.not_found }, { status: 404 });
    if (row.checked_in || row.checked_in_at) {
      const { error } = await service.from("survey_responses").update({ checked_in: false, checked_in_at: null })
        .eq("id", row.id).eq("survey_id", surveyId);
      if (error) return NextResponse.json({ ok: false, error: MESSAGES.write_failed }, { status: 503 });
      await writeLogs([{ row, action: "undo_checkin" }]);
    }
    return NextResponse.json({ ok: true, code: "unchecked", checkedInAt: null });
  }

  const eligible = ids.filter((id) => rows.has(id) && isPaymentSettled(rows.get(id)!.payment_status));
  const waiting = eligible.filter((id) => !rows.get(id)!.checked_in);
  let recorded: { id: string; checked_in_at: string | null }[] = [];
  if (waiting.length) {
    const { data, error } = await service.from("survey_responses")
      .update({ checked_in: true, checked_in_at: new Date().toISOString() })
      // checked_in=false keeps concurrent counters from overwriting the first arrival.
      .eq("survey_id", surveyId).eq("checked_in", false).in("id", waiting)
      .select("id, checked_in_at");
    if (error) return NextResponse.json({ ok: false, error: MESSAGES.write_failed }, { status: 503 });
    recorded = (data ?? []) as typeof recorded;
  }
  const recordedIds = new Set(recorded.map((row) => row.id));

  if (bulk) {
    await writeLogs(recorded.flatMap((item) => rows.has(item.id) ? [{ row: rows.get(item.id)!, action: "checkin" as const }] : []));
    return NextResponse.json({
      ok: true,
      checkedIn: Object.fromEntries(recorded.map((row) => [row.id, row.checked_in_at])),
      already: eligible.length - recordedIds.size,
      skipped: ids.length - eligible.length,
    });
  }

  const row = rows.get(ids[0]);
  if (!row) return NextResponse.json({ ok: false, code: "not_found", error: MESSAGES.not_found }, { status: 404 });
  if (!isPaymentSettled(row.payment_status)) {
    return NextResponse.json({ ok: false, code: "payment_pending", error: MESSAGES.payment_pending }, { status: 409 });
  }
  const mine = recorded.find((item) => item.id === row.id);
  if (mine) {
    await writeLogs([{ row, action: "checkin" }]);
    return NextResponse.json({ ok: true, code: "checked_in", checkedInAt: mine.checked_in_at });
  }
  // Already arrived (possibly at another counter a moment ago): keep the first
  // timestamp. A per-hall counter still records the hall entry in the log.
  let checkedInAt = row.checked_in_at;
  if (!checkedInAt) {
    const { data } = await service.from("survey_responses").select("checked_in_at").eq("id", row.id).maybeSingle();
    checkedInAt = (data as { checked_in_at?: string | null } | null)?.checked_in_at ?? null;
  }
  if (operatorHall) await writeLogs([{ row, action: "checkin" }]);
  return NextResponse.json({ ok: true, code: "already", checkedInAt });
}
