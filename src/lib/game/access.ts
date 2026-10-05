import type { SupabaseClient } from "@supabase/supabase-js";
import { GAME_MODULE_IDS } from "./catalog";

type EntitlementRow = { module_id: string; expires_at: string | null };

/** Danh sách module user được cấp (còn hạn) từ bảng entitlements. */
export async function getEntitledModuleIds(
  supabase: SupabaseClient,
  userId: string
): Promise<string[]> {
  try {
    const { data } = await supabase
      .from("entitlements")
      .select("module_id, expires_at")
      .eq("user_id", userId);

    const rows = (data ?? []) as EntitlementRow[];
    const now = Date.now();
    return rows
      .filter((e) => !e.expires_at || new Date(e.expires_at).getTime() > now)
      .map((e) => e.module_id);
  } catch {
    return [];
  }
}

/** Mở toàn bộ catalog, kể cả khách chưa đăng nhập. */
export function resolveAllowedIds(): string[] {
  return [...GAME_MODULE_IDS];
}
