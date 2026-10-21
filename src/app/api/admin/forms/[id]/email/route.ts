import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";

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
    return NextResponse.json({ ok: false, error: "Bạn cần đăng nhập lại trước khi lưu thư." }, { status: 401 });
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
    return NextResponse.json({ ok: false, error: "Bạn không có quyền chỉnh sửa thư mời." }, { status: 403 });
  }

  const { id: surveyId } = await context.params;
  const payload = await request.json().catch(() => null) as {
    email_subject?: string | null;
    email_body?: string | null;
    email_provider?: string | null;
    smtp_account_id?: string | null;
  } | null;
  if (!payload) {
    return NextResponse.json({ ok: false, error: "Dữ liệu thư không hợp lệ." }, { status: 400 });
  }

  const provider = payload.email_provider === "resend" || payload.email_provider === "smtp"
    ? payload.email_provider
    : null;

  // Tài khoản SMTP phải tồn tại và thuộc đúng người đang lưu.
  // Bảng smtp_accounts không mở cho trình duyệt nên phải kiểm tra bằng service role.
  let smtpAccountId: string | null = null;
  if (provider === "smtp" && payload.smtp_account_id) {
    const admin = createSupabaseAdmin();
    const { data: account } = admin
      ? await admin
          .from("smtp_accounts")
          .select("id")
          .eq("id", payload.smtp_account_id)
          .eq("owner_email", email)
          .maybeSingle()
      : { data: null };
    if (!account) {
      return NextResponse.json({ ok: false, error: "Tài khoản SMTP không tồn tại hoặc bạn không có quyền dùng." }, { status: 400 });
    }
    smtpAccountId = payload.smtp_account_id;
  }

  const baseUpdate = {
    email_subject: payload.email_subject?.trim() || null,
    email_body: payload.email_body?.trim() || null,
  };

  const { error } = await supabase
    .from("surveys")
    .update({ ...baseUpdate, email_provider: provider, smtp_account_id: smtpAccountId })
    .eq("id", surveyId);

  if (error) {
    const message = (error.message ?? "").toLowerCase();
    if (message.includes("email_provider") || message.includes("smtp_account_id")) {
      const { error: fallbackError } = await supabase
        .from("surveys")
        .update({ ...baseUpdate, email_provider: provider })
        .eq("id", surveyId);
      if (fallbackError) {
        return NextResponse.json({ ok: false, error: fallbackError.message }, { status: 500 });
      }
      return NextResponse.json({ ok: true });
    }
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
