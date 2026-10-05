import { NextResponse } from "next/server";
import { authorizeGame } from "@/lib/game/auth";
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

  const allowedIds = resolveAllowedIds();
  return NextResponse.json({ user: auth.user, allowedIds });
}
