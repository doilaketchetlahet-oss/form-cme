import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { RegistrationFormSave } from "@/lib/forms";
import type { SurveyQuestionUpsert } from "@/lib/surveys";

export const runtime = "nodejs";

type RouteContext = {
  params: Promise<{ id: string }>;
};

export async function POST(request: Request, context: RouteContext) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    return NextResponse.json({ ok: false, error: "Thiếu cấu hình Supabase public URL hoặc anon key." }, { status: 500 });
  }

  const token = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "").trim();
  if (!token) {
    return NextResponse.json({ ok: false, error: "Bạn cần đăng nhập lại trước khi lưu form." }, { status: 401 });
  }

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    auth: { persistSession: false },
    global: { headers: { Authorization: `Bearer ${token}` } },
  });

  const { data: userData, error: userError } = await supabase.auth.getUser(token);
  const email = userData.user?.email?.trim().toLowerCase();

  if (userError || !email) {
    return NextResponse.json({ ok: false, error: "Không xác thực được tài khoản hiện tại." }, { status: 401 });
  }

  const { id: surveyId } = await context.params;
  const payload = (await request.json().catch(() => null)) as RegistrationFormSave | null;
  const validationError = validatePayload(payload);
  if (validationError) {
    return NextResponse.json({ ok: false, error: validationError }, { status: 400 });
  }

  const { data: member, error: memberError } = await supabase
    .from("admin_members")
    .select("role, active")
    .ilike("email", email)
    .eq("active", true)
    .maybeSingle();

  if (memberError) {
    return NextResponse.json({ ok: false, error: memberError.message }, { status: 500 });
  }

  if (member?.role !== "owner" && member?.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Bạn không có quyền chỉnh sửa form." }, { status: 403 });
  }

  const { data: survey, error: loadError } = await supabase
    .from("surveys")
    .select("quiz_id")
    .eq("id", surveyId)
    .single();

  if (loadError) {
    return NextResponse.json({ ok: false, error: loadError.message }, { status: 500 });
  }

  if (!survey?.quiz_id) {
    return NextResponse.json({ ok: false, error: "Không tìm thấy form." }, { status: 404 });
  }

  const surveyUpdate = {
    title: payload!.title.trim(),
    form_type: payload!.form_type,
    is_anonymous: true,
    thank_you_message: payload!.thank_you_message,
    banner_url: payload!.banner_url,
    redirect_url: payload!.redirect_url,
    redirect_delay: payload!.redirect_delay,
    email_subject: payload!.email_subject,
    email_body: payload!.email_body,
    checkin_pin: payload!.checkin_pin,
    checkin_theme: payload!.checkin_theme,
    scoring_config: payload!.scoring_config,
    payment_config: payload!.form_type === "registration" ? payload!.payment_config : null,
    vip_checkin_enabled: payload!.vip_checkin_enabled,
  };

  const { error: surveyError } = await supabase
    .from("surveys")
    .update(surveyUpdate)
    .eq("id", surveyId);

  if (surveyError) {
    const missingScoringConfig = isMissingColumn(surveyError, "scoring_config");
    const missingFormType = isMissingColumn(surveyError, "form_type");
    const missingPaymentConfig = isMissingColumn(surveyError, "payment_config");

    if (missingScoringConfig || missingFormType || missingPaymentConfig) {
      if (payload!.scoring_config) {
        return NextResponse.json({
          ok: false,
          error: "Database chưa có cột scoring_config. Hãy chạy file supabase/scoring-config.sql trong Supabase SQL editor trước khi lưu cấu hình chấm điểm.",
        }, { status: 400 });
      }
      if (missingPaymentConfig && payload!.payment_config) {
        return NextResponse.json({
          ok: false,
          error: "Database chưa có cột payment_config. Hãy chạy file supabase/payos-payments.sql trong Supabase SQL editor trước khi bật thanh toán PayOS.",
        }, { status: 400 });
      }
      if (missingFormType && payload!.form_type !== "registration") {
        return NextResponse.json({
          ok: false,
          error: "Database chưa có cột form_type. Hãy chạy file supabase/form-types.sql trong Supabase SQL editor trước khi lưu loại form chấm điểm.",
        }, { status: 400 });
      }

      const fallbackUpdate = {
        title: surveyUpdate.title,
        ...(missingFormType ? {} : { form_type: surveyUpdate.form_type }),
        is_anonymous: surveyUpdate.is_anonymous,
        thank_you_message: surveyUpdate.thank_you_message,
        banner_url: surveyUpdate.banner_url,
        redirect_url: surveyUpdate.redirect_url,
        redirect_delay: surveyUpdate.redirect_delay,
        email_subject: surveyUpdate.email_subject,
        email_body: surveyUpdate.email_body,
        checkin_pin: surveyUpdate.checkin_pin,
        checkin_theme: surveyUpdate.checkin_theme,
        ...(missingScoringConfig ? {} : { scoring_config: surveyUpdate.scoring_config }),
        ...(missingPaymentConfig ? {} : { payment_config: surveyUpdate.payment_config }),
        vip_checkin_enabled: surveyUpdate.vip_checkin_enabled,
      };
      const { error: fallbackError } = await supabase
        .from("surveys")
        .update(fallbackUpdate)
        .eq("id", surveyId);

      if (fallbackError) {
        return NextResponse.json({ ok: false, error: fallbackError.message }, { status: 500 });
      }
    } else {
      return NextResponse.json({ ok: false, error: surveyError.message }, { status: 500 });
    }
  }

  const { error: quizError } = await supabase
    .from("quizzes")
    .update({ title: payload!.title.trim(), updated_at: new Date().toISOString() })
    .eq("id", survey.quiz_id);

  if (quizError) {
    return NextResponse.json({ ok: false, error: quizError.message }, { status: 500 });
  }

  const questionResult = await upsertSurveyQuestionsViaSupabase(supabase, surveyId, payload!.questions);
  if (!questionResult.ok) {
    return NextResponse.json({ ok: false, error: questionResult.error }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}

function isMissingColumn(error: { code?: string; message?: string }, column: string) {
  const message = error.message?.toLowerCase() ?? "";
  return message.includes(column.toLowerCase()) && (
    error.code === "PGRST204"
    || message.includes("schema cache")
    || message.includes("column")
  );
}

function validatePayload(payload: RegistrationFormSave | null) {
  if (!payload) return "Dữ liệu lưu form không hợp lệ.";
  if (!payload.title?.trim()) return "Nhập tiêu đề form trước khi lưu.";
  if (!Array.isArray(payload.questions) || payload.questions.length === 0) return "Cần ít nhất một câu hỏi.";

  const emptyQuestion = payload.questions.findIndex(
    (q) => q.type !== "image_banner" && q.type !== "face_checkin" && !q.text?.trim(),
  );
  if (emptyQuestion >= 0) return `Câu ${emptyQuestion + 1} đang trống.`;

  return null;
}

async function upsertSurveyQuestionsViaSupabase(
  supabase: SupabaseClient,
  surveyId: string,
  questions: SurveyQuestionUpsert[],
): Promise<{ ok: boolean; error?: string }> {
  const { data: existing, error: loadError } = await supabase
    .from("survey_questions")
    .select("id")
    .eq("survey_id", surveyId);

  if (loadError) return { ok: false, error: loadError.message };

  const existingIds = new Set((existing ?? []).map((row) => row.id as string));
  const incomingIds = new Set(questions.filter((q) => q.id).map((q) => q.id as string));
  const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));

  if (toDelete.length > 0) {
    const { error } = await supabase.from("survey_questions").delete().eq("survey_id", surveyId).in("id", toDelete);
    if (error) return { ok: false, error: error.message };
  }

  const toUpdate = questions.filter((q) => !!q.id && existingIds.has(q.id));
  const toInsert = questions.filter((q) => !q.id || !existingIds.has(q.id as string));

  if (toUpdate.length > 0) {
    const updatePayload = toUpdate.map((q) => ({
      id: q.id!,
      survey_id: surveyId,
      position: questions.indexOf(q),
      type: q.type,
      text: q.text,
      options: q.options,
      required: q.required,
      allow_multiple: q.allow_multiple,
      show_if: q.show_if ?? null,
      is_hall_selector: q.is_hall_selector ?? false,
    }));
    const { error } = await supabase.from("survey_questions").upsert(updatePayload, { onConflict: "id" });
    if (error) return { ok: false, error: error.message };
  }

  if (toInsert.length > 0) {
    const insertPayload = toInsert.map((q) => ({
      ...(q.id ? { id: q.id } : {}),
      survey_id: surveyId,
      position: questions.indexOf(q),
      type: q.type,
      text: q.text,
      options: q.options,
      required: q.required,
      allow_multiple: q.allow_multiple,
      show_if: q.show_if ?? null,
      is_hall_selector: q.is_hall_selector ?? false,
    }));
    const { error } = await supabase.from("survey_questions").insert(insertPayload);
    if (error) return { ok: false, error: error.message };
  }

  return { ok: true };
}
