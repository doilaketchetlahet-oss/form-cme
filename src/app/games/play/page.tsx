"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/hooks/useAuth";
import { getGameModule } from "@/lib/game/catalog";
import { GameSessionCookie } from "@/components/game/GameSessionCookie";

type AccessState = "checking" | "allowed" | "denied";

function PlayInner() {
  const params = useSearchParams();
  const moduleId = params.get("module") ?? "";
  const mod = getGameModule(moduleId);
  const router = useRouter();
  const { user, loading } = useAuth();
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [access, setAccess] = useState<AccessState>("checking");

  useEffect(() => {
    if (!loading && !user) router.replace("/login");
  }, [loading, user, router]);

  // Server-side entitlement check: the studio bundle fails open when it cannot
  // reach the API, so the gate has to happen here.
  useEffect(() => {
    if (!user || !mod) return;
    let active = true;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        const token = data.session?.access_token;
        const res = await fetch("/api/game/entitlements", {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!res.ok) throw new Error("cannot check entitlements");
        const json = (await res.json()) as { allowedIds?: string[] };
        const allowed = new Set(json.allowedIds ?? []);
        if (active) setAccess(allowed.has(mod.id) ? "allowed" : "denied");
      } catch {
        if (active) setAccess("denied");
      }
    })();
    return () => {
      active = false;
    };
  }, [user, mod]);

  // Bắt tay với studio: gửi access token khi studio báo sẵn sàng.
  useEffect(() => {
    if (access !== "allowed") return;
    const sendToken = async () => {
      const { data } = await supabase.auth.getSession();
      const token = data.session?.access_token;
      if (token && iframeRef.current?.contentWindow) {
        iframeRef.current.contentWindow.postMessage(
          { type: "eventplay:token", token },
          window.location.origin
        );
      }
    };

    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin) return;
      if (e.data?.type === "eventplay:ready") void sendToken();
    };

    window.addEventListener("message", onMessage);
    const fallback = window.setTimeout(sendToken, 900);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearTimeout(fallback);
    };
  }, [access]);

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

  if (access === "checking") {
    return (
      <div className="flex min-h-dvh items-center justify-center text-sm text-slate-500">
        Đang kiểm tra quyền…
      </div>
    );
  }

  if (access === "denied") {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="text-lg font-bold text-slate-800">Bạn chưa sở hữu game này</p>
        <p className="max-w-sm text-sm text-slate-500">
          Game này cần được mở khoá. Quay lại thư viện để xem các game miễn phí hoặc liên hệ ban tổ chức.
        </p>
        <Link href="/games" className="text-sm font-semibold text-sky-600">
          ← Về thư viện game
        </Link>
      </div>
    );
  }

  const src = `/studio/index.html#/games/${mod.id}`;

  return (
    <div style={{ position: "fixed", inset: 0, display: "flex", flexDirection: "column", background: "#0f172a" }}>
      <GameSessionCookie />
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "8px 14px", color: "#fff", fontSize: 14 }}>
        <Link href="/games" style={{ color: "#7dd3fc", fontWeight: 600 }}>
          ← Thư viện
        </Link>
        <strong>
          {mod.icon} {mod.name}
        </strong>
        <span style={{ flex: 1 }} />
        <a href={src} target="_blank" rel="noopener" style={{ color: "#e2e8f0" }}>
          Mở tab mới ↗
        </a>
      </div>
      <iframe
        ref={iframeRef}
        src={src}
        title={mod.name}
        allow="camera; microphone; fullscreen; autoplay; clipboard-write"
        allowFullScreen
        style={{ flex: 1, width: "100%", border: 0, background: "#eef4ff" }}
      />
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
