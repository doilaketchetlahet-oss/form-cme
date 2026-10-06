import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { authorizeAdminApi } from "@/lib/server/admin-api";

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
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(request: Request, context: { params: Promise<{ surveyId: string }> }) {
  const { surveyId } = await context.params;
  const body = await request.json().catch(() => null);
  if (!UUID.test(surveyId) || !body || typeof body !== "object" || typeof body.responseId !== "string" || !UUID.test(body.responseId)
    || typeof body.sessionId !== "string" || !body.sessionId.trim() || body.sessionId.length > 120
    || !["preview", "checkin", "undo"].includes(body.action) || !["qr", "face", "manual"].includes(body.method)) {
    return NextResponse.json({ ok: false, error: MESSAGES.bad_request }, { status: 400 });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return NextResponse.json({ ok: false, error: "Thiếu cấu hình Supabase server." }, { status: 503 });
  const service = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: survey, error: loadError } = await service.from("surveys").select("checkin_pin").eq("id", surveyId).maybeSingle();
  if (loadError) return NextResponse.json({ ok: false, error: "Không tải được cấu hình check-in." }, { status: 503 });
  if (!survey) return NextResponse.json({ ok: false, error: MESSAGES.not_found }, { status: 404 });
  const pin = survey.checkin_pin?.trim();
  if (pin && body.pin !== pin) {
    const auth = await authorizeAdminApi(request, true);
    if ("error" in auth) return NextResponse.json({ ok: false, error: "Nhập lại mã PIN hoặc đăng nhập tài khoản quản trị để check-in." }, { status: 403 });
  }
  const { data, error } = await service.rpc("record_session_checkin", {
    p_survey_id: surveyId, p_response_id: body.responseId, p_session_key: body.sessionId,
    p_action: body.action, p_method: body.method,
  });
  if (error) return NextResponse.json({ ok: false, error: "Không ghi nhận được check-in. Kiểm tra kết nối và cập nhật database theo supabase/checkin-sessions.sql." }, { status: 503 });
  if (!data || typeof data !== "object") return NextResponse.json({ ok: false, error: "Không nhận được kết quả check-in." }, { status: 503 });
  if (!data.ok) {
    const status = data.code === "not_found" ? 404 : data.code === "denied" ? 403 : data.code === "bad_request" ? 400 : 409;
    return NextResponse.json({ ...data, error: MESSAGES[data.code] ?? MESSAGES.bad_request }, { status });
  }
  return NextResponse.json(data);
}
