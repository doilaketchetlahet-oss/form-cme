"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  AlertTriangle, ArrowRight, BarChart3, CheckCircle2, ClipboardList, CreditCard,
  QrCode, ShieldCheck, Trophy, UserCheck, Users,
} from "lucide-react";
import { useAuth } from "@/hooks/useAuth";
import { useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { supabase } from "@/lib/supabase";
import { loadDashboardData, type DashboardData } from "@/lib/dashboard";
import { PageHeader } from "./PageHeader";

const EMPTY: DashboardData = { forms: [], responses: [], logs: [], pins: {} };

function isSameDay(a: Date, b: Date) {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diff / 60000);
  if (minutes < 1) return "vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  return `${Math.floor(hours / 24)} ngày trước`;
}

function actionLabel(action: string) {
  if (action === "undo_checkin") return "Hoàn tác check-in";
  if (action === "session_checkin") return "Check-in buổi";
  if (action === "session_uncheckin") return "Hoàn tác buổi";
  return "Check-in";
}

function methodLabel(method: string) {
  if (method === "qr") return "QR";
  if (method === "face") return "Face";
  if (method === "bulk") return "Hàng loạt";
  return "Thủ công";
}

export function FormsDashboard() {
  const { user } = useAuth();
  const { canManageForms } = useAdminAccess();
  const [data, setData] = useState<DashboardData>(EMPTY);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    const next = await loadDashboardData();
    setData(next);
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      await Promise.resolve();
      if (!active) return;
      if (!user?.id) {
        setData(EMPTY);
        setLoading(false);
        return;
      }
      await refresh();
    };
    void run();
    return () => { active = false; };
  }, [user?.id, refresh]);

  useEffect(() => {
    if (!user?.id) return;
    const channel = supabase
      .channel("dashboard-checkins")
      .on("postgres_changes", { event: "*", schema: "public", table: "checkin_logs" }, () => { void refresh(true); })
      .subscribe();
    const interval = window.setInterval(() => { void refresh(true); }, 20000);
    return () => {
      supabase.removeChannel(channel);
      window.clearInterval(interval);
    };
  }, [user?.id, refresh]);

  const metrics = useMemo(() => {
    const responses = data.responses;
    const totalResponses = responses.length;
    const totalCheckins = responses.filter((row) => row.checked_in).length;
    const today = new Date();
    const checkinToday = responses.filter((row) => row.checked_in_at && isSameDay(new Date(row.checked_in_at), today)).length;
    const rate = totalResponses > 0 ? Math.round((totalCheckins / totalResponses) * 100) : 0;
    const vipForms = data.forms.filter((form) => form.vipCheckinEnabled).length;
    const revenue = responses
      .filter((row) => row.payment_status === "paid")
      .reduce((sum, row) => sum + (Number(row.payment_amount) || 0), 0);
    const pendingPayments = responses.filter((row) => row.payment_status === "pending").length;
    const emailFailed = responses.filter((row) => row.email_status === "failed").length;

    const days = Array.from({ length: 7 }, (_, index) => {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - (6 - index));
      return day;
    });
    const chart = days.map((day) => ({
      label: `${day.getDate()}/${day.getMonth() + 1}`,
      value: responses.filter((row) => isSameDay(new Date(row.submitted_at), day)).length,
    }));
    const chartMax = Math.max(1, ...chart.map((point) => point.value));

    const missingPin = data.forms.filter((form) => form.formType === "registration" && !data.pins[form.id]);

    return {
      forms: data.forms.length,
      totalResponses,
      totalCheckins,
      checkinToday,
      rate,
      vipForms,
      revenue,
      pendingPayments,
      emailFailed,
      chart,
      chartMax,
      missingPin,
    };
  }, [data]);

  const formTitleById = useMemo(
    () => new Map(data.forms.map((form) => [form.id, form.title])),
    [data.forms],
  );

  const activeForm = useMemo(
    () => data.forms.find((form) => form.formType === "registration") ?? null,
    [data.forms],
  );

  const alerts = useMemo(() => {
    const list: { tone: "warning" | "danger" | "info"; text: string; href: string }[] = [];
    if (metrics.missingPin.length > 0) {
      list.push({
        tone: "warning",
        text: `${metrics.missingPin.length} form đăng ký chưa đặt PIN check-in.`,
        href: `/admin/forms/${metrics.missingPin[0].id}`,
      });
    }
    if (metrics.emailFailed > 0) {
      list.push({ tone: "danger", text: `${metrics.emailFailed} email gửi thất bại cần gửi lại.`, href: "/admin/forms" });
    }
    if (metrics.pendingPayments > 0) {
      list.push({ tone: "info", text: `${metrics.pendingPayments} đăng ký đang chờ thanh toán.`, href: "/admin/forms" });
    }
    return list;
  }, [metrics]);

  if (loading) {
    return (
      <div className="px-4 py-8 sm:px-8 sm:py-10 max-w-6xl">
        <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-8">
          {[0, 1, 2, 3, 4].map((item) => <div key={item} className="glass rounded-2xl h-28 animate-pulse" />)}
        </div>
        <div className="grid gap-4 lg:grid-cols-3">
          <div className="glass rounded-2xl h-72 lg:col-span-2 animate-pulse" />
          <div className="glass rounded-2xl h-72 animate-pulse" />
        </div>
      </div>
    );
  }

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10 max-w-6xl">
      <PageHeader
        title="Tổng quan"
        subtitle="Tình hình đăng ký, check-in và vận hành sự kiện của toàn bộ form."
        action={
          <Link
            href="/admin/forms"
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white/10"
          >
            Quản lý form <ArrowRight size={15} />
          </Link>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3 sm:gap-4 mb-6">
        <StatCard icon={Users} label="Tổng đăng ký" value={metrics.totalResponses.toLocaleString("vi-VN")} hint={`${metrics.forms} form`} color="#06b6d4" />
        <StatCard icon={UserCheck} label="Check-in hôm nay" value={metrics.checkinToday.toLocaleString("vi-VN")} hint={`Tổng ${metrics.totalCheckins.toLocaleString("vi-VN")}`} color="#6366f1" />
        <StatCard icon={BarChart3} label="Tỉ lệ check-in" value={`${metrics.rate}%`} hint={`${metrics.totalCheckins}/${metrics.totalResponses}`} color="#0ea5e9" />
        <StatCard icon={ShieldCheck} label="VIP / Face" value={metrics.vipForms.toLocaleString("vi-VN")} hint="form bật face check-in" color="#f59e0b" />
        <StatCard icon={CreditCard} label="Đã thu" value={`${metrics.revenue.toLocaleString("vi-VN")}đ`} hint={metrics.pendingPayments > 0 ? `${metrics.pendingPayments} chờ thanh toán` : "PayOS"} color="#10b981" />
      </div>

      <div className="grid gap-4 lg:grid-cols-3 mb-4">
        <section className="glass rounded-2xl p-5 lg:col-span-2">
          <div className="mb-4 flex items-center gap-2">
            <BarChart3 size={16} className="text-sky-500" />
            <h2 className="text-base font-semibold text-slate-900">Đăng ký 7 ngày gần nhất</h2>
          </div>
          <div className="flex h-44 items-end gap-2">
            {metrics.chart.map((point) => (
              <div key={point.label} className="flex flex-1 flex-col items-center gap-2">
                <div className="text-xs font-semibold tabular-nums text-slate-500">{point.value}</div>
                <div className="flex w-full flex-1 items-end">
                  <div
                    className="w-full rounded-t-lg bg-gradient-to-t from-sky-500 to-cyan-400"
                    style={{ height: `${Math.max(4, (point.value / metrics.chartMax) * 100)}%` }}
                  />
                </div>
                <div className="text-[10px] text-slate-400">{point.label}</div>
              </div>
            ))}
          </div>
        </section>

        <section className="glass rounded-2xl p-5">
          <div className="mb-3 flex items-center gap-2">
            <QrCode size={16} className="text-indigo-500" />
            <h2 className="text-base font-semibold text-slate-900">Vận hành tại quầy</h2>
          </div>
          {activeForm ? (
            <>
              <div className="mb-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="truncate text-sm font-semibold text-slate-800">{activeForm.title}</div>
                <div className="text-xs text-slate-500">{activeForm.checkinCount}/{activeForm.responseCount} đã check-in</div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Shortcut href={`/scan/${activeForm.id}`} icon={QrCode} label="Quét QR" />
                <Shortcut href={`/attendees/${activeForm.id}`} icon={Users} label="Danh sách" />
                {activeForm.vipCheckinEnabled && (
                  <Shortcut href={`/face-checkin/${activeForm.id}`} icon={ShieldCheck} label="Face VIP" />
                )}
                <Shortcut href={`/admin/forms/${activeForm.id}`} icon={ClipboardList} label="Sửa form" />
              </div>
            </>
          ) : (
            <div className="rounded-xl border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-500">
              Chưa có form đăng ký nào.
              {canManageForms && (
                <Link href="/admin/forms" className="mt-2 block text-sky-600 hover:text-sky-500">Tạo form mới</Link>
              )}
            </div>
          )}
        </section>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <section className="glass rounded-2xl p-5 lg:col-span-2">
          <div className="mb-3 flex items-center gap-2">
            <UserCheck size={16} className="text-emerald-500" />
            <h2 className="text-base font-semibold text-slate-900">Hoạt động gần đây</h2>
          </div>
          {data.logs.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">Chưa có hoạt động check-in nào.</p>
          ) : (
            <ul className="divide-y divide-white/10">
              {data.logs.map((log) => (
                <li key={log.id} className="flex items-center gap-3 py-2.5">
                  <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
                    <UserCheck size={15} />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-slate-800">
                      {actionLabel(log.action)} · {methodLabel(log.method)}
                    </div>
                    <div className="truncate text-xs text-slate-500">
                      {formTitleById.get(log.survey_id) ?? "Form"}
                      {log.hall ? ` · ${log.hall}` : ""}
                    </div>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">{timeAgo(log.created_at)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="glass rounded-2xl p-5">
          <div className="mb-3 flex items-center gap-2">
            <AlertTriangle size={16} className="text-amber-500" />
            <h2 className="text-base font-semibold text-slate-900">Cần chú ý</h2>
          </div>
          {alerts.length === 0 ? (
            <div className="flex items-center gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-3 py-4 text-sm text-emerald-700">
              <CheckCircle2 size={16} /> Mọi thứ đang ổn.
            </div>
          ) : (
            <ul className="space-y-2">
              {alerts.map((alert) => (
                <li key={alert.text}>
                  <Link
                    href={alert.href}
                    className={`flex items-center gap-2 rounded-xl border px-3 py-2.5 text-sm ${
                      alert.tone === "danger"
                        ? "border-red-200 bg-red-50 text-red-700 hover:bg-red-100"
                        : alert.tone === "warning"
                          ? "border-amber-200 bg-amber-50 text-amber-700 hover:bg-amber-100"
                          : "border-sky-200 bg-sky-50 text-sky-700 hover:bg-sky-100"
                    }`}
                  >
                    <AlertTriangle size={15} className="shrink-0" />
                    <span className="flex-1">{alert.text}</span>
                    <ArrowRight size={14} className="shrink-0" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
          <div className="mt-3 flex items-center gap-2 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2 text-xs text-slate-500">
            <Trophy size={13} className="text-amber-500" />
            {metrics.vipForms} form bật face check-in VIP
          </div>
        </section>
      </div>
    </div>
  );
}

function Shortcut({ href, icon: Icon, label }: { href: string; icon: React.ComponentType<{ size?: number; className?: string }>; label: string }) {
  return (
    <Link href={href} className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm font-semibold text-slate-700 hover:border-sky-300 hover:text-sky-700">
      <Icon size={15} className="text-sky-500" />
      {label}
    </Link>
  );
}

function StatCard({ icon: Icon, label, value, hint, color }: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string;
  hint?: string;
  color: string;
}) {
  return (
    <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-4">
      <div className="mb-2 flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg" style={{ background: `${color}18`, border: `1px solid ${color}35`, color }}>
          <Icon size={15} />
        </div>
        <span className="text-[11px] uppercase tracking-widest text-slate-500">{label}</span>
      </div>
      <div className="text-2xl font-bold tabular-nums text-slate-900">{value}</div>
      {hint && <div className="mt-0.5 text-[11px] text-slate-400">{hint}</div>}
    </motion.div>
  );
}
