"use client";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowRight, Check, Gift, Sparkles } from "lucide-react";
import { PrizeWheel, nextWheelRotation } from "@/components/ui/PrizeWheel";
import { prizeAvailability, prizeTextColor, type PrizeSnapshot } from "@/lib/prize-draw";
import { PrizeImage } from "./PrizeImage";
import styles from "./prize-studio.module.css";

export function PrizeDrawPlayer({ id }: { id: string }) {
  const [data, setData] = useState<PrizeSnapshot | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [rotation, setRotation] = useState(0);
  const busyRef = useRef(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  async function load() {
    const response = await fetch(`/api/prize-draw/${id}`, { cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Không tải được chương trình.");
    setData(result);
    return result as PrizeSnapshot;
  }
  useEffect(() => {
    let cancelled = false;
    void fetch(`/api/prize-draw/${id}`, { cache: "no-store" }).then(async response => {
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Không tải được chương trình.");
      if (!cancelled) setData(result);
    }).catch(e => { if (!cancelled) setError(e.message); });
    return () => { cancelled = true; if (timer.current) clearTimeout(timer.current); };
  }, [id]);
  async function spin() {
    if (!data || busyRef.current || data.entry?.prize_id) return;
    busyRef.current = true;
    setBusy(true); setError("");
    try {
      const response = await fetch(`/api/prize-draw/${id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "spin" }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Chưa nhận được kết quả.");
      const index = data.items.findIndex(p => p.id === result.entry.prize_id);
      if (index >= 0) setRotation(r => nextWheelRotation(r, index, data.items.length));
      timer.current = setTimeout(() => {
        setData(d => d ? { ...d, entry: result.entry } : d);
        setBusy(false); busyRef.current = false;
        void load().catch(() => {});
      }, window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 3600);
    } catch (e) {
      // A lost response may already have awarded a prize. Restore before retrying.
      let restored = false;
      try { restored = !!(await load()).entry?.prize_id; } catch { /* retain retry UI */ }
      if (!restored) setError(e instanceof Error ? e.message : "Mất kết nối. Bấm tải lại để kiểm tra kết quả đã lưu.");
      setBusy(false); busyRef.current = false;
    }
  }
  if (!data) return <main className={`${styles.studio} ${styles.public} grid place-items-center p-6 text-center`}><div className={`${styles.card} p-8`}><p role="status">{error || "Đang tải vòng quay…"}</p>{error && <button onClick={() => void load().then(() => setError("")).catch(e => setError(e.message))} className={`${styles.secondary} mt-4`}>Tải lại</button>}</div></main>;
  const { campaign, items, entry } = data;
  const unavailable = prizeAvailability(campaign, items);
  const won = !busy && !!entry?.prize_id;
  return <main className={`${styles.studio} ${styles.public} px-4 py-8 sm:py-12`} style={{ "--prize-primary": campaign.accent_color, "--prize-on-primary": prizeTextColor(campaign.accent_color) } as CSSProperties}>
    <div className="mx-auto max-w-5xl space-y-8">
      <div className="flex items-center gap-3"><span className="rounded-xl bg-sky-100 p-3 text-sky-800"><Gift size={24} aria-hidden="true" /></span><span className="text-sm font-bold tracking-wide">QUAY NHẬN QUÀ</span>{campaign.is_demo && <p className="ml-auto rounded-full bg-amber-100 px-3 py-2 text-xs font-bold text-amber-900">MERAP DEMO</p>}</div>
      {campaign.banner_url && <Image src={campaign.banner_url} alt="Banner chương trình" width={1200} height={400} unoptimized priority className="max-h-64 w-full rounded-3xl object-cover" />}
      <header className="text-center"><p className="mb-3 text-xs font-bold uppercase tracking-[.2em] text-sky-800">Một vòng quay · Ngàn niềm vui</p><h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{campaign.name}</h1><p className="mt-3 text-sm leading-6 text-slate-600">Một số điện thoại · Một lượt trong toàn chương trình</p></header>
      {won ? <section aria-live="polite" className={`${styles.card} mx-auto max-w-xl p-6 text-center sm:p-10`}>
        <div className="mb-5 flex items-center justify-center gap-2 text-sm font-semibold text-emerald-700"><Sparkles size={20} aria-hidden="true" />Chúc mừng bạn!</div>
        <PrizeImage src={entry.prize_image_url || items.find(p => p.id === entry.prize_id)?.image_url} name={entry.prize_name || "Phần quà của bạn"} className="mx-auto w-full max-w-64" priority />
        <h2 className="mt-6 text-2xl font-bold">Bạn đã trúng {entry.prize_name}!</h2>
        <p className="mt-6 text-xs font-semibold uppercase tracking-widest text-slate-500">Mã nhận quà</p><p className="mt-2 break-all rounded-xl border border-dashed border-sky-300 bg-sky-50 p-4 font-mono text-sm font-bold">{entry.claim_code}</p>
        <p className="mt-5 whitespace-pre-wrap text-sm leading-6 text-slate-600">{campaign.instructions}</p>
        {campaign.track_redemption && <p className="mt-5 flex items-center justify-center gap-2 text-sm font-semibold text-slate-700">{entry.redeemed_at && <Check className="text-emerald-700" size={18} aria-hidden="true" />}{entry.redeemed_at ? "Nhân viên đã xác nhận trao quà" : "Chưa xác nhận trao quà"}</p>}
        <button className={`${styles.secondary} mt-5`} onClick={() => void load().catch(e => setError(e.message))}>Cập nhật trạng thái</button>
        <p className="mt-5 text-xs leading-5 text-slate-500">Kết quả đã được lưu. Tải lại trang không tạo lượt mới.</p>
      </section> : <div className="grid items-start gap-6 lg:grid-cols-[1.1fr_.9fr]">
        <section className={`${styles.card} space-y-6 p-5 pt-8 text-center sm:p-8`}>
          <PrizeWheel items={items} rotation={rotation} center={busy ? "ĐANG QUAY" : "NHẬN QUÀ"} spinning={busy} />
          {unavailable && <div className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900"><p role="status">{unavailable}</p><button className={`${styles.secondary} mt-3`} onClick={() => void load().catch(e => setError(e.message))}>Cập nhật trạng thái</button></div>}
          {!entry ? <Link href={`/prize-draw/${id}/register`} className={`${styles.primary} w-full`}>Điền form để nhận lượt quay<ArrowRight size={18} aria-hidden="true" /></Link> : <button onClick={() => void spin()} disabled={busy || !!unavailable} className={`${styles.primary} w-full py-4 text-lg`}>{busy ? "Đang quay…" : "Quay nhận quà"}<Sparkles size={20} aria-hidden="true" /></button>}
          <p className="text-xs leading-5 text-slate-500">Mỗi lượt quay thành công có một quà khi còn hàng. Tỷ lệ theo tồn kho; kích thước ô chỉ để hiển thị.</p>
        </section>
        <section><h2 className="mb-4 flex items-center gap-2 text-lg font-bold"><Gift size={20} aria-hidden="true" />Những món quà đang chờ bạn</h2><ul className="grid grid-cols-2 gap-3">{items.map(item => <li key={item.id} className={`${styles.card} overflow-hidden p-3`}><PrizeImage src={item.image_url} name={item.name} /><p className="mt-3 text-sm font-semibold leading-6">{item.name}</p><p className={`mt-1 text-xs ${item.remaining ? "text-emerald-700" : "text-slate-500"}`}>{item.remaining ? "Sẵn sàng trao tặng" : "Hết quà"}</p></li>)}</ul></section>
      </div>}
      {error && <p role="alert" className="mx-auto max-w-xl rounded-xl bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    </div>
  </main>;
}
