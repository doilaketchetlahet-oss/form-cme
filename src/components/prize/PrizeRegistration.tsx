"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import { ArrowRight, Check, Gift, ShieldCheck } from "lucide-react";
import { prizeAvailability, prizeFieldVisible, prizeTextColor, validatePrizeAnswers, type PrizeSnapshot } from "@/lib/prize-draw";
import { PrizeImage } from "./PrizeImage";
import styles from "./prize-studio.module.css";

export function PrizeRegistration({ id }: { id: string }) {
  const [data, setData] = useState<PrizeSnapshot | null>(null);
  const [answers, setAnswers] = useState<Record<string, string | number | number[]>>({});
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submitted = useRef(false);
  const alertRef = useRef<HTMLParagraphElement>(null);
  async function load() {
    const response = await fetch(`/api/prize-draw/${id}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không tải được form.");
    setData(result); return result as PrizeSnapshot;
  }
  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/prize-draw/${id}`, { cache: "no-store", signal: controller.signal }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Không tải được form.");
      setData(result);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [id]);
  async function submit(event: React.FormEvent) {
    event.preventDefault(); if (!data || submitted.current) return;
    submitted.current = true; setBusy(true); setError("");
    try {
      validatePrizeAnswers(data.campaign.form_fields, data.campaign.phone_question_id, answers);
      const response = await fetch(`/api/prize-draw/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "register", answers }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Chưa đăng ký được. Vui lòng thử lại.");
      setData(current => current ? { ...current, entry: result.entry } : current);
    } catch (e) {
      let restored = false;
      try { restored = !!(await load()).entry; } catch { /* Keep entered answers for retry. */ }
      if (!restored) { setError(e instanceof Error ? e.message : "Mất kết nối."); setTimeout(() => alertRef.current?.focus(), 0); }
    } finally { setBusy(false); submitted.current = false; }
  }
  const campaign = data?.campaign, unavailable = data ? prizeAvailability(data.campaign, data.items) : null;
  const update = (key: string, value: string | number | number[]) => setAnswers(old => ({ ...old, [key]: value }));
  return <main className={`${styles.studio} ${styles.public} px-4 py-8 sm:py-12`} style={{ "--prize-primary": campaign?.accent_color || "#0369a1", "--prize-on-primary": prizeTextColor(campaign?.accent_color || "#0369a1") } as CSSProperties}>
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex items-center gap-3"><span className="rounded-xl bg-sky-100 p-3 text-sky-800"><Gift aria-hidden="true" size={24} /></span><span className="text-sm font-bold tracking-wide">QUAY NHẬN QUÀ</span>{campaign?.is_demo && <span className="ml-auto rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-900">MERAP DEMO</span>}</div>
      {data && campaign ? <div className="grid items-start gap-8 lg:grid-cols-[.9fr_1.1fr] lg:gap-x-12">
        <aside className="space-y-6">
          <p className="text-xs font-bold uppercase tracking-[.2em] text-sky-800">Một lượt quay · Một niềm vui</p>
          <h1 className="text-3xl font-bold leading-tight tracking-tight sm:text-4xl">{campaign.form_title}</h1>
          <p className="whitespace-pre-wrap text-base leading-7 text-slate-600">{campaign.form_description}</p>
          {campaign.banner_url && <div className="overflow-hidden rounded-3xl"><PrizeImage src={campaign.banner_url} name={campaign.name} priority /></div>}
        </aside>
        <section className={`${styles.card} h-fit p-5 sm:p-8 lg:col-start-2 lg:row-start-1 lg:row-span-2`}>
          {data.entry ? <div className="py-8 text-center"><Check className="mx-auto mb-5 rounded-full bg-emerald-100 p-3 text-emerald-700" size={60} aria-hidden="true" /><h2 className="text-2xl font-bold">{data.entry.prize_id ? "Bạn đã nhận quà!" : "Lượt quay đã sẵn sàng!"}</h2><p className="my-5 whitespace-pre-wrap leading-7 text-slate-600">{campaign.thank_you_message}</p><Link href={`/prize-draw/${id}`} className={`${styles.primary} w-full`}>{data.entry.prize_id ? "Xem quà của bạn" : "Quay nhận quà"}<ArrowRight size={18} aria-hidden="true" /></Link></div> : <>
            <div className="mb-6 flex items-center justify-between gap-4"><h2 className="text-xl font-bold">Thông tin tham gia</h2><span className="text-xs font-semibold text-slate-500">BƯỚC 01 / 02</span></div>
            {unavailable && <p role="status" className="mb-5 rounded-xl bg-amber-50 p-4 text-amber-900">{unavailable}</p>}
            <form onSubmit={submit} className="space-y-5">
              {campaign.form_fields.filter(q => prizeFieldVisible(q, campaign.form_fields, answers)).map(q => {
                if (q.type === "section") return <h3 key={q.id} className="pt-3 text-lg font-bold">{q.text}</h3>;
                if (q.type === "image_banner") return <PrizeImage key={q.id} src={q.options?.[0]} name={q.text} />;
                return <div key={q.id}><label htmlFor={q.id} className="mb-2 block text-sm font-semibold">{q.text}{q.required && <span className="ml-1 text-red-700">*</span>}</label>
                  {q.type === "paragraph" ? <textarea id={q.id} className={styles.field} required={q.required} rows={3} maxLength={5000} value={String(answers[q.id] ?? "")} onChange={e => update(q.id, e.target.value)} disabled={busy} /> : q.type === "choice" && q.allow_multiple ? <fieldset id={q.id} className="space-y-2" aria-label={q.text}>{q.options?.map((option, index) => <label key={index} className="flex min-h-11 items-center gap-3 rounded-xl border border-slate-200 px-3 py-2"><input type="checkbox" disabled={busy} checked={Array.isArray(answers[q.id]) && (answers[q.id] as number[]).includes(index)} onChange={e => { const selected = Array.isArray(answers[q.id]) ? answers[q.id] as number[] : []; update(q.id, e.target.checked ? [...selected, index] : selected.filter(x => x !== index)); }} />{option}</label>)}</fieldset> : ["choice", "rating", "nps"].includes(q.type) ? <select id={q.id} className={styles.field} required={q.required} disabled={busy} value={String(answers[q.id] ?? "")} onChange={e => update(q.id, e.target.value === "" ? "" : Number(e.target.value))}><option value="">Chọn câu trả lời</option>{q.type === "choice" ? q.options?.map((o, i) => <option key={i} value={i}>{o}</option>) : Array.from({ length: q.type === "rating" ? 5 : Math.min(10, Number(q.options?.[2] || 10)) + 1 }, (_, i) => <option key={i} value={q.type === "rating" ? i + 1 : i}>{q.type === "rating" ? i + 1 : i}</option>)}</select> : <input id={q.id} className={styles.field} type={q.type === "phone" ? "tel" : q.type === "date" ? "date" : "text"} autoComplete={q.type === "phone" ? "tel" : undefined} required={q.required} disabled={busy} maxLength={5000} value={String(answers[q.id] ?? "")} onChange={e => update(q.id, e.target.value)} />}
                </div>;
              })}
              {error && <p ref={alertRef} tabIndex={-1} role="alert" className="rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
              <button className={`${styles.primary} w-full`} disabled={busy || !!unavailable}>{busy ? "Đang đăng ký…" : "Đăng ký nhận lượt quay"}<ArrowRight size={18} aria-hidden="true" /></button>
              <p className="text-center text-xs leading-5 text-slate-500">Đăng ký chưa giữ suất quà. Mỗi lượt quay thành công nhận một quà khi còn hàng.</p>
            </form>
          </>}
        </section>
        <section className="space-y-5 lg:col-start-1 lg:row-start-2">
          <h2 className="text-lg font-bold">Những món quà dành cho bạn</h2>
          <div className="grid grid-cols-2 gap-3">{data.items.map(item => <div key={item.id} className={`${styles.card} p-3`}><PrizeImage src={item.image_url} name={item.name} /><p className="mt-3 text-sm font-semibold">{item.name}</p></div>)}</div>
          <p className="flex items-start gap-2 text-sm leading-6 text-slate-600"><ShieldCheck className="mt-1 shrink-0" size={18} aria-hidden="true" />Mỗi số điện thoại nhận một lượt quay trong toàn chương trình. Vui lòng giữ trang trên thiết bị này để xem kết quả.</p>
        </section>
      </div> : <section className={`${styles.card} p-8 text-center`}><p role="status">{error || "Đang tải form đăng ký…"}</p>{error && <button className={`${styles.secondary} mt-4`} onClick={() => void load().then(() => setError("")).catch(e => setError(e.message))}>Tải lại</button>}</section>}
    </div>
  </main>;
}
