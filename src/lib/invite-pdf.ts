import { PDFDocument, degrees } from "pdf-lib";
import type { EmailOverlay, EmailOverlayPage } from "./email-template";

export const MAX_INVITE_PDF_BYTES = 10 * 1024 * 1024;
export const MAX_INVITE_PDF_PAGES = 100;

/** Old single-page templates map to their saved page without rewriting storage.
 * The active editor page always wins over a previously cached snapshot. */
export function getInvitePdfPages(overlay: EmailOverlay): Record<string, EmailOverlayPage> {
  const { imageUrl, width, height, fields } = overlay;
  return { ...overlay.pdf?.pages, [overlay.pdf?.page ?? 1]: { imageUrl, width, height, fields } };
}

export function validateInvitePdfOverlay(overlay: EmailOverlay) {
  validateInvitePdf(overlay.pdf);
  if (!overlay.pdf) return;
  if (overlay.pdf.pages !== undefined && (!overlay.pdf.pages || typeof overlay.pdf.pages !== "object" || Array.isArray(overlay.pdf.pages))) throw new Error("Danh sách trang PDF không hợp lệ.");
  let total = 0;
  for (const [number, page] of Object.entries(getInvitePdfPages(overlay))) {
    if (!/^[1-9]\d*$/.test(number) || Number(number) > overlay.pdf.pageCount || !page
      || !Number.isInteger(page.width) || !Number.isInteger(page.height) || page.width < 1 || page.height < 1 || page.width * page.height > 16_000_000
      || typeof page.imageUrl !== "string" || page.imageUrl.length > 2048 || !Array.isArray(page.fields) || page.fields.length > 40) throw new Error("Cấu hình trang PDF không hợp lệ.");
    total += page.fields.length;
    for (const field of page.fields) {
      if (!field || typeof field.id !== "string" || typeof field.token !== "string" || !["text", "qr"].includes(field.kind)
        || ![field.x, field.y, field.w, field.h].every(Number.isFinite)
        || field.x < 0 || field.y < 0 || field.w <= 0 || field.h <= 0 || field.x + field.w > 100.001 || field.y + field.h > 100.001) throw new Error("Vị trí trường PDF không hợp lệ.");
    }
  }
  if (total > 400) throw new Error("Tối đa 400 trường trên toàn bộ PDF.");
}

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
  return stampInvitePdfPages(source, pdf, [pdf.page], async () => layer);
}

/** Render and stamp one page at a time, loading/saving the original only once. */
export async function stampInvitePdfPages(source: Uint8Array, pdf: NonNullable<EmailOverlay["pdf"]>, pages: number[], render: (page: number) => Promise<Uint8Array | string>) {
  validateInvitePdf(pdf);
  if (source.byteLength > MAX_INVITE_PDF_BYTES) throw new Error("PDF gốc vượt quá 10MB.");
  const doc = await PDFDocument.load(source);
  if (doc.getPageCount() !== pdf.pageCount) throw new Error("Số trang PDF gốc đã thay đổi. Vui lòng tải lại mẫu.");
  if (new Set(pages).size !== pages.length || pages.some(number => !Number.isInteger(number) || number < 1 || number > pdf.pageCount)) throw new Error("Trang cá nhân hóa không hợp lệ.");
  for (const number of pages) {
    const page = doc.getPage(number - 1);
    const media = page.getMediaBox(), crop = page.getCropBox();
    // PDF.js previews the intersection of CropBox and MediaBox.
    const x = Math.max(media.x, crop.x), y = Math.max(media.y, crop.y);
    const width = Math.min(media.x + media.width, crop.x + crop.width) - x;
    const height = Math.min(media.y + media.height, crop.y + crop.height) - y;
    if (width <= 0 || height <= 0) throw new Error("Kích thước trang PDF không hợp lệ.");
    const rotation = ((page.getRotation().angle % 360) + 360) % 360;
    if (![0, 90, 180, 270].includes(rotation)) throw new Error("Góc xoay trang PDF không được hỗ trợ.");
    const image = await doc.embedPng(await render(number));
    const origin = rotation === 90 ? { x: x + width, y } : rotation === 180 ? { x: x + width, y: y + height } : rotation === 270 ? { x, y: y + height } : { x, y };
    page.drawImage(image, { ...origin, width: rotation % 180 ? height : width, height: rotation % 180 ? width : height, rotate: degrees(rotation) });
  }
  return doc.save();
}
