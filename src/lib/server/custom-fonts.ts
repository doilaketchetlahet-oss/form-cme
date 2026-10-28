import path from "node:path";
import { mkdir, writeFile, access } from "node:fs/promises";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

export const FONT_BUCKET = "form-fonts";
export const MAX_FONT_BYTES = 5 * 1024 * 1024;
export const MAX_FONTS_PER_OWNER = 20;

/** Ký tự tiếng Việt bắt buộc phải có để tên không ra ô vuông. */
const VIETNAMESE_PROBES = ["ễ", "Đ", "ứ", "ạ", "ỹ", "ộ", "ă", "ơ", "ư", "đ"];

export type FontFileInfo = {
  family: string;
  weight: "regular" | "bold";
  hasVietnamese: boolean;
  missing: string[];
};

/** Chỉ nhận TTF/OTF thật: kiểm tra magic bytes, không tin đuôi file. */
export function sniffFont(buffer: Buffer): { ok: boolean; detail: string } {
  if (buffer.length < 12) return { ok: false, detail: "File quá nhỏ để là font." };
  const tag = buffer.subarray(0, 4).toString("hex");
  const ascii = buffer.subarray(0, 4).toString("latin1");
  if (tag === "00010000" || ascii === "true" || ascii === "typ1") return { ok: true, detail: "truetype" };
  if (ascii === "OTTO") return { ok: true, detail: "otf" };
  if (ascii === "wOFF" || ascii === "wOF2") return { ok: false, detail: "WOFF/WOFF2 không dùng được. Hãy xuất lại .ttf hoặc .otf." };
  if (ascii === "ttcf") return { ok: false, detail: "Font collection (.ttc) chưa hỗ trợ. Hãy xuất từng font riêng." };
  return { ok: false, detail: "Không phải file font TTF/OTF hợp lệ." };
}

function readUInt16(buffer: Buffer, offset: number) {
  return buffer.readUInt16BE(offset);
}

function readUInt32(buffer: Buffer, offset: number) {
  return buffer.readUInt32BE(offset);
}

/** Bảng `name` giúp lấy tên family và xác định Regular/Bold. */
function readNameTable(buffer: Buffer) {
  const numTables = readUInt16(buffer, 4);
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16;
    if (record + 16 > buffer.length) break;
    const tag = buffer.subarray(record, record + 4).toString("latin1");
    if (tag !== "name") continue;
    const tableOffset = readUInt32(buffer, record + 8);
    const count = readUInt16(buffer, tableOffset + 2);
    const stringOffset = readUInt16(buffer, tableOffset + 4);
    const names = new Map<number, string>();
    for (let n = 0; n < count; n += 1) {
      const entry = tableOffset + 6 + n * 12;
      if (entry + 12 > buffer.length) break;
      const platformId = readUInt16(buffer, entry);
      const nameId = readUInt16(buffer, entry + 6);
      const length = readUInt16(buffer, entry + 8);
      const offset = readUInt16(buffer, entry + 10);
      const start = tableOffset + stringOffset + offset;
      if (start + length > buffer.length) continue;
      const slice = buffer.subarray(start, start + length);
      const value = platformId === 3 || platformId === 0
        ? Buffer.from(slice).swap16().toString("utf16le")
        : slice.toString("latin1");
      // Ưu tiên tên family (1) và full name (4).
      if ([1, 4, 16, 17].includes(nameId) && !names.has(nameId)) names.set(nameId, value.trim());
    }
    return {
      family: names.get(16) || names.get(1) || names.get(4) || "Font tải lên",
      fullName: names.get(4) || "",
    };
  }
  return { family: "Font tải lên", fullName: "" };
}

/** Đọc cmap (format 4/12) để biết font có đủ dấu tiếng Việt. */
function hasGlyphs(buffer: Buffer, probes: string[]) {
  const codepoints = probes.map((char) => char.codePointAt(0) ?? 0);
  const numTables = readUInt16(buffer, 4);
  let cmapOffset = -1;
  for (let i = 0; i < numTables; i += 1) {
    const record = 12 + i * 16;
    if (record + 16 > buffer.length) break;
    if (buffer.subarray(record, record + 4).toString("latin1") === "cmap") {
      cmapOffset = readUInt32(buffer, record + 8);
      break;
    }
  }
  if (cmapOffset < 0) return { ok: false, missing: probes };

  const subtables = readUInt16(buffer, cmapOffset + 2);
  const found = new Set<number>();
  for (let i = 0; i < subtables; i += 1) {
    const entry = cmapOffset + 4 + i * 8;
    if (entry + 8 > buffer.length) break;
    const offset = cmapOffset + readUInt32(buffer, entry + 4);
    const format = readUInt16(buffer, offset);
    if (format === 4) {
      const segX2 = readUInt16(buffer, offset + 6);
      const endBase = offset + 14;
      const startBase = endBase + segX2 + 2;
      for (let seg = 0; seg < segX2 / 2; seg += 1) {
        const end = readUInt16(buffer, endBase + seg * 2);
        const start = readUInt16(buffer, startBase + seg * 2);
        for (const cp of codepoints) {
          if (cp >= start && cp <= end && cp <= 0xffff) found.add(cp);
        }
      }
    } else if (format === 12) {
      const groups = readUInt32(buffer, offset + 12);
      for (let g = 0; g < groups; g += 1) {
        const base = offset + 16 + g * 12;
        if (base + 12 > buffer.length) break;
        const start = readUInt32(buffer, base);
        const end = readUInt32(buffer, base + 4);
        for (const cp of codepoints) {
          if (cp >= start && cp <= end) found.add(cp);
        }
      }
    }
  }
  const missing = probes.filter((_, index) => !found.has(codepoints[index]));
  return { ok: missing.length === 0, missing };
}

export function inspectFont(buffer: Buffer, fileName: string): FontFileInfo {
  const sniffed = sniffFont(buffer);
  if (!sniffed.ok) throw new Error(sniffed.detail);

  const { family, fullName } = readNameTable(buffer);
  const covered = hasGlyphs(buffer, VIETNAMESE_PROBES);
  const lower = `${fullName} ${fileName}`.toLowerCase();
  const weight: "regular" | "bold" = /bold|black|heavy|semibold|demibold|extrabold|700|800|900/.test(lower) ? "bold" : "regular";
  return { family: family.slice(0, 80), weight, hasVietnamese: covered.ok, missing: covered.missing };
}

export type CustomFont = {
  id: string;
  family: string;
  weight: "regular" | "bold";
  fileName: string;
  sizeBytes: number;
  hasVietnamese: boolean;
  createdAt: string;
};

type Row = {
  id: string;
  owner_email: string;
  family: string;
  weight: "regular" | "bold";
  storage_path: string;
  file_name: string;
  size_bytes: number;
  has_vietnamese: boolean;
  created_at: string;
};

function toPublic(row: Row): CustomFont {
  return {
    id: row.id,
    family: row.family,
    weight: row.weight,
    fileName: row.file_name,
    sizeBytes: row.size_bytes,
    hasVietnamese: row.has_vietnamese,
    createdAt: row.created_at,
  };
}

export async function ensureFontBucket(admin: SupabaseClient) {
  try {
    const { data } = await admin.storage.getBucket(FONT_BUCKET);
    if (data) return;
  } catch {
    // chưa tồn tại
  }
  try {
    await admin.storage.createBucket(FONT_BUCKET, {
      public: false,
      fileSizeLimit: MAX_FONT_BYTES,
      allowedMimeTypes: ["font/ttf", "font/otf", "application/octet-stream", "application/x-font-ttf", "application/x-font-opentype"],
    });
  } catch {
    // đã tồn tại hoặc không đủ quyền
  }
}

export async function listCustomFonts(admin: SupabaseClient, ownerEmail: string): Promise<CustomFont[]> {
  const { data } = await admin
    .from("custom_fonts")
    .select("*")
    .eq("owner_email", ownerEmail)
    .order("created_at", { ascending: false });
  return ((data ?? []) as Row[]).map(toPublic);
}

export async function saveCustomFont(
  admin: SupabaseClient,
  ownerEmail: string,
  file: { buffer: Buffer; name: string },
): Promise<CustomFont> {
  if (file.buffer.length > MAX_FONT_BYTES) throw new Error("Font vượt quá 5MB.");
  const existing = await listCustomFonts(admin, ownerEmail);
  if (existing.length >= MAX_FONTS_PER_OWNER) throw new Error(`Chỉ lưu tối đa ${MAX_FONTS_PER_OWNER} font.`);

  const info = inspectFont(file.buffer, file.name);
  await ensureFontBucket(admin);

  const ext = info.family ? file.name.split(".").pop()?.toLowerCase() || "ttf" : "ttf";
  const storagePath = `${ownerEmail}/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
  const { error: uploadError } = await admin.storage.from(FONT_BUCKET).upload(storagePath, file.buffer, {
    contentType: "application/octet-stream",
    upsert: false,
  });
  if (uploadError) throw new Error(uploadError.message);

  const { data, error } = await admin
    .from("custom_fonts")
    .insert({
      owner_email: ownerEmail,
      family: info.family,
      weight: info.weight,
      storage_path: storagePath,
      file_name: file.name.slice(0, 120),
      size_bytes: file.buffer.length,
      has_vietnamese: info.hasVietnamese,
    })
    .select("*")
    .single();
  if (error || !data) {
    await admin.storage.from(FONT_BUCKET).remove([storagePath]).catch(() => undefined);
    throw new Error(error?.message ?? "Không lưu được font.");
  }
  return toPublic(data as Row);
}

export async function deleteCustomFont(admin: SupabaseClient, ownerEmail: string, id: string) {
  const { data } = await admin
    .from("custom_fonts")
    .select("storage_path")
    .eq("id", id)
    .eq("owner_email", ownerEmail)
    .maybeSingle();
  if (!data) throw new Error("Không tìm thấy font.");
  await admin.storage.from(FONT_BUCKET).remove([(data as { storage_path: string }).storage_path]).catch(() => undefined);
  await admin.from("custom_fonts").delete().eq("id", id).eq("owner_email", ownerEmail);
}

/** Signed URL ngắn hạn để trình duyệt nạp font cho khung thiết kế. */
export async function signedFontUrl(admin: SupabaseClient, ownerEmail: string, id: string) {
  const { data } = await admin
    .from("custom_fonts")
    .select("storage_path")
    .eq("id", id)
    .eq("owner_email", ownerEmail)
    .maybeSingle();
  if (!data) return null;
  const { data: signed } = await admin.storage.from(FONT_BUCKET).createSignedUrl((data as { storage_path: string }).storage_path, 600);
  return signed?.signedUrl ?? null;
}

/**
 * URL cùng origin để trình duyệt nạp font (FontFace không gửi được header
 * Authorization nên phải ký trong query, hạn 10 phút).
 */
export function fontProxyUrl(id: string, ttlSeconds = 600) {
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const sig = signFont(id, exp);
  return `/api/admin/fonts/${encodeURIComponent(id)}/file?exp=${exp}&sig=${sig}`;
}

function fontSignKey() {
  const secret = process.env.MAIL_MERGE_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  return createHash("sha256").update(`form-cme:font:${secret}`).digest();
}

export function signFont(id: string, exp: number) {
  return createHmac("sha256", fontSignKey()).update(`${id}:${exp}`).digest("base64url");
}

export function verifyFontSignature(id: string, exp: number, sig: string) {
  if (!Number.isFinite(exp) || exp * 1000 < Date.now()) return false;
  const expected = signFont(id, exp);
  if (expected.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

/** Tải nội dung font từ Storage để proxy trả về trình duyệt. */
export async function readCustomFont(admin: SupabaseClient, id: string) {
  const { data } = await admin
    .from("custom_fonts")
    .select("storage_path, family")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as { storage_path: string; family: string };
  const { data: blob, error } = await admin.storage.from(FONT_BUCKET).download(row.storage_path);
  if (error || !blob) return null;
  return { buffer: Buffer.from(await blob.arrayBuffer()), family: row.family };
}

const LOCAL_DIR = "/tmp/form-cme-custom-fonts";
const resolved = new Map<string, { file: string; family: string }>();

/**
 * Tải font tùy chỉnh về /tmp (một lần mỗi lambda) và trả đường dẫn cho sharp.
 * `id` là UUID trong bảng custom_fonts.
 */
export async function resolveCustomFontFile(admin: SupabaseClient, id: string) {
  const cached = resolved.get(id);
  if (cached) {
    try {
      await access(cached.file);
      return cached;
    } catch {
      resolved.delete(id);
    }
  }

  const { data } = await admin
    .from("custom_fonts")
    .select("storage_path, family")
    .eq("id", id)
    .maybeSingle();
  if (!data) return null;
  const row = data as { storage_path: string; family: string };

  const { data: blob, error } = await admin.storage.from(FONT_BUCKET).download(row.storage_path);
  if (error || !blob) return null;

  const ext = row.storage_path.split(".").pop() || "ttf";
  const file = path.join(LOCAL_DIR, `${id}.${ext}`);
  await mkdir(LOCAL_DIR, { recursive: true });
  await writeFile(file, Buffer.from(await blob.arrayBuffer()));
  const entry = { file, family: row.family };
  resolved.set(id, entry);
  return entry;
}
