export type MergeColumn = { key: string; label: string };
export type MergeSourceRow = { sourceRow: number; fields: Record<string, string> };
export type MergeBlock = { id: string; type: "heading" | "text" | "image" | "button" | "divider"; text: string; url: string };
export type MergeTemplate = { columns: MergeColumn[]; emailColumn: string; subject: string; blocks: MergeBlock[] };
export type SmtpAccount = { host: string; port: number; secure: boolean; user: string; password: string; fromEmail: string; fromName: string; replyTo: string };
export type MergeRecipient = MergeSourceRow & { id: string; email: string; status: "pending" | "sending" | "sent" | "failed" | "uncertain" | "skipped"; last_error: string | null; sent_at?: string | null };
export type MergeCampaign = { id: string; name: string; template: MergeTemplate; smtp_public: Omit<SmtpAccount, "password"> | null; hasPassword: boolean; status: "draft" | "running" | "paused" | "completed"; created_at: string; recipients?: MergeRecipient[] };

export const MAX_MERGE_ROWS = 5000;
export const MAX_MERGE_COLUMNS = 60;
export const isMergeEmail = (value: string) => value.length <= 254 && /^[^\s@<>,;:"\\]+@[a-z0-9.-]+\.[a-z]{2,63}$/i.test(value);
const tokenPattern = /\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g;
const htmlEscape = (value: string) => value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function fieldKey(label: string) {
  const key = label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return /^\d/.test(key) ? `cot_${key}` : key;
}

/** CSV, semicolon exports and tab-separated lists pasted from Excel. */
export function parseMergeText(text: string): string[][] {
  text = text.replace(/^\uFEFF/, "");
  const firstLine = text.split(/\r?\n/, 1)[0];
  const counts = [",", ";", "\t"].map((delimiter) => {
    let count = 0, quoted = false;
    for (let i = 0; i < firstLine.length; i++) {
      if (firstLine[i] === '"') { if (quoted && firstLine[i + 1] === '"') i++; else quoted = !quoted; }
      else if (!quoted && firstLine[i] === delimiter) count++;
    }
    return { delimiter, count };
  }).sort((a, b) => b.count - a.count);
  const delimiter = counts[0].delimiter;
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; } else quoted = !quoted;
    } else if (!quoted && char === delimiter) { row.push(cell); cell = ""; }
    else if (!quoted && (char === "\r" || char === "\n")) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += char;
  }
  if (quoted) throw new Error("Có ô chưa đóng dấu ngoặc kép trong danh sách.");
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

export function mergeTable(matrix: string[][]): { columns: MergeColumn[]; rows: MergeSourceRow[]; emailColumn: string } {
  if (matrix.length < 2) throw new Error("Dòng đầu cần là tên cột, bên dưới có ít nhất một người nhận.");
  const columns = matrix[0].map((label, index) => ({ label: String(label).trim() || `Cột ${index + 1}`, key: fieldKey(String(label)) || `cot_${index + 1}` }));
  if (columns.length > MAX_MERGE_COLUMNS) throw new Error(`Tối đa ${MAX_MERGE_COLUMNS} cột.`);
  const seen = new Set<string>();
  columns.forEach((column) => {
    const original = column.key;
    let suffix = 2;
    while (seen.has(column.key)) column.key = `${original}_${suffix++}`;
    seen.add(column.key);
  });
  const rows = matrix.slice(1).map((row, index) => ({ sourceRow: index + 2, fields: Object.fromEntries(columns.map((column, i) => [column.key, String(row[i] ?? "").trim()])) }))
    .filter((row) => Object.values(row.fields).some(Boolean));
  if (!rows.length || rows.length > MAX_MERGE_ROWS) throw new Error(`Cần từ 1 đến ${MAX_MERGE_ROWS} người nhận.`);
  if (rows.some((row) => Object.values(row.fields).some((value) => value.length > 4000))) throw new Error("Mỗi ô tối đa 4.000 ký tự.");
  return { columns, rows, emailColumn: columns.find((column) => /email|e_mail/.test(column.key))?.key ?? columns[0].key };
}

export function replaceMergeTokens(template: string, fields: Record<string, string>) {
  return template.replace(tokenPattern, (token, key: string) => Object.hasOwn(fields, key) ? fields[key] : token);
}

export function validateMergeTemplate(input: unknown): string | null {
  if (!input || typeof input !== "object") return "Mẫu thư không hợp lệ.";
  const template = input as MergeTemplate;
  if (!Array.isArray(template.columns) || !template.columns.length || template.columns.length > MAX_MERGE_COLUMNS) return "Danh sách cột không hợp lệ.";
  const keys = new Set<string>();
  for (const column of template.columns) {
    if (!column || typeof column.key !== "string" || !/^[a-zA-Z_][a-zA-Z0-9_]{0,100}$/.test(column.key) || keys.has(column.key) || typeof column.label !== "string" || column.label.length > 200) return "Tên cột hoặc mã trường bị trùng / không hợp lệ.";
    keys.add(column.key);
  }
  if (!keys.has(template.emailColumn)) return "Chọn cột chứa địa chỉ Email.";
  if (typeof template.subject !== "string" || !template.subject.trim() || template.subject.length > 500 || /[\r\n]/.test(template.subject)) return "Tiêu đề cần từ 1 đến 500 ký tự và chỉ một dòng.";
  if (!Array.isArray(template.blocks) || !template.blocks.length || template.blocks.length > 50) return "Cần từ 1 đến 50 khối nội dung.";
  const ids = new Set<string>();
  for (const block of template.blocks) {
    if (!block || typeof block.id !== "string" || !block.id || ids.has(block.id) || !["heading", "text", "image", "button", "divider"].includes(block.type)
      || typeof block.text !== "string" || block.text.length > 20000 || typeof block.url !== "string" || block.url.length > 4000) return "Khối nội dung không hợp lệ.";
    ids.add(block.id);
    if ((block.type === "button" || block.type === "image") && !block.url.trim()) return "Nhập liên kết cho hình ảnh / nút bấm.";
  }
  const sources = [template.subject, ...template.blocks.flatMap((block) => [block.text, block.url])];
  for (const source of sources) {
    for (const match of source.matchAll(/\{\{([^{}]+)\}\}/g)) {
      if (!keys.has(match[1].trim())) return `Trường {{${match[1].trim()}}} không có trong danh sách import.`;
    }
  }
  return null;
}

export function renderMergeMail(template: MergeTemplate, fields: Record<string, string>) {
  const subject = replaceMergeTokens(template.subject, fields).replace(/[\r\n]+/g, " ").trim();
  if (!subject || subject.length > 998) throw new Error("Tiêu đề sau khi chèn trường quá dài hoặc trống.");
  const paragraphs: string[] = [];
  const parts = template.blocks.map((block) => {
    const text = replaceMergeTokens(block.text, fields);
    const url = replaceMergeTokens(block.url, fields).trim();
    const safeText = htmlEscape(text).replace(/\r?\n/g, "<br />");
    if (block.type === "divider") return '<hr style="border:0;border-top:1px solid #e2e8f0;margin:24px 0" />';
    if (block.type === "image" || block.type === "button") {
      let parsed: URL;
      try { parsed = new URL(url); } catch { throw new Error("Liên kết sau khi chèn trường không hợp lệ."); }
      if (!["https:", "http:", ...(block.type === "button" ? ["mailto:"] : [])].includes(parsed.protocol)) throw new Error("Liên kết chỉ dùng HTTP/HTTPS hoặc mailto cho nút bấm.");
      paragraphs.push(`${text}\n${url}`);
      return block.type === "image" ? `<img src="${htmlEscape(url)}" alt="${htmlEscape(text)}" style="max-width:100%;height:auto;margin:12px 0" />`
        : `<p style="margin:20px 0"><a href="${htmlEscape(url)}" style="background:#0284c7;color:#ffffff;padding:12px 20px;border-radius:8px;text-decoration:none;display:inline-block">${safeText || "Mở liên kết"}</a></p>`;
    }
    paragraphs.push(text);
    return block.type === "heading" ? `<h2 style="font-size:24px;color:#0f172a;margin:0 0 16px">${safeText}</h2>` : `<p style="margin:0 0 16px;line-height:1.7">${safeText}</p>`;
  });
  return { subject, text: paragraphs.join("\n\n"), html: `<div style="background:#f1f5f9;padding:24px 12px"><div style="max-width:600px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;font-family:Arial,Helvetica,sans-serif;color:#334155">${parts.join("")}</div></div>` };
}

export function prepareMergeRecipients(template: MergeTemplate, rows: MergeSourceRow[]) {
  if (!Array.isArray(rows) || !rows.length || rows.length > MAX_MERGE_ROWS) throw new Error(`Cần từ 1 đến ${MAX_MERGE_ROWS} người nhận.`);
  const seen = new Set<string>();
  const sourceRows = new Set<number>();
  return rows.map((row) => {
    if (!row || !Number.isInteger(row.sourceRow) || row.sourceRow < 1 || row.sourceRow > 2147483647 || sourceRows.has(row.sourceRow)
      || !row.fields || typeof row.fields !== "object" || Array.isArray(row.fields)) throw new Error("Dòng người nhận không hợp lệ hoặc số dòng bị trùng.");
    sourceRows.add(row.sourceRow);
    const fields = Object.fromEntries(template.columns.map(({ key }) => {
      const value = row.fields[key] ?? "";
      if (typeof value !== "string" || value.length > 4000) throw new Error("Giá trị mỗi ô cần là văn bản, tối đa 4.000 ký tự.");
      return [key, value];
    }));
    const email = (fields[template.emailColumn] ?? "").trim().toLowerCase();
    let error = !isMergeEmail(email) ? "Email trống / không hợp lệ" : seen.has(email) ? "Email trùng trong danh sách" : null;
    if (!error) { seen.add(email); try { renderMergeMail(template, fields); } catch (cause) { error = cause instanceof Error ? cause.message : "Không tạo được thư"; } }
    return { source_row: row.sourceRow, fields, email, status: error ? "skipped" : "pending", last_error: error };
  });
}
