import { NextResponse } from "next/server";
import { authorizeGame } from "@/lib/game/auth";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 4_000_000;

/** GET /api/game/save — bản lưu studio của user. */
export async function GET(request: Request) {
  const auth = await authorizeGame(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { data } = await supabase
    .from("game_saves")
    .select("data, rev, updated_at")
    .eq("user_id", auth.user.id)
    .maybeSingle();

  return NextResponse.json({
    data: data?.data ?? null,
    rev: data?.rev ?? 0,
    updatedAt: data?.updated_at ?? null,
  });
}

/** PUT /api/game/save — ghi đè bản lưu (last-write-wins). */
export async function PUT(request: Request) {
  const auth = await authorizeGame(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createSupabaseAdmin();
  if (!supabase) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as { data?: unknown } | null;
  if (!body || typeof body.data !== "object" || body.data === null) {
    return NextResponse.json({ error: "invalid_body" }, { status: 400 });
  }

  const size = JSON.stringify(body.data).length;
  if (size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large", size }, { status: 413 });
  }

  const { data: current } = await supabase
    .from("game_saves")
    .select("rev")
    .eq("user_id", auth.user.id)
    .maybeSingle();
  const rev = (current?.rev ?? 0) + 1;

  const { error } = await supabase.from("game_saves").upsert(
    {
      user_id: auth.user.id,
      data: body.data,
      rev,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" }
  );

  if (error) {
    return NextResponse.json({ error: "save_failed", detail: error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, rev });
}
