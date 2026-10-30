"use client";

import { useMemo, useState } from "react";
import { Download, FileText, Search } from "lucide-react";
import { formatAttendanceAnswer } from "@/lib/attendance-display";
import { slugifyEmailField } from "@/lib/email-template";
import { qrExportLabel } from "@/lib/qr-export";
import type { SurveyQuestion, SurveyResponse } from "@/lib/surveys";

const PAGE_SIZE = 25;
const SKIP_TYPES = new Set(["section", "image_banner", "file_upload", "signature", "face_checkin"]);
const searchKey = (text: string) => text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

export function InvitePdfRecipients({ responses, questions, busy, ready, onExport }: {
  responses: SurveyResponse[];
  questions: SurveyQuestion[];
  busy: boolean;
  ready: boolean;
  onExport: (targets: SurveyResponse[], individual?: boolean) => void;
}) {
  const groupFields = useMemo(() => [
    ...questions.filter(question => !SKIP_TYPES.has(question.type)).map(question => ({ id: question.id, label: question.text, question })),
    { id: "$batch", label: "Đợt import", question: undefined },
  ], [questions]);
  const preferredField = groupFields.find(field => /(?:^|_)(?:truong|school|university|don_vi|co_quan|organization|organisation|company)(?:_|$)/.test(slugifyEmailField(field.label)))?.id ?? "$batch";
  const [fieldId, setFieldId] = useState<string | null>(null);
  const [group, setGroup] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [scope, setScope] = useState<"filtered" | "selected">("filtered");
  const [pageIndex, setPageIndex] = useState(0);
  const field = groupFields.find(item => item.id === (fieldId ?? preferredField));
  const rows = useMemo(() => responses.map(response => {
    const value = field?.question ? response.answers[field.id] : response.import_batch;
    const groupLabel = value == null || value === "" ? "" : (field?.question ? formatAttendanceAnswer(value, field.question) : String(value)).trim().replace(/\s+/g, " ");
    const name = qrExportLabel(response, questions);
    const details = questions.filter(question => !SKIP_TYPES.has(question.type)).map(question => formatAttendanceAnswer(response.answers[question.id], question)).join(" ");
    return { response, name, groupLabel, search: searchKey(`${name} ${response.email ?? ""} ${response.import_batch ?? ""} ${details}`) };
  }), [responses, questions, field]);
  const groups = useMemo(() => {
    const counts = new Map<string, number>();
    rows.forEach(row => counts.set(row.groupLabel, (counts.get(row.groupLabel) ?? 0) + 1));
    return [...counts].sort(([a], [b]) => a.localeCompare(b, "vi"));
  }, [rows]);
  const filtered = useMemo(() => rows.filter(row => (!group || `value:${row.groupLabel}` === group) && row.search.includes(searchKey(search.trim()))), [rows, group, search]);
  const chosen = responses.filter(response => selected.has(response.id));
  const targets = scope === "selected" ? chosen : filtered.map(row => row.response);
  const outsideCount = chosen.length - filtered.filter(row => selected.has(row.response.id)).length;
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(pageIndex, pages - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const selectedInFilter = filtered.filter(row => selected.has(row.response.id)).length;
  const allChecked = filtered.length > 0 && selectedInFilter === filtered.length;
  const filterChanged = () => { setPageIndex(0); setScope("filtered"); };
  const toggle = (ids: string[], checked: boolean) => {
    setSelected(previous => {
      const next = new Set(previous);
      ids.forEach(id => checked ? next.add(id) : next.delete(id));
      return next;
    });
    setScope("selected");
  };
  const buttonClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-sky-700 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-50";

  return (
    <section id="pdf-recipients" aria-labelledby="pdf-recipients-title" className="mb-6 scroll-mt-6 rounded-2xl border border-sky-100 bg-white p-4 sm:p-6">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="pdf-recipients-title" className="text-lg font-semibold text-slate-900">Chọn người nhận để xuất PDF</h2>
          <p className="mt-1 text-sm text-slate-600">Lọc theo trường/đơn vị, đợt import hoặc thông tin đăng ký. Tải từng PDF hoặc xuất một nhóm thành ZIP.</p>
        </div>
        <span className="rounded-lg bg-sky-50 px-3 py-2 text-sm font-semibold text-sky-800">{responses.length} người đăng ký</span>
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm font-medium text-slate-700">Tìm người nhận
          <span className="relative mt-1 block">
            <Search size={16} aria-hidden="true" className="pointer-events-none absolute left-3 top-3.5 text-slate-400" />
            <input type="search" value={search} disabled={busy} onChange={event => { setSearch(event.target.value); filterChanged(); }} placeholder="Tên, email, trường/đơn vị…" className="admin-field min-h-11 w-full rounded-xl py-2 pl-9 pr-3 font-normal" />
          </span>
        </label>
        <label className="text-sm font-medium text-slate-700">Lọc theo thông tin
          <select aria-label="Lọc theo thông tin" value={field?.id ?? "$batch"} disabled={busy} onChange={event => { setFieldId(event.target.value); setGroup(""); filterChanged(); }} className="admin-field mt-1 min-h-11 w-full rounded-xl px-3 py-2 font-normal">
            {groupFields.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}
          </select>
        </label>
        <label className="text-sm font-medium text-slate-700">Chọn nhóm
          <select aria-label="Chọn nhóm" value={group} disabled={busy} onChange={event => { setGroup(event.target.value); filterChanged(); }} className="admin-field mt-1 min-h-11 w-full rounded-xl px-3 py-2 font-normal">
            <option value="">Tất cả nhóm ({responses.length})</option>
            {groups.map(([label, count]) => <option key={label} value={`value:${label}`}>{label || "Chưa có thông tin"} ({count})</option>)}
          </select>
        </label>
      </div>
      <div className="my-3 flex flex-wrap items-center justify-between gap-2">
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-700">
          <input type="checkbox" aria-label="Chọn tất cả kết quả đang lọc" checked={allChecked} ref={node => { if (node) node.indeterminate = selectedInFilter > 0 && !allChecked; }} disabled={busy || !filtered.length} onChange={event => toggle(filtered.map(row => row.response.id), event.target.checked)} className="h-4 w-4 accent-sky-600" />
          Chọn tất cả {filtered.length} kết quả đang lọc
        </label>
        <div className="flex gap-2">
          {(search || group) && <button type="button" disabled={busy} onClick={() => { setSearch(""); setGroup(""); filterChanged(); }} className={buttonClass}>Xóa bộ lọc</button>}
          {!!selected.size && <button type="button" disabled={busy} onClick={() => { setSelected(new Set()); setScope("selected"); }} className={buttonClass}>Bỏ chọn ({chosen.length})</button>}
        </div>
      </div>
      <ul className="max-h-96 overflow-y-auto rounded-xl border border-slate-200 divide-y divide-slate-100" aria-label="Danh sách xuất PDF">
        {visible.map(row => <li key={row.response.id} className={`flex flex-wrap items-center gap-2 px-3 py-2 sm:gap-4 ${selected.has(row.response.id) ? "bg-sky-50/70" : "bg-white"}`}>
          <label className="flex min-h-11 min-w-0 flex-1 cursor-pointer items-center gap-3">
            <input type="checkbox" aria-label={`Chọn ${row.name}`} checked={selected.has(row.response.id)} disabled={busy} onChange={event => toggle([row.response.id], event.target.checked)} className="h-4 w-4 shrink-0 accent-sky-600" />
            <span className="min-w-0 break-words text-sm"><span className="block font-semibold text-slate-900">{row.name}</span><span className="block break-all text-slate-500">{row.response.email || "Chưa có email"}</span><span className="block text-slate-600">{row.groupLabel || "Chưa có thông tin"}</span></span>
          </label>
          <button type="button" aria-label={`Tải PDF của ${row.name}`} disabled={busy || !ready} onClick={() => onExport([row.response], true)} className={buttonClass}><Download size={15} aria-hidden="true" /> Tải PDF</button>
        </li>)}
        {!visible.length && <li className="px-4 py-8 text-center text-sm text-slate-500">{responses.length ? "Không có người nhận khớp bộ lọc." : "Chưa có người đăng ký."}</li>}
      </ul>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 text-sm text-slate-600">
        <span>{filtered.length ? currentPage * PAGE_SIZE + 1 : 0}–{Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} / {filtered.length} kết quả</span>
        {pages > 1 && <div className="flex items-center gap-2"><button type="button" disabled={busy || currentPage === 0} onClick={() => setPageIndex(currentPage - 1)} className={buttonClass}>Trang trước</button><span>{currentPage + 1}/{pages}</span><button type="button" disabled={busy || currentPage + 1 === pages} onClick={() => setPageIndex(currentPage + 1)} className={buttonClass}>Trang sau</button></div>}
      </div>
      <div className="mt-4 rounded-xl border border-sky-100 bg-sky-50/60 p-3 sm:p-4">
        <div role="radiogroup" aria-label="Phạm vi xuất PDF" className="flex flex-wrap gap-x-6 gap-y-2 text-sm text-slate-700">
          <label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="radio" name="pdf-export-scope" value="filtered" checked={scope === "filtered"} disabled={busy} onChange={() => setScope("filtered")} className="accent-sky-600" />Kết quả đang lọc ({filtered.length})</label>
          <label className="flex min-h-11 cursor-pointer items-center gap-2"><input type="radio" name="pdf-export-scope" value="selected" checked={scope === "selected"} disabled={busy} onChange={() => setScope("selected")} className="accent-sky-600" />Người đã chọn ({chosen.length})</label>
        </div>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <p role="status" aria-live="polite" className="text-sm text-slate-700">Sẽ xuất <strong>{targets.length} PDF</strong>{scope === "selected" ? " cho người đã chọn" : " theo bộ lọc hiện tại"}.{scope === "selected" && outsideCount > 0 ? ` Có ${outsideCount} người đã chọn nằm ngoài bộ lọc hiện tại.` : ""}</p>
          <button type="button" onClick={() => onExport([...targets])} disabled={busy || !ready || targets.length === 0} className={`${buttonClass} border-sky-600 bg-sky-600 text-white hover:bg-sky-700`}><FileText size={16} aria-hidden="true" />{busy ? "Đang xử lý…" : `Xuất ${targets.length} PDF (ZIP)`}</button>
        </div>
        {!ready && <p className="mt-2 text-sm text-slate-600">Tải mẫu thiệp trước khi xuất PDF.</p>}
      </div>
    </section>
  );
}
