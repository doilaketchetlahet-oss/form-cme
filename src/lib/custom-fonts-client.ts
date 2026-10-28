"use client";

import { supabase } from "@/lib/supabase";

export type ClientCustomFont = {
  id: string;
  family: string;
  weight: "regular" | "bold";
  url: string | null;
  hasVietnamese: boolean;
};

let cache: { at: number; data: ClientCustomFont[] } | null = null;
const CACHE_MS = 30_000;

/** Danh sách font tải lên (kèm URL đã ký, hạn 10 phút). Cache ngắn để tránh gọi lặp. */
export async function fetchCustomFonts(force = false): Promise<ClientCustomFont[]> {
  if (!force && cache && Date.now() - cache.at < CACHE_MS) return cache.data;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) return [];
  try {
    const res = await fetch("/api/admin/fonts", {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    const body = await res.json().catch(() => null);
    if (!res.ok || !body?.ok) return [];
    const fonts = (body.fonts ?? []) as ClientCustomFont[];
    cache = { at: Date.now(), data: fonts };
    return fonts;
  } catch {
    return [];
  }
}

export function invalidateCustomFonts() {
  cache = null;
}

const loaded = new Set<string>();

/** Nạp font tùy chỉnh vào document để canvas/DOM hiển thị đúng. */
export async function ensureCustomFontFace(font: ClientCustomFont): Promise<string | null> {
  if (!font.url) return null;
  const key = `${font.id}-${font.weight}`;
  if (loaded.has(key)) return font.family;
  try {
    const face = new FontFace(font.family, `url(${font.url})`, {
      weight: font.weight === "bold" ? "700" : "400",
    });
    await face.load();
    document.fonts.add(face);
    loaded.add(key);
    return font.family;
  } catch {
    return null;
  }
}

/** Nạp tất cả font tùy chỉnh (dùng cho khung thiết kế). */
export async function ensureAllCustomFonts(fonts: ClientCustomFont[]) {
  for (const font of fonts) await ensureCustomFontFace(font);
}
