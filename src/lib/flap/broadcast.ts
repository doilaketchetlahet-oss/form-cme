import type { TeamStanding } from "./race";

/**
 * Phát sự kiện sang kênh Broadcast của phòng.
 *
 * Dùng HTTP broadcast API của Supabase (REST) — gọi được từ server route,
 * khác với `channel.send()` của client SDK vốn cần một websocket đang mở.
 *
 * Đây chỉ là kênh hiển thị cho mượt: nếu lỗi thì LED/điện thoại vẫn đồng bộ
 * bằng nhịp polling 2 giây nên không ảnh hưởng kết quả trận đấu.
 */
export type FlapBroadcastPayload =
  | { type: "standings"; standings: TeamStanding[] }
  | { type: "state"; status: string; startedAt?: string | null; round?: number }
  | { type: "reset" };

export async function broadcastFlap(code: string, payload: FlapBroadcastPayload): Promise<boolean> {
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
            topic: `flap:${code.toUpperCase()}`,
            event: "flap",
            payload,
          },
        ],
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!res.ok) {
      console.warn("flap broadcast failed:", res.status, (await res.text()).slice(0, 200));
      return false;
    }
    return true;
  } catch (error) {
    console.warn("flap broadcast error:", error instanceof Error ? error.message : error);
    return false;
  }
}
