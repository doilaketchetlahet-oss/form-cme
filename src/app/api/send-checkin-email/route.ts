import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestSiteUrl } from "@/lib/site-url";
import { buildQrImagePath } from "@/lib/qr-style";
import type { QRBranding } from "@/lib/surveys";
import {
  buildMergeValues,
  compileEmailHtml,
  fillMergeTokens,
  findAttendeeName,
  hasOverlayImage,
  parseEmailTemplate,
  type EmailMergeQuestion,
} from "@/lib/email-template";
import { composeInviteImage, fetchFileAttachments, overlayEmailPayload, type ResendAttachment } from "@/lib/email-overlay";

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

function defaultHtml(values: { heading: string; intro: string; title: string; name: string; qrImgUrl: string; checkinUrl: string }) {
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;padding:24px;color:#334155;line-height:1.55">
      <h2 style="color:#0f172a;margin:0 0 6px;font-size:22px">${values.heading}</h2>
      <p style="color:#64748b;font-size:14px;margin:0 0 18px">${values.title}</p>
      <p style="font-size:15px;margin:0 0 12px">Xin chào <strong>${values.name}</strong>,</p>
      <p style="font-size:14px;margin:0 0 20px">${values.intro}</p>
      <div style="text-align:center;margin:22px 0">
        <img src="${values.qrImgUrl}" alt="Mã QR check-in" width="220" height="220" style="width:220px;height:220px;border-radius:12px;border:1px solid #e2e8f0" />
      </div>
      <p style="color:#475569;font-size:13px;text-align:center;margin:0 0 6px">📌 Hoặc vào link sau để hiển thị QR:</p>
      <p style="font-size:12px;text-align:center;word-break:break-all;margin:0">
        <a href="${values.checkinUrl}" style="color:#0f766e">${values.checkinUrl}</a>
      </p>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0" />
      <p style="color:#94a3b8;font-size:11px;text-align:center;margin:0">Email này được gửi từ hệ thống đăng ký ${values.title}.</p>
    </div>
  `;
}

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const {
    to,
    name,
    checkinUrl,
    surveyTitle,
    customSubject,
    customBody,
    mode,
    responseId,
    qrStyle,
    answers,
    hall,
  } = body;

  if (!to || !checkinUrl) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const RESEND_KEY = process.env.RESEND_API_KEY;
  if (!RESEND_KEY) {
    await markEmailStatus(responseId, "failed", "RESEND_API_KEY missing");
    return NextResponse.json({ error: "Email not configured", hint: "RESEND_API_KEY missing" }, { status: 500 });
  }

  const supabase = getSupabaseAdmin();
  let resolvedAnswers = (answers ?? {}) as Record<string, unknown>;
  let resolvedHall = String(hall || "");
  let resolvedEmail = String(to || "");
  let resolvedName = String(name || "");
  let resolvedTitle = String(surveyTitle || "Sự kiện");
  let resolvedSubject = String(customSubject || "");
  let resolvedBody = String(customBody || "");
  let resolvedQrStyle = qrStyle as QRBranding | null | undefined;
  let questions: EmailMergeQuestion[] = [];

  if (supabase && responseId) {
    const { data: response } = await supabase
      .from("survey_responses")
      .select("id, survey_id, answers, email, hall")
      .eq("id", responseId)
      .maybeSingle();

    if (response) {
      resolvedAnswers = (response.answers ?? resolvedAnswers) as Record<string, unknown>;
      resolvedHall = response.hall || resolvedHall;
      resolvedEmail = response.email || resolvedEmail;
      const { data: survey } = await supabase
        .from("surveys")
        .select("title, email_subject, email_body, checkin_theme")
        .eq("id", response.survey_id)
        .maybeSingle();
      const { data: questionRows } = await supabase
        .from("survey_questions")
        .select("id, text, type, options")
        .eq("survey_id", response.survey_id)
        .order("position");

      questions = (questionRows ?? []) as EmailMergeQuestion[];
      resolvedTitle = survey?.title || resolvedTitle;
      resolvedSubject = resolvedSubject || survey?.email_subject || "";
      resolvedBody = resolvedBody || survey?.email_body || "";
      resolvedQrStyle = resolvedQrStyle ?? (survey?.checkin_theme as { qr?: QRBranding } | null)?.qr;
      if (!resolvedName) resolvedName = findAttendeeName(resolvedAnswers, questions);
    }
  }

  const isReminder = mode === "reminder";
  const origin = getRequestSiteUrl(req.nextUrl.origin);
  const qrImgUrl = `${origin}${buildQrImagePath(String(checkinUrl), 220, resolvedQrStyle)}`;
  const mergeInput = {
    name: resolvedName,
    email: resolvedEmail,
    hall: resolvedHall,
    surveyTitle: resolvedTitle,
    checkinUrl: String(checkinUrl),
    qrImgUrl,
    answers: resolvedAnswers,
    questions,
  };
  const htmlValues = buildMergeValues(mergeInput, true);
  const textValues = buildMergeValues(mergeInput, false);

  let html = compileEmailHtml(resolvedBody, htmlValues, qrImgUrl);
  const attachments: ResendAttachment[] = [];
  const template = parseEmailTemplate(resolvedBody);
  if (hasOverlayImage(resolvedBody) && template.overlay) {
    try {
      const jpeg = await composeInviteImage(template.overlay, textValues, String(checkinUrl));
      attachments.push(...overlayEmailPayload(jpeg).attachments);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Ghép ảnh thiệp thất bại";
      await markEmailStatus(responseId, "failed", detail);
      return NextResponse.json({ error: "Compose failed", detail }, { status: 500 });
    }
  }
  if (template.attachments && template.attachments.length > 0) {
    attachments.push(...await fetchFileAttachments(template.attachments));
  }
  if (!html && attachments.length === 0) {
    html = defaultHtml({
      heading: isReminder ? "🔔 Nhắc lịch sự kiện" : "✅ Xác nhận đăng ký thành công",
      intro: isReminder
        ? "Sự kiện sắp diễn ra. Vui lòng mang theo mã QR check-in bên dưới khi tham dự."
        : "Đăng ký của bạn đã được ghi nhận. Vui lòng xuất trình mã QR bên dưới khi đến sự kiện.",
      title: htmlValues.survey_title,
      name: htmlValues.name,
      qrImgUrl: htmlValues.qr_image,
      checkinUrl: htmlValues.checkin_url,
    });
  }

  const subject = resolvedSubject
    ? fillMergeTokens(resolvedSubject, textValues).trim()
    : isReminder
      ? `🔔 Nhắc lịch: ${resolvedTitle}`
      : `✅ Mã check-in: ${resolvedTitle}`;

  const text = stripHtml(html) || [
    isReminder ? "Nhắc lịch sự kiện" : "Xác nhận đăng ký thành công",
    resolvedTitle,
    `Xin chào ${textValues.name}`,
    `Link check-in: ${checkinUrl}`,
  ].join("\n");

  await markEmailStatus(responseId, "pending");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${RESEND_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: process.env.RESEND_FROM || "Hội thảo HUNA 2026 <huna2026@hoithaotructuyen.net>",
      to: [resolvedEmail],
      reply_to: process.env.RESEND_REPLY_TO || "huna2026@hoithaotructuyen.net",
      subject,
      html,
      text,
      ...(attachments.length > 0 ? { attachments } : {}),
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
