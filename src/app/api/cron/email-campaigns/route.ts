import { NextRequest, NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import { getConfiguredSiteUrl } from "@/lib/site-url";
import { sendCheckinEmail } from "@/lib/server/checkin-email";

export const runtime = "nodejs";
export const maxDuration = 60;

const JOB_BATCH = 25;
/** Stop starting new sends well before maxDuration so a batch is never killed
 * mid-way (a killed run leaves sent jobs "pending" and they would be resent). */
const TIME_BUDGET_MS = 40_000;
const PAGE = 500;

async function isAuthorized(request: NextRequest): Promise<boolean> {
  const secret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");
  if (secret && authHeader === `Bearer ${secret}`) return true;

  // Allow a signed-in owner/admin to trigger the queue manually (Hobby plan).
  const token = authHeader?.replace(/^Bearer\s+/i, "").trim();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!token || !url || !anonKey) return false;

  const supabase = createClient(url, anonKey, { global: { headers: { Authorization: `Bearer ${token}` } } });
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

type CampaignRow = {
  id: string;
  event_id: string | null;
  survey_id: string | null;
  email_subject: string | null;
  email_body: string | null;
  filter: Record<string, unknown> | null;
  status: string;
};

type RecipientRow = {
  id: string;
  checked_in: boolean | null;
  hall: string | null;
  payment_status?: string | null;
  email: string | null;
};

async function resolveRecipients(supabase: SupabaseClient, campaign: CampaignRow): Promise<string[]> {
  let surveyIds: string[] = [];
  if (campaign.event_id) {
    const { data: event } = await supabase.from("events").select("form_ids").eq("id", campaign.event_id).maybeSingle();
    const formIds = (event as { form_ids?: unknown } | null)?.form_ids;
    surveyIds = Array.isArray(formIds) ? formIds.filter((id): id is string => typeof id === "string") : [];
  } else if (campaign.survey_id) {
    surveyIds = [campaign.survey_id];
  }
  if (surveyIds.length === 0) return [];

  // Page by id: a single request stops at PostgREST's row cap (1,000 by
  // default), which silently dropped recipients from large events.
  const readAll = async (columns: string) => {
    const all: RecipientRow[] = [];
    let after = "";
    for (;;) {
      let query = supabase.from("survey_responses").select(columns).in("survey_id", surveyIds).order("id").limit(PAGE);
      if (after) query = query.gt("id", after);
      const { data, error } = await query;
      if (error) return { rows: all, error };
      const page = (data ?? []) as unknown as RecipientRow[];
      all.push(...page);
      if (page.length !== PAGE || all.length >= 100_000) return { rows: all, error: null };
      after = page[page.length - 1].id;
    }
  };
  let result = await readAll("id, checked_in, hall, payment_status, email");
  if (result.error) result = await readAll("id, checked_in, hall, email");
  if (result.error) throw new Error("Không đọc được danh sách người nhận.");
  const rows = result.rows;

  const filter = (campaign.filter ?? {}) as { notCheckedIn?: boolean; hall?: string; paymentStatus?: string };
  return rows
    .filter((row) => {
      if (!row.email) return false;
      if (filter.notCheckedIn && row.checked_in) return false;
      if (filter.hall && row.hall !== filter.hall) return false;
      if (filter.paymentStatus && row.payment_status !== filter.paymentStatus) return false;
      return true;
    })
    .map((row) => row.id);
}

async function promoteScheduled(supabase: SupabaseClient, nowIso: string) {
  const { data: due } = await supabase
    .from("email_campaigns")
    .select("id, event_id, survey_id, email_subject, email_body, filter, status")
    .eq("status", "scheduled")
    .lte("send_at", nowIso)
    .limit(10);

  let promoted = 0;
  for (const campaign of (due ?? []) as CampaignRow[]) {
    // Claim first: overlapping runs (GitHub Actions, Vercel cron, manual
    // trigger) must not each create a job set and email everyone twice.
    const { data: claimed } = await supabase
      .from("email_campaigns")
      .update({ status: "sending", updated_at: nowIso })
      .eq("id", campaign.id)
      .eq("status", "scheduled")
      .select("id");
    if (!claimed?.length) continue;

    let responseIds: string[] = [];
    try {
      responseIds = await resolveRecipients(supabase, campaign);
      for (let start = 0; start < responseIds.length; start += PAGE) {
        const jobs = responseIds.slice(start, start + PAGE).map((responseId) => ({
          campaign_id: campaign.id,
          response_id: responseId,
          status: "pending" as const,
        }));
        const { error } = await supabase.from("email_jobs").insert(jobs);
        if (error) throw new Error(error.message);
      }
    } catch {
      await supabase.from("email_campaigns").update({ status: "failed", updated_at: nowIso }).eq("id", campaign.id);
      continue;
    }
    await supabase
      .from("email_campaigns")
      .update({
        status: responseIds.length > 0 ? "sending" : "sent",
        total: responseIds.length,
        updated_at: nowIso,
      })
      .eq("id", campaign.id);
    promoted += 1;
  }
  return promoted;
}

async function processJobs(supabase: SupabaseClient, origin: string, startedAt: number) {
  const { data: jobs } = await supabase
    .from("email_jobs")
    .select("id, campaign_id, response_id, attempts")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(JOB_BATCH);

  const list = jobs ?? [];
  if (list.length === 0) return { processed: 0, sent: 0, failed: 0 };

  const campaignIds = [...new Set(list.map((job) => job.campaign_id as string))];
  const { data: campaigns } = await supabase
    .from("email_campaigns")
    .select("id, email_subject, email_body, status")
    .in("id", campaignIds);
  const campaignById = new Map((campaigns ?? []).map((row) => [row.id as string, row]));

  let sent = 0;
  let failed = 0;
  let processed = 0;

  for (const job of list) {
    if (Date.now() - startedAt > TIME_BUDGET_MS) break;
    const responseId = job.response_id as string;
    const campaign = campaignById.get(job.campaign_id as string);
    const attempts = (job.attempts as number) ?? 0;
    if (!campaign || campaign.status === "cancelled") {
      // "Huỷ" must actually stop the queue, not just relabel the campaign.
      await supabase.from("email_jobs").update({ status: "skipped", last_error: "Chiến dịch đã huỷ" })
        .eq("id", job.id).eq("status", "pending");
      continue;
    }

    // Optimistic claim: only the run that bumps `attempts` sends this job.
    const { data: claimed } = await supabase
      .from("email_jobs")
      .update({ attempts: attempts + 1 })
      .eq("id", job.id)
      .eq("status", "pending")
      .eq("attempts", attempts)
      .select("id");
    if (!claimed?.length) continue;
    processed += 1;

    const { data: response } = await supabase
      .from("survey_responses")
      .select("id, email")
      .eq("id", responseId)
      .maybeSingle();

    const to = (response?.email as string | undefined) || null;
    if (!to) {
      await supabase.from("email_jobs").update({ status: "skipped", last_error: "Không có email" }).eq("id", job.id);
      continue;
    }

    let result: Awaited<ReturnType<typeof sendCheckinEmail>>;
    try {
      result = await sendCheckinEmail({
        responseId,
        to,
        checkinUrl: `${origin}/checkin/${responseId}`,
        customSubject: campaign?.email_subject ?? "",
        customBody: campaign?.email_body ?? "",
        mode: "campaign",
        origin,
      });
    } catch (error) {
      result = { ok: false, messageId: null, provider: "resend", error: error instanceof Error ? error.message : "Gửi thất bại" };
    }

    if (result.ok) {
      sent += 1;
      await supabase
        .from("email_jobs")
        .update({ status: "sent", sent_at: new Date().toISOString(), last_error: null })
        .eq("id", job.id);
    } else {
      failed += 1;
      await supabase
        .from("email_jobs")
        .update({ status: "failed", last_error: result.error ?? "Gửi thất bại" })
        .eq("id", job.id);
    }
  }

  for (const campaignId of campaignIds) {
    const { count: sentCount } = await supabase
      .from("email_jobs").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "sent");
    const { count: failedCount } = await supabase
      .from("email_jobs").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "failed");
    const { count: pendingCount } = await supabase
      .from("email_jobs").select("id", { count: "exact", head: true }).eq("campaign_id", campaignId).eq("status", "pending");

    const patch: Record<string, unknown> = {
      sent: sentCount ?? 0,
      failed: failedCount ?? 0,
      updated_at: new Date().toISOString(),
    };
    await supabase.from("email_campaigns").update(patch).eq("id", campaignId);
    // Only a running campaign completes; a cancelled one keeps its status.
    if (!pendingCount) await supabase.from("email_campaigns").update({ status: "sent" }).eq("id", campaignId).eq("status", "sending");
  }

  return { processed, sent, failed };
}

export async function GET(request: NextRequest) {
  if (!(await isAuthorized(request))) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase admin not configured" }, { status: 500 });
  }

  const nowIso = new Date().toISOString();
  const origin = getConfiguredSiteUrl() || request.nextUrl.origin;

  const startedAt = Date.now();
  const promoted = await promoteScheduled(supabase, nowIso);
  const processed = await processJobs(supabase, origin, startedAt);

  return NextResponse.json({ ok: true, promoted, ...processed });
}
