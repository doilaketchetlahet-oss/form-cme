import { supabase } from "@/lib/supabase";

export type BoothSessionStatus = "draft" | "active" | "exchange" | "finalized";

export type BoothEvent = {
  id: string;
  name: string;
  event_date: string | null;
};

export type BoothSession = {
  id: string;
  event_id: string;
  name: string;
  status: BoothSessionStatus;
  map_path: string | null;
  created_at: string;
  updated_at: string;
};

export type BoothPool = {
  id: string;
  session_id: string;
  code: string;
  name: string;
  color: string;
  sort_order: number;
};

export type BoothCompany = {
  id: string;
  session_id: string;
  pool_id: string;
  name: string;
  draw_order: number;
  active: boolean;
};

export type BoothZone = {
  id: string;
  session_id: string;
  pool_id: string;
  booth_code: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  active: boolean;
};

export type BoothAssignment = {
  id: string;
  session_id: string;
  pool_id: string;
  company_id: string;
  booth_id: string;
  original_result_id: string;
  source: "draw" | "swap" | "move";
  updated_by: string | null;
  updated_at: string;
};

export type BoothDrawResult = {
  id: string;
  session_id: string;
  pool_id: string;
  company_id: string;
  booth_id: string;
  request_key: string;
  drawn_by: string | null;
  drawn_at: string;
};

export type BoothExchangeLog = {
  id: string;
  session_id: string;
  pool_id: string;
  action: "swap" | "move";
  company_a_id: string;
  company_b_id: string | null;
  booth_a_before_id: string;
  booth_b_before_id: string | null;
  booth_a_after_id: string;
  booth_b_after_id: string | null;
  reason: string | null;
  created_by: string | null;
  created_at: string;
};

export type BoothDrawRpcResult = {
  result_id: string;
  company_id: string;
  company_name: string;
  booth_id: string;
  booth_code: string;
  pool_id: string;
  pool_name: string;
  pool_color: string;
};

export type BoothDrawState = {
  session: BoothSession;
  mapUrl: string | null;
  pools: BoothPool[];
  companies: BoothCompany[];
  booths: BoothZone[];
  assignments: BoothAssignment[];
  results: BoothDrawResult[];
  exchanges: BoothExchangeLog[];
};

export type BoothDrawResponse = {
  ok: boolean;
  error?: string;
  events: BoothEvent[];
  sessions: BoothSession[];
  role: "owner" | "admin" | "viewer";
  current?: BoothDrawState;
};

async function accessToken() {
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Bạn cần đăng nhập lại.");
  return token;
}

async function readJson<T>(response: Response): Promise<T> {
  const body = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok || !body) throw new Error(body?.error ?? "Yêu cầu thất bại.");
  return body;
}

export async function loadBoothDraw(sessionId?: string): Promise<BoothDrawResponse> {
  const token = await accessToken();
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const response = await fetch(`/api/admin/booth-draw${query}`, {
    headers: { Authorization: `Bearer ${token}` },
    cache: "no-store",
  });
  return readJson<BoothDrawResponse>(response);
}

export async function mutateBoothDraw<T extends Record<string, unknown> = Record<string, unknown>>(
  payload: Record<string, unknown>,
): Promise<{ ok: true } & T> {
  const token = await accessToken();
  const response = await fetch("/api/admin/booth-draw", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  return readJson<{ ok: true } & T>(response);
}

export async function uploadBoothMap(sessionId: string, file: File) {
  const token = await accessToken();
  const form = new FormData();
  form.set("sessionId", sessionId);
  form.set("file", file);
  const response = await fetch("/api/admin/booth-draw/map", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  return readJson<{ ok: true; mapUrl: string | null }>(response);
}
