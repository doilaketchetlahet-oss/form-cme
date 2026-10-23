"use client";

import { importColumnLabel, type AttendanceColumnMapping } from "@/lib/csv-import";
import type { CheckinSessionConfig } from "@/lib/checkin-sessions";

export function AttendanceImportMapping({ headers, config, questions, separate, mappings, cmeQuestionId, cmeColumn, dirty, disabled, questionColumns, emailColumn, onQuestionColumn, onEmailColumn, onSeparate, onMappings, onCmeQuestion, onCmeColumn, onApply }: {
  headers: string[]; config: CheckinSessionConfig | null;
  questions: { id: string; text: string; type: string; is_hall_selector: boolean }[];
  separate: boolean; mappings: AttendanceColumnMapping; cmeQuestionId: string; cmeColumn: number | null;
  dirty: boolean; disabled: boolean;
  questionColumns: Record<string, number | null>; emailColumn: number | null | undefined;
  onQuestionColumn: (id: string, value: number | null | undefined) => void;
  onEmailColumn: (value: number | null | undefined) => void;
  onSeparate: (value: boolean) => void; onMappings: (value: AttendanceColumnMapping) => void;
  onCmeQuestion: (value: string) => void; onCmeColumn: (value: number | null) => void; onApply: () => void;
}) {
  const columns = headers.map((header, index) => <option key={index} value={index}>{importColumnLabel(header, index)}</option>);
  const valueOf = (value: string) => value === "auto" ? undefined : value === "skip" ? null : Number(value);
  return <fieldset disabled={disabled} className="mt-5 space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
    <legend className="px-2 font-bold text-slate-900">Ghép cột tham dự và CME</legend>
    <p className="text-sm text-slate-600">Ghép cột Excel với từng trường trong form. Nếu tên cột bị trùng, chọn theo chữ cột A, B, C… Cột chưa có trường tương ứng sẽ không được lưu; hãy thêm trường vào form nếu cần giữ thông tin đó.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="min-w-0 text-sm font-medium">Email nhận QR
        <select aria-label="Cột Email nhận QR" value={emailColumn === undefined ? "auto" : emailColumn === null ? "skip" : emailColumn} onChange={(event) => onEmailColumn(valueOf(event.target.value))} className="mt-1 block w-full rounded-lg border p-2">
          <option value="auto">Tự nhận diện / theo trường Email đã ghép</option><option value="skip">Không nhập Email nhận QR</option>{columns}
        </select>
      </label>
      {questions.map((question) => <label key={question.id} className="min-w-0 text-sm font-medium">{question.text}
        <select aria-label={`Ghép trường ${question.text}`} value={!Object.hasOwn(questionColumns, question.id) ? "auto" : questionColumns[question.id] === null ? "skip" : questionColumns[question.id]!} onChange={(event) => onQuestionColumn(question.id, valueOf(event.target.value))} className="mt-1 block w-full rounded-lg border p-2">
          <option value="auto">Tự ghép theo tên cột</option><option value="skip">Không ghép cột</option>{columns}
        </select>
      </label>)}
    </div>
    <p className="text-sm text-slate-600">Cột đánh dấu nhận Có/Không, Yes/No, 1/0, x/✓. Ô trống cần được bổ sung; không tự cấp quyền tham dự.</p>
    {!config?.questionId && <p className="text-sm text-amber-700">Để dùng cột buổi riêng, mở chỉnh sửa form → Check-in → Tạo mẫu Hội thảo + Gala, lưu rồi tải lại trang này.</p>}
    {config?.questionId && <>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={separate} onChange={(e) => onSeparate(e.target.checked)} />File có cột Có/Không riêng cho từng buổi</label>
      {separate && config.sessions.map((session) => {
        const mapping = mappings[session.id] ?? { column: null, fallback: "unknown" as const };
        return <label key={session.id} className="flex flex-wrap items-center gap-2 text-sm"><span className="min-w-36 font-medium">{session.name}</span>
          <select aria-label={`Cột ${session.name}`} value={mapping.column === null ? mapping.fallback : String(mapping.column)} onChange={(e) => {
            const value = e.target.value;
            onMappings({ ...mappings, [session.id]: /^\d+$/.test(value) ? { column: Number(value), fallback: "unknown" } : { column: null, fallback: value as "unknown" | "yes" | "no" } });
          }} className="max-w-full rounded-lg border p-2">
            <option value="unknown">Chọn cột hoặc giá trị</option><option value="yes">Tất cả dòng: Có</option><option value="no">Tất cả dòng: Không</option>{columns}
          </select></label>;
      })}
    </>}
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <span className="font-medium">CME</span>
      <select aria-label="Câu hỏi đăng ký CME" value={cmeQuestionId} onChange={(e) => onCmeQuestion(e.target.value)} className="max-w-full rounded-lg border p-2">
        <option value="">Theo tên cột khớp câu hỏi</option>
        {questions.filter((q) => q.type === "choice" && !q.is_hall_selector && q.id !== config?.questionId).map((q) => <option key={q.id} value={q.id}>{q.text}</option>)}
      </select>
      {cmeQuestionId && <select aria-label="Cột CME trong file" value={cmeColumn ?? ""} onChange={(e) => onCmeColumn(e.target.value === "" ? null : Number(e.target.value))} className="max-w-full rounded-lg border p-2">
        <option value="">Theo tên câu hỏi</option>{columns}
      </select>}
    </div>
    <p className="text-xs text-slate-500">Tạo câu hỏi “Đăng ký cấp CME” với lựa chọn Có/Không trong form nếu chưa có. Đây là thông tin đăng ký, không phải xác nhận đủ điều kiện cấp.</p>
    <button type="button" onClick={onApply} className="rounded-lg bg-sky-600 px-3 py-2 text-sm font-semibold text-white">Áp dụng ghép cột / đọc lại file</button>
    <p className="text-xs text-amber-700">Đọc lại file sẽ thay thế các chỉnh sửa trong bảng xem trước.{dirty && " Cần áp dụng ghép cột trước khi import."}</p>
  </fieldset>;
}
