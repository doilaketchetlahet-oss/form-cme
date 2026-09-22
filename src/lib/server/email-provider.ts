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
      || process.env.SMTP_USER
      || "Form CME <no-reply@localhost>";
  }
  return process.env.RESEND_FROM
    || "Form CME <no-reply@localhost>";
}

export function defaultReplyTo(provider: EmailProviderName = "resend"): string {
  if (provider === "smtp") {
    return process.env.SMTP_REPLY_TO || process.env.SMTP_USER || "";
  }
  return process.env.RESEND_REPLY_TO || "";
}

async function sendViaResend(email: OutgoingEmail): Promise<SendResult> {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    return { ok: false, messageId: null, provider: "resend", error: "RESEND_API_KEY missing" };
  }

  // Resend's REST API expects snake_case fields; camelCase keys are ignored,
  // which silently breaks inline (cid) images.
  const attachments = email.attachments?.map((attachment) => ({
    filename: attachment.filename,
    content: attachment.content,
    ...(attachment.contentType ? { content_type: attachment.contentType } : {}),
    ...(attachment.contentId ? { content_id: attachment.contentId } : {}),
  }));

  const payload = JSON.stringify({
    from: email.from,
    to: [email.to],
    reply_to: email.replyTo,
    subject: email.subject,
    html: email.html,
    text: email.text,
    ...(attachments?.length ? { attachments } : {}),
    headers: email.headers,
  });

  let lastError = "";
  // Resend can answer 429 (rate limit) or a transient 5xx; retry once.
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: payload,
    });

    if (response.ok) {
      const data = await response.json().catch(() => null);
      return { ok: true, messageId: (data?.id as string) ?? null, provider: "resend" };
    }

    lastError = (await response.text()) || `HTTP ${response.status}`;
    if (response.status !== 429 && response.status < 500) break;
    if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 1500));
  }

  return { ok: false, messageId: null, provider: "resend", error: lastError };
}

async function sendViaSmtp(email: OutgoingEmail): Promise<SendResult> {
  const host = process.env.SMTP_HOST;
  const rawPort = process.env.SMTP_PORT?.trim() || "465";
  const port = Number(rawPort);
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) {
    return { ok: false, messageId: null, provider: "smtp", error: "SMTP_HOST / SMTP_USER / SMTP_PASS missing" };
  }
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    return { ok: false, messageId: null, provider: "smtp", error: `SMTP_PORT invalid: ${rawPort}` };
  }

  const rawSecure = process.env.SMTP_SECURE?.trim().toLowerCase();
  let secure = port === 465;
  if (rawSecure) {
    if (["true", "1", "yes", "on"].includes(rawSecure)) secure = true;
    else if (["false", "0", "no", "off"].includes(rawSecure)) secure = false;
    else {
      return { ok: false, messageId: null, provider: "smtp", error: `SMTP_SECURE invalid: ${rawSecure}` };
    }
  }

  const transporter = nodemailer.createTransport({
    host,
    port,
    secure,
    auth: { user, pass },
    // Keep failures inside the API route's 30-second execution window so the
    // admin receives a useful SMTP error instead of a generic function timeout.
    connectionTimeout: 8_000,
    greetingTimeout: 8_000,
    socketTimeout: 12_000,
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
