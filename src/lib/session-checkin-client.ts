"use client";
import { supabase } from "./supabase";
import type { CheckinSession } from "./checkin-sessions";

export type SessionCheckinResult = {
  ok: boolean;
  code?: "ready" | "checked_in" | "already" | "unchecked";
  checkedInAt?: string | null;
  session?: CheckinSession;
  error?: string;
};

export async function recordSessionCheckin(surveyId: string, responseId: string, sessionId: string, action: "preview" | "checkin" | "undo", method: "qr" | "face" | "manual"): Promise<SessionCheckinResult> {
  try {
    const { data } = await supabase.auth.getSession();
    let pin: string | null = null;
    try { pin = sessionStorage.getItem(`checkin-pin-${surveyId}`); } catch { /* sessionStorage may be disabled */ }
    const response = await fetch(`/api/checkin/${encodeURIComponent(surveyId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
      body: JSON.stringify({ responseId, sessionId, action, method, pin }),
    });
    const result = await response.json();
    return response.ok ? result : { ...result, ok: false };
  } catch {
    return { ok: false, error: "Mất kết nối. Chưa ghi nhận check-in, vui lòng thử lại." };
  }
}
