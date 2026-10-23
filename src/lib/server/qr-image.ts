import { readFile } from "node:fs/promises";
import path from "node:path";
import QRCode from "qrcode";
import sharp from "sharp";
import { normalizeQrBranding } from "@/lib/qr-style";
import type { QRBranding } from "@/lib/surveys";

export type QrRenderStyle = {
  darkColor: string;
  accentColor: string;
  lightColor: string;
  logoEnabled: boolean;
  logoUrl: string | null;
  logoSize: number;
  moduleRadius: number;
};

/** Content-ID used when the QR is attached inline to an email. */
export const QR_INLINE_CONTENT_ID = "qrcheckin";

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function roundedRect(x: number, y: number, width: number, height: number, radius: number, fill: string) {
  const r = Math.min(radius, width / 2, height / 2);
  return `<rect x="${x.toFixed(3)}" y="${y.toFixed(3)}" width="${width.toFixed(3)}" height="${height.toFixed(3)}" rx="${r.toFixed(3)}" ry="${r.toFixed(3)}" fill="${fill}" />`;
}

const MAX_LOGO_BYTES = 1_000_000;
const LOGO_FETCH_TIMEOUT_MS = 3000;

function hostOf(value: string | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).host;
  } catch {
    return null;
  }
}

/** Only our own Supabase storage or site may be fetched server-side (SSRF guard). */
function isAllowedLogoHost(url: URL): boolean {
  const allowed = [hostOf(process.env.NEXT_PUBLIC_SUPABASE_URL), hostOf(process.env.NEXT_PUBLIC_SITE_URL)].filter(Boolean);
  return allowed.includes(url.host);
}

async function loadLogoDataUri(logoUrl: string | null) {
  try {
    let contentType = "image/png";
    let buffer: Buffer;

    if (logoUrl && /^https?:\/\//i.test(logoUrl)) {
      const parsed = new URL(logoUrl);
      if (!isAllowedLogoHost(parsed)) throw new Error("Logo host not allowed");

      const response = await fetch(parsed, { signal: AbortSignal.timeout(LOGO_FETCH_TIMEOUT_MS) });
      if (!response.ok) throw new Error("Cannot load remote QR logo");

      const type = (response.headers.get("content-type") || "").split(";")[0].trim();
      if (!/^image\//i.test(type)) throw new Error("Logo is not an image");

      const declared = Number(response.headers.get("content-length") || 0);
      if (declared > MAX_LOGO_BYTES) throw new Error("Logo too large");

      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length > MAX_LOGO_BYTES) throw new Error("Logo too large");

      contentType = type;
      buffer = bytes;
    } else {
      const logoPath = path.join(process.cwd(), "public", "logo_qr.png");
      buffer = await readFile(logoPath);
    }

    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

export function qrRenderStyle(input?: {
  darkColor?: string | null;
  accentColor?: string | null;
  lightColor?: string | null;
  logoEnabled?: boolean;
  logoUrl?: string | null;
  logoSize?: number;
  moduleRadius?: number;
} | null): QrRenderStyle {
  return normalizeQrBranding({
    ...input,
    darkColor: input?.darkColor ?? undefined,
    accentColor: input?.accentColor ?? undefined,
    lightColor: input?.lightColor ?? undefined,
  });
}

export function qrStyleFromBranding(qr?: QRBranding | null): QrRenderStyle {
  const normalized = normalizeQrBranding(qr);
  return qrRenderStyle(normalized);
}

export async function renderQrSvg(value: string, size: number, style: QrRenderStyle) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "H" });
  const moduleCount = qr.modules.size;
  const margin = 4;
  const cell = size / (moduleCount + margin * 2);
  const moduleRadius = Math.max(0, cell * (style.moduleRadius / 100));
  const square = style.moduleRadius === 0;
  const finderRadius = square ? 0 : cell * 1.1;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code">`,
    roundedRect(0, 0, size, size, square ? 0 : 18, style.lightColor),
  ];

  const finderStarts = [
    [0, 0],
    [moduleCount - 7, 0],
    [0, moduleCount - 7],
  ];

  const isFinder = (row: number, col: number) =>
    finderStarts.some(([startCol, startRow]) => col >= startCol && col < startCol + 7 && row >= startRow && row < startRow + 7);

  for (let row = 0; row < moduleCount; row += 1) {
    for (let col = 0; col < moduleCount; col += 1) {
      if (!qr.modules.get(row, col) || isFinder(row, col)) continue;
      const x = (col + margin) * cell;
      const y = (row + margin) * cell;
      const fill = (row + col) % 7 === 0 ? style.accentColor : style.darkColor;
      const inset = square ? 0 : cell * 0.08;
      parts.push(roundedRect(x + inset, y + inset, cell - inset * 2, cell - inset * 2, moduleRadius, fill));
    }
  }

  finderStarts.forEach(([col, row]) => {
    const x = (col + margin) * cell;
    const y = (row + margin) * cell;
    parts.push(roundedRect(x, y, cell * 7, cell * 7, finderRadius, style.darkColor));
    parts.push(roundedRect(x + cell, y + cell, cell * 5, cell * 5, finderRadius * 0.72, style.lightColor));
    parts.push(roundedRect(x + cell * 2, y + cell * 2, cell * 3, cell * 3, finderRadius * 0.48, style.accentColor));
  });

  if (style.logoEnabled) {
    const logoDataUri = await loadLogoDataUri(style.logoUrl);
    if (logoDataUri) {
      const logoSize = size * (style.logoSize / 100);
      const padding = size * 0.026;
      const boxSize = logoSize + padding * 2;
      const left = (size - boxSize) / 2;
      const top = (size - boxSize) / 2;
      parts.push(roundedRect(left, top, boxSize, boxSize, boxSize * 0.22, "#ffffff"));
      parts.push(`<image href="${escapeXml(logoDataUri)}" x="${(left + padding).toFixed(3)}" y="${(top + padding).toFixed(3)}" width="${logoSize.toFixed(3)}" height="${logoSize.toFixed(3)}" preserveAspectRatio="xMidYMid meet" />`);
    }
  }

  parts.push("</svg>");
  return parts.join("");
}

/**
 * Rasterize the QR to PNG. Email clients such as Outlook on Windows do not
 * render SVG images, so emails must link/attach a bitmap version.
 */
export async function renderQrPng(value: string, size: number, style: QrRenderStyle): Promise<Buffer> {
  const svg = await renderQrSvg(value, size, style);
  // 144 DPI renders at 2x the CSS size: sharp enough on retina, small enough
  // to keep the inline email attachment light.
  return sharp(Buffer.from(svg), { density: 144 }).png({ compressionLevel: 9 }).toBuffer();
}
