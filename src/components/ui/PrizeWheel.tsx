"use client";

// Presentation extracted from BoothDrawManager: the server chooses the winner.
export function nextWheelRotation(current: number, index: number, count: number) {
  const normalized = ((current % 360) + 360) % 360;
  const target = (360 - (index + 0.5) * 360 / Math.max(1, count) + 360) % 360;
  return current + 1800 + (target - normalized + 360) % 360;
}

export function PrizeWheel({ items, rotation, center = "QUAY", spinning = false }: {
  items: { id: string; name: string; color: string }[]; rotation: number; center?: string; spinning?: boolean;
}) {
  const gradient = items.length ? `conic-gradient(${items.map((p, i) => `${p.color} ${i / items.length * 100}% ${(i + 1) / items.length * 100}%`).join(",")})` : "#cbd5e1";
  return <div className="relative mx-auto w-full max-w-[440px]" aria-label="Vòng quay quà tặng" aria-busy={spinning}>
    <div className="absolute -top-3 left-1/2 z-20 h-0 w-0 -translate-x-1/2 border-x-[16px] border-t-[28px] border-x-transparent border-t-red-500 drop-shadow" />
    <div className="relative aspect-square rounded-full border-[10px] border-white shadow-xl transition-transform duration-[3500ms] ease-[cubic-bezier(.12,.8,.18,1)] motion-reduce:duration-0" style={{ background: gradient, transform: `rotate(${rotation}deg)` }}>
      {items.map((p, i) => <span key={p.id} className="absolute left-1/2 top-1/2 w-[47%] origin-left pr-2 text-right text-[10px] font-bold text-on-brand sm:text-xs" style={{ transform: `translateY(-50%) rotate(${(i + 0.5) * 360 / items.length - 90}deg)` }}><span className="inline-block max-w-full truncate rounded bg-black/20 px-1.5 py-1">{p.name}</span></span>)}
    </div>
    <div className="pointer-events-none absolute inset-[37%] grid place-items-center rounded-full border-4 border-white bg-slate-900 px-2 text-center text-xs font-bold text-on-brand shadow-lg">{center}</div>
  </div>;
}
