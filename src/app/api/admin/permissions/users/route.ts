import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createDbClient } from "@/lib/server/db";

export const runtime = "nodejs";

type RegisteredUser = {
  email: string;
  created_at: string | null;
};

export async function GET(request: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ ok: false, error: "Thiếu cấu hình Supabase." }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "Bạn cần đăng nhập." }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const email = userData.user?.email?.trim().toLowerCase();
  if (userError || !email) {
    return NextResponse.json({ ok: false, error: "Không xác thực được tài khoản hiện tại." }, { status: 401 });
  }

  const { data: member } = await supabase
    .from("admin_members")
    .select("role, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();

  if (member?.role !== "owner") {
    return NextResponse.json({ ok: false, error: "Chỉ owner mới được xem danh sách tài khoản." }, { status: 403 });
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (serviceKey) {
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
    if (!listError) {
      const users: RegisteredUser[] = (data.users ?? [])
        .map((user) => ({ email: (user.email ?? "").trim().toLowerCase(), created_at: user.created_at ?? null }))
        .filter((user) => user.email.includes("@"))
        .sort((a, b) => (b.created_at ?? "").localeCompare(a.created_at ?? ""));
      return NextResponse.json({ ok: true, users });
    }
  }

  const client = createDbClient();
  if (!client) {
    return NextResponse.json(
      { ok: false, error: "Cần SUPABASE_SERVICE_ROLE_KEY hoặc SUPABASE_DB_URL để liệt kê tài khoản đã đăng ký." },
      { status: 400 },
    );
  }

  try {
    await client.connect();
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Không kết nối được database." },
      { status: 500 },
    );
  }

  try {
    const result = await client.query<RegisteredUser>(
      "select lower(email) as email, created_at::text as created_at from auth.users where email is not null order by created_at desc limit 1000",
    );
    return NextResponse.json({ ok: true, users: result.rows.filter((row) => row.email.includes("@")) });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Không tải được danh sách tài khoản." },
      { status: 500 },
    );
  } finally {
    await client.end().catch(() => {});
  }
}
