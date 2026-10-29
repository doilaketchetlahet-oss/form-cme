"use client";

import { fetchCustomFonts } from "./custom-fonts-client";
import { resolveOverlayFont } from "./overlay-fonts";
import type { InviteFontLoader } from "./invite-pdf-vector";

/** One byte cache per ZIP export, including private fonts via existing signed URLs. */
export function createInviteFontLoader(): InviteFontLoader {
  const cache = new Map<string, Promise<Uint8Array>>();
  return (id, bold) => {
    const key = `${id || "noto-sans"}:${bold}`;
    if (!cache.has(key)) cache.set(key, (async () => {
      let url: string;
      if (id?.startsWith("custom:")) {
        const custom = (await fetchCustomFonts()).find(font => font.id === id.slice(7));
        if (!custom?.url) throw new Error("Không tải được font tùy chỉnh. Vui lòng chọn lại font trước khi xuất PDF.");
        url = custom.url;
      } else {
        const font = resolveOverlayFont(id);
        url = `/fonts/${font.file}-${bold ? "Bold" : "Regular"}.ttf`;
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error("Không tải được font để nhúng vào PDF.");
      return new Uint8Array(await response.arrayBuffer());
    })());
    return cache.get(key)!;
  };
}
