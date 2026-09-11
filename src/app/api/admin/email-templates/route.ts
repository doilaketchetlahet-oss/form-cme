import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type TemplateRow = {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  updated_at: string | null;
};

const MISSING_TABLE_HINT =
  "Chưa có bảng email_templates. Hãy chạy file supabase/email-templates.sql trong Supabase SQL editor rồi thử lại.";

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return error.code === "42P01"
    || error.code === "PGRST205"
    || message.includes("does not exist")
    || message.includes("could not find the table")
    || message.includes("schema cache");
}

function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authorize(request: Request): Promise<{ email: string } | { error: NextResponse }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: NextResponse.json({ ok: false, error: "Thiếu cấu hình Supabase." }, { status: 500 }) };
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { error: NextResponse.json({ ok: false, error: "Bạn cần đăng nhập." }, { status: 401 }) };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const email = userData.user?.email?.trim().toLowerCase();
  if (userError || !email) {
    return { error: NextResponse.json({ ok: false, error: "Không xác thực được tài khoản hiện tại." }, { status: 401 }) };
  }

  const { data: member } = await supabase
    .from("admin_members")
    .select("role, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();

  if (member?.role !== "owner" && member?.role !== "admin") {
    return { error: NextResponse.json({ ok: false, error: "Bạn không có quyền quản lý template." }, { status: 403 }) };
  }

  return { email };
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY để dùng thư viện template." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("email_templates")
    .select("id, name, subject, body, updated_at")
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    return NextResponse.json({ ok: false, error: isMissingTable(error) ? MISSING_TABLE_HINT : error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, templates: (data ?? []) as TemplateRow[] });
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY để lưu template." }, { status: 400 });
  }

  const payload = await request.json().catch(() => null) as {
    id?: string;
    name?: string;
    subject?: string | null;
    body?: string;
  } | null;

  const name = payload?.name?.trim();
  const body = payload?.body?.trim();
  const subject = payload?.subject?.trim() || null;
  if (!name || !body) {
    return NextResponse.json({ ok: false, error: "Cần tên template và nội dung." }, { status: 400 });
  }

  if (payload?.id) {
    const { data, error } = await supabase
      .from("email_templates")
      .update({ name, subject, body, updated_at: new Date().toISOString() })
      .eq("id", payload.id)
      .select("id")
      .maybeSingle();
    if (error) {
      return NextResponse.json({ ok: false, error: isMissingTable(error) ? MISSING_TABLE_HINT : error.message }, { status: 500 });
    }
    if (!data) {
      return NextResponse.json({ ok: false, error: "Không tìm thấy template." }, { status: 404 });
    }
    return NextResponse.json({ ok: true, id: data.id });
  }

  const { data, error } = await supabase
    .from("email_templates")
    .insert({ owner_email: auth.email, name, subject, body })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ ok: false, error: isMissingTable(error) ? MISSING_TABLE_HINT : error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, id: data.id });
}

export async function DELETE(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Thiếu id template." }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY để xóa template." }, { status: 400 });
  }

  const { error } = await supabase.from("email_templates").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ ok: false, error: isMissingTable(error) ? MISSING_TABLE_HINT : error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
