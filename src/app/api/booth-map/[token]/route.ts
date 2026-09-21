import { NextResponse } from "next/server";
import { createBoothServiceClient } from "@/lib/server/booth-public-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function response(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, {
    status,
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}

export async function GET(_request: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!UUID_PATTERN.test(token)) return response({ ok: false, error: "Link sơ đồ không hợp lệ." }, 404);

  const service = createBoothServiceClient();
  if (!service) return response({ ok: false, error: "Thiếu cấu hình Supabase server." }, 500);

  const { data: session, error: sessionError } = await service
    .from("booth_draw_sessions")
    .select("id, name, status, map_path, access_mode, expires_at, starts_at, ends_at, venue, public_note, updated_at")
    .eq("share_token", token)
    .eq("share_enabled", true)
    .maybeSingle();

  if (sessionError) return response({ ok: false, error: "Không thể tải sơ đồ lúc này." }, 500);
  if (!session) return response({ ok: false, error: "Sơ đồ không tồn tại hoặc đã ngừng chia sẻ." }, 404);
  if (session.access_mode === "public" && (!session.expires_at || new Date(session.expires_at).getTime() <= Date.now())) {
    return response({ ok: false, error: "Link sơ đồ miễn phí này đã hết hạn." }, 410);
  }

  const [pools, companies, booths, assignments] = await Promise.all([
    service.from("booth_pools").select("id, session_id, code, name, color, sort_order").eq("session_id", session.id).order("sort_order"),
    service.from("booth_companies").select("id, session_id, pool_id, name, draw_order, active").eq("session_id", session.id).eq("active", true).order("draw_order"),
    service.from("booth_zones").select("id, session_id, pool_id, booth_code, x, y, width, height, rotation, active").eq("session_id", session.id).eq("active", true).order("booth_code"),
    service.from("booth_assignments").select("id, session_id, pool_id, company_id, booth_id, original_result_id, source, updated_by, updated_at").eq("session_id", session.id),
  ]);
  if (pools.error || companies.error || booths.error || assignments.error) {
    return response({ ok: false, error: "Không thể tải dữ liệu vị trí gian hàng." }, 500);
  }

  let mapUrl: string | null = null;
  if (session.map_path) {
    const { data } = await service.storage.from("booth-maps").createSignedUrl(session.map_path, 4 * 60 * 60);
    mapUrl = data?.signedUrl ?? null;
  }

  return response({
    ok: true,
    session: {
      id: session.id,
      name: session.name,
      status: session.status,
      starts_at: session.starts_at,
      ends_at: session.ends_at,
      venue: session.venue,
      public_note: session.public_note,
      updated_at: session.updated_at,
    },
    mapUrl,
    pools: pools.data ?? [],
    companies: companies.data ?? [],
    booths: booths.data ?? [],
    assignments: assignments.data ?? [],
  });
}
