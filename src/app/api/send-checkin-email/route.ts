import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { getRequestSiteUrl } from "@/lib/site-url";
import { sendCheckinEmail } from "@/lib/server/checkin-email";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";

export const maxDuration = 30;

/** Anonymous callers may only trigger the confirmation for a freshly created
 * registration, and never more often than once a minute per registration. */
const ANON_MAX_AGE_MS = 15 * 60 * 1000;
const ANON_COOLDOWN_MS = 60 * 1000;

async function isAdminRequest(request: NextRequest): Promise<boolean> {
  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anonKey) return false;

  const supabase = createClient(url, anonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });
  const { data: userData } = await supabase.auth.getUser(token);
  const email = userData.user?.email?.trim().toLowerCase();
  if (!email) return false;

  const { data: member } = await supabase
    .from("admin_members")
    .select("role, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();

  return member?.role === "owner" || member?.role === "admin";
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { responseId, to, mode } = (body ?? {}) as {
    responseId?: string;
    to?: string;
    mode?: string;
  };

  // The recipient, subject, body, QR style and check-in URL are always derived
  // from the database. Callers only identify the registration.
  if (!responseId) {
    return NextResponse.json({ error: "Missing responseId" }, { status: 400 });
  }

  const admin = createSupabaseAdmin();
  if (!admin) {
    return NextResponse.json({ error: "unavailable" }, { status: 503 });
  }

  const isAdmin = await isAdminRequest(req);

  const { data: row } = await admin
    .from("survey_responses")
    .select("id, email, submitted_at, email_last_attempt_at")
    .eq("id", responseId)
    .maybeSingle();

  if (!row) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  if (!isAdmin) {
    const submitted = row.submitted_at ? Date.parse(row.submitted_at as string) : 0;
    if (!submitted || Date.now() - submitted > ANON_MAX_AGE_MS) {
      return NextResponse.json({ error: "expired" }, { status: 403 });
    }
    const lastAttempt = row.email_last_attempt_at ? Date.parse(row.email_last_attempt_at as string) : 0;
    if (lastAttempt && Date.now() - lastAttempt < ANON_COOLDOWN_MS) {
      return NextResponse.json({ error: "too_soon" }, { status: 429 });
    }
  }

  const origin = getRequestSiteUrl(req.nextUrl.origin);

  let result: Awaited<ReturnType<typeof sendCheckinEmail>>;
  try {
    result = await sendCheckinEmail({
      responseId,
      checkinUrl: `${origin}/checkin/${responseId}`,
      origin,
      ...(isAdmin && mode === "reminder" ? { mode: "reminder" as const } : {}),
      // Only a verified admin may redirect the email to another address.
      ...(isAdmin && to?.trim() ? { to: to.trim() } : {}),
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "Send crashed";
    return NextResponse.json({ error: "Send failed", detail, provider: "unknown" }, { status: 500 });
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: "Send failed", detail: result.error, provider: result.provider },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, resendId: result.messageId, provider: result.provider });
}
