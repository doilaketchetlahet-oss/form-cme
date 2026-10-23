import { NextResponse } from "next/server";
import { authorizeAdminApi } from "@/lib/server/admin-api";
import { prizeError } from "@/lib/server/prize-draw";
import { PRIZE_SAMPLE_ITEMS, PRIZE_SAMPLE_START, PRIZE_SAMPLE_END, UUID_RE, prizeFormError } from "@/lib/prize-draw";
import type { SurveyQuestion } from "@/lib/surveys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function fail(error: string, status = 400) { return NextResponse.json({ ok: false, error }, { status }); }

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request, false, "prize-draw");
  if ("error" in auth) return fail(auth.error, auth.status);
  const id = new URL(request.url).searchParams.get("id");
  const campaigns = await auth.service.from("prize_campaigns").select("*").order("created_at", { ascending: false });
  if (campaigns.error) return prizeError(campaigns.error);
  if (!id) {
    const forms = await auth.service.from("surveys").select("id,title").eq("form_type", "feedback").is("prize_campaign_id", null).order("created_at", { ascending: false });
    if (forms.error) return prizeError(forms.error);
    return NextResponse.json({ ok: true, campaigns: campaigns.data, forms: forms.data, role: auth.role });
  }
  if (!UUID_RE.test(id)) return fail("ID không hợp lệ.");
  const campaign = campaigns.data.find(c => c.id === id);
  if (!campaign) return fail("Không tìm thấy chương trình.", 404);
  const [items, entries, questions] = await Promise.all([
    auth.service.from("prize_items").select("*").eq("campaign_id", id).order("position"),
    auth.service.from("prize_entries").select("id,phone,answers,prize_id,prize_name,claim_code,created_at,drawn_at,redeemed_at,redeemed_by").eq("campaign_id", id).order("created_at", { ascending: false }).limit(1000),
    auth.service.from("survey_questions").select("id,text,type,options").eq("survey_id", campaign.survey_id).order("position"),
  ]);
  if (items.error || entries.error || questions.error) return prizeError(items.error || entries.error || questions.error);
  return NextResponse.json({ ok: true, campaigns: campaigns.data, campaign, items: items.data, entries: entries.data, questions: questions.data, role: auth.role }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request, true, "prize-draw");
  if ("error" in auth) return fail(auth.error, auth.status);
  const raw = await request.text();
  if (raw.length > 32000) return fail("Cấu hình quá dài.", 413);
  let body;
  try { body = JSON.parse(raw); } catch { return fail("Dữ liệu không hợp lệ."); }
  if (!body || !["create", "save", "redeem"].includes(body.action)) return fail("Thao tác không hợp lệ.");
  if (body.action !== "create" && !UUID_RE.test(String(body.id))) return fail("ID không hợp lệ.");
  let data = body.data;
  if (body.action === "create") {
    data = { name: body.is_demo === false ? "Merap · Vòng quay nhận quà" : "DEMO · Merap · Vòng quay nhận quà", is_demo: body.is_demo !== false,
      starts_at: PRIZE_SAMPLE_START, ends_at: PRIZE_SAMPLE_END, items: PRIZE_SAMPLE_ITEMS };
    if (body.survey_id) {
      if (!UUID_RE.test(body.survey_id) || !UUID_RE.test(body.phone_question_id)) return fail("Chọn form và câu hỏi SĐT hợp lệ.");
      const qs = await auth.service.from("survey_questions").select("*").eq("survey_id", body.survey_id);
      if (qs.error) return prizeError(qs.error);
      const invalid = prizeFormError(qs.data as SurveyQuestion[], body.phone_question_id);
      if (invalid) return fail(invalid);
      data = { ...data, survey_id: body.survey_id, phone_question_id: body.phone_question_id };
    }
  } else if (body.action === "redeem") {
    if (!data || !UUID_RE.test(data.entry_id)) return fail("Lượt nhận quà không hợp lệ.");
    data = { entry_id: data.entry_id };
  } else {
    if (!data || typeof data !== "object" || !Number.isInteger(data.revision)) return fail("Cấu hình không hợp lệ.");
    if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 160) return fail("Tên chương trình cần có 1–160 ký tự.");
    if (!["draft", "active", "paused", "closed"].includes(data.status)) return fail("Trạng thái không hợp lệ.");
    if (typeof data.starts_at !== "string" || typeof data.ends_at !== "string" || !Number.isFinite(Date.parse(data.starts_at)) || !Number.isFinite(Date.parse(data.ends_at)) || Date.parse(data.ends_at) <= Date.parse(data.starts_at)) return fail("Thời gian kết thúc phải sau thời gian bắt đầu.");
    if (typeof data.accent_color !== "string" || !/^#[0-9a-f]{6}$/i.test(data.accent_color) || typeof data.instructions !== "string" || data.instructions.length > 2000 || typeof data.track_redemption !== "boolean") return fail("Giao diện hoặc hướng dẫn không hợp lệ.");
    if (typeof data.banner_url !== "string" || data.banner_url.length > 2000 || (data.banner_url && !/^https:\/\/[^\s]+$/i.test(data.banner_url))) return fail("Ảnh banner cần là URL HTTPS.");
    if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 12) return fail("Cần từ 1 đến 12 loại quà.");
    const ids = new Set();
    for (const item of data.items) {
      if (!item || typeof item.name !== "string" || !item.name.trim() || item.name.length > 100 || !/^#[0-9a-f]{6}$/i.test(item.color) || !Number.isInteger(item.total) || item.total < 0 || item.total > 100000) return fail("Kiểm tra tên, màu và số lượng quà (0–100.000).");
      if (item.id && (!UUID_RE.test(item.id) || ids.has(item.id))) return fail("ID loại quà không hợp lệ hoặc bị trùng.");
      if (item.id) ids.add(item.id);
    }
  }
  const result = await auth.service.rpc("prize_draw_admin", { p_action: body.action, p_id: body.action === "create" ? null : body.id, p_data: data, p_actor: auth.email });
  if (result.error) return prizeError(result.error);
  return NextResponse.json({ ok: true, id: result.data });
}
