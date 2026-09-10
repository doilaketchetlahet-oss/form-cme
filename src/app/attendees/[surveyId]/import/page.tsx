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
  parseSurveyImportCsv,
  type CsvImportPreview,
  type CsvImportRow,
  type ImportQuestionMeta,
} from "@/lib/csv-import";

type QuestionInfo = {
  id: string;
  text: string;
  type: string;
  options: string[] | null;
  is_hall_selector: boolean;
};

export default function AttendeeImportPage({ params }: { params: Promise<{ surveyId: string }> }) {
  const [sid, setSid] = useState("");
  useEffect(() => { params.then(({ surveyId }) => setSid(surveyId)); }, [params]);
  if (!sid) return <div className="min-h-dvh bg-slate-50" />;
  return <PinGate surveyId={sid}><AttendeeImportInner surveyId={sid} /></PinGate>;
}

function AttendeeImportInner({ surveyId }: { surveyId: string }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [surveyTitle, setSurveyTitle] = useState("");
  const [questions, setQuestions] = useState<QuestionInfo[]>([]);
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const [preview, setPreview] = useState<CsvImportPreview | null>(null);
  const [fileName, setFileName] = useState("");
  const [loading, setLoading] = useState(true);
  const [parsing, setParsing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<string | null>(null);

  const questionOrder = useMemo(() => questions.map((q) => q.id), [questions]);
  const questionLabels = useMemo(() => Object.fromEntries(questions.map((q) => [q.id, q.text])), [questions]);
  const questionMeta = useMemo<Record<string, ImportQuestionMeta>>(
    () => Object.fromEntries(questions.map((q) => [q.id, { type: q.type, options: q.options, isHall: q.is_hall_selector }])),
    [questions],
  );

  const loadData = useCallback(async () => {
    setLoading(true);
    const [{ data: survey }, { data: questionRows }, { data: responseRows }] = await Promise.all([
      supabase.from("surveys").select("title").eq("id", surveyId).single(),
      supabase
        .from("survey_questions")
        .select("id, text, type, options, is_hall_selector")
        .eq("survey_id", surveyId)
        .not("type", "in", '("section","image_banner")')
        .order("position"),
      supabase.from("survey_responses").select("*").eq("survey_id", surveyId),
    ]);

    setSurveyTitle(survey?.title ?? "Form đăng ký");
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

  const visibleRows = useMemo(() => {
    const rows = preview?.rows ?? [];
    const needle = query.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((row) => {
      const values = [row.email, row.hall, ...Object.values(row.answers).map(String), ...row.issues];
      return values.some((value) => value.toLowerCase().includes(needle));
    });
  }, [preview, query]);

  const handleFile = async (file: File) => {
    setParsing(true);
    setResult(null);
    try {
      const text = await file.text();
      const parsed = parseSurveyImportCsv({
        text,
        questionOrder,
        questionLabels,
        questionMeta,
        existingEmails,
      });
      setFileName(file.name);
      setPreview(parsed);
    } finally {
      setParsing(false);
    }
  };

  const patchRow = (id: string, patch: Partial<CsvImportRow>) => {
    setPreview((current) => {
      if (!current) return current;
      return {
        ...current,
        rows: current.rows.map((row) => {
          if (row.id !== id) return row;
          const next = { ...row, ...patch };
          const issues = [...next.issues.filter((issue) => !issue.startsWith("Email"))];
          const email = next.email.trim().toLowerCase();
          if (email && existingEmails.has(email)) issues.push("Email đã tồn tại");
          if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) issues.push("Email không hợp lệ");
          const status = issues.length > 0 ? (issues.some((issue) => issue.includes("tồn tại")) ? "duplicate" : "invalid") : "ready";
          return { ...next, email, issues, status };
        }),
      };
    });
  };

  const patchAnswer = (rowId: string, questionId: string, value: string) => {
    const meta = questionMeta[questionId];
    const finalValue = meta?.type === "choice" && /^\d+$/.test(value) ? Number(value) : value;
    setPreview((current) => {
      if (!current) return current;
      return {
        ...current,
        rows: current.rows.map((row) => {
          if (row.id !== rowId) return row;
          const answers = { ...row.answers, [questionId]: finalValue };
          const hall = meta?.isHall && meta.options && typeof finalValue === "number" ? meta.options[finalValue] : row.hall;
          return { ...row, answers, hall };
        }),
      };
    });
  };

  const removeRow = (id: string) => {
    setPreview((current) => current ? { ...current, rows: current.rows.filter((row) => row.id !== id) } : current);
  };

  const clearPreview = () => {
    setPreview(null);
    setFileName("");
    setResult(null);
    setQuery("");
    if (inputRef.current) inputRef.current.value = "";
  };

  const doImport = async () => {
    if (!preview || stats.ready === 0 || importing) return;
    setImporting(true);
    setResult(null);
    try {
      const payload = buildImportPayload(surveyId, preview.rows);
      const { data, error } = await supabase.from("survey_responses").insert(payload).select("*");
      if (error) {
        setResult(`Import thất bại: ${error.message}`);
        return;
      }
      setResponses((prev) => [...((data ?? []) as SurveyResponse[]), ...prev]);
      setResult(`Đã import ${data?.length ?? payload.length} người vào danh sách.`);
      setPreview((current) => current ? { ...current, rows: current.rows.filter((row) => row.status !== "ready") } : current);
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

  return (
    <div className="min-h-dvh bg-slate-50">
      <div className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10 shadow-sm shadow-slate-200/40">
        <div className="max-w-6xl mx-auto">
          <Link href={`/attendees/${surveyId}`} className="inline-flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900">
            <ArrowLeft size={16} /> Quay lại danh sách
          </Link>
          <div className="mt-3 flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Import CSV</p>
              <h1 className="mt-1 text-2xl font-bold text-slate-900 leading-snug">{surveyTitle}</h1>
              <p className="mt-1 text-sm text-slate-500">Xem trước, sửa và xoá từng dòng trước khi đưa vào danh sách đăng ký.</p>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => inputRef.current?.click()}
                className="inline-flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50"
              >
                <Upload size={16} /> Chọn file CSV
              </button>
              <button
                onClick={doImport}
                disabled={!preview || stats.ready === 0 || importing}
                className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-sky-500 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {importing ? <Loader2 size={16} className="animate-spin" /> : <CheckCircle2 size={16} />}
                {importing ? "Đang import..." : `Import ${stats.ready} người`}
              </button>
            </div>
          </div>
          <input
            ref={inputRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) void handleFile(file);
            }}
          />
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-4 py-5">
        <div className="grid gap-3 md:grid-cols-4">
          <StatCard label="Tổng dòng" value={stats.total} tone="slate" />
          <StatCard label="Sẵn sàng import" value={stats.ready} tone="emerald" />
          <StatCard label="Trùng email" value={stats.duplicate} tone="amber" />
          <StatCard label="Cần sửa" value={stats.invalid} tone="red" />
        </div>

        <section className="mt-5 rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 p-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div className="min-w-0">
                <p className="text-sm font-bold text-slate-900">{fileName || "Chưa chọn file"}</p>
                <p className="text-xs text-slate-500 mt-1">
                  {preview ? `Đã đọc ${preview.totalRows} dòng dữ liệu. Chỉ các dòng sẵn sàng mới được import.` : "Chọn file CSV để xem trước danh sách."}
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
                disabled={parsing}
                className="mt-5 inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-sky-500 disabled:opacity-60"
              >
                {parsing ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />}
                {parsing ? "Đang đọc file..." : "Chọn file CSV"}
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
                    {questions.slice(0, 5).map((question) => (
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
                      questions={questions.slice(0, 5)}
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
                      <td colSpan={questions.slice(0, 5).length + 5} className="px-4 py-10 text-center text-slate-500">
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
                value={String(row.answers[question.id] ?? "")}
                onChange={(event) => onPatchAnswer(row.id, question.id, event.target.value)}
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
            <span className="text-slate-700">{formatAnswer(row.answers[question.id], question)}</span>
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

function formatAnswer(value: string | number | undefined, question: QuestionInfo) {
  if (value === undefined || value === "") return "-";
  if (question.type === "choice" && question.options && typeof value === "number") {
    return question.options[value] ?? String(value);
  }
  return String(value);
}
