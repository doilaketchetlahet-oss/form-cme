import { canAttendSession, type CheckinSessionConfig } from "./checkin-sessions";
import type { SurveyResponse } from "./surveys";
import { isAttendeeNameQuestion, slugifyEmailField } from "./email-template";

export type DisplayQuestion = { id: string; text: string; type: string; options: string[] | null; is_hall_selector?: boolean };

export function attendanceQuestionPriority(question: DisplayQuestion): number {
  if (isAttendeeNameQuestion(question)) return 0;
  const label = slugifyEmailField(question.text);
  if (/(?:^|_)(?:hoc_ham|hoc_vi|academic_title|academic_degree|qualification)(?:_|$)/.test(label)) return 1;
  if (/(?:^|_)(?:vai_tro|role)(?:_|$)/.test(label)) return 2;
  if (/(?:^|_)(?:chuc_danh|chuc_vu|job_title|position)(?:_|$)/.test(label)) return 3;
  return /\bcme\b/i.test(question.text) ? 4 : 5;
}

export function assignedHallForDisplay(questions: DisplayQuestion[], response: Pick<SurveyResponse, "answers" | "hall">): string {
  const hallQuestions = questions.filter((question) => question.is_hall_selector);
  if (!hallQuestions.length) return "";
  if (response.hall?.trim()) return response.hall.trim();
  for (const question of hallQuestions) {
    const value = response.answers[question.id];
    if (value == null || value === "") continue;
    const text = formatAttendanceAnswer(value, question);
    if (text && text !== "Lựa chọn không hợp lệ") return text;
  }
  return "";
}

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
  const summary = questions.some((question) => question.is_hall_selector)
    ? [{ label: "Hội trường được phân", value: assignedHallForDisplay(questions, response) || "Chưa phân hội trường" }] : [];
  for (const session of config?.sessions ?? []) {
    const eligible = canAttendSession(config, session.id, response.answers);
    const at = response.session_checkins?.[session.id];
    summary.push({ label: session.name, value: `${eligible ? "Có đăng ký" : "Không có quyền tham dự"}${at ? " · Đã check-in" : " · Chưa check-in"}` });
  }
  const ordered = [...questions].sort((a, b) => attendanceQuestionPriority(a) - attendanceQuestionPriority(b));
  return [...ordered.filter((q) => !q.is_hall_selector && !["section", "image_banner", "face_checkin"].includes(q.type)).flatMap((q) => {
    const value = formatAttendanceAnswer(response.answers[q.id], q);
    return value && !/^https?:/i.test(value) ? [{ label: q.text, value }] : [];
  }), ...summary];
}
