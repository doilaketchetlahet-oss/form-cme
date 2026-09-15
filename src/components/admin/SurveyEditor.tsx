"use client";
import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { restrictToParentElement, restrictToVerticalAxis } from "@dnd-kit/modifiers";
import {
  X, Plus, Trash2, Star, BarChart3, AlignLeft, Hash,
  GripVertical, ChevronDown, Phone, Calendar, MapPin, ListChecks, Type, ImageIcon, Upload, Minus, Pencil, Copy, ShieldCheck, Trophy, CreditCard, Mail, ArrowRight,
} from "lucide-react";
import type { Survey, SurveyFormType, SurveyQuestion, SurveyQuestionType, SurveyQuestionUpsert, CheckinTheme, ScoringConfig, PaymentConfig } from "@/lib/surveys";
import Link from "next/link";
import { ThemeImageUpload } from "./ThemeImageUpload";
import { QRCodeView } from "@/components/ui/QRCodeView";

interface Props {
  initial?: Survey & { questions?: SurveyQuestion[] };
  onSave: (data: { title: string; form_type: SurveyFormType; is_anonymous: boolean; thank_you_message: string; banner_url: string | null; redirect_url: string | null; redirect_delay: number; checkin_pin: string | null; checkin_theme: CheckinTheme | null; scoring_config: ScoringConfig | null; payment_config: PaymentConfig | null; vip_checkin_enabled: boolean; is_closed: boolean; close_at: string | null; questions: SurveyQuestionUpsert[] }) => void | Promise<void>;
  onCancel: () => void;
  saving?: boolean;
}

// _key: stable React key. id: real DB id (preserved on edit so responses stay linked)
type DraftQuestion = { _key: string; id?: string } & Omit<SurveyQuestion, "id" | "survey_id">;
type EditorTab = "questions" | "payment" | "email" | "checkin" | "scoring" | "appearance";
type FormTypeMeta = {
  label: string;
  shortLabel: string;
  description: string;
  tabs: EditorTab[];
  questionTypes: SurveyQuestionType[];
};

const QUESTION_TYPES: { type: SurveyQuestionType; icon: React.ReactNode; label: string; desc: string }[] = [
  // Hay dùng nhất
  { type: "text", icon: <Minus size={14} />, label: "Văn bản ngắn", desc: "1 dòng: tên, email..." },
  { type: "paragraph", icon: <AlignLeft size={14} />, label: "Đoạn văn", desc: "Nhiều dòng: góp ý..." },
  { type: "phone", icon: <Phone size={14} />, label: "Số điện thoại", desc: "10 số, validate" },
  { type: "province", icon: <MapPin size={14} />, label: "Tỉnh thành", desc: "63 tỉnh thành VN" },
  { type: "choice", icon: <BarChart3 size={14} />, label: "Lựa chọn", desc: "Chọn 1 hoặc nhiều" },
  { type: "file_upload", icon: <Upload size={14} />, label: "Tải ảnh lên", desc: "Chụp/chọn ảnh giấy tờ" },
  { type: "signature", icon: <Pencil size={14} />, label: "Chữ ký", desc: "Ký tay xác nhận" },
  // eKYC
  { type: "face_checkin", icon: <ShieldCheck size={14} />, label: "Face Check-in VIP", desc: "Chụp ảnh khuôn mặt eKYC" },
  // Đánh giá
  { type: "nps", icon: <Hash size={14} />, label: "Thang điểm", desc: "0-N tuỳ chỉnh" },
  { type: "rating", icon: <Star size={14} />, label: "Đánh giá ⭐", desc: "1-5 sao" },
  { type: "date", icon: <Calendar size={14} />, label: "Ngày tháng", desc: "DD/MM/YYYY" },
  // Layout
  { type: "section", icon: <Type size={14} />, label: "Tiêu đề section", desc: "Heading chia nhóm" },
  { type: "image_banner", icon: <ImageIcon size={14} />, label: "Ảnh banner", desc: "Hình minh hoạ" },
];

const FORM_TYPE_META: Record<SurveyFormType, FormTypeMeta> = {
  registration: {
    label: "Đăng ký CME / Check-in",
    shortLabel: "Đăng ký",
    description: "Dùng cho đăng ký người tham dự, gửi email QR, check-in QR và face check-in.",
    tabs: ["questions", "payment", "email", "checkin", "appearance"],
    questionTypes: ["text", "phone", "province", "choice", "file_upload", "signature", "face_checkin", "paragraph", "date", "section", "image_banner"],
  },
  poster_scoring: {
    label: "Chấm điểm poster",
    shortLabel: "Chấm điểm",
    description: "Dùng cho giám khảo nhập điểm. Không gửi email QR và không hiện mã check-in sau khi gửi.",
    tabs: ["questions", "scoring", "appearance"],
    questionTypes: ["choice", "text", "paragraph", "nps", "rating", "section", "image_banner"],
  },
  feedback: {
    label: "Khảo sát / Feedback",
    shortLabel: "Khảo sát",
    description: "Dùng để thu phản hồi sau chương trình. Không tạo QR check-in.",
    tabs: ["questions", "appearance"],
    questionTypes: ["rating", "nps", "choice", "text", "paragraph", "date", "province", "file_upload", "signature", "section", "image_banner"],
  },
};

const newKey = () => `q_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

function toLocalDateTime(iso: string) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

// Generate a client-side UUID for new questions so they can be referenced by
// `show_if` conditions immediately, even before save. The same UUID is sent to
// DB on insert (Postgres accepts our UUID for the `id` column).
const newId = (): string => {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

function normalizeFormType(value: unknown): SurveyFormType {
  return value === "poster_scoring" || value === "feedback" ? value : "registration";
}

function inferFormType(initial?: Survey & { questions?: SurveyQuestion[] }): SurveyFormType {
  const stored = normalizeFormType((initial as { form_type?: unknown } | undefined)?.form_type);
  if (stored !== "registration") return stored;
  return initial?.scoring_config?.enabled ? "poster_scoring" : "registration";
}

function isCheckinForm(formType: SurveyFormType) {
  return formType === "registration";
}

function isScoringForm(formType: SurveyFormType) {
  return formType === "poster_scoring";
}

const DEFAULT_QUESTIONS: DraftQuestion[] = [
  { _key: newKey(), id: newId(), position: 0, type: "rating", text: "Bạn đánh giá buổi học/sự kiện hôm nay như thế nào?", options: null, required: true, allow_multiple: false, show_if: null },
  { _key: newKey(), id: newId(), position: 1, type: "text", text: "Bạn có góp ý gì không?", options: null, required: false, allow_multiple: false, show_if: null },
];

function normalizeScoringConfig(config?: ScoringConfig | null): ScoringConfig {
  return {
    enabled: !!config?.enabled,
    judgeQuestionId: config?.judgeQuestionId ?? null,
    posterQuestionId: config?.posterQuestionId ?? null,
    criteria: Array.isArray(config?.criteria)
      ? config.criteria
          .filter((criterion) => !!criterion.questionId)
          .map((criterion) => ({
            questionId: criterion.questionId,
            label: criterion.label?.trim() || undefined,
            weight: Number.isFinite(Number(criterion.weight)) ? Math.max(0, Number(criterion.weight)) : 1,
          }))
      : [],
    duplicateMode: config?.duplicateMode === "all" ? "all" : "latest",
  };
}

function cleanScoringConfig(config: ScoringConfig, questions: DraftQuestion[]): ScoringConfig | null {
  const questionIds = new Set(questions.map((question) => question.id).filter(Boolean) as string[]);
  const scoreQuestions = new Set(
    questions
      .filter((question) => question.id && (question.type === "rating" || question.type === "nps"))
      .map((question) => question.id as string),
  );

  const criteria = (config.criteria ?? [])
    .filter((criterion) => criterion.questionId && scoreQuestions.has(criterion.questionId))
    .map((criterion) => {
      const question = questions.find((item) => item.id === criterion.questionId);
      return {
        questionId: criterion.questionId,
        label: criterion.label?.trim() || question?.text || undefined,
        weight: Number.isFinite(Number(criterion.weight)) ? Math.max(0, Number(criterion.weight)) : 1,
      };
    });

  const cleaned: ScoringConfig = {
    enabled: !!config.enabled,
    judgeQuestionId: config.judgeQuestionId && questionIds.has(config.judgeQuestionId) ? config.judgeQuestionId : null,
    posterQuestionId: config.posterQuestionId && questionIds.has(config.posterQuestionId) ? config.posterQuestionId : null,
    criteria,
    duplicateMode: config.duplicateMode === "all" ? "all" : "latest",
  };

  const hasConfig = cleaned.enabled || !!cleaned.judgeQuestionId || !!cleaned.posterQuestionId || criteria.length > 0;
  return hasConfig ? cleaned : null;
}

function cleanPaymentConfig(config: PaymentConfig): PaymentConfig | null {
  const amount = Math.round(Number(config.amount ?? 0));
  if (!config.enabled || !Number.isFinite(amount) || amount <= 0) return null;

  return {
    enabled: true,
    amount,
    itemName: config.itemName?.trim() || "Vé tham dự",
    description: config.description?.trim() || "Phí đăng ký",
    expiresInMinutes: Math.max(5, Math.min(7 * 24 * 60, Number(config.expiresInMinutes ?? 60) || 60)),
  };
}

export function SurveyEditor({ initial, onSave, onCancel, saving = false }: Props) {
  const [activeTab, setActiveTab] = useState<EditorTab>("questions");
  const [formType, setFormType] = useState<SurveyFormType>(() => inferFormType(initial));
  const [title, setTitle] = useState(initial?.title ?? "Khảo sát sau sự kiện");
  const [isAnonymous, setIsAnonymous] = useState(true); // always anonymous for public surveys
  const [thankYou, setThankYou] = useState(initial?.thank_you_message ?? "Cảm ơn bạn đã phản hồi!");
  const [bannerUrl, setBannerUrl] = useState(initial?.banner_url ?? "");
  const [redirectUrl, setRedirectUrl] = useState(initial?.redirect_url ?? "");
  const [redirectDelay, setRedirectDelay] = useState(initial?.redirect_delay ?? 5);
  const emailSubject = initial?.email_subject ?? "";
  const emailBody = initial?.email_body ?? "";
  const [checkinPin, setCheckinPin] = useState((initial as { checkin_pin?: string } | undefined)?.checkin_pin ?? "");
  const [isClosed, setIsClosed] = useState<boolean>(!!(initial as { is_closed?: boolean } | undefined)?.is_closed);
  const initialCloseAt = (initial as { close_at?: string | null } | undefined)?.close_at ?? null;
  const [closeAt, setCloseAt] = useState<string>(initialCloseAt ? toLocalDateTime(initialCloseAt) : "");
  const [theme, setTheme] = useState<CheckinTheme>((initial as { checkin_theme?: CheckinTheme } | undefined)?.checkin_theme ?? {});
  const patchTheme = (p: Partial<CheckinTheme>) => setTheme((t) => ({ ...t, ...p }));
  const patchQr = (p: NonNullable<CheckinTheme["qr"]>) => setTheme((t) => ({ ...t, qr: { ...(t.qr ?? {}), ...p } }));
  const initialPayment = (initial as { payment_config?: PaymentConfig | null } | undefined)?.payment_config ?? null;
  const [paymentEnabled, setPaymentEnabled] = useState(!!initialPayment?.enabled);
  const [paymentAmount, setPaymentAmount] = useState(initialPayment?.amount ? String(initialPayment.amount) : "");
  const [paymentItemName, setPaymentItemName] = useState(initialPayment?.itemName ?? "Vé tham dự");
  const [paymentDescription, setPaymentDescription] = useState(initialPayment?.description ?? "Phí đăng ký");
  const [paymentExpiresInMinutes, setPaymentExpiresInMinutes] = useState(initialPayment?.expiresInMinutes ? String(initialPayment.expiresInMinutes) : "60");
  const [scoring, setScoring] = useState<ScoringConfig>(
    normalizeScoringConfig((initial as { scoring_config?: ScoringConfig | null } | undefined)?.scoring_config),
  );
  const [questions, setQuestions] = useState<DraftQuestion[]>(
    initial?.questions
      ? initial.questions.map((q) => ({
          _key: newKey(),
          id: q.id,
          position: q.position,
          type: q.type,
          text: q.text,
          options: q.options,
          required: q.required,
          allow_multiple: q.allow_multiple ?? false,
          show_if: q.show_if ?? null,
          is_hall_selector: q.is_hall_selector ?? false,
        }))
      : DEFAULT_QUESTIONS
  );
  const [expandedKey, setExpandedKey] = useState<string | null>(questions[0]?._key ?? null);
  const formMeta = FORM_TYPE_META[formType];
  const tabs = formMeta.tabs;
  const visibleActiveTab = tabs.includes(activeTab) ? activeTab : tabs[0];
  const availableQuestionTypes = useMemo(
    () => QUESTION_TYPES.filter((item) => formMeta.questionTypes.includes(item.type)),
    [formMeta.questionTypes],
  );
  const isCheckinEnabled = isCheckinForm(formType);
  const isScoringEnabled = isScoringForm(formType);

  const DEFAULT_TEXT: Record<string, string> = {
    text: "Họ và tên",
    paragraph: "Ý kiến / góp ý của bạn",
    phone: "Số điện thoại",
    province: "Tỉnh thành",
    choice: "Câu hỏi lựa chọn",
    file_upload: "Chụp ảnh giấy tờ",
    signature: "Chữ ký xác nhận",
    face_checkin: "Xác thực khuôn mặt VIP",
    nps: "Mức độ hài lòng",
    rating: "Đánh giá",
    date: "Ngày tháng năm sinh",
    section: "Tiêu đề",
  };

  const addQuestion = (type: SurveyQuestionType) => {
    if (!formMeta.questionTypes.includes(type)) return;
    const _key = newKey();
    const newQ: DraftQuestion = {
      _key,
      id: newId(),
      position: questions.length,
      type,
      text: DEFAULT_TEXT[type] ?? "",
      options: type === "choice" ? ["", ""] : null,
      required: false,
      allow_multiple: false,
      show_if: null,
      is_hall_selector: false,
    };
    setQuestions([...questions, newQ]);
    setExpandedKey(_key);
  };

  const duplicateQuestion = (key: string) => {
    const idx = questions.findIndex((q) => q._key === key);
    if (idx === -1) return;
    const src = questions[idx];
    const _key = newKey();
    const copy: DraftQuestion = {
      ...src,
      _key,
      id: newId(), // new id so it's treated as a new question
      options: src.options ? [...src.options] : null,
      show_if: src.show_if ? { ...src.show_if } : null,
    };
    const next = [...questions];
    next.splice(idx + 1, 0, copy);
    setQuestions(next);
    setExpandedKey(_key);
  };

  const updateQuestion = (key: string, patch: Partial<DraftQuestion>) => {
    setQuestions((prev) => prev.map((q) => (q._key === key ? { ...q, ...patch } : q)));
  };

  const removeQuestion = (key: string) => {
    setQuestions((prev) => prev.filter((q) => q._key !== key));
    if (expandedKey === key) setExpandedKey(null);
  };

  const emptyQuestionNumbers = questions
    .map((q, index) => ({ q, index }))
    .filter(({ q }) => q.type !== "image_banner" && q.type !== "face_checkin" && q.text.trim().length === 0)
    .map(({ index }) => index + 1);

  const validationMessage =
    title.trim().length === 0
      ? "Nhập tiêu đề form trước khi lưu."
      : isCheckinEnabled && paymentEnabled && (!Number.isFinite(Number(paymentAmount)) || Number(paymentAmount) <= 0)
        ? "Nhập phí đăng ký hợp lệ trước khi bật thanh toán."
      : questions.length === 0
        ? "Cần ít nhất một câu hỏi."
        : emptyQuestionNumbers.length > 0
          ? `Câu ${emptyQuestionNumbers.join(", ")} đang trống.`
          : null;

  const isValid = !validationMessage;

  const handleSave = () => {
    if (!isValid || saving) return;
    const final: SurveyQuestionUpsert[] = questions.map((q, i) => ({
      ...(q.id ? { id: q.id } : {}),
      position: i,
      type: q.type,
      text: q.text,
      options: q.options,
      required: q.required,
      allow_multiple: q.allow_multiple,
      show_if: q.show_if ?? null,
      is_hall_selector: isCheckinEnabled ? q.is_hall_selector ?? false : false,
    }));
    onSave({
      title: title.trim(),
      form_type: formType,
      is_anonymous: true,
      thank_you_message: thankYou.trim() || "Cảm ơn bạn đã phản hồi!",
      banner_url: bannerUrl.trim() || null,
      redirect_url: isCheckinEnabled ? redirectUrl.trim() || null : null,
      redirect_delay: Math.max(1, Math.min(30, redirectDelay)),
      checkin_pin: isCheckinEnabled ? checkinPin.trim() || null : null,
      checkin_theme: isCheckinEnabled && Object.values(theme).some((v) => v !== undefined && v !== null && v !== "") ? theme : null,
      scoring_config: isScoringEnabled ? cleanScoringConfig(scoring, questions) : null,
      payment_config: isCheckinEnabled ? cleanPaymentConfig({
        enabled: paymentEnabled,
        amount: Number(paymentAmount),
        itemName: paymentItemName,
        description: paymentDescription,
        expiresInMinutes: Number(paymentExpiresInMinutes),
      }) : null,
      vip_checkin_enabled: isCheckinEnabled && questions.some((q) => q.type === "face_checkin"),
      is_closed: isClosed,
      close_at: closeAt ? new Date(closeAt).toISOString() : null,
      questions: final,
    });
  };

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (!over || active.id === over.id) return;
    const oldIndex = questions.findIndex((q) => q._key === active.id);
    const newIndex = questions.findIndex((q) => q._key === over.id);
    if (oldIndex < 0 || newIndex < 0) return;
    const next = [...questions];
    const [moved] = next.splice(oldIndex, 1);
    next.splice(newIndex, 0, moved);
    setQuestions(next);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-strong rounded-2xl p-6"
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <h3 className="text-lg font-semibold text-white flex items-center gap-2">
          <span className="text-xl">📋</span>
          {initial ? "Sửa khảo sát" : "Khảo sát mới"}
        </h3>
        <button onClick={onCancel} className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/5 transition-colors">
          <X size={16} />
        </button>
      </div>

      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_260px]">
        <label>
          <span className="mb-2 block text-xs uppercase tracking-widest text-slate-500">Tiêu đề form</span>
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Nhập tiêu đề form..."
            className="admin-field w-full rounded-xl px-4 py-3 admin-placeholder focus:outline-none transition-colors"
          />
        </label>
        <label>
          <span className="mb-2 block text-xs uppercase tracking-widest text-slate-500">Loại form</span>
          <select
            value={formType}
            onChange={(event) => setFormType(event.target.value as SurveyFormType)}
            className="admin-field admin-dark-select w-full rounded-xl px-4 py-3 text-sm font-semibold focus:outline-none"
            style={{ colorScheme: "light" }}
          >
            {Object.entries(FORM_TYPE_META).map(([value, meta]) => (
              <option key={value} value={value}>{meta.label}</option>
            ))}
          </select>
        </label>
      </div>

      <div className="mb-4 rounded-xl border border-sky-100 bg-sky-50 px-4 py-3">
        <div className="text-sm font-semibold text-white">{formMeta.shortLabel}</div>
        <p className="mt-1 text-xs leading-5 text-slate-500">{formMeta.description}</p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-1.5 rounded-xl border border-sky-100 bg-white p-1 sm:grid-cols-4">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            onClick={() => setActiveTab(tab)}
            className={`rounded-lg px-3 py-2 text-xs font-semibold transition-colors ${
              visibleActiveTab === tab
                ? "bg-sky-500 text-on-brand"
                : "text-slate-600 hover:bg-sky-50 hover:text-slate-900"
            }`}
          >
            {tab === "questions" ? `Câu hỏi (${questions.length})` : getTabLabel(tab)}
          </button>
        ))}
      </div>

      {/* Optional settings — collapsible */}
      {visibleActiveTab === "email" && isCheckinEnabled && (
      <div className="mb-5 flex flex-col gap-1.5">
        <CollapsibleSetting label="Ảnh banner" hint={bannerUrl ? "Đã đặt" : ""} icon="🖼️">
          <input
            value={bannerUrl}
            onChange={(e) => setBannerUrl(e.target.value)}
            placeholder="Dán URL ảnh banner..."
            className="admin-field w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none transition-colors"
          />
          {bannerUrl && (
            <img src={bannerUrl} alt="Preview" loading="lazy" className="mt-2 rounded-xl max-h-32 w-full object-cover border border-white/10" />
          )}
          <p className="text-[10px] admin-subtle mt-1">Khuyến nghị: 1200×400px (tỷ lệ 3:1). JPG, PNG, WebP.</p>
        </CollapsibleSetting>

        <CollapsibleSetting label="Lời cảm ơn sau khi gửi" hint={thankYou !== "Cảm ơn bạn đã phản hồi!" ? "Tuỳ chỉnh" : ""} icon="💬">
          <input
            value={thankYou}
            onChange={(e) => setThankYou(e.target.value)}
            placeholder="Cảm ơn bạn đã phản hồi!"
            className="admin-field w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none transition-colors"
          />
        </CollapsibleSetting>

        <CollapsibleSetting label="Chuyển hướng sau khi gửi" hint={redirectUrl ? `→ ${redirectDelay}s` : ""} icon="🔗">
          <div className="flex gap-2">
            <input
              value={redirectUrl}
              onChange={(e) => setRedirectUrl(e.target.value)}
              placeholder="https://example.com/cam-on"
              className="admin-field flex-1 rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none transition-colors"
            />
            <input
              type="number"
              min={1}
              max={30}
              value={redirectDelay}
              onChange={(e) => setRedirectDelay(parseInt(e.target.value, 10) || 5)}
              disabled={!redirectUrl.trim()}
              className="admin-field w-20 rounded-xl px-3 py-3 text-sm focus:outline-none transition-colors disabled:opacity-40 text-center"
              title="Số giây đếm ngược"
            />
          </div>
          <p className="text-[10px] admin-subtle mt-1">Số giây đếm ngược trước khi tự chuyển trang (1-30s). Để trống URL = không chuyển.</p>
        </CollapsibleSetting>

        {initial?.id && (
          <Link
            href={`/admin/forms/${initial.id}/email`}
            className="flex items-center gap-3 rounded-2xl border border-sky-100 bg-white p-4 hover:border-sky-300"
          >
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-sky-50 text-sky-600">
              <Mail size={18} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold text-slate-800">Soạn thư mời</div>
              <p className="mt-0.5 text-xs text-slate-500">
                {emailSubject || emailBody ? "Đã có mẫu thư. Mở trang riêng để chỉnh khối, ảnh, QR và preview." : "Mở trang riêng để soạn tiêu đề, ảnh, QR và nội dung gửi attendee."}
              </p>
            </div>
            <ArrowRight size={16} className="text-slate-400" />
          </Link>
        )}

      </div>
      )}

      {visibleActiveTab === "payment" && isCheckinEnabled && (
        <div className="mb-5 rounded-2xl border border-sky-100 bg-sky-50 p-4">
          <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 text-cyan-200">
                <CreditCard size={18} />
              </div>
              <div>
                <div className="text-sm font-semibold text-white">Thanh toán PayOS</div>
                <p className="mt-1 max-w-xl text-xs leading-5 text-slate-400">
                  Khi bật, người đăng ký sẽ được chuyển sang PayOS. QR check-in và email chỉ được cấp sau khi webhook xác nhận đã thanh toán.
                </p>
              </div>
            </div>
            <label className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
              <input
                type="checkbox"
                checked={paymentEnabled}
                onChange={(event) => setPaymentEnabled(event.target.checked)}
                className="accent-cyan-500"
              />
              Bật thanh toán
            </label>
          </div>

          <div className={`grid gap-3 ${paymentEnabled ? "" : "opacity-45"}`}>
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
              <label>
                <span className="mb-1.5 block text-xs font-medium text-slate-300">Tên vé / gói đăng ký</span>
                <input
                  value={paymentItemName}
                  onChange={(event) => setPaymentItemName(event.target.value)}
                  disabled={!paymentEnabled}
                  placeholder="Vé tham dự HUNA 2026"
                  className="admin-field w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none disabled:cursor-not-allowed"
                />
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-medium text-slate-300">Phí đăng ký (VND)</span>
                <input
                  type="number"
                  min={1000}
                  step={1000}
                  value={paymentAmount}
                  onChange={(event) => setPaymentAmount(event.target.value)}
                  disabled={!paymentEnabled}
                  placeholder="500000"
                  className="admin-field w-full rounded-xl px-4 py-3 text-sm font-semibold admin-placeholder focus:outline-none disabled:cursor-not-allowed"
                />
              </label>
            </div>

            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px]">
              <label>
                <span className="mb-1.5 block text-xs font-medium text-slate-300">Mô tả nội bộ</span>
                <input
                  value={paymentDescription}
                  onChange={(event) => setPaymentDescription(event.target.value)}
                  disabled={!paymentEnabled}
                  placeholder="Phí đăng ký hội thảo"
                  className="admin-field w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none disabled:cursor-not-allowed"
                />
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-medium text-slate-300">Hết hạn sau (phút)</span>
                <input
                  type="number"
                  min={5}
                  max={10080}
                  value={paymentExpiresInMinutes}
                  onChange={(event) => setPaymentExpiresInMinutes(event.target.value)}
                  disabled={!paymentEnabled}
                  className="admin-field w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none disabled:cursor-not-allowed"
                />
              </label>
            </div>

            <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-3 text-xs leading-5 text-amber-100">
              Webhook PayOS cần trỏ về <span className="font-mono text-amber-50">/api/payos/webhook</span>. Nếu chưa chạy file SQL payment hoặc chưa thêm biến môi trường PayOS trên Vercel, form sẽ báo lỗi khi tạo link thanh toán.
            </div>
          </div>
        </div>
      )}

      {visibleActiveTab === "checkin" && isCheckinEnabled && (
      <div className="mb-5 flex flex-col gap-1.5">
        <CollapsibleSetting label="Mã PIN bảo vệ check-in" hint={checkinPin ? "🔒" : ""} icon="🔒">
          <input
            value={checkinPin}
            onChange={(e) => setCheckinPin(e.target.value.replace(/\s/g, ""))}
            placeholder="Để trống = không khoá. VD: 1234"
            className="admin-field w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none transition-colors"
          />
          <p className="text-[10px] admin-subtle mt-1">Yêu cầu nhập PIN khi mở trang Danh sách (/attendees) và Quét (/scan). Chia PIN cho nhân viên canh quầy.</p>
        </CollapsibleSetting>
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3">
          <div className="text-xs font-medium text-slate-300">Face check-in VIP</div>
          <p className="mt-1 text-[11px] leading-5 text-slate-500">
            Bật bằng cách thêm câu hỏi loại “Face Check-in VIP” trong tab Câu hỏi. Khi form có câu hỏi này, dashboard sẽ hiện nút VIP Face.
          </p>
        </div>
        <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-3">
          <label className="flex cursor-pointer items-start gap-3">
            <input
              type="checkbox"
              checked={!!theme.sessionsEnabled}
              onChange={(e) => patchTheme({ sessionsEnabled: e.target.checked })}
              className="mt-0.5 h-4 w-4 accent-sky-500"
            />
            <span>
              <span className="block text-xs font-medium text-slate-300">Điểm danh theo buổi</span>
              <span className="mt-1 block text-[11px] leading-5 text-slate-500">
                Bật để hiện mục “Điểm danh nhiều buổi” ở trang Danh sách. Mỗi buổi có link quét riêng (dùng cho CME cấp giờ).
              </span>
            </span>
          </label>
        </div>
      </div>
      )}

      {visibleActiveTab === "scoring" && isScoringEnabled && (
        <ScoringSettings
          scoring={scoring}
          questions={questions}
          onChange={setScoring}
        />
      )}

      {visibleActiveTab === "appearance" && (
      <div className="mb-5 flex flex-col gap-1.5">
        <CollapsibleSetting label="Đóng form / hẹn giờ tắt" hint={isClosed ? "Đang đóng" : closeAt ? "Đã hẹn" : ""} icon="🛑">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input type="checkbox" checked={isClosed} onChange={(e) => setIsClosed(e.target.checked)} className="h-4 w-4 accent-sky-500" />
            Đóng form — không nhận phản hồi nữa
          </label>
          <div className="mt-3">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">Tự đóng lúc (tuỳ chọn)</span>
            <input
              type="datetime-local"
              value={closeAt}
              onChange={(e) => setCloseAt(e.target.value)}
              className="admin-field w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
            />
          </div>
          <p className="mt-2 text-[10px] admin-subtle">Bật “Đóng form” để tạm dừng nhận đăng ký ngay. Hẹn giờ sẽ tự đóng khi tới thời điểm.</p>
        </CollapsibleSetting>
        {!isCheckinEnabled && (
          <CollapsibleSetting label="Trang form public" hint={bannerUrl || thankYou ? "Tuỳ chỉnh" : ""} icon="🖼️">
            <input
              value={bannerUrl}
              onChange={(e) => setBannerUrl(e.target.value)}
              placeholder="Dán URL ảnh banner..."
              className="admin-field mb-2 w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none transition-colors"
            />
            <input
              value={thankYou}
              onChange={(e) => setThankYou(e.target.value)}
              placeholder="Lời cảm ơn sau khi gửi"
              className="admin-field w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none transition-colors"
            />
            <p className="mt-2 text-[10px] leading-5 admin-subtle">Form chấm điểm/feedback không tạo QR check-in, không gửi email check-in.</p>
          </CollapsibleSetting>
        )}

        {isCheckinEnabled && (
        <>
        <CollapsibleSetting label="Giao diện màn hình Check-in" hint={theme.backgroundImage ? "✓" : ""} icon="🎨">
          <p className="text-[10px] text-slate-500 mb-3">Tuỳ biến màn quét QR (/scan) theo branding sự kiện. Upload ảnh nền + logo, nhập thông tin hội nghị.</p>

          {/* Background */}
          <div className="mb-3">
            <ThemeImageUpload label="Ảnh nền (khuyến nghị 1920×1080)" value={theme.backgroundImage}
              onChange={(url) => patchTheme({ backgroundImage: url })} maxWidth={1920} aspect="wide" />
          </div>

          {/* Logos */}
          <div className="flex gap-4 mb-3">
            <ThemeImageUpload label="Logo trái" value={theme.leftLogo} onChange={(url) => patchTheme({ leftLogo: url })} maxWidth={600} aspect="square" />
            <ThemeImageUpload label="Logo phải" value={theme.rightLogo} onChange={(url) => patchTheme({ rightLogo: url })} maxWidth={600} aspect="square" />
          </div>

          {/* Text fields */}
          <div className="space-y-2">
            <input value={theme.conferenceName ?? ""} onChange={(e) => patchTheme({ conferenceName: e.target.value })}
              placeholder="Tên hội nghị (để trống = dùng tên khảo sát)"
className="admin-field w-full rounded-xl px-4 py-2.5 text-sm admin-placeholder focus:outline-none" />
            <div className="flex gap-2">
              <input value={theme.date ?? ""} onChange={(e) => patchTheme({ date: e.target.value })}
                placeholder="Ngày tổ chức" className="admin-field flex-1 rounded-xl px-4 py-2.5 text-sm admin-placeholder focus:outline-none" />
              <input value={theme.venue ?? ""} onChange={(e) => patchTheme({ venue: e.target.value })}
                placeholder="Địa điểm" className="admin-field flex-1 rounded-xl px-4 py-2.5 text-sm admin-placeholder focus:outline-none" />
            </div>
            <input value={theme.organizer ?? ""} onChange={(e) => patchTheme({ organizer: e.target.value })}
              placeholder="Đơn vị tổ chức" className="admin-field w-full rounded-xl px-4 py-2.5 text-sm admin-placeholder focus:outline-none" />
            <div className="flex items-center gap-3">
              <label className="text-[11px] text-slate-400 flex items-center gap-2">
                Màu nhấn
                <input type="color" value={theme.accentColor ?? "#6366f1"} onChange={(e) => patchTheme({ accentColor: e.target.value })}
                  className="w-8 h-8 rounded border border-white/10 bg-transparent cursor-pointer" />
              </label>
              <label className="text-[11px] text-slate-400 flex items-center gap-2 flex-1">
                Độ tối nền: {theme.overlayOpacity ?? 40}%
                <input type="range" min={0} max={80} value={theme.overlayOpacity ?? 40}
                  onChange={(e) => patchTheme({ overlayOpacity: parseInt(e.target.value, 10) })}
                  className="flex-1 accent-emerald-500" />
              </label>
            </div>
          </div>

          {/* Live preview */}
          <div className="mt-3">
            <p className="text-[10px] text-slate-500 mb-1">Xem trước</p>
            <div className="relative w-full aspect-video rounded-xl overflow-hidden border border-white/10 bg-slate-900">
              {theme.backgroundImage
                ? <img src={theme.backgroundImage} alt="" className="absolute inset-0 w-full h-full object-cover" style={{ filter: "blur(2px)" }} />
                : <div className="absolute inset-0" style={{ background: "linear-gradient(135deg,#0369a1,#0ea5e9)" }} />}
              <div className="absolute inset-0" style={{ background: `rgba(7,18,45,${(theme.overlayOpacity ?? 40) / 100})` }} />
              <div className="absolute inset-0 flex flex-col">
                <div className="flex items-center justify-between px-3 py-2">
                  <div className="h-6 w-10 flex items-center">{theme.leftLogo && <img src={theme.leftLogo} className="max-h-6 max-w-full object-contain" alt="" />}</div>
                  <span className="text-on-brand text-[11px] font-bold truncate px-1">{theme.conferenceName || ""}</span>
                  <div className="h-6 w-10 flex items-center justify-end">{theme.rightLogo && <img src={theme.rightLogo} className="max-h-6 max-w-full object-contain" alt="" />}</div>
                </div>
                <div className="flex-1 flex items-center justify-center">
                  <div className="rounded-lg px-4 py-3 text-center" style={{ background: "rgba(255,255,255,0.12)", border: "1px solid rgba(255,255,255,0.25)" }}>
                    <span className="text-on-brand text-[10px]">Khung quét QR</span>
                  </div>
                </div>
                {(theme.date || theme.venue || theme.organizer) && (
                  <div className="flex items-center justify-center gap-3 px-3 py-1.5 text-white/80 text-[9px]">
                    {theme.date && <span>📅 {theme.date}</span>}
                    {theme.venue && <span>📍 {theme.venue}</span>}
                    {theme.organizer && <span>🏢 {theme.organizer}</span>}
                  </div>
                )}
              </div>
            </div>
          </div>
        </CollapsibleSetting>

        <CollapsibleSetting label="Branding mã QR" hint={theme.qr ? "✓" : ""} icon="▦">
          <p className="text-[10px] text-slate-500 mb-3">
            Tuỳ chỉnh màu, logo và độ bo của QR trong email, trang check-in và badge. QR luôn dùng mức sửa lỗi H để giữ khả năng quét.
          </p>

          <div className="grid grid-cols-1 lg:grid-cols-[1fr_190px] gap-4">
            <div className="space-y-3">
              <div className="grid grid-cols-3 gap-3">
                <label className="text-[11px] text-slate-400">
                  Màu chính
                  <input type="color" value={theme.qr?.darkColor ?? "#0369a1"} onChange={(e) => patchQr({ darkColor: e.target.value })}
                    className="mt-1 w-full h-10 rounded border border-white/10 bg-transparent cursor-pointer" />
                </label>
                <label className="text-[11px] text-slate-400">
                  Màu nhấn
                  <input type="color" value={theme.qr?.accentColor ?? "#0891b2"} onChange={(e) => patchQr({ accentColor: e.target.value })}
                    className="mt-1 w-full h-10 rounded border border-white/10 bg-transparent cursor-pointer" />
                </label>
                <label className="text-[11px] text-slate-400">
                  Nền QR
                  <input type="color" value={theme.qr?.lightColor ?? "#f8fdff"} onChange={(e) => patchQr({ lightColor: e.target.value })}
                    className="mt-1 w-full h-10 rounded border border-white/10 bg-transparent cursor-pointer" />
                </label>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <label className="text-[11px] text-slate-400">
                  Độ bo ô QR: {theme.qr?.moduleRadius ?? 32}%
                  <input type="range" min={0} max={50} value={theme.qr?.moduleRadius ?? 32}
                    onChange={(e) => patchQr({ moduleRadius: parseInt(e.target.value, 10) })}
                    className="mt-2 w-full accent-cyan-500" />
                </label>
                <label className="text-[11px] text-slate-400">
                  Kích thước logo: {theme.qr?.logoSize ?? 24}%
                  <input type="range" min={12} max={28} value={theme.qr?.logoSize ?? 24}
                    onChange={(e) => patchQr({ logoSize: parseInt(e.target.value, 10) })}
                    className="mt-2 w-full accent-cyan-500" />
                </label>
              </div>

              <label className="flex items-center gap-2 text-xs text-slate-300">
                <input type="checkbox" checked={theme.qr?.logoEnabled !== false} onChange={(e) => patchQr({ logoEnabled: e.target.checked })}
                  className="accent-cyan-500" />
                Hiển thị logo ở giữa QR
              </label>

              <ThemeImageUpload
                label="Logo giữa QR"
                value={theme.qr?.logoUrl ?? null}
                onChange={(url) => patchQr({ logoUrl: url })}
                maxWidth={600}
                aspect="square"
              />

              <button type="button" onClick={() => patchTheme({ qr: undefined })}
                className="text-xs text-slate-500 hover:text-slate-300">
                Khôi phục QR mặc định
              </button>
            </div>

            <div className="rounded-2xl border border-sky-100 bg-white p-3 flex flex-col items-center justify-center">
              <QRCodeView value="https://dangky.hoithaotructuyen.net/checkin/demo" size={150} qrStyle={theme.qr ?? null} />
              <p className="mt-2 text-[10px] text-slate-500 text-center">Preview QR</p>
            </div>
          </div>
        </CollapsibleSetting>
        </>
        )}
      </div>
      )}

      {/* Questions */}
      {visibleActiveTab === "questions" && (
      <div className="mb-4">
        <label className="text-xs text-slate-500 uppercase tracking-widest mb-2 block">
          Câu hỏi ({questions.length})
        </label>

        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={handleDragEnd}
          modifiers={[restrictToVerticalAxis, restrictToParentElement]}
        >
          <SortableContext items={questions.map((q) => q._key)} strategy={verticalListSortingStrategy}>
            <div className="flex flex-col gap-2">
              {questions.map((q) => (
                <DraftItem
                  key={q._key}
                  question={q}
                  allQuestions={questions}
                  expanded={expandedKey === q._key}
                  onToggleExpand={() => setExpandedKey(expandedKey === q._key ? null : q._key)}
                  onUpdate={(patch) => updateQuestion(q._key, patch)}
                  onRemove={() => removeQuestion(q._key)}
                  onDuplicate={() => duplicateQuestion(q._key)}
                  availableQuestionTypes={availableQuestionTypes}
                  allowHallSelector={isCheckinEnabled}
                />
              ))}
            </div>
          </SortableContext>
        </DndContext>

        {/* Add question buttons */}
        <div className="grid grid-cols-2 gap-1.5 mt-3">
          {availableQuestionTypes.map((t) => (
            <button
              key={t.type}
              onClick={() => addQuestion(t.type)}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-dashed border-sky-200 bg-white hover:border-sky-400 hover:bg-sky-50 text-slate-600 hover:text-sky-700 text-xs transition-all"
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>
      </div>
      )}

      {/* Actions */}
      {validationMessage && (
        <div className="mb-3 rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-100">
          {validationMessage}
        </div>
      )}
      <div className="flex gap-2">
        <button type="button" onClick={onCancel} disabled={saving} className="flex-1 py-3 rounded-xl font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-50 transition-colors disabled:cursor-not-allowed disabled:opacity-50">
          Huỷ
        </button>
        <motion.button
          type="button"
          onClick={handleSave}
          disabled={!isValid || saving}
          title={saving ? "Đang lưu form..." : validationMessage ?? undefined}
          whileTap={{ scale: 0.98 }}
          className="admin-primary flex-1 py-3 rounded-xl font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-70"
        >
          {saving ? "Đang lưu..." : initial ? "Lưu thay đổi" : "Tạo khảo sát"}
        </motion.button>
      </div>
    </motion.div>
  );
}

function ScoringSettings({
  scoring,
  questions,
  onChange,
}: {
  scoring: ScoringConfig;
  questions: DraftQuestion[];
  onChange: (next: ScoringConfig) => void;
}) {
  const answerableQuestions = questions.filter((question) => question.id && question.type !== "section" && question.type !== "image_banner" && question.type !== "face_checkin");
  const scoreQuestions = questions.filter((question) => question.id && (question.type === "rating" || question.type === "nps"));
  const criteria = scoring.criteria ?? [];
  const selectedCriterionIds = new Set(criteria.map((criterion) => criterion.questionId));

  const patchScoring = (patch: Partial<ScoringConfig>) => onChange({ ...scoring, ...patch });

  const setCriterionEnabled = (question: DraftQuestion, enabled: boolean) => {
    if (!question.id) return;
    if (enabled) {
      const exists = criteria.some((criterion) => criterion.questionId === question.id);
      if (!exists) {
        patchScoring({
          criteria: [
            ...criteria,
            { questionId: question.id, label: question.text, weight: 1 },
          ],
        });
      }
      return;
    }
    patchScoring({ criteria: criteria.filter((criterion) => criterion.questionId !== question.id) });
  };

  const updateCriterion = (questionId: string, patch: Partial<NonNullable<ScoringConfig["criteria"]>[number]>) => {
    patchScoring({
      criteria: criteria.map((criterion) => criterion.questionId === questionId ? { ...criterion, ...patch } : criterion),
    });
  };

  const autoConfigure = () => {
    const judge = answerableQuestions.find((question) => hasAny(question.text, ["giam khao", "giám khảo", "judge", "ban giam khao"]))
      ?? answerableQuestions.find((question) => question.type === "choice")
      ?? answerableQuestions[0];
    const poster = answerableQuestions.find((question) => hasAny(question.text, ["poster", "bao cao", "báo cáo", "ma poster", "mã poster", "de tai", "đề tài"]))
      ?? answerableQuestions.find((question) => question.id !== judge?.id && question.type === "choice")
      ?? answerableQuestions.find((question) => question.id !== judge?.id);

    onChange({
      enabled: true,
      judgeQuestionId: judge?.id ?? null,
      posterQuestionId: poster?.id ?? null,
      duplicateMode: "latest",
      criteria: scoreQuestions.map((question) => ({
        questionId: question.id!,
        label: question.text,
        weight: 1,
      })),
    });
  };

  const missing = [
    !scoring.judgeQuestionId ? "Chưa chọn câu Giám khảo" : "",
    !scoring.posterQuestionId ? "Chưa chọn câu Poster" : "",
    criteria.length === 0 ? "Chưa chọn tiêu chí điểm" : "",
  ].filter(Boolean);

  return (
    <div className="mb-5 space-y-3">
      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-sm font-semibold text-white">
              <Trophy size={16} className="text-amber-300" />
              Bảng điểm poster
            </div>
            <p className="mt-1 text-xs leading-5 text-slate-500">
              Dùng dữ liệu submit của form để tính điểm trung bình theo poster, từng tiêu chí và từng giám khảo.
            </p>
          </div>
          <label className="inline-flex cursor-pointer items-center gap-2 text-xs font-semibold text-slate-300">
            <input
              type="checkbox"
              checked={!!scoring.enabled}
              onChange={(event) => patchScoring({ enabled: event.target.checked })}
              className="accent-amber-400"
            />
            Bật scoring
          </label>
        </div>

        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <label className="text-[11px] text-slate-400">
            Câu chọn giám khảo
            <select
              value={scoring.judgeQuestionId ?? ""}
              onChange={(event) => patchScoring({ judgeQuestionId: event.target.value || null })}
              className="admin-field admin-dark-select mt-1 w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
              style={{ colorScheme: "light" }}
            >
              <option value="">Chọn câu hỏi...</option>
              {answerableQuestions.map((question, index) => (
                <option key={question.id} value={question.id}>
                  Câu {index + 1}: {question.text || getQuestionTypeName(question.type)}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[11px] text-slate-400">
            Câu chọn poster
            <select
              value={scoring.posterQuestionId ?? ""}
              onChange={(event) => patchScoring({ posterQuestionId: event.target.value || null })}
              className="admin-field admin-dark-select mt-1 w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
              style={{ colorScheme: "light" }}
            >
              <option value="">Chọn câu hỏi...</option>
              {answerableQuestions.map((question, index) => (
                <option key={question.id} value={question.id}>
                  Câu {index + 1}: {question.text || getQuestionTypeName(question.type)}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_170px]">
          <label className="text-[11px] text-slate-400">
            Khi cùng một giám khảo chấm cùng một poster nhiều lần
            <select
              value={scoring.duplicateMode ?? "latest"}
              onChange={(event) => patchScoring({ duplicateMode: event.target.value as "latest" | "all" })}
              className="admin-field admin-dark-select mt-1 w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none"
              style={{ colorScheme: "light" }}
            >
              <option value="latest">Lấy lần mới nhất</option>
              <option value="all">Tính tất cả lượt chấm</option>
            </select>
          </label>

          <button
            type="button"
            onClick={autoConfigure}
            className="self-end rounded-xl border border-amber-400/20 bg-amber-400/10 px-4 py-2.5 text-sm font-semibold text-amber-100 transition-colors hover:bg-amber-400/15"
          >
            Tự gợi ý
          </button>
        </div>
      </div>

      <div className="rounded-xl border border-white/8 bg-white/[0.02] p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <div>
            <div className="text-sm font-semibold text-white">Tiêu chí tính điểm</div>
            <p className="mt-1 text-xs text-slate-500">Chọn các câu loại Đánh giá hoặc Thang điểm để đưa vào tổng điểm trung bình.</p>
          </div>
          <span className="rounded-full border border-sky-200 bg-sky-50 px-2.5 py-1 text-xs text-sky-700">
            {criteria.length}/{scoreQuestions.length}
          </span>
        </div>

        {scoreQuestions.length === 0 ? (
          <div className="rounded-xl border border-amber-400/20 bg-amber-400/10 px-3 py-3 text-xs leading-5 text-amber-100">
            Chưa có câu điểm nào. Hãy thêm câu loại “Đánh giá” hoặc “Thang điểm” trong tab Câu hỏi.
          </div>
        ) : (
          <div className="space-y-2">
            {scoreQuestions.map((question, index) => {
              const checked = !!question.id && selectedCriterionIds.has(question.id);
              const criterion = criteria.find((item) => item.questionId === question.id);
              return (
                <div
                  key={question.id}
                  className="rounded-xl border border-white/8 bg-white/[0.025] px-3 py-3"
                >
                  <div className="flex items-start gap-3">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={(event) => setCriterionEnabled(question, event.target.checked)}
                      className="mt-1 accent-amber-400"
                    />
                    <div className="min-w-0 flex-1">
                      <div className="text-sm font-medium text-white">Câu {index + 1}: {question.text}</div>
                      <div className="mt-1 text-xs text-slate-500">{getQuestionTypeName(question.type)} · thang tối đa {getScoreMax(question)}</div>
                    </div>
                  </div>

                  {checked && question.id && (
                    <div className="mt-3 grid gap-2 sm:grid-cols-[minmax(0,1fr)_110px]">
                      <input
                        value={criterion?.label ?? question.text}
                        onChange={(event) => updateCriterion(question.id!, { label: event.target.value })}
                        placeholder="Tên hiển thị trên bảng điểm"
                        className="admin-field rounded-lg px-3 py-2 text-xs admin-placeholder focus:outline-none"
                      />
                      <label className="flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-xs text-slate-400">
                        Trọng số
                        <input
                          type="number"
                          min={0}
                          step={0.5}
                          value={criterion?.weight ?? 1}
                          onChange={(event) => updateCriterion(question.id!, { weight: Math.max(0, Number(event.target.value) || 0) })}
                          className="w-full bg-transparent text-right text-white focus:outline-none"
                        />
                      </label>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {missing.length > 0 && scoring.enabled && (
          <div className="mt-3 rounded-xl border border-red-400/20 bg-red-400/10 px-3 py-3 text-xs leading-5 text-red-100">
            {missing.join(" · ")}
          </div>
        )}
      </div>
    </div>
  );
}

function normalizeText(value: string) {
  return value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function hasAny(value: string, needles: string[]) {
  const text = normalizeText(value);
  return needles.some((needle) => text.includes(normalizeText(needle)));
}

function getTabLabel(tab: EditorTab) {
  if (tab === "payment") return "Thanh toán";
  if (tab === "email") return "Sau khi gửi";
  if (tab === "checkin") return "Check-in";
  if (tab === "scoring") return "Chấm điểm";
  if (tab === "appearance") return "Giao diện";
  return "Câu hỏi";
}

function getQuestionTypeName(type: SurveyQuestionType) {
  if (type === "choice") return "Lựa chọn";
  if (type === "rating") return "Đánh giá";
  if (type === "nps") return "Thang điểm";
  if (type === "text") return "Văn bản ngắn";
  if (type === "paragraph") return "Đoạn văn";
  if (type === "phone") return "Số điện thoại";
  if (type === "province") return "Tỉnh thành";
  if (type === "date") return "Ngày";
  if (type === "file_upload") return "Tệp tải lên";
  if (type === "signature") return "Chữ ký";
  return "Câu hỏi";
}

function getScoreMax(question: DraftQuestion) {
  if (question.type === "rating") return 5;
  if (question.type === "nps") return Number.parseInt(question.options?.[2] ?? "10", 10) || 10;
  return 0;
}

// ─── Sortable item with drag controls ─────────────────────────────────────────

function DraftItem({
  question: q,
  allQuestions,
  expanded,
  onToggleExpand,
  onUpdate,
  onRemove,
  onDuplicate,
  availableQuestionTypes,
  allowHallSelector,
}: {
  question: DraftQuestion;
  allQuestions: DraftQuestion[];
  expanded: boolean;
  onToggleExpand: () => void;
  onUpdate: (patch: Partial<DraftQuestion>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  availableQuestionTypes: typeof QUESTION_TYPES;
  allowHallSelector: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: q._key });
  const style = { transform: CSS.Transform.toString(transform), transition, zIndex: isDragging ? 30 : undefined };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded-xl border bg-white overflow-hidden ${isDragging ? "border-sky-300 shadow-lg" : "border-sky-100"}`}
    >
      {/* Header */}
      <div
        className="flex items-center gap-2 px-2 py-2.5 cursor-pointer hover:bg-white/[0.03] transition-colors"
        onClick={onToggleExpand}
      >
        {/* Drag handle */}
        <button
          type="button"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()}
          className="w-7 h-7 -ml-0.5 rounded-md flex items-center justify-center admin-subtle hover:text-slate-300 hover:bg-white/5 transition-colors cursor-grab active:cursor-grabbing touch-none flex-shrink-0"
          title="Kéo để sắp xếp"
        >
          <GripVertical size={14} />
        </button>

        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <select
              value={q.type}
              onChange={(e) => {
                const newType = e.target.value as SurveyQuestionType;
                if (!availableQuestionTypes.some((item) => item.type === newType)) return;
                onUpdate({
                  type: newType,
                  options: newType === "choice" ? (q.options ?? ["", ""]) : null,
                  allow_multiple: newType === "choice" ? q.allow_multiple : false,
                  is_hall_selector: newType === "choice" && allowHallSelector ? q.is_hall_selector : false,
                });
              }}
              onClick={(e) => e.stopPropagation()}
               className="admin-dark-select text-[10px] px-1.5 py-0.5 rounded font-semibold uppercase tracking-wider bg-sky-100 text-sky-700 border-none focus:outline-none cursor-pointer appearance-none"
               style={{ colorScheme: "light" }}
            >
              {availableQuestionTypes.map((t) => (
                <option key={t.type} value={t.type}>{t.label}</option>
              ))}
            </select>
            {q.type === "choice" && q.allow_multiple && (
              <span className="text-[10px] text-cyan-400 flex items-center gap-0.5">
                <ListChecks size={10} /> Nhiều
              </span>
            )}
            {q.required && <span className="text-[10px] text-red-400">*</span>}
          </div>
          <p className="text-xs text-slate-400 truncate mt-0.5">
            {q.text || <span className="italic admin-subtle">Chưa có nội dung</span>}
          </p>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onDuplicate(); }}
            className="w-7 h-7 rounded-md flex items-center justify-center admin-subtle hover:text-emerald-400 hover:bg-emerald-500/10 transition-colors"
            title="Nhân bản câu hỏi"
          >
            <Copy size={12} />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onRemove(); }}
            className="w-7 h-7 rounded-md flex items-center justify-center admin-subtle hover:text-red-400 hover:bg-red-500/10 transition-colors"
            title="Xoá câu hỏi"
          >
            <Trash2 size={12} />
          </button>
          <motion.div animate={{ rotate: expanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown size={14} className="text-slate-500" />
          </motion.div>
        </div>
      </div>

      {/* Edit body */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden border-t border-white/5 px-3 py-3"
          >
            <div className="flex flex-col gap-2">
              {/* Section: title only */}
              {q.type === "section" && (
                <>
                  <input
                    value={q.text}
                    onChange={(e) => onUpdate({ text: e.target.value })}
                    placeholder="Tiêu đề section..."
                    className="admin-field w-full rounded-lg px-3 py-2 text-sm admin-placeholder focus:outline-none"
                  />
                  <input
                    value={q.options?.[0] ?? ""}
                    onChange={(e) => onUpdate({ options: [e.target.value] })}
                    placeholder="Mô tả phụ (tuỳ chọn)..."
                    className="admin-field w-full rounded-lg px-3 py-2 text-xs admin-placeholder focus:outline-none"
                  />
                </>
              )}

              {/* Image banner: URL input */}
              {q.type === "image_banner" && (
                <>
                  <input
                    value={q.text}
                    onChange={(e) => onUpdate({ text: e.target.value })}
                    placeholder="Dán URL ảnh (1200×400px khuyến nghị)..."
                    className="admin-field w-full rounded-lg px-3 py-2 text-sm admin-placeholder focus:outline-none"
                  />
                  {q.text && (
                    <img src={q.text} alt="Preview" loading="lazy" className="rounded-lg max-h-28 w-full object-cover border border-white/10" />
                  )}
                  <input
                    value={q.options?.[0] ?? ""}
                    onChange={(e) => onUpdate({ options: [e.target.value] })}
                    placeholder="Caption (tuỳ chọn)..."
                    className="admin-field w-full rounded-lg px-3 py-2 text-xs admin-placeholder focus:outline-none"
                  />
                </>
              )}

              {/* Normal question types */}
              {q.type !== "section" && q.type !== "image_banner" && (
                <>
                  <textarea
                    value={q.text}
                    onChange={(e) => onUpdate({ text: e.target.value })}
                    placeholder="Nội dung câu hỏi..."
                    rows={2}
                    className="admin-field w-full rounded-lg px-3 py-2 text-sm admin-placeholder focus:outline-none resize-none"
                  />

                  {/* NPS config: labels + max value */}
                  {q.type === "nps" && (
                    <div className="flex flex-col gap-1.5 p-2 rounded-lg bg-white/[0.02] border border-white/5">
                      <div className="flex gap-2">
                        <input
                          value={q.options?.[0] ?? ""}
                          onChange={(e) => {
                            const opts = [...(q.options ?? ["", "", "10"])];
                            opts[0] = e.target.value;
                            onUpdate({ options: opts });
                          }}
                          placeholder="Label 0 (VD: Rất không hài lòng)"
                          className="admin-field flex-1 rounded-lg px-2 py-1.5 text-xs admin-placeholder focus:outline-none"
                        />
                        <input
                          value={q.options?.[1] ?? ""}
                          onChange={(e) => {
                            const opts = [...(q.options ?? ["", "", "10"])];
                            opts[1] = e.target.value;
                            onUpdate({ options: opts });
                          }}
                          placeholder="Label max (VD: Rất hài lòng)"
                          className="admin-field flex-1 rounded-lg px-2 py-1.5 text-xs admin-placeholder focus:outline-none"
                        />
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[10px] text-slate-500">Giá trị tối đa:</span>
                        <select
                          value={q.options?.[2] ?? "10"}
                          onChange={(e) => {
                            const opts = [...(q.options ?? ["", "", "10"])];
                            opts[2] = e.target.value;
                            onUpdate({ options: opts });
                          }}
                          className="admin-field admin-dark-select rounded-lg px-2 py-1 text-xs focus:outline-none"
                          style={{ colorScheme: "light" }}
                        >
                          {[3, 4, 5, 6, 7, 8, 9, 10].map((n) => (
                            <option key={n} value={String(n)}>{n}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  )}

              {/* Choice options + multi toggle */}
              {q.type === "choice" && (
                <>
                  <div className="flex flex-col gap-1.5">
                    {(q.options ?? []).map((opt, oi) => (
                      <div key={oi} className="flex items-center gap-2">
                        <span className="text-xs text-slate-500 w-4">{String.fromCharCode(65 + oi)}</span>
                        <input
                          value={opt}
                          onChange={(e) => {
                            const next = [...(q.options ?? [])];
                            next[oi] = e.target.value;
                            onUpdate({ options: next });
                          }}
                          placeholder={`Lựa chọn ${String.fromCharCode(65 + oi)}...`}
                          className="admin-field flex-1 rounded-lg px-2 py-1.5 text-xs admin-placeholder focus:outline-none"
                        />
                        {(q.options?.length ?? 0) > 2 && (
                          <button
                            onClick={() => onUpdate({ options: q.options?.filter((_, idx) => idx !== oi) })}
                            className="admin-subtle hover:text-red-400 transition-colors"
                          >
                            <X size={12} />
                          </button>
                        )}
                      </div>
                    ))}
                    {(q.options?.length ?? 0) < 10 && (
                      <button
                        onClick={() => onUpdate({ options: [...(q.options ?? []), ""] })}
                        className="text-xs text-slate-500 hover:text-emerald-400 flex items-center gap-1 transition-colors"
                      >
                        <Plus size={12} /> Thêm lựa chọn
                      </button>
                    )}
                  </div>

                  {/* Multi toggle */}
                  <div
                    onClick={() => onUpdate({ allow_multiple: !q.allow_multiple })}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all"
                    style={{
                      background: q.allow_multiple ? "rgba(34,211,238,0.08)" : "rgba(255,255,255,0.02)",
                      border: `1px solid ${q.allow_multiple ? "rgba(34,211,238,0.3)" : "rgba(255,255,255,0.06)"}`,
                    }}
                  >
                    <ListChecks size={14} className={q.allow_multiple ? "text-cyan-400" : "text-slate-500"} />
                    <div className="flex-1">
                      <div className="text-xs font-medium text-white">Cho phép chọn nhiều đáp án</div>
                      <div className="text-[10px] text-slate-500">Người chơi có thể tick nhiều ô</div>
                    </div>
                    <div className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
                      style={{ background: q.allow_multiple ? "#22d3ee" : "rgba(255,255,255,0.1)" }}>
                      <motion.div
                        animate={{ x: q.allow_multiple ? 18 : 2 }}
                        transition={{ type: "spring", stiffness: 500, damping: 30 }}
                        className="absolute top-0.5 w-4 h-4 rounded-full bg-white"
                      />
                    </div>
                  </div>

                  {/* Hall selector toggle */}
                  {allowHallSelector && (
                    <div
                      onClick={() => {
                        const turningOn = !q.is_hall_selector;
                        onUpdate({ is_hall_selector: turningOn, ...(turningOn ? { required: true } : {}) } as Partial<DraftQuestion>);
                      }}
                      className="flex items-center gap-2 px-3 py-2 rounded-lg cursor-pointer transition-all mt-2"
                      style={{
                        background: q.is_hall_selector ? "rgba(99,102,241,0.08)" : "rgba(255,255,255,0.02)",
                        border: `1px solid ${q.is_hall_selector ? "rgba(99,102,241,0.3)" : "rgba(255,255,255,0.06)"}`,
                      }}
                    >
                      <MapPin size={14} className={q.is_hall_selector ? "text-indigo-400" : "text-slate-500"} />
                      <div className="flex-1">
                        <div className="text-xs font-medium text-white">Dùng để phân hội trường</div>
                        <div className="text-[10px] text-slate-500">Đáp án người chọn = hội trường của họ (cho check-in)</div>
                      </div>
                      <div className="relative w-9 h-5 rounded-full transition-colors flex-shrink-0"
                        style={{ background: q.is_hall_selector ? "#6366f1" : "rgba(255,255,255,0.1)" }}>
                        <motion.div
                          animate={{ x: q.is_hall_selector ? 18 : 2 }}
                          transition={{ type: "spring", stiffness: 500, damping: 30 }}
                          className="absolute top-0.5 w-4 h-4 rounded-full bg-white"
                        />
                      </div>
                    </div>
                  )}
                </>
              )}

                </>
              )}

              {q.type !== "section" && q.type !== "image_banner" && (
                <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={q.required}
                    onChange={(e) => onUpdate({ required: e.target.checked })}
                    className="rounded"
                  />
                  Bắt buộc trả lời
                </label>
              )}

              {/* Conditional logic */}
              {(() => {
                const prevAnswerable = allQuestions.filter(
                  (p) => p._key !== q._key && allQuestions.indexOf(p) < allQuestions.indexOf(q)
                    && p.type !== "section" && p.type !== "image_banner"
                );
                if (prevAnswerable.length === 0) return null;
                const hasCondition = !!q.show_if;

                // Find the source question to determine what value selector to render
                const sourceQ = q.show_if
                  ? prevAnswerable.find((p) => p.id === q.show_if!.question_id)
                  : null;

                // Choose operators based on source type
                const sourceType = sourceQ?.type;
                const isNumeric = sourceType === "rating" || sourceType === "nps";
                const isChoice = sourceType === "choice";
                const isText = sourceType === "text" || sourceType === "paragraph" || sourceType === "phone" || sourceType === "province" || sourceType === "date";

                return (
                  <div className="mt-1 p-2 rounded-lg border border-white/5 bg-white/[0.02]">
                    <label className="flex items-center gap-1.5 text-xs text-slate-500 cursor-pointer mb-1.5">
                      <input
                        type="checkbox"
                        checked={hasCondition}
                        onChange={(e) => {
                          if (e.target.checked) {
                            // Prefer nearest preceding choice/rating/nps (good branch source); else nearest answerable
                            const branchable = [...prevAnswerable].reverse().find(
                              (p) => p.type === "choice" || p.type === "rating" || p.type === "nps"
                            );
                            const src = branchable ?? prevAnswerable[prevAnswerable.length - 1];
                            const defaultOp = (src.type === "rating" || src.type === "nps") ? "gte" : "eq";
                            const defaultVal = src.type === "choice" ? 0 : (src.type === "rating" || src.type === "nps") ? 0 : "";
                            onUpdate({ show_if: { question_id: src.id!, operator: defaultOp, value: defaultVal } });
                          } else {
                            onUpdate({ show_if: null });
                          }
                        }}
                        className="rounded"
                      />
                      Chỉ hiện khi...
                    </label>
                    {hasCondition && q.show_if && (
                      <div className="flex flex-wrap gap-1.5 items-center">
                        <select
                          value={q.show_if.question_id}
                          onChange={(e) => {
                            const newSrc = prevAnswerable.find((p) => p.id === e.target.value);
                            const newOp = (newSrc?.type === "rating" || newSrc?.type === "nps") ? "gte" : "eq";
                            const newVal = newSrc?.type === "choice" ? 0 : (newSrc?.type === "rating" || newSrc?.type === "nps") ? 0 : "";
                            onUpdate({ show_if: { question_id: e.target.value, operator: newOp, value: newVal } });
                          }}
                          className="admin-field admin-dark-select rounded-lg px-2 py-1 text-[11px] focus:outline-none"
                          style={{ colorScheme: "light", maxWidth: 140 }}
                        >
                          {prevAnswerable.map((p) => (
                            <option key={p._key} value={p.id}>
                              Câu {allQuestions.indexOf(p) + 1}: {p.text.slice(0, 20) || `(${p.type})`}
                            </option>
                          ))}
                        </select>
                        <select
                          value={q.show_if.operator}
                          onChange={(e) => onUpdate({ show_if: { ...q.show_if!, operator: e.target.value as "eq" | "neq" | "lt" | "lte" | "gt" | "gte" | "contains" | "not_contains" } })}
                          className="admin-field admin-dark-select rounded-lg px-2 py-1 text-[11px] focus:outline-none"
                          style={{ colorScheme: "light" }}
                        >
                          <option value="eq">= bằng</option>
                          <option value="neq">≠ khác</option>
                          {isNumeric && (
                            <>
                              <option value="gte">≥ từ</option>
                              <option value="lte">≤ đến</option>
                              <option value="gt">&gt; lớn hơn</option>
                              <option value="lt">&lt; nhỏ hơn</option>
                            </>
                          )}
                          {isChoice && sourceQ?.allow_multiple && (
                            <>
                              <option value="contains">chứa</option>
                              <option value="not_contains">không chứa</option>
                            </>
                          )}
                          {isText && (
                            <>
                              <option value="contains">chứa từ</option>
                              <option value="not_contains">không chứa từ</option>
                            </>
                          )}
                        </select>

                        {/* Value selector — context-aware */}
                        {isChoice && sourceQ?.options ? (
                          <select
                            value={String(q.show_if.value)}
                            onChange={(e) => onUpdate({ show_if: { ...q.show_if!, value: parseInt(e.target.value, 10) } })}
                            className="admin-field admin-dark-select rounded-lg px-2 py-1 text-[11px] focus:outline-none"
                            style={{ colorScheme: "light", maxWidth: 140 }}
                          >
                            {sourceQ.options.map((opt, oi) => (
                              <option key={oi} value={oi}>{String.fromCharCode(65 + oi)}: {opt.slice(0, 20) || `(option ${oi + 1})`}</option>
                            ))}
                          </select>
                        ) : isNumeric ? (
                          <input
                            type="number"
                            min={sourceType === "rating" ? 1 : 0}
                            max={sourceType === "rating" ? 5 : parseInt(sourceQ?.options?.[2] ?? "10", 10)}
                            value={Number(q.show_if.value) || 0}
                            onChange={(e) => onUpdate({ show_if: { ...q.show_if!, value: parseInt(e.target.value, 10) || 0 } })}
                            className="admin-field w-16 rounded-lg px-2 py-1 text-[11px] focus:outline-none"
                          />
                        ) : (
                          <input
                            value={String(q.show_if.value)}
                            onChange={(e) => onUpdate({ show_if: { ...q.show_if!, value: e.target.value } })}
                            placeholder="Giá trị"
                            className="admin-field flex-1 min-w-[80px] rounded-lg px-2 py-1 text-[11px] admin-placeholder focus:outline-none"
                          />
                        )}
                      </div>
                    )}
                  </div>
                );
              })()}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}


// Collapsible setting block — click header to toggle. Auto-opens if a hint is set.
function CollapsibleSetting({
  label, hint, icon, children,
}: {
  label: string;
  hint?: string;
  icon?: string;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-sky-100 bg-white overflow-hidden">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-white/[0.03] transition-colors text-left"
      >
        {icon && <span className="text-base flex-shrink-0">{icon}</span>}
        <span className="text-xs font-medium text-slate-300 flex-1">{label}</span>
        {hint && (
          <span className="text-[10px] text-emerald-400 font-medium">{hint}</span>
        )}
        <motion.div animate={{ rotate: open ? 180 : 0 }} transition={{ duration: 0.2 }}>
          <ChevronDown size={14} className="text-slate-500" />
        </motion.div>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 border-t border-white/5">
              {children}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
