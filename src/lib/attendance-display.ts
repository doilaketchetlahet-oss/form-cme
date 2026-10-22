import { canAttendSession, type CheckinSessionConfig } from "./checkin-sessions";
import type { SurveyResponse } from "./surveys";

export type DisplayQuestion = { id: string; text: string; type: string; options: string[] | null };

export function formatAttendanceAnswer(value: unknown, question: Pick<DisplayQuestion, "type" | "options">): string {
  if (value == null || value === "") return "Chưa có thông tin";
  if (question.type === "choice" && question.options) {
    const indexes = Array.isArray(value) ? value : typeof value === "number" ? [value] : [];
    if (!indexes.length || indexes.some((index) => !Number.isInteger(index) || !question.options?.[index])) return "Lựa chọn không hợp lệ";
    return indexes.map((index) => question.options![index]).join(", ");
  }
  return typeof value === "string" || typeof value === "number" ? String(value) : "";
}

export function attendanceDetails(questions: DisplayQuestion[], response: Pick<SurveyResponse, "answers" | "hall" | "session_checkins">, config: CheckinSessionConfig | null) {
  const summary = [{ label: "Hội trường được phân", value: response.hall || "Chưa phân hội trường" }];
  for (const session of config?.sessions ?? []) {
    const eligible = canAttendSession(config, session.id, response.answers);
    const at = response.session_checkins?.[session.id];
    summary.push({ label: session.name, value: `${eligible ? "Có đăng ký" : "Không có quyền tham dự"}${at ? " · Đã check-in" : " · Chưa check-in"}` });
  }
  // Put CME registration ahead of long free-text answers, without treating it as certification.
  const ordered = [...questions].sort((a, b) => Number(/\bcme\b/i.test(b.text)) - Number(/\bcme\b/i.test(a.text)));
  return [...summary, ...ordered.filter((q) => !["section", "image_banner", "face_checkin"].includes(q.type)).flatMap((q) => {
    const value = formatAttendanceAnswer(response.answers[q.id], q);
    return value && !/^https?:/i.test(value) ? [{ label: q.text, value }] : [];
  })];
}
