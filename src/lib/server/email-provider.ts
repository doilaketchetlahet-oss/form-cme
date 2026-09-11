import nodemailer from "nodemailer";

export type EmailProviderName = "resend" | "smtp";

export type EmailAttachmentInput = {
  filename: string;
  content: string; // base64
  contentId?: string;
  contentType?: string;
};

export type OutgoingEmail = {
  from?: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  attachments?: EmailAttachmentInput[];
  headers?: Record<string, string>;
};

export type SendResult = {
  ok: boolean;
  messageId: string | null;
  provider: EmailProviderName;
  error?: string;
};

export function resolveProvider(override?: string | null): EmailProviderName {
  const value = (override || process.env.EMAIL_PROVIDER || "resend").toLowerCase();
  return value === "smtp" ? "smtp" : "resend";
}

export function defaultFrom(provider: EmailProviderName = "resend"): string {
  if (provider === "smtp") {
    return process.env.SMTP_FROM
      || process.env.RESEND_FROM
      || "Form CME <no-reply@localhost>";
  }
  return process.env.RESEND_FROM
    || process.env.SMTP_FROM
    || "Form CME <no-reply@localhost>";
}

export function defaultReplyTo(provider: EmailProviderName = "resend"): string {
  if (provider === "smtp") {
    return process.env.SMTP_REPLY_TO || process.env.SMTP_USER || process.env.RESEND_REPLY_TO || "";
  }
  return process.env.RESEND_REPLY_TO || process.env.SMTP_REPLY_TO || "";
}

async function sendViaResend(email: OutgoingEmail): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, messageId: null, provider: "resend", error: "RESEND_API_KEY missing" };
  }

  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: email.from,
      to: [email.to],
      reply_to: email.replyTo,
      subject: email.subject,
      html: email.html,
      text: email.text,
      ...(email.attachments?.length ? { attachments: email.attachments } : {}),
      headers: email.headers,
    }),
  });

  if (!response.ok) {
    const detail = await response.text();
    return { ok: false, messageId: null, provider: "resend", error: detail || `HTTP ${response.status}` };
  }

  const data = await response.json().catch(() => null);
  return { ok: true, messageId: (data?.id as string) ?? null, provider: "resend" };
}

async function sendViaSmtp(email: OutgoingEmail): Promise<SendResult> {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || "465");
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    return { ok: false, messageId: null, provider: "smtp", error: "SMTP_HOST / SMTP_USER / SMTP_PASS missing" };
  }

  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE !== "false" : port === 465;
  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
  });

  const info = await transporter.sendMail({
    from: email.from,
    to: email.to,
    replyTo: email.replyTo,
    subject: email.subject,
    html: email.html,
    text: email.text,
    headers: email.headers,
    attachments: email.attachments?.map((attachment) => ({
      filename: attachment.filename,
      content: Buffer.from(attachment.content, "base64"),
      contentType: attachment.contentType,
      cid: attachment.contentId,
    })),
  });

  return { ok: true, messageId: info.messageId ?? null, provider: "smtp" };
}

export async function sendEmail(email: OutgoingEmail, override?: string | null): Promise<SendResult> {
  const provider = resolveProvider(override);
  const payload: OutgoingEmail = {
    ...email,
    from: email.from?.trim() || defaultFrom(provider),
    replyTo: email.replyTo?.trim() || defaultReplyTo(provider),
  };
  try {
    if (provider === "smtp") return await sendViaSmtp(payload);
    return await sendViaResend(payload);
  } catch (error) {
    return {
      ok: false,
      messageId: null,
      provider,
      error: error instanceof Error ? error.message : "Gửi email thất bại",
    };
  }
}
