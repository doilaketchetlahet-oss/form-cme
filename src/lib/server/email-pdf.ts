import { PDFDocument } from "pdf-lib";
import { composeInviteImage } from "@/lib/email-overlay";
import type { EmailOverlay } from "@/lib/email-template";

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
 * Compose a single-page invitation PDF for one attendee: the invitation
 * background image with the placed text fields and QR code.
 */
export async function composeInvitePdf(
  overlay: EmailOverlay,
  values: Record<string, string>,
  checkinUrl: string,
): Promise<Buffer> {
  const jpeg = await composeInviteImage(overlay, values, checkinUrl);
  const doc = await PDFDocument.create();
  const image = await doc.embedJpg(jpeg);
  const page = doc.addPage([image.width, image.height]);
  page.drawImage(image, { x: 0, y: 0, width: image.width, height: image.height });
  const bytes = await doc.save();
  return Buffer.from(bytes);
}
