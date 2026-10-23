import type { CsvImportRow } from "./csv-import";

type RecoveryQuestion = { id: string; text: string; type: string; options: string[] | null; allow_multiple?: boolean };
const clean = (value: string) => value.replace(/\s+/g, " ").trim();

function recoverChoice(text: string, options: string[], multiple: boolean): string | number | number[] {
  // The old table renders selected labels joined by ", ". Require one unique
  // interpretation, including when an individual option itself contains commas.
  const matches: number[][] = [];
  let steps = 0;
  const visit = (rest: string, selected: number[]) => {
    if (++steps > 2000 || matches.length > 1 || selected.length > options.length) return;
    options.forEach((option, index) => {
      if (selected.includes(index)) return;
      const label = clean(option);
      if (!label) return;
      if (rest === label) matches.push([...selected, index]);
      else if (multiple && rest.startsWith(`${label}, `)) visit(rest.slice(label.length + 2), [...selected, index]);
    });
  };
  visit(text, []);
  if (steps > 2000 || matches.length !== 1) return text;
  return multiple ? matches[0] : matches[0][0];
}

export function recoverCopiedAttendeePreview(html: string, surveyId: string, questions: RecoveryQuestion[]): CsvImportRow[] {
  if (!html || html.length > 10 * 1024 * 1024) throw new Error("Hãy sao chép toàn bộ trang import bằng Ctrl+A, Ctrl+C rồi dán lại.");
  // A template stays inert: never insert copied scripts, styles or resources
  // into the live page, and never render the clipboard HTML.
  const template = document.createElement("template");
  template.innerHTML = html;
  const root = template.content;
  const sourceIds = Array.from(root.querySelectorAll("a[href]"), (anchor) => {
    try { return new URL(anchor.getAttribute("href")!, "https://local.invalid").pathname.match(/^\/attendees\/([^/]+)\/?$/)?.[1]; }
    catch { return undefined; }
  }).filter(Boolean);
  if (!sourceIds.includes(surveyId)) throw new Error("Bảng sao chép phải thuộc đúng form này. Hãy sao chép toàn bộ trang import ở tab cũ.");
  const table = Array.from(root.querySelectorAll("table")).find((item) => {
    const headers = Array.from(item.querySelectorAll("thead th"), (cell) => clean(cell.textContent ?? ""));
    return headers.slice(0, 4).join("|") === "Dòng|Trạng thái|Email|Hội trường" && headers.at(-1) === "Thao tác";
  });
  if (!table) throw new Error("Không tìm thấy bảng xem trước. Bấm ra ngoài ô nhập ở tab cũ, nhấn Ctrl+A, Ctrl+C rồi dán lại.");
  const headers = Array.from(table.querySelectorAll("thead th"), (cell) => clean(cell.textContent ?? "")).slice(4, -1);
  if (headers.length !== questions.length || headers.some((header, index) => header !== clean(questions[index].text))) {
    throw new Error("Các trường của form đã thay đổi hoặc bảng thuộc form khác. Giữ tab cũ để đối chiếu trước khi khôi phục.");
  }
  const totalLabel = Array.from(root.querySelectorAll("p")).find((item) => clean(item.textContent ?? "") === "Tổng dòng");
  const total = Number(clean(totalLabel?.previousElementSibling?.textContent ?? ""));
  const sourceRows = Array.from(table.querySelectorAll("tbody tr")).filter((row) => row.children.length === questions.length + 5);
  if (!sourceRows.length || sourceRows.length > 5000 || !totalLabel || total !== sourceRows.length) {
    throw new Error("Bảng sao chép chưa đủ dòng. Xóa nội dung ô tìm kiếm ở tab cũ, sao chép toàn bộ trang rồi dán lại.");
  }
  if (table.querySelector("tbody input, tbody select, tbody textarea")) throw new Error("Bấm Xong ở dòng đang chỉnh sửa trong tab cũ trước khi sao chép lại.");
  return sourceRows.map((row, index) => {
    const cells = Array.from(row.children, (cell) => (cell.textContent ?? "").trim());
    const answers: CsvImportRow["answers"] = {};
    questions.forEach((question, questionIndex) => {
      const text = cells[questionIndex + 4];
      if (text === "Chưa có thông tin") return;
      answers[question.id] = question.type === "choice" && question.options
        ? recoverChoice(clean(text), question.options, !!question.allow_multiple) : text;
    });
    const sourceRow = Number(cells[0].replace(/^#/, ""));
    if (!Number.isInteger(sourceRow) || sourceRow < 1) throw new Error("Không đọc được số dòng gốc. Hãy sao chép lại toàn bộ trang import.");
    return { id: `recovered-${Date.now()}-${index}`, sourceRow, answers,
      email: cells[2] === "Không có" ? "" : cells[2], hall: cells[3] === "-" ? "" : cells[3], status: "ready", issues: [] };
  });
}
