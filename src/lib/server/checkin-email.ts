import { createSupabaseAdmin } from "./supabase-admin";
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
import { resolveProvider, sendEmail, type EmailProviderName } from "./email-provider";

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

export async function markEmailStatus(
  responseId: string | undefined,
  status: "pending" | "sent" | "failed",
  error?: string,
  providerMessageId?: string | null,
  provider?: EmailProviderName,
) {
  if (!responseId) return;
  const supabase = createSupabaseAdmin();
  if (!supabase) return;

  const now = new Date().toISOString();
  const patch: Record<string, string | null> = {
    email_status: status,
    email_last_attempt_at: now,
    email_sent_at: status === "sent" ? now : null,
    email_error: status === "failed" ? error ?? "Gửi email thất bại" : null,
  };

  if (providerMessageId) patch.resend_email_id = providerMessageId;
  if (provider) patch.email_provider = provider;
  if (status === "sent") patch.email_last_event = "sent";

  const { error: updateError } = await supabase.from("survey_responses").update(patch).eq("id", responseId);

  if (updateError) {
    // Retry without columns that may not exist on older projects.
    const fallback: Record<string, string | null> = { ...patch };
    delete fallback.resend_email_id;
    delete fallback.email_provider;
    delete fallback.email_last_event;
    await supabase.from("survey_responses").update(fallback).eq("id", responseId);
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

export type SendCheckinEmailInput = {
  responseId?: string;
  to: string;
  name?: string;
  checkinUrl: string;
  surveyTitle?: string;
  customSubject?: string;
  customBody?: string;
  mode?: string;
  qrStyle?: QRBranding | null;
  answers?: Record<string, unknown>;
  hall?: string;
  origin: string;
  providerOverride?: string | null;
  from?: string | null;
};

async function resolveEventSender(
  supabase: NonNullable<ReturnType<typeof createSupabaseAdmin>>,
  surveyId: string,
): Promise<{ from: string | null; replyTo: string | null }> {
  try {
    const { data } = await supabase
      .from("events")
      .select("from_name, from_email, reply_to")
      .contains("form_ids", [surveyId])
      .limit(1)
      .maybeSingle();
    const row = data as { from_name?: string | null; from_email?: string | null; reply_to?: string | null } | null;
    if (!row?.from_email) return { from: null, replyTo: null };
    return {
      from: row.from_name ? `${row.from_name} <${row.from_email}>` : row.from_email,
      replyTo: row.reply_to || null,
    };
  } catch {
    return { from: null, replyTo: null };
  }
}

export type SendCheckinEmailResult = {
  ok: boolean;
  messageId: string | null;
  provider: EmailProviderName;
  error?: string;
};

export async function sendCheckinEmail(input: SendCheckinEmailInput): Promise<SendCheckinEmailResult> {
  const {
    responseId,
    to,
    name,
    checkinUrl,
    surveyTitle,
    customSubject,
    customBody,
    mode,
    qrStyle,
    answers,
    hall,
    origin,
  } = input;

  if (!to || !checkinUrl) {
    return { ok: false, messageId: null, provider: resolveProvider(input.providerOverride), error: "Missing fields" };
  }

  const supabase = createSupabaseAdmin();
  let resolvedAnswers = (answers ?? {}) as Record<string, unknown>;
  let resolvedHall = String(hall || "");
  let resolvedEmail = String(to || "");
  let resolvedName = String(name || "");
  let resolvedTitle = String(surveyTitle || "Sự kiện");
  let resolvedSubject = String(customSubject || "");
  let resolvedBody = String(customBody || "");
  let resolvedQrStyle = qrStyle as QRBranding | null | undefined;
  let providerOverride = input.providerOverride ?? null;
  let questions: EmailMergeQuestion[] = [];
  let resolvedSurveyId: string | null = null;

  if (supabase && responseId) {
    const { data: response } = await supabase
      .from("survey_responses")
      .select("id, survey_id, answers, email, hall")
      .eq("id", responseId)
      .maybeSingle();

    if (response) {
      resolvedSurveyId = response.survey_id as string;
      resolvedAnswers = (response.answers ?? resolvedAnswers) as Record<string, unknown>;
      resolvedHall = response.hall || resolvedHall;
      resolvedEmail = response.email || resolvedEmail;
      const { data: survey } = await supabase
        .from("surveys")
        .select("title, email_subject, email_body, checkin_theme, email_provider")
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
      providerOverride = providerOverride ?? (survey as { email_provider?: string | null } | null)?.email_provider ?? null;
      if (!resolvedName) resolvedName = findAttendeeName(resolvedAnswers, questions);
    }
  }

  const isReminder = mode === "reminder";
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
      return { ok: false, messageId: null, provider: resolveProvider(providerOverride), error: detail };
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

  let fromOverride = input.from?.trim() || null;
  let replyToOverride: string | null = null;
  // Per-event sender works with Resend (verified domain). SMTP relays (e.g.
  // Gmail) only allow sending as the authenticated account, so skip it there.
  if (supabase && resolvedSurveyId && resolveProvider(providerOverride) === "resend") {
    const sender = await resolveEventSender(supabase, resolvedSurveyId);
    if (sender.from) {
      fromOverride = sender.from;
      replyToOverride = sender.replyTo;
    }
  }

  const result = await sendEmail({
    ...(fromOverride ? { from: fromOverride } : {}),
    ...(replyToOverride ? { replyTo: replyToOverride } : {}),
    to: resolvedEmail,
    subject,
    html,
    text,
    ...(attachments.length > 0 ? { attachments } : {}),
    headers: { "X-Entity-Ref-ID": `form-cme-${Date.now()}` },
  }, providerOverride);

  if (!result.ok) {
    await markEmailStatus(responseId, "failed", result.error, null, result.provider);
    return result;
  }

  await markEmailStatus(responseId, "sent", undefined, result.messageId, result.provider);
  return result;
}
