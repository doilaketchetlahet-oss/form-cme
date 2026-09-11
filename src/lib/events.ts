import { supabase } from "./supabase";

export type EventRecord = {
  id: string;
  name: string;
  event_date: string | null;
  form_ids: string[];
  from_name: string | null;
  from_email: string | null;
  reply_to: string | null;
  created_at: string | null;
  updated_at: string | null;
};

export async function getAccessToken(): Promise<string | null> {
  const { data } = await supabase.auth.getSession();
  return data.session?.access_token ?? null;
}

export async function listEvents(): Promise<EventRecord[]> {
  const token = await getAccessToken();
  if (!token) return [];
  const response = await fetch("/api/admin/events", { headers: { Authorization: `Bearer ${token}` } });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) return [];
  return (result.events ?? []) as EventRecord[];
}

export async function saveEvent(payload: {
  id?: string;
  name: string;
  event_date?: string | null;
  form_ids?: string[];
  from_name?: string | null;
  from_email?: string | null;
  reply_to?: string | null;
}): Promise<{ ok: boolean; id?: string; error?: string }> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "Phiên đăng nhập đã hết hạn." };
  const response = await fetch("/api/admin/events", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    return { ok: false, error: result?.error ?? "Lưu sự kiện thất bại." };
  }
  return { ok: true, id: result.id as string };
}

export async function deleteEvent(id: string): Promise<{ ok: boolean; error?: string }> {
  const token = await getAccessToken();
  if (!token) return { ok: false, error: "Phiên đăng nhập đã hết hạn." };
  const response = await fetch(`/api/admin/events?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${token}` },
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) {
    return { ok: false, error: result?.error ?? "Xóa sự kiện thất bại." };
  }
  return { ok: true };
}
