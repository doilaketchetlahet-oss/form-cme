import { randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import { getGameModule } from "./catalog";

export const SHARE_TABLE = "game_project_shares";
export const MAX_SHARE_BYTES = 4_000_000;
export const validProjectId = (id: unknown): id is string => typeof id === "string" && /^[\w-]{1,128}$/.test(id);
export const validShareToken = (token: string) => /^[A-Za-z0-9_-]{32}$/.test(token);
export const newShareToken = () => randomBytes(24).toString("base64url");
export const shareResponse = (body: unknown, status = 200) => NextResponse.json(body, {
  status, headers: { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" },
});
export const sameShareOrigin = (request: Request) => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin;

export function shareAdmin() {
  return process.env.SUPABASE_SERVICE_ROLE_KEY ? createSupabaseAdmin() : null;
}

export interface SharedSnapshot {
  project: { id: string; moduleId: string; name: string; themeId: string; musicId?: string; config: Record<string, unknown> };
  themes: Record<string, unknown>[];
  assets: Record<string, unknown>[];
  audio: Record<string, unknown>[];
}
export interface ShareRow {
  id: string; user_id: string; project_id: string; module_id: string;
  play_token: string; edit_token: string | null; snapshot: SharedSnapshot;
  rev: number; updated_at: string;
}

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function text(value: unknown, limit = 200): value is string {
  return typeof value === "string" && value.length > 0 && value.length <= limit;
}
function safeTree(value: unknown, depth = 0): boolean {
  if (depth > 25) return false;
  if (Array.isArray(value)) return value.length <= 10_000 && value.every((v) => safeTree(v, depth + 1));
  if (object(value)) return Object.keys(value).length <= 10_000 && Object.entries(value).every(([key, v]) =>
    !["__proto__", "constructor", "prototype"].includes(key) && safeTree(v, depth + 1));
  if (typeof value === "string") return !/^\s*(?:blob|javascript|vbscript|file):/i.test(value);
  return value === null || typeof value === "boolean" || (typeof value === "number" && Number.isFinite(value));
}
function mediaUrl(value: unknown): value is string {
  return typeof value === "string" && value.length <= 4096 && /^(?:https?:\/\/|\/studio\/|\.\/assets\/|assets\/)/.test(value);
}
function audioUrl(value: unknown): value is string {
  return mediaUrl(value) || (typeof value === "string" && /^synth:(?:correct|wrong|click|pop|tick|whoosh|victory|fail|music-arcade|music-calm)$/.test(value));
}

/** Whitelist the selected game and its media; never publish the whole workspace. */
export function validateSnapshot(input: unknown): SharedSnapshot | null {
  if (!object(input) || !object(input.project) || !safeTree(input)) return null;
  const p = input.project;
  if (!validProjectId(p.id) || !text(p.moduleId) || !getGameModule(p.moduleId) || !text(p.name) ||
    !text(p.themeId) || !object(p.config) || (p.musicId !== undefined && !text(p.musicId))) return null;
  if (!Array.isArray(input.themes) || input.themes.length !== 1 || !object(input.themes[0])) return null;
  const theme = input.themes[0];
  if (theme.id !== p.themeId || !text(theme.name) || !object(theme.colors) ||
    !["bg", "surface", "surface2", "primary", "primaryFg", "accent", "accentFg", "text", "muted", "border", "success", "danger", "warning"].every((key) => text((theme.colors as Record<string, unknown>)[key], 300))) return null;
  if (!text(theme.badge, 100) || !text(theme.gradient, 1500) || !text(theme.shadow, 500) || !text(theme.font, 500) || !text(theme.fontDisplay, 500) ||
    typeof theme.radius !== "number" || theme.radius < 0 || theme.radius > 100 || typeof theme.radiusButton !== "number" || theme.radiusButton < 0 || theme.radiusButton > 100 ||
    !["solid", "soft", "outline"].includes(String(theme.buttonStyle)) || !["soft", "bouncy", "snappy"].includes(String(theme.animation))) return null;
  if (!Array.isArray(input.assets) || input.assets.length > 30 || !Array.isArray(input.audio) || input.audio.length > 30) return null;
  const assets: Record<string, unknown>[] = [];
  const audio: Record<string, unknown>[] = [];
  for (const asset of input.assets) {
    if (!object(asset) || !validProjectId(asset.id) || !text(asset.name) || !["image", "audio", "video"].includes(String(asset.kind)) || !mediaUrl(asset.src) || !text(asset.mime)) return null;
    assets.push({ id: asset.id, name: asset.name, kind: asset.kind, mime: asset.mime, src: asset.src,
      size: typeof asset.size === "number" ? asset.size : 0, width: asset.width, height: asset.height,
      workspaceId: "ws_shared", folder: "", tags: [], favorite: false, createdAt: 0 });
  }
  for (const clip of input.audio) {
    if (!object(clip) || !validProjectId(clip.id) || !text(clip.name) || !audioUrl(clip.src) ||
      !["correct", "wrong", "countdown", "victory", "click", "transition", "music"].includes(String(clip.category))) return null;
    audio.push({ id: clip.id, name: clip.name, src: clip.src, category: clip.category,
      builtin: clip.builtin === true, loop: clip.loop === true, volume: typeof clip.volume === "number" ? Math.max(0, Math.min(1, clip.volume)) : 1,
      workspaceId: "ws_shared", createdAt: 0 });
  }
  const snapshot: SharedSnapshot = {
    project: { id: p.id, moduleId: p.moduleId, name: p.name, themeId: p.themeId, ...(p.musicId ? { musicId: p.musicId as string } : {}), config: p.config },
    themes: [{ id: theme.id, name: theme.name, badge: theme.badge, builtin: theme.builtin === true, colors: theme.colors,
      gradient: theme.gradient, shadow: theme.shadow, font: theme.font, fontDisplay: theme.fontDisplay, radius: theme.radius,
      radiusButton: theme.radiusButton, buttonStyle: theme.buttonStyle, glow: theme.glow === true, animation: theme.animation }], assets, audio,
  };
  return Buffer.byteLength(JSON.stringify(snapshot), "utf8") <= MAX_SHARE_BYTES ? snapshot : null;
}

export async function readShareBody(request: Request): Promise<Record<string, unknown> | null> {
  if (Number(request.headers.get("content-length")) > MAX_SHARE_BYTES) return null;
  const raw = await request.text();
  if (Buffer.byteLength(raw, "utf8") > MAX_SHARE_BYTES) return null;
  try { const body = JSON.parse(raw); return object(body) ? body : null; } catch { return null; }
}

export async function findPublicShare(token: string): Promise<ShareRow | null> {
  if (!validShareToken(token)) return null;
  const admin = shareAdmin();
  if (!admin) throw new Error("unavailable");
  const { data, error } = await admin.from(SHARE_TABLE).select("*")
    .or(`play_token.eq.${token},edit_token.eq.${token}`).maybeSingle();
  if (error) throw new Error("share_read_failed");
  return data as ShareRow | null;
}

export function ownerShareInfo(row: ShareRow) {
  return { revision: row.rev, updatedAt: row.updated_at,
    playPath: `/games/shared/${row.play_token}`,
    editPath: row.edit_token ? `/games/shared/${row.edit_token}` : null };
}
