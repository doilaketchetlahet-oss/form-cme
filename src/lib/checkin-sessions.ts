import type { SurveyQuestion, SurveyQuestionUpsert, SurveyResponse } from "./surveys";

export type CheckinSession = {
  /** Stable ledger key; renaming the display name must not change this. */
  id: string;
  name: string;
  hall: string;
  opensAt: string | null;
  closesAt: string | null;
  optionIndexes: number[];
};

export type CheckinSessionConfig = { questionId: string | null; sessions: CheckinSession[] };

export function normalizeSessionConfig(input: unknown): CheckinSessionConfig | null {
  if (!input || typeof input !== "object" || Array.isArray(input)) return null;
  const raw = input as Record<string, unknown>;
  if (!Array.isArray(raw.sessions)) return null;
  const sessions = raw.sessions.filter((item) => item && typeof item === "object").map((item) => {
    const session = item as Record<string, unknown>;
    return {
      id: typeof session.id === "string" ? session.id.trim() : "",
      name: typeof session.name === "string" ? session.name.trim() : "",
      hall: typeof session.hall === "string" ? session.hall.trim() : "",
      opensAt: typeof session.opensAt === "string" && session.opensAt ? session.opensAt : null,
      closesAt: typeof session.closesAt === "string" && session.closesAt ? session.closesAt : null,
      optionIndexes: Array.isArray(session.optionIndexes)
        ? [...new Set(session.optionIndexes.filter((value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0))]
        : [],
    };
  });
  return { questionId: typeof raw.questionId === "string" && raw.questionId ? raw.questionId : null, sessions };
}

type ChoiceQuestion = Pick<SurveyQuestionUpsert, "id" | "type" | "options" | "required" | "show_if" | "is_hall_selector">;

export function validateSessionConfig(input: unknown, questions: ChoiceQuestion[]): string | null {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input)) return "Cấu hình buổi check-in không hợp lệ.";
  const raw = input as Record<string, unknown>;
  if ((raw.questionId != null && (typeof raw.questionId !== "string" || !raw.questionId.trim()))
    || !Array.isArray(raw.sessions) || raw.sessions.some((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return true;
      const session = item as Record<string, unknown>;
      return typeof session.id !== "string" || session.id !== session.id.trim()
        || typeof session.name !== "string" || typeof session.hall !== "string"
        || [session.opensAt, session.closesAt].some((date) => date != null && typeof date !== "string")
        || !Array.isArray(session.optionIndexes)
        || session.optionIndexes.some((index) => typeof index !== "number" || !Number.isInteger(index) || index < 0);
    })) return "Cấu hình buổi check-in không hợp lệ.";
  const config = normalizeSessionConfig(input);
  if (!config || !config.sessions.length || config.sessions.length > 20) return "Cần cấu hình từ 1 đến 20 buổi check-in.";
  const ids = new Set<string>();
  const question = config.questionId ? questions.find((q) => q.id === config.questionId) : null;
  if (config.questionId && (!question || question.type !== "choice" || !question.required || question.show_if || question.is_hall_selector)) {
    return "Câu hỏi quyền tham dự phải là lựa chọn bắt buộc, luôn hiển thị và không dùng để phân hội trường.";
  }
  for (const session of config.sessions) {
    if (!session.id || session.id.length > 120 || ids.has(session.id) || !session.name || session.name.length > 120 || session.hall.length > 160) {
      return "Tên hoặc mã buổi check-in không hợp lệ hoặc bị trùng.";
    }
    ids.add(session.id);
    for (const date of [session.opensAt, session.closesAt]) {
      if (date && (!/(Z|[+-]\d{2}:\d{2})$/.test(date) || !Number.isFinite(Date.parse(date)))) return "Giờ check-in không hợp lệ.";
    }
    if (session.opensAt && session.closesAt && Date.parse(session.opensAt) >= Date.parse(session.closesAt)) {
      return `Buổi “${session.name}”: giờ đóng phải sau giờ mở check-in.`;
    }
    if (question && (!session.optionIndexes.length || session.optionIndexes.some((index) => index >= (question.options?.length ?? 0)))) {
      return `Chọn ít nhất một nhóm được tham dự buổi “${session.name}”.`;
    }
  }
  return null;
}

/** Unconfigured legacy sessions remain open to all; configured sessions fail closed. */
export function canAttendSession(config: CheckinSessionConfig | null, sessionId: string, answers: SurveyResponse["answers"]): boolean {
  if (!config) return true;
  const session = config.sessions.find((item) => item.id === sessionId);
  if (!session) return false;
  if (!config.questionId) return true;
  const value = answers[config.questionId];
  const selected = Array.isArray(value) ? value : typeof value === "number" ? [value] : [];
  return selected.some((index) => Number.isInteger(index) && session.optionIndexes.includes(index));
}

export function sessionLabel(config: CheckinSessionConfig | null, key: string) {
  return config?.sessions.find((session) => session.id === key)?.name ?? key;
}

/** Aggregate arrivals for reports only; never rewrite the independent ledgers. */
export function arrivalSummary(response: {
  checked_in?: boolean | null; checked_in_at?: string | null; session_checkins?: Record<string, string> | null;
}, config: CheckinSessionConfig | null) {
  if (!config) return { checked_in: !!response.checked_in, checked_in_at: response.checked_in_at ?? null };
  const times = [response.checked_in_at, ...Object.values(response.session_checkins ?? {})]
    .filter((at): at is string => !!at && Number.isFinite(Date.parse(at))).sort((a, b) => Date.parse(a) - Date.parse(b));
  return { checked_in: !!response.checked_in || Object.keys(response.session_checkins ?? {}).length > 0, checked_in_at: times[0] ?? null };
}

/** Prevent index-based registration answers being reinterpreted after people register. */
export function sessionQuestionChanged(config: CheckinSessionConfig | null, before: SurveyQuestion[], after: SurveyQuestionUpsert[]) {
  if (!config?.questionId) return false;
  const old = before.find((q) => q.id === config.questionId);
  const next = after.find((q) => q.id === config.questionId);
  return !!old && (!next || next.type !== old.type || JSON.stringify(next.options) !== JSON.stringify(old.options));
}
