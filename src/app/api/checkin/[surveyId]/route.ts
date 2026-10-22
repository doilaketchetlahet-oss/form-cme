import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
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
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await context.params;
  const body = await request.json().catch(() => null);
  if (!UUID.test(surveyId) || !body || typeof body !== "object" || typeof body.responseId !== "string" || !UUID.test(body.responseId)
    || typeof body.sessionId !== "string" || !body.sessionId.trim() || body.sessionId.length > 120
    || (body.hall != null && (typeof body.hall !== "string" || body.hall.length > 160))
    || !["preview", "checkin", "undo"].includes(body.action) || !["qr", "face", "manual"].includes(body.method)) {
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
