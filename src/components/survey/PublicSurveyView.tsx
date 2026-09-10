"use client";
import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ClipboardList, Send, ListChecks, AlertCircle, CreditCard } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { submitSurveyResponse, type PaymentConfig, type Survey, type SurveyQuestion } from "@/lib/surveys";
import { VIETNAM_PROVINCES as PROVINCES } from "@/lib/provinces";
import { normalizeAnswer, normalizePhone } from "@/lib/normalize";
import { QRCodeView } from "@/components/ui/QRCodeView";
import { SurveyFileUpload } from "@/components/survey/SurveyFileUpload";
import { SurveySignaturePad } from "@/components/survey/SurveySignaturePad";
import { FaceCheckinQuestion } from "@/components/survey/FaceCheckinQuestion";
import { saveFaceRegistration } from "@/lib/ekyc";
import { buildPublicUrl } from "@/lib/site-url";

const CHOICE_COLORS = ["#4f46e5", "#0891b2", "#b45309", "#db2777", "#059669", "#7c3aed"];
const VN_PHONE_RE = /^0[3-9]\d{8}$/;
const STORAGE_KEY = (id: string) => `public_survey_done::${id}`;
const DRAFT_KEY = (id: string) => `public_survey_draft::${id}`;
const DRAFT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

interface Props { surveyId: string; preview?: boolean; }
type SurveyAnswerValue = string | number | number[];

function hasSubmittedSurvey(surveyId: string) {
  return typeof window !== "undefined" && localStorage.getItem(STORAGE_KEY(surveyId)) !== null;
}

function isCheckinForm(survey: Survey | null) {
  return !survey?.form_type || survey.form_type === "registration";
}

function getActivePaymentConfig(survey: Survey | null): Required<PaymentConfig> | null {
  const config = survey?.payment_config;
  const amount = Number(config?.amount ?? 0);
  if (!isCheckinForm(survey) || !config?.enabled || !Number.isFinite(amount) || amount <= 0) return null;

  return {
    enabled: true,
    amount: Math.round(amount),
    itemName: config.itemName?.trim() || "Vé tham dự",
    description: config.description?.trim() || "Phí đăng ký",
    expiresInMinutes: Math.max(5, Math.min(7 * 24 * 60, Number(config.expiresInMinutes ?? 60) || 60)),
  };
}

function formatVnd(amount: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}

function loadInitialDraft(surveyId: string): Record<string, SurveyAnswerValue> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(DRAFT_KEY(surveyId));
    if (!raw) return {};
    const draft = JSON.parse(raw) as { ts: number; answers: Record<string, SurveyAnswerValue> };
    if (Date.now() - draft.ts < DRAFT_MAX_AGE_MS) return draft.answers;
    localStorage.removeItem(DRAFT_KEY(surveyId));
  } catch { /* ignore */ }
  return {};
}

export function PublicSurveyView({ surveyId, preview = false }: Props) {
  const [survey, setSurvey] = useState<Survey | null>(null);
  const [questions, setQuestions] = useState<SurveyQuestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [answers, setAnswers] = useState<Record<string, SurveyAnswerValue>>(() => preview ? {} : loadInitialDraft(surveyId));
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showValidation, setShowValidation] = useState(false);
  const [responseId, setResponseId] = useState<string | null>(null);
  const [isDuplicate, setIsDuplicate] = useState(false);
  const [accent, setAccent] = useState("#6366f1"); // default indigo (matches ThemeEditor default)
  const firstInvalidRef = useRef<HTMLDivElement | null>(null);

  const [quizLogo, setQuizLogo] = useState<string | null>(null);
  const [quizBrand, setQuizBrand] = useState<string | null>(null);

  // eKYC face data ref — stores photo URL + embedding for face_checkin questions
  const faceDataRef = useRef<{ photoUrl: string; embedding: number[]; responseId: string } | null>(null);

  useEffect(() => {
    (async () => {
      const [{ data: s }, { data: qs }] = await Promise.all([
        supabase.from("surveys").select("*").eq("id", surveyId).single(),
        supabase.from("survey_questions").select("*").eq("survey_id", surveyId).order("position"),
      ]);
      if (!s) { setNotFound(true); setLoading(false); return; }
      const loadedSurvey = s as Survey;
      setSurvey(loadedSurvey);
      setQuestions(qs ?? []);
      if (s.accent_color) setAccent(s.accent_color);
      if (!preview && isCheckinForm(loadedSurvey) && hasSubmittedSurvey(surveyId)) {
        setSubmitted(true);
      }
      // Load quiz logo/brand (best-effort, may fail due to RLS)
      if (s.quiz_id) {
        const { data: quiz } = await supabase.from("quizzes").select("logo_url, brand_name").eq("id", s.quiz_id).single();
        if (quiz) { setQuizLogo(quiz.logo_url); setQuizBrand(quiz.brand_name); }
      }
      setLoading(false);
    })();
  }, [surveyId, preview]);

  const setAnswer = (qId: string, val: string | number | number[]) => {
    setAnswers((prev) => ({ ...prev, [qId]: val }));
  };

  // Auto-save draft to localStorage (debounced 500ms). Cleared on submit / 7d expiry.
  useEffect(() => {
    if (preview || submitted) return;
    if (Object.keys(answers).length === 0) return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(DRAFT_KEY(surveyId), JSON.stringify({ ts: Date.now(), answers }));
      } catch { /* quota exceeded — ignore */ }
    }, 500);
    return () => clearTimeout(t);
  }, [answers, preview, submitted, surveyId]);

  // Evaluate show_if condition — recursive: if parent is hidden, child is also hidden
  const isQuestionVisible = (q: SurveyQuestion): boolean => {
    if (!q.show_if) return true;
    const { question_id, operator, value } = q.show_if;

    // First check: is the parent question itself visible? (recursive)
    const parentQ = questions.find((p) => p.id === question_id);
    if (parentQ && !isQuestionVisible(parentQ)) return false;

    const ans = answers[question_id];
    if (ans === undefined || ans === "") return false;

    // Array answer (multi-choice)
    if (Array.isArray(ans)) {
      const numVal = typeof value === "number" ? value : Number(value);
      const arr = ans as number[];
      switch (operator) {
        case "contains":
        case "eq":
          return arr.includes(numVal);
        case "not_contains":
        case "neq":
          return !arr.includes(numVal);
        default:
          return false;
      }
    }

    const numAns = typeof ans === "number" ? ans : Number(ans);
    const numVal = typeof value === "number" ? value : Number(value);
    const strAns = String(ans).toLowerCase();
    const strVal = String(value).toLowerCase();

    switch (operator) {
      case "eq": return ans == value || numAns === numVal;
      case "neq": return ans != value && numAns !== numVal;
      case "lt": return numAns < numVal;
      case "lte": return numAns <= numVal;
      case "gt": return numAns > numVal;
      case "gte": return numAns >= numVal;
      case "contains": return strAns.includes(strVal);
      case "not_contains": return !strAns.includes(strVal);
      default: return true;
    }
  };

  const getInvalidQuestions = (): string[] => {
    return questions
      .filter((q) => q.required && q.type !== "section" && q.type !== "image_banner")
      .filter((q) => isQuestionVisible(q))
      .filter((q) => {
        const a = answers[q.id];
        if (a === undefined || a === "") return true;
        if (Array.isArray(a) && a.length === 0) return true;
        if (q.type === "phone" && typeof a === "string" && !VN_PHONE_RE.test(a)) return true;
        return false;
      })
      .map((q) => q.id);
  };

  const isComplete = getInvalidQuestions().length === 0;

  const handleSubmit = async () => {
    if (preview) {
      setShowValidation(true);
      setError("Đây là chế độ xem trước. Form sẽ không ghi dữ liệu.");
      return;
    }
    if (submitting) return;
    if (!isComplete) {
      setShowValidation(true);
      // Scroll to first invalid
      setTimeout(() => firstInvalidRef.current?.scrollIntoView({ behavior: "smooth", block: "center" }), 100);
      return;
    }
    if (!survey) return;
    setSubmitting(true);
    setError(null);

    // Normalize answers (phone format, name title-case, trim spaces) by question type
    const normalized: Record<string, string | number | number[]> = {};
    for (const [qId, val] of Object.entries(answers)) {
      const q = questions.find((x) => x.id === qId);
      normalized[qId] = q ? normalizeAnswer(val, q.type) : val;
    }

    const allowCheckin = isCheckinForm(survey);
    const paymentConfig = getActivePaymentConfig(survey);

    // Extract email from answers (used for dedupe + sending on registration forms)
    let emailAnswer = "";
    let nameAnswer = "";
    for (const val of Object.values(normalized)) {
      const s = String(val ?? "").trim();
      if (!emailAnswer && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) emailAnswer = s;
      else if (!nameAnswer && typeof val === "string" && val.length > 1 && val.length < 50 && !/[@\d]/.test(val)) nameAnswer = val;
    }

    // Extract hall from the hall-selector question (if any)
    let hallValue: string | null = null;
    const hallQ = allowCheckin ? questions.find((q) => q.is_hall_selector && q.type === "choice") : null;
    if (hallQ) {
      const ans = normalized[hallQ.id];
      const idx = Array.isArray(ans) ? ans[0] : ans;
      if (typeof idx === "number" && hallQ.options?.[idx]) {
        hallValue = hallQ.options[idx];
      }
    }

    if (allowCheckin && paymentConfig) {
      const paymentRes = await fetch("/api/payos/create-payment", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surveyId: survey.id,
          answers: normalized,
          email: emailAnswer || null,
          name: nameAnswer || null,
          hall: hallValue,
        }),
      });
      const paymentResult = await paymentRes.json().catch(() => null) as {
        ok?: boolean;
        error?: string;
        responseId?: string;
        checkoutUrl?: string;
        alreadyPaid?: boolean;
        duplicate?: boolean;
      } | null;

      if (!paymentRes.ok || !paymentResult?.ok) {
        setError(paymentResult?.error || "Không tạo được link thanh toán. Vui lòng thử lại.");
        setSubmitting(false);
        return;
      }

      if (paymentResult.responseId && faceDataRef.current) {
        saveFaceRegistration(supabase, {
          response_id: paymentResult.responseId,
          survey_id: survey.id,
          photo_url: faceDataRef.current.photoUrl,
          embedding: faceDataRef.current.embedding,
        }).catch(() => {});
      }

      localStorage.removeItem(DRAFT_KEY(surveyId));

      if (paymentResult.alreadyPaid && paymentResult.responseId) {
        localStorage.setItem(STORAGE_KEY(surveyId), "1");
        setResponseId(paymentResult.responseId);
        setIsDuplicate(!!paymentResult.duplicate);
        setSubmitted(true);
        setSubmitting(false);
        return;
      }

      if (paymentResult.checkoutUrl) {
        window.location.assign(paymentResult.checkoutUrl);
        return;
      }

      setError("PayOS chưa trả về link thanh toán. Vui lòng thử lại.");
      setSubmitting(false);
      return;
    }

    const result = await submitSurveyResponse(
      survey.id,
      normalized,
      allowCheckin ? emailAnswer || null : null,
      allowCheckin ? hallValue : null,
    );
    if (result.ok) {
      if (allowCheckin) localStorage.setItem(STORAGE_KEY(surveyId), "1");
      localStorage.removeItem(DRAFT_KEY(surveyId));
      setResponseId(result.responseId ?? null);
      setIsDuplicate(!!result.duplicate);
      setSubmitted(true);

      // Save face registration data if face_checkin question was answered
      if (allowCheckin && result.responseId && faceDataRef.current) {
        saveFaceRegistration(supabase, {
          response_id: result.responseId,
          survey_id: survey.id,
          photo_url: faceDataRef.current.photoUrl,
          embedding: faceDataRef.current.embedding,
        }).catch(() => {});
      }

      // Send email only for NEW registrations (not duplicates)
      if (allowCheckin && result.responseId && emailAnswer && !result.duplicate) {
        const markEmail = (status: "sent" | "failed", error?: string) => {
          void supabase.from("survey_responses").update({
            email_status: status,
            email_last_attempt_at: new Date().toISOString(),
            email_sent_at: status === "sent" ? new Date().toISOString() : null,
            email_error: status === "failed" ? error ?? "Gửi email thất bại" : null,
          }).eq("id", result.responseId);
        };

        fetch("/api/send-checkin-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: emailAnswer,
            name: nameAnswer,
            checkinUrl: buildPublicUrl(`/checkin/${result.responseId}`),
            surveyTitle: survey?.title || "",
            customSubject: (survey as unknown as Record<string, unknown>)?.email_subject || "",
            customBody: (survey as unknown as Record<string, unknown>)?.email_body || "",
            responseId: result.responseId,
            qrStyle: survey?.checkin_theme?.qr ?? null,
            answers: normalized,
            hall: hallValue,
          }),
        })
          .then(async (response) => {
            if (response.ok) {
              markEmail("sent");
              return;
            }
            const body = await response.json().catch(() => null);
            markEmail("failed", body?.detail || body?.error || "Gửi email thất bại");
          })
          .catch((error) => markEmail("failed", error instanceof Error ? error.message : "Gửi email thất bại"));
      }
    } else {
      setError("Gửi thất bại. Vui lòng thử lại.");
    }
    setSubmitting(false);
  };

  // ─── Loading ────────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="min-h-dvh bg-slate-50">
        <div className="max-w-lg mx-auto px-4 py-8">
          {/* Header skeleton */}
          <div className="mb-8">
            <div className="h-10 w-32 mx-auto bg-slate-200 rounded-lg animate-pulse mb-4" />
            <div className="h-7 w-3/4 bg-slate-200 rounded-lg animate-pulse mb-2" />
            <div className="h-4 w-24 bg-slate-200 rounded animate-pulse" />
          </div>
          {/* Question card skeletons */}
          <div className="flex flex-col gap-5">
            {[0, 1, 2].map((i) => (
              <div key={i} className="bg-white rounded-2xl p-5 shadow-sm border border-slate-100 animate-pulse">
                <div className="h-4 w-2/3 bg-slate-200 rounded mb-4" />
                <div className="h-12 bg-slate-100 rounded-xl mb-2" />
                <div className="h-12 bg-slate-100 rounded-xl" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // ─── Not found ──────────────────────────────────────────────────────────────
  if (notFound) {
    return (
      <div className="min-h-dvh bg-slate-50 flex flex-col items-center justify-center px-4 text-center">
        <div className="text-5xl mb-4">📋</div>
        <h1 className="text-2xl font-bold text-slate-800 mb-2">Không tìm thấy khảo sát</h1>
        <p className="text-slate-500">Link không hợp lệ hoặc khảo sát đã bị xoá.</p>
      </div>
    );
  }

  // ─── Thank you ─────────────────────────────────────────────────────────────
  if (submitted) {
    return (
      <ThankYouScreen
        survey={survey}
        accent={accent}
        responseId={responseId}
        isDuplicate={isDuplicate}
        allowCheckin={isCheckinForm(survey)}
        onSubmitAnother={() => {
          setAnswers({});
          setResponseId(null);
          setIsDuplicate(false);
          setSubmitted(false);
        }}
      />
    );
  }

  // ─── Survey form (light theme) ─────────────────────────────────────────────
  const invalidIds = showValidation ? new Set(getInvalidQuestions()) : new Set<string>();
  let firstInvalidAssigned = false;
  const paymentConfig = getActivePaymentConfig(survey);

  // Progress: count answered visible answerable questions
  const visibleAnswerable = questions.filter((q) =>
    q.type !== "section" && q.type !== "image_banner" && isQuestionVisible(q)
  );
  const answeredCount = visibleAnswerable.filter((q) => {
    const a = answers[q.id];
    if (a === undefined || a === "") return false;
    if (Array.isArray(a) && a.length === 0) return false;
    return true;
  }).length;
  const totalAnswerable = visibleAnswerable.length;
  const progressPct = totalAnswerable > 0 ? (answeredCount / totalAnswerable) * 100 : 0;

  return (
    <div className="min-h-dvh bg-gradient-to-b from-slate-50 to-white">
      {/* Sticky progress bar */}
      {totalAnswerable > 0 && (
        <div className="sticky top-0 z-20 backdrop-blur-md bg-white/80 border-b border-slate-200/60">
          <div className="max-w-lg mx-auto px-4 py-2.5">
            <div className="flex items-center justify-between mb-1.5 text-xs">
              <span className="text-slate-600 font-medium">Tiến độ</span>
              <span className="tabular-nums" style={{ color: accent }}>
                <span className="font-bold">{answeredCount}</span>
                <span className="text-slate-600"> / {totalAnswerable}</span>
              </span>
            </div>
            <div className="h-1.5 rounded-full bg-slate-200 overflow-hidden">
              <motion.div
                className="h-full rounded-full"
                style={{ background: accent }}
                animate={{ width: `${progressPct}%` }}
                transition={{ duration: 0.4, ease: "easeOut" }}
              />
            </div>
          </div>
        </div>
      )}

      <div className="max-w-lg mx-auto px-4 py-8">
        {/* Header */}
        <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="mb-8">
          {/* Logo */}
          {(quizLogo || quizBrand) && (
            <div className="flex justify-center mb-4">
              {quizLogo ? (
                <img src={quizLogo} alt={quizBrand ?? ""} className="h-10 max-w-[200px] object-contain" />
              ) : (
                <span className="text-base font-semibold text-slate-600">{quizBrand}</span>
              )}
            </div>
          )}
          {/* Banner */}
          {survey!.banner_url && (
            <img
              src={survey!.banner_url}
              alt=""
              className="w-full rounded-2xl mb-5 object-cover border border-slate-100"
              style={{ maxHeight: 200 }}
            />
          )}
          <h2 className="text-2xl font-bold text-slate-800">{survey!.title}</h2>
        </motion.div>

        {/* Questions */}
        <div className="flex flex-col gap-5">
          {questions.map((q, i) => {
            // Conditional logic: hide question if show_if condition not met
            if (!isQuestionVisible(q)) return null;

            const isInvalid = invalidIds.has(q.id);
            const refProp = isInvalid && !firstInvalidAssigned
              ? (() => { firstInvalidAssigned = true; return firstInvalidRef; })()
              : undefined;

            // Section heading — not a question
            if (q.type === "section") {
              return (
                <motion.div
                  key={q.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                  className="pt-4 pb-1"
                >
                  <h3 className="text-lg font-bold text-slate-800">{q.text}</h3>
                  {q.options?.[0] && <p className="text-sm text-slate-600 mt-1">{q.options[0]}</p>}
                  <div className="mt-3 h-px bg-slate-200" />
                </motion.div>
              );
            }

            // Image banner — decorative
            if (q.type === "image_banner") {
              return (
                <motion.div
                  key={q.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: i * 0.04 }}
                >
                  {q.text && (
                    <img src={q.text} alt={q.options?.[0] ?? ""} loading="lazy" className="w-full rounded-2xl object-cover border border-slate-100" style={{ maxHeight: 240 }} />
                  )}
                  {q.options?.[0] && <p className="text-xs text-slate-600 text-center mt-2">{q.options[0]}</p>}
                </motion.div>
              );
            }

            return (
              <motion.div
                key={q.id}
                ref={refProp}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className={`bg-white rounded-2xl p-5 shadow-sm border transition-colors ${
                  isInvalid ? "border-red-300 bg-red-50/50" : "border-slate-100"
                }`}
              >
                <div className="mb-4">
                  <p className="text-sm font-semibold text-slate-800 leading-snug">
                    {q.text}
                    {q.required && <span className="text-red-500 ml-1">*</span>}
                  </p>
                </div>

                {/* Validation error */}
                {isInvalid && (
                  <div className="flex items-center gap-1.5 mb-3 text-red-500">
                    <AlertCircle size={13} />
                    <span className="text-xs font-medium">Vui lòng trả lời câu hỏi này</span>
                  </div>
                )}

                {/* Rating */}
                {q.type === "rating" && (
                  <div className="flex items-center gap-2 justify-center">
                    {[1, 2, 3, 4, 5].map((star) => {
                      const val = (answers[q.id] as number) ?? 0;
                      return (
                        <motion.button key={star} onClick={() => setAnswer(q.id, star)}
                          whileTap={{ scale: 0.9 }} className="text-3xl transition-all"
                          style={{ filter: star <= val ? "none" : "grayscale(1) opacity(0.3)" }}>⭐</motion.button>
                      );
                    })}
                    {answers[q.id] && <span className="text-sm font-bold ml-2 text-emerald-600">{answers[q.id]}/5</span>}
                  </div>
                )}

                {/* NPS */}
                {q.type === "nps" && (() => {
                  const maxVal = parseInt(q.options?.[2] ?? "10", 10) || 10;
                  const labelMin = q.options?.[0] || "Không khuyến nghị";
                  const labelMax = q.options?.[1] || "Rất khuyến nghị";
                  return (
                    <div>
                      <div
                        className="grid gap-1 sm:gap-1.5"
                        style={{ gridTemplateColumns: `repeat(${maxVal + 1}, minmax(0, 1fr))` }}
                      >
                        {Array.from({ length: maxVal + 1 }, (_, n) => n).map((n) => {
                          const val = answers[q.id] as number;
                          const isSelected = val === n;
                          const pct = maxVal > 0 ? n / maxVal : 0;
                          // Darker shades to ensure readable text contrast on selected state
                          const color = pct <= 0.6 ? "#dc2626" : pct <= 0.8 ? "#b45309" : "#059669";
                          return (
                            <motion.button key={n} onClick={() => setAnswer(q.id, n)} whileTap={{ scale: 0.9 }}
                              className="aspect-square min-w-0 rounded-lg text-xs sm:text-sm font-bold transition-all flex items-center justify-center"
                              style={{ background: isSelected ? color : "#f1f5f9", color: isSelected ? "white" : "#64748b", border: `1px solid ${isSelected ? color : "#e2e8f0"}` }}>
                              {n}
                            </motion.button>
                          );
                        })}
                      </div>
                      <div className="flex justify-between text-[10px] text-slate-600 mt-1.5 px-0.5">
                        <span>{labelMin}</span><span>{labelMax}</span>
                      </div>
                    </div>
                  );
                })()}

                {/* Choice */}
                {q.type === "choice" && (
                  <div className="flex flex-col gap-2">
                    {q.allow_multiple && (
                      <p className="text-[11px] text-cyan-600 mb-1 flex items-center gap-1.5 font-medium">
                        <ListChecks size={12} /> Có thể chọn nhiều đáp án
                      </p>
                    )}
                    {(q.options ?? []).map((opt, oi) => {
                      const val = answers[q.id];
                      const selectedArr = Array.isArray(val) ? val : (val !== undefined ? [val as number] : []);
                      const isSelected = q.allow_multiple ? selectedArr.includes(oi) : val === oi;
                      const color = CHOICE_COLORS[oi % CHOICE_COLORS.length];
                      return (
                        <motion.button key={oi} whileTap={{ scale: 0.98 }}
                          onClick={() => {
                            if (q.allow_multiple) {
                              const current = Array.isArray(val) ? val : [];
                              setAnswer(q.id, current.includes(oi) ? current.filter((v) => v !== oi) : [...current, oi]);
                            } else { setAnswer(q.id, oi); }
                          }}
                          className="flex items-center gap-3 px-4 py-3 rounded-xl border text-left transition-all"
                          style={{ background: isSelected ? `${color}10` : "white", borderColor: isSelected ? color : "#e2e8f0" }}>
                          <div className="w-7 h-7 rounded-lg flex items-center justify-center text-xs font-bold flex-shrink-0"
                            style={{ background: `${color}15`, color }}>
                            {q.allow_multiple ? (isSelected ? "✓" : String.fromCharCode(65 + oi)) : String.fromCharCode(65 + oi)}
                          </div>
                          <span className="text-sm text-slate-700 flex-1">{opt}</span>
                        </motion.button>
                      );
                    })}
                  </div>
                )}

                {/* Text — single line */}
                {q.type === "text" && (
                  <input type="text" value={(answers[q.id] as string) ?? ""} onChange={(e) => setAnswer(q.id, e.target.value)}
                    placeholder="Nhập câu trả lời..."
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition-all" />
                )}

                {/* Paragraph — multi line */}
                {q.type === "paragraph" && (
                  <textarea value={(answers[q.id] as string) ?? ""} onChange={(e) => setAnswer(q.id, e.target.value)}
                    placeholder="Nhập câu trả lời..." rows={3}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 resize-none transition-all" />
                )}

                {/* Phone */}
                {q.type === "phone" && (
                  <div>
                    <input type="tel" inputMode="numeric" value={(answers[q.id] as string) ?? ""}
                      onChange={(e) => setAnswer(q.id, normalizePhone(e.target.value).replace(/\D/g, "").slice(0, 10))}
                      placeholder="0912345678" maxLength={13}
                      className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-lg text-slate-800 placeholder:text-slate-400 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 tracking-wider text-center font-mono transition-all" />
                    {(() => {
                      const v = (answers[q.id] as string) ?? "";
                      if (!v) return null;
                      if (v.length < 10) return <p className="text-xs text-amber-700 mt-1.5">Cần nhập đủ 10 số</p>;
                      if (!VN_PHONE_RE.test(v)) return <p className="text-xs text-amber-700 mt-1.5">Số điện thoại không hợp lệ</p>;
                      return null;
                    })()}
                  </div>
                )}

                {/* Date */}
                {q.type === "date" && (
                  <input type="date" value={(answers[q.id] as string) ?? ""}
                    max={new Date().toISOString().slice(0, 10)}
                    onChange={(e) => setAnswer(q.id, e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 transition-all" />
                )}

                {/* Province */}
                {q.type === "province" && (
                  <select value={(answers[q.id] as string) ?? ""} onChange={(e) => setAnswer(q.id, e.target.value)}
                    className="w-full bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-sm text-slate-800 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/20 appearance-none transition-all">
                    <option value="">Chọn tỉnh thành...</option>
                    {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
                  </select>
                )}

                {/* File upload */}
                {q.type === "file_upload" && (
                  <SurveyFileUpload
                    surveyId={surveyId}
                    questionId={q.id}
                    value={(answers[q.id] as string) ?? ""}
                    onChange={(url) => setAnswer(q.id, url)}
                    accent={accent}
                  />
                )}

                {/* Signature */}
                {q.type === "signature" && (
                  <SurveySignaturePad
                    surveyId={surveyId}
                    questionId={q.id}
                    value={(answers[q.id] as string) ?? ""}
                    onChange={(url) => setAnswer(q.id, url)}
                    accent={accent}
                  />
                )}

                {/* Face Check-in VIP */}
                {q.type === "face_checkin" && (
                  <FaceCheckinQuestion
                    surveyId={surveyId}
                    questionId={q.id}
                    accent={accent}
                    value={(answers[q.id] as string) ?? ""}
                    onChange={(url) => setAnswer(q.id, url)}
                    faceDataRef={faceDataRef}
                    required={q.required}
                    preview={preview}
                  />
                )}
              </motion.div>
            );
          })}
        </div>

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mt-4 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600">
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Validation summary */}
        <AnimatePresence>
          {showValidation && !isComplete && (
            <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mt-4 px-4 py-3 rounded-xl bg-amber-50 border border-amber-200 flex items-center gap-2">
              <AlertCircle size={16} className="text-amber-600 flex-shrink-0" />
              <span className="text-sm text-amber-700">Vui lòng trả lời các câu hỏi bắt buộc (*) trước khi gửi</span>
            </motion.div>
          )}
        </AnimatePresence>

        {paymentConfig && (
          <div className="mt-5 rounded-2xl border border-cyan-200 bg-cyan-50 px-4 py-4">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-white text-cyan-700 shadow-sm">
                <CreditCard size={18} />
              </div>
              <div>
                <div className="text-sm font-bold text-slate-900">{paymentConfig.itemName}</div>
                <p className="mt-1 text-xs leading-5 text-slate-600">
                  Sau khi gửi form, bạn sẽ được chuyển sang PayOS để thanh toán. QR check-in sẽ được cấp sau khi thanh toán thành công.
                </p>
                <div className="mt-2 text-lg font-bold text-cyan-700">{formatVnd(paymentConfig.amount)}</div>
              </div>
            </div>
          </div>
        )}

        {/* Submit */}
        <motion.button onClick={handleSubmit} disabled={submitting}
          initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3 }}
          whileTap={{ scale: 0.98 }}
          className="mt-6 w-full py-4 rounded-2xl font-bold text-on-brand flex items-center justify-center gap-2 disabled:opacity-60 shadow-lg transition-shadow hover:shadow-xl"
          style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}>
          {submitting ? (paymentConfig ? "Đang tạo thanh toán..." : "Đang gửi...") : <><Send size={18} /> {paymentConfig ? "Tiếp tục thanh toán" : survey?.form_type === "poster_scoring" ? "Gửi điểm" : "Gửi khảo sát"}</>}
        </motion.button>
      </div>
    </div>
  );
}


// Thank-you screen with optional auto-redirect countdown + check-in QR
function ThankYouScreen({
  survey,
  accent,
  responseId,
  isDuplicate,
  allowCheckin,
  onSubmitAnother,
}: {
  survey: Survey | null;
  accent: string;
  responseId: string | null;
  isDuplicate?: boolean;
  allowCheckin: boolean;
  onSubmitAnother: () => void;
}) {
  const redirectUrl = survey?.redirect_url?.trim() || null;
  const initialDelay = survey?.redirect_delay ?? 5;
  const [countdown, setCountdown] = useState(initialDelay);

  // Build check-in QR data
  const checkinUrl = allowCheckin && responseId && typeof window !== "undefined"
    ? buildPublicUrl(`/checkin/${responseId}`)
    : null;
  const duplicate = allowCheckin && isDuplicate;

  useEffect(() => {
    if (!redirectUrl) return;
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          window.location.href = redirectUrl;
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [redirectUrl]);

  return (
    <div className="min-h-dvh bg-slate-50 flex flex-col items-center justify-center px-4 text-center">
      <motion.div
        initial={{ scale: 0 }}
        animate={{ scale: 1 }}
        transition={{ type: "spring", stiffness: 300, damping: 18 }}
        className="w-20 h-20 rounded-3xl flex items-center justify-center text-4xl mb-6"
        style={{ background: `${accent}15`, border: `2px solid ${accent}40` }}
      >
        ✅
      </motion.div>
      <h2 className={`text-2xl font-bold mb-2 ${duplicate ? "text-red-600" : "text-slate-800"}`}>
        {duplicate ? "⚠️ Bạn đã đăng ký rồi!" : (survey?.thank_you_message || "Cảm ơn bạn đã phản hồi!")}
      </h2>
      <p className={`text-sm mb-6 ${duplicate ? "text-red-500 font-semibold" : "text-slate-600"}`}>
        {duplicate ? "Email này đã đăng ký trước đó. Đây là mã QR check-in của bạn." : "Phản hồi của bạn đã được ghi nhận."}
      </p>

      {/* Check-in QR code */}
      {checkinUrl && !redirectUrl && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-3 mb-6"
        >
          <div className="checkin-qr bg-white rounded-2xl p-4 shadow-sm border border-slate-100">
            <QRCodeView value={checkinUrl} size={160} qrStyle={survey?.checkin_theme?.qr ?? null} />
          </div>
          <div className="text-center">
            <p className="text-xs font-semibold text-slate-700">Mã check-in của bạn</p>
            <p className="text-[10px] text-slate-500 mt-0.5">Xuất trình QR này cho ban tổ chức để xác nhận tham dự</p>
            <p className="text-[11px] text-emerald-600 font-medium mt-1.5">📧 Mã check-in đã gửi về email của bạn</p>
          </div>
        </motion.div>
      )}

      {redirectUrl && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-3"
        >
          <div className="text-sm text-slate-600">
            Bạn sẽ được chuyển hướng sau{" "}
            <motion.span
              key={countdown}
              initial={{ scale: 1.3, color: accent }}
              animate={{ scale: 1, color: "#0f172a" }}
              transition={{ duration: 0.3 }}
              className="inline-block font-bold tabular-nums text-base mx-0.5"
            >
              {countdown}
            </motion.span>{" "}
            giây
          </div>
          {/* Progress bar */}
          <div className="w-48 h-1 rounded-full bg-slate-200 overflow-hidden">
            <motion.div
              className="h-full"
              style={{ background: accent }}
              initial={{ width: "100%" }}
              animate={{ width: `${(countdown / initialDelay) * 100}%` }}
              transition={{ duration: 1, ease: "linear" }}
            />
          </div>
          <a
            href={redirectUrl}
            className="text-xs text-slate-600 hover:text-slate-700 underline"
          >
            Hoặc bấm để chuyển ngay →
          </a>
        </motion.div>
      )}

      {!allowCheckin && !redirectUrl && (
        <button
          type="button"
          onClick={onSubmitAnother}
          className="mt-2 rounded-xl px-5 py-3 text-sm font-semibold text-on-brand shadow-lg"
          style={{ background: accent }}
        >
          Gửi lượt khác
        </button>
      )}
    </div>
  );
}
