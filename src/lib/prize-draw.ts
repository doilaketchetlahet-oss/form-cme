import { normalizeAnswer, normalizePhone } from "./normalize";
import type { SurveyQuestion } from "./surveys";

export type PrizeField = Omit<SurveyQuestion, "survey_id"> & { survey_id?: string };
export type PrizeItem = { id: string; name: string; color: string; image_url?: string; total: number; remaining: number; position: number };
export type PrizeCampaign = {
  id: string; phone_question_id: string; name: string;
  form_fields: PrizeField[]; form_title: string; form_description: string; thank_you_message: string;
  status: "draft" | "active" | "paused" | "closed"; is_demo: boolean;
  starts_at: string; ends_at: string; accent_color: string; banner_url: string;
  instructions: string; track_redemption: boolean; revision: number;
};
export type PrizeResult = {
  id: string; prize_id: string | null; prize_name: string | null; prize_color: string | null;
  claim_code: string; drawn_at: string | null; redeemed_at: string | null;
  prize_image_url?: string | null;
};
export type PrizeSnapshot = { campaign: PrizeCampaign; items: PrizeItem[]; entry: PrizeResult | null };
export const PRIZE_SAMPLE_ITEMS = [
  { name: "Bình nước", color: "#0284c7", image_url: "/prize-draw/gifts/bottle.svg", total: 120 },
  { name: "Túi vải", color: "#7c3aed", image_url: "/prize-draw/gifts/bag.svg", total: 90 },
  { name: "Ô cầm tay", color: "#db2777", image_url: "/prize-draw/gifts/umbrella.svg", total: 60 },
  { name: "Bộ quà đặc biệt", color: "#d97706", image_url: "/prize-draw/gifts/gift.svg", total: 30 },
];
export const PRIZE_SAMPLE_START = "2026-11-12T00:00:00+07:00";
// Exclusive end: includes all of November 24 in Vietnam.
export const PRIZE_SAMPLE_END = "2026-11-25T00:00:00+07:00";
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const validPrizeImage = (url: unknown): url is string => typeof url === "string" && url.length <= 2000 && (!url || /^https:\/\/[^\s]+$/.test(url) || /^\/prize-draw\/gifts\/(bottle|bag|umbrella|gift)\.svg$/.test(url));
export function prizeTextColor(hex: string) {
  const rgb = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * rgb[0] + .7152 * rgb[1] + .0722 * rgb[2] > .179 ? "#0f172a" : "#ffffff";
}
const SUPPORTED = new Set(["text", "paragraph", "phone", "choice", "date", "province", "rating", "nps", "section", "image_banner"]);

export function prizeFormError(questions: PrizeField[], phoneId: string) {
  const phone = questions.find(q => q.id === phoneId);
  if (!phone || phone.type !== "phone" || !phone.required || phone.show_if) return "Chọn một câu hỏi SĐT bắt buộc, luôn hiển thị.";
  if (questions.some(q => !SUPPORTED.has(q.type) || q.is_hall_selector)) return "Form quay quà chỉ hỗ trợ câu hỏi thông tin, lựa chọn, ngày, tỉnh và đánh giá; không hỗ trợ hội trường, tải tệp, chữ ký hoặc khuôn mặt.";
  return null;
}

export function validatePrizeFields(raw: unknown, phoneId: string): PrizeField[] {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > 30) throw new Error("Form cần có 1–30 câu hỏi.");
  const ids = new Set<string>();
  const fields = raw.map((q, position) => {
    if (!q || !UUID_RE.test(q.id) || ids.has(q.id) || !SUPPORTED.has(q.type) || typeof q.text !== "string" || !q.text.trim() || q.text.length > 500 || typeof q.required !== "boolean") throw new Error("Kiểm tra mã, nội dung và loại câu hỏi.");
    ids.add(q.id);
    if (q.options != null && (!Array.isArray(q.options) || q.options.length > 50 || q.options.some((v: unknown) => typeof v !== "string" || v.length > 2000))) throw new Error("Lựa chọn của câu hỏi không hợp lệ.");
    if (q.type === "choice" && (!q.options?.length || q.options.some((v: string) => !v.trim()))) throw new Error("Câu hỏi lựa chọn cần ít nhất một đáp án.");
    if (q.type === "image_banner" && q.options?.[0] && !validPrizeImage(q.options[0])) throw new Error("Ảnh trong form cần là URL HTTPS.");
    if (q.type === "nps" && q.options?.[2] && (!Number.isInteger(Number(q.options[2])) || Number(q.options[2]) < 1 || Number(q.options[2]) > 10)) throw new Error("Thang điểm cần nằm trong khoảng 1–10.");
    if (q.show_if && (!UUID_RE.test(q.show_if.question_id) || !["eq", "neq", "lt", "lte", "gt", "gte", "contains", "not_contains"].includes(q.show_if.operator) || !["string", "number"].includes(typeof q.show_if.value))) throw new Error("Điều kiện hiển thị không hợp lệ.");
    return { id: q.id, position, type: q.type, text: q.text.trim(), required: q.required, options: q.options ?? null, allow_multiple: q.allow_multiple === true, show_if: q.show_if ?? null } as PrizeField;
  });
  const error = prizeFormError(fields, phoneId);
  if (error) throw new Error(error);
  for (const field of fields) {
    const seen = new Set([field.id]); let parent = field.show_if;
    while (parent) {
      if (!ids.has(parent.question_id) || seen.has(parent.question_id)) throw new Error("Điều kiện câu hỏi bị thiếu hoặc vòng lặp.");
      seen.add(parent.question_id); parent = fields.find(f => f.id === parent!.question_id)!.show_if;
    }
  }
  return fields;
}

export function prizeFieldVisible(q: PrizeField, fields: PrizeField[], answers: Record<string, unknown>, visited = new Set<string>()): boolean {
  if (!q.show_if) return true;
  if (visited.has(q.id)) return false;
  visited.add(q.id);
  const parent = fields.find(p => p.id === q.show_if!.question_id);
  if (!parent || !prizeFieldVisible(parent, fields, answers, visited)) return false;
  const raw = answers[parent.id], rule = q.show_if;
  const v = typeof raw === "string" ? normalizeAnswer(raw, parent.type) : raw;
  if (v === undefined || v === "") return false;
  if (Array.isArray(v)) return ["eq", "contains"].includes(rule.operator) ? v.includes(Number(rule.value)) : ["neq", "not_contains"].includes(rule.operator) ? !v.includes(Number(rule.value)) : false;
  const equal = String(v).toLowerCase() === String(rule.value).toLowerCase() || (Number.isFinite(Number(v)) && Number(v) === Number(rule.value));
  switch (rule.operator) {
    case "eq": return equal; case "neq": return !equal;
    case "lt": return Number(v) < Number(rule.value); case "lte": return Number(v) <= Number(rule.value);
    case "gt": return Number(v) > Number(rule.value); case "gte": return Number(v) >= Number(rule.value);
    case "contains": return String(v).toLowerCase().includes(String(rule.value).toLowerCase());
    case "not_contains": return !String(v).toLowerCase().includes(String(rule.value).toLowerCase());
  }
}

export function validatePrizeAnswers(questions: PrizeField[], phoneId: string, raw: unknown) {
  const configError = prizeFormError(questions, phoneId);
  if (configError) throw new Error(configError);
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Thông tin đăng ký không hợp lệ.");
  const input = raw as Record<string, unknown>;
  const answers: Record<string, string | number | number[]> = {};
  for (const q of questions) {
    const v = input[q.id];
    if (v === undefined || q.type === "section" || q.type === "image_banner") continue;
    if (typeof v !== "string" && typeof v !== "number" && !(Array.isArray(v) && v.every(x => typeof x === "number"))) throw new Error(`Thông tin không hợp lệ: ${q.text}`);
    if (typeof v === "string" && v.length > 5000) throw new Error(`Nội dung quá dài: ${q.text}`);
    answers[q.id] = normalizeAnswer(v as string | number | number[], q.type);
  }
  function visible(q: PrizeField, visited = new Set<string>()): boolean {
    if (!q.show_if) return true;
    if (visited.has(q.id)) throw new Error("Điều kiện hiển thị câu hỏi bị vòng lặp.");
    visited.add(q.id);
    const parent = questions.find(p => p.id === q.show_if!.question_id);
    if (!parent || !visible(parent, visited)) return false;
    const v = answers[parent.id], rule = q.show_if;
    if (v === undefined || v === "") return false;
    if (Array.isArray(v)) {
      const found = v.includes(Number(rule.value));
      return ["eq", "contains"].includes(rule.operator) ? found : ["neq", "not_contains"].includes(rule.operator) ? !found : false;
    }
    const equal = String(v).toLowerCase() === String(rule.value).toLowerCase() || (Number.isFinite(Number(v)) && Number(v) === Number(rule.value));
    switch (rule.operator) {
      case "eq": return equal;
      case "neq": return !equal;
      case "lt": return Number(v) < Number(rule.value);
      case "lte": return Number(v) <= Number(rule.value);
      case "gt": return Number(v) > Number(rule.value);
      case "gte": return Number(v) >= Number(rule.value);
      case "contains": return String(v).toLowerCase().includes(String(rule.value).toLowerCase());
      case "not_contains": return !String(v).toLowerCase().includes(String(rule.value).toLowerCase());
      default: return false;
    }
  }
  for (const q of questions) {
    if (["section", "image_banner"].includes(q.type)) continue;
    if (!visible(q)) { delete answers[q.id]; continue; }
    const v = answers[q.id];
    const empty = v === undefined || v === "" || (Array.isArray(v) && v.length === 0);
    if (empty) { if (q.required) throw new Error(`Vui lòng điền: ${q.text}`); continue; }
    if (q.type === "choice") {
      const indexes = Array.isArray(v) ? v : [v];
      if ((!q.allow_multiple && indexes.length !== 1) || new Set(indexes).size !== indexes.length || indexes.some(x => typeof x !== "number" || !Number.isInteger(x) || x < 0 || x >= (q.options?.length ?? 0))) throw new Error(`Lựa chọn không hợp lệ: ${q.text}`);
    } else if (["rating", "nps"].includes(q.type)) {
      const max = q.type === "rating" ? 5 : Number(q.options?.[2] || 10);
      if (typeof v !== "number" || !Number.isInteger(v) || v < (q.type === "rating" ? 1 : 0) || v > max) throw new Error(`Điểm không hợp lệ: ${q.text}`);
    } else if (typeof v !== "string") throw new Error(`Thông tin không hợp lệ: ${q.text}`);
    if (q.type === "phone" && !/^0[3-9]\d{8}$/.test(String(v))) throw new Error(`SĐT không hợp lệ: ${q.text}`);
    if (q.type === "date" && (!/^\d{4}-\d{2}-\d{2}$/.test(String(v)) || Number.isNaN(Date.parse(String(v))))) throw new Error(`Ngày không hợp lệ: ${q.text}`);
  }
  return { answers, phone: normalizePhone(String(answers[phoneId] ?? "")) };
}

export function prizeAvailability(campaign: PrizeCampaign, items: PrizeItem[], now = Date.now()) {
  if (campaign.status !== "active") return campaign.status === "draft" ? "Chương trình chưa mở." : campaign.status === "paused" ? "Chương trình đang tạm dừng." : "Chương trình đã đóng.";
  if (!campaign.is_demo && now < Date.parse(campaign.starts_at)) return "Chương trình chưa đến giờ bắt đầu.";
  if (!campaign.is_demo && now >= Date.parse(campaign.ends_at)) return "Chương trình đã kết thúc.";
  return items.some(p => p.remaining > 0) ? null : "Quà đã hết. Cảm ơn bạn đã tham gia!";
}

export function prizeCsvCell(value: unknown) {
  let s = String(value ?? "");
  if (/^[\s]*[=+@-]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
