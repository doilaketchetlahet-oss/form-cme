import { NextResponse } from "next/server";
import { authorizeAdminApi } from "@/lib/server/admin-api";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_MAP_BYTES = 10 * 1024 * 1024;
const ACCEPTED_TYPES = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request, true);
  if ("error" in auth) return jsonError(auth.error, auth.status);

  const form = await request.formData().catch(() => null);
  const sessionId = String(form?.get("sessionId") ?? "").trim();
  const file = form?.get("file");
  if (!sessionId || !(file instanceof File)) return jsonError("Thiếu phiên hoặc file sơ đồ.");
  if (!ACCEPTED_TYPES.has(file.type)) return jsonError("Sơ đồ phải là ảnh JPG, PNG hoặc WebP.");
  if (file.size <= 0 || file.size > MAX_MAP_BYTES) return jsonError("Ảnh sơ đồ không được lớn hơn 10 MB.");

  const { data: session, error: sessionError } = await auth.service
    .from("booth_draw_sessions")
    .select("id, map_path, status")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) return jsonError(sessionError.message, 500);
  if (!session) return jsonError("Không tìm thấy phiên bốc thăm.", 404);
  if (session.status === "finalized") return jsonError("Phiên đã khóa kết quả. Hãy mở lại trước khi đổi sơ đồ.", 409);

  const extension = ACCEPTED_TYPES.get(file.type) ?? "png";
  const path = `${sessionId}/${crypto.randomUUID()}.${extension}`;
  const bytes = await file.arrayBuffer();
  const { error: uploadError } = await auth.service.storage
    .from("booth-maps")
    .upload(path, bytes, { contentType: file.type, upsert: false });
  if (uploadError) {
    const missingBucket = uploadError.message.toLowerCase().includes("bucket");
    return jsonError(
      missingBucket
        ? "Chưa có bucket booth-maps. Hãy chạy supabase/booth-draw.sql."
        : uploadError.message,
      500,
    );
  }

  const { error: updateError } = await auth.service
    .from("booth_draw_sessions")
    .update({ map_path: path, updated_at: new Date().toISOString() })
    .eq("id", sessionId);
  if (updateError) {
    await auth.service.storage.from("booth-maps").remove([path]);
    return jsonError(updateError.message, 500);
  }

  if (session.map_path && session.map_path !== path) {
    await auth.service.storage.from("booth-maps").remove([session.map_path]);
  }
  const { data: signed } = await auth.service.storage.from("booth-maps").createSignedUrl(path, 60 * 60);
  return NextResponse.json({ ok: true, mapUrl: signed?.signedUrl ?? null });
}
