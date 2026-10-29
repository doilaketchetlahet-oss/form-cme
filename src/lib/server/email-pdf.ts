import sharp from "sharp";
import type { EmailOverlay } from "@/lib/email-template";
import { renderVectorInvitePdf } from "@/lib/invite-pdf-vector";
import { loadInviteFont } from "./invite-fonts";
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
    const source = await fetchInvitePdf(overlay.pdf.url);
    return Buffer.from(await renderVectorInvitePdf(overlay, values, checkinUrl, loadInviteFont, { original: source }));
  }
  const response = await fetch(overlay.imageUrl);
  if (!response.ok) throw new Error("Không tải được ảnh thiệp.");
  // Only the background remains raster; text and QR are always vectors.
  const background = await sharp(Buffer.from(await response.arrayBuffer())).rotate().toColourspace("srgb").png().toBuffer();
  return Buffer.from(await renderVectorInvitePdf(overlay, values, checkinUrl, loadInviteFont, { background }));
}
