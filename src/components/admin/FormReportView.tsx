"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  ArrowLeft,
  BarChart3,
  CalendarClock,
  CheckCircle2,
  CreditCard,
  Download,
  ExternalLink,
  FileText,
  LoaderCircle,
  QrCode,
  Search,
  Trophy,
  Users,
  X,
} from "lucide-react";
import {
  getSurveyAnalytics,
  type QuestionStat,
  type SurveyAnalytics,
  type SurveyQuestion,
  type SurveyResponse,
} from "@/lib/surveys";
import { downloadCSV, slugify } from "@/lib/csv";
import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { cn } from "@/lib/utils";
import { buildReportCSV, buildReportExport, filterReportResponses, type ReportExportScope } from "@/lib/report-export";

type CheckinFilter = "all" | "checked" | "pending";

export function FormReportView({ formId }: { formId: string }) {
  const [analytics, setAnalytics] = useState<SurveyAnalytics | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [checkinFilter, setCheckinFilter] = useState<CheckinFilter>("all");
  const [hallFilter, setHallFilter] = useState("");
  const [selectedResponse, setSelectedResponse] = useState<SurveyResponse | null>(null);
  const [exportScope, setExportScope] = useState<ReportExportScope>("checked");
  const [exporting, setExporting] = useState<"xlsx" | "csv" | null>(null);
  const exportBusyRef = useRef(false);
  const activeFormRef = useRef<string | null>(formId);
  const showPayments = analytics?.survey.payment_config?.enabled === true;
  const showHall = !!analytics?.questions.some((question) => question.is_hall_selector);

  useEffect(() => {
    let active = true;
    activeFormRef.current = formId;

    const load = async () => {
      setLoading(true);
      const data = await getSurveyAnalytics(formId).catch(() => null);
      if (!active) return;
      setAnalytics(data);
      setLoading(false);
    };

    load();
    return () => { active = false; activeFormRef.current = null; };
  }, [formId]);

  const questions = useMemo(() => {
    return (analytics?.questions ?? []).filter((question) => question.type !== "section" && question.type !== "image_banner");
  }, [analytics?.questions]);

  const halls = useMemo(() => {
    const set = new Set<string>();
    analytics?.responses.forEach((response) => {
      if (response.hall) set.add(response.hall);
    });
    return [...set].sort((a, b) => a.localeCompare(b, "vi"));
  }, [analytics?.responses]);

  const filteredResponses = useMemo(() => {
    return analytics ? filterReportResponses(analytics, { search, checkin: checkinFilter, hall: hallFilter }) : [];
  }, [analytics, checkinFilter, hallFilter, search]);
  const exportCount = exportScope === "checked" ? filteredResponses.filter((response) => response.checked_in).length : filteredResponses.length;

  const stats = useMemo(() => {
    const responses = analytics?.responses ?? [];
    const checked = responses.filter((response) => response.checked_in).length;
    const paid = responses.filter((response) => response.payment_status === "paid").length;
    const lastSubmitted = responses
      .map((response) => response.submitted_at)
      .sort()
      .at(-1);

    return {
      total: responses.length,
      checked,
      paid,
      pending: responses.length - checked,
      rate: responses.length > 0 ? Math.round((checked / responses.length) * 100) : 0,
      lastSubmitted,
    };
  }, [analytics?.responses]);

  const handleExport = async (format: "xlsx" | "csv") => {
    if (!analytics || exportBusyRef.current) return;
    exportBusyRef.current = true;
    setExporting(format);
    try {
      // Check-ins may have changed since this report was opened. Reread every
      // page and current form settings before deciding which rows/columns to send.
      const fresh = await getSurveyAnalytics(formId);
      if (activeFormRef.current !== formId) return;
      if (!fresh) throw new Error("Không tải được đầy đủ dữ liệu mới nhất. Vui lòng thử lại; chưa có file nào được xuất.");
      setAnalytics(fresh);
      const rows = filterReportResponses(fresh, { search, checkin: checkinFilter, hall: hallFilter }, exportScope);
      if (!rows.length) {
        toast.info(exportScope === "checked" ? "Không có người đã check-in trong bộ lọc hiện tại." : "Không có người đăng ký trong bộ lọc hiện tại.");
        return;
      }
      const table = buildReportExport(fresh, rows);
      const date = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Ho_Chi_Minh" }).format(new Date());
      const filename = `${slugify(fresh.survey.title) || "bao-cao"}-${exportScope === "checked" ? "da-check-in" : "theo-bo-loc"}-${date}`;
      if (format === "csv") downloadCSV(buildReportCSV(table), `${filename}.csv`);
      else {
        const { createReportXlsx } = await import("@/lib/report-xlsx");
        const buffer = await createReportXlsx(table, fresh.survey.title);
        if (activeFormRef.current !== formId) return;
        const url = URL.createObjectURL(new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
        const link = document.createElement("a");
        link.href = url;
        link.download = `${filename}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      toast.success(`Đã xuất ${rows.length.toLocaleString("vi-VN")} người đăng ký.`);
    } catch (error) {
      if (activeFormRef.current === formId) toast.error(error instanceof Error ? error.message : "Chưa xuất được báo cáo. Vui lòng thử lại.");
    } finally {
      exportBusyRef.current = false;
      if (activeFormRef.current === formId) setExporting(null);
    }
  };

  const trend = useMemo(() => {
    const days = Array.from({ length: 14 }, (_, index) => {
      const day = new Date();
      day.setHours(0, 0, 0, 0);
      day.setDate(day.getDate() - (13 - index));
      return day;
    });
    const responses = analytics?.responses ?? [];
    const counts = days.map((day) => responses.filter((response) => {
      const submitted = new Date(response.submitted_at);
      return submitted.getFullYear() === day.getFullYear()
        && submitted.getMonth() === day.getMonth()
        && submitted.getDate() === day.getDate();
    }).length);
    return { days, counts, max: Math.max(1, ...counts) };
  }, [analytics?.responses]);

  if (loading) {
    return (
      <div className="px-4 py-8 sm:px-8 sm:py-10 max-w-7xl">
        <div className="glass rounded-2xl h-40 animate-pulse mb-5" />
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="glass rounded-2xl h-96 animate-pulse" />
          <div className="glass rounded-2xl h-96 animate-pulse" />
        </div>
      </div>
    );
  }

  if (!analytics) {
    return (
      <div className="px-4 py-8 sm:px-8 sm:py-10 max-w-4xl">
        <Link href="/admin/forms" className="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-2 mb-6">
          <ArrowLeft size={15} /> Tất cả form
        </Link>
        <div className="glass rounded-2xl p-8 text-sm text-slate-500">Không tải được đầy đủ dữ liệu báo cáo. Vui lòng tải lại trang để thử lại.</div>
      </div>
    );
  }

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10 max-w-7xl">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between mb-8">
        <div>
          <Link href="/admin/forms" className="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-2 mb-3">
            <ArrowLeft size={15} /> Tất cả form
          </Link>
          <div className="flex items-center gap-3 mb-2">
            <div className="h-11 w-11 rounded-xl border border-sky-200 bg-sky-50 flex items-center justify-center text-sky-700">
              <BarChart3 size={21} />
            </div>
            <div>
              <h1 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight">Report</h1>
              <p className="text-sm text-slate-500">{analytics.survey.title}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/forms/${analytics.survey.id}`} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <FileText size={16} /> Form
          </Link>
          <Link href={`/attendees/${analytics.survey.id}`} target="_blank" className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2.5 text-sm font-semibold text-indigo-700 hover:bg-indigo-100">
            <QrCode size={16} /> Check-in
          </Link>
          {analytics.survey.form_type === "poster_scoring" && (
            <Link href={`/admin/forms/${analytics.survey.id}/scoreboard`} className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2.5 text-sm font-semibold text-amber-700 hover:bg-amber-100">
              <Trophy size={16} /> Bảng điểm
            </Link>
          )}
          <Link href={`/s/${analytics.survey.id}`} target="_blank" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            <ExternalLink size={16} /> Public
          </Link>
        </div>
      </div>

      <div className={cn("grid gap-3 sm:grid-cols-2 mb-6", showPayments ? "xl:grid-cols-5" : "xl:grid-cols-4")}>
        <StatCard icon={Users} label="Phản hồi" value={stats.total} color="#0ea5e9" />
        {showPayments && <StatCard icon={CreditCard} label="Đã thanh toán" value={stats.paid} color="#0891b2" />}
        <StatCard icon={CheckCircle2} label="Đã check-in" value={stats.checked} color="#06b6d4" />
        <StatCard icon={BarChart3} label="Tỷ lệ check-in" value={`${stats.rate}%`} color="#6366f1" />
        <StatCard icon={CalendarClock} label="Mới nhất" value={stats.lastSubmitted ? formatDateTime(stats.lastSubmitted, true) : "-"} color="#f59e0b" compact />
      </div>

      <section className="glass relative mb-6 overflow-hidden rounded-2xl p-4 sm:p-5">
        <div className="absolute inset-x-0 top-0 h-1" style={{ background: "linear-gradient(90deg, #0ea5e9, #06b6d400)" }} />
        <div className="mb-4 flex items-center gap-2">
          <BarChart3 size={16} className="text-sky-500" />
          <h2 className="text-base font-semibold text-slate-900">Đăng ký 14 ngày gần nhất</h2>
        </div>
        <div className="h-40 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart
              data={trend.days.map((day, index) => ({ label: `${day.getDate()}/${day.getMonth() + 1}`, value: trend.counts[index] }))}
              margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
            >
              <defs>
                <linearGradient id="reportReg" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22d3ee" stopOpacity={0.45} />
                  <stop offset="100%" stopColor="#0ea5e9" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#64748b" }} axisLine={false} tickLine={false} interval={1} />
              <YAxis allowDecimals={false} width={28} tick={{ fontSize: 11, fill: "#64748b" }} axisLine={false} tickLine={false} />
              <Tooltip formatter={(value) => [`${value} đăng ký`, ""]} labelFormatter={(label) => `Ngày ${label}`} />
              <Area type="monotone" dataKey="value" stroke="#0ea5e9" strokeWidth={2} fill="url(#reportReg)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </section>

      <section className="glass rounded-2xl p-4 sm:p-5 mb-6">
        <div className={cn("grid gap-3 lg:items-center", showHall ? "lg:grid-cols-[minmax(0,1fr)_160px_180px_auto]" : "lg:grid-cols-[minmax(0,1fr)_160px_auto]")}>
          <div className="relative">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
            <input
              value={search}
              disabled={!!exporting}
              aria-label="Tìm người đăng ký"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Tìm theo tên, email, số điện thoại, hội trường..."
              className="admin-field w-full rounded-xl pl-10 pr-4 py-2.5 text-sm admin-placeholder focus:outline-none transition-colors"
            />
          </div>

          <select
            value={checkinFilter}
            disabled={!!exporting}
            aria-label="Trạng thái check-in"
            onChange={(event) => setCheckinFilter(event.target.value as CheckinFilter)}
            className="admin-dark-select admin-field rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-colors"
          >
            <option value="all">Tất cả check-in</option>
            <option value="checked">Đã check-in</option>
            <option value="pending">Chưa check-in</option>
          </select>

          {showHall && <select
            value={hallFilter}
            disabled={!!exporting}
            aria-label="Hội trường được phân"
            onChange={(event) => setHallFilter(event.target.value)}
            className="admin-dark-select admin-field rounded-xl px-3 py-2.5 text-sm focus:outline-none transition-colors"
          >
            <option value="">Tất cả hội trường</option>
            {halls.map((hall) => <option key={hall} value={hall}>{hall}</option>)}
          </select>}

          <div className="text-sm text-slate-500 lg:text-right">
            {filteredResponses.length.toLocaleString("vi-VN")} / {stats.total.toLocaleString("vi-VN")} phản hồi
          </div>
        </div>
      </section>

      <section aria-label="Xuất danh sách đăng ký" className="mb-6 rounded-2xl border border-sky-200 bg-sky-50 p-4 sm:p-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="min-w-0 flex-1">
            <h2 className="mb-1 text-base font-semibold text-slate-900">Xuất danh sách</h2>
            <p className="text-sm text-slate-600">Chỉ gồm các trường của form và thông tin check-in. Excel được căn cột, xuống dòng và cố định tiêu đề.</p>
            <label className="mt-3 block text-sm font-medium text-slate-700">Danh sách cần xuất
              <select value={exportScope} disabled={!!exporting} onChange={(event) => setExportScope(event.target.value as ReportExportScope)} aria-label="Danh sách cần xuất"
                className="admin-field mt-1 min-h-11 w-full rounded-xl px-3 py-2 text-base sm:max-w-sm sm:text-sm">
                <option value="checked">Người đã check-in</option>
                <option value="filtered">Toàn bộ danh sách đang lọc</option>
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void handleExport("xlsx")} disabled={!!exporting}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-sky-700 px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-sky-800 disabled:opacity-60">
              {exporting === "xlsx" ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
              {exporting === "xlsx" ? "Đang xuất Excel…" : "Xuất Excel"}
            </button>
            <button type="button" onClick={() => void handleExport("csv")} disabled={!!exporting}
              className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-sky-300 bg-white px-4 py-2.5 text-sm font-semibold text-sky-800 hover:bg-sky-100 disabled:opacity-60">
              {exporting === "csv" ? <LoaderCircle size={16} className="animate-spin" /> : <Download size={16} />}
              {exporting === "csv" ? "Đang xuất CSV…" : "Xuất CSV"}
            </button>
          </div>
        </div>
        <p role="status" className="mt-3 text-sm font-medium text-slate-700">{exportCount.toLocaleString("vi-VN")} người {exportScope === "checked" ? "đã check-in trong bộ lọc hiện tại" : "trong bộ lọc hiện tại"}. File sẽ lấy dữ liệu mới nhất trước khi xuất.</p>
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
        <ResponsesTable
          responses={filteredResponses}
          questions={questions}
          showHall={showHall}
          showPayments={showPayments}
          onSelect={setSelectedResponse}
        />
        <QuestionBreakdown stats={analytics.questionStats} totalResponses={analytics.totalResponses} />
      </div>

      <ResponseModal
        response={selectedResponse}
        questions={questions}
        showHall={showHall}
        showPayments={showPayments}
        onClose={() => setSelectedResponse(null)}
      />
    </div>
  );
}

function ResponsesTable({
  responses,
  questions,
  onSelect,
  showHall,
  showPayments,
}: {
  responses: SurveyResponse[];
  questions: SurveyQuestion[];
  onSelect: (response: SurveyResponse) => void;
  showHall: boolean;
  showPayments: boolean;
}) {
  const columns = showHall ? showPayments ? "md:grid-cols-[170px_minmax(0,1fr)_130px_120px_110px]" : "md:grid-cols-[170px_minmax(0,1fr)_130px_110px]"
    : showPayments ? "md:grid-cols-[170px_minmax(0,1fr)_120px_110px]" : "md:grid-cols-[170px_minmax(0,1fr)_110px]";
  return (
    <section className="glass rounded-2xl overflow-hidden">
      <div className="border-b border-white/10 px-4 py-4 sm:px-5">
        <h2 className="text-base font-semibold text-slate-900">Phản hồi</h2>
        <p className="text-xs text-slate-500 mt-1">Bảng read-only để rà soát dữ liệu đã gửi.</p>
      </div>

      <div className={cn("hidden md:grid gap-3 border-b border-[color:var(--border)] px-5 py-3 text-[11px] uppercase tracking-widest text-slate-500", columns)}>
        <span>Thời gian</span>
        <span>Người đăng ký</span>
        {showHall && <span>Hội trường</span>}
        {showPayments && <span>Thanh toán</span>}
        <span>Check-in</span>
      </div>

      {responses.length === 0 ? (
        <div className="p-10 text-center">
          <FileText size={36} className="mx-auto mb-3 text-slate-600" />
          <h3 className="text-sm font-semibold text-slate-900 mb-1">Không có phản hồi phù hợp</h3>
          <p className="text-sm text-slate-500">Thử đổi từ khóa hoặc bộ lọc.</p>
        </div>
      ) : (
        <div className="divide-y divide-[color:var(--border)]">
          {responses.map((response, index) => (
            <motion.button
              key={response.id}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(index, 8) * 0.02 }}
              onClick={() => onSelect(response)}
              className={cn("w-full text-left grid gap-3 p-4 md:items-center md:px-5 hover:bg-white/[0.035] transition-colors", columns)}
            >
              <div className="text-sm text-slate-400">
                <span className="mr-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400 md:hidden">Thời gian:</span>
                {formatDateTime(response.submitted_at)}
              </div>
              <div className="min-w-0">
                <span className="mb-0.5 block text-[11px] font-semibold uppercase tracking-widest text-slate-400 md:hidden">Người đăng ký:</span>
                <div className="truncate text-sm font-semibold text-slate-900">{getDisplayName(response, questions)}</div>
                <div className="truncate text-xs text-slate-500">{getEmail(response) || getPreviewAnswer(response, questions) || response.id}</div>
              </div>
              {showHall && <div className="text-sm text-slate-500 truncate">
                <span className="mr-1 text-[11px] font-semibold uppercase tracking-widest text-slate-400 md:hidden">Hội trường:</span>
                {response.hall || "-"}
              </div>}
              {showPayments && <div className="flex items-center gap-2 md:block">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 md:hidden">Thanh toán:</span>
                <PaymentBadge response={response} />
              </div>}
              <div className="flex items-center gap-2 md:block">
                <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400 md:hidden">Check-in:</span>
                <CheckinBadge checked={!!response.checked_in} />
              </div>
            </motion.button>
          ))}
        </div>
      )}
    </section>
  );
}

function QuestionBreakdown({ stats, totalResponses }: { stats: QuestionStat[]; totalResponses: number }) {
  const visibleStats = stats.filter((stat) => stat.question.type !== "section" && stat.question.type !== "image_banner");

  return (
    <aside className="space-y-4">
      <section className="glass rounded-2xl p-5">
        <h2 className="text-base font-semibold text-slate-900 mb-1">Tổng quan câu hỏi</h2>
        <p className="text-xs text-slate-500">Tóm tắt nhanh theo từng loại câu hỏi.</p>
      </section>

      {visibleStats.length === 0 ? (
        <section className="glass rounded-2xl p-6 text-sm text-slate-500">Chưa có câu hỏi để thống kê.</section>
      ) : (
        visibleStats.map((stat) => (
          <QuestionCard key={stat.question.id} stat={stat} totalResponses={totalResponses} />
        ))
      )}
    </aside>
  );
}

function QuestionCard({ stat, totalResponses }: { stat: QuestionStat; totalResponses: number }) {
  const question = stat.question;

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-4">
        <div className="text-[11px] uppercase tracking-widest text-slate-600 mb-1">{getQuestionTypeLabel(question.type)}</div>
        <h3 className="text-sm font-semibold text-slate-900 leading-5">{question.text}</h3>
      </div>

      {question.type === "choice" && stat.choiceCounts ? (
        <div className="space-y-3">
          {(question.options ?? []).map((option, index) => {
            const count = stat.choiceCounts?.[index] ?? 0;
            const pct = totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0;
            return <BarRow key={option} label={option} count={count} pct={pct} />;
          })}
        </div>
      ) : (question.type === "rating" || question.type === "nps") && stat.distribution ? (
        <div className="space-y-3">
          <div className="text-2xl font-bold text-slate-900">{formatNumber(stat.avg ?? 0)} <span className="text-xs font-medium text-slate-500">điểm trung bình</span></div>
          {stat.distribution.map((count, index) => {
            const label = question.type === "rating" ? `${index + 1} sao` : `${index}`;
            const pct = totalResponses > 0 ? Math.round((count / totalResponses) * 100) : 0;
            return <BarRow key={label} label={label} count={count} pct={pct} />;
          })}
        </div>
      ) : (
        <div className="space-y-2">
          {(stat.textAnswers ?? []).slice(0, 6).map((answer, index) => (
            <div key={`${answer}-${index}`} className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-sm text-slate-300">
              {answer}
            </div>
          ))}
          {(stat.textAnswers?.length ?? 0) === 0 && <p className="text-sm text-slate-500">Chưa có dữ liệu.</p>}
          {(stat.textAnswers?.length ?? 0) > 6 && <p className="text-xs text-slate-600">Còn {(stat.textAnswers?.length ?? 0) - 6} câu trả lời khác trong bảng phản hồi.</p>}
        </div>
      )}
    </section>
  );
}

function ResponseModal({
  response,
  questions,
  onClose,
  showHall,
  showPayments,
}: {
  response: SurveyResponse | null;
  questions: SurveyQuestion[];
  onClose: () => void;
  showHall: boolean;
  showPayments: boolean;
}) {
  return (
    <AnimatePresence>
      {response && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            onClick={(event) => event.stopPropagation()}
            className="glass-strong rounded-2xl w-full max-w-2xl max-h-[86vh] overflow-hidden"
          >
            <div className="flex items-start justify-between gap-4 border-b border-white/10 p-5">
              <div className="min-w-0">
                <h2 className="text-lg font-semibold text-slate-900 truncate">{getDisplayName(response, questions)}</h2>
                <p className="text-xs text-slate-500 mt-1">{formatDateTime(response.submitted_at)} · {response.email || "Không có email"}</p>
              </div>
              <button onClick={onClose} className="h-9 w-9 rounded-xl flex items-center justify-center text-slate-500 hover:text-white hover:bg-white/5">
                <X size={17} />
              </button>
            </div>

            <div className="p-5 overflow-y-auto max-h-[calc(86vh-88px)]">
              <div className="grid gap-3 sm:grid-cols-3 mb-5">
                <InfoTile label="Check-in" value={response.checked_in ? "Đã check-in" : "Chưa check-in"} />
                {showHall && <InfoTile label="Hội trường" value={response.hall || "-"} />}
                {showPayments && <InfoTile label="Thanh toán" value={formatPaymentStatus(response)} />}
                <InfoTile label="Email" value={getEmail(response) || "-"} />
              </div>

              {showPayments && response.payment_status && response.payment_status !== "not_required" && (
                <div className="mb-5 rounded-xl border border-cyan-200 bg-cyan-50 p-4">
                  <div className="mb-2 text-xs font-semibold text-cyan-700">Đối chiếu thanh toán</div>
                  <div className="grid gap-2 text-xs text-slate-300 sm:grid-cols-2">
                    <PaymentInfoLine label="Tên đăng ký" value={getDisplayName(response, questions)} />
                    <PaymentInfoLine label="Tên tài khoản chuyển" value={response.payment_payer_name || "Chưa có từ PayOS"} />
                    <PaymentInfoLine label="Ngân hàng" value={response.payment_payer_bank || "-"} />
                    <PaymentInfoLine label="Số TK chuyển" value={response.payment_payer_account || "-"} />
                    <PaymentInfoLine label="Mã tham chiếu" value={response.payment_reference || "-"} />
                    <PaymentInfoLine label="Mã đơn PayOS" value={response.payment_order_code ? String(response.payment_order_code) : "-"} />
                    <PaymentInfoLine label="Thời gian giao dịch" value={response.payment_transaction_datetime || "-"} />
                  </div>
                </div>
              )}

              <div className="space-y-3">
                {questions.map((question) => (
                  <div key={question.id} className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="text-xs text-slate-500 mb-1">{question.text}</div>
                    <div className="text-sm font-medium text-slate-900 break-words">{formatAnswer(response.answers[question.id], question)}</div>
                  </div>
                ))}
              </div>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
  compact,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string | number;
  color: string;
  compact?: boolean;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-3">
        <div className="h-10 w-10 rounded-xl flex items-center justify-center" style={{ background: `${color}18`, border: `1px solid ${color}35`, color }}>
          <Icon size={17} />
        </div>
        <div className="min-w-0">
          <div className={cn("font-bold text-slate-900 tabular-nums truncate", compact ? "text-lg" : "text-2xl")}>
            {typeof value === "number" ? value.toLocaleString("vi-VN") : value}
          </div>
          <div className="text-xs text-slate-500">{label}</div>
        </div>
      </div>
    </div>
  );
}

function BarRow({ label, count, pct }: { label: string; count: number; pct: number }) {
  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-1">
        <span className="text-xs text-slate-400 truncate">{label}</span>
        <span className="text-xs text-slate-500">{count} · {pct}%</span>
      </div>
      <div className="h-2 rounded-full bg-white/5 overflow-hidden">
        <div className="h-full rounded-full bg-sky-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function CheckinBadge({ checked }: { checked: boolean }) {
  const toneClass = checked
    ? "border-sky-200 bg-sky-100 text-sky-700"
    : "border-slate-200 bg-slate-100 text-slate-600";

  return (
    <span className={cn(
      "inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
      toneClass,
    )}>
      {checked ? "Đã check-in" : "Chưa check-in"}
    </span>
  );
}

function PaymentBadge({ response }: { response: SurveyResponse }) {
  const status = response.payment_status;
  if (!status || status === "not_required") {
    return <span className="text-sm text-slate-600">-</span>;
  }

  return (
    <span className={cn(
      "inline-flex w-fit items-center rounded-full border px-2.5 py-1 text-xs font-semibold",
      status === "paid"
        ? "border-cyan-200 bg-cyan-100 text-cyan-700"
        : status === "pending"
          ? "border-amber-200 bg-amber-100 text-amber-700"
          : "border-red-200 bg-red-100 text-red-600",
    )}>
      {formatPaymentStatus(response)}
    </span>
  );
}

function InfoTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[11px] uppercase tracking-widest text-slate-600 mb-1">{label}</div>
      <div className="text-sm font-semibold text-slate-900 truncate">{value}</div>
    </div>
  );
}

function PaymentInfoLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2">
      <div className="text-[10px] uppercase tracking-widest text-slate-500">{label}</div>
      <div className="mt-1 break-words font-medium text-slate-900">{value}</div>
    </div>
  );
}

function formatPaymentStatus(response: SurveyResponse) {
  const status = response.payment_status;
  if (!status || status === "not_required") return "Không yêu cầu";
  if (status === "paid") return "Đã thanh toán";
  if (status === "pending") return "Chờ thanh toán";
  if (status === "cancelled") return "Đã huỷ";
  if (status === "expired") return "Hết hạn";
  return "Lỗi thanh toán";
}

function getDisplayName(response: SurveyResponse, questions: SurveyQuestion[]) {
  const nameQuestion = questions.find((question) => {
    const label = question.text.toLowerCase();
    return label.includes("họ") || label.includes("ten") || label.includes("tên") || label.includes("name");
  });
  const fromNameQuestion = nameQuestion ? answerToPlainText(response.answers[nameQuestion.id]) : "";
  if (fromNameQuestion) return fromNameQuestion;

  const firstText = questions
    .map((question) => answerToPlainText(response.answers[question.id]))
    .find((answer) => answer && !answer.includes("@") && answer.length <= 80);

  return firstText || response.email || response.id.slice(0, 8).toUpperCase();
}

function getEmail(response: SurveyResponse) {
  if (response.email) return response.email;
  return Object.values(response.answers).map(answerToPlainText).find((value) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) ?? "";
}

function getPreviewAnswer(response: SurveyResponse, questions: SurveyQuestion[]) {
  return questions.map((question) => answerToPlainText(response.answers[question.id])).find(Boolean) ?? "";
}

function formatAnswer(value: SurveyResponse["answers"][string] | undefined, question: SurveyQuestion) {
  if (value === undefined || value === null || value === "") return "-";
  if (question.type === "choice") {
    const indexes = Array.isArray(value) ? value : [value];
    return indexes
      .map((item) => question.options?.[Number(item)] ?? answerToPlainText(item))
      .filter(Boolean)
      .join(", ") || "-";
  }
  if (question.type === "date" && typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split("-");
    return `${day}/${month}/${year}`;
  }
  return answerToPlainText(value) || "-";
}

function answerToPlainText(value: unknown): string {
  if (value === undefined || value === null) return "";
  if (Array.isArray(value)) return value.map(answerToPlainText).filter(Boolean).join(", ");
  return String(value);
}

function formatDateTime(value: string, compact = false) {
  return new Date(value).toLocaleString("vi-VN", compact
    ? { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }
    : { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatNumber(value: number) {
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 1 }).format(value);
}

function getQuestionTypeLabel(type: SurveyQuestion["type"]) {
  if (type === "choice") return "Lựa chọn";
  if (type === "rating") return "Rating";
  if (type === "nps") return "NPS";
  if (type === "phone") return "Số điện thoại";
  if (type === "date") return "Ngày";
  if (type === "province") return "Tỉnh thành";
  if (type === "file_upload") return "Tệp tải lên";
  if (type === "signature") return "Chữ ký";
  if (type === "face_checkin") return "Face check-in";
  return "Văn bản";
}
