"use client";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import type { PrizeCampaign, PrizeField } from "@/lib/prize-draw";
import styles from "./prize-studio.module.css";

export function PrizeFormEditor({ campaign, locked, onChange }: { campaign: PrizeCampaign; locked: boolean; onChange: (fields: PrizeField[]) => void }) {
  const fields = campaign.form_fields;
  const patch = (id: string, changes: Partial<PrizeField>) => onChange(fields.map(q => q.id === id ? { ...q, ...changes } : q));
  const move = (index: number, step: number) => { const next = [...fields]; [next[index], next[index + step]] = [next[index + step], next[index]]; onChange(next.map((q, position) => ({ ...q, position }))); };
  return <div className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3"><h3 className="font-bold">Câu hỏi đăng ký</h3><button className={styles.secondary} disabled={locked || fields.length >= 30} onClick={() => onChange([...fields, { id: crypto.randomUUID(), text: "Câu hỏi mới", type: "text", required: false, allow_multiple: false, options: null, show_if: null, position: fields.length }])}><Plus size={16} aria-hidden="true" />Thêm câu hỏi</button></div>
    {locked && <p className="rounded-xl bg-slate-50 p-4 text-sm leading-6 text-slate-600">Câu hỏi được khoá khi đã có người đăng ký hoặc tài khoản chỉ có quyền xem. Tiêu đề và lời cảm ơn có thể chỉnh riêng.</p>}
    {fields.map((q, index) => {
      const phone = q.id === campaign.phone_question_id;
      return <div key={q.id} className="space-y-4 rounded-2xl border border-slate-200 p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><span className="text-xs font-bold uppercase tracking-wider text-slate-500">Câu {index + 1}{phone ? " · Số điện thoại định danh" : ""}</span><div className="flex gap-2">
          <button className={styles.secondary} aria-label={`Đưa câu ${index + 1} lên`} disabled={locked || index === 0} onClick={() => move(index, -1)}><ArrowUp size={16} /></button>
          <button className={styles.secondary} aria-label={`Đưa câu ${index + 1} xuống`} disabled={locked || index === fields.length - 1} onClick={() => move(index, 1)}><ArrowDown size={16} /></button>
          <button className={styles.secondary} aria-label={`Xóa câu ${index + 1}`} disabled={locked || phone} onClick={() => onChange(fields.filter(f => f.id !== q.id).map((f, position) => ({ ...f, position })))}><Trash2 size={16} /></button>
        </div></div>
        <label className="block text-sm font-medium">Nội dung câu {index + 1}<input className={`${styles.field} mt-2`} value={q.text} maxLength={500} disabled={locked} onChange={e => patch(q.id, { text: e.target.value })} /></label>
        <div className="flex flex-wrap items-end gap-4"><label className="min-w-40 flex-1 text-sm font-medium">Loại câu hỏi<select className={`${styles.field} mt-2`} aria-label={`Loại câu ${index + 1}`} disabled={locked || phone} value={q.type} onChange={e => patch(q.id, { type: e.target.value as PrizeField["type"], options: e.target.value === "choice" ? ["Lựa chọn 1", "Lựa chọn 2"] : null, allow_multiple: false })}>
          <option value="text">Trả lời ngắn</option><option value="paragraph">Trả lời dài</option><option value="phone">Số điện thoại</option><option value="choice">Lựa chọn</option><option value="date">Ngày</option><option value="province">Tỉnh / Thành phố</option><option value="rating">Đánh giá 1–5</option><option value="nps">Điểm 0–10</option><option value="section">Tiêu đề nhóm</option><option value="image_banner">Hình ảnh</option>
        </select></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={locked || phone} checked={q.required} onChange={e => patch(q.id, { required: e.target.checked })} />Bắt buộc</label></div>
        {q.type === "choice" && <><label className="block text-sm font-medium">Lựa chọn (mỗi dòng một đáp án)<textarea className={`${styles.field} mt-2`} rows={3} disabled={locked} value={q.options?.join("\n") || ""} onChange={e => patch(q.id, { options: e.target.value.split("\n") })} /></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" disabled={locked} checked={q.allow_multiple} onChange={e => patch(q.id, { allow_multiple: e.target.checked })} />Cho phép chọn nhiều đáp án</label></>}
        {q.type === "image_banner" && <label className="block text-sm font-medium">URL ảnh HTTPS<input className={`${styles.field} mt-2`} disabled={locked} type="url" value={q.options?.[0] || ""} onChange={e => patch(q.id, { options: [e.target.value] })} /></label>}
        {q.show_if && <p className="text-xs text-slate-500">Giữ điều kiện hiển thị đã chuyển từ form cũ.</p>}
      </div>;
    })}
  </div>;
}
