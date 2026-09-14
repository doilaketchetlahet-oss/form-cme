import { supabase } from "./supabase";

export type SurveyQuestionType = "rating" | "nps" | "choice" | "text" | "paragraph" | "phone" | "date" | "province" | "section" | "image_banner" | "file_upload" | "signature" | "face_checkin";
export type SurveyFormType = "registration" | "poster_scoring" | "feedback";
export type PaymentStatus = "not_required" | "pending" | "paid" | "cancelled" | "expired" | "failed";

export interface PaymentConfig {
  enabled?: boolean;
  amount?: number;
  itemName?: string;
  description?: string;
  expiresInMinutes?: number;
}

export interface Survey {
  id: string;
  quiz_id: string;
  form_type: SurveyFormType;
  position: number;
  title: string;
  is_anonymous: boolean;
  thank_you_message: string;
  banner_url: string | null;
  accent_color: string | null;
  redirect_url: string | null;
  redirect_delay: number;
  email_subject: string | null;
  email_body: string | null;
  checkin_pin: string | null;
  checkin_theme: CheckinTheme | null;
  scoring_config: ScoringConfig | null;
  payment_config: PaymentConfig | null;
  vip_checkin_enabled: boolean;
  is_closed: boolean;
  close_at: string | null;
  created_at: string;
}

export interface ScoringCriterionConfig {
  questionId: string;
  label?: string;
  weight?: number;
}

export interface ScoringConfig {
  enabled?: boolean;
  judgeQuestionId?: string | null;
  posterQuestionId?: string | null;
  criteria?: ScoringCriterionConfig[];
  duplicateMode?: "latest" | "all";
}

export interface CheckinTheme {
  backgroundImage?: string | null;
  leftLogo?: string | null;
  rightLogo?: string | null;
  conferenceName?: string;
  date?: string;
  venue?: string;
  organizer?: string;
  accentColor?: string;
  overlayOpacity?: number; // 0-100, default 40
  qr?: QRBranding;
  sessionsEnabled?: boolean;
}

export interface QRBranding {
  darkColor?: string;
  accentColor?: string;
  lightColor?: string;
  logoUrl?: string | null;
  logoEnabled?: boolean;
  logoSize?: number; // 12-28 percent
  moduleRadius?: number; // 0-50 percent
}

export interface SurveyQuestion {
  id: string;
  survey_id: string;
  position: number;
  type: SurveyQuestionType;
  text: string;
  options: string[] | null;
  required: boolean;
  allow_multiple: boolean;
  show_if: { question_id: string; operator: "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "contains" | "not_contains"; value: string | number } | null;
  is_hall_selector?: boolean;
}

export interface SurveyResponse {
  id: string;
  survey_id: string;
  answers: Record<string, string | number | number[]>;
  submitted_at: string;
  checked_in?: boolean;
  checked_in_at?: string | null;
  hall?: string | null;
  email?: string | null;
  email_status?: "pending" | "sent" | "failed" | null;
  email_sent_at?: string | null;
  email_last_attempt_at?: string | null;
  email_error?: string | null;
  email_provider?: string | null;
  email_last_event?: string | null;
  email_delivered_at?: string | null;
  email_opened_at?: string | null;
  email_bounced_at?: string | null;
  session_checkins?: Record<string, string> | null;
  payment_status?: PaymentStatus | null;
  payment_amount?: number | null;
  payment_order_code?: number | null;
  payment_link_id?: string | null;
  payment_checkout_url?: string | null;
  payment_reference?: string | null;
  payment_payer_name?: string | null;
  payment_payer_bank?: string | null;
  payment_payer_account?: string | null;
  payment_transaction_datetime?: string | null;
  paid_at?: string | null;
  payment_raw?: Record<string, unknown> | null;
  payment_error?: string | null;
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listSurveys(quizId: string): Promise<Survey[]> {
  const { data } = await supabase.from("surveys").select("*")
    .eq("quiz_id", quizId).order("position");
  return data ?? [];
}

export async function createSurvey(quizId: string, position: number, title = "Khảo sát"): Promise<Survey | null> {
  const { data, error } = await supabase.from("surveys")
    .insert({ quiz_id: quizId, position, title })
    .select().single();
  if (error) { console.error(error); return null; }
  return data;
}

export async function updateSurvey(id: string, patch: Partial<Pick<Survey, "title" | "form_type" | "is_anonymous" | "position" | "thank_you_message" | "banner_url" | "accent_color" | "redirect_url" | "redirect_delay" | "email_subject" | "email_body" | "checkin_pin" | "checkin_theme" | "scoring_config" | "payment_config" | "vip_checkin_enabled" | "is_closed" | "close_at">>): Promise<void> {
  await supabase.from("surveys").update(patch).eq("id", id);
}

export async function deleteSurvey(id: string): Promise<void> {
  await supabase.from("surveys").delete().eq("id", id);
}

export async function listSurveyQuestions(surveyId: string): Promise<SurveyQuestion[]> {
  const { data } = await supabase.from("survey_questions").select("*")
    .eq("survey_id", surveyId).order("position");
  return data ?? [];
}

// Returns map { surveyId: questionCount } for all surveys in a quiz
export async function getSurveyQuestionCounts(quizId: string): Promise<Record<string, number>> {
  const { data: surveys } = await supabase.from("surveys").select("id").eq("quiz_id", quizId);
  if (!surveys || surveys.length === 0) return {};
  const ids = surveys.map((s) => s.id);
  const { data: questions } = await supabase.from("survey_questions")
    .select("survey_id").in("survey_id", ids);
  const counts: Record<string, number> = {};
  (questions ?? []).forEach((q: { survey_id: string }) => {
    counts[q.survey_id] = (counts[q.survey_id] ?? 0) + 1;
  });
  return counts;
}

// Question payload for upsert: id is optional (present = update existing, absent = insert new)
export type SurveyQuestionUpsert = { id?: string } & Omit<SurveyQuestion, "id" | "survey_id">;

export async function upsertSurveyQuestions(
  surveyId: string,
  questions: SurveyQuestionUpsert[]
): Promise<{ ok: boolean; error?: string }> {
  // 1. Find which existing questions to delete (those whose id is no longer in the incoming list)
  const { data: existing } = await supabase.from("survey_questions")
    .select("id").eq("survey_id", surveyId);
  const existingIds = new Set((existing ?? []).map((e: { id: string }) => e.id));
  const incomingIds = new Set(questions.filter((q) => q.id).map((q) => q.id as string));
  const toDelete = [...existingIds].filter((id) => !incomingIds.has(id));

  if (toDelete.length > 0) {
    const { error } = await supabase.from("survey_questions").delete().in("id", toDelete);
    if (error) {
      console.error("Failed to delete removed survey questions:", error);
      return { ok: false, error: error.message };
    }
  }

  if (questions.length === 0) return { ok: true };

  // 2. Split by what already exists in DB. New questions can already have a
  // client-generated UUID so conditional logic can reference them before save.
  const toUpdate = questions.filter((q) => !!q.id && existingIds.has(q.id));
  const toInsert = questions.filter((q) => !q.id || !existingIds.has(q.id as string));

  // Update existing questions
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
    if (error) {
      console.error("Failed to update survey questions:", error);
      return { ok: false, error: error.message };
    }
  }

  // Insert new questions (let DB generate id)
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
    if (error) {
      console.error("Failed to insert survey questions:", error);
      return { ok: false, error: error.message };
    }
  }

  return { ok: true };
}

// ─── Responses ────────────────────────────────────────────────────────────────

export async function submitSurveyResponse(
  surveyId: string,
  answers: Record<string, string | number | number[]>,
  email?: string | null,
  hall?: string | null
): Promise<{ ok: boolean; responseId?: string; duplicate?: boolean }> {
  // Normalize email (case-insensitive dedupe)
  const normEmail = email ? email.trim().toLowerCase() : null;

  // Dedupe by email: if same email already registered for this survey, return existing
  if (normEmail) {
    const { data: existing } = await supabase
      .from("survey_responses")
      .select("id")
      .eq("survey_id", surveyId)
      .ilike("email", normEmail)
      .order("submitted_at", { ascending: true })
      .limit(1);
    if (existing && existing.length > 0) {
      return { ok: true, responseId: existing[0].id, duplicate: true };
    }
  }

  const { data, error } = await supabase.from("survey_responses").insert({
    survey_id: surveyId,
    answers,
    ...(normEmail ? { email: normEmail } : {}),
    ...(normEmail ? { email_status: "pending" } : {}),
    ...(hall ? { hall } : {}),
  }).select("id").single();
  if (error) {
    if (error.code === "23505") {
      console.warn("Survey already submitted by this email");
      return { ok: true };
    }
    console.error("Survey submit failed:", error);
    return { ok: false };
  }
  return { ok: true, responseId: data?.id };
}

// ─── Analytics ────────────────────────────────────────────────────────────────

export interface SurveyAnalytics {
  survey: Survey;
  questions: SurveyQuestion[];
  responses: SurveyResponse[];
  totalResponses: number;
  questionStats: QuestionStat[];
}

export interface QuestionStat {
  question: SurveyQuestion;
  // Rating/NPS
  avg?: number;
  distribution?: number[]; // count per value
  // Choice
  choiceCounts?: number[];
  // Text
  textAnswers?: string[];
}

export async function getSurveyAnalytics(surveyId: string): Promise<SurveyAnalytics | null> {
  const [{ data: survey }, { data: questions }, { data: responses }] = await Promise.all([
    supabase.from("surveys").select("*").eq("id", surveyId).single(),
    supabase.from("survey_questions").select("*").eq("survey_id", surveyId).order("position"),
    supabase.from("survey_responses").select("*").eq("survey_id", surveyId),
  ]);

  if (!survey || !questions) return null;

  return computeSurveyAnalytics(survey, questions, responses ?? []);
}

function computeSurveyAnalytics(survey: Survey, questions: SurveyQuestion[], allResponses: SurveyResponse[]): SurveyAnalytics {

  const questionStats: QuestionStat[] = (questions as SurveyQuestion[]).map((q) => {
    const answers = allResponses.map((r) => r.answers[q.id]).filter((a) => a !== undefined && a !== "");

    if (q.type === "rating") {
      const nums = answers.map(Number).filter((n) => !isNaN(n));
      const dist = new Array(5).fill(0);
      nums.forEach((n) => { if (n >= 1 && n <= 5) dist[n - 1]++; });
      return { question: q, avg: nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0, distribution: dist };
    }

    if (q.type === "nps") {
      const nums = answers.map(Number).filter((n) => !isNaN(n));
      const dist = new Array(11).fill(0);
      nums.forEach((n) => { if (n >= 0 && n <= 10) dist[n]++; });
      return { question: q, avg: nums.length > 0 ? nums.reduce((a, b) => a + b, 0) / nums.length : 0, distribution: dist };
    }

    if (q.type === "choice") {
      const counts = new Array(q.options?.length ?? 0).fill(0);
      answers.forEach((a) => {
        const idxs = Array.isArray(a) ? a : [Number(a)];
        idxs.forEach((idx) => { if (idx >= 0 && idx < counts.length) counts[idx]++; });
      });
      return { question: q, choiceCounts: counts };
    }

    // text
    return { question: q, textAnswers: answers.map(String).filter(Boolean) };
  });

  return {
    survey,
    questions: questions as SurveyQuestion[],
    responses: allResponses,
    totalResponses: allResponses.length,
    questionStats,
  };
}



// ─── CSV Export ───────────────────────────────────────────────────────────────

function escapeCsv(val: string | number | null | undefined): string {
  if (val === null || val === undefined) return "";
  const s = String(val);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function buildSurveyResponsesCSV(analytics: SurveyAnalytics): string {
  const { survey, questions, responses } = analytics;
  // Skip section + image_banner — they aren't answerable, no data to export
  const exportable = questions.filter((q) => q.type !== "section" && q.type !== "image_banner");

  const cols = ["Thời gian"];
  if (!survey.is_anonymous) cols.push("Tên người chơi");
  exportable.forEach((q) => cols.push(q.text));

  const rows = [cols.map(escapeCsv).join(",")];

  responses.forEach((r) => {
    const row: (string | number)[] = [new Date(r.submitted_at).toLocaleString("vi-VN")];
    exportable.forEach((q) => {
      const ans = r.answers[q.id];
      if (ans === undefined || ans === null || ans === "") {
        row.push("");
      } else if (q.type === "choice" && Array.isArray(ans)) {
        row.push(ans.map((i) => q.options?.[Number(i)] ?? `#${i}`).join("; "));
      } else if (q.type === "choice") {
        row.push(q.options?.[Number(ans)] ?? `#${ans}`);
      } else if (q.type === "date" && typeof ans === "string" && /^\d{4}-\d{2}-\d{2}$/.test(ans)) {
        const [y, m, d] = ans.split("-");
        row.push(`${d}/${m}/${y}`);
      } else {
        row.push(String(ans));
      }
    });
    rows.push(row.map(escapeCsv).join(","));
  });

  return "\uFEFF" + rows.join("\n");
}
