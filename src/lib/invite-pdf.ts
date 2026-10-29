import { PDFDocument, degrees } from "pdf-lib";
import type { EmailOverlay } from "./email-template";

export const MAX_INVITE_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_INVITE_PDF_PAGES = 100;

export function validateInvitePdf(pdf: EmailOverlay["pdf"]) {
  if (!pdf) return;
  if (typeof pdf.url !== "string" || pdf.url.length > 2048 || typeof pdf.name !== "string" || pdf.name.length > 255
    || !Number.isInteger(pdf.pageCount) || pdf.pageCount < 1 || pdf.pageCount > MAX_INVITE_PDF_PAGES
    || !Number.isInteger(pdf.page) || pdf.page < 1 || pdf.page > pdf.pageCount) throw new Error("Thông tin trang PDF không hợp lệ.");
  const url = new URL(pdf.url);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("PDF gốc phải dùng HTTPS.");
}

/** Add a transparent field layer to the displayed crop box. All source pages,
 * vectors, links and annotations remain in the original document. */
export async function stampInvitePdf(source: Uint8Array, layer: Uint8Array | string, pdf: NonNullable<EmailOverlay["pdf"]>) {
  validateInvitePdf(pdf);
  if (source.byteLength > MAX_INVITE_PDF_BYTES) throw new Error("PDF gốc vượt quá 10MB.");
  const doc = await PDFDocument.load(source);
  if (doc.getPageCount() !== pdf.pageCount) throw new Error("Số trang PDF gốc đã thay đổi. Vui lòng tải lại mẫu.");
  const page = doc.getPage(pdf.page - 1);
  const media = page.getMediaBox(), crop = page.getCropBox();
  // PDF.js previews the intersection of CropBox and MediaBox.
  const x = Math.max(media.x, crop.x), y = Math.max(media.y, crop.y);
  const width = Math.min(media.x + media.width, crop.x + crop.width) - x;
  const height = Math.min(media.y + media.height, crop.y + crop.height) - y;
  if (width <= 0 || height <= 0) throw new Error("Kích thước trang PDF không hợp lệ.");
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  if (![0, 90, 180, 270].includes(rotation)) throw new Error("Góc xoay trang PDF không được hỗ trợ.");
  const image = await doc.embedPng(layer);
  const origin = rotation === 90 ? { x: x + width, y } : rotation === 180 ? { x: x + width, y: y + height } : rotation === 270 ? { x, y: y + height } : { x, y };
  page.drawImage(image, { ...origin, width: rotation % 180 ? height : width, height: rotation % 180 ? width : height, rotate: degrees(rotation) });
  return doc.save();
}
