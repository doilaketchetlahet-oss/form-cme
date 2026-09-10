import { supabase } from "./supabase";
import {
  upsertSurveyQuestions,
  type CheckinTheme,
  type PaymentConfig,
  type ScoringConfig,
  type Survey,
  type SurveyFormType,
  type SurveyQuestion,
  type SurveyQuestionUpsert,
} from "./surveys";

export interface RegistrationFormSummary {
  id: string; // survey id
  containerId: string; // legacy quizzes.id container
  title: string;
  formType: SurveyFormType;
  createdAt: string;
  responseCount: number;
  checkinCount: number;
  questionCount: number;
  vipCheckinEnabled: boolean;
  accentColor: string | null;
}

export type RegistrationFormSave = {
  title: string;
  form_type: SurveyFormType;
  is_anonymous: boolean;
  thank_you_message: string;
  banner_url: string | null;
  redirect_url: string | null;
  redirect_delay: number;
  email_subject: string | null;
  email_body: string | null;
  checkin_pin: string | null;
  checkin_theme: CheckinTheme | null;
  scoring_config: ScoringConfig | null;
  payment_config: PaymentConfig | null;
  vip_checkin_enabled: boolean;
  questions: SurveyQuestionUpsert[];
};

const DEFAULT_FORM_QUESTIONS: SurveyQuestionUpsert[] = [
  {
    position: 0,
    type: "text",
    text: "Họ và tên",
    options: null,
    required: true,
    allow_multiple: false,
    show_if: null,
    is_hall_selector: false,
  },
  {
    position: 1,
    type: "phone",
    text: "Số điện thoại",
    options: null,
    required: true,
    allow_multiple: false,
    show_if: null,
    is_hall_selector: false,
  },
  {
    position: 2,
    type: "text",
    text: "Email",
    options: null,
    required: true,
    allow_multiple: false,
    show_if: null,
    is_hall_selector: false,
  },
];

const DEFAULT_POSTER_SCORING_QUESTIONS: SurveyQuestionUpsert[] = [
  {
    position: 0,
    type: "choice",
    text: "Tên giám khảo",
    options: ["Giám khảo 1", "Giám khảo 2", "Giám khảo 3"],
    required: true,
    allow_multiple: false,
    show_if: null,
    is_hall_selector: false,
  },
  {
    position: 1,
    type: "choice",
    text: "Poster",
    options: ["Poster 01", "Poster 02", "Poster 03"],
    required: true,
    allow_multiple: false,
    show_if: null,
    is_hall_selector: false,
  },
  {
    position: 2,
    type: "nps",
    text: "Tính khoa học",
    options: ["Chưa đạt", "Xuất sắc", "10"],
    required: true,
    allow_multiple: false,
    show_if: null,
    is_hall_selector: false,
  },
  {
    position: 3,
    type: "nps",
    text: "Hình thức trình bày",
    options: ["Chưa đạt", "Xuất sắc", "10"],
    required: true,
    allow_multiple: false,
    show_if: null,
    is_hall_selector: false,
  },
];

function normalizeFormType(value: unknown): SurveyFormType {
  return value === "poster_scoring" || value === "feedback" ? value : "registration";
}

function newQuestionId() {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
}

function getDefaultQuestions(formType: SurveyFormType) {
  const source = formType === "poster_scoring" ? DEFAULT_POSTER_SCORING_QUESTIONS : DEFAULT_FORM_QUESTIONS;
  return source.map((question, index) => ({
    ...question,
    id: newQuestionId(),
    position: index,
    options: question.options ? [...question.options] : null,
  }));
}

function isMissingColumn(error: { code?: string; message?: string } | null | undefined, column: string) {
  const message = error?.message?.toLowerCase() ?? "";
  return message.includes(column.toLowerCase()) && (
    error?.code === "PGRST204"
    || message.includes("schema cache")
    || message.includes("column")
  );
}

export async function listRegistrationForms(): Promise<RegistrationFormSummary[]> {
  const { data: containers, error } = await supabase
    .from("quizzes")
    .select("id, title, created_at, updated_at")
    .order("updated_at", { ascending: false });

  if (error || !containers || containers.length === 0) return [];

  const containerIds = containers.map((item) => item.id);
  const surveysResult = await supabase
    .from("surveys")
    .select("id, quiz_id, title, form_type, created_at, accent_color, vip_checkin_enabled")
    .in("quiz_id", containerIds)
    .order("created_at", { ascending: false });

  let surveys = surveysResult.data as ({
    id: string;
    quiz_id: string;
    title: string;
    form_type?: unknown;
    created_at: string;
    accent_color: string | null;
    vip_checkin_enabled: boolean;
  }[] | null);

  if (isMissingColumn(surveysResult.error, "form_type")) {
    const fallbackResult = await supabase
      .from("surveys")
      .select("id, quiz_id, title, created_at, accent_color, vip_checkin_enabled")
      .in("quiz_id", containerIds)
      .order("created_at", { ascending: false });
    surveys = fallbackResult.data as typeof surveys;
  }

  if (!surveys || surveys.length === 0) return [];

  const surveyIds = surveys.map((survey) => survey.id);
  const [{ data: responses }, { data: questions }] = await Promise.all([
    supabase
      .from("survey_responses")
      .select("survey_id, checked_in")
      .in("survey_id", surveyIds),
    supabase
      .from("survey_questions")
      .select("survey_id")
      .in("survey_id", surveyIds),
  ]);

  const containerById = new Map(containers.map((item) => [item.id, item]));

  return surveys.map((survey) => {
    const responseRows = (responses ?? []).filter((row) => row.survey_id === survey.id);
    return {
      id: survey.id,
      containerId: survey.quiz_id,
      title: survey.title || containerById.get(survey.quiz_id)?.title || "Form đăng ký",
      formType: normalizeFormType((survey as { form_type?: unknown }).form_type),
      createdAt: survey.created_at,
      responseCount: responseRows.length,
      checkinCount: responseRows.filter((row) => !!row.checked_in).length,
      questionCount: (questions ?? []).filter((row) => row.survey_id === survey.id).length,
      vipCheckinEnabled: !!survey.vip_checkin_enabled,
      accentColor: survey.accent_color ?? null,
    };
  });
}

export async function createRegistrationForm(
  ownerId: string,
  title = "Form đăng ký CME",
  formType: SurveyFormType = "registration",
): Promise<string | null> {
  const normalizedFormType = normalizeFormType(formType);
  const defaultQuestions = getDefaultQuestions(normalizedFormType);
  const { data: container, error: containerError } = await supabase
    .from("quizzes")
    .insert({
      owner_id: ownerId,
      title,
      description: "Registration form container",
    })
    .select("id")
    .single();

  if (containerError || !container) {
    console.error("Create form container failed:", containerError);
    return null;
  }

  let surveyResult = await supabase
    .from("surveys")
    .insert({
      quiz_id: container.id,
      form_type: normalizedFormType,
      position: 0,
      title,
      is_anonymous: true,
      thank_you_message: normalizedFormType === "poster_scoring" ? "Cảm ơn ban giám khảo đã chấm điểm!" : "Cảm ơn bạn đã đăng ký!",
      scoring_config: normalizedFormType === "poster_scoring"
        ? {
            enabled: true,
            judgeQuestionId: defaultQuestions[0]?.id ?? null,
            posterQuestionId: defaultQuestions[1]?.id ?? null,
            criteria: defaultQuestions.slice(2).map((question) => ({
              questionId: question.id!,
              label: question.text,
              weight: 1,
            })),
            duplicateMode: "latest",
          }
        : null,
    })
    .select("id")
    .single();

  if (
    normalizedFormType === "registration"
    && (isMissingColumn(surveyResult.error, "form_type") || isMissingColumn(surveyResult.error, "scoring_config"))
  ) {
    surveyResult = await supabase
      .from("surveys")
      .insert({
        quiz_id: container.id,
        position: 0,
        title,
        is_anonymous: true,
        thank_you_message: "Cảm ơn bạn đã đăng ký!",
      })
      .select("id")
      .single();
  }

  const { data: survey, error: surveyError } = surveyResult;

  if (surveyError || !survey) {
    console.error("Create registration form failed:", surveyError);
    await supabase.from("quizzes").delete().eq("id", container.id);
    return null;
  }

  const result = await upsertSurveyQuestions(survey.id, defaultQuestions);
  if (!result.ok) {
    await supabase.from("quizzes").delete().eq("id", container.id);
    return null;
  }

  return survey.id;
}

export async function getRegistrationForm(
  surveyId: string
): Promise<(Survey & { questions: SurveyQuestion[] }) | null> {
  const [{ data: survey }, { data: questions }] = await Promise.all([
    supabase.from("surveys").select("*").eq("id", surveyId).single(),
    supabase.from("survey_questions").select("*").eq("survey_id", surveyId).order("position"),
  ]);

  if (!survey) return null;
  return { ...(survey as Survey), questions: (questions ?? []) as SurveyQuestion[] };
}

export async function saveRegistrationForm(surveyId: string, payload: RegistrationFormSave): Promise<{ ok: boolean; error?: string }> {
  try {
    const { data: survey, error: loadError } = await supabase.from("surveys").select("quiz_id").eq("id", surveyId).single();
    if (loadError) return { ok: false, error: loadError.message };
    if (!survey?.quiz_id) return { ok: false, error: "Form not found" };

    const { error: surveyError } = await supabase
      .from("surveys")
      .update({
        title: payload.title,
        form_type: payload.form_type,
        is_anonymous: true,
        thank_you_message: payload.thank_you_message,
        banner_url: payload.banner_url,
        redirect_url: payload.redirect_url,
        redirect_delay: payload.redirect_delay,
        email_subject: payload.email_subject,
        email_body: payload.email_body,
        checkin_pin: payload.checkin_pin,
        checkin_theme: payload.checkin_theme,
        scoring_config: payload.scoring_config,
        payment_config: payload.payment_config,
        vip_checkin_enabled: payload.vip_checkin_enabled,
      })
      .eq("id", surveyId);

    if (surveyError) {
      const missingFormType = isMissingColumn(surveyError, "form_type");
      const missingScoringConfig = isMissingColumn(surveyError, "scoring_config");
      const missingPaymentConfig = isMissingColumn(surveyError, "payment_config");

      if (missingScoringConfig && payload.scoring_config) {
        return { ok: false, error: "Database chưa có cột scoring_config. Hãy chạy supabase/scoring-config.sql." };
      }
      if (missingPaymentConfig && payload.payment_config) {
        return { ok: false, error: "Database chưa có cột payment_config. Hãy chạy supabase/payos-payments.sql." };
      }
      if (missingFormType && payload.form_type !== "registration") {
        return { ok: false, error: "Database chưa có cột form_type. Hãy chạy supabase/form-types.sql." };
      }

      if (missingFormType || missingScoringConfig || missingPaymentConfig) {
        const { error: fallbackError } = await supabase
          .from("surveys")
          .update({
            title: payload.title,
            ...(missingFormType ? {} : { form_type: payload.form_type }),
            is_anonymous: true,
            thank_you_message: payload.thank_you_message,
            banner_url: payload.banner_url,
            redirect_url: payload.redirect_url,
            redirect_delay: payload.redirect_delay,
            email_subject: payload.email_subject,
            email_body: payload.email_body,
            checkin_pin: payload.checkin_pin,
            checkin_theme: payload.checkin_theme,
            ...(missingScoringConfig ? {} : { scoring_config: payload.scoring_config }),
            ...(missingPaymentConfig ? {} : { payment_config: payload.payment_config }),
            vip_checkin_enabled: payload.vip_checkin_enabled,
          })
          .eq("id", surveyId);
        if (fallbackError) return { ok: false, error: fallbackError.message };
      } else {
        return { ok: false, error: surveyError.message };
      }
    }

    const { error: quizError } = await supabase
      .from("quizzes")
      .update({ title: payload.title, updated_at: new Date().toISOString() })
      .eq("id", survey.quiz_id);

    if (quizError) return { ok: false, error: quizError.message };

    const questionResult = await upsertSurveyQuestions(surveyId, payload.questions);
    return questionResult.ok ? { ok: true } : questionResult;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : "Save failed" };
  }
}

export async function deleteRegistrationForm(surveyId: string): Promise<void> {
  const { data: survey } = await supabase.from("surveys").select("quiz_id").eq("id", surveyId).single();
  if (survey?.quiz_id) {
    await supabase.from("quizzes").delete().eq("id", survey.quiz_id);
    return;
  }
  await supabase.from("surveys").delete().eq("id", surveyId);
}
