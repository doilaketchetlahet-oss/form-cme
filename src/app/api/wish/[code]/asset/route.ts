import { NextRequest, NextResponse } from "next/server";
import { authorizeAdminApi } from "@/lib/server/admin-api";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "wish-assets";
const MAX_BYTES = 6_000_000;

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
};

type Admin = NonNullable<ReturnType<typeof createSupabaseAdmin>>;

async function ensureBucket(admin: Admin) {
  try {
    const { data } = await admin.storage.getBucket(BUCKET);
    if (data) return;
  } catch {
    // chưa tồn tại -> tạo bên dưới
  }
  try {
    await admin.storage.createBucket(BUCKET, { public: true });
  } catch {
    // đã tồn tại hoặc không đủ quyền
  }
}

/** POST /api/wish/[code]/asset (multipart: file) — tải ảnh khiên/hình ghép/nền. */
export async function POST(request: NextRequest, context: { params: Promise<{ code: string }> }) {
  const auth = await authorizeAdminApi(request, true);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { code } = await context.params;
  const cleanCode = code.trim().toUpperCase().slice(0, 12) || "event";

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) return NextResponse.json({ error: "no_file" }, { status: 400 });
  if (file.size > MAX_BYTES) return NextResponse.json({ error: "too_large" }, { status: 413 });
  if (!EXT_BY_MIME[file.type]) return NextResponse.json({ error: "bad_type" }, { status: 415 });

  await ensureBucket(admin);

  const ext = EXT_BY_MIME[file.type];
  const path = `${cleanCode}/${crypto.randomUUID()}.${ext}`;
  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type,
    upsert: true,
  });
  if (error) {
    return NextResponse.json({ error: "upload_failed", detail: error.message }, { status: 500 });
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: pub.publicUrl, path });
}
