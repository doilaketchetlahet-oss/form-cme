import { normalizeAnswer, normalizePhone } from "./normalize";
import type { SurveyQuestion } from "./surveys";

export type PrizeItem = { id: string; name: string; color: string; total: number; remaining: number; position: number };
export type PrizeCampaign = {
  id: string; survey_id: string; phone_question_id: string; name: string;
  status: "draft" | "active" | "paused" | "closed"; is_demo: boolean;
  starts_at: string; ends_at: string; accent_color: string; banner_url: string;
  instructions: string; track_redemption: boolean; revision: number;
};
export type PrizeResult = {
  id: string; prize_id: string | null; prize_name: string | null; prize_color: string | null;
  claim_code: string; drawn_at: string | null; redeemed_at: string | null;
};
export type PrizeSnapshot = { campaign: PrizeCampaign; items: PrizeItem[]; entry: PrizeResult | null };
export const PRIZE_SAMPLE_ITEMS = [
  { name: "Bình nước", color: "#0284c7", total: 120 },
  { name: "Túi vải", color: "#7c3aed", total: 90 },
  { name: "Ô cầm tay", color: "#db2777", total: 60 },
  { name: "Bộ quà đặc biệt", color: "#d97706", total: 30 },
];
export const PRIZE_SAMPLE_START = "2026-11-12T00:00:00+07:00";
// Exclusive end: includes all of November 24 in Vietnam.
export const PRIZE_SAMPLE_END = "2026-11-25T00:00:00+07:00";
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SUPPORTED = new Set(["text", "paragraph", "phone", "choice", "date", "province", "rating", "nps", "section", "image_banner"]);

export function prizeFormError(questions: SurveyQuestion[], phoneId: string) {
  const phone = questions.find(q => q.id === phoneId);
  if (!phone || phone.type !== "phone" || !phone.required || phone.show_if) return "Chọn một câu hỏi SĐT bắt buộc, luôn hiển thị.";
  if (questions.some(q => !SUPPORTED.has(q.type) || q.is_hall_selector)) return "Form quay quà chỉ hỗ trợ câu hỏi thông tin, lựa chọn, ngày, tỉnh và đánh giá; không hỗ trợ hội trường, tải tệp, chữ ký hoặc khuôn mặt.";
  return null;
}

export function validatePrizeAnswers(questions: SurveyQuestion[], phoneId: string, raw: unknown) {
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
  function visible(q: SurveyQuestion, visited = new Set<string>()): boolean {
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
