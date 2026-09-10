import type { SurveyResponse } from "@/lib/surveys";

export type ImportQuestionMeta = {
  type: string;
  options: string[] | null;
  isHall: boolean;
};

export type CsvImportRow = {
  id: string;
  sourceRow: number;
  answers: Record<string, string | number>;
  email: string;
  hall: string;
  status: "ready" | "duplicate" | "invalid";
  issues: string[];
};

export type CsvImportPreview = {
  headers: string[];
  rows: CsvImportRow[];
  totalRows: number;
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

    if (/(ho ten|ten khach|ten nguoi|full name|name)/.test(normalizedLabel)) {
      ["ho ten", "hoten", "ten", "name", "full name", "hovaten"].forEach((alias) => questionByHeader.set(alias, qid));
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

export function parseSurveyImportCsv(params: {
  text: string;
  questionOrder: string[];
  questionLabels: Record<string, string>;
  questionMeta: Record<string, ImportQuestionMeta>;
  existingEmails: Set<string>;
}) {
  const rows = parseCsv(params.text);
  if (rows.length < 2) {
    return { headers: rows[0] ?? [], rows: [], totalRows: 0 } satisfies CsvImportPreview;
  }

  const headers = rows[0].map((header) => header.trim());
  const dataRows = rows.slice(1).filter((row) => row.some((cell) => cell.trim()));
  const questionByHeader = buildQuestionHeaderMap(params.questionOrder, params.questionLabels);
  const seenEmails = new Set(params.existingEmails);

  const previewRows = dataRows.map((row, index) => {
    const answers: Record<string, string | number> = {};
    const issues: string[] = [];
    let email = "";
    let hall = "";

    headers.forEach((header, cellIndex) => {
      const raw = row[cellIndex]?.trim() ?? "";
      if (!raw) return;

      const normalizedHeader = normalizeHeader(header);
      const qid = questionByHeader.get(normalizedHeader);
      if (qid) {
        const meta = params.questionMeta[qid];
        if (meta?.type === "choice" && meta.options) {
          const optionIndex = meta.options.findIndex((option) => normalizeHeader(option) === normalizeHeader(raw));
          answers[qid] = optionIndex >= 0 ? optionIndex : raw;
          if (meta.isHall) hall = optionIndex >= 0 ? meta.options[optionIndex] : raw;
        } else {
          answers[qid] = raw;
        }
      }

      if (!email && (normalizedHeader.includes("email") || emailPattern.test(raw))) {
        email = raw.toLowerCase();
      }
      if (!hall && (normalizedHeader.includes("hoi truong") || normalizedHeader === "hall")) {
        hall = raw;
      }
    });

    let status: CsvImportRow["status"] = "ready";
    if (email && seenEmails.has(email)) {
      status = "duplicate";
      issues.push("Email đã tồn tại hoặc bị trùng trong file");
    }
    if (email && !emailPattern.test(email)) {
      status = "invalid";
      issues.push("Email không hợp lệ");
    }
    if (Object.keys(answers).length === 0 && !email && !hall) {
      status = "invalid";
      issues.push("Dòng không có dữ liệu khớp với form");
    }

    if (email) seenEmails.add(email);

    return {
      id: `${Date.now()}-${index}`,
      sourceRow: index + 2,
      answers,
      email,
      hall,
      status,
      issues,
    } satisfies CsvImportRow;
  });

  return {
    headers,
    rows: previewRows,
    totalRows: dataRows.length,
  } satisfies CsvImportPreview;
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
