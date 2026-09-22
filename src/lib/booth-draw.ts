import { supabase } from "@/lib/supabase";

export type BoothSessionStatus = "draft" | "active" | "exchange" | "finalized";

export type BoothEvent = {
  id: string;
  name: string;
  event_date: string | null;
};

export type BoothSession = {
  id: string;
  event_id: string | null;
  name: string;
  status: BoothSessionStatus;
  map_path: string | null;
  access_mode?: "admin" | "public";
  expires_at?: string | null;
  starts_at?: string | null;
  ends_at?: string | null;
  venue?: string | null;
  public_note?: string | null;
  share_token?: string;
  share_enabled?: boolean;
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
  preferred_booth_id?: string | null;
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
  publicMode?: boolean;
  managementAuthorized?: boolean;
  current?: BoothDrawState;
};

export type SharedBoothMapResponse = {
  ok: boolean;
  error?: string;
  session: Pick<BoothSession, "id" | "name" | "status" | "starts_at" | "ends_at" | "venue" | "public_note" | "updated_at">;
  mapUrl: string | null;
  pools: BoothPool[];
  companies: BoothCompany[];
  booths: BoothZone[];
  assignments: BoothAssignment[];
};

export type BoothApiOptions = {
  publicMode?: boolean;
  passcode?: string;
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

export async function loadBoothDraw(sessionId?: string, options: BoothApiOptions = {}): Promise<BoothDrawResponse> {
  const token = options.publicMode ? null : await accessToken();
  const query = sessionId ? `?sessionId=${encodeURIComponent(sessionId)}` : "";
  const headers: Record<string, string> = token ? { Authorization: `Bearer ${token}` } : {};
  if (options.publicMode && options.passcode) headers["x-booth-passcode"] = options.passcode;
  const response = await fetch(`/api/admin/booth-draw${query}`, {
    headers,
    cache: "no-store",
  });
  return readJson<BoothDrawResponse>(response);
}

export async function mutateBoothDraw<T extends Record<string, unknown> = Record<string, unknown>>(
  payload: Record<string, unknown>,
  options: BoothApiOptions = {},
): Promise<{ ok: true } & T> {
  const token = options.publicMode ? null : await accessToken();
  const response = await fetch("/api/admin/booth-draw", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}`, "Content-Type": "application/json" } : { "Content-Type": "application/json" },
    body: JSON.stringify(options.publicMode ? { ...payload, passcode: options.passcode ?? "" } : payload),
  });
  return readJson<{ ok: true } & T>(response);
}

export async function uploadBoothMap(sessionId: string, file: File, options: BoothApiOptions = {}) {
  const token = options.publicMode ? null : await accessToken();
  const form = new FormData();
  form.set("sessionId", sessionId);
  form.set("file", file);
  if (options.publicMode) form.set("passcode", options.passcode ?? "");
  const response = await fetch("/api/admin/booth-draw/map", {
    method: "POST",
    headers: token ? { Authorization: `Bearer ${token}` } : undefined,
    body: form,
  });
  return readJson<{ ok: true; mapUrl: string | null }>(response);
}

export async function loadSharedBoothMap(token: string): Promise<SharedBoothMapResponse> {
  const response = await fetch(`/api/booth-map/${encodeURIComponent(token)}`, { cache: "no-store" });
  return readJson<SharedBoothMapResponse>(response);
}
