import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import nodemailer from "nodemailer";
import { isMergeEmail, type SmtpAccount } from "@/lib/mail-merge";

function key() {
  const secret = process.env.MAIL_MERGE_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Thiếu khóa mã hóa SMTP phía server.");
  return createHash("sha256").update(`form-cme:mail-merge:v1:${secret}`).digest();
}
export function encryptSmtpPassword(password: string, owner: string) {
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(owner));
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), ciphertext.toString("base64")].join(".");
}
export function decryptSmtpPassword(secret: string, owner: string) {
  const [version, iv, tag, ciphertext] = secret.split(".");
  if (version !== "v1" || !iv || !tag || !ciphertext) throw new Error("Không mở được cấu hình SMTP. Nhập lại mật khẩu.");
  try {
    const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    decipher.setAAD(Buffer.from(owner)); decipher.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64")), decipher.final()]).toString("utf8");
  } catch { throw new Error("Không mở được cấu hình SMTP. Nhập lại mật khẩu."); }
}

export function validateSmtpAccount(input: unknown): SmtpAccount {
  if (!input || typeof input !== "object") throw new Error("Nhập cấu hình SMTP.");
  const raw = input as Record<string, unknown>;
  for (const field of ["host", "user", "password", "fromEmail", "fromName", "replyTo"]) {
    if (typeof raw[field] !== "string" || (raw[field] as string).length > 1000 || (field !== "password" && /[\r\n]/.test(raw[field] as string))) throw new Error("Cấu hình SMTP không hợp lệ.");
  }
  const account = { ...raw, host: (raw.host as string).trim().toLowerCase(), user: (raw.user as string).trim(), fromEmail: (raw.fromEmail as string).trim(), fromName: (raw.fromName as string).trim(), replyTo: (raw.replyTo as string).trim() } as SmtpAccount;
  if (!/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/.test(account.host) || account.host.length > 253 || !account.host.includes(".")
    || account.host.includes("..") || !Number.isInteger(account.port) || account.port < 1 || account.port > 65535 || typeof account.secure !== "boolean"
    || !account.user || !isMergeEmail(account.fromEmail) || (account.replyTo && !isMergeEmail(account.replyTo))) throw new Error("Kiểm tra máy chủ, cổng, tài khoản và địa chỉ gửi SMTP.");
  return account;
}

/** User-supplied SMTP hosts must never reach loopback, LAN or metadata services. */
export function isPublicSmtpAddress(address: string) {
  if (isIP(address) === 4) {
    const [a, b] = address.split(".").map(Number);
    return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
      || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && [0, 168].includes(b)) || (a === 198 && [18, 19].includes(b)));
  }
  // Global unicast only; reject mapped IPv4 and local/reserved IPv6.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address) && !/^2001:(db8|0):/i.test(address);
}

async function smtpTransport(account: SmtpAccount) {
  if (!account.password) throw new Error("Nhập mật khẩu SMTP hoặc mật khẩu ứng dụng.");
  const addresses = await lookup(account.host, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !isPublicSmtpAddress(address))) throw new Error("Máy chủ SMTP phải có địa chỉ Internet công khai.");
  const address = addresses.find((item) => item.family === 4) ?? addresses[0];
  return nodemailer.createTransport({
    host: address.address, port: account.port, secure: account.secure, requireTLS: !account.secure,
    tls: { servername: account.host, minVersion: "TLSv1.2" }, auth: { user: account.user, pass: account.password },
    connectionTimeout: 8000, greetingTimeout: 8000, socketTimeout: 12000,
  });
}

export function smtpErrorOutcome(error: unknown): { status: "failed" | "uncertain"; error: string } {
  const issue = error as { code?: string; command?: string; responseCode?: number } | null;
  const definitelyRejected = ["EAUTH", "EENVELOPE", "EDNS", "ECONNREFUSED", "ENOTFOUND"].includes(issue?.code ?? "")
    || ["ECONNECTION", "ESOCKET", "ETIMEDOUT"].includes(issue?.code ?? "") && ["CONN", "EHLO", "HELO", "STARTTLS", "AUTH", "MAIL FROM", "RCPT TO"].includes(issue?.command ?? "")
    || typeof issue?.responseCode === "number" && issue.responseCode >= 400;
  const status = definitelyRejected ? "failed" : "uncertain";
  const message = issue?.code === "EAUTH" ? "SMTP từ chối đăng nhập. Kiểm tra tài khoản / mật khẩu ứng dụng."
    : issue?.code === "EENVELOPE" ? "SMTP từ chối địa chỉ gửi hoặc người nhận."
      : status === "failed" ? "SMTP chưa nhận thư. Kiểm tra cấu hình và kết nối trước khi thử lại."
        : "Chưa xác nhận kết quả SMTP. Kiểm tra hộp thư trước khi gửi lại.";
  return { status, error: message };
}

export async function verifyMergeSmtp(account: SmtpAccount) {
  const transport = await smtpTransport(account);
  try { await transport.verify(); } finally { transport.close(); }
}

export async function sendMergeSmtp(account: SmtpAccount, email: { to: string; subject: string; html: string; text: string }) {
  let transport: Awaited<ReturnType<typeof smtpTransport>>;
  try { transport = await smtpTransport(account); } catch { return { status: "failed" as const, error: "Không kết nối được SMTP. Kiểm tra máy chủ, tài khoản và TLS." }; }
  try {
    const info = await transport.sendMail({ ...email, from: { name: account.fromName, address: account.fromEmail }, replyTo: account.replyTo || undefined,
      disableFileAccess: true, disableUrlAccess: true });
    if (!(info.accepted as string[] | undefined)?.length) return { status: "failed" as const, error: "SMTP từ chối người nhận." };
    return { status: "sent" as const, messageId: String(info.messageId ?? "") };
  } catch (error) { return smtpErrorOutcome(error); } finally {
    // Cleanup must not replace a confirmed SMTP result with a retryable failure.
    try { transport.close(); } catch { /* The send result is already known. */ }
  }
}
