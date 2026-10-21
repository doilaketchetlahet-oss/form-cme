import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import { listSmtpAccounts, saveSmtpAccount } from "@/lib/server/smtp-accounts";
import { decryptSmtpPassword } from "@/lib/server/mail-merge-smtp";
import { verifyMergeSmtp } from "@/lib/server/mail-merge-smtp";
import type { SmtpAccount } from "@/lib/mail-merge";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function authorize(request: NextRequest): Promise<{ email: string } | { error: string; status: number }> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anonKey) return { error: "Bạn cần đăng nhập lại.", status: 401 };

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error } = await supabase.auth.getUser(token);
  const email = userData.user?.email?.trim().toLowerCase();
  if (error || !email) return { error: "Không xác thực được tài khoản.", status: 401 };

  const { data: member } = await supabase
    .from("admin_members")
    .select("role, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();
  if (member?.role !== "owner" && member?.role !== "admin") {
    return { error: "Bạn không có quyền quản lý tài khoản SMTP.", status: 403 };
  }
  return { email };
}

/** GET /api/admin/smtp-accounts — danh sách tài khoản (không có mật khẩu). */
export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: "Thiếu cấu hình server." }, { status: 503 });

  return NextResponse.json({ ok: true, accounts: await listSmtpAccounts(admin, auth.email) });
}

/** POST /api/admin/smtp-accounts — tạo/cập nhật, hoặc kiểm tra kết nối. */
export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: "Thiếu cấu hình server." }, { status: 503 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) return NextResponse.json({ ok: false, error: "Dữ liệu không hợp lệ." }, { status: 400 });

  const action = String(body.action ?? "save");
  const id = typeof body.id === "string" && body.id ? body.id : null;

  try {
    if (action === "verify") {
      if (!id) return NextResponse.json({ ok: false, error: "Thiếu tài khoản cần kiểm tra." }, { status: 400 });
      const { data: row } = await admin
        .from("smtp_accounts")
        .select("config, secret")
        .eq("id", id)
        .eq("owner_email", auth.email)
        .maybeSingle();
      if (!row) return NextResponse.json({ ok: false, error: "Không tìm thấy tài khoản." }, { status: 404 });
      const account = {
        ...(row.config as Omit<SmtpAccount, "password">),
        password: decryptSmtpPassword(row.secret as string, auth.email),
      } as SmtpAccount;
      await verifyMergeSmtp(account);
      return NextResponse.json({ ok: true });
    }

    const account = await saveSmtpAccount(admin, auth.email, id, {
      name: body.name,
      host: body.host,
      port: Number(body.port),
      secure: body.secure === true,
      user: body.user,
      password: body.password,
      fromEmail: body.fromEmail,
      fromName: body.fromName,
      replyTo: body.replyTo,
    });
    return NextResponse.json({ ok: true, account });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Không lưu được tài khoản SMTP.";
    return NextResponse.json({ ok: false, error: message }, { status: 400 });
  }
}

/** DELETE /api/admin/smtp-accounts?id=... — xoá tài khoản. */
export async function DELETE(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: "Thiếu cấu hình server." }, { status: 503 });

  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ ok: false, error: "Thiếu id." }, { status: 400 });

  const { error } = await admin.from("smtp_accounts").delete().eq("id", id).eq("owner_email", auth.email);
  if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
