import fontkit from "@pdf-lib/fontkit";
import QRCode from "qrcode";
import { PDFDocument, PDFFont, PDFPage, TextRenderingMode, concatTransformationMatrix, popGraphicsState, pushGraphicsState, rgb, setLineWidth, setStrokingRgbColor, setTextRenderingMode } from "pdf-lib";
import type { EmailOverlay, EmailOverlayPage } from "./email-template";
import { getInvitePdfPages, MAX_INVITE_PDF_BYTES, validateInvitePdfOverlay } from "./invite-pdf";

export type InviteFontLoader = (id: string | undefined, bold: boolean) => Promise<Uint8Array>;

/** Same vector renderer for downloaded PDFs and email attachments. Coordinates
 * remain in saved preview pixels; only the page transform converts them to points. */
export async function renderVectorInvitePdf(
  overlay: EmailOverlay,
  values: Record<string, string>,
  checkinUrl: string,
  loadFont: InviteFontLoader,
  assets: { original?: Uint8Array; background?: Uint8Array },
): Promise<Uint8Array> {
  validateInvitePdfOverlay(overlay);
  if (overlay.pdf && !assets.original) throw new Error("Không tải được PDF gốc.");
  if (assets.original && assets.original.byteLength > MAX_INVITE_PDF_BYTES) throw new Error("PDF gốc vượt quá 10MB.");
  const doc = assets.original ? await PDFDocument.load(assets.original) : await PDFDocument.create();
  doc.registerFontkit(fontkit);
  if (overlay.pdf && doc.getPageCount() !== overlay.pdf.pageCount) throw new Error("Số trang PDF gốc đã thay đổi. Vui lòng tải lại mẫu.");
  if (!overlay.pdf) {
    if (!assets.background) throw new Error("Không tải được ảnh thiệp.");
    const image = assets.background[0] === 0x89 ? await doc.embedPng(assets.background) : await doc.embedJpg(assets.background);
    const page = doc.addPage([overlay.width || image.width, overlay.height || image.height]);
    page.drawImage(image, { x: 0, y: 0, width: page.getWidth(), height: page.getHeight() });
  }
  const fonts = new Map<string, { font: PDFFont; ascent: number; descent: number; units: number; syntheticBold: boolean }>();
  const layouts = overlay.pdf ? getInvitePdfPages(overlay) : { 1: overlay };
  for (const [number, layout] of Object.entries(layouts)) {
    if (!layout.fields.length) continue;
    const page = doc.getPage(Number(number) - 1);
    transformPage(page, layout);
    for (const field of layout.fields) {
      const key = field.token.replace(/^\{\{|\}\}$/g, "").trim();
      const left = field.x / 100 * layout.width, top = field.y / 100 * layout.height;
      const width = Math.max(8, field.w / 100 * layout.width), height = Math.max(8, field.h / 100 * layout.height);
      const alignOffset = (size: number) => field.align === "center" ? (width - size) / 2 : field.align === "right" ? width - size : 0;
      if (field.kind === "qr" || key === "qr_url" || key === "qr_image") {
        const size = Math.max(48, Math.round(Math.min(width, height)));
        const qr = QRCode.create(checkinUrl || values.checkin_url || "preview", { errorCorrectionLevel: "M" });
        const cell = size / (qr.modules.size + 2), x = left + alignOffset(size), y = layout.height - top - (height + size) / 2;
        page.drawRectangle({ x, y, width: size, height: size, color: rgb(1, 1, 1) });
        // Merge adjacent modules into runs: crisp vector QR with compact streams.
        for (let row = 0; row < qr.modules.size; row++) {
          for (let col = 0; col < qr.modules.size; col++) {
            if (!qr.modules.get(row, col)) continue;
            const start = col;
            while (col + 1 < qr.modules.size && qr.modules.get(row, col + 1)) col++;
            page.drawRectangle({ x: x + (start + 1) * cell, y: y + (qr.modules.size - row) * cell, width: (col - start + 1) * cell, height: cell, color: rgb(15 / 255, 23 / 255, 42 / 255) });
          }
        }
        continue;
      }
      const text = (values[key] ?? "").replace(/[\r\n\t]/g, " ").normalize("NFC");
      if (!text.trim()) continue;
      const fontKey = `${field.fontFamily || "noto-sans"}:${!!field.bold}`;
      let resolved = fonts.get(fontKey);
      if (!resolved) {
        const bytes = await loadFont(field.fontFamily, !!field.bold);
        const metrics = fontkit.create(bytes);
        resolved = { font: await doc.embedFont(bytes, { subset: true }), ascent: metrics.ascent, descent: metrics.descent, units: metrics.unitsPerEm,
          syntheticBold: !!field.fontFamily?.startsWith("custom:") && !!field.bold && !/bold|black|heavy|semibold/i.test(metrics.subfamilyName || "") };
        fonts.set(fontKey, resolved);
      }
      const { font, ascent, descent, units } = resolved;
      const supported = new Set(font.getCharacterSet());
      if ([...text].some(char => !supported.has(char.codePointAt(0)!))) throw new Error("Font đã chọn thiếu ký tự trong nội dung. Vui lòng chọn font có đủ dấu tiếng Việt.");
      let size = Math.max(12, Math.min(200, Number(field.fontSize) || Math.round(height * 0.55)));
      const measured = font.widthOfTextAtSize(text, size);
      if (measured > width) size *= width / measured;
      const inkWidth = font.widthOfTextAtSize(text, size);
      const color = /^#[0-9a-f]{6}$/i.test(field.color || "") ? field.color! : "#0f172a";
      const red = parseInt(color.slice(1, 3), 16) / 255, green = parseInt(color.slice(3, 5), 16) / 255, blue = parseInt(color.slice(5, 7), 16) / 255;
      page.pushOperators(pushGraphicsState());
      // Uploaded regular fonts have no separate bold file; preserve the editor's
      // synthetic bold using a vector stroke, never a raster fallback.
      if (resolved.syntheticBold) page.pushOperators(setLineWidth(size * 0.025), setStrokingRgbColor(red, green, blue), setTextRenderingMode(TextRenderingMode.FillAndOutline));
      page.drawText(text, {
        x: left + alignOffset(inkWidth), y: layout.height - top - height / 2 - (ascent + descent) / units * size / 2,
        font, size, color: rgb(red, green, blue),
      });
      page.pushOperators(popGraphicsState());
    }
    page.pushOperators(popGraphicsState());
  }
  return doc.save();
}

function transformPage(page: PDFPage, layout: EmailOverlayPage) {
  const media = page.getMediaBox(), crop = page.getCropBox();
  const x = Math.max(media.x, crop.x), y = Math.max(media.y, crop.y);
  const width = Math.min(media.x + media.width, crop.x + crop.width) - x;
  const height = Math.min(media.y + media.height, crop.y + crop.height) - y;
  const rotation = ((page.getRotation().angle % 360) + 360) % 360;
  if (width <= 0 || height <= 0 || layout.width <= 0 || layout.height <= 0 || ![0, 90, 180, 270].includes(rotation)) throw new Error("Kích thước/góc xoay trang PDF không hợp lệ.");
  const sx = (rotation % 180 ? height : width) / layout.width, sy = (rotation % 180 ? width : height) / layout.height;
  const matrix: [number, number, number, number, number, number] = rotation === 90 ? [0, sx, -sy, 0, x + width, y]
    : rotation === 180 ? [-sx, 0, 0, -sy, x + width, y + height]
    : rotation === 270 ? [0, -sx, sy, 0, x, y + height] : [sx, 0, 0, sy, x, y];
  page.pushOperators(pushGraphicsState(), concatTransformationMatrix(...matrix));
}
