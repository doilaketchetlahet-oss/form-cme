"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileSpreadsheet, Loader2, Pencil, Search, Trash2, Upload, XCircle } from "lucide-react";
import { PinGate } from "@/components/ui/PinGate";
import { supabase } from "@/lib/supabase";
import type { SurveyResponse } from "@/lib/surveys";
import {
  buildImportPayload,
  findResponseEmail,
  parseCsv,
  readImportSheets,
  suggestHeaderRow,
  normalizeHeader,
  type ImportSheet,
  parseSurveyImportRows,
  validateImportRows,
  type AttendanceColumnMapping,
  type CsvImportPreview,
  type CsvImportRow,
  type ImportQuestionMeta,
} from "@/lib/csv-import";
import { normalizeSessionConfig, type CheckinSessionConfig } from "@/lib/checkin-sessions";
import { formatAttendanceAnswer } from "@/lib/attendance-display";
import { AttendanceImportMapping } from "@/components/admin/AttendanceImportMapping";
import { useConfirm } from "@/lib/ui/confirm";
import { recoverCopiedAttendeePreview } from "@/lib/attendee-preview-recovery";

type QuestionInfo = {
  id: string;
  text: string;
  type: string;
  options: string[] | null;
  is_hall_selector: boolean;
  required: boolean;
  show_if: unknown;
  allow_multiple: boolean;
};

export default function AttendeeImportPage({ params }: { params: Promise<{ surveyId: string }> }) {
  const [sid, setSid] = useState("");
  useEffect(() => { params.then(({ surveyId }) => setSid(surveyId)); }, [params]);
  if (!sid) return <div className="min-h-dvh bg-slate-50" />;
  return <PinGate surveyId={sid}><AttendeeImportInner surveyId={sid} /></PinGate>;
}

function AttendeeImportInner({ surveyId }: { surveyId: string }) {
  const confirm = useConfirm();
  const inputRef = useRef<HTMLInputElement>(null);
  const mappingRef = useRef<HTMLDivElement>(null);
  const [surveyTitle, setSurveyTitle] = useState("");
  const [questions, setQuestions] = useState<QuestionInfo[]>([]);
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<string | null>(null);
  const [sessionConfig, setSessionConfig] = useState<CheckinSessionConfig | null>(null);
  const [sourceRows, setSourceRows] = useState<string[][]>([]);
  const [separateColumns, setSeparateColumns] = useState(false);
  const [attendanceColumns, setAttendanceColumns] = useState<AttendanceColumnMapping>({});
  const [cmeQuestionId, setCmeQuestionId] = useState("");
  const [cmeColumn, setCmeColumn] = useState<number | null>(null);
  const [mappingDirty, setMappingDirty] = useState(false);
  const [sheets, setSheets] = useState<ImportSheet[]>([]);
  const [sheetIndex, setSheetIndex] = useState(0);
  const [headerRow, setHeaderRow] = useState(1);
  const [questionColumns, setQuestionColumns] = useState<Record<string, number | null>>({});
  const [emailColumn, setEmailColumn] = useState<number | null | undefined>(undefined);
  const [recoveredRows, setRecoveredRows] = useState<CsvImportRow[] | null>(null);
  const [recoveryError, setRecoveryError] = useState("");

  const questionOrder = useMemo(() => questions.map((q) => q.id), [questions]);
  const questionLabels = useMemo(() => Object.fromEntries(questions.map((q) => [q.id, q.text])), [questions]);
  const questionMeta = useMemo<Record<string, ImportQuestionMeta>>(
    () => Object.fromEntries(questions.map((q) => [q.id, { type: q.type, options: q.options, isHall: q.is_hall_selector, required: q.required && !q.show_if, allowMultiple: q.allow_multiple }])),
    [questions],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: survey, error: surveyError }, { data: questionRows, error: questionError }, { data: responseRows, error: responseError }] = await Promise.all([
      supabase.from("surveys").select("title, checkin_theme").eq("id", surveyId).single(),
      supabase
        .from("survey_questions")
        .select("id, text, type, options, is_hall_selector, required, show_if, allow_multiple")
        .eq("survey_id", surveyId)
        .not("type", "in", '("section","image_banner","face_checkin")')
        .order("position"),
      supabase.from("survey_responses").select("*").eq("survey_id", surveyId),
    ]);

    if (surveyError || questionError || responseError || !survey) { setLoadFailed(true); setLoading(false); return; }
    setLoadFailed(false);

    setSurveyTitle(survey?.title ?? "Form đăng ký");
    setSessionConfig(normalizeSessionConfig(survey?.checkin_theme?.sessionConfig));
    setQuestions((questionRows ?? []) as QuestionInfo[]);
    setResponses((responseRows ?? []) as SurveyResponse[]);
    setLoading(false);
  }, [surveyId]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadData]);

  const existingEmails = useMemo(
    () => new Set(responses.map((response) => findResponseEmail(response)?.toLowerCase()).filter(Boolean) as string[]),
    [responses],
  );

  const stats = useMemo(() => {
    const rows = preview?.rows ?? [];
    return {
      total: rows.length,
      ready: rows.filter((row) => row.status === "ready").length,
      duplicate: rows.filter((row) => row.status === "duplicate").length,
      invalid: rows.filter((row) => row.status === "invalid").length,
    };
  }, [preview]);
  const hasMappingWarnings = mappingDirty || !!preview?.mappingIssues?.length;

  const visibleRows = useMemo(() => {
    const rows = preview?.rows ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const values = [row.email, row.hall, ...Object.values(row.answers).map(String), ...row.issues];
      return values.some((value) => value.toLowerCase().includes(needle));
    });
  }, [preview, query]);

  const readRows = (allRows: string[][], firstRow: number) => {
    const rows = allRows.slice(firstRow - 1);
    setHeaderRow(firstRow);
    setSourceRows(rows);
    setSeparateColumns(false);
    setAttendanceColumns({});
    setCmeQuestionId("");
    setCmeColumn(null);
    setQuestionColumns({});
    setEmailColumn(undefined);
    setMappingDirty(false);
    setEditingId(null);
    setQuery("");
    setResult(null);
    setPreview(parseSurveyImportRows({ rows, questionOrder, questionLabels, questionMeta, existingEmails, sessionConfig, sourceRowOffset: firstRow - 1 }));
  };

  const handleFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { setResult("File tối đa 10 MB."); return; }
    setParsing(true);
    setResult(null);
    try {
      const isExcel = /\.xlsx?$/i.test(file.name);
      const nextSheets = isExcel ? await readImportSheets(file) : [{ name: "CSV", hidden: false, rows: parseCsv(await file.text()) }];
      const index = Math.max(0, nextSheets.findIndex((sheet) => !sheet.hidden));
      if (!nextSheets[index]) throw new Error("Workbook không có sheet");
      setSheets(nextSheets);
      setSheetIndex(index);
      readRows(nextSheets[index].rows, suggestHeaderRow(nextSheets[index].rows));
      setFileName(file.name);
    } catch {
      setPreview(null);
      setSourceRows([]);
      setSheets([]);
      setResult("Không đọc được file. Kiểm tra định dạng Excel / CSV và thử lại.");
    } finally {
      setParsing(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  const patchRow = (id: string, patch: Partial<CsvImportRow>) => {
    setPreview((current) => {
      if (!current) return current;
      return {
        ...current,
        rows: validateImportRows(current.rows.map((row) => row.id === id ? { ...row, ...patch } : row), questionMeta, questionLabels, existingEmails, sessionConfig),
      };
    });
  };

  const patchAnswer = (rowId: string, questionId: string, value: string) => {
    const meta = questionMeta[questionId];
    const finalValue = meta?.type === "choice" ? meta.allowMultiple ? value.split(",").filter(Boolean).map(Number) : /^\d+$/.test(value) ? Number(value) : value : value;
    setPreview((current) => {
      if (!current) return current;
      return {
        ...current,
        rows: validateImportRows(current.rows.map((row) => {
          if (row.id !== rowId) return row;
          const answers = { ...row.answers, [questionId]: finalValue };
          const hall = meta?.isHall && meta.options && typeof finalValue === "number" ? meta.options[finalValue] : row.hall;
          return { ...row, answers, hall };
        }), questionMeta, questionLabels, existingEmails, sessionConfig),
      };
    });
  };

  const removeRow = (id: string) => {
    setPreview((current) => current ? { ...current, rows: validateImportRows(current.rows.filter((row) => row.id !== id), questionMeta, questionLabels, existingEmails, sessionConfig) } : current);
  };

  const clearPreview = () => {
    setPreview(null);
    setSourceRows([]);
    setSheets([]);
    setFileName("");
    setResult(null);
    setQuery("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const doImport = async () => {
    if (!preview || stats.ready === 0 || importing || parsing) return;
    setImporting(true);
    try {
      if (hasMappingWarnings) {
        const accepted = await confirm({
          title: "Import dữ liệu trong bảng xem trước?",
          description: `${stats.ready} dòng hợp lệ sẽ được import theo nội dung hiện có trong bảng, bao gồm các chỉnh sửa thủ công. ${mappingDirty ? "Các thay đổi ghép cột chưa áp dụng sẽ không được dùng. " : ""}${preview.mappingIssues?.length ? "Cột trùng tên chưa được chọn sẽ không tự lấy dữ liệu; hãy kiểm tra các ô trống trong bảng. " : ""}Các dòng lỗi hoặc trùng email sẽ được bỏ qua.`,
          confirmText: `Import ${stats.ready} người từ bảng`,
          cancelText: "Kiểm tra ghép cột",
        });
        if (!accepted) {
          mappingRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
      }
      setResult(null);
      const { data: latest, error: readError } = await supabase.from("survey_responses").select("email, answers").eq("survey_id", surveyId);
      if (readError) { setResult("Không kiểm tra được danh sách hiện tại. Vui lòng thử lại."); return; }
      const latestEmails = new Set((latest ?? []).map((response) => findResponseEmail(response)?.toLowerCase()).filter((email): email is string => !!email));
      const validated = validateImportRows(preview.rows, questionMeta, questionLabels, latestEmails, sessionConfig);
      setPreview({ ...preview, rows: validated });
      const payload = buildImportPayload(surveyId, validated);
      if (!payload.length) { setResult("Không còn dòng hợp lệ để import. Kiểm tra email trùng và quyền tham dự."); return; }
      const { data, error } = await supabase.from("survey_responses").insert(payload).select("*");
      if (error) {
        setResult(`Import thất bại: ${error.message}`);
        return;
      }
      setResponses((prev) => [...((data ?? []) as SurveyResponse[]), ...prev]);
      setResult(`Đã import ${data?.length ?? payload.length} người vào danh sách.`);
      setPreview({ ...preview, rows: validated.filter((row) => row.status !== "ready"), mappingIssues: [] });
      setMappingDirty(false);
      setSourceRows([]);
      setSheets([]);
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-dvh bg-slate-50 flex items-center justify-center text-slate-500">
        <Loader2 size={24} className="animate-spin mr-2" /> Đang tải dữ liệu form...
      </div>
    );
  }
  if (loadFailed) return <div className="p-8 text-center text-slate-700"><p>Không tải được cấu hình form hoặc danh sách hiện tại.</p><button onClick={() => void loadData()} className="mt-3 rounded-lg bg-sky-600 px-4 py-2 text-white">Thử lại</button></div>;

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10 shadow-sm shadow-slate-200/40">
        <div className="max-w-6xl mx-auto">
          <Link href={`/attendees/${surveyId}`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900">
            <ArrowLeft size={16} /> Quay lại danh sách
          </Link>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Import Excel / CSV</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 leading-snug">{surveyTitle}</h1>
              <p className="mt-1 text-sm text-slate-500">Xem trước, sửa và xoá từng dòng trước khi đưa vào danh sách đăng ký.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => inputRef.current?.click()}
                disabled={parsing || importing}
                className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Upload size={16} /> Chọn file Excel / CSV
              </button>
              <button
                onClick={doImport}
                disabled={!preview || stats.ready === 0 || importing || parsing}
                aria-describedby={hasMappingWarnings ? "import-mapping-warning" : undefined}
                className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {importing ? "Đang import..." : `Import ${stats.ready} người`}
              </button>
            </div>
          </div>
          {hasMappingWarnings && stats.ready > 0 && <p id="import-mapping-warning" className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            Có {stats.ready} dòng hợp lệ trong bảng xem trước. {mappingDirty ? "Ghép cột đã thay đổi nhưng chưa áp dụng. " : "Còn cột trùng tên chưa chọn. "}
            Bấm Import để dùng dữ liệu hiện có trong bảng và giữ các chỉnh sửa thủ công, hoặc áp dụng ghép cột để đọc lại file.
          </p>}
          <input
            ref={inputRef}
            type="file"
            accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-5">
        <details className="mb-5 rounded-2xl border border-sky-200 bg-white p-4">
          <summary className="cursor-pointer font-semibold text-sky-800">Khôi phục bảng đã sửa từ tab cũ</summary>
          <p className="mt-3 text-sm leading-6 text-slate-600">Giữ tab cũ và mở cùng trang import ở một tab mới. Trong tab cũ, xóa ô tìm kiếm, bấm Xong nếu đang sửa một dòng, rồi bấm ra ngoài ô nhập và nhấn Ctrl+A, Ctrl+C. Quay lại tab mới và dán vào ô bên dưới. Giữ tab cũ đến khi kiểm tra khôi phục đủ dữ liệu.</p>
          <textarea aria-label="Dán bảng từ tab cũ" placeholder="Bấm vào đây rồi nhấn Ctrl+V để khôi phục bảng đã sao chép" onChange={() => {}} disabled={parsing || importing} value={recoveredRows ? `Đã đọc ${recoveredRows.length} dòng từ bảng sao chép.` : ""}
            onPaste={(event) => {
              event.preventDefault();
              setRecoveryError(""); setRecoveredRows(null);
              try {
                setRecoveredRows(recoverCopiedAttendeePreview(event.clipboardData.getData("text/html"), surveyId, questions));
              } catch (error) { setRecoveryError(error instanceof Error ? error.message : "Không đọc được bảng đã sao chép."); }
            }} className="mt-3 h-24 w-full rounded-xl border border-slate-300 px-3 py-2 text-sm focus:outline-sky-500" />
          {recoveryError && <p role="alert" className="mt-2 text-sm text-red-700">{recoveryError}</p>}
          {recoveredRows && <button type="button" disabled={parsing || importing} onClick={() => {
            setPreview({ headers: questions.map((question) => question.text), rows: validateImportRows(recoveredRows, questionMeta, questionLabels, existingEmails, sessionConfig), totalRows: recoveredRows.length });
            setSheets([]); setSourceRows([]); setMappingDirty(false); setEditingId(null); setQuery("");
            setFileName("Bảng đã khôi phục từ tab cũ"); setResult(`Đã khôi phục ${recoveredRows.length} dòng. Kiểm tra dữ liệu và bấm Import để lưu vào danh sách.`);
            setRecoveredRows(null);
          }} className="mt-3 rounded-xl bg-sky-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">Khôi phục {recoveredRows.length} dòng vào bảng</button>}
        </details>
        {sheets.length > 0 && <fieldset disabled={parsing || importing} className="mb-5 rounded-2xl border border-slate-200 bg-white p-4">
          <legend className="px-2 font-bold text-slate-900">Nguồn dữ liệu</legend>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="min-w-0 text-sm font-medium">Sheet để import
              <select aria-label="Sheet để import" value={sheetIndex} onChange={(event) => {
                const index = Number(event.target.value); setSheetIndex(index); readRows(sheets[index].rows, suggestHeaderRow(sheets[index].rows));
              }} className="mt-1 block w-full rounded-lg border p-2">
                {sheets.map((sheet, index) => <option key={index} value={index}>{sheet.name}{sheet.hidden ? " (sheet ẩn)" : ""}</option>)}
              </select>
            </label>
            <label className="text-sm font-medium">Dòng chứa tên cột
              <input aria-label="Dòng chứa tên cột" type="number" min={1} max={Math.max(1, sheets[sheetIndex].rows.length)} value={headerRow} onChange={(event) => {
                const row = Number(event.target.value);
                if (Number.isInteger(row) && row >= 1 && row <= Math.max(1, sheets[sheetIndex].rows.length)) readRows(sheets[sheetIndex].rows, row);
              }} className="mt-1 block w-full rounded-lg border p-2" />
            </label>
          </div>
          <p className="mt-2 text-xs text-slate-600">Mặc định chọn sheet đang hiển thị trong Excel. Đổi sheet hoặc dòng tiêu đề sẽ đọc lại dữ liệu và thay thế ghép cột, chỉnh sửa trong bảng xem trước.</p>
        </fieldset>}
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Tổng dòng" value={stats.total} tone="slate" />
          <StatCard label="Sẵn sàng import" value={stats.ready} tone="emerald" />
          <StatCard label="Trùng email" value={stats.duplicate} tone="amber" />
          <StatCard label="Cần sửa" value={stats.invalid} tone="red" />
        </div>

        {sourceRows.length > 0 && <div ref={mappingRef}><AttendanceImportMapping headers={sourceRows[0]} config={sessionConfig} questions={questions}
          questionColumns={questionColumns} emailColumn={emailColumn}
          onQuestionColumn={(id, value) => { setQuestionColumns((current) => { const next = { ...current }; if (value === undefined) delete next[id]; else next[id] = value; return next; }); setMappingDirty(true); }}
          onEmailColumn={(value) => {
            setEmailColumn(value);
            setQuestionColumns((current) => {
              const next = { ...current };
              questions.filter((question) => /^(email|e mail|dia chi email)$/.test(normalizeHeader(question.text))).forEach((question) => { if (value === undefined) delete next[question.id]; else next[question.id] = value; });
              return next;
            });
            setMappingDirty(true);
          }}
          separate={separateColumns} mappings={attendanceColumns} cmeQuestionId={cmeQuestionId} cmeColumn={cmeColumn} dirty={mappingDirty} disabled={importing}
          onSeparate={(value) => { setSeparateColumns(value); setMappingDirty(true); }}
          onMappings={(value) => { setAttendanceColumns(value); setMappingDirty(true); }}
          onCmeQuestion={(value) => { setCmeQuestionId(value); setCmeColumn(null); setMappingDirty(true); }}
          onCmeColumn={(value) => { setCmeColumn(value); setMappingDirty(true); }}
          onApply={() => {
            setPreview(parseSurveyImportRows({ rows: sourceRows, questionOrder, questionLabels, questionMeta, existingEmails, sessionConfig,
              attendanceColumns: separateColumns ? attendanceColumns : undefined, cmeQuestionId, cmeColumn, questionColumns, emailColumn, sourceRowOffset: headerRow - 1 }));
            setMappingDirty(false);
            setResult("Đã đọc lại file theo cách ghép cột đã chọn. Kiểm tra các dòng trước khi import.");
          }} /></div>}

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">{fileName || "Chưa chọn file"}{sheets[sheetIndex] ? ` · ${sheets[sheetIndex].name}` : ""}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {preview ? `Đã đọc ${preview.totalRows} dòng dữ liệu. Chỉ các dòng sẵn sàng mới được import.` : "Chọn file Excel / CSV để xem trước danh sách."}
                </p>
              </div>
              {preview && (
                <div className="flex gap-2">
                  <div className="relative">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Tìm trong preview..."
                      className="w-56 rounded-xl border border-slate-200 bg-white pl-9 pr-3 py-2 text-sm outline-none focus:border-emerald-400"
                    />
                  </div>
                  <button onClick={clearPreview} className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                    Xoá preview
                  </button>
                </div>
              )}
            </div>
            {result && <p className="mt-3 rounded-xl bg-slate-50 px-3 py-2 text-sm text-slate-700">{result}</p>}
            {!!preview?.mappingIssues?.length && <div role="alert" className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800"><p className="font-semibold">Cột chưa được tự động ghép:</p><ul className="list-disc pl-5">{preview.mappingIssues.map((issue) => <li key={issue}>{issue}</li>)}</ul><p className="mt-2">Bạn có thể chọn lại cột và áp dụng, hoặc sửa trực tiếp trong bảng rồi Import dữ liệu đang xem. Đọc lại file sẽ thay thế các chỉnh sửa trong bảng.</p></div>}
            {!!preview?.unmappedHeaders?.length && <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-800">Cột chưa ghép (sẽ không lưu theo tên cột): {preview.unmappedHeaders.join(", ")}. Ghép các cột Gala/CME phía trên hoặc tạo câu hỏi tương ứng trong form.</p>}
          </div>

          {!preview && (
            <div className="p-10 text-center">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
                <FileSpreadsheet size={28} />
              </div>
              <h2 className="mt-4 text-lg font-bold text-slate-900">Import có kiểm tra trước</h2>
              <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
                File nên có hàng đầu là tên cột. Hệ thống sẽ tự map các cột giống tên câu hỏi, email, số điện thoại và hội trường.
              </p>
              <button
                onClick={() => inputRef.current?.click()}
                disabled={parsing || importing}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-sky-500 disabled:opacity-60"
              >
                {parsing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {parsing ? "Đang đọc file..." : "Chọn file Excel / CSV"}
              </button>
            </div>
          )}

          {preview && (
            <div className="relative">
              <div className="border-b border-slate-100 bg-slate-50 px-4 py-2 text-xs text-slate-500">
                Kéo ngang để xem đầy đủ các cột. Cột thao tác được giữ ở bên phải.
              </div>
              <div className="max-h-[68vh] overflow-auto overscroll-contain scrollbar-visible">
                <table className="min-w-max divide-y divide-slate-100 text-sm">
                <thead className="sticky top-0 z-10 bg-slate-50 shadow-[0_1px_0_0_rgba(226,232,240,1)]">
                  <tr>
                    <th className="px-4 py-3 text-left font-semibold text-slate-500 min-w-20">Dòng</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-500 min-w-44">Trạng thái</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-500 min-w-56">Email</th>
                    <th className="px-4 py-3 text-left font-semibold text-slate-500 min-w-44">Hội trường</th>
                    {questions.map((question) => (
                      <th key={question.id} className="px-4 py-3 text-left font-semibold text-slate-500 min-w-56 max-w-72">{question.text}</th>
                    ))}
                    <th className="sticky right-0 z-20 bg-slate-50 px-4 py-3 text-right font-semibold text-slate-500 min-w-28 shadow-[-8px_0_14px_-14px_rgba(15,23,42,0.45)]">Thao tác</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 bg-white">
                  {visibleRows.map((row) => (
                    <ImportRowView
                      key={row.id}
                      row={row}
                      questions={questions}
                      editing={editingId === row.id}
                      onEdit={() => setEditingId(row.id)}
                      onDone={() => setEditingId(null)}
                      onDelete={() => removeRow(row.id)}
                      onPatch={patchRow}
                      onPatchAnswer={patchAnswer}
                    />
                  ))}
                  {visibleRows.length === 0 && (
                    <tr>
                      <td colSpan={questions.length + 5} className="px-4 py-10 text-center text-slate-500">
                        Không có dòng nào khớp bộ lọc.
                      </td>
                    </tr>
                  )}
                </tbody>
                </table>
              </div>
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

function StatCard({ label, value, tone }: { label: string; value: number; tone: "slate" | "emerald" | "amber" | "red" }) {
  const toneClass = {
    slate: "text-slate-900 bg-white",
    emerald: "text-emerald-700 bg-emerald-50",
    amber: "text-amber-700 bg-amber-50",
    red: "text-red-700 bg-red-50",
  }[tone];

  return (
    <div className={`rounded-2xl border border-slate-200 p-4 shadow-sm ${toneClass}`}>
      <p className="text-2xl font-bold">{value}</p>
      <p className="mt-1 text-xs font-medium text-slate-500">{label}</p>
    </div>
  );
}

function ImportRowView({
  row,
  questions,
  editing,
  onEdit,
  onDone,
  onDelete,
  onPatch,
  onPatchAnswer,
}: {
  row: CsvImportRow;
  questions: QuestionInfo[];
  editing: boolean;
  onEdit: () => void;
  onDone: () => void;
  onDelete: () => void;
  onPatch: (id: string, patch: Partial<CsvImportRow>) => void;
  onPatchAnswer: (rowId: string, questionId: string, value: string) => void;
}) {
  const status = {
    ready: { label: "Sẵn sàng", className: "bg-emerald-50 text-emerald-700", icon: <CheckCircle2 size={14} /> },
    duplicate: { label: "Trùng", className: "bg-amber-50 text-amber-700", icon: <XCircle size={14} /> },
    invalid: { label: "Cần sửa", className: "bg-red-50 text-red-700", icon: <XCircle size={14} /> },
  }[row.status];

  return (
    <tr className="align-top hover:bg-slate-50/60">
      <td className="px-4 py-3 text-slate-500">#{row.sourceRow}</td>
      <td className="px-4 py-3">
        <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${status.className}`}>
          {status.icon} {status.label}
        </span>
        {row.issues.length > 0 && <p className="mt-1 max-w-48 text-xs text-slate-500">{row.issues.join(", ")}</p>}
      </td>
      <td className="px-4 py-3 min-w-52">
        {editing ? (
          <input
            value={row.email}
            onChange={(event) => onPatch(row.id, { email: event.target.value })}
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-emerald-400"
          />
        ) : (
          <span className="text-slate-700">{row.email || "Không có"}</span>
        )}
      </td>
      <td className="px-4 py-3 min-w-40">
        {editing ? (
          <input
            value={row.hall}
            onChange={(event) => onPatch(row.id, { hall: event.target.value })}
            className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-emerald-400"
          />
        ) : (
          <span className="text-slate-700">{row.hall || "-"}</span>
        )}
      </td>
      {questions.map((question) => (
        <td key={question.id} className="px-4 py-3 min-w-44">
          {editing ? (
            question.type === "choice" && question.options ? (
              <select
                multiple={question.allow_multiple}
                value={question.allow_multiple ? (Array.isArray(row.answers[question.id]) ? (row.answers[question.id] as number[]).map(String) : []) : String(row.answers[question.id] ?? "")}
                onChange={(event) => onPatchAnswer(row.id, question.id, question.allow_multiple ? Array.from(event.target.selectedOptions, (option) => option.value).filter(Boolean).join(",") : event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-emerald-400"
              >
                <option value="">Chọn</option>
                {question.options.map((option, index) => (
                  <option key={option} value={index}>{option}</option>
                ))}
              </select>
            ) : (
              <input
                value={String(row.answers[question.id] ?? "")}
                onChange={(event) => onPatchAnswer(row.id, question.id, event.target.value)}
                className="w-full rounded-lg border border-slate-200 px-2 py-1.5 outline-none focus:border-emerald-400"
              />
            )
          ) : (
            <span className="text-slate-700">{formatAttendanceAnswer(row.answers[question.id], question)}</span>
          )}
        </td>
      ))}
      <td className="sticky right-0 bg-white px-4 py-3 text-right shadow-[-8px_0_14px_-14px_rgba(15,23,42,0.45)]">
        <div className="inline-flex gap-1">
          {editing ? (
            <button onClick={onDone} className="rounded-lg bg-sky-600 px-2.5 py-1.5 text-xs font-semibold text-on-brand hover:bg-sky-500">
              Xong
            </button>
          ) : (
            <button onClick={onEdit} className="rounded-lg border border-slate-200 px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:bg-white">
              <Pencil size={13} />
            </button>
          )}
          <button onClick={onDelete} className="rounded-lg border border-red-100 px-2.5 py-1.5 text-xs font-medium text-red-600 hover:bg-red-50">
            <Trash2 size={13} />
          </button>
        </div>
      </td>
    </tr>
  );
}
