import type { SurveyResponse } from "@/lib/surveys";
import * as XLSX from "xlsx";
import { canAttendSession, type CheckinSessionConfig } from "./checkin-sessions";

export type ImportQuestionMeta = {
  type: string;
  options: string[] | null;
  isHall: boolean;
  required?: boolean;
  allowMultiple?: boolean;
};

export type CsvImportRow = {
  id: string;
  sourceRow: number;
  answers: SurveyResponse["answers"];
  email: string;
  hall: string;
  status: "ready" | "duplicate" | "invalid";
  issues: string[];
};

export type CsvImportPreview = {
  headers: string[];
  rows: CsvImportRow[];
  totalRows: number;
  unmappedHeaders?: string[];
  mappingIssues?: string[];
};

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeHeader(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function parseAttendanceFlag(value: string): boolean | null {
  const normalized = normalizeHeader(value);
  if (["co", "yes", "y", "true", "1", "x", "tham du", "dang ky"].includes(normalized) || ["✓", "✔", "☑"].includes(value.trim())) return true;
  if (["khong", "no", "n", "false", "0", "khong tham du", "khong dang ky"].includes(normalized)) return false;
  return null;
}

export type AttendanceColumnMapping = Record<string, { column: number | null; fallback: "unknown" | "yes" | "no" }>;

export function validateImportRows(rows: CsvImportRow[], meta: Record<string, ImportQuestionMeta>, labels: Record<string, string>, existingEmails: Set<string>, config?: CheckinSessionConfig | null): CsvImportRow[] {
  const seen = new Set(existingEmails);
  return rows.map((row) => {
    const email = row.email.trim().toLowerCase();
    const issues: string[] = [];
    for (const [id, question] of Object.entries(meta)) {
      const value = row.answers[id];
      const missing = value == null || value === "" || (Array.isArray(value) && value.length === 0);
      // Conditional required questions are not marked required by the import UI.
      if (missing && (question.required || config?.questionId === id)) issues.push(`Thiếu: ${labels[id] || id}`);
      if (!missing && question.type === "choice") {
        const indexes = Array.isArray(value) ? value : [value];
        if ((!question.allowMultiple && indexes.length > 1) || indexes.some((v) => typeof v !== "number" || !Number.isInteger(v) || v < 0 || v >= (question.options?.length ?? 0))) {
          issues.push(`Lựa chọn không hợp lệ: ${labels[id] || id}${typeof value === "string" ? ` (${value})` : ""}`);
        }
      }
    }
    if (email && !emailPattern.test(email)) issues.push("Email không hợp lệ");
    if (!row.hall.trim() && config?.sessions.some((session) => session.checkHall && canAttendSession(config, session.id, row.answers))) issues.push("Thiếu hội trường được phân cho buổi có kiểm tra hội trường");
    if (!Object.values(row.answers).some((v) => v !== "" && v != null) && !email && !row.hall) issues.push("Dòng không có dữ liệu khớp với form");
    const duplicate = !!email && seen.has(email);
    if (duplicate) issues.push("Email đã tồn tại hoặc bị trùng trong file");
    // Invalid rows must not consume an address that a later valid row can use.
    const invalid = issues.some((issue) => !issue.startsWith("Email đã"));
    if (email && !invalid) seen.add(email);
    return { ...row, email, issues, status: invalid ? "invalid" : duplicate ? "duplicate" : "ready" };
  });
}

export type ImportSheet = { name: string; hidden: boolean; rows: string[][] };

export async function readImportSheets(file: File): Promise<ImportSheet[]> {
  const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
  return workbook.SheetNames.map((name) => {
    const sheet = workbook.Sheets[name];
    // Excel's used range often includes hundreds of formatting-only rows.
    // Keep internal blank rows and leading columns so source coordinates stay exact.
    const range = sheet["!ref"] ? { s: { r: 0, c: 0 }, e: XLSX.utils.decode_range(sheet["!ref"]).e } : undefined;
    const rows = XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "", range, blankrows: true });
    while (rows.length && !rows[rows.length - 1].some((value) => String(value).trim())) rows.pop();
    let width = 0;
    rows.forEach((row) => row.forEach((value, index) => { if (String(value).trim()) width = Math.max(width, index + 1); }));
    return { name, hidden: !!workbook.Workbook?.Sheets?.find((item) => item.name === name)?.Hidden,
      rows: rows.map((row) => Array.from({ length: width }, (_, index) => String(row[index] ?? ""))) };
  });
}

export async function parseSpreadsheetFile(file: File): Promise<string[][]> {
  const sheets = await readImportSheets(file);
  return (sheets.find((sheet) => !sheet.hidden) ?? sheets[0])?.rows ?? [];
}

export function suggestHeaderRow(rows: string[][]): number {
  const index = rows.findIndex((row) => row.filter((cell) => cell.trim()).length > 1);
  return index >= 0 ? index + 1 : Math.max(1, rows.findIndex((row) => row.some((cell) => cell.trim())) + 1);
}

export function importColumnLabel(header: string, index: number): string {
  return `${XLSX.utils.encode_col(index)} · ${header || "(chưa có tên cột)"}`;
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (char === '"') {
      if (inQuotes && next === '"') {
        cell += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }

    if (char === "," && !inQuotes) {
      row.push(cell);
      cell = "";
      continue;
    }

    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }

    cell += char;
  }

  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }

  if (rows[0]?.[0]) rows[0][0] = rows[0][0].replace(/^\uFEFF/, "");
  return rows;
}

export function findResponseEmail(response: Pick<SurveyResponse, "email" | "answers">): string | undefined {
  return response.email || (Object.values(response.answers).find((value) => typeof value === "string" && emailPattern.test(value)) as string | undefined);
}

export function buildQuestionHeaderMap(questionOrder: string[], questionLabels: Record<string, string>) {
  const questionByHeader = new Map<string, string>();

  questionOrder.forEach((qid) => {
    const label = questionLabels[qid] || qid;
    const normalizedLabel = normalizeHeader(label);
    questionByHeader.set(normalizedLabel, qid);

    if (/(ho va ten|ho ten|ten khach|ten nguoi|full name|name)/.test(normalizedLabel)) {
      ["ho va ten", "ho ten", "hoten", "ten", "name", "full name", "hovaten"].forEach((alias) => questionByHeader.set(alias, qid));
    }
    if (/(dien thoai|so dien thoai|phone|sdt)/.test(normalizedLabel)) {
      ["dien thoai", "so dien thoai", "sdt", "phone", "mobile"].forEach((alias) => questionByHeader.set(alias, qid));
    }
    if (normalizedLabel.includes("email")) {
      questionByHeader.set("email", qid);
    }
  });

  return questionByHeader;
}

export function parseSurveyImportRows(params: {
  rows: string[][];
  questionOrder: string[];
  questionLabels: Record<string, string>;
  questionMeta: Record<string, ImportQuestionMeta>;
  existingEmails: Set<string>;
  sessionConfig?: CheckinSessionConfig | null;
  attendanceColumns?: AttendanceColumnMapping;
  cmeQuestionId?: string;
  cmeColumn?: number | null;
  questionColumns?: Record<string, number | null>;
  emailColumn?: number | null;
  sourceRowOffset?: number;
}) {
  const rows = params.rows;
  if (rows.length < 2) {
    return { headers: rows[0] ?? [], rows: [], totalRows: 0 } satisfies CsvImportPreview;
  }

  const headers = rows[0].map((header) => header.trim());
  const dataRows = rows.slice(1).map((row, index) => ({ row, sourceRow: index + 2 + (params.sourceRowOffset ?? 0) })).filter(({ row }) => row.some((cell) => cell.trim()));
  const questionByHeader = buildQuestionHeaderMap(params.questionOrder, params.questionLabels);
  const hallQuestions = params.questionOrder.filter((id) => params.questionMeta[id]?.isHall);
  if (hallQuestions.length === 1) {
    for (const header of ["hoi truong", "hall", "hoi truong duoc phan"]) {
      if (!questionByHeader.has(header)) questionByHeader.set(header, hallQuestions[0]);
    }
  }

  const mappingIssues: string[] = [];
  const questionColumns = new Map<string, number | null>();
  params.questionOrder.forEach((id) => {
    if (Object.hasOwn(params.questionColumns ?? {}, id)) {
      questionColumns.set(id, params.questionColumns![id]);
      return;
    }
    const candidates = headers.flatMap((header, index) => questionByHeader.get(normalizeHeader(header)) === id ? [index] : []);
    if (candidates.length > 1) mappingIssues.push(`Chọn cột cho “${params.questionLabels[id]}”: ${candidates.map((index) => importColumnLabel(headers[index], index)).join(", ")}.`);
    questionColumns.set(id, candidates.length === 1 ? candidates[0] : null);
  });
  const emailCandidates = headers.flatMap((header, index) => /^(email|e mail|dia chi email)$/.test(normalizeHeader(header)) ? [index] : []);
  // A manually mapped form Email field also selects the address receiving the QR.
  const mappedEmail = params.questionOrder.find((id) => /^(email|e mail|dia chi email)$/.test(normalizeHeader(params.questionLabels[id] ?? "")) && Object.hasOwn(params.questionColumns ?? {}, id));
  const explicitEmail = params.emailColumn !== undefined ? params.emailColumn : mappedEmail ? params.questionColumns![mappedEmail] : undefined;
  const emailColumn = explicitEmail !== undefined ? explicitEmail : emailCandidates.length === 1 ? emailCandidates[0] : undefined;
  if (explicitEmail === undefined && emailCandidates.length > 1) mappingIssues.push("Có nhiều cột Email. Chọn cột Email nhận QR hoặc ghép trường Email trong form.");
  const usedColumns = new Set([...questionColumns.values()].filter((value): value is number => value !== null));
  if (typeof emailColumn === "number") usedColumns.add(emailColumn);

  const previewRows = dataRows.map(({ row, sourceRow }, index) => {
    const answers: SurveyResponse["answers"] = {};
    let email = "";
    let hall = "";

    headers.forEach((header, cellIndex) => {
      const raw = row[cellIndex]?.trim() ?? "";
      if (!raw) return;

      const normalizedHeader = normalizeHeader(header);
      for (const [qid, mappedColumn] of questionColumns) {
        if (mappedColumn !== cellIndex) continue;
        const meta = params.questionMeta[qid];
        if (meta?.type === "choice" && meta.options) {
          const flag = parseAttendanceFlag(raw);
          const exact = meta.options.findIndex((option) => normalizeHeader(option) === normalizeHeader(raw));
          const optionIndex = exact >= 0 ? exact : flag === null ? -1 : meta.options.findIndex((option) => parseAttendanceFlag(option) === flag);
          const multiple = meta.allowMultiple && exact < 0 ? raw.split(/[;,]/).map((part) => meta.options!.findIndex((option) => normalizeHeader(option) === normalizeHeader(part))) : null;
          answers[qid] = multiple?.every((i) => i >= 0) ? multiple : optionIndex >= 0 ? (meta.allowMultiple ? [optionIndex] : optionIndex) : raw;
          if (meta.isHall) hall = optionIndex >= 0 ? meta.options[optionIndex] : raw;
        } else {
          answers[qid] = raw;
        }
      }

      if (emailColumn === cellIndex || (emailColumn === undefined && emailCandidates.length === 0 && !email && emailPattern.test(raw))) {
        email = raw.toLowerCase();
      }
      if (!hall && (normalizedHeader.includes("hoi truong") || normalizedHeader === "hall")) {
        hall = raw;
      }
    });

    const config = params.sessionConfig;
    if (config?.questionId && params.attendanceColumns) {
      const desired = config.sessions.map((session) => {
        const mapping = params.attendanceColumns![session.id];
        if (!mapping) return null;
        // Blank mapped cells are unknown, never silently grant attendance.
        return mapping.column !== null ? parseAttendanceFlag(row[mapping.column] ?? "") : mapping.fallback === "unknown" ? null : mapping.fallback === "yes";
      });
      const meta = params.questionMeta[config.questionId];
      const existing = answers[config.questionId];
      const options = meta?.options ?? [];
      const allowedIndexes = options.map((_, i) => i).filter((i) => config.sessions.every((s, index) => desired[index] !== false || !s.optionIndexes.includes(i)));
      const candidate = meta?.allowMultiple ? allowedIndexes.filter((i) => config.sessions.some((s, index) => desired[index] && s.optionIndexes.includes(i))) : options.findIndex((_, i) => config.sessions.every((s, index) => s.optionIndexes.includes(i) === desired[index]));
      const candidateAnswers = { [config.questionId]: candidate };
      if (desired.some((v) => v === null)) answers[config.questionId] = "Cần chọn cột hoặc giá trị cho mọi buổi; ô trống không được coi là Không";
      else if (candidate === -1 || !config.sessions.every((s, i) => canAttendSession(config, s.id, candidateAnswers) === desired[i])) answers[config.questionId] = "Nhóm tham dự không khớp lựa chọn của form";
      else if (existing != null && !config.sessions.every((s, i) => canAttendSession(config, s.id, answers) === desired[i])) answers[config.questionId] = "Cột chương trình và các cột buổi tham dự mâu thuẫn";
      else answers[config.questionId] = candidate;
    }
    if (params.cmeQuestionId && params.cmeColumn != null) {
      const id = params.cmeQuestionId;
      const raw = row[params.cmeColumn]?.trim() ?? "";
      const meta = params.questionMeta[id];
      const flag = parseAttendanceFlag(raw);
      const option = meta?.options?.findIndex((value) => flag !== null && parseAttendanceFlag(value) === flag) ?? -1;
      const mapped = option >= 0 ? (meta.allowMultiple ? [option] : option) : raw;
      answers[id] = answers[id] != null && JSON.stringify(answers[id]) !== JSON.stringify(mapped) ? "Các cột đăng ký CME mâu thuẫn" : mapped;
    }

    return {
      id: `${Date.now()}-${index}`,
      sourceRow,
      answers,
      email,
      hall,
      status: "ready",
      issues: [],
    } satisfies CsvImportRow;
  });

  return {
    headers,
    rows: validateImportRows(previewRows, params.questionMeta, params.questionLabels, params.existingEmails, params.sessionConfig),
    totalRows: dataRows.length,
    mappingIssues,
    unmappedHeaders: headers.filter((header, index) => {
      const normalized = normalizeHeader(header);
      return !usedColumns.has(index) && !normalized.includes("hoi truong") && normalized !== "hall"
        && !Object.values(params.attendanceColumns ?? {}).some((mapping) => mapping.column === index)
        && !(params.cmeQuestionId && params.cmeColumn === index);
    }),
  } satisfies CsvImportPreview;
}

export function parseSurveyImportCsv(params: Omit<Parameters<typeof parseSurveyImportRows>[0], "rows"> & { text: string }) {
  return parseSurveyImportRows({
    ...params,
    rows: parseCsv(params.text),
  });
}

export function buildImportPayload(surveyId: string, rows: CsvImportRow[]) {
  return rows
    .filter((row) => row.status === "ready")
    .map((row) => ({
      survey_id: surveyId,
      answers: row.answers,
      ...(row.email ? { email: row.email, email_status: "pending" as const } : {}),
      ...(row.hall ? { hall: row.hall } : {}),
    }));
}
