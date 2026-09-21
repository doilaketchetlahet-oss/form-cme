"use client";

import { supabase } from "@/lib/supabase";
import type { Wish, WishSnapshot } from "./config";
import type { WishBroadcastPayload } from "./broadcast";

export type WishBroadcast = WishBroadcastPayload;

export function wishChannelName(code: string) {
  return `wish:${code.toUpperCase()}`;
}

/** Lấy ảnh chụp chương trình + danh sách lời chúc đã duyệt. */
export async function fetchWishSnapshot(code: string): Promise<WishSnapshot | null> {
  try {
    const res = await fetch(`/api/wish/${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as WishSnapshot;
  } catch {
    return null;
  }
}

/**
 * Nghe kênh Broadcast của chương trình. Callback nhận mọi sự kiện; vẫn nên gọi
 * fetchWishSnapshot() định kỳ để đồng bộ tuyệt đối với sổ cái.
 */
export function subscribeWish(
  code: string,
  onEvent: (event: WishBroadcast) => void,
): { close: () => void } {
  const channel = supabase.channel(wishChannelName(code), {
    config: { broadcast: { self: false } },
  });

  channel
    .on("broadcast", { event: "wish" }, (payload) => {
      const data = payload.payload as WishBroadcast | undefined;
      if (data && typeof data.type === "string") onEvent(data);
    })
    .subscribe();

  return {
    close() {
      void supabase.removeChannel(channel);
    },
  };
}

export type SubmitWishPayload = {
  symbol: string;
  content: string;
  drawing: Wish["drawing"];
  color: string;
  nickname: string;
  edge: Wish["edge"];
};

/** Tablet gửi lời chúc lên server (server là trọng tài + sổ cái). */
export async function submitWish(
  code: string,
  payload: SubmitWishPayload,
): Promise<{ ok: true; wish: Wish; moderated: boolean } | { ok: false; error: string }> {
  try {
    const res = await fetch(`/api/wish/${encodeURIComponent(code)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "submit", ...payload }),
    });
    const body = (await res.json().catch(() => null)) as
      | { wish?: Wish; moderated?: boolean; error?: string }
      | null;
    if (!res.ok || !body?.wish) {
      return { ok: false, error: body?.error ?? "failed" };
    }
    return { ok: true, wish: body.wish, moderated: body.moderated === true };
  } catch {
    return { ok: false, error: "network" };
  }
}
