import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import QRCode from "qrcode";

export const runtime = "nodejs";

const DEFAULT_DARK = "#0369a1";
const DEFAULT_ACCENT = "#0891b2";
const DEFAULT_LIGHT = "#f8fdff";

type QrRenderStyle = {
  darkColor: string;
  accentColor: string;
  lightColor: string;
  logoEnabled: boolean;
  logoUrl: string | null;
  logoSize: number;
  moduleRadius: number;
};

function cleanHex(value: string | null, fallback: string) {
  return value && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function clamp(value: number, min: number, max: number, fallback: number) {
  return Number.isFinite(value) ? Math.max(min, Math.min(value, max)) : fallback;
}

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

async function loadLogoDataUri(logoUrl: string | null) {
  try {
    let contentType = "image/png";
    let buffer: Buffer;

    if (logoUrl && /^https?:\/\//i.test(logoUrl)) {
      const response = await fetch(logoUrl);
      if (!response.ok) throw new Error("Cannot load remote QR logo");
      contentType = response.headers.get("content-type")?.split(";")[0] || "image/png";
      buffer = Buffer.from(await response.arrayBuffer());
    } else {
      const logoPath = path.join(process.cwd(), "public", "logo_qr.png");
      buffer = await readFile(logoPath);
    }

    return `data:${contentType};base64,${buffer.toString("base64")}`;
  } catch {
    return null;
  }
}

async function renderQrSvg(value: string, size: number, style: QrRenderStyle) {
  const qr = QRCode.create(value, { errorCorrectionLevel: "H" });
  const moduleCount = qr.modules.size;
  const margin = 4;
  const cell = size / (moduleCount + margin * 2);
  const moduleRadius = Math.max(0, cell * (style.moduleRadius / 100));
  const finderRadius = cell * 1.1;
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 ${size} ${size}" role="img" aria-label="QR code">`,
    roundedRect(0, 0, size, size, 18, style.lightColor),
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
      parts.push(roundedRect(x + cell * 0.08, y + cell * 0.08, cell * 0.84, cell * 0.84, moduleRadius, fill));
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
    const logoSize = size * (style.logoSize / 100);
    const padding = size * 0.026;
    const boxSize = logoSize + padding * 2;
    const left = (size - boxSize) / 2;
    const top = (size - boxSize) / 2;
    parts.push(roundedRect(left, top, boxSize, boxSize, boxSize * 0.22, "#ffffff"));
    if (logoDataUri) {
      parts.push(`<image href="${escapeXml(logoDataUri)}" x="${(left + padding).toFixed(3)}" y="${(top + padding).toFixed(3)}" width="${logoSize.toFixed(3)}" height="${logoSize.toFixed(3)}" preserveAspectRatio="xMidYMid meet" />`);
    }
  }

  parts.push("</svg>");
  return parts.join("");
}

export async function GET(request: NextRequest) {
  const value = request.nextUrl.searchParams.get("data");
  const sizeParam = Number(request.nextUrl.searchParams.get("size") || "220");
  const size = Math.max(160, Math.min(Number.isFinite(sizeParam) ? sizeParam : 220, 520));
  const style: QrRenderStyle = {
    darkColor: cleanHex(request.nextUrl.searchParams.get("dark"), DEFAULT_DARK),
    accentColor: cleanHex(request.nextUrl.searchParams.get("accent"), DEFAULT_ACCENT),
    lightColor: cleanHex(request.nextUrl.searchParams.get("light"), DEFAULT_LIGHT),
    logoEnabled: request.nextUrl.searchParams.get("logo") !== "0",
    logoUrl: request.nextUrl.searchParams.get("logoUrl"),
    logoSize: clamp(Number(request.nextUrl.searchParams.get("logoSize") || "24"), 12, 28, 24),
    moduleRadius: clamp(Number(request.nextUrl.searchParams.get("radius") || "32"), 0, 50, 32),
  };

  if (!value) {
    return NextResponse.json({ error: "Missing QR data" }, { status: 400 });
  }

  const svg = await renderQrSvg(value, size, style);
  return new NextResponse(svg, {
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
