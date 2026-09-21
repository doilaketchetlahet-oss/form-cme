import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import { findRoomByCode } from "@/lib/flap/race";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ code: string }> };

async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anonKey) return false;
  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData } = await supabase.auth.getUser(token);
  const email = userData.user?.email?.trim().toLowerCase();
  if (!email) return false;
  const { data: member } = await supabase
    .from("admin_members")
    .select("role, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();
  return member?.role === "owner" || member?.role === "admin";
}

type Check = { name: string; ok: boolean; detail?: string };

/**
 * GET /api/flap/[code]/health — kiểm tra nhanh bảng + RPC của game đã sẵn sàng.
 *
 * Mục đích: khi hỏng (SQL chưa chạy, hàm lỗi) MC thấy ngay tên thành phần sai
 * thay vì phải mò log Vercel. Chỉ admin gọi được; không tiết lộ dữ liệu.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "unavailable" }, { status: 503 });
  if (!(await isAdminRequest(request))) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const { code } = await context.params;
  const checks: Check[] = [];

  // 1) Bảng tồn tại.
  for (const table of ["flap_rooms", "flap_players", "flap_rounds"]) {
    const res = await admin.from(table).select("*", { count: "exact", head: true });
    checks.push({
      name: `bảng ${table}`,
      ok: !res.error,
      detail: res.error?.message,
    });
  }

  const room = await findRoomByCode(admin, code);
  checks.push({
    name: "tra cứu phòng",
    ok: !!room,
    detail: room ? undefined : `không thấy phòng ${code}`,
  });

  // 2) RPC cộng điểm: gọi với token rỗng để chỉ kiểm tra hàm tồn tại và biên dịch.
  const addScore = await admin.rpc("flap_add_score", {
    p_player_id: "00000000-0000-0000-0000-000000000000",
    p_room_id: room?.id ?? "00000000-0000-0000-0000-000000000000",
    p_token_hash: "health-check",
    p_delta: 1,
    p_max_delta: 40,
    p_max_total: 100000,
    p_max_per_second: 12,
  });
  checks.push({
    name: "RPC flap_add_score",
    ok: !addScore.error,
    detail: addScore.error?.message,
  });

  // 3) RPC chốt vòng: gọi trên phòng không tồn tại -> trả null, nhưng phải không lỗi.
  const finish = await admin.rpc("flap_finish_round", {
    p_room_id: "00000000-0000-0000-0000-000000000000",
    p_reset: false,
  });
  checks.push({
    name: "RPC flap_finish_round",
    ok: !finish.error,
    detail: finish.error?.message,
  });

  return NextResponse.json({ ok: checks.every((c) => c.ok), checks });
}
