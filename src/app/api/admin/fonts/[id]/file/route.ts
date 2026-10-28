import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import { readCustomFont, verifyFontSignature } from "@/lib/server/custom-fonts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

/**
 * GET /api/admin/fonts/[id]/file?exp=...&sig=...
 *
 * Trình duyệt cần nạp font bằng `FontFace` (không gửi được header auth), nên
 * truy cập được ký trong query, hạn 10 phút. Bucket vẫn private.
 */
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;
  const exp = Number(request.nextUrl.searchParams.get("exp") ?? "0");
  const sig = request.nextUrl.searchParams.get("sig") ?? "";
  if (!verifyFontSignature(id, exp, sig)) {
    return NextResponse.json({ ok: false, error: "Liên kết font đã hết hạn." }, { status: 403 });
  }

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ ok: false, error: "Thiếu cấu hình server." }, { status: 503 });

  const font = await readCustomFont(admin, id);
  if (!font) return NextResponse.json({ ok: false, error: "Không tìm thấy font." }, { status: 404 });

  return new NextResponse(new Uint8Array(font.buffer), {
    headers: {
      "Content-Type": "font/ttf",
      "Cache-Control": "private, max-age=600",
    },
  });
}
