import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import { getConfiguredSiteUrl } from "@/lib/site-url";
import { sendCheckinEmail } from "@/lib/server/checkin-email";

export const runtime = "nodejs";
export const maxDuration = 60;

const JOB_BATCH = 40;

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

  let rows: RecipientRow[] = [];
  const full = await supabase
    .from("survey_responses")
    .select("id, checked_in, hall, payment_status, email")
    .in("survey_id", surveyIds);
  if (full.error) {
    const basic = await supabase
      .from("survey_responses")
      .select("id, checked_in, hall, email")
      .in("survey_id", surveyIds);
    rows = (basic.data ?? []) as RecipientRow[];
  } else {
    rows = (full.data ?? []) as RecipientRow[];
  }

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
    const responseIds = await resolveRecipients(supabase, campaign);
    if (responseIds.length > 0) {
      const jobs = responseIds.map((responseId) => ({
        campaign_id: campaign.id,
        response_id: responseId,
        status: "pending" as const,
      }));
      await supabase.from("email_jobs").insert(jobs);
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

async function processJobs(supabase: SupabaseClient, origin: string) {
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
    .select("id, email_subject, email_body")
    .in("id", campaignIds);
  const campaignById = new Map((campaigns ?? []).map((row) => [row.id as string, row]));

  let sent = 0;
  let failed = 0;

  for (const job of list) {
    const responseId = job.response_id as string;
    const campaign = campaignById.get(job.campaign_id as string);

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

    const result = await sendCheckinEmail({
      responseId,
      to,
      checkinUrl: `${origin}/checkin/${responseId}`,
      customSubject: campaign?.email_subject ?? "",
      customBody: campaign?.email_body ?? "",
      mode: "campaign",
      origin,
    });

    if (result.ok) {
      sent += 1;
      await supabase
        .from("email_jobs")
        .update({ status: "sent", sent_at: new Date().toISOString(), attempts: (job.attempts as number) + 1, last_error: null })
        .eq("id", job.id);
    } else {
      failed += 1;
      await supabase
        .from("email_jobs")
        .update({ status: "failed", attempts: (job.attempts as number) + 1, last_error: result.error ?? "Gửi thất bại" })
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
    if (!pendingCount) patch.status = "sent";
    await supabase.from("email_campaigns").update(patch).eq("id", campaignId);
  }

  return { processed: list.length, sent, failed };
}

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = request.headers.get("authorization");
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
  }

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Supabase admin not configured" }, { status: 500 });
  }

  const nowIso = new Date().toISOString();
  const origin = getConfiguredSiteUrl() || request.nextUrl.origin;

  const promoted = await promoteScheduled(supabase, nowIso);
  const processed = await processJobs(supabase, origin);

  return NextResponse.json({ ok: true, promoted, ...processed });
}
