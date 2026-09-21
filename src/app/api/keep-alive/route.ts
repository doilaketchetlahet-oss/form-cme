import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createBoothServiceClient } from "@/lib/server/booth-public-access";
import { cleanupExpiredPublicBoothSessions } from "@/lib/server/booth-cleanup";

export const runtime = "nodejs";

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json(
      { ok: false, error: "Missing Supabase environment variables." },
      { status: 500 },
    );
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
  });

  const startedAt = Date.now();
  const { error } = await supabase
    .from("surveys")
    .select("id", { count: "exact", head: true })
    .limit(1);

  if (error) {
    return NextResponse.json(
      { ok: false, error: error.message, checkedAt: new Date().toISOString() },
      { status: 500 },
    );
  }

  let deletedBoothSessions = 0;
  const service = createBoothServiceClient();
  if (service) {
    try {
      deletedBoothSessions = await cleanupExpiredPublicBoothSessions(service);
    } catch {
      // Keep-alive must remain compatible until booth-draw-public.sql is installed.
    }
  }

  return NextResponse.json({
    ok: true,
    checkedAt: new Date().toISOString(),
    latencyMs: Date.now() - startedAt,
    deletedBoothSessions,
  });
}
