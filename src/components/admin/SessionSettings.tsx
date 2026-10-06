"use client";

import type { SurveyQuestionUpsert } from "@/lib/surveys";
import { normalizeSessionConfig, type CheckinSession, type CheckinSessionConfig } from "@/lib/checkin-sessions";

function displayDate(value: string | null) {
  return value && Number.isFinite(Date.parse(value)) ? new Date(Date.parse(value) + 7 * 3600000).toISOString().slice(0, 16) : "";
}

function readDate(value: string) {
  return value ? new Date(`${value}:00+07:00`).toISOString() : null;
}

export function SessionSettings({ value, questions, onChange, onPreset }: {
  value?: CheckinSessionConfig | null;
  questions: SurveyQuestionUpsert[];
  onChange: (config: CheckinSessionConfig | null) => void;
  onPreset: () => void;
}) {
  const config = normalizeSessionConfig(value);
  const choices = questions.filter((q) => q.id && q.type === "choice");
  const selected = choices.find((q) => q.id === config?.questionId);
  const patch = (id: string, data: Partial<CheckinSession>) => {
    if (config) onChange({ ...config, sessions: config.sessions.map((session) => session.id === id ? { ...session, ...data } : session) });
  };
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-white/10 bg-white/[0.02] p-4">
      <p className="text-sm font-semibold text-white">Một QR, nhiều buổi tham dự</p>
      <p className="text-xs leading-5 text-slate-400">Mỗi buổi có hội trường, giờ mở cửa và nhóm khách được tham dự riêng. Bỏ trống giờ để nhân viên check-in bất kỳ lúc nào.</p>
      <div className="flex flex-wrap gap-2">
        {!config && <button type="button" onClick={onPreset} className="rounded-lg bg-sky-600 px-3 py-2 text-xs font-semibold text-white">Tạo mẫu Hội thảo + Gala</button>}
        <button type="button" onClick={() => onChange({ questionId: config?.questionId ?? null, sessions: [...(config?.sessions ?? []), { id: crypto.randomUUID(), name: "Buổi mới", hall: "", opensAt: null, closesAt: null, optionIndexes: [] }] })} className="rounded-lg border border-white/15 px-3 py-2 text-xs text-slate-200">Thêm buổi</button>
      </div>
      {config && <>
        <label className="block text-xs text-slate-300">Câu hỏi xác định quyền tham dự
          <select value={config.questionId ?? ""} onChange={(e) => onChange({ ...config, questionId: e.target.value || null, sessions: config.sessions.map((session) => ({ ...session, optionIndexes: [] })) })} className="admin-field mt-1 w-full rounded-lg px-3 py-2">
            <option value="">Tất cả người đăng ký được tham dự mọi buổi</option>
            {choices.map((q) => <option key={q.id} value={q.id}>{q.text}</option>)}
          </select>
        </label>
        {config.sessions.map((session) => <div key={session.id} className="space-y-3 rounded-xl border border-white/10 p-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-xs text-slate-300">Tên buổi<input value={session.name} onChange={(e) => patch(session.id, { name: e.target.value })} className="admin-field mt-1 w-full rounded-lg px-3 py-2" /></label>
            <label className="text-xs text-slate-300">Hội trường<input value={session.hall} placeholder="VD: Hội trường A" onChange={(e) => patch(session.id, { hall: e.target.value })} className="admin-field mt-1 w-full rounded-lg px-3 py-2" /></label>
            <label className="text-xs text-slate-300">Mở check-in (giờ Việt Nam)<input type="datetime-local" value={displayDate(session.opensAt)} onChange={(e) => patch(session.id, { opensAt: readDate(e.target.value) })} className="admin-field mt-1 w-full rounded-lg px-3 py-2" /></label>
            <label className="text-xs text-slate-300">Đóng check-in (giờ Việt Nam)<input type="datetime-local" value={displayDate(session.closesAt)} onChange={(e) => patch(session.id, { closesAt: readDate(e.target.value) })} className="admin-field mt-1 w-full rounded-lg px-3 py-2" /></label>
          </div>
          {selected && <div className="space-y-1"><p className="text-xs font-medium text-slate-300">Nhóm được tham dự buổi này</p>{selected.options?.map((option, index) => <label key={index} className="flex items-center gap-2 text-xs text-slate-300"><input type="checkbox" checked={session.optionIndexes.includes(index)} onChange={(e) => patch(session.id, { optionIndexes: e.target.checked ? [...session.optionIndexes, index] : session.optionIndexes.filter((i) => i !== index) })} />{option || `Lựa chọn ${index + 1}`}</label>)}</div>}
          <button type="button" onClick={() => onChange(config.sessions.length === 1 ? null : { ...config, sessions: config.sessions.filter((item) => item.id !== session.id) })} className="text-xs text-red-400">Xóa buổi này</button>
        </div>)}
        <p className="text-[11px] leading-5 text-slate-400">Câu hỏi quyền tham dự cần bắt buộc và luôn hiển thị. Với khách đã đăng ký, giữ nguyên thứ tự lựa chọn để bảo toàn quyền tham dự.</p>
      </>}
    </div>
  );
}
