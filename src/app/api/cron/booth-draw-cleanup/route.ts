import { NextResponse } from "next/server";
import { createBoothServiceClient } from "@/lib/server/booth-public-access";
import { cleanupExpiredPublicBoothSessions } from "@/lib/server/booth-cleanup";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return NextResponse.json({ ok: false, error: "CRON_SECRET is not configured" }, { status: 503 });
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const service = createBoothServiceClient();
  if (!service) return NextResponse.json({ ok: false, error: "Supabase admin not configured" }, { status: 500 });

  try {
    const deleted = await cleanupExpiredPublicBoothSessions(service);
    return NextResponse.json({ ok: true, deleted });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Cleanup failed" }, { status: 500 });
  }
}
