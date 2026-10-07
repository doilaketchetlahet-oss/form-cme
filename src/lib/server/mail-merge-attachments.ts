import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import sharp from "sharp";
import type { EmailAttachment, EmailOverlay } from "@/lib/email-template";
import { composeInviteImage } from "@/lib/email-overlay";
import { composeInvitePdf } from "@/lib/server/email-pdf";
import type { MergeSmtpAttachment } from "@/lib/server/mail-merge-smtp";
import type { MergeTemplate } from "@/lib/mail-merge";

/**
 * The merge UI stores uploaded files as the same public storage metadata as
 * the existing email-template editor. Keep this shape compatible so a file
 * can be moved between the two composers without conversion.
 */
export type MailMergeFileAttachment = Pick<EmailAttachment, "name" | "url" | "size" | "type"> & {
  id?: string;
};

export type MailMergeCardAttachment = {
  overlay: EmailOverlay;
  /** Values are the raw row values, keyed without `{{` / `}}`. */
  values: Record<string, string>;
  checkinUrl?: string;
  image?: boolean;
  pdf?: boolean;
  filename?: string;
};

export type MailMergeAttachmentInput = {
  files?: MailMergeFileAttachment[];
  card?: MailMergeCardAttachment | null;
};

const MAX_FILES = 10;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_TOTAL_BYTES = 20 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 12_000;

function publicIpv4(address: string) {
  const values = address.split(".").map(Number);
  if (values.length !== 4 || values.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [a, b] = values;
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168) || (a === 198 && [18, 19].includes(b)));
}

function publicIpv6(address: string) {
  // Global unicast IPv6 starts with 2 or 3. Link-local, unique-local and
  // mapped IPv4 addresses are therefore rejected before an outbound fetch.
  return isIP(address) === 6 && /^[23][0-9a-f]{3}:/i.test(address)
    && !/^2001:(db8|0):/i.test(address);
}

function publicAddress(address: string) {
  return isIP(address) === 4 ? publicIpv4(address) : publicIpv6(address);
}

function storageHost() {
  const raw = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (!raw) throw new Error("Thiếu địa chỉ Supabase để tải file đính kèm.");
  try { return new URL(raw).hostname.toLowerCase(); } catch { throw new Error("Địa chỉ Supabase không hợp lệ."); }
}

/** Only our configured Supabase public storage host is accepted. Redirects are
 * disabled below so an otherwise trusted URL cannot jump to a private host. */
async function assertStorageUrl(raw: string) {
  let parsed: URL;
  try { parsed = new URL(raw); } catch { throw new Error("URL file đính kèm không hợp lệ."); }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("File đính kèm phải dùng HTTPS.");
  if (parsed.hostname.toLowerCase() !== storageHost()) throw new Error("File đính kèm phải nằm trong kho lưu trữ của dự án.");
  const addresses = await lookup(parsed.hostname, { all: true });
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address))) throw new Error("Không thể tải file đính kèm từ địa chỉ này.");
  return parsed;
}

async function fetchStorageBuffer(rawUrl: string, expectedSize?: number) {
  const parsed = await assertStorageUrl(rawUrl);
  if (expectedSize && (expectedSize < 0 || expectedSize > MAX_FILE_BYTES)) throw new Error("File đính kèm vượt quá 10MB.");
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(parsed, { redirect: "error", signal: controller.signal });
    if (!response.ok) throw new Error("Không tải được file đính kèm từ kho lưu trữ.");
    const announced = Number(response.headers.get("content-length") || 0);
    if (announced > MAX_FILE_BYTES) throw new Error("File đính kèm vượt quá 10MB.");
    if (!response.body) throw new Error("Không tải được file đính kèm từ kho lưu trữ.");
    const reader = response.body.getReader();
    const chunks: Buffer[] = [];
    let total = 0;
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      total += part.value.byteLength;
      if (total > MAX_FILE_BYTES) {
        await reader.cancel().catch(() => {});
        throw new Error("File đính kèm vượt quá 10MB.");
      }
      chunks.push(Buffer.from(part.value));
    }
    return Buffer.concat(chunks, total);
  } catch (error) {
    if (error instanceof Error && error.message.includes("vượt quá")) throw error;
    throw new Error("Không tải được file đính kèm từ kho lưu trữ.");
  } finally {
    clearTimeout(timer);
  }
}

function safeFilename(name: string, fallback: string) {
  const cleaned = String(name || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[\\/:*?"<>|\r\n\u0000]+/g, "-")
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\s+/g, " ").replace(/^[-. ]+|[-. ]+$/g, "")
    .slice(0, 120);
  return cleaned || fallback;
}

function attachmentType(type?: string) {
  const value = String(type || "").trim().toLowerCase();
  return /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/.test(value) ? value : "application/octet-stream";
}

function baseName(filename: string) {
  const noExt = filename.replace(/\.[a-z0-9]{1,8}$/i, "");
  return safeFilename(noExt, "thiep-moi");
}

function hasExtension(filename: string, extension: string) {
  return new RegExp(`\\.${extension}$`, "i").test(filename);
}

/**
 * Resolve all files for one merge row. This intentionally returns in-memory
 * buffers for Nodemailer; SMTP's `disableFileAccess`/`disableUrlAccess` then
 * guarantees that no file path or remote URL is opened during send.
 */
export async function resolveMailMergeAttachments(input: MailMergeAttachmentInput): Promise<MergeSmtpAttachment[]> {
  const files = Array.isArray(input.files) ? input.files : [];
  const includeCard = !!input.card && (!!input.card.image || !!input.card.pdf);
  if (files.length + (includeCard ? (input.card?.image && input.card.pdf ? 2 : 1) : 0) > MAX_FILES) {
    throw new Error(`Tối đa ${MAX_FILES} file đính kèm cho mỗi thư.`);
  }

  const result: MergeSmtpAttachment[] = [];
  let total = 0;
  const add = (attachment: MergeSmtpAttachment) => {
    if (attachment.content.length > MAX_FILE_BYTES || total + attachment.content.length > MAX_TOTAL_BYTES) {
      throw new Error("Tổng file đính kèm vượt quá 20MB cho mỗi thư.");
    }
    total += attachment.content.length;
    result.push(attachment);
  };

  for (const file of files) {
    if (!file || typeof file.url !== "string" || typeof file.name !== "string") throw new Error("Thông tin file đính kèm không hợp lệ.");
    const content = await fetchStorageBuffer(file.url, Number(file.size) || undefined);
    add({ filename: safeFilename(file.name, "tep-dinh-kem"), content, contentType: attachmentType(file.type) });
  }

  const card = input.card;
  if (card && includeCard) {
    if (!card.overlay?.imageUrl || !Array.isArray(card.overlay.fields)) throw new Error("Thiệp cá nhân hóa chưa có ảnh nền hợp lệ.");
    // composeInviteImage/composeInvitePdf fetch the background themselves;
    // validate its URL first to keep their legacy helpers safe for merge use.
    await assertStorageUrl(card.overlay.imageUrl);
    const stem = baseName(card.filename || "thiep-moi");
    const checkinUrl = card.checkinUrl || "";
    if (card.image) {
      const content = await composeInviteImage(card.overlay, card.values, checkinUrl);
      add({ filename: hasExtension(stem, "jpg") ? stem : `${stem}.jpg`, content, contentType: "image/jpeg" });
    }
    if (card.pdf) {
      const content = await composeInvitePdf(card.overlay, card.values, checkinUrl);
      add({ filename: hasExtension(stem, "pdf") ? stem : `${stem}.pdf`, content, contentType: "application/pdf" });
    }
  }
  return result;
}

/** Adapter used by the API: keeps the persisted merge-template shape out of
 * the lower-level file/card resolver and makes the card mode explicit. */
export async function resolveMailMergeTemplateAttachments(
  template: Pick<MergeTemplate, "attachments" | "card" | "cardAttachment">,
  values: Record<string, string>,
  checkinUrl = "",
) {
  const mode = template.cardAttachment || "none";
  return resolveMailMergeAttachments({
    files: template.attachments,
    card: template.card && mode !== "none"
      ? {
        overlay: template.card,
        values,
        checkinUrl,
        image: mode === "jpg" || mode === "both",
        pdf: mode === "pdf" || mode === "both",
      }
      : null,
  });
}

/** Small helper for callers that only need to estimate a generated card. */
export async function composeMailMergeCardImage(card: MailMergeCardAttachment) {
  if (!card.overlay?.imageUrl) throw new Error("Thiệp cá nhân hóa chưa có ảnh nền.");
  await assertStorageUrl(card.overlay.imageUrl);
  return sharp(await composeInviteImage(card.overlay, card.values, card.checkinUrl || ""))
    .toColourspace("srgb").jpeg({ quality: 88 }).toBuffer();
}

