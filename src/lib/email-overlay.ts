import { copyFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import QRCode from "qrcode";
import type { EmailOverlay, OverlayField } from "@/lib/email-template";

function tokenKey(token: string) {
  return token.replace(/^\{\{|\}\}$/g, "").trim();
}

function escapeXml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isQrField(field: OverlayField) {
  const key = tokenKey(field.token);
  return field.kind === "qr" || key === "qr_url" || key === "qr_image";
}

const FONT_DIR = path.join(process.cwd(), "public", "fonts");
let fontsPrepared = false;

// Serverless images (Vercel lambda) ship without usable system fonts, so we
// bundle Noto Sans and register it via fontconfig before any text rendering.
// The @font-face trick inside SVG does not work with librsvg.
async function prepareFonts() {
  if (fontsPrepared) return;
  fontsPrepared = true;
  if (process.platform !== "linux") return;
  try {
    const fontsDir = "/tmp/form-cme-fonts";
    const confDir = "/tmp/form-cme-fontconfig";
    const cacheDir = "/tmp/form-cme-fontcache";
    await mkdir(fontsDir, { recursive: true });
    await mkdir(confDir, { recursive: true });
    await mkdir(cacheDir, { recursive: true });
    await copyFile(path.join(FONT_DIR, "NotoSans-Regular.ttf"), path.join(fontsDir, "NotoSans-Regular.ttf"));
    await copyFile(path.join(FONT_DIR, "NotoSans-Bold.ttf"), path.join(fontsDir, "NotoSans-Bold.ttf"));
    const conf = `<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${fontsDir}</dir><cachedir>${cacheDir}</cachedir></fontconfig>`;
    await writeFile(path.join(confDir, "fonts.conf"), conf);
    process.env.FONTCONFIG_FILE = path.join(confDir, "fonts.conf");
  } catch {
    // fall back to fontfile-only rendering
  }
}

function fontFile(bold?: boolean) {
  return path.join(FONT_DIR, bold ? "NotoSans-Bold.ttf" : "NotoSans-Regular.ttf");
}

async function renderTextField(
  field: OverlayField,
  value: string,
  width: number,
  height: number,
): Promise<{ input: Buffer; left: number; top: number } | null> {
  const text = (value ?? "").trim();
  if (!text) return null;

  const left = (field.x / 100) * width;
  const top = (field.y / 100) * height;
  const boxW = Math.max(8, (field.w / 100) * width);
  const boxH = Math.max(8, (field.h / 100) * height);
  const fontSize = Math.max(12, Math.min(200, Number(field.fontSize) || Math.round(boxH * 0.55)));
  const color = /^#[0-9a-fA-F]{6}$/.test(field.color ?? "") ? field.color! : "#0f172a";

  // Pango markup: size is in 1024ths of a point; at 72dpi 1pt === 1px.
  const markup = `<span foreground="${color}" size="${Math.round(fontSize * 1024)}">${escapeXml(text)}</span>`;
  let textImage = await sharp({
    text: {
      text: markup,
      font: "Noto Sans",
      fontfile: fontFile(field.bold),
      dpi: 72,
      rgba: true,
    },
  }).png().toBuffer();

  let meta = await sharp(textImage).metadata();
  let w = meta.width ?? 0;
  let h = meta.height ?? 0;
  if (w > 0 && h > 0 && w > boxW) {
    const scale = boxW / w;
    textImage = await sharp(textImage)
      .resize(Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)))
      .png().toBuffer();
    meta = await sharp(textImage).metadata();
    w = meta.width ?? 0;
    h = meta.height ?? 0;
  }
  if (w === 0 || h === 0) return null;

  let x = left;
  if (field.align === "center") x = left + (boxW - w) / 2;
  else if (field.align === "right") x = left + boxW - w;
  x = Math.max(0, Math.min(width - w, x));
  const y = Math.max(0, Math.min(height - h, top + (boxH - h) / 2));

  return { input: textImage, left: Math.round(x), top: Math.round(y) };
}

export async function composeInviteImage(
  overlay: EmailOverlay,
  values: Record<string, string>,
  checkinUrl: string,
): Promise<Buffer> {
  await prepareFonts();

  const response = await fetch(overlay.imageUrl);
  if (!response.ok) throw new Error("Không tải được ảnh thiệp.");
  const background = Buffer.from(await response.arrayBuffer());
  const image = sharp(background, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  const width = Math.max(1, meta.width || overlay.width || 1200);
  const height = Math.max(1, meta.height || overlay.height || 1600);
  const composites: { input: Buffer; left: number; top: number }[] = [];

  for (const field of overlay.fields) {
    if (isQrField(field)) continue;
    const rendered = await renderTextField(field, values[tokenKey(field.token)] ?? "", width, height);
    if (rendered) composites.push(rendered);
  }

  for (const field of overlay.fields.filter(isQrField)) {
    const left = Math.round((field.x / 100) * width);
    const top = Math.round((field.y / 100) * height);
    const box = Math.max(32, Math.round(Math.min((field.w / 100) * width, (field.h / 100) * height)));
    const qrPng = await QRCode.toBuffer(checkinUrl || values.checkin_url || "preview", {
      type: "png",
      width: box,
      margin: 1,
      errorCorrectionLevel: "M",
      color: { dark: "#0f172a", light: "#ffffff" },
    });
    composites.push({ input: qrPng, left, top });
  }

  if (composites.length === 0) return image.jpeg({ quality: 88 }).toBuffer();

  return image
    .composite(composites)
    .jpeg({ quality: 88 })
    .toBuffer();
}

export function overlayEmailPayload(jpeg: Buffer) {
  return {
    html: `<div style="margin:0;padding:0;background:#ffffff"><img src="cid:invite" alt="Thư mời" width="640" style="width:100%;max-width:640px;height:auto;display:block;border:0" /></div>`,
    text: "Thư mời đính kèm.",
    attachments: [
      {
        filename: "invite.jpg",
        content: jpeg.toString("base64"),
        contentId: "invite",
        contentType: "image/jpeg",
      },
    ],
  };
}
