import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestSiteUrl } from "@/lib/site-url";
import { buildQrImagePath } from "@/lib/qr-style";
import { compileEmailHtml, fillMergeTokens, hasOverlayImage, parseEmailTemplate, sampleMergeValues } from "@/lib/email-template";
import { composeInviteImage, fetchFileAttachments, overlayEmailPayload, type ResendAttachment } from "@/lib/email-overlay";
import { sendEmail } from "@/lib/server/email-provider";

export const runtime = "nodejs";
export const maxDuration = 30;

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: NextRequest, context: RouteContext) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ ok: false, error: "Thiếu cấu hình Supabase." }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "Bạn cần đăng nhập lại." }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const email = userData.user?.email?.trim().toLowerCase();
  if (userError || !email) {
    return NextResponse.json({ ok: false, error: "Không xác thực được tài khoản hiện tại." }, { status: 401 });
  }

  const { data: member } = await supabase
    .from("admin_members")
    .select("role, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();

  if (member?.role !== "owner" && member?.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Bạn không có quyền gửi thử thư mời." }, { status: 403 });
  }

  const { id: surveyId } = await context.params;
  const payload = await request.json().catch(() => null) as {
    to?: string;
    email_subject?: string | null;
    email_body?: string | null;
  } | null;

  const to = payload?.to?.trim().toLowerCase() || email;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return NextResponse.json({ ok: false, error: "Email nhận thử không hợp lệ." }, { status: 400 });
  }

  const { data: survey } = await supabase
    .from("surveys")
    .select("title, email_subject, email_body, checkin_theme, email_provider")
    .eq("id", surveyId)
    .maybeSingle();

  if (!survey) {
    return NextResponse.json({ ok: false, error: "Không tìm thấy form." }, { status: 404 });
  }

  const origin = getRequestSiteUrl(request.nextUrl.origin);
  const previewUrl = `${origin}/checkin/preview`;
  const qrStyle = (survey.checkin_theme as { qr?: Parameters<typeof buildQrImagePath>[2] } | null)?.qr;
  const qrImgUrl = `${origin}${buildQrImagePath(previewUrl, 220, qrStyle)}`;
  const values = sampleMergeValues(survey.title || "Sự kiện");
  values.checkin_url = previewUrl;
  values.qr_image = qrImgUrl;

  const rawBody = payload?.email_body || survey.email_body || "";
  const rawSubject = payload?.email_subject || survey.email_subject || `✅ Mã check-in: ${survey.title}`;
  const html = compileEmailHtml(rawBody, values, qrImgUrl);
  const attachments: ResendAttachment[] = [];
  const template = parseEmailTemplate(rawBody);
  if (hasOverlayImage(rawBody)) {
    try {
      if (!template.overlay) {
        return NextResponse.json({ ok: false, error: "Chưa có ảnh thiệp để gửi thử." }, { status: 400 });
      }
      const jpeg = await composeInviteImage(template.overlay, values, previewUrl);
      attachments.push(...overlayEmailPayload(jpeg).attachments);
    } catch (error) {
      return NextResponse.json({
        ok: false,
        error: error instanceof Error ? error.message : "Ghép ảnh thiệp thất bại.",
      }, { status: 500 });
    }
  }
  if (template.attachments && template.attachments.length > 0) {
    attachments.push(...await fetchFileAttachments(template.attachments));
  }
  if (!html && attachments.length === 0) {
    return NextResponse.json({ ok: false, error: "Chưa có nội dung thư để gửi thử." }, { status: 400 });
  }

  const result = await sendEmail({
    to,
    subject: `[TEST] ${fillMergeTokens(rawSubject, values).trim()}`,
    html,
    text: "",
    ...(attachments.length > 0 ? { attachments } : {}),
  }, (survey as { email_provider?: string | null }).email_provider ?? null);

  if (!result.ok) {
    return NextResponse.json({ ok: false, error: "Gửi thử thất bại.", detail: result.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true, to, provider: result.provider });
}
