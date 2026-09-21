"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2 } from "lucide-react";
import { WishComposer } from "@/components/wish/WishComposer";
import { fetchWishSnapshot } from "@/lib/wish/realtime";
import { WISH_THEMES, type WishEvent } from "@/lib/wish/config";

export default function WishComposerPage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code ?? "").toString().toUpperCase();

  const [event, setEvent] = useState<WishEvent | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "missing">("loading");
  const [edge, setEdge] = useState<"left" | "right" | "center">("center");

  useEffect(() => {
    if (!code) return;
    void (async () => {
      const snap = await fetchWishSnapshot(code);
      if (!snap) {
        setState("missing");
        return;
      }
      setEvent(snap.event);
      setEdge(snap.event.settings.edge);
      setState("ready");
    })();
  }, [code]);

  // Mỗi tablet có thể được gán một cạnh riêng qua ?edge=left|right|center.
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get("edge");
    if (value === "left" || value === "right" || value === "center") {
      queueMicrotask(() => setEdge(value));
    }
  }, []);

  const theme = event ? WISH_THEMES[event.settings.theme] : WISH_THEMES.aurora;
  const background = useMemo(
    () => `linear-gradient(160deg, ${theme.bg[0]}, ${theme.bg[1]} 55%, ${theme.bg[2]})`,
    [theme],
  );

  if (state === "loading") {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-950 text-slate-200">
        <Loader2 className="animate-spin text-sky-400" size={28} />
        <p className="text-sm font-semibold">Đang mở trang lời chúc…</p>
      </main>
    );
  }

  if (state === "missing" || !event) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-2 bg-slate-950 px-6 text-center text-slate-200">
        <p className="text-lg font-bold">Không tìm thấy chương trình</p>
        <p className="text-sm text-slate-400">Kiểm tra lại mã QR hoặc hỏi ban tổ chức.</p>
      </main>
    );
  }

  const closed = event.status === "ended" || event.status === "draft";

  return (
    <main className="flex min-h-dvh flex-col items-center px-4 py-6" style={{ background }}>
      <header className="mb-5 w-full max-w-xl text-center">
        <p className="text-[11px] font-bold tracking-[0.2em] text-white/50 uppercase">
          Mã {event.code}
        </p>
        <h1 className="font-display mt-1 text-2xl font-black text-white drop-shadow sm:text-3xl">
          {event.title}
        </h1>
        {event.subtitle ? <p className="mt-1 text-sm text-white/60">{event.subtitle}</p> : null}
      </header>

      {closed ? (
        <div className="rounded-3xl bg-white/10 p-8 text-center text-white backdrop-blur">
          <p className="text-lg font-bold">Chương trình đã khép lại</p>
          <p className="mt-1 text-sm text-white/70">Cảm ơn bạn đã trao đi yêu thương.</p>
        </div>
      ) : (
        <WishComposer code={code} event={event} edge={edge} />
      )}

      <p className="mt-6 text-center text-[11px] text-white/40">
        Lời chúc sẽ bay lên màn hình lớn sau khi bạn nhấn gửi.
      </p>
    </main>
  );
}
