import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestSiteUrl } from "@/lib/site-url";
import { buildQrImagePath } from "@/lib/qr-style";
import { fillMergeTokens, parseEmailTemplate, sampleMergeValues } from "@/lib/email-template";
import { composeInviteImage } from "@/lib/email-overlay";
import { renderCheckinEmailHtml } from "@/lib/server/email-react";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: NextRequest) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ ok: false, error: "Thiếu cấu hình Supabase." }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "Bạn cần đăng nhập." }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
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
    return NextResponse.json({ ok: false, error: "Bạn không có quyền xem trước template." }, { status: 403 });
  }

  const payload = await request.json().catch(() => null) as {
    subject?: string | null;
    body?: string | null;
    surveyTitle?: string | null;
  } | null;
  const rawBody = payload?.body ?? "";
  const rawSubject = payload?.subject ?? "";
  const title = payload?.surveyTitle?.trim() || "Sự kiện mẫu";

  const origin = getRequestSiteUrl(request.nextUrl.origin);
  const previewUrl = `${origin}/checkin/preview`;
  const qrImgUrl = `${origin}${buildQrImagePath(previewUrl, 220, null)}`;
  const values = sampleMergeValues(title);
  values.checkin_url = previewUrl;
  values.qr_image = qrImgUrl;

  let html = await renderCheckinEmailHtml(rawBody, values, qrImgUrl);

  const template = parseEmailTemplate(rawBody);
  if (template.includeOverlay === true && template.overlay?.imageUrl) {
    try {
      const jpeg = await composeInviteImage(template.overlay, values, previewUrl);
      const dataUri = `data:image/jpeg;base64,${jpeg.toString("base64")}`;
      html = html.replace(/cid:invite/g, dataUri);
    } catch (error) {
      return NextResponse.json({
        ok: false,
        error: error instanceof Error ? error.message : "Không ghép được ảnh thiệp.",
      }, { status: 500 });
    }
  }

  return NextResponse.json({
    ok: true,
    html,
    subject: rawSubject ? fillMergeTokens(rawSubject, values).trim() : `Mã check-in: ${title}`,
    attachments: (template.attachments ?? []).map((attachment) => ({ name: attachment.name, size: attachment.size ?? 0 })),
  });
}
