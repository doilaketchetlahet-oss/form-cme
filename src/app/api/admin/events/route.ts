import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

type EventRow = {
  id: string;
  name: string;
  event_date: string | null;
  form_ids: string[];
  from_name?: string | null;
  from_email?: string | null;
  reply_to?: string | null;
  created_at: string | null;
  updated_at: string | null;
};

function normalizeEvent(row: EventRow) {
  return {
    ...row,
    form_ids: normalizeFormIds(row.form_ids),
    from_name: row.from_name ?? null,
    from_email: row.from_email ?? null,
    reply_to: row.reply_to ?? null,
  };
}

const MISSING_TABLE_HINT =
  "Chưa có bảng events. Hãy chạy file supabase/events.sql trong Supabase SQL editor rồi thử lại.";

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return error.code === "42P01"
    || error.code === "PGRST205"
    || message.includes("does not exist")
    || message.includes("could not find the table")
    || message.includes("schema cache");
}

function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

async function authorize(request: Request): Promise<{ email: string } | { error: NextResponse }> {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseAnonKey) {
    return { error: NextResponse.json({ ok: false, error: "Thiếu cấu hình Supabase." }, { status: 500 }) };
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return { error: NextResponse.json({ ok: false, error: "Bạn cần đăng nhập." }, { status: 401 }) };
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const email = userData.user?.email?.trim().toLowerCase();
  if (userError || !email) {
    return { error: NextResponse.json({ ok: false, error: "Không xác thực được tài khoản hiện tại." }, { status: 401 }) };
  }

  const { data: member } = await supabase
    .from("admin_members")
    .select("role, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();

  if (member?.role !== "owner" && member?.role !== "admin") {
    return { error: NextResponse.json({ ok: false, error: "Bạn không có quyền quản lý sự kiện." }, { status: 403 }) };
  }

  return { email };
}

function normalizeFormIds(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.filter((item): item is string => typeof item === "string" && item.length > 0))];
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY để dùng sự kiện." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("events")
    .select("id, name, event_date, form_ids, from_name, from_email, reply_to, created_at, updated_at")
    .order("event_date", { ascending: true, nullsFirst: false })
    .order("updated_at", { ascending: false })
    .limit(200);

  if (error) {
    const missingSender = (error.message ?? "").toLowerCase().match(/from_name|from_email|reply_to/);
    if (missingSender) {
      const fallback = await supabase
        .from("events")
        .select("id, name, event_date, form_ids, created_at, updated_at")
        .order("event_date", { ascending: true, nullsFirst: false })
        .order("updated_at", { ascending: false })
        .limit(200);
      if (!fallback.error) {
        const events = ((fallback.data ?? []) as EventRow[]).map((row) => normalizeEvent(row));
        return NextResponse.json({ ok: true, events });
      }
    }
    return NextResponse.json({ ok: false, error: isMissingTable(error) ? MISSING_TABLE_HINT : error.message }, { status: 500 });
  }

  const events = ((data ?? []) as EventRow[]).map((row) => normalizeEvent(row));
  return NextResponse.json({ ok: true, events });
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY để lưu sự kiện." }, { status: 400 });
  }

  const payload = await request.json().catch(() => null) as {
    id?: string;
    name?: string;
    event_date?: string | null;
    form_ids?: unknown;
    from_name?: string | null;
    from_email?: string | null;
    reply_to?: string | null;
  } | null;

  const name = payload?.name?.trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: "Cần tên sự kiện." }, { status: 400 });
  }

  const eventDate = payload?.event_date?.trim() || null;
  const formIds = normalizeFormIds(payload?.form_ids);
  const sender = {
    from_name: payload?.from_name?.trim() || null,
    from_email: payload?.from_email?.trim().toLowerCase() || null,
    reply_to: payload?.reply_to?.trim().toLowerCase() || null,
  };

  const record = {
    name,
    event_date: eventDate,
    form_ids: formIds,
    ...sender,
    updated_at: new Date().toISOString(),
  };
  const baseRecord = {
    name,
    event_date: eventDate,
    form_ids: formIds,
    updated_at: record.updated_at,
  };

  if (payload?.id) {
    let { error } = await supabase.from("events").update(record).eq("id", payload.id).select("id").maybeSingle();
    if (error && (error.message ?? "").toLowerCase().match(/from_name|from_email|reply_to/)) {
      ({ error } = await supabase.from("events").update(baseRecord).eq("id", payload.id).select("id").maybeSingle());
    }
    if (error) {
      return NextResponse.json({ ok: false, error: isMissingTable(error) ? MISSING_TABLE_HINT : error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: payload.id });
  }

  let { data, error } = await supabase
    .from("events")
    .insert({ ...record, owner_email: auth.email })
    .select("id")
    .single();
  if (error && (error.message ?? "").toLowerCase().match(/from_name|from_email|reply_to/)) {
    ({ data, error } = await supabase
      .from("events")
      .insert({ ...baseRecord, owner_email: auth.email })
      .select("id")
      .single());
  }
  if (error) {
    return NextResponse.json({ ok: false, error: isMissingTable(error) ? MISSING_TABLE_HINT : error.message }, { status: 500 });
  }
  if (!data) {
    return NextResponse.json({ ok: false, error: "Không tạo được sự kiện." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data.id });
}

export async function DELETE(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Thiếu id sự kiện." }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY để xóa sự kiện." }, { status: 400 });
  }

  const { error } = await supabase.from("events").delete().eq("id", id);
  if (error) {
    return NextResponse.json({ ok: false, error: isMissingTable(error) ? MISSING_TABLE_HINT : error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true });
}
