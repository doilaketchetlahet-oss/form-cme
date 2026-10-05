"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

/** Await the verified HttpOnly cookie before mounting the studio iframe. */
export function GameSessionCookie({ onReady, onError }: {
  onReady: (token: string) => void;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    let active = true;

    const sync = async (token?: string) => {
      if (!active || !token) return;
      try {
        const response = await fetch("/api/game/session", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          credentials: "same-origin",
        });
        if (!response.ok) throw new Error("Không thể xác thực phiên game. Vui lòng đăng nhập lại rồi thử.");
        if (active) onReady(token);
      } catch (error) {
        if (active) onError(error instanceof Error ? error.message : "Không thể kết nối game. Vui lòng thử lại.");
      }
    };

    supabase.auth.getSession().then(({ data }) => sync(data.session?.access_token));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => { void sync(session?.access_token); });
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, [onReady, onError]);

  return null;
}
