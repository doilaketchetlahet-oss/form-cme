"use client";

import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/hooks/useAuth";
import { getGameModule } from "@/lib/game/catalog";
import { GameSessionCookie } from "@/components/game/GameSessionCookie";

function PlayInner() {
  const params = useSearchParams();
  const moduleId = params.get("module") ?? "";
  const mod = getGameModule(moduleId);
  const router = useRouter();
  const { user, loading } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const tokenRef = useRef<string | null>(null);
  const [studioReady, setStudioReady] = useState(false);
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const canPlay = !loading && !!user && !!mod;

  useEffect(() => {
    if (!loading && !user) router.replace(`/login?next=${encodeURIComponent(`/games/play?module=${moduleId}`)}`);
  }, [loading, user, router, moduleId]);

  const sendToken = useCallback(() => {
    if (tokenRef.current) {
      iframeRef.current?.contentWindow?.postMessage(
        { type: "eventplay:token", token: tokenRef.current }, window.location.origin
      );
    }
  }, []);

  const onSessionReady = useCallback((token: string) => {
    tokenRef.current = token;
    setError("");
    setStudioReady(true);
    sendToken();
  }, [sendToken]);

  const onSessionError = useCallback((message: string) => { setError(message); }, []);

  // Bắt tay với studio: gửi access token khi studio báo sẵn sàng.
  useEffect(() => {
    if (!canPlay) return;
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== iframeRef.current?.contentWindow) return;
      if (e.data?.type === "eventplay:ready") sendToken();
    };

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
    };
  }, [canPlay, sendToken]);

  if (!mod) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3">
        <p className="text-lg font-bold text-slate-800">Không tìm thấy game</p>
        <Link href="/games" className="text-sm font-semibold text-sky-600">
          ← Về thư viện
        </Link>
      </div>
    );
  }

  if (!canPlay) {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-slate-500">
        Đang tải…
      </div>
    );
  }

  const src = `/studio/index.html#/games/${mod.id}`;

  return (
    <div className="flex h-dvh min-h-0 flex-col bg-slate-900">
      <GameSessionCookie key={attempt} onReady={onSessionReady} onError={onSessionError} />
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", color: "#fff", fontSize: 14 }}>
        <Link href="/games" style={{ color: "#7dd3fc", fontWeight: 600 }}>
          ← Thư viện
        </Link>
        <strong>
          {mod.icon} {mod.name}
        </strong>
        <span style={{ flex: 1 }} />
        {studioReady && !error && <a href={src} target="_blank" rel="noopener" style={{ color: "#e2e8f0" }}>
          Mở tab mới ↗
        </a>}
      </div>
      {error ? (
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-4 bg-slate-50 px-6 text-center">
          <p className="max-w-md text-sm text-slate-700">{error}</p>
          <button onClick={() => { setError(""); setStudioReady(false); setAttempt((value) => value + 1); }} className="rounded-xl bg-sky-600 px-5 py-3 text-sm font-bold text-on-brand">Thử lại</button>
        </div>
      ) : studioReady ? <iframe
        ref={iframeRef}
        src={src}
        onLoad={sendToken}
        title={mod.name}
        allow="camera; microphone; fullscreen; autoplay; clipboard-write"
        allowFullScreen
        style={{ flex: 1, minHeight: 0, width: "100%", border: 0, background: "#eef4ff" }}
      /> : (
        <div role="status" className="flex flex-1 items-center justify-center bg-slate-50 text-sm text-slate-500">Đang mở game…</div>
      )}
    </div>
  );
}

export default function GamePlayPage() {
  return (
    <Suspense fallback={null}>
      <PlayInner />
    </Suspense>
  );
}
