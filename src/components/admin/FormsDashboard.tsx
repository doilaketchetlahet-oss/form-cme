"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { BarChart3, ClipboardList, Plus, QrCode, Users, UserCheck, ShieldCheck, ArrowRight, Trophy } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { createRegistrationForm, listRegistrationForms, type RegistrationFormSummary } from "@/lib/forms";
import type { SurveyFormType } from "@/lib/surveys";
import { PageHeader } from "./PageHeader";

export function FormsDashboard() {
  const { user } = useAuth();
  const { canManageForms } = useAdminAccess();
  const [forms, setForms] = useState<RegistrationFormSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState<SurveyFormType | null>(null);

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

  const stats = useMemo(() => ({
    forms: forms.length,
    responses: forms.reduce((sum, item) => sum + item.responseCount, 0),
    checkins: forms.reduce((sum, item) => sum + item.checkinCount, 0),
    vip: forms.filter((item) => item.vipCheckinEnabled).length,
  }), [forms]);

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

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10 max-w-6xl">
      <PageHeader
        title="Dashboard đăng ký CME"
        subtitle="Quản lý form đăng ký, QR check-in, face check-in và danh sách khách tham dự."
        action={
          canManageForms ? (
            <div className="flex flex-wrap gap-2">
              <motion.button
                onClick={() => handleCreate("registration")}
                disabled={!!creating}
                className="admin-primary flex items-center gap-2 px-4 py-2.5 rounded-xl font-semibold disabled:opacity-50"
                whileTap={{ scale: 0.98 }}
              >
                <Plus size={18} /> {creating === "registration" ? "Đang tạo..." : "Tạo đăng ký"}
              </motion.button>
              <motion.button
                onClick={() => handleCreate("poster_scoring")}
                disabled={!!creating}
                className="flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 font-semibold text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50"
                whileTap={{ scale: 0.98 }}
              >
                <Trophy size={18} /> {creating === "poster_scoring" ? "Đang tạo..." : "Tạo chấm điểm"}
              </motion.button>
            </div>
          ) : null
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-8">
        <StatCard icon={ClipboardList} label="Form" value={stats.forms} loading={loading} color="#0ea5e9" />
        <StatCard icon={Users} label="Đăng ký" value={stats.responses} loading={loading} color="#06b6d4" />
        <StatCard icon={UserCheck} label="Check-in" value={stats.checkins} loading={loading} color="#6366f1" />
        <StatCard icon={ShieldCheck} label="Face VIP" value={stats.vip} loading={loading} color="#f59e0b" />
      </div>

      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-slate-900">Form gần đây</h2>
        <Link href="/admin/forms" className="text-sm text-sky-600 hover:text-sky-500 transition-colors flex items-center gap-1">
          Xem tất cả <ArrowRight size={14} />
        </Link>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[0, 1, 2].map((i) => <div key={i} className="glass rounded-2xl h-36 animate-pulse" />)}
        </div>
      ) : forms.length === 0 ? (
        <div className="glass rounded-2xl p-10 text-center max-w-xl">
          <ClipboardList size={38} className="mx-auto mb-3 text-sky-400" />
          <h3 className="text-base font-semibold text-slate-900 mb-1">Chưa có form nào</h3>
          <p className="text-sm text-slate-600 mb-4">Tạo form đầu tiên để nhận đăng ký và check-in bằng QR.</p>
          {canManageForms ? (
            <button onClick={() => handleCreate("registration")} disabled={!!creating}
              className="admin-primary inline-flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-semibold disabled:opacity-50">
              <Plus size={16} /> Tạo form đầu tiên
            </button>
          ) : (
            <p className="text-xs text-slate-600">Tài khoản của bạn chỉ có quyền xem.</p>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {forms.slice(0, 6).map((form, index) => (
            <FormCard key={form.id} form={form} delay={index * 0.04} />
          ))}
        </div>
      )}
    </div>
  );
}

function FormCard({ form, delay }: { form: RegistrationFormSummary; delay: number }) {
  const accent = form.accentColor ?? "#0ea5e9";
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay }}>
      <div className="glass rounded-2xl p-5 hover:bg-sky-50/70 transition-colors">
        <Link href={`/admin/forms/${form.id}`} className="block">
          <div className="flex items-start gap-3 mb-4">
            <div className="w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0"
              style={{ background: `${accent}18`, border: `1px solid ${accent}35`, color: accent }}>
              <ClipboardList size={20} />
            </div>
            <div className="min-w-0 flex-1">
              <h3 className="font-semibold text-slate-900 truncate">{form.title}</h3>
              <p className="text-xs text-slate-600 mt-0.5">{getFormTypeLabel(form.formType)} · {form.questionCount} câu hỏi</p>
            </div>
          </div>
        </Link>
        <div className="grid grid-cols-3 gap-2 text-center mb-4">
          <MiniStat label={form.formType === "poster_scoring" ? "Lượt chấm" : "Đăng ký"} value={form.responseCount} />
          <MiniStat label="Check-in" value={form.formType === "registration" ? form.checkinCount : 0} />
          <MiniStat label="VIP" value={form.vipCheckinEnabled ? 1 : 0} />
        </div>
        <div className="flex items-center justify-between gap-2 text-xs text-slate-600">
          <span className="flex items-center gap-2">
            {form.formType === "poster_scoring" ? <><Trophy size={13} /> Form chấm điểm</> : <><QrCode size={13} /> QR check-in sẵn sàng</>}
          </span>
          <div className="flex items-center gap-2">
            <Link href={`/admin/forms/${form.id}/scoreboard`} className="inline-flex items-center gap-1 text-amber-600 hover:text-amber-500">
              <Trophy size={13} /> Điểm
            </Link>
            <Link href={`/admin/forms/${form.id}/report`} className="inline-flex items-center gap-1 text-sky-600 hover:text-sky-500">
              <BarChart3 size={13} /> Report
            </Link>
          </div>
        </div>
      </div>
    </motion.div>
  );
}

function getFormTypeLabel(type: SurveyFormType) {
  if (type === "poster_scoring") return "Chấm điểm poster";
  if (type === "feedback") return "Khảo sát";
  return "Đăng ký/check-in";
}

function MiniStat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-xl bg-slate-50 border border-slate-100 px-2 py-2">
      <div className="text-lg font-bold text-slate-900 tabular-nums">{value}</div>
      <div className="text-[10px] text-slate-600">{label}</div>
    </div>
  );
}

function StatCard({ icon: Icon, label, value, loading, color }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: number;
  loading: boolean;
  color: string;
}) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <div className="flex items-center gap-3 mb-3">
        <div className="w-9 h-9 rounded-xl flex items-center justify-center"
          style={{ background: `${color}18`, border: `1px solid ${color}35`, color }}>
          <Icon size={16} />
        </div>
        <span className="text-xs text-slate-600 uppercase tracking-widest">{label}</span>
      </div>
      <div className="text-3xl font-bold text-slate-900 tabular-nums">
        {loading ? <span className="text-slate-400">-</span> : value.toLocaleString("vi-VN")}
      </div>
    </div>
  );
}
