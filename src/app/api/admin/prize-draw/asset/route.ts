import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { NextResponse } from "next/server";
import { authorizeAdminApi } from "@/lib/server/admin-api";
import { UUID_RE } from "@/lib/prize-draw";

export const runtime = "nodejs";
const MAX_BYTES = 4 * 1024 * 1024;
export async function POST(request: Request) {
  const auth = await authorizeAdminApi(request, true, "prize-draw");
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (Number(request.headers.get("content-length")) > MAX_BYTES + 8192) return NextResponse.json({ error: "Ảnh tối đa 4 MB." }, { status: 413 });
  let form: FormData;
  try { form = await request.formData(); } catch { return NextResponse.json({ error: "Tệp không hợp lệ." }, { status: 400 }); }
  const id = String(form.get("campaign_id") || ""), file = form.get("file");
  if (!UUID_RE.test(id) || !(file instanceof File) || file.size < 1 || file.size > MAX_BYTES || !["image/jpeg", "image/png", "image/webp"].includes(file.type)) return NextResponse.json({ error: "Chọn ảnh JPG, PNG hoặc WebP, tối đa 4 MB." }, { status: 400 });
  const campaign = await auth.service.from("prize_campaigns").select("id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (campaign.error) return NextResponse.json({ error: "Không kiểm tra được chương trình." }, { status: 503 });
  if (!campaign.data) return NextResponse.json({ error: "Không tìm thấy chương trình." }, { status: 404 });
  let buffer: Buffer;
  try {
    buffer = await sharp(Buffer.from(await file.arrayBuffer()), { limitInputPixels: 20000000, animated: false })
      .rotate().resize(1200, 1200, { fit: "inside", withoutEnlargement: true }).webp({ quality: 85 }).toBuffer();
  } catch { return NextResponse.json({ error: "Không đọc được ảnh. Hãy chọn ảnh khác, dưới 20 megapixel." }, { status: 400 }); }
  const path = `${id}/${randomUUID()}.webp`;
  const storage = auth.service.storage.from("prize-assets");
  const uploaded = await storage.upload(path, buffer, { contentType: "image/webp", upsert: false });
  if (uploaded.error) return NextResponse.json({ error: "Không tải ảnh lên được. Kiểm tra kho ảnh prize-assets." }, { status: 503 });
  return NextResponse.json({ ok: true, url: storage.getPublicUrl(path).data.publicUrl });
}
