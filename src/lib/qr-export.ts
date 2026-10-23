import { isAttendeeNameQuestion, slugifyEmailField } from "./email-template";
import { buildQrImagePath } from "./qr-style";
import type { QRBranding } from "./surveys";

type ExportQuestion = { id: string; text: string; type: string; options?: string[] | null };
type ExportResponse = { id: string; email?: string | null; answers: Record<string, unknown> };
const SKIP_TYPES = new Set(["section", "image_banner", "face_checkin", "signature", "file_upload"]);

function answerLabel(value: unknown, question?: ExportQuestion): string {
  if (question && SKIP_TYPES.has(question.type)) return "";
  if (question?.type === "choice") {
    const indexes = Array.isArray(value) ? value : [value];
    if (!indexes.length || indexes.some((index) => typeof index !== "number" || !Number.isInteger(index) || !question.options?.[index])) return "";
    return indexes.map((index) => question.options![index as number]).join(", ").trim();
  }
  if (typeof value !== "string" && typeof value !== "number") return "";
  const text = String(value).trim();
  return /^https?:\/\//i.test(text) ? "" : text;
}

export function qrExportLabel(response: ExportResponse, questions: ExportQuestion[]): string {
  const firstAnswer = (matches: (question: ExportQuestion) => boolean) => {
    for (const question of questions) {
      if (!matches(question)) continue;
      const label = answerLabel(response.answers[question.id], question);
      if (label) return label;
    }
    return "";
  };
  const name = firstAnswer(isAttendeeNameQuestion);
  if (name) return name;
  const email = response.email?.trim()
    || firstAnswer((question) => /(?:^|_)(?:email|e_mail)(?:_|$)/.test(slugifyEmailField(question.text)))
    || Object.values(response.answers).find((value) => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()));
  if (typeof email === "string" && email.trim()) return email.trim();
  const phone = firstAnswer((question) => question.type === "phone" || /(?:^|_)(?:sdt|dien_thoai|phone|telephone|mobile)(?:_|$)/.test(slugifyEmailField(question.text)));
  if (phone) return phone;
  return firstAnswer(() => true)
    || (questions.length ? "" : Object.values(response.answers).map((value) => answerLabel(value)).find(Boolean))
    || response.id;
}

export function uniqueQrFilename(label: string, used: Set<string>): string {
  let base = label.normalize("NFC").replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80).replace(/[. ]+$/g, "") || "khach";
  if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(base)) base = `_${base}`;
  let name = base, suffix = 2;
  while (used.has(name.toLowerCase())) name = `${base}_${suffix++}`;
  used.add(name.toLowerCase());
  return `${name}.png`;
}

export async function fetchBrandedQrPng(value: string, size: number, branding: QRBranding | null): Promise<Blob> {
  const response = await fetch(buildQrImagePath(value, size, branding, "png"));
  if (!response.ok || response.headers.get("Content-Type")?.split(";")[0].trim().toLowerCase() !== "image/png") {
    throw new Error("Không tạo được ảnh QR theo branding đã lưu. Vui lòng thử lại.");
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error("Ảnh QR trả về trống. Vui lòng thử lại.");
  return blob;
}
