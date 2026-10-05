"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

/** Use account sync when signed in; guests play locally with no token. */
export function GameSessionCookie({ onReady, onError }: {
  onReady: (token: string | null) => void;
  onError: (message: string) => void;
}) {
  useEffect(() => {
    let active = true;
    let revision = 0;

    const sync = async (token?: string) => {
      if (!active) return;
      const current = ++revision;
      try {
        const response = await fetch("/api/game/session", {
          method: token ? "POST" : "DELETE",
          headers: token ? { Authorization: `Bearer ${token}` } : {},
          credentials: "same-origin",
        });
        let gameToken = token ?? null;
        if (token && response.status === 401) {
          await fetch("/api/game/session", { method: "DELETE", credentials: "same-origin" });
          gameToken = null;
        } else if (!response.ok) {
          throw new Error("Không thể kết nối game. Vui lòng thử lại.");
        }
        if (active && current === revision) onReady(gameToken);
      } catch (error) {
        if (active && current === revision) onError(error instanceof Error ? error.message : "Không thể kết nối game. Vui lòng thử lại.");
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
