import { isMergeEmail, type MergeResendAccount, type MergeSenderPublic, type SmtpAccount } from "@/lib/mail-merge";
import { decryptSmtpPassword, encryptSmtpPassword, sendMergeSmtp, validateSmtpAccount, verifyMergeSmtp, type MergeSmtpAttachment } from "./mail-merge-smtp";

type StoredSender = { smtp_public: MergeSenderPublic; smtp_secret: string };
export type MergeSender = { provider: "smtp"; account: SmtpAccount } | { provider: "resend"; account: MergeResendAccount };
type MergeMessage = { to: string; subject: string; html: string; text: string; attachments?: MergeSmtpAttachment[] };
type DeliveryResult = { status: "sent" | "failed" | "uncertain"; messageId?: string; error?: string };
const uncertain = (): DeliveryResult => ({ status: "uncertain", error: "Chưa xác nhận kết quả gửi thư. Kiểm tra hộp thư / lịch sử Resend trước khi gửi lại." });

export function prepareMergeSender(body: Record<string, unknown>, stored: StoredSender | null, owner: string) {
  const provider = body.provider ?? "smtp";
  if (provider !== "smtp" && provider !== "resend") throw new Error("Kênh gửi thư không hợp lệ.");
  if (provider === "smtp") {
    const account = validateSmtpAccount(body.smtp);
    if (!account.password && stored?.smtp_public.provider !== "resend" && stored?.smtp_secret) account.password = decryptSmtpPassword(stored.smtp_secret, owner);
    if (!account.password) throw new Error("Nhập mật khẩu SMTP hoặc mật khẩu ứng dụng.");
    const { host, port, secure, user, fromEmail, fromName, replyTo } = account;
    return { sender: { provider, account } as MergeSender, publicAccount: { provider, host, port, secure, user, fromEmail, fromName, replyTo } as MergeSenderPublic, secret: encryptSmtpPassword(account.password, owner) };
  }
  if (!body.resend || typeof body.resend !== "object" || Array.isArray(body.resend)) throw new Error("Nhập cấu hình Resend.");
  const raw = body.resend as Record<string, unknown>;
  if (!["server", "private"].includes(String(raw.keySource))) throw new Error("Chọn nguồn API key Resend.");
  for (const field of ["apiKey", "fromEmail", "fromName", "replyTo"]) {
    if (typeof raw[field] !== "string" || raw[field].length > 1000 || /[\r\n]/.test(raw[field])) throw new Error("Cấu hình Resend không hợp lệ.");
  }
  const account: MergeResendAccount = { keySource: raw.keySource as MergeResendAccount["keySource"], apiKey: (raw.apiKey as string).trim(), fromEmail: (raw.fromEmail as string).trim().toLowerCase(), fromName: (raw.fromName as string).trim(), replyTo: (raw.replyTo as string).trim() };
  if (!isMergeEmail(account.fromEmail) || account.replyTo && !isMergeEmail(account.replyTo) || /[<>]/.test(account.fromName)) throw new Error("Kiểm tra địa chỉ gửi, tên hiển thị và Email nhận trả lời.");
  if (account.keySource === "server") account.apiKey = process.env.RESEND_API_KEY?.trim() || "";
  else if (!account.apiKey && stored?.smtp_public.provider === "resend" && stored.smtp_public.keySource === "private" && stored.smtp_secret) {
    try { account.apiKey = decryptSmtpPassword(stored.smtp_secret, owner); } catch { throw new Error("Không mở được API key Resend đã lưu. Nhập lại khóa."); }
  }
  if (!/^re_[a-zA-Z0-9_-]+$/.test(account.apiKey)) throw new Error(account.keySource === "server" ? "Chưa có RESEND_API_KEY hợp lệ trên server. Chọn API key riêng hoặc cập nhật cấu hình hệ thống." : "Nhập API key Resend hợp lệ (bắt đầu bằng re_).");
  const { keySource, fromEmail, fromName, replyTo } = account;
  return { sender: { provider, account } as MergeSender, publicAccount: { provider, keySource, fromEmail, fromName, replyTo } as MergeSenderPublic, secret: keySource === "private" ? encryptSmtpPassword(account.apiKey, owner) : "" };
}

export function restoreMergeSender(stored: StoredSender, owner: string) {
  const sender = stored.smtp_public;
  return prepareMergeSender(sender.provider === "resend"
    ? { provider: "resend", resend: { ...sender, apiKey: "" } }
    : { provider: "smtp", smtp: { ...sender, password: "" } }, stored, owner).sender;
}

function resendError(status: number, name?: string): DeliveryResult {
  if (status >= 500 || [408, 409].includes(status)) return uncertain();
  const error = status === 401 ? "Resend từ chối API key. Kiểm tra khóa của tài khoản gửi thư."
    : status === 403 ? "Resend từ chối quyền gửi. Kiểm tra API key và tên miền của địa chỉ gửi đã được xác minh."
      : status === 429 ? name === "daily_quota_exceeded" || name === "monthly_quota_exceeded" ? "Đã hết hạn mức gửi Resend. Kiểm tra gói dịch vụ trước khi thử lại." : "Resend đang giới hạn tốc độ gửi. Chờ rồi đưa thư lỗi vào hàng chờ."
        : "Resend chưa nhận thư. Kiểm tra địa chỉ gửi, nội dung và file đính kèm trước khi thử lại.";
  return { status: "failed", error };
}

export async function verifyMergeSender(sender: MergeSender): Promise<{ message: string; limited?: boolean }> {
  if (sender.provider === "smtp") {
    try { await verifyMergeSmtp(sender.account); } catch { throw new Error("Kết nối SMTP chưa thành công. Kiểm tra máy chủ, cổng, TLS và mật khẩu ứng dụng."); }
    return { message: "SMTP kết nối và đăng nhập thành công." };
  }
  const domain = sender.account.fromEmail.split("@")[1];
  let after = "";
  for (let page = 0; page < 5; page++) {
    let response: Response;
    try { response = await fetch(`https://api.resend.com/domains?limit=100${after ? `&after=${encodeURIComponent(after)}` : ""}`, { headers: { Authorization: `Bearer ${sender.account.apiKey}` }, signal: AbortSignal.timeout(10_000) }); }
    catch { throw new Error("Không kết nối được Resend. Thử lại sau."); }
    const data = await response.json().catch(() => null);
    if (response.status === 401 && data?.name === "restricted_api_key" && /only send emails/i.test(data?.message || "")) return { limited: true, message: "Khóa chỉ có quyền gửi thư nên chưa kiểm tra được tên miền. Gửi thử tới Email của bạn để xác nhận quyền gửi." };
    if (!response.ok) throw new Error(resendError(response.status, data?.name).error);
    if (!Array.isArray(data?.data)) throw new Error("Không đọc được trạng thái tên miền từ Resend.");
    const found = data.data.find((item: { name?: unknown } | null) => typeof item?.name === "string" && item.name.toLowerCase() === domain);
    if (found) {
      if (found.status !== "verified" || found.capabilities?.sending === "disabled") throw new Error("Tên miền gửi chưa được xác minh hoặc chưa bật gửi thư trong Resend.");
      return { message: `Resend đã xác minh tên miền ${domain}.` };
    }
    if (!data.has_more || !data.data.at(-1)?.id) break;
    after = data.data.at(-1).id;
  }
  throw new Error("Không tìm thấy tên miền gửi trong tài khoản Resend của API key này.");
}

export async function sendMergeMessage(sender: MergeSender, email: MergeMessage, attempt: string): Promise<DeliveryResult> {
  if (sender.provider === "smtp") return sendMergeSmtp(sender.account, email);
  // Do not pass remote URLs or filesystem paths to the provider. Attachments
  // were already validated and rendered to buffers by the shared resolver.
  if (email.attachments?.some((file) => !Buffer.isBuffer(file.content))) return { status: "failed", error: "File đính kèm chưa được chuẩn bị. Kiểm tra file trước khi thử lại." };
  const attachments = email.attachments?.map((file) => {
    return { filename: file.filename, content: file.content.toString("base64"), ...(file.contentType ? { content_type: file.contentType } : {}), ...(file.cid ? { content_id: file.cid } : {}) };
  });
  const name = sender.account.fromName.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  const payload = JSON.stringify({ from: name ? `"${name}" <${sender.account.fromEmail}>` : sender.account.fromEmail, to: [email.to], subject: email.subject, html: email.html, text: email.text, ...(sender.account.replyTo ? { reply_to: sender.account.replyTo } : {}), ...(attachments?.length ? { attachments } : {}) });
  try {
    const response = await fetch("https://api.resend.com/emails", { method: "POST", redirect: "error", headers: { Authorization: `Bearer ${sender.account.apiKey}`, "Content-Type": "application/json", "Idempotency-Key": `mail-merge/${attempt}` }, body: payload, signal: AbortSignal.timeout(20_000) });
    const data = await response.json().catch(() => null);
    if (!response.ok) return resendError(response.status, data?.name);
    return typeof data?.id === "string" && data.id ? { status: "sent", messageId: data.id } : uncertain();
  } catch { return uncertain(); }
}
