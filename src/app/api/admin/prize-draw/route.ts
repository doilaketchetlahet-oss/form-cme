import { NextResponse } from "next/server";
import { authorizeAdminApi } from "@/lib/server/admin-api";
import { prizeError } from "@/lib/server/prize-draw";
import { PRIZE_SAMPLE_ITEMS, UUID_RE, validatePrizeFields, validPrizeImage } from "@/lib/prize-draw";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
function fail(error: string, status = 400) { return NextResponse.json({ ok: false, error }, { status }); }

export async function GET(request: Request) {
  const auth = await authorizeAdminApi(request, false, "prize-draw");
  if ("error" in auth) return fail(auth.error, auth.status);
  const id = new URL(request.url).searchParams.get("id");
  const campaigns = await auth.service.from("prize_campaigns").select("*").is("deleted_at", null).order("created_at", { ascending: false });
  if (campaigns.error) return prizeError(campaigns.error);
  if (!id) {
    return NextResponse.json({ ok: true, campaigns: campaigns.data, role: auth.role }, { headers: { "Cache-Control": "private, no-store" } });
  }
  if (!UUID_RE.test(id)) return fail("ID không hợp lệ.");
  const campaign = campaigns.data.find(c => c.id === id);
  if (!campaign) return fail("Không tìm thấy chương trình.", 404);
  const [items, entries] = await Promise.all([
    auth.service.from("prize_items").select("*").eq("campaign_id", id).order("position"),
    auth.service.from("prize_entries").select("id,phone,answers,prize_id,prize_name,claim_code,created_at,drawn_at,redeemed_at,redeemed_by").eq("campaign_id", id).order("created_at", { ascending: false }).limit(1000),
  ]);
  if (items.error || entries.error) return prizeError(items.error || entries.error);
  return NextResponse.json({ ok: true, campaigns: campaigns.data, campaign, items: items.data, entries: entries.data, questions: campaign.form_fields, role: auth.role }, { headers: { "Cache-Control": "private, no-store" } });
}

export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request, true, "prize-draw");
  if ("error" in auth) return fail(auth.error, auth.status);
  const raw = await request.text();
  if (raw.length > 32000) return fail("Cấu hình quá dài.", 413);
  let body;
  try { body = JSON.parse(raw); } catch { return fail("Dữ liệu không hợp lệ."); }
  if (!body || !["create", "save", "redeem", "delete"].includes(body.action)) return fail("Thao tác không hợp lệ.");
  if (body.action !== "create" && !UUID_RE.test(String(body.id))) return fail("ID không hợp lệ.");
  let data = body.data;
  if (body.action === "create") {
    data = { name: body.is_demo === false ? "Merap · Vòng quay nhận quà" : "DEMO · Merap · Vòng quay nhận quà", is_demo: body.is_demo !== false,
      items: PRIZE_SAMPLE_ITEMS };
    if (body.survey_id || body.phone_question_id) return fail("Form đăng ký được quản lý riêng trong tool.");
  } else if (body.action === "delete") {
    if (!data || !Number.isInteger(data.revision)) return fail("Hãy tải lại chương trình trước khi xóa.");
    data = { revision: data.revision };
  } else if (body.action === "redeem") {
    if (!data || !UUID_RE.test(data.entry_id)) return fail("Lượt nhận quà không hợp lệ.");
    data = { entry_id: data.entry_id };
  } else {
    if (!data || typeof data !== "object" || !Number.isInteger(data.revision)) return fail("Cấu hình không hợp lệ.");
    if (typeof data.name !== "string" || !data.name.trim() || data.name.length > 160) return fail("Tên chương trình cần có 1–160 ký tự.");
    if (!["draft", "active", "paused", "closed"].includes(data.status)) return fail("Trạng thái không hợp lệ.");
    if (typeof data.accent_color !== "string" || !/^#[0-9a-f]{6}$/i.test(data.accent_color) || typeof data.instructions !== "string" || data.instructions.length > 2000 || typeof data.track_redemption !== "boolean") return fail("Giao diện hoặc hướng dẫn không hợp lệ.");
    if (typeof data.banner_url !== "string" || data.banner_url.length > 2000 || (data.banner_url && !/^https:\/\/[^\s]+$/i.test(data.banner_url))) return fail("Ảnh banner cần là URL HTTPS.");
    if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 12) return fail("Cần từ 1 đến 12 loại quà.");
    if (typeof data.form_title !== "string" || !data.form_title.trim() || data.form_title.length > 160 || typeof data.form_description !== "string" || data.form_description.length > 2000 || typeof data.thank_you_message !== "string" || data.thank_you_message.length > 2000) return fail("Kiểm tra tiêu đề, giới thiệu và lời cảm ơn của form.");
    const current = await auth.service.from("prize_campaigns").select("phone_question_id").eq("id", body.id).is("deleted_at", null).maybeSingle();
    if (current.error) return prizeError(current.error);
    if (!current.data) return fail("Không tìm thấy chương trình.", 404);
    try { validatePrizeFields(data.form_fields, current.data.phone_question_id); }
    catch (e) { return fail(e instanceof Error ? e.message : "Form không hợp lệ."); }
    const ids = new Set();
    for (const item of data.items) {
      if (!item || typeof item.name !== "string" || !item.name.trim() || item.name.length > 100 || !/^#[0-9a-f]{6}$/i.test(item.color) || !Number.isInteger(item.total) || item.total < 0 || item.total > 100000) return fail("Kiểm tra tên, màu và số lượng quà (0–100.000).");
      if (!validPrizeImage(item.image_url)) return fail("Ảnh quà cần là URL HTTPS hoặc ảnh mẫu của chương trình.");
      if (item.id && (!UUID_RE.test(item.id) || ids.has(item.id))) return fail("ID loại quà không hợp lệ hoặc bị trùng.");
      if (item.id) ids.add(item.id);
    }
  }
  const result = await auth.service.rpc("prize_draw_admin", { p_action: body.action, p_id: body.action === "create" ? null : body.id, p_data: data, p_actor: auth.email });
  if (result.error) return prizeError(result.error);
  return NextResponse.json({ ok: true, id: result.data });
}
