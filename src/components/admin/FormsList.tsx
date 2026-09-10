"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { BarChart3, ClipboardList, Download, ExternalLink, Link2, Plus, QrCode, Search, Trash2, Trophy, X } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { buildSurveyResponsesCSV, type SurveyAnalytics, type SurveyFormType, type SurveyQuestion, type SurveyResponse } from "@/lib/surveys";
import { downloadCSV, slugify } from "@/lib/csv";
import { supabase } from "@/lib/supabase";
import {
  createRegistrationForm,
  deleteRegistrationForm,
  listRegistrationForms,
  type RegistrationFormSummary,
} from "@/lib/forms";
import { PageHeader } from "./PageHeader";

export function FormsList() {
  const { user } = useAuth();
  const { canManageForms } = useAdminAccess();
  const [forms, setForms] = useState<RegistrationFormSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<SurveyFormType | null>(null);
  const [search, setSearch] = useState("");

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
    listRegistrationForms().then((items) => {
      if (!active) return;
      setForms(items);
      setLoading(false);
    });
    return () => { active = false; };
  }, [user?.id]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return forms;
    return forms.filter((form) => form.title.toLowerCase().includes(q));
  }, [forms, search]);

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

  const handleDelete = async (form: RegistrationFormSummary) => {
    if (!canManageForms) return;
    if (!confirm(`Xóa form "${form.title}"? Tất cả câu hỏi và đăng ký liên quan sẽ bị xóa.`)) return;
    await deleteRegistrationForm(form.id);
    await refresh();
  };

  const handleExport = async (form: RegistrationFormSummary) => {
    const [{ data: survey }, { data: questions }, { data: responses }] = await Promise.all([
      supabase.from("surveys").select("*").eq("id", form.id).single(),
      supabase.from("survey_questions").select("*").eq("survey_id", form.id).order("position"),
      supabase.from("survey_responses").select("*").eq("survey_id", form.id),
    ]);
    if (!survey || !questions) return;
    const analytics: SurveyAnalytics = {
      survey,
      questions: questions as SurveyQuestion[],
      responses: (responses ?? []) as SurveyResponse[],
      totalResponses: (responses ?? []).length,
      questionStats: [],
    };
    downloadCSV(buildSurveyResponsesCSV(analytics), `${slugify(form.title)}-${new Date().toISOString().slice(0, 10)}.csv`);
  };

  const copyLink = (id: string) => {
    navigator.clipboard.writeText(`${window.location.origin}/s/${id}`);
  };

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10 max-w-6xl">
      <PageHeader
        title="Form đăng ký"
        subtitle="Tạo và quản lý form đăng ký CME, QR check-in và face check-in."
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

      <div className="relative max-w-md mb-6">
        <Search size={16} className="admin-subtle absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Tìm form..."
          className="w-full bg-white/5 border border-white/10 rounded-xl pl-10 pr-9 py-2.5 text-sm text-white admin-placeholder focus:outline-none focus:border-emerald-500" />
        {search && (
          <button onClick={() => setSearch("")} className="admin-subtle absolute right-2 top-1/2 -translate-y-1/2 w-6 h-6 rounded flex items-center justify-center hover:text-white hover:bg-white/5">
            <X size={14} />
          </button>
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
                  onCopy={() => copyLink(form.id)}
                  onExport={() => handleExport(form)}
                  onDelete={() => handleDelete(form)}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}

function FormCard({ form, canManageForms, onCopy, onExport, onDelete }: {
  form: RegistrationFormSummary;
  canManageForms: boolean;
  onCopy: () => void;
  onExport: () => void;
  onDelete: () => void;
}) {
  const accent = form.accentColor ?? "#0ea5e9";
  return (
    <div className="glass rounded-2xl p-5">
      <Link href={`/admin/forms/${form.id}`} className="block">
        <div className="flex items-start gap-3 mb-4">
          <div className="w-11 h-11 rounded-xl flex items-center justify-center"
            style={{ background: `${accent}18`, border: `1px solid ${accent}35`, color: accent }}>
            <ClipboardList size={20} />
          </div>
          <div className="min-w-0 flex-1">
            <h3 className="font-semibold text-slate-900 truncate">{form.title}</h3>
            <p className="text-xs text-slate-600">{getFormTypeLabel(form.formType)} · {form.questionCount} câu hỏi</p>
          </div>
        </div>
      </Link>

      <div className="grid grid-cols-2 gap-2 mb-4">
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
          <div className="text-xl font-bold text-slate-900">{form.responseCount}</div>
          <div className="text-[10px] text-slate-600">{form.formType === "poster_scoring" ? "Lượt chấm" : "Đăng ký"}</div>
        </div>
        <div className="rounded-xl bg-slate-50 border border-slate-100 p-3">
          <div className="text-xl font-bold text-slate-900">{form.checkinCount}</div>
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
        {form.formType === "registration" && (
          <Link href={`/attendees/${form.id}`} target="_blank" title="Danh sách/QR" className="admin-subtle w-9 h-9 rounded-lg flex items-center justify-center hover:text-indigo-400 hover:bg-indigo-500/10">
            <QrCode size={15} />
          </Link>
        )}
        <Link href={`/admin/forms/${form.id}/report`} title="Report" className="admin-subtle w-9 h-9 rounded-lg flex items-center justify-center hover:text-emerald-400 hover:bg-emerald-500/10">
          <BarChart3 size={15} />
        </Link>
        <Link href={`/admin/forms/${form.id}/scoreboard`} title="Bảng điểm poster" className="admin-subtle w-9 h-9 rounded-lg flex items-center justify-center hover:text-amber-300 hover:bg-amber-400/10">
          <Trophy size={15} />
        </Link>
        <button onClick={onExport} title="Xuất CSV" className="admin-subtle w-9 h-9 rounded-lg flex items-center justify-center hover:text-cyan-400 hover:bg-cyan-500/10">
          <Download size={15} />
        </button>
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
