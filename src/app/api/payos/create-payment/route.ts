import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import { createOrderCode, createPayOSClient, createPayOSDescription, normalizePaymentConfig } from "@/lib/server/payos";
import { getRequestSiteUrl } from "@/lib/site-url";

export const runtime = "nodejs";

type Body = {
  surveyId?: string;
  answers?: Record<string, string | number | number[]>;
  email?: string | null;
  name?: string | null;
  hall?: string | null;
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as Body | null;
  const surveyId = body?.surveyId?.trim();
  const answers = body?.answers;
  const email = body?.email?.trim().toLowerCase() || null;
  const name = body?.name?.trim() || "";
  const hall = body?.hall?.trim() || null;

  if (!surveyId || !answers || typeof answers !== "object") {
    return NextResponse.json({ ok: false, error: "Dữ liệu thanh toán không hợp lệ." }, { status: 400 });
  }

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "Thiếu cấu hình Supabase server." }, { status: 500 });
  }

  const payos = createPayOSClient();
  if (!payos) {
    return NextResponse.json({ ok: false, error: "Thiếu cấu hình PayOS. Vui lòng thêm PAYOS_CLIENT_ID, PAYOS_API_KEY, PAYOS_CHECKSUM_KEY." }, { status: 500 });
  }

  const { data: survey, error: surveyError } = await supabase
    .from("surveys")
    .select("id, title, form_type, payment_config")
    .eq("id", surveyId)
    .single();

  if (surveyError || !survey) {
    return NextResponse.json({ ok: false, error: "Không tìm thấy form." }, { status: 404 });
  }

  if (survey.form_type && survey.form_type !== "registration") {
    return NextResponse.json({ ok: false, error: "Form này không hỗ trợ thanh toán check-in." }, { status: 400 });
  }

  const paymentConfig = normalizePaymentConfig(survey.payment_config);
  if (!paymentConfig) {
    return NextResponse.json({ ok: false, error: "Form chưa bật thanh toán." }, { status: 400 });
  }

  let responseId: string | null = null;
  if (email) {
    const { data: existing } = await supabase
      .from("survey_responses")
      .select("id, payment_status, payment_checkout_url")
      .eq("survey_id", surveyId)
      .ilike("email", email)
      .order("submitted_at", { ascending: true })
      .limit(1);

    const row = existing?.[0];
    if (row?.payment_status === "paid" || row?.payment_status === "not_required") {
      return NextResponse.json({ ok: true, duplicate: true, alreadyPaid: true, responseId: row.id });
    }

    if (row?.payment_status === "pending" && row.payment_checkout_url) {
      return NextResponse.json({
        ok: true,
        duplicate: true,
        paymentRequired: true,
        responseId: row.id,
        checkoutUrl: row.payment_checkout_url,
      });
    }

    if (row?.id) responseId = row.id;
  }

  if (responseId) {
    const { error } = await supabase
      .from("survey_responses")
      .update({
        answers,
        email,
        hall,
        payment_status: "pending",
        payment_amount: paymentConfig.amount,
        email_status: email ? "pending" : null,
      })
      .eq("id", responseId);
    if (error) return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  } else {
    const { data, error } = await supabase
      .from("survey_responses")
      .insert({
        survey_id: surveyId,
        answers,
        ...(email ? { email, email_status: "pending" } : {}),
        ...(hall ? { hall } : {}),
        payment_status: "pending",
        payment_amount: paymentConfig.amount,
      })
      .select("id")
      .single();

    if (error || !data?.id) {
      return NextResponse.json({ ok: false, error: error?.message ?? "Không tạo được đăng ký thanh toán." }, { status: 500 });
    }
    responseId = data.id;
  }

  if (!responseId) {
    return NextResponse.json({ ok: false, error: "Không tạo được mã đăng ký thanh toán." }, { status: 500 });
  }

  const orderCode = await createUniqueOrderCode(supabase);
  const origin = getRequestSiteUrl(req.nextUrl.origin);
  const returnUrl = `${origin}/payment/success?responseId=${encodeURIComponent(responseId)}`;
  const cancelUrl = `${origin}/payment/cancel?responseId=${encodeURIComponent(responseId)}`;
  const expiredAt = Math.floor(Date.now() / 1000) + paymentConfig.expiresInMinutes * 60;

  try {
    const paymentLink = await payos.paymentRequests.create({
      orderCode,
      amount: paymentConfig.amount,
      description: createPayOSDescription(orderCode),
      returnUrl,
      cancelUrl,
      expiredAt,
      buyerName: name || undefined,
      buyerEmail: email || undefined,
      items: [
        {
          name: paymentConfig.itemName,
          quantity: 1,
          price: paymentConfig.amount,
        },
      ],
    });

    await supabase
      .from("survey_responses")
      .update({
        payment_status: paymentLink.status === "PAID" ? "paid" : "pending",
        payment_amount: paymentLink.amount,
        payment_order_code: paymentLink.orderCode,
        payment_link_id: paymentLink.paymentLinkId,
        payment_checkout_url: paymentLink.checkoutUrl,
        payment_raw: paymentLink,
        paid_at: paymentLink.status === "PAID" ? new Date().toISOString() : null,
      })
      .eq("id", responseId);

    return NextResponse.json({
      ok: true,
      paymentRequired: true,
      responseId,
      orderCode: paymentLink.orderCode,
      checkoutUrl: paymentLink.checkoutUrl,
      expiredAt: paymentLink.expiredAt ?? expiredAt,
    });
  } catch (error) {
    await supabase
      .from("survey_responses")
      .update({
        payment_status: "failed",
        payment_error: error instanceof Error ? error.message : "PayOS create payment failed",
      })
      .eq("id", responseId);

    return NextResponse.json({
      ok: false,
      error: error instanceof Error ? error.message : "Không tạo được link thanh toán PayOS.",
    }, { status: 500 });
  }
}

async function createUniqueOrderCode(supabase: ReturnType<typeof createSupabaseAdmin>) {
  for (let i = 0; i < 5; i++) {
    const orderCode = createOrderCode();
    const { data } = await supabase!
      .from("survey_responses")
      .select("id")
      .eq("payment_order_code", orderCode)
      .maybeSingle();
    if (!data) return orderCode;
  }
  return createOrderCode();
}
