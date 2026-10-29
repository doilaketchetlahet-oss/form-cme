import { PDFDocument } from "pdf-lib";
import sharp from "sharp";
import { composeInviteImage } from "@/lib/email-overlay";
import type { EmailOverlay } from "@/lib/email-template";
import { stampInvitePdfPages, validateInvitePdfOverlay, getInvitePdfPages } from "@/lib/invite-pdf";
import { fetchInvitePdf } from "./invite-pdf-source";

export function sanitizePdfName(name: string) {
  const cleaned = name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim()
    .slice(0, 60);
  return cleaned || "thu-moi";
}

/**
 * Stamp every configured page of the original PDF, preserving other pages.
 * Legacy image templates still produce a single-page invitation.
 */
export async function composeInvitePdf(
  overlay: EmailOverlay,
  values: Record<string, string>,
  checkinUrl: string,
): Promise<Buffer> {
  if (overlay.pdf) {
    validateInvitePdfOverlay(overlay);
    const source = await fetchInvitePdf(overlay.pdf.url);
    const pages = getInvitePdfPages(overlay);
    const targets = Object.keys(pages).map(Number).filter(number => pages[number].fields.length > 0);
    return Buffer.from(await stampInvitePdfPages(source, overlay.pdf, targets,
      number => composeInviteImage(pages[number], values, checkinUrl, true)));
  }
  const jpeg = await composeInviteImage(overlay, values, checkinUrl);
  // Re-encode to sRGB PNG: pdf-lib renders CMYK JPEGs as inverted colours.
  const png = await sharp(jpeg).toColourspace("srgb").png().toBuffer();
  const doc = await PDFDocument.create();
  const image = await doc.embedPng(png);
  const page = doc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  const bytes = await doc.save();
  return Buffer.from(bytes);
}
