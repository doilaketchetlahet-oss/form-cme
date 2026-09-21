import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

/** Phòng chơi "Lắc điện thoại - Đại bàng tung cánh". */
export type FlapRoom = {
  id: string;
  code: string;
  title: string;
  status: "lobby" | "countdown" | "running" | "paused" | "finished";
  score_mode: "total" | "average";
  teams: FlapTeam[];
  teams_locked: boolean;
  track_length: number;
  duration_sec: number;
  started_at: string | null;
  ended_at: string | null;
  round: number;
  owner_email: string | null;
  created_at: string;
  updated_at: string;
};

export type FlapTeam = {
  id: string;
  name: string;
  color: string;
  capacity?: number | null;
};

export type FlapPlayer = {
  id: string;
  room_id: string;
  team_id: string;
  nickname: string | null;
  score: number;
  sensor_ok: boolean;
  active: boolean;
  last_seen_at: string;
};

export type TeamStanding = {
  team_id: string;
  name: string;
  color: string;
  total: number;
  players: number;
  average: number;
  /** Giá trị dùng để xếp hạng theo score_mode. */
  rankValue: number;
  /** Tiến độ 0..1 trên đường đua. */
  progress: number;
};

export const TEAM_PALETTE = [
  "#0ea5e9",
  "#f59e0b",
  "#10b981",
  "#8b5cf6",
  "#ef4444",
  "#14b8a6",
  "#f43f5e",
  "#84cc16",
];

/** Trần điểm mỗi lần gửi và mỗi giây cho một thiết bị (chống gian lận). */
export const MAX_SCORE_PER_BATCH = 40;
export const MAX_SCORE_PER_SECOND = 12;
export const MAX_TOTAL_SCORE = 100_000;

export const MIN_TEAMS = 2;
export const MAX_TEAMS = 8;

export function generateRoomCode(): string {
  // Bỏ các ký tự dễ nhầm khi đọc/đánh máy.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let out = "";
  for (let i = 0; i < 6; i += 1) out += alphabet[crypto.randomInt(alphabet.length)];
  return out;
}

export function generateSessionToken(): string {
  return crypto.randomBytes(24).toString("base64url");
}

export function hashToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex");
}

export function normalizeTeams(input: unknown): FlapTeam[] {
  if (!Array.isArray(input)) return [];
  const seen = new Set<string>();
  const out: FlapTeam[] = [];
  for (const item of input) {
    if (!item || typeof item !== "object") continue;
    const row = item as { id?: unknown; name?: unknown; color?: unknown; capacity?: unknown };
    const name = typeof row.name === "string" ? row.name.trim().slice(0, 40) : "";
    if (!name) continue;
    const id =
      typeof row.id === "string" && row.id.trim()
        ? row.id.trim().slice(0, 40)
        : `team-${out.length + 1}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const color =
      typeof row.color === "string" && /^#[0-9a-fA-F]{6}$/.test(row.color)
        ? row.color
        : TEAM_PALETTE[out.length % TEAM_PALETTE.length];
    const capacity =
      typeof row.capacity === "number" && Number.isFinite(row.capacity) && row.capacity > 0
        ? Math.min(Math.floor(row.capacity), 9999)
        : null;
    out.push({ id, name, color, capacity });
  }
  return out.slice(0, MAX_TEAMS);
}

export function clampRoomSettings(input: { track_length?: unknown; duration_sec?: unknown; score_mode?: unknown }) {
  const track = Number(input.track_length);
  const duration = Number(input.duration_sec);
  const mode = input.score_mode === "total" ? "total" : "average";
  return {
    track_length: Number.isFinite(track) ? Math.max(100, Math.min(Math.floor(track), 50_000)) : 1000,
    duration_sec: Number.isFinite(duration) ? Math.max(10, Math.min(Math.floor(duration), 600)) : 60,
    score_mode: mode as "total" | "average",
  };
}

/** Xếp hạng đội từ danh sách người chơi. */
export function buildStandings(
  teams: FlapTeam[],
  players: Pick<FlapPlayer, "team_id" | "score" | "active">[],
  scoreMode: "total" | "average",
  trackLength: number,
): TeamStanding[] {
  const map = new Map<string, { total: number; players: number }>();
  for (const team of teams) map.set(team.id, { total: 0, players: 0 });
  for (const player of players) {
    if (!player.active) continue;
    const bucket = map.get(player.team_id);
    if (!bucket) continue;
    bucket.total += player.score;
    bucket.players += 1;
  }

  const standings = teams.map((team) => {
    const bucket = map.get(team.id) ?? { total: 0, players: 0 };
    const average = bucket.players > 0 ? bucket.total / bucket.players : 0;
    return {
      team_id: team.id,
      name: team.name,
      color: team.color,
      total: bucket.total,
      players: bucket.players,
      average: Math.round(average * 10) / 10,
      rankValue: scoreMode === "average" ? average : bucket.total,
      progress: 0,
    };
  });

  const peak = Math.max(1, ...standings.map((s) => s.rankValue));
  for (const row of standings) {
    // Tiến độ theo đội dẫn đầu (để đội về đích đúng khi track_length bị vượt).
    row.progress = Math.min(1, row.rankValue / Math.max(trackLength, peak));
  }

  return standings.sort((a, b) => b.rankValue - a.rankValue);
}

/** Tìm phòng theo mã vào (không phân biệt hoa thường). */
export async function findRoomByCode(admin: SupabaseClient, code: string): Promise<FlapRoom | null> {
  const clean = code.trim().toUpperCase().slice(0, 12);
  if (!clean) return null;
  const { data } = await admin.from("flap_rooms").select("*").eq("code", clean).maybeSingle();
  return (data as FlapRoom) ?? null;
}

export async function loadPlayers(admin: SupabaseClient, roomId: string): Promise<FlapPlayer[]> {
  const { data } = await admin
    .from("flap_players")
    .select("id, room_id, team_id, nickname, score, sensor_ok, active, last_seen_at")
    .eq("room_id", roomId);
  return (data ?? []) as FlapPlayer[];
}
