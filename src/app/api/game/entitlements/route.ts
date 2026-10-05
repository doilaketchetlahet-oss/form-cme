import { NextResponse } from "next/server";
import { resolveAllowedIds } from "@/lib/game/access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/game/entitlements
 * Public catalog access, including guests. Account save/upload APIs stay private.
 */
export async function GET() {
  const allowedIds = resolveAllowedIds();
  return NextResponse.json({ user: null, allowedIds });
}
