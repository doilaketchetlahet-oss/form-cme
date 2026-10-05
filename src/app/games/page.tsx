"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ArrowLeft, Gamepad2, Play, LogOut, Search, Users, Camera, X } from "lucide-react";
import { signOut, useAuth } from "@/hooks/useAuth";
import { CATEGORY_LABELS, GAME_MODULES } from "@/lib/game/catalog";

export default function GamesPage() {
  const { user, loading } = useAuth();
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("all");
  const categories = [...new Set(GAME_MODULES.map((module) => module.category))];
  const normalizedQuery = query.trim().toLocaleLowerCase("vi");
  const visibleModules = GAME_MODULES.filter((module) =>
    (category === "all" || module.category === category) &&
    `${module.name} ${module.tagline} ${CATEGORY_LABELS[module.category] ?? module.category}`
      .toLocaleLowerCase("vi").includes(normalizedQuery)
  );

  async function handleSignOut() {
    await signOut();
    window.location.href = "/games";
  }

  return (
    <main className="min-h-dvh bg-slate-50 px-4 py-5 sm:px-6 sm:py-8">
      <div className="mx-auto w-full max-w-6xl">
        <nav aria-label="Điều hướng thư viện game" className="mb-6 flex items-center justify-between gap-3">
          <Link href="/" className="inline-flex items-center gap-2 rounded-lg py-2 text-sm font-semibold text-slate-600 hover:text-sky-700 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-sky-600">
            <ArrowLeft size={16} /> Trang chủ
          </Link>
          <div className="flex min-w-0 items-center gap-3">
            {!loading && user ? (
              <>
                <span className="hidden max-w-64 truncate text-sm text-slate-500 sm:block" title={user.email}>
                  {user.email}
                </span>
                <button
                  onClick={handleSignOut}
                  className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                >
                  <LogOut size={16} /> Đăng xuất
                </button>
              </>
            ) : (
              <Link href="/login?next=/games" className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-100">Đăng nhập</Link>
            )}
          </div>
        </nav>

        <header className="mb-8 flex flex-wrap items-center justify-between gap-6 rounded-3xl border border-sky-100 bg-white p-6 shadow-sm sm:p-8">
          <div>
            <span className="inline-flex items-center gap-2 rounded-full bg-sky-50 px-3 py-1.5 text-xs font-bold text-sky-700">
              <Gamepad2 size={16} /> EventPlay · Game tương tác
            </span>
            <h1 className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">Chọn game, bắt đầu trải nghiệm</h1>
            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-600">
              Khám phá game tương tác cho sự kiện của bạn. Tất cả game đều mở miễn phí, không cần đăng nhập.
            </p>
          </div>
          <div className="flex items-center gap-4 rounded-2xl bg-sky-50 px-5 py-4">
            <Gamepad2 size={32} className="text-sky-600" aria-hidden="true" />
            <div>
              <p className="text-2xl font-extrabold text-slate-900">{GAME_MODULES.length} game</p>
              <p className="mt-0.5 text-xs font-medium text-sky-700">Sẵn sàng trải nghiệm</p>
            </div>
          </div>
        </header>

          <section aria-label="Tìm kiếm và lọc game" className="mb-6 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="text-lg font-bold text-slate-900">Thư viện game <span className="ml-1 text-sm font-normal text-slate-500">({visibleModules.length})</span></h2>
              <div className="relative w-full sm:w-80">
                <Search size={18} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" aria-hidden="true" />
                <input
                  type="search"
                  aria-label="Tìm game theo tên hoặc mô tả"
                  placeholder="Tìm game…"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  className="w-full rounded-xl border border-slate-200 bg-white py-3 pl-11 pr-4 text-sm text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-2">
              {["all", ...categories].map((value) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={category === value}
                  onClick={() => setCategory(value)}
                  className={`rounded-full border px-3.5 py-2 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 ${category === value ? "border-sky-600 bg-sky-600 text-on-brand" : "border-slate-200 bg-white text-slate-600 hover:border-sky-300 hover:bg-sky-50"}`}
                >
                  {value === "all" ? "Tất cả" : CATEGORY_LABELS[value] ?? value}
                </button>
              ))}
            </div>
          </section>
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {visibleModules.map((m) => {
              return (
                <article
                  key={m.id}
                  className="group flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition-shadow hover:shadow-lg"
                >
                  <div className="relative flex aspect-[3/2] w-full shrink-0 items-center justify-center overflow-hidden border-b border-slate-100 bg-gradient-to-br from-sky-50 via-white to-indigo-50">
                    {m.cover ? (
                      <Image src={m.cover} alt={`Minh hoạ game ${m.name}`} fill sizes="(max-width: 639px) 100vw, (max-width: 1023px) 50vw, (max-width: 1279px) 33vw, 25vw" className="object-contain motion-safe:transition-transform motion-safe:group-hover:scale-105" />
                    ) : (
                      <>
                        <div aria-hidden="true" className="absolute -right-6 -top-8 h-28 w-28 rounded-full bg-sky-100/60" />
                        <div aria-hidden="true" className="absolute -bottom-10 -left-5 h-28 w-28 rounded-full bg-indigo-100/50" />
                        <span aria-hidden="true" className="relative text-6xl motion-safe:transition-transform motion-safe:group-hover:scale-110">{m.icon}</span>
                      </>
                    )}
                    {m.category === "ar" && (
                      <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-full border border-white bg-white/90 px-2.5 py-1 text-xs font-semibold text-slate-600"><Camera size={12} /> Webcam</span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col p-5">
                    <span className="mb-3 self-start rounded-full bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-700">
                      {CATEGORY_LABELS[m.category] ?? m.category}
                    </span>
                    <h3 className="text-base font-bold text-slate-900">{m.name}</h3>
                    <p className="mt-2 flex-1 text-sm leading-6 text-slate-500">{m.tagline}</p>
                    <p className="mb-4 mt-4 flex items-center gap-1.5 text-xs text-slate-500"><Users size={14} /> {m.minPlayers === m.maxPlayers ? m.minPlayers : `${m.minPlayers}–${m.maxPlayers}`} người chơi</p>
                    <Link
                      href={`/games/play?module=${m.id}`}
                      aria-label={`Chơi ${m.name}`}
                      className="flex min-h-11 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-on-brand transition-colors hover:bg-sky-700 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"
                    >
                      <Play size={16} /> Chơi ngay
                    </Link>
                  </div>
                </article>
              );
            })}
          </div>
          {visibleModules.length === 0 && (
            <div className="rounded-2xl border border-dashed border-slate-300 bg-white px-6 py-14 text-center">
              <Search size={28} className="mx-auto mb-3 text-slate-400" aria-hidden="true" />
              <h3 className="font-bold text-slate-900">Không tìm thấy game phù hợp</h3>
              <p className="mt-2 text-sm text-slate-500">Thử từ khóa khác hoặc chọn lại thể loại.</p>
              <button type="button" onClick={() => { setQuery(""); setCategory("all"); }} className="mt-5 inline-flex items-center gap-2 rounded-xl border border-slate-200 px-4 py-2.5 text-sm font-semibold text-sky-700 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600"><X size={16} /> Xóa bộ lọc</button>
            </div>
          )}

        <p className="mt-10 text-center text-xs text-slate-400">
          © 2026 Hội Thảo Trực Tuyến · Game engine: EventPlay Studio
        </p>
      </div>
    </main>
  );
}
