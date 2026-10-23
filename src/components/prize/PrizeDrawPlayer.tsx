"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { PrizeWheel, nextWheelRotation } from "@/components/ui/PrizeWheel";
import { prizeAvailability, type PrizeSnapshot } from "@/lib/prize-draw";

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
  if (!data) return <main className="grid min-h-dvh place-items-center bg-slate-50 p-6 text-center"><div><p role="alert">{error || "Đang tải vòng quay…"}</p>{error && <button onClick={() => void load().then(() => setError("")).catch(e => setError(e.message))} className="mt-4 underline">Tải lại</button>}</div></main>;
  const { campaign, items, entry } = data;
  const unavailable = prizeAvailability(campaign, items);
  const won = !busy && !!entry?.prize_id;
  return <main className="min-h-dvh bg-slate-50 px-4 py-8 text-slate-900">
    <div className="mx-auto max-w-lg space-y-6 text-center">
      {campaign.is_demo && <p className="rounded-xl bg-amber-100 p-3 text-sm font-bold text-amber-900">BẢN DEMO · Quà mẫu, không có giá trị nhận quà thật</p>}
      {campaign.banner_url && <img src={campaign.banner_url} alt="Banner chương trình" className="w-full rounded-2xl" />}
      <header><p className="mb-2 text-xs font-bold uppercase tracking-widest" style={{ color: campaign.accent_color }}>Quay nhận quà</p><h1 className="text-2xl font-black sm:text-3xl">{campaign.name}</h1><p className="mt-3 text-sm text-slate-500">Một số điện thoại · Một lượt trong toàn chương trình</p></header>
      {won ? <section aria-live="polite" className="rounded-3xl border bg-white p-6 shadow-lg" style={{ borderColor: entry.prize_color || campaign.accent_color }}>
        <p className="text-4xl">🎁</p><h2 className="mt-3 text-xl font-bold">Bạn đã trúng {entry.prize_name}!</h2>
        <p className="mt-5 text-sm text-slate-500">Mã nhận quà</p><p className="mt-1 break-all rounded-xl bg-slate-100 p-3 font-mono text-sm font-bold">{entry.claim_code}</p>
        <p className="mt-4 whitespace-pre-wrap text-sm">{campaign.instructions}</p>
        {campaign.track_redemption && <p className="mt-4 font-semibold" style={{ color: entry.redeemed_at ? "#15803d" : campaign.accent_color }}>{entry.redeemed_at ? "✓ Nhân viên đã xác nhận trao quà" : "Chưa xác nhận trao quà"}</p>}
        <p className="mt-4 text-xs text-slate-500">Kết quả đã được lưu. Tải lại trang không tạo lượt mới.</p>
        <button className="mt-4 text-sm underline" onClick={() => void load().catch(e => setError(e.message))}>Cập nhật trạng thái</button>
      </section> : <>
        <PrizeWheel items={items} rotation={rotation} center={busy ? "ĐANG QUAY" : "NHẬN QUÀ"} spinning={busy} />
        {unavailable && <div className="rounded-xl bg-amber-50 p-4 text-amber-900"><p role="status">{unavailable}</p><button className="mt-2 text-sm underline" onClick={() => void load().catch(e => setError(e.message))}>Cập nhật trạng thái</button></div>}
        {!entry ? <Link href={`/s/${campaign.survey_id}`} className="block rounded-xl p-4 font-bold text-on-brand" style={{ background: campaign.accent_color }}>Điền form để nhận lượt quay →</Link> : <button onClick={() => void spin()} disabled={busy || !!unavailable} className="w-full rounded-xl p-4 text-lg font-bold text-on-brand shadow-lg disabled:opacity-50" style={{ background: campaign.accent_color }}>{busy ? "Đang quay…" : "Quay nhận quà"}</button>}
        <p className="text-xs text-slate-500">Mỗi lượt quay thành công có một quà khi còn hàng. Tỷ lệ theo tồn kho; kích thước ô chỉ để hiển thị.</p>
      </>}
      {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}
      {!won && <ul className="grid grid-cols-2 gap-2 text-left">{items.map(item => <li key={item.id} className="rounded-xl border bg-white p-3 text-sm"><span className="mr-2 inline-block h-2 w-2 rounded-full" style={{ background: item.color }} />{item.name}{item.remaining === 0 && <span className="ml-2 text-xs text-slate-400">Hết quà</span>}</li>)}</ul>}
    </div>
  </main>;
}
