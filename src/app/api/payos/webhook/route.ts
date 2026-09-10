import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import { createPayOSClient } from "@/lib/server/payos";
import { getRequestSiteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

type SurveyRow = {
  title: string;
  email_subject: string | null;
  email_body: string | null;
  checkin_theme: { qr?: unknown } | null;
};

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "payos-webhook" });
}

export async function POST(req: NextRequest) {
  const payload = await req.json().catch(() => null);
  const payos = createPayOSClient();
  const supabase = createSupabaseAdmin();

  if (!payos || !supabase) {
    return NextResponse.json({ ok: false, error: "Server payment config missing" }, { status: 500 });
  }

  try {
    const data = await payos.webhooks.verify(payload);
    const isPaid = payload?.success === true && data.code === "00";
    const nextStatus = isPaid ? "paid" : "failed";
    const now = new Date().toISOString();
    const baseUpdate = {
      payment_status: nextStatus,
      payment_link_id: data.paymentLinkId,
      payment_reference: data.reference,
      payment_raw: payload,
      paid_at: isPaid ? now : null,
    };

    let updateResult = await supabase
      .from("survey_responses")
      .update({
        ...baseUpdate,
        payment_payer_name: data.counterAccountName ?? null,
        payment_payer_bank: data.counterAccountBankName ?? data.counterAccountBankId ?? null,
        payment_payer_account: data.counterAccountNumber ?? null,
        payment_transaction_datetime: data.transactionDateTime ?? null,
      })
      .eq("payment_order_code", data.orderCode)
      .select("id, survey_id, answers, email, payment_status")
      .maybeSingle();

    if (updateResult.error && isMissingPaymentPayerColumn(updateResult.error)) {
      updateResult = await supabase
        .from("survey_responses")
        .update(baseUpdate)
        .eq("payment_order_code", data.orderCode)
        .select("id, survey_id, answers, email, payment_status")
        .maybeSingle();
    }

    const { data: updated, error } = updateResult;

    if (error) {
      return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
    }

    if (isPaid && updated?.id && updated.email) {
      const { data: survey } = await supabase
        .from("surveys")
        .select("title, email_subject, email_body, checkin_theme")
        .eq("id", updated.survey_id)
        .single();

      await sendCheckinEmailFromWebhook(req, {
        responseId: updated.id,
        email: updated.email,
        name: findName(updated.answers as Record<string, unknown>),
        survey: survey as SurveyRow | null,
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Invalid PayOS webhook",
    }, { status: 400 });
  }
}

async function sendCheckinEmailFromWebhook(
  req: NextRequest,
  input: {
    responseId: string;
    email: string;
    name: string;
    survey: SurveyRow | null;
  },
) {
  const origin = getRequestSiteUrl(req.nextUrl.origin);
  const res = await fetch(`${origin}/api/send-checkin-email`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      to: input.email,
      name: input.name,
      checkinUrl: `${origin}/checkin/${input.responseId}`,
      surveyTitle: input.survey?.title || "",
      customSubject: input.survey?.email_subject || "",
      customBody: input.survey?.email_body || "",
      responseId: input.responseId,
      qrStyle: input.survey?.checkin_theme?.qr ?? null,
    }),
  });

  if (!res.ok) {
    const detail = await res.text().catch(() => "");
    console.error("PayOS webhook email send failed:", detail);
  }
}

function findName(answers: Record<string, unknown>) {
  return Object.values(answers).find((value) => {
    if (typeof value !== "string") return false;
    const text = value.trim();
    return text.length > 1 && text.length < 80 && !text.includes("@") && !/^\d+$/.test(text) && !/^https?:/i.test(text);
  }) as string || "";
}

function isMissingPaymentPayerColumn(error: { code?: string; message?: string }) {
  const message = error.message?.toLowerCase() ?? "";
  return error.code === "PGRST204" || (
    message.includes("schema cache")
    && (
      message.includes("payment_payer_name")
      || message.includes("payment_payer_bank")
      || message.includes("payment_payer_account")
      || message.includes("payment_transaction_datetime")
    )
  );
}
