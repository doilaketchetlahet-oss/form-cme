import { NextResponse } from "next/server";
import { authorizeGame } from "@/lib/game/auth";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const BUCKET = "game-assets";
const MAX_BYTES = 4_000_000;
/** Per-account storage guard so a public bucket cannot be abused. */
const MAX_FILES_PER_USER = 30;
const MAX_USER_BYTES = 60_000_000;

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

const EXT_BY_MIME: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/svg+xml": "svg",
  "audio/mpeg": "mp3",
  "audio/wav": "wav",
  "audio/ogg": "ogg",
  "video/mp4": "mp4",
  "video/webm": "webm",
};

/** POST /api/game/assets (multipart: file) — upload lên Supabase Storage. */
export async function POST(request: Request) {
  const auth = await authorizeGame(request);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "no_file" }, { status: 400 });
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json({ error: "too_large", size: file.size }, { status: 413 });
  }

  await ensureBucket(admin);

  const { data: uploaded } = await admin.storage.from(BUCKET).list(auth.user.id, { limit: 1000 });
  const usedFiles = uploaded ?? [];
  const usedBytes = usedFiles.reduce(
    (sum, item) => sum + Number((item.metadata as { size?: number } | null)?.size ?? 0),
    0,
  );
  if (usedFiles.length >= MAX_FILES_PER_USER) {
    return NextResponse.json({ error: "quota_files", limit: MAX_FILES_PER_USER }, { status: 429 });
  }
  if (usedBytes + file.size > MAX_USER_BYTES) {
    return NextResponse.json(
      { error: "quota_bytes", used: usedBytes, limit: MAX_USER_BYTES },
      { status: 413 },
    );
  }

  const ext =
    EXT_BY_MIME[file.type] ??
    (file.name.split(".").pop() || "bin").toLowerCase().replace(/[^a-z0-9]/g, "").slice(0, 6);
  const path = `${auth.user.id}/${crypto.randomUUID()}.${ext}`;

  const buf = Buffer.from(await file.arrayBuffer());
  const { error } = await admin.storage.from(BUCKET).upload(path, buf, {
    contentType: file.type || "application/octet-stream",
    upsert: false,
  });
  if (error) {
    return NextResponse.json({ error: "upload_failed", detail: error.message }, { status: 500 });
  }

  const { data: pub } = admin.storage.from(BUCKET).getPublicUrl(path);
  return NextResponse.json({ url: pub.publicUrl, path });
}
