"use client";

import { supabase } from "@/lib/supabase";
import type { FlapRoom, TeamStanding } from "./race";

/** Kênh Broadcast dùng chung cho phòng: LED + MC + điện thoại cùng nghe. */
export function flapChannelName(roomCode: string) {
  return `flap:${roomCode.toUpperCase()}`;
}

export type FlapRoomSnapshot = {
  room: Pick<
    FlapRoom,
    | "id"
    | "code"
    | "title"
    | "status"
    | "score_mode"
    | "teams"
    | "teams_locked"
    | "track_length"
    | "duration_sec"
    | "started_at"
    | "ended_at"
    | "round"
  >;
  standings: TeamStanding[];
  playerCount: number;
};

/** Lấy ảnh chụp trạng thái phòng (dùng khi mới mở hoặc khi reconnect). */
export async function fetchRoomSnapshot(code: string): Promise<FlapRoomSnapshot | null> {
  try {
    const res = await fetch(`/api/flap/${encodeURIComponent(code)}`, { cache: "no-store" });
    if (!res.ok) return null;
    return (await res.json()) as FlapRoomSnapshot;
  } catch {
    return null;
  }
}

export type FlapBroadcast =
  | { type: "state"; status: FlapRoom["status"]; startedAt?: string | null; round?: number }
  | { type: "standings"; standings: TeamStanding[] }
  | { type: "reset" };

/**
 * Nghe kênh phòng. Callback nhận mọi sự kiện; nên gọi fetchRoomSnapshot()
 * khi nhận "state"/"reset"/"standings" lần đầu để đồng bộ tuyệt đối với sổ cái.
 */
export function subscribeRoom(
  roomCode: string,
  onEvent: (event: FlapBroadcast) => void,
): { send: (event: FlapBroadcast) => void; close: () => void } {
  const channel = supabase.channel(flapChannelName(roomCode), {
    config: { broadcast: { self: false } },
  });

  channel
    .on("broadcast", { event: "flap" }, (payload) => {
      const data = payload.payload as FlapBroadcast | undefined;
      if (data && typeof data.type === "string") onEvent(data);
    })
    .subscribe();

  return {
    send(event) {
      void channel.send({ type: "broadcast", event: "flap", payload: event });
    },
    close() {
      void supabase.removeChannel(channel);
    },
  };
}
