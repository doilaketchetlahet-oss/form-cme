import type { Wish } from "./config";

/**
 * Phát sự kiện sang kênh Broadcast của chương trình.
 *
 * Dùng HTTP broadcast API của Supabase (REST) — gọi được từ server route,
 * khác với `channel.send()` của client SDK vốn cần một websocket đang mở.
 *
 * Đây chỉ là kênh hiển thị cho mượt: nếu lỗi thì LED vẫn đồng bộ bằng nhịp
 * polling nên không mất lời chúc nào.
 */
export type WishBroadcastPayload =
  | { type: "wish"; wish: Wish }
  | { type: "settings"; settings: unknown; title?: string; subtitle?: string; status?: string }
  | { type: "moderate"; wishId: string; status: Wish["status"] }
  | { type: "spotlight"; wishId: string }
  | { type: "absorb-all" }
  | { type: "clear" };

export function wishTopic(code: string) {
  return `wish:${code.toUpperCase()}`;
}

export async function broadcastWish(code: string, payload: WishBroadcastPayload): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) return false;

  try {
    const res = await fetch(`${url}/realtime/v1/api/broadcast`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        messages: [
          {
            topic: wishTopic(code),
            event: "wish",
            payload,
          },
        ],
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      console.warn("wish broadcast failed:", res.status, (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (error) {
    console.warn("wish broadcast error:", error instanceof Error ? error.message : error);
    return false;
  }
}
