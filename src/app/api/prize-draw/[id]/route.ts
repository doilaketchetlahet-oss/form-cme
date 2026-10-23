import { randomBytes } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { createBoothServiceClient, checkPublicBoothRateLimit } from "@/lib/server/booth-public-access";
import { prizeCookie, prizeHash, publicPrizeEntry, prizeError } from "@/lib/server/prize-draw";
import { UUID_RE, validatePrizeAnswers } from "@/lib/prize-draw";
import type { SurveyQuestion } from "@/lib/surveys";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type Context = { params: Promise<{ id: string }> };
const tokenPattern = /^[a-f0-9]{64}$/;
const campaignFields = "id,survey_id,phone_question_id,name,status,is_demo,starts_at,ends_at,accent_color,banner_url,instructions,track_redemption,revision";
const entryFields = "id,prize_id,prize_name,prize_color,claim_code,drawn_at,redeemed_at";
function fail(error: string, status = 400) { return NextResponse.json({ ok: false, error }, { status }); }

export async function GET(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return fail("Chương trình không hợp lệ.");
  const service = createBoothServiceClient();
  if (!service) return fail("Thiếu cấu hình server.", 503);
  const oldToken = request.cookies.get(prizeCookie(id))?.value;
  const token = oldToken && tokenPattern.test(oldToken) ? oldToken : randomBytes(32).toString("hex");
  const [campaign, items, entry] = await Promise.all([
    service.from("prize_campaigns").select(campaignFields).eq("id", id).maybeSingle(),
    service.from("prize_items").select("id,name,color,total,remaining,position").eq("campaign_id", id).order("position"),
    service.from("prize_entries").select(entryFields).eq("campaign_id", id).eq("token_hash", prizeHash(token)).maybeSingle(),
  ]);
  const error = campaign.error || items.error || entry.error;
  if (error) return prizeError(error);
  if (!campaign.data) return fail("Không tìm thấy chương trình.", 404);
  const response = NextResponse.json({ ok: true, campaign: campaign.data, items: items.data, entry: publicPrizeEntry(entry.data) }, { headers: { "Cache-Control": "private, no-store" } });
  if (token !== oldToken) response.cookies.set(prizeCookie(id), token, { httpOnly: true, sameSite: "lax", secure: request.nextUrl.protocol === "https:", path: `/api/prize-draw/${id}`, maxAge: 60 * 60 * 24 * 365 });
  return response;
}

export async function POST(request: NextRequest, context: Context) {
  const { id } = await context.params;
  if (!UUID_RE.test(id)) return fail("Chương trình không hợp lệ.");
  if (request.headers.get("origin") !== request.nextUrl.origin) return fail("Nguồn yêu cầu không hợp lệ.", 403);
  if (!checkPublicBoothRateLimit(request, `prize:${id}`, 120, 60000)) return fail("Bạn thao tác quá nhanh. Vui lòng thử lại sau một phút.", 429);
  const token = request.cookies.get(prizeCookie(id))?.value;
  if (!token || !tokenPattern.test(token)) return fail("Vui lòng tải lại trang để khởi tạo phiên đăng ký.", 401);
  const service = createBoothServiceClient();
  if (!service) return fail("Thiếu cấu hình server.", 503);
  const raw = await request.text();
  if (raw.length > 64000) return fail("Thông tin đăng ký quá dài.", 413);
  let body;
  try { body = JSON.parse(raw); } catch { return fail("Dữ liệu không hợp lệ."); }
  if (!body || !["register", "spin"].includes(body.action)) return fail("Thao tác không hợp lệ.");
  let result;
  if (body.action === "spin") {
    result = await service.rpc("prize_draw_spin", { p_id: id, p_hash: prizeHash(token) });
  } else {
    const { data: campaign, error } = await service.from("prize_campaigns").select("survey_id,phone_question_id").eq("id", id).maybeSingle();
    if (error) return prizeError(error);
    if (!campaign) return fail("Không tìm thấy chương trình.", 404);
    const qs = await service.from("survey_questions").select("*").eq("survey_id", campaign.survey_id);
    if (qs.error) return prizeError(qs.error);
    try {
      const validated = validatePrizeAnswers(qs.data as SurveyQuestion[], campaign.phone_question_id, body.answers);
      result = await service.rpc("prize_draw_register", { p_id: id, p_hash: prizeHash(token), p_phone: validated.phone, p_answers: validated.answers });
    } catch (e) { return fail(e instanceof Error ? e.message : "Thông tin không hợp lệ."); }
  }
  if (result.error) return prizeError(result.error);
  return NextResponse.json({ ok: true, entry: publicPrizeEntry(result.data) }, { headers: { "Cache-Control": "private, no-store" } });
}
