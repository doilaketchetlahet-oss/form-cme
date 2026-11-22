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

export type GeneralBulkCheckinResult = {
  ok: boolean;
  /** responseId → first arrival time recorded by this request. */
  checkedIn: Record<string, string>;
  already: number;
  skipped: number;
  error?: string;
};

const OFFLINE = "Mất kết nối. Chưa ghi nhận check-in, vui lòng thử lại.";
/** Must match MAX_BULK in /api/checkin/[surveyId]. */
const BULK_CHUNK = 150;

async function postCheckin(surveyId: string, payload: Record<string, unknown>) {
  const { data } = await supabase.auth.getSession();
  let pin: string | null = null;
  try { pin = sessionStorage.getItem(`checkin-pin-${surveyId}`); } catch { /* sessionStorage may be disabled */ }
  const response = await fetch(`/api/checkin/${encodeURIComponent(surveyId)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(data.session?.access_token ? { Authorization: `Bearer ${data.session.access_token}` } : {}) },
    body: JSON.stringify({ ...payload, pin }),
  });
  const result = await response.json();
  return response.ok ? result : { ...result, ok: false };
}

export async function recordSessionCheckin(surveyId: string, responseId: string, sessionId: string, action: "preview" | "checkin" | "undo", method: "qr" | "face" | "manual", hall?: string): Promise<SessionCheckinResult> {
  try {
    return await postCheckin(surveyId, { responseId, sessionId, action, method, hall });
  } catch {
    return { ok: false, error: OFFLINE };
  }
}

/** Check-in for forms without managed sessions, validated and timestamped by the server. */
export async function recordGeneralCheckin(surveyId: string, responseId: string, action: "checkin" | "undo", method: "qr" | "face" | "manual", hall?: string | null): Promise<SessionCheckinResult> {
  try {
    return await postCheckin(surveyId, { mode: "general", responseId, action, method, hall: hall || undefined });
  } catch {
    return { ok: false, error: OFFLINE };
  }
}

/** Bulk general check-in. Unpaid/unknown rows are skipped; first arrivals are preserved. */
export async function recordGeneralCheckinBulk(surveyId: string, responseIds: string[]): Promise<GeneralBulkCheckinResult> {
  const total: GeneralBulkCheckinResult = { ok: true, checkedIn: {}, already: 0, skipped: 0 };
  for (let start = 0; start < responseIds.length; start += BULK_CHUNK) {
    const chunk = responseIds.slice(start, start + BULK_CHUNK);
    let result: Partial<GeneralBulkCheckinResult> & { ok?: boolean; error?: string };
    try {
      result = await postCheckin(surveyId, { mode: "general", responseIds: chunk, action: "checkin", method: "bulk" });
    } catch {
      result = { ok: false, error: OFFLINE };
    }
    if (!result.ok) {
      // Keep what earlier chunks recorded so the list reflects the database.
      return { ...total, ok: false, skipped: total.skipped + responseIds.length - start, error: result.error ?? OFFLINE };
    }
    Object.assign(total.checkedIn, result.checkedIn ?? {});
    total.already += result.already ?? 0;
    total.skipped += result.skipped ?? 0;
  }
  return total;
}
