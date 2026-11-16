import type { SurveyAnalytics, SurveyQuestion, SurveyResponse } from "./surveys";
import { arrivalSummary, canAttendSession, normalizeSessionConfig } from "./checkin-sessions";

export type ReportFilters = { search: string; checkin: "all" | "checked" | "pending"; hall: string };
export type ReportExportScope = "checked" | "filtered";
export type ReportCell = string | number;
export type ReportExportTable = { headers: string[]; rows: ReportCell[][]; kinds: ("text" | "number" | "status" | "date")[] };

function normalizeSearch(value: string) {
  return value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase().trim();
}

function reportQuestions(analytics: SurveyAnalytics) {
  return [...analytics.questions].filter((question) => !["section", "image_banner"].includes(question.type)).sort((a, b) => a.position - b.position);
}

export function reportAnswer(value: unknown, question: Pick<SurveyQuestion, "type" | "options">): ReportCell {
  if (value == null || value === "") return "";
  if (["signature", "face_checkin"].includes(question.type)) return "Đã cung cấp";
  if (question.type === "choice") {
    const values = Array.isArray(value) ? value : [value];
    if (!values.length) return "";
    const indexes = values.map((item) => typeof item === "number" ? item : /^\d+$/.test(String(item)) ? Number(item) : NaN);
    if (indexes.some((index) => !Number.isInteger(index) || question.options?.[index] === undefined)) return "Lựa chọn không hợp lệ";
    return indexes.map((index) => question.options![index]).join(", ");
  }
  if (question.type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split("-").reverse().join("/");
  if (["rating", "nps"].includes(question.type) && Number.isFinite(Number(value))) return Number(value);
  if (Array.isArray(value)) return value.map((item) => typeof item === "object" ? JSON.stringify(item) : String(item)).join(", ");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

export function reportDate(value: string | null | undefined) {
  if (!value || !Number.isFinite(Date.parse(value))) return "";
  return new Intl.DateTimeFormat("vi-VN", { timeZone: "Asia/Ho_Chi_Minh", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(value));
}

export function filterReportResponses(analytics: SurveyAnalytics, filters: ReportFilters, scope: ReportExportScope = "filtered") {
  const config = normalizeSessionConfig(analytics.survey.checkin_theme?.sessionConfig);
  const questions = reportQuestions(analytics);
  const hasHall = questions.some((question) => question.is_hall_selector);
  const needle = normalizeSearch(filters.search);
  return analytics.responses.map((response) => ({ ...response, ...arrivalSummary(response, config) })).filter((response) => {
    if ((filters.checkin === "checked" || scope === "checked") && !response.checked_in) return false;
    if (filters.checkin === "pending" && response.checked_in) return false;
    if (hasHall && filters.hall && response.hall !== filters.hall) return false;
    if (!needle) return true;
    return normalizeSearch([response.id, response.email ?? "", hasHall ? response.hall ?? "" : "",
      ...questions.map((question) => reportAnswer(response.answers[question.id], question))].join(" ")).includes(needle);
  });
}

export function buildReportExport(analytics: SurveyAnalytics, responses: SurveyResponse[]): ReportExportTable {
  const questions = reportQuestions(analytics);
  const config = normalizeSessionConfig(analytics.survey.checkin_theme?.sessionConfig);
  const columns: { label: string; kind: ReportExportTable["kinds"][number]; value: (response: SurveyResponse, index: number) => ReportCell }[] = [
    { label: "STT", kind: "number", value: (_, index) => index + 1 },
    ...questions.map((question) => ({ label: question.text, kind: ["rating", "nps"].includes(question.type) ? "number" as const : "text" as const,
      value: (response: SurveyResponse) => question.is_hall_selector && response.hall ? response.hall : reportAnswer(response.answers[question.id], question) })),
    { label: "Thời gian đăng ký", kind: "date", value: (response) => reportDate(response.submitted_at) },
    { label: "Check-in", kind: "status", value: (response) => arrivalSummary(response, config).checked_in ? "Đã check-in" : "Chưa check-in" },
    { label: "Thời gian check-in", kind: "date", value: (response) => reportDate(arrivalSummary(response, config).checked_in_at) },
  ];
  for (const session of config?.sessions ?? []) {
    columns.push(
      { label: `Quyền tham dự: ${session.name}`, kind: "status", value: (response) => canAttendSession(config, session.id, response.answers) ? "Có" : "Không" },
      { label: `Check-in: ${session.name}`, kind: "status", value: (response) => response.session_checkins?.[session.id] ? "Đã check-in" : "Chưa check-in" },
      { label: `Thời gian check-in: ${session.name}`, kind: "date", value: (response) => reportDate(response.session_checkins?.[session.id]) },
    );
  }
  if (analytics.survey.payment_config?.enabled === true) {
    const labels: Record<string, string> = { paid: "Đã thanh toán", pending: "Chờ thanh toán", cancelled: "Đã huỷ", expired: "Hết hạn", failed: "Lỗi thanh toán", not_required: "Không yêu cầu" };
    columns.push(
      { label: "Thanh toán", kind: "status", value: (response) => labels[response.payment_status ?? "not_required"] ?? "" },
      { label: "Số tiền", kind: "number", value: (response) => response.payment_amount ?? "" },
      { label: "Thời gian thanh toán", kind: "date", value: (response) => reportDate(response.paid_at) },
    );
  }
  // Preserve repeated question labels as separate, uniquely named Excel columns.
  const used = new Set<string>();
  const headers = columns.map(({ label }) => {
    const base = label.trim() || "Trường dữ liệu";
    let unique = base, suffix = 2;
    while (used.has(unique.toLocaleLowerCase("vi"))) unique = `${base} (${suffix++})`;
    used.add(unique.toLocaleLowerCase("vi"));
    return unique;
  });
  return { headers, kinds: columns.map((column) => column.kind), rows: responses.map((response, index) => columns.map((column) => column.value(response, index))) };
}

export function buildReportCSV(table: ReportExportTable) {
  const escape = (value: ReportCell) => {
    let text = String(value);
    if (typeof value === "string" && /^\s*[=+@-]/.test(text)) text = `'${text}`;
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  };
  return "\uFEFF" + [table.headers, ...table.rows].map((row) => row.map(escape).join(",")).join("\r\n");
}
