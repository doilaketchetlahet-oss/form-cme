import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ ok: false, error: "Thiếu cấu hình Supabase." }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "Bạn cần đăng nhập lại trước khi lưu." }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const email = userData.user?.email?.trim().toLowerCase();
  if (userError || !email) {
    return NextResponse.json({ ok: false, error: "Không xác thực được tài khoản hiện tại." }, { status: 401 });
  }

  const { data: member, error: memberError } = await supabase
    .from("admin_members")
    .select("role, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();

  if (memberError) {
    return NextResponse.json({ ok: false, error: memberError.message }, { status: 500 });
  }
  if (member?.role !== "owner" && member?.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Bạn không có quyền chỉnh sửa thư mời PDF." }, { status: 403 });
  }

  const { id: surveyId } = await context.params;
  const payload = await request.json().catch(() => null) as { pdf_template?: unknown; pdf_attach_email?: boolean } | null;
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Dữ liệu không hợp lệ." }, { status: 400 });
  }

  const update: Record<string, unknown> = { pdf_template: payload.pdf_template ?? null };
  if (typeof payload.pdf_attach_email === "boolean") update.pdf_attach_email = payload.pdf_attach_email;

  const { error } = await supabase
    .from("surveys")
    .update(update)
    .eq("id", surveyId);

  if (error) {
    const message = (error.message ?? "").toLowerCase();
    if (message.includes("pdf_template") || message.includes("pdf_attach_email")) {
      return NextResponse.json({
        ok: false,
        error: "Database chưa có cột pdf_template/pdf_attach_email. Hãy chạy file supabase/pdf-template.sql trong Supabase SQL editor.",
      }, { status: 400 });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
