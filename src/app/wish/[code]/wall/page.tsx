"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { Loader2, Maximize, Wifi, WifiOff } from "lucide-react";
import { WishWallCanvas, type WishWallHandle } from "@/components/wish/WishWallCanvas";
import { fetchWishSnapshot, subscribeWish } from "@/lib/wish/realtime";
import type { WishEvent } from "@/lib/wish/config";

export default function WishWallPage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code ?? "").toString().toUpperCase();
  const wallRef = useRef<WishWallHandle>(null);

  const [event, setEvent] = useState<WishEvent | null>(null);
  const [count, setCount] = useState(0);
  const [online, setOnline] = useState(true);
  const [loaded, setLoaded] = useState(false);
  const settingsSignatureRef = useRef("");

  const applySnapshot = useCallback(
    async (force: boolean) => {
      const snap = await fetchWishSnapshot(code);
      if (!snap) {
        setOnline(false);
        return;
      }
      setOnline(true);
      setLoaded(true);
      const signature = JSON.stringify(snap.event.settings);
      if (force || settingsSignatureRef.current !== signature) {
        settingsSignatureRef.current = signature;
        wallRef.current?.setEvent(snap.event);
      }
      setEvent(snap.event);
      setCount(snap.counts.approved);
      wallRef.current?.syncWishes(snap.wishes);
    },
    [code],
  );

  useEffect(() => {
    if (!code) return;
    queueMicrotask(() => void applySnapshot(true));
    const sub = subscribeWish(code, (message) => {
      switch (message.type) {
        case "wish":
          wallRef.current?.addWish(message.wish);
          setCount((value) => value + 1);
          break;
        case "moderate":
          wallRef.current?.removeWish(message.wishId);
          break;
        case "clear":
          wallRef.current?.clear();
          setCount(0);
          break;
        case "absorb-all":
          wallRef.current?.absorbAll();
          break;
        case "spotlight":
          wallRef.current?.spotlight(message.wishId);
          break;
        case "settings":
          void applySnapshot(true);
          break;
      }
    });
    const sync = setInterval(() => void applySnapshot(false), 6000);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      sub.close();
      clearInterval(sync);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [code, applySnapshot]);

  const goFullscreen = () => {
    const element = document.documentElement;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen?.();
  };

  if (!loaded) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-950 px-6 text-center text-slate-200">
        {online ? <Loader2 className="animate-spin text-sky-400" size={28} /> : <WifiOff size={28} />}
        <p className="text-sm font-semibold">{online ? "Đang kết nối màn hình…" : "Đang kết nối lại…"}</p>
        <p className="text-xs text-slate-500">
          Nếu đứng mãi ở đây, kiểm tra mã chương trình <strong>{code}</strong>.
        </p>
      </main>
    );
  }

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-slate-950">
      <WishWallCanvas ref={wallRef} className="absolute inset-0 h-full w-full" />

      <div className="pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-4 p-5 sm:p-7">
        <div>
          <h1 className="font-display text-xl font-black text-white/90 drop-shadow sm:text-3xl">
            {event?.title ?? "Trao lời chúc, nhận yêu thương"}
          </h1>
          {event?.subtitle ? (
            <p className="mt-1 text-xs font-medium text-white/60 sm:text-sm">{event.subtitle}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-3 text-white/70">
          <span className="text-sm font-bold tabular-nums">{count} lời chúc</span>
          <span className={`flex items-center gap-1.5 text-xs font-semibold ${online ? "text-emerald-400" : "text-red-400"}`}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
          </span>
          <button
            type="button"
            onClick={goFullscreen}
            className="pointer-events-auto rounded-xl bg-white/10 p-2 transition-colors hover:bg-white/20"
            title="Toàn màn hình"
          >
            <Maximize size={16} />
          </button>
        </div>
      </div>
    </main>
  );
}
