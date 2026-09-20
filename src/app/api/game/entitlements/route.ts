import { NextResponse } from "next/server";
import { authorizeGame } from "@/lib/game/auth";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import { resolveAllowedIds } from "@/lib/game/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/game/entitlements
 * Trả về danh sách module user được phép mở (dùng cho studio nhúng iframe).
 */
export async function GET(request: Request) {
  const auth = await authorizeGame(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const allowedIds = await resolveAllowedIds(supabase, auth.user.id);
  return NextResponse.json({ user: auth.user, allowedIds });
}
