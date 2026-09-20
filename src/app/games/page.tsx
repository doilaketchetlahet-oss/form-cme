"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Lock, Play, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { signOut, useAuth } from "@/hooks/useAuth";
import { CATEGORY_LABELS, GAME_MODULES } from "@/lib/game/catalog";

export default function GamesPage() {
  const router = useRouter();
  const { user, loading } = useAuth();
  const [allowed, setAllowed] = useState<string[] | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  useEffect(() => {
    if (!user) return;
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const res = await fetch("/api/game/entitlements", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("Không tải được quyền game.");
        const json = await res.json();
        if (active) setAllowed(json.allowedIds ?? []);
      } catch (e) {
        if (active) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [user]);

  const allowedSet = useMemo(() => new Set(allowed ?? []), [allowed]);
  const ownedCount = GAME_MODULES.filter((m) => allowedSet.has(m.id)).length;

  async function handleSignOut() {
    await signOut();
    window.location.href = "/login";
  }

  return (
    <main className="min-h-dvh px-4 py-8">
      <div className="mx-auto w-full max-w-6xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <span className="inline-block rounded-full bg-sky-100 px-3 py-1 text-xs font-bold text-sky-700">
              🎮 Game tương tác
            </span>
            <h1 className="mt-3 text-3xl font-extrabold text-slate-900">Thư viện Game</h1>
            <p className="mt-1 text-sm text-slate-600">
              Bạn đang sở hữu <strong>{ownedCount}</strong>/{GAME_MODULES.length} game.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <span className="hidden rounded-xl bg-white/70 px-3 py-2 text-sm font-medium text-slate-700 sm:inline">
              {user?.email}
            </span>
            <button
              onClick={handleSignOut}
              className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              <LogOut size={15} /> Đăng xuất
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </div>
        )}

        {allowed === null && !error ? (
          <div className="py-20 text-center text-sm text-slate-500">Đang tải…</div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {GAME_MODULES.map((m) => {
              const unlocked = allowedSet.has(m.id);
              return (
                <div
                  key={m.id}
                  className="glass flex flex-col overflow-hidden rounded-2xl border border-slate-200/70"
                >
                  <div className="relative flex h-28 items-center justify-center bg-slate-50 text-5xl">
                    <span>{m.icon}</span>
                    {!unlocked && (
                      <span className="absolute right-2 top-2 flex items-center gap-1 rounded-full bg-slate-900/80 px-2.5 py-1 text-[11px] font-bold text-white">
                        <Lock size={11} /> Chưa sở hữu
                      </span>
                    )}
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5 p-3.5">
                    <h3 className="text-sm font-bold text-slate-900">{m.name}</h3>
                    <p className="flex-1 text-xs leading-relaxed text-slate-500">{m.tagline}</p>
                    <span className="self-start rounded-full bg-sky-50 px-2.5 py-0.5 text-[11px] font-semibold text-sky-700">
                      {CATEGORY_LABELS[m.category] ?? m.category}
                    </span>
                    {unlocked ? (
                      <Link
                        href={`/games/play?module=${m.id}`}
                        className="mt-1 flex items-center justify-center gap-1.5 rounded-xl bg-sky-600 px-3 py-2 text-xs font-bold text-white hover:bg-sky-700"
                      >
                        <Play size={13} /> Chơi ngay
                      </Link>
                    ) : (
                      <button
                        disabled
                        className="mt-1 flex cursor-not-allowed items-center justify-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700"
                      >
                        <Lock size={13} /> Nâng cấp để mở
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        <p className="mt-10 text-center text-xs text-slate-400">
          © 2026 Hội Thảo Trực Tuyến · Game engine: EventPlay Studio
        </p>
      </div>
    </main>
  );
}
