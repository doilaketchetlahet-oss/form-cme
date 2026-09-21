"use client";

import { useEffect } from "react";
import { supabase } from "@/lib/supabase";

/**
 * Marks the browser as having an active session so `/studio/*` (a static bundle
 * that cannot check auth itself) can be gated by middleware.
 *
 * The cookie carries no token or personal data: it only says "this browser has
 * a session". Middleware additionally requires a real Supabase session cookie.
 */
export function GameSessionCookie() {
  useEffect(() => {
    let active = true;

    const sync = (hasSession: boolean) => {
      if (!active) return;
      const secure = window.location.protocol === "https:" ? "; Secure" : "";
      document.cookie = `eventplay_session=${hasSession ? "1" : ""}; path=/; SameSite=Lax${secure}`;
    };

    supabase.auth.getSession().then(({ data }) => sync(!!data.session));

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => sync(!!session));
    return () => {
      active = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  return null;
}
