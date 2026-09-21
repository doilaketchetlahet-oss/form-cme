import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { authorizeAdminApi } from "@/lib/server/admin-api";
import {
  authorizePublicBoothWrite,
  boothPasscodeLookup,
  checkPublicBoothRateLimit,
  createBoothServiceClient,
  hashBoothPasscode,
  verifyBoothPasscode,
} from "@/lib/server/booth-public-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DEFAULT_POOLS = [
  { code: "DIAMOND", name: "Kim cương", color: "#38bdf8", sort_order: 10 },
  { code: "PLATINUM", name: "Bạch kim", color: "#94a3b8", sort_order: 20 },
  { code: "GOLD", name: "Vàng", color: "#f59e0b", sort_order: 30 },
  { code: "SILVER", name: "Bạc", color: "#64748b", sort_order: 40 },
  { code: "BRONZE", name: "Đồng", color: "#b45309", sort_order: 50 },
] as const;

const CUSTOM_POOL_COLORS = ["#38bdf8", "#8b5cf6", "#f59e0b", "#64748b", "#b45309", "#10b981", "#ec4899", "#0ea5e9"];

function jsonError(error: string, status = 400) {
  return NextResponse.json({ ok: false, error }, { status });
}

function isMissingTable(error: { code?: string; message?: string } | null | undefined) {
  const message = error?.message?.toLowerCase() ?? "";
  return error?.code === "42P01"
    || error?.code === "PGRST205"
    || message.includes("could not find the table")
    || message.includes("does not exist");
}

function databaseError(error: { code?: string; message?: string } | null | undefined) {
  if (isMissingTable(error)) {
    return "Chưa có bảng bốc thăm gian hàng. Hãy chạy supabase/booth-draw.sql trong Supabase SQL Editor.";
  }
  const message = error?.message ?? "Thao tác database thất bại.";
  if (message.includes("booth_companies_session_id_name_key")) return "Công ty này đã có trong phiên.";
  if (message.includes("booth_zones_session_id_booth_code_key")) return "Số gian hàng này đã tồn tại.";
  if (message.includes("NO_AVAILABLE_BOOTHS")) return "Pool này không còn gian hàng trống.";
  if (message.includes("SESSION_FINALIZED")) return "Phiên đã khóa kết quả.";
  if (message.includes("POOL_MISMATCH")) return "Chỉ được đổi hoặc chuyển gian trong cùng pool.";
  if (message.includes("SAME_COMPANY")) return "Hãy chọn hai công ty khác nhau.";
  if (message.includes("BOOTH_OCCUPIED")) return "Gian hàng đích đã có công ty.";
  if (message.includes("ASSIGNMENT_NOT_FOUND")) return "Công ty chưa có gian hàng để trao đổi.";
  if (message.includes("COMPANY_NOT_FOUND")) return "Không tìm thấy công ty trong phiên này.";
  if (message.includes("BOOTH_NOT_FOUND")) return "Không tìm thấy gian hàng trong phiên này.";
  if (message.includes("INVALID_SIZE")) return "Kích thước gian hàng không hợp lệ.";
  if (message.includes("violates foreign key constraint")) return "Dữ liệu đã được sử dụng và không thể xóa.";
  if (message.includes("access_mode") || message.includes("expires_at") || message.includes("passcode_hash") || message.includes("passcode_lookup") || message.includes("share_token") || message.includes("starts_at")) {
    return "Chưa cập nhật chức năng phiên công khai. Hãy chạy supabase/booth-draw-public.sql.";
  }
  return message;
}

function cleanText(value: unknown, max = 160) {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

function cleanColor(value: unknown) {
  const color = cleanText(value, 20);
  return /^#[0-9a-f]{6}$/i.test(color) ? color : "#0ea5e9";
}

function clampNumber(value: unknown, min: number, max: number, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(min, Math.min(max, number)) : fallback;
}

function cleanDateTime(value: unknown) {
  if (value === null || value === "") return null;
  if (typeof value !== "string") return undefined;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function poolCode(name: string, index: number, used: Set<string>) {
  const base = name
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "D")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24) || `POOL_${index + 1}`;
  let code = base;
  let suffix = 2;
  while (used.has(code)) code = `${base.slice(0, 20)}_${suffix++}`;
  used.add(code);
  return code;
}

export async function GET(request: Request) {
  const sessionId = new URL(request.url).searchParams.get("sessionId")?.trim();
  const auth = await authorizeAdminApi(request);
  if ("error" in auth) return loadPublicBoothDraw(sessionId);

  const [eventsResult, sessionsResult] = await Promise.all([
    auth.service.from("events").select("id, name, event_date").order("event_date", { ascending: false, nullsFirst: false }),
    auth.service
      .from("booth_draw_sessions")
      .select("id, event_id, name, status, map_path, starts_at, ends_at, venue, public_note, share_token, share_enabled, created_at, updated_at")
      .eq("access_mode", "admin")
      .order("created_at", { ascending: false }),
  ]);

  if (sessionsResult.error) return jsonError(databaseError(sessionsResult.error), 500);
  if (eventsResult.error) return jsonError(databaseError(eventsResult.error), 500);

  const base = {
    ok: true,
    events: eventsResult.data ?? [],
    sessions: sessionsResult.data ?? [],
    role: auth.role,
  };
  if (!sessionId) return NextResponse.json(base);

  const session = (sessionsResult.data ?? []).find((row) => row.id === sessionId);
  if (!session) return jsonError("Không tìm thấy phiên bốc thăm.", 404);

  const [pools, companies, booths, assignments, results, exchanges] = await Promise.all([
    auth.service.from("booth_pools").select("*").eq("session_id", sessionId).order("sort_order"),
    auth.service.from("booth_companies").select("*").eq("session_id", sessionId).order("draw_order"),
    auth.service.from("booth_zones").select("*").eq("session_id", sessionId).order("booth_code"),
    auth.service.from("booth_assignments").select("*").eq("session_id", sessionId),
    auth.service.from("booth_draw_results").select("*").eq("session_id", sessionId).order("drawn_at"),
    auth.service.from("booth_exchange_logs").select("*").eq("session_id", sessionId).order("created_at", { ascending: false }),
  ]);

  const firstError = [pools.error, companies.error, booths.error, assignments.error, results.error, exchanges.error].find(Boolean);
  if (firstError) return jsonError(databaseError(firstError), 500);

  let mapUrl: string | null = null;
  if (session.map_path) {
    const { data } = await auth.service.storage.from("booth-maps").createSignedUrl(session.map_path, 60 * 60);
    mapUrl = data?.signedUrl ?? null;
  }

  return NextResponse.json({
    ...base,
    current: {
      session,
      mapUrl,
      pools: pools.data ?? [],
      companies: companies.data ?? [],
      booths: booths.data ?? [],
      assignments: assignments.data ?? [],
      results: results.data ?? [],
      exchanges: exchanges.data ?? [],
    },
  });
}

async function loadPublicBoothDraw(sessionId?: string) {
  if (!sessionId) {
    return NextResponse.json({ ok: true, events: [], sessions: [], role: "viewer", publicMode: true });
  }
  const service = createBoothServiceClient();
  if (!service) return jsonError("Thiếu cấu hình Supabase server.", 500);
  const { data: session, error: sessionError } = await service
    .from("booth_draw_sessions")
    .select("id, event_id, name, status, map_path, access_mode, expires_at, starts_at, ends_at, venue, public_note, share_token, share_enabled, created_at, updated_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (sessionError) return jsonError(databaseError(sessionError), 500);
  if (!session || session.access_mode !== "public") return jsonError("Không tìm thấy phiên công khai.", 404);
  if (!session.expires_at || new Date(session.expires_at).getTime() <= Date.now()) {
    return jsonError("Phiên miễn phí đã hết hạn và đang chờ xoá.", 410);
  }

  const [pools, companies, booths, assignments, results, exchanges] = await Promise.all([
    service.from("booth_pools").select("*").eq("session_id", sessionId).order("sort_order"),
    service.from("booth_companies").select("*").eq("session_id", sessionId).order("draw_order"),
    service.from("booth_zones").select("*").eq("session_id", sessionId).order("booth_code"),
    service.from("booth_assignments").select("*").eq("session_id", sessionId),
    service.from("booth_draw_results").select("*").eq("session_id", sessionId).order("drawn_at"),
    service.from("booth_exchange_logs").select("*").eq("session_id", sessionId).order("created_at", { ascending: false }),
  ]);
  const firstError = [pools.error, companies.error, booths.error, assignments.error, results.error, exchanges.error].find(Boolean);
  if (firstError) return jsonError(databaseError(firstError), 500);

  let mapUrl: string | null = null;
  if (session.map_path) {
    const { data } = await service.storage.from("booth-maps").createSignedUrl(session.map_path, 60 * 60);
    mapUrl = data?.signedUrl ?? null;
  }
  return NextResponse.json({
    ok: true,
    events: [],
    sessions: [session],
    role: "viewer",
    publicMode: true,
    current: {
      session,
      mapUrl,
      pools: pools.data ?? [],
      companies: companies.data ?? [],
      booths: booths.data ?? [],
      assignments: assignments.data ?? [],
      results: results.data ?? [],
      exchanges: exchanges.data ?? [],
    },
  });
}

async function createPublicSession(request: Request, payload: Record<string, unknown>) {
  if (!checkPublicBoothRateLimit(request, "create-session", 5, 60 * 60 * 1000)) {
    return jsonError("Bạn đã tạo quá nhiều phiên. Vui lòng thử lại sau.", 429);
  }
  const service = createBoothServiceClient();
  if (!service) return jsonError("Thiếu cấu hình Supabase server.", 500);
  const name = cleanText(payload.name) || "Bốc thăm gian hàng";
  const passcode = cleanText(payload.passcode, 64);
  if (passcode.length < 6) return jsonError("Passcode cần có ít nhất 6 ký tự.");
  const passcodeLookup = boothPasscodeLookup(passcode);

  const { data: existingSession, error: existingError } = await service
    .from("booth_draw_sessions")
    .select("id, expires_at, map_path")
    .eq("passcode_lookup", passcodeLookup)
    .maybeSingle();
  if (existingError) return jsonError(databaseError(existingError), 500);
  if (existingSession) {
    if (existingSession.expires_at && new Date(existingSession.expires_at).getTime() > Date.now()) {
      return jsonError("Passcode này đang được dùng cho một dự án khác. Hãy chọn passcode khác hoặc dùng nó để mở lại dự án.", 409);
    }
    if (existingSession.map_path) await service.storage.from("booth-maps").remove([existingSession.map_path]);
    await service.from("booth_draw_sessions").delete().eq("id", existingSession.id);
  }

  const seenPoolNames = new Set<string>();
  const customPoolNames = Array.isArray(payload.poolNames)
    ? payload.poolNames.map((value) => cleanText(value, 80)).filter((poolName) => {
      const normalized = poolName.toLocaleLowerCase("vi");
      if (!poolName || seenPoolNames.has(normalized)) return false;
      seenPoolNames.add(normalized);
      return true;
    }).slice(0, 20)
    : [];
  if (customPoolNames.length === 0) return jsonError("Nhập ít nhất một pool.");

  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data: session, error } = await service
    .from("booth_draw_sessions")
    .insert({
      event_id: null,
      name,
      access_mode: "public",
      passcode_hash: hashBoothPasscode(passcode),
      passcode_lookup: passcodeLookup,
      expires_at: expiresAt,
      created_by: "public",
    })
    .select("id")
    .single();
  if (error || !session) return jsonError(databaseError(error), 500);

  const usedCodes = new Set<string>();
  const pools = customPoolNames.map((poolName, index) => ({
    session_id: session.id,
    code: poolCode(poolName, index, usedCodes),
    name: poolName,
    color: CUSTOM_POOL_COLORS[index % CUSTOM_POOL_COLORS.length],
    sort_order: (index + 1) * 10,
  }));
  const { error: poolError } = await service.from("booth_pools").insert(pools);
  if (poolError) {
    await service.from("booth_draw_sessions").delete().eq("id", session.id);
    return jsonError(databaseError(poolError), 500);
  }
  return NextResponse.json({ ok: true, id: session.id, expiresAt });
}

async function findPublicSession(request: Request, payload: Record<string, unknown>) {
  if (!checkPublicBoothRateLimit(request, "recover-session", 8, 15 * 60 * 1000)) {
    return jsonError("Bạn đã thử quá nhiều lần. Vui lòng đợi 15 phút.", 429);
  }
  const passcode = cleanText(payload.passcode, 64);
  if (passcode.length < 6) return jsonError("Nhập passcode có ít nhất 6 ký tự.");
  const service = createBoothServiceClient();
  if (!service) return jsonError("Thiếu cấu hình Supabase server.", 500);

  const lookup = boothPasscodeLookup(passcode);
  const now = new Date().toISOString();
  const { data: direct, error: directError } = await service
    .from("booth_draw_sessions")
    .select("id, passcode_hash, passcode_lookup, expires_at")
    .eq("access_mode", "public")
    .eq("passcode_lookup", lookup)
    .gt("expires_at", now)
    .maybeSingle();
  if (directError) return jsonError(databaseError(directError), 500);

  let match = direct;
  if (match && !verifyBoothPasscode(passcode, match.passcode_hash)) match = null;

  // Older public sessions predate the deterministic lookup. Scan only recent,
  // still-active rows once, verify the strong scrypt hash, then upgrade the row.
  if (!match) {
    const { data: candidates, error } = await service
      .from("booth_draw_sessions")
      .select("id, passcode_hash, passcode_lookup, expires_at")
      .eq("access_mode", "public")
      .gt("expires_at", now)
      .order("updated_at", { ascending: false })
      .limit(50);
    if (error) return jsonError(databaseError(error), 500);
    const matches = (candidates ?? []).filter((candidate) => verifyBoothPasscode(passcode, candidate.passcode_hash));
    if (matches.length > 1) {
      return jsonError("Có nhiều dự án cũ dùng cùng passcode. Hãy mở bằng link quản lý ban đầu rồi đổi sang passcode riêng.", 409);
    }
    match = matches[0] ?? null;
  }

  if (!match) return jsonError("Không tìm thấy dự án còn hiệu lực với passcode này.", 404);
  if (match.passcode_lookup !== lookup) {
    const { error } = await service.from("booth_draw_sessions").update({ passcode_lookup: lookup }).eq("id", match.id);
    if (error) return jsonError("Passcode này đang trùng với một dự án khác. Hãy mở bằng link quản lý ban đầu.", 409);
  }
  return NextResponse.json({ ok: true, id: match.id, expiresAt: match.expires_at });
}

export async function POST(request: Request) {
  const payload = await request.json().catch(() => null) as Record<string, unknown> | null;
  const action = cleanText(payload?.action, 40);
  if (!payload || !action) return jsonError("Dữ liệu không hợp lệ.");

  if (action === "create_public_session") return createPublicSession(request, payload);
  if (action === "find_public_session") return findPublicSession(request, payload);

  const adminAuth = await authorizeAdminApi(request, true);
  let auth: { email: string; service: SupabaseClient };
  let publicWrite = false;
  if ("error" in adminAuth) {
    const sessionId = cleanText(payload.sessionId, 80);
    const passcode = cleanText(payload.passcode, 64);
    const service = createBoothServiceClient();
    if (!service) return jsonError("Thiếu cấu hình Supabase server.", 500);
    if (!sessionId || !passcode) return jsonError("Nhập passcode để lưu thay đổi.", 401);
    const publicAccess = await authorizePublicBoothWrite(request, service, sessionId, passcode);
    if ("error" in publicAccess) return jsonError(publicAccess.error, publicAccess.status);
    auth = { email: "public-passcode", service };
    publicWrite = true;
  } else {
    auth = adminAuth;
  }

  if (action === "create_session") {
    const eventId = cleanText(payload.eventId, 80);
    const name = cleanText(payload.name) || "Bốc thăm gian hàng";
    const seenPoolNames = new Set<string>();
    const customPoolNames = Array.isArray(payload.poolNames)
      ? payload.poolNames.map((value) => cleanText(value, 80)).filter((poolName) => {
        const normalized = poolName.toLocaleLowerCase("vi");
        if (!poolName || seenPoolNames.has(normalized)) return false;
        seenPoolNames.add(normalized);
        return true;
      }).slice(0, 20)
      : [];
    if (!eventId) return jsonError("Chọn sự kiện trước.");

    const { data: event } = await auth.service.from("events").select("id").eq("id", eventId).maybeSingle();
    if (!event) return jsonError("Không tìm thấy sự kiện.", 404);

    const { data: session, error } = await auth.service
      .from("booth_draw_sessions")
      .insert({ event_id: eventId, name, created_by: auth.email })
      .select("id")
      .single();
    if (error || !session) return jsonError(databaseError(error), 500);

    const usedCodes = new Set<string>();
    const pools = customPoolNames.length > 0
      ? customPoolNames.map((poolName, index) => ({
        code: poolCode(poolName, index, usedCodes),
        name: poolName,
        color: CUSTOM_POOL_COLORS[index % CUSTOM_POOL_COLORS.length],
        sort_order: (index + 1) * 10,
      }))
      : DEFAULT_POOLS;
    const { error: poolError } = await auth.service.from("booth_pools").insert(
      pools.map((pool) => ({ ...pool, session_id: session.id })),
    );
    if (poolError) {
      await auth.service.from("booth_draw_sessions").delete().eq("id", session.id);
      return jsonError(databaseError(poolError), 500);
    }
    return NextResponse.json({ ok: true, id: session.id });
  }

  const sessionId = cleanText(payload.sessionId, 80);
  if (!sessionId) return jsonError("Thiếu mã phiên bốc thăm.");

  const { data: currentSession, error: currentSessionError } = await auth.service
    .from("booth_draw_sessions")
    .select("id, status, starts_at, ends_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (currentSessionError) return jsonError(databaseError(currentSessionError), 500);
  if (!currentSession) return jsonError("Không tìm thấy phiên bốc thăm.", 404);
  if (currentSession.status === "finalized" && !["update_session", "delete_session"].includes(action)) {
    return jsonError("Phiên đã khóa kết quả. Hãy mở lại trước khi chỉnh sửa.", 409);
  }

  if (action === "update_session") {
    const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (typeof payload.name === "string") patch.name = cleanText(payload.name) || "Bốc thăm gian hàng";
    if (["draft", "active", "exchange", "finalized"].includes(String(payload.status))) patch.status = payload.status;
    const startsAt = cleanDateTime(payload.startsAt);
    const endsAt = cleanDateTime(payload.endsAt);
    if (payload.startsAt !== undefined) {
      if (startsAt === undefined) return jsonError("Thời gian bắt đầu không hợp lệ.");
      patch.starts_at = startsAt;
    }
    if (payload.endsAt !== undefined) {
      if (endsAt === undefined) return jsonError("Thời gian kết thúc không hợp lệ.");
      patch.ends_at = endsAt;
    }
    const nextStart = payload.startsAt !== undefined ? startsAt : currentSession.starts_at;
    const nextEnd = payload.endsAt !== undefined ? endsAt : currentSession.ends_at;
    if (nextStart && nextEnd && new Date(nextEnd).getTime() < new Date(nextStart).getTime()) {
      return jsonError("Thời gian kết thúc phải sau thời gian bắt đầu.");
    }
    if (typeof payload.venue === "string") patch.venue = cleanText(payload.venue, 240) || null;
    if (typeof payload.publicNote === "string") patch.public_note = cleanText(payload.publicNote, 2000) || null;
    if (typeof payload.shareEnabled === "boolean") patch.share_enabled = payload.shareEnabled;
    const { error } = await auth.service.from("booth_draw_sessions").update(patch).eq("id", sessionId);
    if (error) return jsonError(databaseError(error), 500);
    return NextResponse.json({ ok: true });
  }

  if (action === "delete_session") {
    const { data: row } = await auth.service.from("booth_draw_sessions").select("map_path").eq("id", sessionId).maybeSingle();
    const { error } = await auth.service.from("booth_draw_sessions").delete().eq("id", sessionId);
    if (error) return jsonError(databaseError(error), 500);
    if (row?.map_path) await auth.service.storage.from("booth-maps").remove([row.map_path]);
    return NextResponse.json({ ok: true });
  }

  if (action === "create_pool") {
    const name = cleanText(payload.name, 80);
    if (!name) return jsonError("Nhập tên pool.");
    const { data: existingPools, error: existingPoolError } = await auth.service
      .from("booth_pools")
      .select("code, name")
      .eq("session_id", sessionId);
    if (existingPoolError) return jsonError(databaseError(existingPoolError), 500);
    if (publicWrite && (existingPools?.length ?? 0) >= 20) return jsonError("Phiên miễn phí hỗ trợ tối đa 20 pool.");
    if ((existingPools ?? []).some((pool) => pool.name.trim().toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"))) {
      return jsonError("Tên pool này đã tồn tại.");
    }
    const usedCodes = new Set((existingPools ?? []).map((pool) => pool.code));
    const code = poolCode(cleanText(payload.code, 30) || name, existingPools?.length ?? 0, usedCodes);
    const { data, error } = await auth.service.from("booth_pools").insert({
      session_id: sessionId,
      name,
      code,
      color: cleanColor(payload.color),
      sort_order: Math.round(clampNumber(payload.sortOrder, 0, 9999, 100)),
    }).select("id").single();
    if (error) return jsonError(databaseError(error), 500);
    return NextResponse.json({ ok: true, id: data.id });
  }

  if (action === "update_pool") {
    const poolId = cleanText(payload.poolId, 80);
    const name = cleanText(payload.name, 80);
    if (!poolId || !name) return jsonError("Thiếu pool hoặc tên pool.");
    const { data: otherPools, error: otherPoolError } = await auth.service
      .from("booth_pools")
      .select("code, name")
      .eq("session_id", sessionId)
      .neq("id", poolId);
    if (otherPoolError) return jsonError(databaseError(otherPoolError), 500);
    if ((otherPools ?? []).some((pool) => pool.name.trim().toLocaleLowerCase("vi") === name.toLocaleLowerCase("vi"))) {
      return jsonError("Tên pool này đã tồn tại.");
    }
    const usedCodes = new Set((otherPools ?? []).map((pool) => pool.code));
    const { error } = await auth.service.from("booth_pools").update({
      name,
      code: poolCode(name, otherPools?.length ?? 0, usedCodes),
      color: cleanColor(payload.color),
      sort_order: Math.round(clampNumber(payload.sortOrder, 0, 9999, 100)),
    }).eq("id", poolId).eq("session_id", sessionId);
    if (error) return jsonError(databaseError(error), 500);
    return NextResponse.json({ ok: true });
  }

  if (action === "delete_pool") {
    const poolId = cleanText(payload.poolId, 80);
    const { error } = await auth.service.from("booth_pools").delete().eq("id", poolId).eq("session_id", sessionId);
    if (error) return jsonError(databaseError(error), 500);
    return NextResponse.json({ ok: true });
  }

  if (action === "bulk_add_companies") {
    const poolId = cleanText(payload.poolId, 80);
    const seenNames = new Set<string>();
    const names = Array.isArray(payload.names)
      ? payload.names.map((value) => cleanText(value, 180)).filter((name) => {
        const normalized = name.toLocaleLowerCase("vi");
        if (!name || seenNames.has(normalized)) return false;
        seenNames.add(normalized);
        return true;
      }).slice(0, 500)
      : [];
    if (!poolId || names.length === 0) return jsonError("Chọn pool và nhập danh sách công ty.");
    if (!(await poolBelongsToSession(auth.service, poolId, sessionId))) return jsonError("Pool không thuộc phiên này.");

    const { data: existing } = await auth.service.from("booth_companies").select("name").eq("session_id", sessionId);
    const existingNames = new Set((existing ?? []).map((row) => row.name.trim().toLocaleLowerCase("vi")));
    const fresh = names.filter((name) => !existingNames.has(name.toLocaleLowerCase("vi")));
    const { count } = await auth.service.from("booth_companies").select("id", { count: "exact", head: true }).eq("session_id", sessionId);
    if (publicWrite && (count ?? 0) + fresh.length > 500) return jsonError("Phiên miễn phí hỗ trợ tối đa 500 công ty.");
    if (fresh.length > 0) {
      const { error } = await auth.service.from("booth_companies").insert(
        fresh.map((name, index) => ({ session_id: sessionId, pool_id: poolId, name, draw_order: (count ?? 0) + index })),
      );
      if (error) return jsonError(databaseError(error), 500);
    }
    return NextResponse.json({ ok: true, added: fresh.length, skipped: names.length - fresh.length });
  }

  if (action === "delete_company") {
    const companyId = cleanText(payload.companyId, 80);
    const { error } = await auth.service.from("booth_companies").delete().eq("id", companyId).eq("session_id", sessionId);
    if (error) return jsonError(databaseError(error), 500);
    return NextResponse.json({ ok: true });
  }

  if (action === "bulk_add_booths") {
    const poolId = cleanText(payload.poolId, 80);
    const codes = Array.isArray(payload.codes)
      ? [...new Set(payload.codes.map((value) => cleanText(value, 40).toUpperCase()).filter(Boolean))].slice(0, 500)
      : [];
    if (!poolId || codes.length === 0) return jsonError("Chọn pool và nhập danh sách số gian.");
    if (!(await poolBelongsToSession(auth.service, poolId, sessionId))) return jsonError("Pool không thuộc phiên này.");

    const { data: existing } = await auth.service.from("booth_zones").select("booth_code").eq("session_id", sessionId);
    const existingCodes = new Set((existing ?? []).map((row) => row.booth_code.toUpperCase()));
    const fresh = codes.filter((code) => !existingCodes.has(code));
    const start = existing?.length ?? 0;
    if (publicWrite && start + fresh.length > 500) return jsonError("Phiên miễn phí hỗ trợ tối đa 500 gian hàng.");
    if (fresh.length > 0) {
      const { error } = await auth.service.from("booth_zones").insert(
        fresh.map((boothCode, index) => {
          const position = start + index;
          return {
            session_id: sessionId,
            pool_id: poolId,
            booth_code: boothCode,
            x: 3 + (position % 8) * 12,
            y: 4 + (Math.floor(position / 8) % 9) * 10,
            width: 9,
            height: 7,
          };
        }),
      );
      if (error) return jsonError(databaseError(error), 500);
    }
    return NextResponse.json({ ok: true, added: fresh.length, skipped: codes.length - fresh.length });
  }

  if (action === "update_booth") {
    const boothId = cleanText(payload.boothId, 80);
    const patch = {
      x: clampNumber(payload.x, 0, 99, 5),
      y: clampNumber(payload.y, 0, 99, 5),
      width: clampNumber(payload.width, 1, 100, 10),
      height: clampNumber(payload.height, 1, 100, 8),
      rotation: clampNumber(payload.rotation, -180, 180, 0),
    };
    patch.x = Math.min(patch.x, 100 - patch.width);
    patch.y = Math.min(patch.y, 100 - patch.height);
    const { error } = await auth.service.from("booth_zones").update(patch).eq("id", boothId).eq("session_id", sessionId);
    if (error) return jsonError(databaseError(error), 500);
    return NextResponse.json({ ok: true });
  }

  if (action === "apply_booth_style_to_pool") {
    const poolId = cleanText(payload.poolId, 80);
    if (!poolId) return jsonError("Thiếu pool cần áp dụng.");
    const { data, error } = await auth.service.rpc("apply_booth_style_to_pool", {
      p_session_id: sessionId,
      p_pool_id: poolId,
      p_width: clampNumber(payload.width, 1, 100, 10),
      p_height: clampNumber(payload.height, 1, 100, 8),
      p_rotation: clampNumber(payload.rotation, -180, 180, 0),
    });
    if (error) return jsonError(databaseError(error), 409);
    return NextResponse.json({ ok: true, updated: data ?? 0 });
  }

  if (action === "delete_booth") {
    const boothId = cleanText(payload.boothId, 80);
    const { error } = await auth.service.from("booth_zones").delete().eq("id", boothId).eq("session_id", sessionId);
    if (error) return jsonError(databaseError(error), 500);
    return NextResponse.json({ ok: true });
  }

  if (action === "draw") {
    const companyId = cleanText(payload.companyId, 80);
    const requestKey = cleanText(payload.requestKey, 80);
    if (!companyId || !requestKey) return jsonError("Thiếu công ty hoặc mã lượt quay.");
    const { data, error } = await auth.service.rpc("draw_booth_for_company", {
      p_session_id: sessionId,
      p_company_id: companyId,
      p_request_key: requestKey,
      p_actor: auth.email,
    });
    if (error) return jsonError(databaseError(error), 409);
    return NextResponse.json({ ok: true, result: data?.[0] ?? null, results: data ?? [] });
  }

  if (action === "swap") {
    const companyAId = cleanText(payload.companyAId, 80);
    const companyBId = cleanText(payload.companyBId, 80);
    if (!companyAId || !companyBId) return jsonError("Chọn hai công ty cần đổi gian.");
    const { error } = await auth.service.rpc("swap_booth_assignments", {
      p_session_id: sessionId,
      p_company_a_id: companyAId,
      p_company_b_id: companyBId,
      p_reason: cleanText(payload.reason, 500),
      p_actor: auth.email,
    });
    if (error) return jsonError(databaseError(error), 409);
    return NextResponse.json({ ok: true });
  }

  if (action === "move") {
    const companyId = cleanText(payload.companyId, 80);
    const targetBoothId = cleanText(payload.targetBoothId, 80);
    if (!companyId || !targetBoothId) return jsonError("Chọn công ty và gian trống đích.");
    const { error } = await auth.service.rpc("move_booth_assignment", {
      p_session_id: sessionId,
      p_company_id: companyId,
      p_target_booth_id: targetBoothId,
      p_reason: cleanText(payload.reason, 500),
      p_actor: auth.email,
    });
    if (error) return jsonError(databaseError(error), 409);
    return NextResponse.json({ ok: true });
  }

  return jsonError("Thao tác không được hỗ trợ.");
}

async function poolBelongsToSession(service: SupabaseClient, poolId: string, sessionId: string) {
  const { data } = await service.from("booth_pools").select("id").eq("id", poolId).eq("session_id", sessionId).maybeSingle();
  return !!data;
}
