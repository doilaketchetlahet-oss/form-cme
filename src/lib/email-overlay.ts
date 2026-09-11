import { readFile } from "node:fs/promises";
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

async function loadFontCss() {
  const regular = await readFile(path.join(process.cwd(), "public", "fonts", "NotoSans-Regular.ttf"));
  const bold = await readFile(path.join(process.cwd(), "public", "fonts", "NotoSans-Bold.ttf"));
  return `
    @font-face { font-family: 'NotoSans'; src: url('data:font/ttf;base64,${regular.toString("base64")}'); font-weight: 400; }
    @font-face { font-family: 'NotoSans'; src: url('data:font/ttf;base64,${bold.toString("base64")}'); font-weight: 700; }
  `;
}

export async function composeInviteImage(
  overlay: EmailOverlay,
  values: Record<string, string>,
  checkinUrl: string,
): Promise<Buffer> {
  const response = await fetch(overlay.imageUrl);
  if (!response.ok) throw new Error("Không tải được ảnh thiệp.");
  const background = Buffer.from(await response.arrayBuffer());
  const image = sharp(background, { failOn: "none" }).rotate();
  const meta = await image.metadata();
  const width = Math.max(1, meta.width || overlay.width || 1200);
  const height = Math.max(1, meta.height || overlay.height || 1600);
  const composites: { input: Buffer; left: number; top: number }[] = [];
  const textFields = overlay.fields.filter((field) => !isQrField(field));
  const qrFields = overlay.fields.filter(isQrField);

  if (textFields.length > 0) {
    const fontCss = await loadFontCss();
    const texts = textFields.map((field) => {
      const left = (field.x / 100) * width;
      const top = (field.y / 100) * height;
      const boxW = Math.max(8, (field.w / 100) * width);
      const boxH = Math.max(8, (field.h / 100) * height);
      const key = tokenKey(field.token);
      const text = values[key] || "";
      const fontSize = Math.max(12, Number(field.fontSize) || Math.round(boxH * 0.55));
      const color = field.color || "#0f172a";
      const weight = field.bold ? 700 : 400;
      const anchor = field.align === "center" ? "middle" : field.align === "right" ? "end" : "start";
      const x = field.align === "center" ? left + boxW / 2 : field.align === "right" ? left + boxW : left;
      const y = top + boxH / 2;
      return `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" font-family="NotoSans" font-size="${fontSize}" font-weight="${weight}" fill="${escapeXml(color)}" text-anchor="${anchor}" dominant-baseline="middle">${escapeXml(text)}</text>`;
    }).join("");
    const svg = `<svg width="${width}" height="${height}" xmlns="http://www.w3.org/2000/svg"><defs><style>${fontCss}</style></defs>${texts}</svg>`;
    composites.push({ input: Buffer.from(svg), left: 0, top: 0 });
  }

  for (const field of qrFields) {
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
