"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useConfirm } from "@/lib/ui/confirm";
import { BarChart3, ClipboardList, Copy, ExternalLink, Layers, Link2, Loader2, Plus, Search, Trash2, Trophy, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAdminAccess } from "@/components/auth/AdminAccessProvider";
import type { SurveyFormType } from "@/lib/surveys";
import { listEvents, type EventRecord } from "@/lib/events";
import {
  createRegistrationForm,
  deleteRegistrationForm,
  duplicateRegistrationForm,
  getFormPreviewQuestions,
  listRegistrationForms,
  type FormPreviewQuestion,
  type RegistrationFormSummary,
} from "@/lib/forms";
import { PageHeader } from "./PageHeader";

export function FormsList() {
  const { user } = useAuth();
  const { canManageForms } = useAdminAccess();
  const confirm = useConfirm();
  const [forms, setForms] = useState<RegistrationFormSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<SurveyFormType | null>(null);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<"all" | SurveyFormType>("all");
  const [eventFilter, setEventFilter] = useState("all");
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [previews, setPreviews] = useState<Record<string, FormPreviewQuestion[]>>({});
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);

  const refresh = async () => {
    if (!user?.id) return;
    setLoading(true);
    setForms(await listRegistrationForms());
    setLoading(false);
  };

  useEffect(() => {
    let active = true;
    if (!user?.id) {
      Promise.resolve().then(() => {
        if (!active) return;
        setForms([]);
        setLoading(false);
      });
      return () => { active = false; };
    }
    listRegistrationForms().then(async (items) => {
      if (!active) return;
      setForms(items);
      setLoading(false);
      const map = await getFormPreviewQuestions(items.map((item) => item.id));
      if (active) setPreviews(map);
    });
    return () => { active = false; };
  }, [user?.id]);

  useEffect(() => {
    let active = true;
    void listEvents().then((items) => {
      if (active) setEvents(items);
    });
    return () => { active = false; };
  }, []);

  const eventByForm = useMemo(() => {
    const map = new Map<string, EventRecord>();
    events.forEach((event) => {
      event.form_ids.forEach((formId) => map.set(formId, event));
    });
    return map;
  }, [events]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return forms.filter((form) => {
      if (typeFilter !== "all" && form.formType !== typeFilter) return false;
      if (eventFilter !== "all") {
        const event = eventByForm.get(form.id);
        if (eventFilter === "none") {
          if (event) return false;
        } else if (event?.id !== eventFilter) {
          return false;
        }
      }
      if (!q) return true;
      return form.title.toLowerCase().includes(q);
    });
  }, [forms, search, typeFilter, eventFilter, eventByForm]);

  const handleCreate = async (formType: SurveyFormType = "registration") => {
    if (!user?.id || creating || !canManageForms) return;
    setCreating(formType);
    const id = await createRegistrationForm(
      user.id,
      formType === "poster_scoring" ? "Form chấm điểm poster" : "Form đăng ký CME",
      formType,
    );
    setCreating(null);
    if (id) window.location.href = `/admin/forms/${id}`;
  };

  const handleDuplicate = async (form: RegistrationFormSummary) => {
    if (!canManageForms || duplicatingId) return;
    setDuplicatingId(form.id);
    const id = await duplicateRegistrationForm(form.id);
    setDuplicatingId(null);
    if (id) {
      await refresh();
      return;
    }
    toast.error("Nhân bản form thất bại. Vui lòng thử lại.");
  };

  const handleDelete = async (form: RegistrationFormSummary) => {
    if (!canManageForms) return;
    if (!(await confirm({ title: `Xóa form "${form.title}"?`, description: "Tất cả câu hỏi và đăng ký liên quan sẽ bị xóa.", destructive: true, confirmText: "Xóa" }))) return;
    await deleteRegistrationForm(form.id);
    await refresh();
  };

  const copyLink = (id: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/s/${id}`);
  };

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10 max-w-6xl">
      <PageHeader
        title="Quản lý form"
        subtitle="Tạo, cấu hình, nhân bản và quản lý vòng đời các form đăng ký, chấm điểm, khảo sát."
        action={
          canManageForms ? (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => handleCreate("registration")} disabled={!!creating}
                className="admin-primary flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold disabled:opacity-50">
                <Plus size={18} /> {creating === "registration" ? "Đang tạo..." : "Tạo đăng ký"}
              </button>
              <button onClick={() => handleCreate("poster_scoring")} disabled={!!creating}
                className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50">
                <Trophy size={18} /> {creating === "poster_scoring" ? "Đang tạo..." : "Tạo chấm điểm"}
              </button>
            </div>
          ) : null
        }
      />

      <div className="mb-6 flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-[220px] max-w-md">
          <Search size={16} className="admin-subtle absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm form..."
            className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-9 py-2.5 text-sm text-white admin-placeholder focus:outline-none focus:border-emerald-500" />
          {search && (
            <button onClick={() => setSearch("")} className="admin-subtle absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded flex items-center justify-center hover:text-white hover:bg-white/5">
              <X size={14} />
            </button>
          )}
        </div>
        <div className="flex gap-1 rounded-xl border border-white/10 bg-white/5 p-1">
          {([
            { value: "all", label: "Tất cả" },
            { value: "registration", label: "Đăng ký" },
            { value: "poster_scoring", label: "Chấm điểm" },
            { value: "feedback", label: "Khảo sát" },
          ] as const).map((option) => (
            <button
              key={option.value}
              onClick={() => setTypeFilter(option.value)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
                typeFilter === option.value ? "bg-sky-500 text-on-brand" : "text-slate-600 hover:text-slate-900"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
        {events.length > 0 && (
          <select
            value={eventFilter}
            onChange={(event) => setEventFilter(event.target.value)}
            className="admin-dark-select rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-semibold text-slate-700 focus:outline-none"
          >
            <option value="all">Tất cả sự kiện</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>{event.name}</option>
            ))}
            <option value="none">Chưa gán sự kiện</option>
          </select>
        )}
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <div key={i} className="glass rounded-2xl h-44 animate-pulse" />)}
        </div>
      ) : forms.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center max-w-xl">
          <ClipboardList size={42} className="mx-auto mb-3 text-sky-300" />
          <h2 className="text-xl font-semibold text-slate-900 mb-2">Chưa có form nào</h2>
          <p className="text-sm text-slate-600 mb-5">Tạo form đầu tiên để nhận đăng ký và check-in.</p>
          {canManageForms ? (
            <button onClick={() => handleCreate("registration")} disabled={!!creating}
              className="admin-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
              <Plus size={16} /> Tạo form đầu tiên
            </button>
          ) : (
            <p className="text-xs text-slate-600">Tài khoản của bạn chỉ có quyền xem.</p>
          )}
        </div>
      ) : filtered.length === 0 ? (
        <div className="glass rounded-2xl p-8 text-center text-sm text-slate-500">Không tìm thấy form phù hợp.</div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <AnimatePresence mode="popLayout">
            {filtered.map((form, index) => (
              <motion.div key={form.id} layout initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.96 }} transition={{ delay: Math.min(index, 8) * 0.03 }}>
                <FormCard
                  form={form}
                  canManageForms={canManageForms}
                  eventName={eventByForm.get(form.id)?.name}
                  preview={previews[form.id]}
                  onCopy={() => copyLink(form.id)}
                  onDuplicate={() => handleDuplicate(form)}
                  onDelete={() => handleDelete(form)}
                  duplicating={duplicatingId === form.id}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function FormCard({ form, canManageForms, eventName, preview, onCopy, onDuplicate, onDelete, duplicating }: {
  form: RegistrationFormSummary;
  canManageForms: boolean;
  eventName?: string;
  preview?: FormPreviewQuestion[];
  onCopy: () => void;
  onDuplicate: () => void;
  onDelete: () => void;
  duplicating: boolean;
}) {
  const accent = form.accentColor ?? "#0ea5e9";
  return (
    <div className="glass relative overflow-hidden rounded-2xl p-5">
      <div className="absolute inset-x-0 top-0 h-1" style={{ background: `linear-gradient(90deg, ${accent}, ${accent}00)` }} />
      <Link href={`/admin/forms/${form.id}`} className="block">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center"
            style={{ background: `${accent}18`, border: `1px solid ${accent}35`, color: accent }}>
            <ClipboardList size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-slate-900 truncate">{form.title}</h3>
            <p className="text-xs text-slate-600">{getFormTypeLabel(form.formType)} · {form.questionCount} câu hỏi</p>
            {eventName && (
              <span className="mt-1.5 inline-flex max-w-full items-center gap-1 truncate rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 text-[10px] font-semibold text-indigo-600">
                <Layers size={10} /> {eventName}
              </span>
            )}
          </div>
        </div>
      </Link>

      {preview && preview.length > 0 && (
        <div className="mb-4 space-y-1.5 rounded-xl border border-slate-200 bg-slate-50/70 p-2.5">
          <div className="px-0.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">Xem trước</div>
          {preview.map((question, index) => (
            <div key={index} className="rounded-lg border border-slate-100 bg-white px-2.5 py-1.5">
              <div className="truncate text-[11px] text-slate-600">{index + 1}. {question.text || "(chưa có tiêu đề)"}</div>
              {question.options && question.options.length > 0 ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {question.options.slice(0, 3).map((option, optionIndex) => (
                    <span key={optionIndex} className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[9px] text-slate-500">{option}</span>
                  ))}
                  {question.options.length > 3 && <span className="text-[9px] text-slate-400">+{question.options.length - 3}</span>}
                </div>
              ) : (
                <div className="mt-1 h-3 rounded bg-slate-100" />
              )}
            </div>
          ))}
          {form.questionCount > preview.length && (
            <div className="text-center text-[10px] text-slate-400">+{form.questionCount - preview.length} câu khác</div>
          )}
        </div>
      )}

      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="rounded-xl border border-sky-100 bg-sky-50/60 p-3">
          <div className="text-xl font-bold text-sky-700">{form.responseCount}</div>
          <div className="text-[10px] text-slate-600">{form.formType === "poster_scoring" ? "Lượt chấm" : "Đăng ký"}</div>
        </div>
        <div className="rounded-xl border border-indigo-100 bg-indigo-50/60 p-3">
          <div className="text-xl font-bold text-indigo-700">{form.checkinCount}</div>
          <div className="text-[10px] text-slate-600">Check-in</div>
        </div>
      </div>

      <div className="flex items-center gap-1">
        <button onClick={onCopy} title="Copy public link" className="admin-subtle w-9 h-9 rounded-lg flex items-center justify-center hover:text-emerald-400 hover:bg-emerald-500/10">
          <Link2 size={15} />
        </button>
        <Link href={`/s/${form.id}`} target="_blank" title="Mở form" className="admin-subtle w-9 h-9 rounded-lg flex items-center justify-center hover:text-white hover:bg-white/5">
          <ExternalLink size={15} />
        </Link>
        <Link href={`/admin/forms/${form.id}/report`} title="Report" className="admin-subtle w-9 h-9 rounded-lg flex items-center justify-center hover:text-emerald-400 hover:bg-emerald-500/10">
          <BarChart3 size={15} />
        </Link>
        {form.formType === "poster_scoring" && (
          <Link href={`/admin/forms/${form.id}/scoreboard`} title="Bảng điểm poster" className="admin-subtle w-9 h-9 rounded-lg flex items-center justify-center hover:text-amber-300 hover:bg-amber-400/10">
            <Trophy size={15} />
          </Link>
        )}
        {canManageForms && (
          <button onClick={onDuplicate} disabled={duplicating} title="Nhân bản form" className="admin-subtle w-9 h-9 rounded-lg flex items-center justify-center hover:text-sky-400 hover:bg-sky-500/10 disabled:opacity-50">
            {duplicating ? <Loader2 size={15} className="animate-spin" /> : <Copy size={15} />}
          </button>
        )}
        {canManageForms && (
          <button onClick={onDelete} title="Xóa form" className="admin-subtle ml-auto w-9 h-9 rounded-lg flex items-center justify-center hover:text-red-400 hover:bg-red-500/10">
            <Trash2 size={15} />
          </button>
        )}
      </div>
    </div>
  );
}

function getFormTypeLabel(type: SurveyFormType) {
  if (type === "poster_scoring") return "Chấm điểm poster";
  if (type === "feedback") return "Khảo sát";
  return "Đăng ký/check-in";
}
