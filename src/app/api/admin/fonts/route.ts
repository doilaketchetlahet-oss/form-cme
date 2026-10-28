import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import {
  deleteCustomFont,
  fontProxyUrl,
  listCustomFonts,
  MAX_FONT_BYTES,
  saveCustomFont,
} from "@/lib/server/custom-fonts";

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
  const { data, error } = await supabase.auth.getUser(token);
  const email = data.user?.email?.trim().toLowerCase();
  if (error || !email) return { error: "Không xác thực được tài khoản.", status: 401 };

  const { data: member } = await supabase
    .from("admin_members")
    .select("role, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();
  if (member?.role !== "owner" && member?.role !== "admin") {
    return { error: "Bạn không có quyền quản lý font.", status: 403 };
  }
  return { email };
}

/** GET /api/admin/fonts — danh sách font kèm signed URL ngắn hạn. */
export async function GET(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: "Thiếu cấu hình server." }, { status: 503 });

  const fonts = await listCustomFonts(admin, auth.email);
  const withUrls = fonts.map((font) => ({ ...font, url: fontProxyUrl(font.id) }));
  return NextResponse.json({ ok: true, fonts: withUrls });
}

/** POST /api/admin/fonts — tải font lên (multipart: file). */
export async function POST(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: "Thiếu cấu hình server." }, { status: 503 });

  const form = await request.formData().catch(() => null);
  const file = form?.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ ok: false, error: "Chưa chọn file font." }, { status: 400 });
  }
  if (file.size > MAX_FONT_BYTES) {
    return NextResponse.json({ ok: false, error: "Font vượt quá 5MB." }, { status: 413 });
  }

  try {
    const font = await saveCustomFont(admin, auth.email, {
      buffer: Buffer.from(await file.arrayBuffer()),
      name: file.name || "font.ttf",
    });
    return NextResponse.json({ ok: true, font });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "Không lưu được font." },
      { status: 400 },
    );
  }
}

/** DELETE /api/admin/fonts?id=... */
export async function DELETE(request: NextRequest) {
  const auth = await authorize(request);
  if ("error" in auth) return NextResponse.json({ ok: false, error: auth.error }, { status: auth.status });

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: "Thiếu cấu hình server." }, { status: 503 });

  const id = request.nextUrl.searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ ok: false, error: "Thiếu id." }, { status: 400 });

  try {
    await deleteCustomFont(admin, auth.email, id);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ ok: false, error: error instanceof Error ? error.message : "Không xoá được font." }, { status: 400 });
  }
}
