"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Building2,
  CalendarDays,
  Check,
  Clock3,
  Copy,
  ExternalLink,
  LayoutGrid,
  Loader2,
  MapPin,
  Printer,
  Search,
  Smartphone,
} from "lucide-react";
import {
  loadSharedBoothMap,
  type SharedBoothMapResponse,
} from "@/lib/booth-draw";
import { cn } from "@/lib/utils";

const STATUS_TEXT = {
  draft: "Đang chuẩn bị",
  active: "Đang bốc thăm",
  exchange: "Đang cập nhật đổi gian",
  finalized: "Đã chốt vị trí",
} as const;

function dateText(value: string) {
  return new Intl.DateTimeFormat("vi-VN", {
    weekday: "long",
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).format(new Date(value));
}

function timeText(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function eventTime(startsAt?: string | null, endsAt?: string | null) {
  if (!startsAt && !endsAt) return null;
  if (!startsAt) return `Đến ${dateText(endsAt!)} · ${timeText(endsAt!)}`;
  if (!endsAt) return `${dateText(startsAt)} · ${timeText(startsAt)}`;
  const sameDay = new Date(startsAt).toDateString() === new Date(endsAt).toDateString();
  return sameDay
    ? `${dateText(startsAt)} · ${timeText(startsAt)}–${timeText(endsAt)}`
    : `${dateText(startsAt)} ${timeText(startsAt)} – ${dateText(endsAt)} ${timeText(endsAt)}`;
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Không thể tải sơ đồ gian hàng.";
}

export function PublicBoothMapView({ token }: { token: string }) {
  const [data, setData] = useState<SharedBoothMapResponse | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [poolId, setPoolId] = useState("");
  const [query, setQuery] = useState("");
  const [selectedBoothId, setSelectedBoothId] = useState("");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let active = true;
    loadSharedBoothMap(token)
      .then((next) => { if (active) setData(next); })
      .catch((reason) => { if (active) setError(errorText(reason)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [token]);

  const lookup = useMemo(() => {
    if (!data) return null;
    return {
      pools: new Map(data.pools.map((pool) => [pool.id, pool])),
      companies: new Map(data.companies.map((company) => [company.id, company])),
      booths: new Map(data.booths.map((booth) => [booth.id, booth])),
      assignments: new Map(data.assignments.map((assignment) => [assignment.booth_id, assignment])),
    };
  }, [data]);

  const assignedRows = useMemo(() => {
    if (!data || !lookup) return [];
    const normalized = query.trim().toLocaleLowerCase("vi");
    return data.assignments.flatMap((assignment) => {
      const company = lookup.companies.get(assignment.company_id);
      const booth = lookup.booths.get(assignment.booth_id);
      const pool = lookup.pools.get(assignment.pool_id);
      if (!company || !booth || !pool) return [];
      if (poolId && pool.id !== poolId) return [];
      if (normalized && !`${company.name} ${booth.booth_code} ${pool.name}`.toLocaleLowerCase("vi").includes(normalized)) return [];
      return [{ assignment, company, booth, pool }];
    }).sort((a, b) => a.booth.booth_code.localeCompare(b.booth.booth_code, "vi", { numeric: true }));
  }, [data, lookup, poolId, query]);

  const matchedBoothIds = useMemo(() => new Set(assignedRows.map((row) => row.booth.id)), [assignedRows]);
  const selectedRow = assignedRows.find((row) => row.booth.id === selectedBoothId)
    ?? (data && lookup && selectedBoothId ? (() => {
      const booth = lookup.booths.get(selectedBoothId);
      const assignment = booth ? lookup.assignments.get(booth.id) : undefined;
      const company = assignment ? lookup.companies.get(assignment.company_id) : undefined;
      const pool = booth ? lookup.pools.get(booth.pool_id) : undefined;
      return booth && pool ? { booth, pool, company } : undefined;
    })() : undefined);

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      setCopied(false);
    }
  };

  if (loading) {
    return <main className="grid min-h-dvh place-items-center bg-slate-950 text-white"><div className="text-center"><Loader2 className="mx-auto animate-spin text-sky-400" size={32} /><p className="mt-4 text-sm text-slate-300">Đang mở sơ đồ gian hàng…</p></div></main>;
  }

  if (error || !data || !lookup) {
    return (
      <main className="grid min-h-dvh place-items-center bg-slate-950 px-5 text-white">
        <div className="max-w-md text-center">
          <div className="mx-auto grid h-16 w-16 place-items-center rounded-2xl bg-white/10"><MapPin className="text-sky-300" size={28} /></div>
          <h1 className="mt-5 text-2xl font-bold">Không mở được sơ đồ</h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">{error || "Link này không còn khả dụng."}</p>
          <Link href="/" className="mt-6 inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold hover:bg-sky-400"><ArrowLeft size={16} /> Về trang chủ</Link>
        </div>
      </main>
    );
  }

  const schedule = eventTime(data.session.starts_at, data.session.ends_at);
  const occupied = data.assignments.length;
  const available = Math.max(0, data.booths.length - occupied);
  const hasFilter = Boolean(poolId || query.trim());

  return (
    <main className="min-h-dvh bg-[#f4f8fc] text-slate-900 print:bg-white">
      <section className="relative overflow-hidden bg-slate-950 text-white print:bg-white print:text-slate-900">
        <div className="absolute -left-32 -top-40 h-96 w-96 rounded-full bg-sky-500/25 blur-3xl print:hidden" />
        <div className="absolute -bottom-48 right-0 h-96 w-96 rounded-full bg-cyan-400/15 blur-3xl print:hidden" />
        <div className="relative mx-auto max-w-[1500px] px-4 pb-9 pt-5 sm:px-8 sm:pb-12">
          <div className="flex items-center justify-between gap-4">
            <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-300 hover:text-white print:text-slate-600"><ArrowLeft size={16} /> I-solution Manager</Link>
            <div className="flex items-center gap-2 print:hidden">
              <button onClick={() => void copyLink()} className="inline-flex items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold backdrop-blur hover:bg-white/15">
                {copied ? <Check size={15} /> : <Copy size={15} />} {copied ? "Đã sao chép" : "Chia sẻ"}
              </button>
              <button onClick={() => window.print()} className="hidden items-center gap-2 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-semibold backdrop-blur hover:bg-white/15 sm:inline-flex"><Printer size={15} /> In</button>
            </div>
          </div>

          <div className="mt-10 max-w-4xl">
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-2 rounded-full border border-sky-300/20 bg-sky-400/10 px-3 py-1.5 text-xs font-bold uppercase tracking-[0.15em] text-sky-200 print:border-sky-200 print:text-sky-700"><LayoutGrid size={14} /> Sơ đồ vị trí gian hàng</span>
              <span className="rounded-full border border-white/10 bg-white/[0.07] px-3 py-1.5 text-xs font-semibold text-slate-300 print:border-slate-200 print:text-slate-600">{STATUS_TEXT[data.session.status]}</span>
            </div>
            <h1 className="text-balance text-3xl font-black tracking-tight sm:text-5xl">{data.session.name}</h1>
            <div className="mt-5 flex flex-col gap-2 text-sm text-slate-300 sm:flex-row sm:flex-wrap sm:gap-x-6 print:text-slate-600">
              {schedule && <span className="inline-flex items-start gap-2"><CalendarDays className="mt-0.5 shrink-0 text-sky-300" size={17} /> {schedule}</span>}
              {data.session.venue && <span className="inline-flex items-start gap-2"><MapPin className="mt-0.5 shrink-0 text-sky-300" size={17} /> {data.session.venue}</span>}
            </div>
            {data.session.public_note && <p className="mt-5 max-w-3xl whitespace-pre-line text-sm leading-6 text-slate-300 print:text-slate-600">{data.session.public_note}</p>}
          </div>

          <div className="mt-8 grid max-w-2xl grid-cols-3 gap-2 sm:gap-3">
            <SummaryStat value={occupied} label="Đã bố trí" />
            <SummaryStat value={available} label="Còn trống" />
            <SummaryStat value={data.pools.length} label="Khu / pool" />
          </div>
        </div>
      </section>

      <div className="mx-auto max-w-[1500px] px-4 py-6 sm:px-8 sm:py-10">
        <section className="mb-5 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm print:hidden sm:p-4">
          <div className="grid gap-3 md:grid-cols-[minmax(240px,1fr)_240px_auto]">
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} />
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Tìm tên công ty hoặc số gian…" className="w-full rounded-xl border border-slate-200 bg-slate-50 py-3 pl-10 pr-3 text-sm outline-none transition focus:border-sky-400 focus:bg-white focus:ring-2 focus:ring-sky-100" />
            </label>
            <select value={poolId} onChange={(event) => setPoolId(event.target.value)} className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-sm font-medium outline-none focus:border-sky-400 focus:ring-2 focus:ring-sky-100">
              <option value="">Tất cả pool</option>
              {data.pools.map((pool) => <option key={pool.id} value={pool.id}>{pool.name}</option>)}
            </select>
            <div className="flex items-center justify-between gap-3 rounded-xl bg-slate-50 px-4 py-2 text-xs text-slate-500 md:justify-center">
              <span>{assignedRows.length} kết quả</span>
              <span className="inline-flex items-center gap-1 md:hidden"><Smartphone size={14} /> Vuốt sơ đồ</span>
            </div>
          </div>
        </section>

        <section className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-[0_18px_60px_rgba(15,23,42,0.08)]">
          <div className="flex flex-col gap-3 border-b border-slate-100 px-4 py-4 sm:flex-row sm:items-center sm:justify-between sm:px-6">
            <div>
              <h2 className="font-bold text-slate-900">Mặt bằng gian hàng</h2>
              <p className="mt-0.5 text-xs text-slate-500">Chạm vào một gian để xem tên đơn vị và thông tin khu vực.</p>
            </div>
            <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs text-slate-500">
              {data.pools.map((pool) => <span key={pool.id} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: pool.color }} />{pool.name}</span>)}
            </div>
          </div>

          <div className="scrollbar-visible overflow-x-auto bg-slate-100 p-2 sm:p-5">
            <div className="relative aspect-video min-w-[760px] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-inner md:min-w-0" style={!data.mapUrl ? { backgroundImage: "linear-gradient(#dbeafe 1px, transparent 1px), linear-gradient(90deg, #dbeafe 1px, transparent 1px)", backgroundSize: "24px 24px" } : undefined}>
              {data.mapUrl && <MapImage src={data.mapUrl} />}
              {data.booths.map((booth) => {
                const pool = lookup.pools.get(booth.pool_id);
                const assignment = lookup.assignments.get(booth.id);
                const company = assignment ? lookup.companies.get(assignment.company_id) : undefined;
                const isSelected = selectedBoothId === booth.id;
                const poolMatches = !poolId || booth.pool_id === poolId;
                const searchMatches = !query.trim() || matchedBoothIds.has(booth.id);
                const muted = !poolMatches || !searchMatches;
                return (
                  <button
                    key={booth.id}
                    type="button"
                    onClick={() => setSelectedBoothId(booth.id)}
                    className={cn(
                      "absolute z-10 flex flex-col items-center justify-center overflow-hidden border-2 px-0.5 text-center text-white shadow-md transition duration-200 hover:z-20 hover:scale-105 hover:shadow-xl focus:z-20 focus:outline-none focus:ring-4 focus:ring-sky-300/70",
                      isSelected && "z-30 ring-4 ring-white shadow-[0_0_0_8px_rgba(14,165,233,.45)]",
                      muted && "opacity-20 grayscale",
                    )}
                    style={{
                      left: `${booth.x}%`,
                      top: `${booth.y}%`,
                      width: `${booth.width}%`,
                      height: `${booth.height}%`,
                      transform: `rotate(${booth.rotation}deg)`,
                      borderColor: pool?.color ?? "#0ea5e9",
                      background: company ? `${pool?.color ?? "#0ea5e9"}e8` : `${pool?.color ?? "#0ea5e9"}80`,
                    }}
                    title={company ? `${booth.booth_code} · ${company.name}` : `${booth.booth_code} · Còn trống`}
                  >
                    <span className="max-w-full truncate text-[clamp(8px,1vw,14px)] font-black leading-none drop-shadow">{booth.booth_code}</span>
                    {company && <span className="mt-0.5 hidden max-w-full truncate text-[clamp(6px,.68vw,10px)] font-semibold leading-none drop-shadow sm:block">{company.name}</span>}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="border-t border-slate-100 bg-slate-50 px-4 py-4 sm:px-6">
            {selectedRow ? (
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="grid h-12 w-12 shrink-0 place-items-center rounded-xl text-lg font-black text-white shadow-md" style={{ background: selectedRow.pool.color }}>{selectedRow.booth.booth_code}</span>
                  <div>
                    <p className="font-bold text-slate-900">{selectedRow.company?.name ?? "Gian chưa được cấp"}</p>
                    <p className="mt-0.5 text-xs text-slate-500">Pool {selectedRow.pool.name} · Gian {selectedRow.booth.booth_code}</p>
                  </div>
                </div>
                {data.session.venue && <span className="inline-flex items-center gap-1.5 text-xs text-slate-500"><MapPin size={14} /> {data.session.venue}</span>}
              </div>
            ) : <p className="text-sm text-slate-500">Chọn một ô trên sơ đồ để xem chi tiết vị trí.</p>}
          </div>
        </section>

        <section className="mt-8">
          <div className="mb-4 flex items-end justify-between gap-4">
            <div><h2 className="text-xl font-black text-slate-900">Danh sách vị trí</h2><p className="mt-1 text-sm text-slate-500">Tổng hợp công ty và gian hàng đã được phân bổ.</p></div>
            <span className="hidden text-xs text-slate-400 sm:inline">Cập nhật {new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(data.session.updated_at))}</span>
          </div>

          {assignedRows.length > 0 ? (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {assignedRows.map(({ assignment, company, booth, pool }) => (
                <button key={assignment.id} onClick={() => { setSelectedBoothId(booth.id); window.scrollTo({ top: 420, behavior: "smooth" }); }} className={cn("group flex items-center gap-3 rounded-2xl border bg-white p-3 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-md", selectedBoothId === booth.id ? "border-sky-400 ring-2 ring-sky-100" : "border-slate-200")}>
                  <span className="grid h-14 w-14 shrink-0 place-items-center rounded-xl text-base font-black text-white shadow-sm" style={{ background: pool.color }}>{booth.booth_code}</span>
                  <span className="min-w-0 flex-1"><span className="block truncate text-sm font-bold text-slate-800 group-hover:text-sky-700">{company.name}</span><span className="mt-1 block truncate text-xs text-slate-500">Pool {pool.name}</span></span>
                  <ExternalLink size={15} className="shrink-0 text-slate-300 group-hover:text-sky-500" />
                </button>
              ))}
            </div>
          ) : (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-5 py-12 text-center">
              <Search className="mx-auto text-slate-300" size={30} />
              <p className="mt-3 font-semibold text-slate-700">{hasFilter ? "Không tìm thấy vị trí phù hợp" : "Chưa có vị trí được phân bổ"}</p>
              <p className="mt-1 text-sm text-slate-500">{hasFilter ? "Thử đổi từ khóa hoặc chọn lại pool." : "Kết quả sẽ xuất hiện tại đây sau khi bốc thăm."}</p>
            </div>
          )}
        </section>

        <footer className="mt-10 flex flex-col gap-2 border-t border-slate-200 py-6 text-xs text-slate-400 sm:flex-row sm:items-center sm:justify-between">
          <span className="inline-flex items-center gap-1.5"><Building2 size={14} /> Sơ đồ được chia sẻ qua I-solution Manager</span>
          <span className="inline-flex items-center gap-1.5"><Clock3 size={14} /> Vị trí có thể thay đổi cho đến khi ban tổ chức chốt kết quả.</span>
        </footer>
      </div>
    </main>
  );
}

function SummaryStat({ value, label }: { value: number; label: string }) {
  return <div className="rounded-2xl border border-white/10 bg-white/[0.07] px-3 py-3 backdrop-blur print:border-slate-200 print:bg-slate-50 sm:px-5"><p className="text-2xl font-black sm:text-3xl">{value}</p><p className="mt-0.5 text-[10px] font-semibold uppercase tracking-wider text-slate-400 sm:text-xs">{label}</p></div>;
}

function MapImage({ src }: { src: string }) {
  // Signed private-storage URLs should bypass the Next image optimizer.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Sơ đồ mặt bằng sự kiện" className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill" />;
}
