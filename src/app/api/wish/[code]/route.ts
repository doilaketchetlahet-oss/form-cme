import { NextRequest, NextResponse } from "next/server";
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import { authorizeAdminApi } from "@/lib/server/admin-api";
import {
  generateWishCode,
  normalizeWishEvent,
  normalizeWishRow,
  normalizeWishSettings,
  validateWishInput,
  type Wish,
  type WishSettings,
  type WishSnapshot,
} from "@/lib/wish/config";
import { broadcastWish } from "@/lib/wish/broadcast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ code: string }> };

const EVENT_COLUMNS = "id, code, title, subtitle, status, moderation, settings, created_at, updated_at";
const WISH_COLUMNS =
  "id, event_id, kind, symbol, content, drawing, color, nickname, edge, status, created_at";
const MAX_WISHES = 1000;
/**
 * Mỗi IP chỉ gửi được 1 lời chúc trong khoảng này. Để ngắn vì một tablet dùng
 * chung cho nhiều khách liên tiếp; chống spam nhờ kiểm duyệt + giới hạn độ dài.
 */
const SUBMIT_COOLDOWN_MS = 3_000;

async function findEvent(admin: SupabaseClient, code: string) {
  const clean = code.trim().toUpperCase().slice(0, 12);
  if (!clean) return null;
  const { data } = await admin.from("wish_events").select(EVENT_COLUMNS).eq("code", clean).maybeSingle();
  if (!data) return null;
  return normalizeWishEvent(data as Record<string, unknown>);
}

async function countWishes(admin: SupabaseClient, eventId: string, status?: Wish["status"]) {
  let query = admin.from("wishes").select("id", { count: "exact", head: true }).eq("event_id", eventId);
  if (status) query = query.eq("status", status);
  const { count } = await query;
  return count ?? 0;
}

function clientIp(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0]!.trim();
  return request.headers.get("x-real-ip")?.trim() ?? "";
}

function ipHash(ip: string, code: string) {
  if (!ip) return null;
  const salt = process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 16) ?? "wish";
  return createHash("sha256").update(`${salt}:${ip}:${code}`).digest("hex").slice(0, 32);
}

/** GET /api/wish/[code] — ảnh chụp chương trình (LED/tablet đọc, công khai). */
export async function GET(request: NextRequest, context: RouteContext) {
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const { code } = await context.params;
  const event = await findEvent(admin, code);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Chế độ quản trị: trả cả lời chúc đang chờ duyệt để admin kiểm duyệt.
  const scope = request.nextUrl.searchParams.get("scope");
  if (scope === "all") {
    const auth = await authorizeAdminApi(request, false);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let query = admin
    .from("wishes")
    .select(WISH_COLUMNS)
    .eq("event_id", event.id)
    .order("created_at", { ascending: true })
    .limit(MAX_WISHES);
  if (scope !== "all") query = query.eq("status", "approved");

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: "load_failed", detail: error.message }, { status: 500 });

  const wishes = (data ?? []).map((row) => normalizeWishRow(row as Record<string, unknown>));
  const [total, pending, approved] = await Promise.all([
    countWishes(admin, event.id),
    countWishes(admin, event.id, "pending"),
    countWishes(admin, event.id, "approved"),
  ]);

  const snapshot: WishSnapshot = { event, wishes, counts: { total, pending, approved } };
  return NextResponse.json(snapshot);
}

/** POST /api/wish/[code] — tạo chương trình (admin) hoặc gửi lời chúc (công khai). */
export async function POST(request: NextRequest, context: RouteContext) {
  const admin = createSupabaseAdmin();
  if (!admin) return NextResponse.json({ error: "unavailable" }, { status: 503 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? "");
  const { code } = await context.params;
  const cleanCode = code.trim().toUpperCase().slice(0, 12);

  if (action === "create") {
    const auth = await authorizeAdminApi(request, true);
    if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

    const existing = await findEvent(admin, cleanCode);
    if (existing) return NextResponse.json({ event: existing, created: false });

    const settings = normalizeWishSettings(body?.settings);
    const { data, error } = await auth.service
      .from("wish_events")
      .insert({
        code: cleanCode || generateWishCode(),
        title:
          typeof body?.title === "string" && body.title.trim()
            ? body.title.trim().slice(0, 160)
            : "Trao lời chúc, nhận yêu thương",
        subtitle:
          typeof body?.subtitle === "string" ? body.subtitle.trim().slice(0, 200) : "",
        moderation: body?.moderation === true,
        settings,
        owner_email: auth.email,
      })
      .select(EVENT_COLUMNS)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "create_failed", detail: error?.message }, { status: 500 });
    }
    return NextResponse.json({ event: normalizeWishEvent(data as Record<string, unknown>), created: true });
  }

  if (action === "submit") {
    const event = await findEvent(admin, cleanCode);
    if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });
    if (event.status === "paused") return NextResponse.json({ error: "paused" }, { status: 409 });
    if (event.status === "ended" || event.status === "draft") {
      return NextResponse.json({ error: "closed" }, { status: 409 });
    }

    const validated = validateWishInput(event.settings, body ?? {});
    if (!validated.ok) return NextResponse.json({ error: validated.error }, { status: 400 });

    const ip = clientIp(request);
    const hash = ipHash(ip, event.code);
    if (hash) {
      const since = new Date(Date.now() - SUBMIT_COOLDOWN_MS).toISOString();
      const { count } = await admin
        .from("wishes")
        .select("id", { count: "exact", head: true })
        .eq("event_id", event.id)
        .eq("ip_hash", hash)
        .gte("created_at", since);
      if ((count ?? 0) > 0) {
        return NextResponse.json({ error: "too_fast" }, { status: 429 });
      }
    }

    const status: Wish["status"] = event.moderation ? "pending" : "approved";
    const { data, error } = await admin
      .from("wishes")
      .insert({
        event_id: event.id,
        kind: validated.data.drawing ? "drawing" : validated.data.content ? "text" : "symbol",
        symbol: validated.data.symbol,
        content: validated.data.content,
        drawing: validated.data.drawing,
        color: validated.data.color,
        nickname: validated.data.nickname,
        edge: validated.data.edge,
        status,
        ip_hash: hash,
      })
      .select(WISH_COLUMNS)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "submit_failed", detail: error?.message }, { status: 500 });
    }

    const wish = normalizeWishRow(data as Record<string, unknown>);
    if (status === "approved") {
      await broadcastWish(event.code, { type: "wish", wish });
    }
    return NextResponse.json({ wish, moderated: event.moderation });
  }

  return NextResponse.json({ error: "unknown_action" }, { status: 400 });
}

/** PUT /api/wish/[code] — điều khiển/kiểm duyệt (admin). */
export async function PUT(request: NextRequest, context: RouteContext) {
  const auth = await authorizeAdminApi(request, true);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = auth.service;
  const { code } = await context.params;
  const event = await findEvent(admin, code);
  if (!event) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const body = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  const action = String(body?.action ?? "");

  switch (action) {
    case "settings": {
      const settings: WishSettings = normalizeWishSettings(body?.settings ?? event.settings);
      const patch: Record<string, unknown> = {
        settings,
        updated_at: new Date().toISOString(),
      };
      if (typeof body?.title === "string") patch.title = body.title.trim().slice(0, 160);
      if (typeof body?.subtitle === "string") patch.subtitle = body.subtitle.trim().slice(0, 200);
      if (body?.moderation !== undefined) patch.moderation = body.moderation === true;
      if (["draft", "live", "paused", "ended"].includes(String(body?.status))) patch.status = body?.status;

      const { data, error } = await admin
        .from("wish_events")
        .update(patch)
        .eq("id", event.id)
        .select(EVENT_COLUMNS)
        .single();
      if (error || !data) {
        return NextResponse.json({ error: "update_failed", detail: error?.message }, { status: 500 });
      }
      const updated = normalizeWishEvent(data as Record<string, unknown>);
      await broadcastWish(updated.code, {
        type: "settings",
        settings: updated.settings,
        title: updated.title,
        subtitle: updated.subtitle,
        status: updated.status,
      });
      return NextResponse.json({ event: updated });
    }

    case "moderate": {
      const wishId = String(body?.wishId ?? "");
      const status = String(body?.status ?? "");
      if (!wishId || !["pending", "approved", "rejected", "hidden"].includes(status)) {
        return NextResponse.json({ error: "bad_request" }, { status: 400 });
      }
      const { data, error } = await admin
        .from("wishes")
        .update({ status, updated_at: new Date().toISOString() })
        .eq("id", wishId)
        .eq("event_id", event.id)
        .select(WISH_COLUMNS)
        .single();
      if (error || !data) {
        return NextResponse.json({ error: "update_failed", detail: error?.message }, { status: 500 });
      }
      const wish = normalizeWishRow(data as Record<string, unknown>);
      if (status === "approved") {
        await broadcastWish(event.code, { type: "wish", wish });
      } else {
        await broadcastWish(event.code, { type: "moderate", wishId, status: wish.status });
      }
      return NextResponse.json({ wish });
    }

    case "delete": {
      const wishId = String(body?.wishId ?? "");
      if (!wishId) return NextResponse.json({ error: "bad_request" }, { status: 400 });
      await admin.from("wishes").delete().eq("id", wishId).eq("event_id", event.id);
      await broadcastWish(event.code, { type: "moderate", wishId, status: "rejected" });
      return NextResponse.json({ ok: true });
    }

    case "clear": {
      await admin.from("wishes").delete().eq("event_id", event.id);
      await broadcastWish(event.code, { type: "clear" });
      return NextResponse.json({ ok: true });
    }

    case "spotlight": {
      await broadcastWish(event.code, { type: "spotlight", wishId: String(body?.wishId ?? "") });
      return NextResponse.json({ ok: true });
    }

    case "absorb-all": {
      await broadcastWish(event.code, { type: "absorb-all" });
      return NextResponse.json({ ok: true });
    }

    default:
      return NextResponse.json({ error: "unknown_action" }, { status: 400 });
  }
}
