"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { QRCodeView } from "@/components/ui/QRCodeView";
import { buildPublicUrl } from "@/lib/site-url";
import { formatAttendanceAnswer } from "@/lib/attendance-display";
import { prizeCsvCell, type PrizeCampaign, type PrizeItem, type PrizeResult } from "@/lib/prize-draw";
import type { SurveyQuestion } from "@/lib/surveys";

type Entry = PrizeResult & { phone: string; answers: Record<string, unknown>; created_at: string; redeemed_by: string | null };
type Detail = { campaign: PrizeCampaign; items: PrizeItem[]; entries: Entry[]; questions: SurveyQuestion[] };
const field = "w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const button = "rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-on-brand disabled:opacity-50";
const secondary = "rounded-xl border border-slate-300 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 disabled:opacity-50";
const vnInput = (date: string) => new Date(Date.parse(date) + 7 * 3600000).toISOString().slice(0, 16);

async function api(id = "", body?: object) {
  const session = await supabase.auth.getSession();
  const response = await fetch(`/api/admin/prize-draw${id ? `?id=${id}` : ""}`, {
    method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${session.data.session?.access_token ?? ""}`, "Content-Type": "application/json" },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store",
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Không thực hiện được thao tác.");
  return data;
}

export function PrizeDrawManager() {
  const { user } = useAuth();
  const [campaigns, setCampaigns] = useState<PrizeCampaign[]>([]);
  const [forms, setForms] = useState<{ id: string; title: string }[]>([]);
  const [formId, setFormId] = useState("");
  const [phones, setPhones] = useState<SurveyQuestion[]>([]);
  const [phoneId, setPhoneId] = useState("");
  const [detail, setDetail] = useState<Detail | null>(null);
  const [draft, setDraft] = useState<PrizeCampaign | null>(null);
  const [items, setItems] = useState<PrizeItem[]>([]);
  const [role, setRole] = useState("viewer");
  const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const writable = role !== "viewer";
  const lock = busy || !writable;
  async function load(id = "") {
    const result = await api(id);
    setCampaigns(result.campaigns); setRole(result.role);
    if (result.forms) setForms(result.forms);
    if (result.campaign) { setDetail(result); setDraft(result.campaign); setItems(result.items); setDirty(false); setPage(0); }
  }
  useEffect(() => {
    let cancelled = false;
    if (user) void api().then(result => {
      if (!cancelled) { setCampaigns(result.campaigns); setRole(result.role); setForms(result.forms); }
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; };
  }, [user]);
  useEffect(() => {
    let cancelled = false;
    if (formId) void supabase.from("survey_questions").select("*").eq("survey_id", formId).eq("type", "phone").eq("required", true).is("show_if", null).then(({ data, error }) => {
      if (cancelled) return;
      if (error) setError("Không tải được câu hỏi SĐT.");
      else { setPhones(data ?? []); if (data?.length === 1) setPhoneId(data[0].id); }
    });
    return () => { cancelled = true; };
  }, [formId]);
  async function run(work: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await work(); } catch (e) { setError(e instanceof Error ? e.message : "Thao tác thất bại."); }
    finally { setBusy(false); }
  }
  const patch = (changes: Partial<PrizeCampaign>) => { setDraft(d => d ? { ...d, ...changes } : d); setDirty(true); };
  function changeItem(index: number, changes: Partial<PrizeItem>) {
    setItems(all => all.map((p, i) => i === index ? { ...p, ...changes } : p)); setDirty(true);
  }
  async function create(isDemo: boolean) {
    const result = await api("", { action: "create", is_demo: isDemo, ...(formId ? { survey_id: formId, phone_question_id: phoneId } : {}) });
    await load(); await load(result.id);
    setFormId(""); setMessage("Đã tạo chương trình nháp với 300 phần quà mẫu. Kiểm tra cấu hình rồi lưu trạng thái Mở.");
  }
  async function save() {
    if (!draft) return;
    await api("", { action: "save", id: draft.id, data: { ...draft, items } });
    await load(draft.id); setMessage("Đã lưu cấu hình.");
  }
  function exportCsv() {
    if (!detail) return;
    const qs = detail.questions.filter(q => !["section", "image_banner"].includes(q.type));
    const rows = [["SĐT", ...qs.map(q => q.text), "Quà", "Mã nhận quà", "Lúc quay", "Đã trao lúc", "Nhân viên"],
      ...detail.entries.map(e => [e.phone, ...qs.map(q => formatAttendanceAnswer(e.answers[q.id], q)), e.prize_name, e.claim_code, e.drawn_at, e.redeemed_at, e.redeemed_by])];
    const url = URL.createObjectURL(new Blob(["\uFEFF", rows.map(row => row.map(prizeCsvCell).join(",")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a"); a.href = url; a.download = `nhan-qua-${detail.campaign.id}.csv`; a.click(); URL.revokeObjectURL(url);
  }
  const filtered = detail?.entries.filter(e => `${e.phone} ${e.claim_code} ${e.prize_name ?? ""} ${Object.values(e.answers).join(" ")}`.toLocaleLowerCase().includes(search.toLocaleLowerCase())) ?? [];
  const allocated = detail?.items.reduce((n, p) => n + p.total - p.remaining, 0) ?? 0;
  return <div className="mx-auto max-w-6xl space-y-6 p-4 text-slate-900 sm:p-6">
    <header><h1 className="text-2xl font-bold">Vòng quay nhận quà</h1><p className="mt-2 text-sm text-slate-500">Form đăng ký → một lượt/SĐT → nhận quà. Kho quà dùng chung cho toàn chương trình.</p></header>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-4 text-red-700">{error}</p>}
    {message && <p role="status" className="rounded-xl bg-green-50 p-4 text-green-800">{message}</p>}
    <section className="space-y-4 rounded-2xl border bg-white p-5">
      <div className="flex flex-wrap items-center gap-3"><select aria-label="Chọn chương trình" disabled={busy || dirty} value={detail?.campaign.id ?? ""} onChange={e => void run(() => load(e.target.value))} className={`${field} sm:max-w-md`}><option value="" disabled>Chọn chương trình đã tạo…</option>{campaigns.map(c => <option key={c.id} value={c.id}>{c.is_demo ? "[DEMO] " : ""}{c.name}</option>)}</select><button disabled={busy || dirty} onClick={() => void run(() => load(detail?.campaign.id))} className={secondary}>Tải lại</button></div>
      {dirty && <p className="text-sm text-amber-700">Có thay đổi chưa lưu. Lưu hoặc bỏ thay đổi trước khi chuyển chương trình.</p>}
      <details><summary className="cursor-pointer text-sm font-semibold">Tạo chương trình với dữ liệu mẫu</summary><div className="mt-4 space-y-3">
        <label className="block text-sm">Form đăng ký<select className={`${field} mt-1`} disabled={lock || dirty} value={formId} onChange={e => { setFormId(e.target.value); setPhones([]); setPhoneId(""); }}><option value="">Tạo form mẫu mới (Họ tên, SĐT, Đơn vị)</option>{forms.map(f => <option key={f.id} value={f.id}>{f.title}</option>)}</select></label>
        {formId && <label className="block text-sm">Câu hỏi SĐT bắt buộc<select className={`${field} mt-1`} disabled={lock} value={phoneId} onChange={e => setPhoneId(e.target.value)}><option value="">Chọn câu hỏi…</option>{phones.map(q => <option key={q.id} value={q.id}>{q.text}</option>)}</select></label>}
        <p className="text-xs text-slate-500">Form có sẵn phải là khảo sát trống, chưa có phản hồi. Demo và chương trình thật có kho và danh sách riêng. Không thể đổi demo thành thật sau khi tạo.</p>
        <div className="flex flex-wrap gap-2"><button disabled={lock || dirty || (!!formId && !phoneId)} onClick={() => void run(() => create(true))} className={button}>Tạo demo mẫu</button><button disabled={lock || dirty || (!!formId && !phoneId)} onClick={() => void run(() => create(false))} className={secondary}>Tạo chương trình thật (nháp)</button></div>
      </div></details>
    </section>
    {draft && detail && <>
      <div className={`rounded-xl p-4 text-sm ${draft.is_demo ? "bg-amber-100 text-amber-900" : "bg-sky-50 text-sky-900"}`}>{draft.is_demo ? "DEMO: dùng quà mẫu. Khi mở, có thể thử ngay, không cần chờ ngày sự kiện. Muốn thử lại cùng SĐT, tạo demo khác." : "CHƯƠNG TRÌNH THẬT: chỉ mở quay trong thời gian đã cấu hình. Mỗi SĐT chỉ một lượt, không reset mỗi ngày."}</div>
      <div className="grid gap-6 lg:grid-cols-[1fr_260px]">
        <section className="space-y-4 rounded-2xl border bg-white p-5">
          <h2 className="font-bold">Cấu hình chương trình</h2>
          <label className="block text-sm">Tên chương trình<input className={`${field} mt-1`} value={draft.name} disabled={lock} onChange={e => patch({ name: e.target.value })} maxLength={160} /></label>
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Trạng thái<select className={`${field} mt-1`} disabled={lock} value={draft.status} onChange={e => patch({ status: e.target.value as PrizeCampaign["status"] })}><option value="draft">Nháp</option><option value="active">Mở</option><option value="paused">Tạm dừng</option><option value="closed">Đóng</option></select></label><label className="text-sm">Màu chủ đạo<input type="color" className={`${field} mt-1 h-10`} value={draft.accent_color} disabled={lock} onChange={e => patch({ accent_color: e.target.value })} /></label></div>
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm">Bắt đầu (giờ Việt Nam)<input type="datetime-local" className={`${field} mt-1`} value={vnInput(draft.starts_at)} disabled={lock} onChange={e => e.target.value && patch({ starts_at: `${e.target.value}:00+07:00` })} /></label><label className="text-sm">Đóng từ thời điểm (giờ Việt Nam)<input type="datetime-local" className={`${field} mt-1`} value={vnInput(draft.ends_at)} disabled={lock} onChange={e => e.target.value && patch({ ends_at: `${e.target.value}:00+07:00` })} /></label></div>
          <p className="text-xs text-slate-500">Mẫu: 12–24/11/2026; đóng lúc 00:00 ngày 25/11. Không chia hạn mức theo ngày.</p>
          <label className="block text-sm">Ảnh banner (URL HTTPS)<input type="url" className={`${field} mt-1`} value={draft.banner_url} disabled={lock} onChange={e => patch({ banner_url: e.target.value })} placeholder="https://…" /></label>
          <label className="block text-sm">Hướng dẫn nhận quà<textarea className={`${field} mt-1`} rows={3} value={draft.instructions} disabled={lock} onChange={e => patch({ instructions: e.target.value })} /></label>
          <label className="flex gap-2 text-sm"><input type="checkbox" checked={draft.track_redemption} disabled={lock} onChange={e => patch({ track_redemption: e.target.checked })} />Nhân viên xác nhận đã trao quà</label>
        </section>
        <aside className="h-fit space-y-4 rounded-2xl border bg-white p-5 text-center"><h2 className="font-bold">QR vào form</h2><QRCodeView value={buildPublicUrl(`/s/${draft.survey_id}`)} size={180} /><div className="space-y-3 text-sm"><Link href={`/s/${draft.survey_id}`} target="_blank" className="block text-sky-700 underline">Mở form đăng ký ↗</Link><Link href={`/prize-draw/${draft.id}`} target="_blank" className="block text-sky-700 underline">Mở vòng quay ↗</Link><Link href={`/admin/forms/${draft.survey_id}`} className="block text-sky-700 underline">Sửa câu hỏi / banner form</Link></div><p className="text-xs text-slate-500">Giữ câu hỏi SĐT bắt buộc, luôn hiển thị. SĐT chưa xác thực OTP.</p></aside>
      </div>
      <section className="space-y-4 rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Kho quà · Đã trúng {allocated} · Còn {detail.items.reduce((n, p) => n + p.remaining, 0)}</h2><button disabled={lock || items.length >= 12} className={secondary} onClick={() => { setItems(all => [...all, { id: crypto.randomUUID(), name: "Quà mới", color: "#16a34a", total: 10, remaining: 10, position: all.length }]); setDirty(true); }}>+ Thêm loại quà</button></div>
        {items.map((item, index) => {
          const saved = detail.items.find(p => p.id === item.id);
          const used = saved ? saved.total - saved.remaining : 0;
          return <div key={item.id} className="grid items-end gap-3 rounded-xl bg-slate-50 p-3 sm:grid-cols-[60px_1fr_120px_100px_60px]">
            <label className="text-xs">Màu<input type="color" aria-label={`Màu quà ${index + 1}`} className={`${field} mt-1 h-10 px-1`} value={item.color} disabled={lock} onChange={e => changeItem(index, { color: e.target.value })} /></label>
            <label className="text-xs">Tên quà<input aria-label={`Tên quà ${index + 1}`} className={`${field} mt-1`} value={item.name} disabled={lock} onChange={e => changeItem(index, { name: e.target.value })} /></label>
            <label className="text-xs">Tổng số lượng<input type="number" aria-label={`Số lượng quà ${index + 1}`} className={`${field} mt-1`} min={used} max={100000} value={item.total} disabled={lock} onChange={e => changeItem(index, { total: Number(e.target.value) })} /></label>
            <p className="pb-2 text-xs">Đã trúng {used}<br />Còn {item.total - used}</p><button aria-label={`Xóa quà ${index + 1}`} className="pb-2 text-xs text-red-600 disabled:opacity-30" disabled={lock || items.length === 1 || (!!saved && detail.entries.length > 0)} onClick={() => { setItems(all => all.filter(p => p.id !== item.id)); setDirty(true); }}>Xóa</button>
          </div>;
        })}
        <p className="text-xs text-slate-500">Tỷ lệ theo số quà còn lại. Hết quà sẽ dừng quay; đăng ký chưa giữ suất. Tổng số lượng không được thấp hơn số đã trúng.</p>
        <div className="flex gap-3"><button className={button} disabled={lock || !dirty} onClick={() => void run(save)}>{busy ? "Đang xử lý…" : "Lưu cấu hình"}</button><button className={secondary} disabled={busy || !dirty} onClick={() => { setDraft(detail.campaign); setItems(detail.items); setDirty(false); }}>Bỏ thay đổi</button></div>
      </section>
      <section className="space-y-4 rounded-2xl border bg-white p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="font-bold">Danh sách nhận quà ({detail.entries.length})</h2><button onClick={exportCsv} className={secondary}>Xuất CSV danh sách đang tải</button></div>
        <p className="text-xs text-slate-500">Tối đa 1.000 đăng ký mới nhất. Số tồn kho phía trên tính toàn bộ chương trình. Tra cứu theo SĐT hoặc mã nhận quà.</p>
        <input aria-label="Tìm khách nhận quà" className={field} placeholder="SĐT, tên khách hoặc mã nhận quà…" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
        <div className="overflow-x-auto"><table className="w-full text-left text-sm"><thead><tr className="border-b text-xs text-slate-500"><th className="py-3 pr-4">SĐT / Thông tin</th><th className="pr-4">Quà / Mã</th><th>Trao quà</th></tr></thead><tbody>{filtered.slice(page * 25, page * 25 + 25).map(e => <tr key={e.id} className="border-b align-top"><td className="py-3 pr-4"><p className="font-semibold">{e.phone}</p><details className="mt-1 text-xs"><summary className="cursor-pointer">Xem thông tin</summary>{detail.questions.filter(q => !["section", "image_banner"].includes(q.type)).map(q => <p key={q.id} className="mt-1">{q.text}: {formatAttendanceAnswer(e.answers[q.id], q)}</p>)}</details></td><td className="py-3 pr-4">{e.prize_name || "Chưa quay"}{e.drawn_at && <><p className="mt-1 max-w-[200px] break-all font-mono text-xs">{e.claim_code}</p><p className="mt-1 text-xs text-slate-500">{new Date(e.drawn_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p></>}</td><td className="py-3">{e.redeemed_at ? <span className="text-green-700">Đã trao</span> : e.prize_id && detail.campaign.track_redemption ? <button className={secondary} disabled={lock || dirty} onClick={() => void run(async () => { await api("", { action: "redeem", id: draft.id, data: { entry_id: e.id } }); await load(draft.id); setMessage("Đã xác nhận trao quà."); })}>Xác nhận đã trao</button> : "—"}</td></tr>)}</tbody></table></div>
        {!filtered.length && <p className="text-sm text-slate-500">Chưa có khách phù hợp.</p>}
        <div className="flex items-center gap-3 text-sm"><button className={secondary} disabled={page === 0} onClick={() => setPage(p => p - 1)}>Trước</button><span>Trang {page + 1}/{Math.max(1, Math.ceil(filtered.length / 25))}</span><button className={secondary} disabled={(page + 1) * 25 >= filtered.length} onClick={() => setPage(p => p + 1)}>Sau</button></div>
      </section>
    </>}
  </div>;
}
