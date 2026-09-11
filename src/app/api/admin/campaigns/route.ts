import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

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
    return { error: NextResponse.json({ ok: false, error: "Không xác thực được tài khoản." }, { status: 401 }) };
  }

  const { data: member } = await supabase
    .from("admin_members")
    .select("role, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();

  if (member?.role !== "owner" && member?.role !== "admin") {
    return { error: NextResponse.json({ ok: false, error: "Bạn không có quyền quản lý chiến dịch." }, { status: 403 }) };
  }

  return { email };
}

function getServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

const MISSING_TABLE_HINT =
  "Chưa có bảng email_campaigns. Hãy chạy file supabase/email-campaigns.sql trong Supabase SQL editor rồi thử lại.";

function isMissingTable(error: { code?: string; message?: string } | null) {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return error.code === "42P01" || error.code === "PGRST205" || message.includes("could not find the table") || message.includes("schema cache");
}

export async function GET(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY." }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("email_campaigns")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return NextResponse.json({ ok: false, error: isMissingTable(error) ? MISSING_TABLE_HINT : error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, campaigns: data ?? [] });
}

export async function POST(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY." }, { status: 400 });
  }

  const payload = await request.json().catch(() => null) as {
    id?: string;
    name?: string;
    event_id?: string | null;
    survey_id?: string | null;
    email_subject?: string | null;
    email_body?: string | null;
    filter?: Record<string, unknown>;
    send_at?: string | null;
    action?: "save" | "cancel" | "send_now" | "retry_failed";
  } | null;

  const now = new Date().toISOString();
  const action = payload?.action ?? "save";

  if (action !== "save") {
    if (!payload?.id) {
      return NextResponse.json({ ok: false, error: "Thiếu id chiến dịch." }, { status: 400 });
    }
    if (action === "cancel") {
      await supabase.from("email_campaigns").update({ status: "cancelled", updated_at: now }).eq("id", payload.id);
      return NextResponse.json({ ok: true });
    }
    if (action === "send_now") {
      await supabase.from("email_campaigns").update({ status: "scheduled", send_at: now, updated_at: now }).eq("id", payload.id);
      return NextResponse.json({ ok: true });
    }
    // retry_failed
    await supabase.from("email_jobs").update({ status: "pending", last_error: null }).eq("campaign_id", payload.id).eq("status", "failed");
    await supabase.from("email_campaigns").update({ status: "sending", updated_at: now }).eq("id", payload.id);
    return NextResponse.json({ ok: true });
  }

  const name = payload?.name?.trim();
  if (!name) {
    return NextResponse.json({ ok: false, error: "Cần tên chiến dịch." }, { status: 400 });
  }
  if (!payload?.event_id && !payload?.survey_id) {
    return NextResponse.json({ ok: false, error: "Chọn sự kiện hoặc form để gửi." }, { status: 400 });
  }

  const sendAt = payload?.send_at?.trim() || null;
  const record = {
    name,
    event_id: payload.event_id || null,
    survey_id: payload.survey_id || null,
    email_subject: payload.email_subject?.trim() || null,
    email_body: payload.email_body ?? null,
    filter: payload.filter ?? {},
    send_at: sendAt,
    status: sendAt ? "scheduled" : "draft",
    updated_at: now,
  };

  if (payload.id) {
    const { error } = await supabase.from("email_campaigns").update(record).eq("id", payload.id);
    if (error) {
      return NextResponse.json({ ok: false, error: isMissingTable(error) ? MISSING_TABLE_HINT : error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, id: payload.id });
  }

  const { data, error } = await supabase
    .from("email_campaigns")
    .insert({ ...record, owner_email: auth.email })
    .select("id")
    .single();
  if (error) {
    return NextResponse.json({ ok: false, error: isMissingTable(error) ? MISSING_TABLE_HINT : error.message }, { status: 500 });
  }
  return NextResponse.json({ ok: true, id: data.id });
}

export async function DELETE(request: Request) {
  const auth = await authorize(request);
  if ("error" in auth) return auth.error;

  const id = new URL(request.url).searchParams.get("id");
  if (!id) {
    return NextResponse.json({ ok: false, error: "Thiếu id." }, { status: 400 });
  }

  const supabase = getServiceClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Thiếu SUPABASE_SERVICE_ROLE_KEY." }, { status: 400 });
  }

  await supabase.from("email_campaigns").delete().eq("id", id);
  return NextResponse.json({ ok: true });
}
