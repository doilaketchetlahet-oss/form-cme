import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestSiteUrl } from "@/lib/site-url";
import { buildQrImagePath } from "@/lib/qr-style";
import type { QRBranding } from "@/lib/surveys";

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fillTemplate(template: string, values: Record<string, string>) {
  return Object.entries(values).reduce(
    (body, [key, value]) => body.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value),
    template,
  );
}

function fillEmailBodyTemplate(template: string, values: { name: string; qrImgUrl: string; checkinUrl: string; surveyTitle: string }) {
  const qrImageHtml = `<div style="text-align:center;margin:22px 0"><img src="${values.qrImgUrl}" alt="Mã QR check-in" width="220" height="220" style="width:220px;height:220px;border-radius:12px;border:1px solid #e2e8f0" /></div>`;

  return template
    .replace(/\{\{name\}\}/g, values.name)
    .replace(/\{\{survey_title\}\}/g, values.surveyTitle)
    .replace(/\{\{checkin_url\}\}/g, values.checkinUrl)
    .replace(/src=(["'])\{\{qr_url\}\}\1/g, `src=$1${values.qrImgUrl}$1`)
    .replace(/href=(["'])\{\{qr_url\}\}\1/g, `href=$1${values.qrImgUrl}$1`)
    .replace(/\{\{qr_image\}\}/g, values.qrImgUrl)
    .replace(/\{\{qr_url\}\}/g, qrImageHtml);
}

function stripHtml(html: string) {
  return html
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/p>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .trim();
}

function getSupabaseAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

async function markEmailStatus(
  responseId: string | undefined,
  status: "pending" | "sent" | "failed",
  error?: string,
  resendEmailId?: string | null,
) {
  if (!responseId) return;
  const supabase = getSupabaseAdmin();
  if (!supabase) return;

  const now = new Date().toISOString();
  const patch: Record<string, string | null> = {
    email_status: status,
    email_last_attempt_at: now,
    email_sent_at: status === "sent" ? now : null,
    email_error: status === "failed" ? error ?? "Gửi email thất bại" : null,
  };

  if (resendEmailId) {
    patch.resend_email_id = resendEmailId;
  }

  const { error: updateError } = await supabase
    .from("survey_responses")
    .update(patch)
    .eq("id", responseId);

  if (updateError && resendEmailId) {
    const fallbackPatch = { ...patch };
    delete fallbackPatch.resend_email_id;
    await supabase.from("survey_responses").update(fallbackPatch).eq("id", responseId);
  }
}

export async function POST(req: NextRequest) {
  const { to, name, checkinUrl, surveyTitle, customSubject, customBody, mode, responseId, qrStyle } = await req.json();

  if (!to || !checkinUrl) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    await markEmailStatus(responseId, "failed", "RESEND_API_KEY missing");
    return NextResponse.json({ error: "Email not configured", hint: "RESEND_API_KEY missing" }, { status: 500 });
  }

  const isReminder = mode === "reminder";
  const title = String(surveyTitle || "Sự kiện");
  const recipientName = String(name || "bạn");
  const safeTitle = escapeHtml(title);
  const safeName = escapeHtml(recipientName);
  const safeCheckinUrl = escapeHtml(String(checkinUrl));
  const origin = getRequestSiteUrl(req.nextUrl.origin);
  const qrImgUrl = `${origin}${buildQrImagePath(String(checkinUrl), 220, qrStyle as QRBranding | null | undefined)}`;
  const safeQrImgUrl = escapeHtml(qrImgUrl);

  let html: string;
  if (customBody) {
    html = fillEmailBodyTemplate(String(customBody), {
      name: safeName,
      qrImgUrl: safeQrImgUrl,
      checkinUrl: safeCheckinUrl,
      surveyTitle: safeTitle,
    });
  } else {
    const heading = isReminder ? "🔔 Nhắc lịch sự kiện" : "✅ Xác nhận đăng ký thành công";
    const intro = isReminder
      ? "Sự kiện sắp diễn ra. Vui lòng mang theo mã QR check-in bên dưới khi tham dự."
      : "Đăng ký của bạn đã được ghi nhận. Vui lòng xuất trình mã QR bên dưới khi đến sự kiện.";

    html = `
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#334155;line-height:1.55">
        <h2 style="color:#0f172a;margin:0 0 6px;font-size:22px">${heading}</h2>
        <p style="color:#64748b;font-size:14px;margin:0 0 18px">${safeTitle}</p>
        <p style="font-size:15px;margin:0 0 12px">Xin chào <strong>${safeName}</strong>,</p>
        <p style="font-size:14px;margin:0 0 20px">${intro}</p>
        <div style="text-align:center;margin:22px 0">
          <img src="${safeQrImgUrl}" alt="Mã QR check-in" width="220" height="220" style="width:220px;height:220px;border-radius:12px;border:1px solid #e2e8f0" />
        </div>
        <p style="color:#475569;font-size:13px;text-align:center;margin:0 0 6px">📌 Hoặc vào link sau để hiển thị QR:</p>
        <p style="font-size:12px;text-align:center;word-break:break-all;margin:0">
          <a href="${safeCheckinUrl}" style="color:#0f766e">${safeCheckinUrl}</a>
        </p>
        <p style="font-size:13px;color:#64748b;margin:22px 0 0">
          Nếu cần hỗ trợ, vui lòng liên hệ Ban tổ chức qua email
          <a href="mailto:huna2026@hoithaotructuyen.net" style="color:#0f766e">huna2026@hoithaotructuyen.net</a>
          hoặc số điện thoại <a href="tel:0900039870" style="color:#0f766e">0900 039 870</a> - Bình.
        </p>
        <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
        <p style="color:#94a3b8;font-size:11px;text-align:center;margin:0">Email này được gửi từ hệ thống đăng ký ${safeTitle}.</p>
      </div>
    `;
  }

  const subject = customSubject
    ? fillTemplate(String(customSubject), { name: recipientName, survey_title: title }).trim()
    : isReminder
      ? `🔔 Nhắc lịch: ${title}`
      : `✅ Mã check-in: ${title}`;

  const text = [
    isReminder ? "🔔 Nhắc lịch sự kiện" : "✅ Xác nhận đăng ký thành công",
    "",
    title,
    "",
    `Xin chào ${recipientName},`,
    isReminder
      ? "Sự kiện sắp diễn ra. Vui lòng mang theo mã QR check-in khi tham dự."
      : "Đăng ký của bạn đã được ghi nhận. Vui lòng xuất trình mã QR khi đến sự kiện.",
    "",
    `📌 Hoặc vào link sau để hiển thị QR: ${checkinUrl}`,
    "",
    "Nếu cần hỗ trợ, vui lòng liên hệ Ban tổ chức qua email huna2026@hoithaotructuyen.net hoặc số điện thoại 0900 039 870 - Bình.",
    "",
    customBody ? stripHtml(html) : "",
  ].filter(Boolean).join("\n");

  await markEmailStatus(responseId, "pending");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Hội thảo HUNA 2026 <huna2026@hoithaotructuyen.net>",
      to: [to],
      reply_to: process.env.RESEND_REPLY_TO || "huna2026@hoithaotructuyen.net",
      subject,
      html,
      text,
      headers: {
        "X-Entity-Ref-ID": `form-cme-${Date.now()}`,
      },
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    console.error("Resend error:", err);
    await markEmailStatus(responseId, "failed", err);
    return NextResponse.json({ error: "Send failed", detail: err }, { status: 500 });
  }

  const data = await res.json().catch(() => null);
  await markEmailStatus(responseId, "sent", undefined, data?.id ?? null);

  return NextResponse.json({ ok: true, resendId: data?.id ?? null });
}
