import { findPublicShare, shareAdmin, shareResponse, sameShareOrigin } from "@/lib/game/shares";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const extensions: Record<string, string> = {
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp", "image/gif": "gif", "image/svg+xml": "svg",
  "audio/mpeg": "mp3", "audio/wav": "wav", "audio/ogg": "ogg", "video/mp4": "mp4", "video/webm": "webm",
};

/** Edit links can upload media, under the original owner's existing account quota. */
export async function POST(request: Request, context: { params: Promise<{ token: string }> }) {
  if (!sameShareOrigin(request)) return shareResponse({ error: "forbidden" }, 403);
  try {
    const { token } = await context.params;
    const row = await findPublicShare(token);
    if (!row) return shareResponse({ error: "not_found" }, 404);
    if (row.edit_token !== token) return shareResponse({ error: "read_only" }, 403);
    if (Number(request.headers.get("content-length")) > 4_200_000) return shareResponse({ error: "too_large" }, 413);
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !extensions[file.type]) return shareResponse({ error: "invalid_file" }, 400);
    if (file.size > 4_000_000) return shareResponse({ error: "too_large" }, 413);
    const admin = shareAdmin()!;
    const bucket = "game-assets";
    const { data: existing } = await admin.storage.getBucket(bucket);
    if (!existing) await admin.storage.createBucket(bucket, { public: true });
    const { data: files, error: listError } = await admin.storage.from(bucket).list(row.user_id, { limit: 1000 });
    if (listError) return shareResponse({ error: "upload_failed" }, 503);
    const used = (files ?? []).reduce((total, f) => total + Number(f.metadata?.size ?? 0), 0);
    if ((files ?? []).length >= 30 || used + file.size > 60_000_000) return shareResponse({ error: "quota_assets" }, 429);
    const path = `${row.user_id}/${crypto.randomUUID()}.${extensions[file.type]}`;
    const { error } = await admin.storage.from(bucket).upload(path, Buffer.from(await file.arrayBuffer()), { contentType: file.type, upsert: false });
    if (error) return shareResponse({ error: "upload_failed" }, 503);
    const { data } = admin.storage.from(bucket).getPublicUrl(path);
    return shareResponse({ url: data.publicUrl });
  } catch { return shareResponse({ error: "unavailable" }, 503); }
}
