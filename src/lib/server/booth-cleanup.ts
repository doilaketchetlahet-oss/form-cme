import type { SupabaseClient } from "@supabase/supabase-js";

export async function cleanupExpiredPublicBoothSessions(service: SupabaseClient, limit = 500) {
  const { data: expired, error: loadError } = await service
    .from("booth_draw_sessions")
    .select("id, map_path")
    .eq("access_mode", "public")
    .lte("expires_at", new Date().toISOString())
    .limit(limit);
  if (loadError) throw loadError;
  if (!expired?.length) return 0;

  const mapPaths = expired.map((session) => session.map_path).filter((path): path is string => Boolean(path));
  if (mapPaths.length > 0) await service.storage.from("booth-maps").remove(mapPaths);
  const { error: deleteError } = await service.from("booth_draw_sessions").delete().in("id", expired.map((session) => session.id));
  if (deleteError) throw deleteError;
  return expired.length;
}
