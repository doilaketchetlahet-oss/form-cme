"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  BarChart3,
  CheckCircle2,
  Download,
  FileText,
  Medal,
  Search,
  Settings,
  Trophy,
  Users,
} from "lucide-react";
import {
  buildPosterLeaderboardCSV,
  buildPosterRawScoresCSV,
  buildPosterScoreboard,
  formatScore,
  type PosterScoreRow,
  type PosterScoreboard,
} from "@/lib/poster-scoring";
import { getSurveyAnalytics } from "@/lib/surveys";
import { downloadCSV, slugify } from "@/lib/csv";
import { cn } from "@/lib/utils";

type SortMode = "score_desc" | "poster_asc" | "latest_desc" | "judges_desc" | "scores_desc";

export function PosterScoreboardView({ formId }: { formId: string }) {
  const [scoreboard, setScoreboard] = useState<PosterScoreboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [sortMode, setSortMode] = useState<SortMode>("score_desc");
  const [selectedPoster, setSelectedPoster] = useState<string | null>(null);

  useEffect(() => {
    let active = true;

    const load = async () => {
      setLoading(true);
      const analytics = await getSurveyAnalytics(formId);
      if (!active) return;
      setScoreboard(analytics ? buildPosterScoreboard(analytics.survey, analytics.questions, analytics.responses) : null);
      setLoading(false);
    };

    load();
    return () => { active = false; };
  }, [formId]);

  const rows = useMemo(() => {
    const needle = search.trim().toLowerCase();
    const all = scoreboard?.rows ?? [];
    const filtered = !needle ? all : all.filter((row) => {
      const haystack = [
        row.poster,
        ...row.judgeScores.map((score) => score.judge),
      ].join(" ").toLowerCase();
      return haystack.includes(needle);
    });
    return [...filtered].sort((a, b) => sortScoreRows(a, b, sortMode));
  }, [scoreboard?.rows, search, sortMode]);

  const selectedRow = useMemo(() => {
    if (!scoreboard) return null;
    return scoreboard.rows.find((row) => row.poster === selectedPoster) ?? scoreboard.rows[0] ?? null;
  }, [scoreboard, selectedPoster]);

  const handleExportLeaderboard = () => {
    if (!scoreboard) return;
    downloadCSV(buildPosterLeaderboardCSV(scoreboard), `${slugify(scoreboard.survey.title)}-bang-diem-${today()}.csv`);
  };

  const handleExportRaw = () => {
    if (!scoreboard) return;
    downloadCSV(buildPosterRawScoresCSV(scoreboard), `${slugify(scoreboard.survey.title)}-diem-goc-${today()}.csv`);
  };

  if (loading) {
    return (
      <div className="max-w-7xl px-4 py-8 sm:px-8 sm:py-10">
        <div className="admin-panel mb-5 h-36 animate-pulse rounded-2xl" />
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="admin-panel h-[520px] animate-pulse rounded-2xl" />
          <div className="admin-panel h-[520px] animate-pulse rounded-2xl" />
        </div>
      </div>
    );
  }

  if (!scoreboard) {
    return (
      <div className="max-w-4xl px-4 py-8 sm:px-8 sm:py-10">
        <BackLink />
        <div className="admin-panel rounded-2xl p-8 text-sm admin-muted">Không tìm thấy dữ liệu form.</div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl px-4 py-8 sm:px-8 sm:py-10">
      <div className="mb-7 flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <BackLink />
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700">
              <Trophy size={22} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">Bảng điểm poster</h1>
              <p className="mt-1 text-sm admin-muted">{scoreboard.survey.title}</p>
            </div>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href={`/admin/forms/${scoreboard.survey.id}`} className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white/10">
            <Settings size={16} /> Cấu hình
          </Link>
          <Link href={`/admin/forms/${scoreboard.survey.id}/report`} className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2.5 text-sm font-semibold text-sky-700 hover:bg-sky-100">
            <BarChart3 size={16} /> Report
          </Link>
          <button onClick={handleExportRaw} disabled={!scoreboard.ready || scoreboard.rawScores.length === 0} className="inline-flex items-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2.5 text-sm font-semibold text-cyan-700 hover:bg-cyan-100 disabled:cursor-not-allowed disabled:opacity-50">
            <Download size={16} /> Điểm gốc
          </button>
          <button onClick={handleExportLeaderboard} disabled={!scoreboard.ready || scoreboard.rows.length === 0} className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-amber-950 hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-50">
            <Download size={16} /> Bảng điểm
          </button>
        </div>
      </div>

      {!scoreboard.ready ? (
        <SetupState scoreboard={scoreboard} />
      ) : (
        <>
          <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <StatCard icon={FileText} label="Poster" value={scoreboard.rows.length} color="#f59e0b" />
            <StatCard icon={Users} label="Giám khảo" value={scoreboard.judges.length} color="#06b6d4" />
            <StatCard icon={CheckCircle2} label="Lượt chấm dùng" value={scoreboard.usedResponses} color="#0ea5e9" />
            <StatCard icon={BarChart3} label="Tiêu chí" value={scoreboard.criteria.length} color="#6366f1" />
            <StatCard icon={Medal} label="Điểm cao nhất" value={formatScore(scoreboard.rows[0]?.weightedAverage ?? scoreboard.rows[0]?.average ?? null) || "-"} color="#f97316" />
          </div>

          <section className="admin-panel mb-6 rounded-2xl p-4 sm:p-5">
            <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_auto] lg:items-center">
              <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 admin-subtle" />
                <input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Tìm poster hoặc giám khảo..."
                  className="admin-placeholder w-full rounded-xl border border-white/10 bg-white/5 py-2.5 pl-10 pr-4 text-sm text-white focus:border-amber-400 focus:outline-none"
                />
              </div>
              <select
                value={sortMode}
                onChange={(event) => setSortMode(event.target.value as SortMode)}
                className="admin-dark-select rounded-xl border border-white/10 bg-white/5 px-3 py-2.5 text-sm font-semibold text-white focus:border-amber-400 focus:outline-none"
                style={{ colorScheme: "light" }}
              >
                <option value="score_desc">Điểm cao nhất</option>
                <option value="poster_asc">Tên poster A-Z</option>
                <option value="latest_desc">Mới chấm gần nhất</option>
                <option value="judges_desc">Nhiều giám khảo nhất</option>
                <option value="scores_desc">Nhiều lượt chấm nhất</option>
              </select>
              <div className="text-sm admin-muted">
                {rows.length.toLocaleString("vi-VN")} / {scoreboard.rows.length.toLocaleString("vi-VN")} poster
              </div>
            </div>
          </section>

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]">
            <LeaderboardTable
              rows={rows}
              criteria={scoreboard.criteria}
              selectedPoster={selectedRow?.poster ?? null}
              onSelect={setSelectedPoster}
            />
            <PosterDetail row={selectedRow} criteria={scoreboard.criteria} duplicateMode={scoreboard.duplicateMode} />
          </div>
        </>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link href="/admin/forms" className="mb-3 flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900">
      <ArrowLeft size={15} /> Tất cả form
    </Link>
  );
}

function SetupState({ scoreboard }: { scoreboard: PosterScoreboard }) {
  return (
    <div className="admin-panel max-w-3xl rounded-2xl p-8">
      <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700">
        <Trophy size={22} />
      </div>
      <h2 className="text-xl font-semibold text-slate-900">Chưa sẵn sàng hiển thị bảng điểm</h2>
      <p className="mt-2 text-sm leading-6 admin-muted">
        Bảng điểm cần biết câu nào là Giám khảo, câu nào là Poster và các câu điểm nào dùng để tính trung bình.
      </p>
      <div className="mt-5 space-y-2">
        {scoreboard.missing.map((item) => (
          <div key={item} className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-700">
            {item}
          </div>
        ))}
      </div>
      <Link href={`/admin/forms/${scoreboard.survey.id}`} className="mt-6 inline-flex items-center gap-2 rounded-xl bg-amber-500 px-4 py-2.5 text-sm font-semibold text-amber-950 hover:bg-amber-400">
        <Settings size={16} /> Mở cấu hình scoring
      </Link>
    </div>
  );
}

function LeaderboardTable({
  rows,
  criteria,
  selectedPoster,
  onSelect,
}: {
  rows: PosterScoreRow[];
  criteria: PosterScoreboard["criteria"];
  selectedPoster: string | null;
  onSelect: (poster: string) => void;
}) {
  return (
    <section className="admin-panel-strong overflow-hidden rounded-2xl">
      <div className="border-b border-white/10 px-4 py-4 sm:px-5">
        <h2 className="text-base font-semibold text-slate-900">Xếp hạng poster</h2>
        <p className="mt-1 text-xs admin-muted">Điểm tổng là trung bình các tiêu chí đã chọn; nếu có trọng số thì ưu tiên cột điểm có trọng số.</p>
      </div>

      <div className="overflow-x-auto">
        <table className="min-w-[920px] w-full border-collapse text-left">
          <thead className="sticky top-0 z-10 bg-white/95 text-[11px] uppercase tracking-widest admin-subtle">
            <tr className="border-b border-white/10">
              <th className="w-20 px-5 py-3">Hạng</th>
              <th className="min-w-56 px-3 py-3">Poster</th>
              <th className="w-32 px-3 py-3 text-right">Điểm TB</th>
              <th className="w-32 px-3 py-3 text-right">Có trọng số</th>
              <th className="w-32 px-3 py-3 text-right">Giám khảo</th>
              {criteria.slice(0, 4).map((criterion) => (
                <th key={criterion.questionId} className="w-32 px-3 py-3 text-right">{criterion.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={5 + Math.min(criteria.length, 4)} className="px-5 py-12 text-center text-sm admin-muted">
                  Không có poster phù hợp bộ lọc.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr
                  key={row.poster}
                  onClick={() => onSelect(row.poster)}
                  className={cn(
                    "cursor-pointer border-b border-white/[0.06] transition-colors hover:bg-white/[0.045]",
                    row.poster === selectedPoster ? "bg-amber-400/[0.08]" : row.rank <= 3 ? "bg-white/[0.025]" : "",
                  )}
                >
                  <td className="px-5 py-4">
                    <RankBadge rank={row.rank} />
                  </td>
                  <td className="px-3 py-4">
                    <div className="max-w-[360px] truncate text-sm font-semibold text-slate-900">{row.poster}</div>
                    <div className="mt-1 text-xs admin-muted">Cập nhật {row.latestSubmittedAt ? formatShortDate(row.latestSubmittedAt) : "-"}</div>
                  </td>
                  <td className="px-3 py-4 text-right text-sm font-semibold tabular-nums text-slate-900">{formatScore(row.average) || "-"}</td>
                  <td className="px-3 py-4 text-right text-sm font-semibold tabular-nums text-amber-200">{formatScore(row.weightedAverage) || "-"}</td>
                  <td className="px-3 py-4 text-right text-sm tabular-nums text-slate-300">{row.judgeCount}/{row.scoreCount}</td>
                  {criteria.slice(0, 4).map((criterion) => {
                    const score = row.criteria.find((item) => item.questionId === criterion.questionId);
                    return (
                      <td key={criterion.questionId} className="px-3 py-4 text-right text-sm tabular-nums text-slate-300">
                        {formatScore(score?.average) || "-"}
                      </td>
                    );
                  })}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function PosterDetail({
  row,
  criteria,
  duplicateMode,
}: {
  row: PosterScoreRow | null;
  criteria: PosterScoreboard["criteria"];
  duplicateMode: "latest" | "all";
}) {
  if (!row) {
    return (
      <aside className="admin-panel rounded-2xl p-6 text-sm admin-muted">
        Chọn một poster để xem chi tiết.
      </aside>
    );
  }

  return (
    <aside className="admin-panel rounded-2xl p-5 xl:sticky xl:top-6">
      <div className="mb-5">
        <RankBadge rank={row.rank} large />
        <h2 className="mt-3 text-lg font-semibold leading-6 text-slate-900">{row.poster}</h2>
        <p className="mt-1 text-xs admin-muted">
          {duplicateMode === "latest" ? "Mỗi giám khảo/poster lấy lần chấm mới nhất." : "Đang tính tất cả lượt chấm."}
        </p>
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2">
        <InfoTile label="Điểm TB" value={formatScore(row.average) || "-"} />
        <InfoTile label="Có trọng số" value={formatScore(row.weightedAverage) || "-"} emphasis />
        <InfoTile label="Giám khảo" value={row.judgeCount.toLocaleString("vi-VN")} />
        <InfoTile label="Lượt chấm" value={row.scoreCount.toLocaleString("vi-VN")} />
      </div>

      <div className="mb-5 space-y-3">
        <div className="text-sm font-semibold text-slate-900">Theo tiêu chí</div>
        {criteria.map((criterion) => {
          const score = row.criteria.find((item) => item.questionId === criterion.questionId);
          const pct = score?.average && criterion.max > 0 ? Math.min(100, Math.round((score.average / criterion.max) * 100)) : 0;
          return (
            <div key={criterion.questionId}>
              <div className="mb-1 flex items-center justify-between gap-3">
                <span className="truncate text-xs text-slate-400">{criterion.label}</span>
                <span className="text-xs tabular-nums text-slate-300">{formatScore(score?.average) || "-"} / {criterion.max}</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-white/5">
                <div className="h-full rounded-full bg-amber-400" style={{ width: `${pct}%` }} />
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2">
        <div className="text-sm font-semibold text-slate-900">Điểm từng giám khảo</div>
        {row.judgeScores.map((score) => (
          <div key={score.responseId} className="rounded-xl border border-white/8 bg-white/[0.025] p-3">
            <div className="mb-2 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-slate-900">{score.judge}</div>
                <div className="mt-0.5 text-[11px] admin-muted">{formatShortDate(score.submittedAt)}</div>
              </div>
              <div className="text-right text-sm font-bold tabular-nums text-amber-200">{formatScore(score.weightedTotal ?? score.total) || "-"}</div>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {criteria.map((criterion) => (
                <div key={criterion.questionId} className="rounded-lg bg-white/[0.03] px-2 py-1.5">
                  <div className="truncate text-[10px] admin-muted">{criterion.label}</div>
                  <div className="text-xs font-semibold tabular-nums text-slate-600">{formatScore(score.criteria[criterion.questionId]) || "-"}</div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </aside>
  );
}

function RankBadge({ rank, large = false }: { rank: number; large?: boolean }) {
  const top = rank <= 3;
  const toneClass = top
    ? "border-amber-200 bg-amber-100 text-amber-700"
    : "border-white/10 bg-white/5 text-slate-300";

  return (
    <span className={cn(
      "inline-flex items-center justify-center rounded-full border font-bold tabular-nums",
      large ? "h-11 min-w-11 px-3 text-base" : "h-8 min-w-8 px-2 text-sm",
      toneClass,
    )}>
      #{rank}
    </span>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
  color,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  label: string;
  value: string | number;
  color: string;
}) {
  return (
    <div className="admin-panel rounded-2xl p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${color}18`, border: `1px solid ${color}35`, color }}>
          <Icon size={17} />
        </div>
        <div className="min-w-0">
          <div className="truncate text-2xl font-bold tabular-nums text-slate-900">{typeof value === "number" ? value.toLocaleString("vi-VN") : value}</div>
          <div className="text-xs admin-muted">{label}</div>
        </div>
      </div>
    </div>
  );
}

function InfoTile({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.03] p-3">
      <div className="text-[11px] uppercase tracking-widest admin-subtle">{label}</div>
      <div className={cn("mt-1 text-lg font-bold tabular-nums", emphasis ? "text-amber-200" : "text-slate-900")}>{value}</div>
    </div>
  );
}

function formatShortDate(value: string) {
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sortScoreRows(a: PosterScoreRow, b: PosterScoreRow, mode: SortMode) {
  if (mode === "poster_asc") return compareVi(a.poster, b.poster);
  if (mode === "latest_desc") return compareDateDesc(a.latestSubmittedAt, b.latestSubmittedAt) || a.rank - b.rank;
  if (mode === "judges_desc") return b.judgeCount - a.judgeCount || a.rank - b.rank;
  if (mode === "scores_desc") return b.scoreCount - a.scoreCount || a.rank - b.rank;
  return a.rank - b.rank;
}

function compareDateDesc(a: string | null, b: string | null) {
  return (b ? new Date(b).getTime() : 0) - (a ? new Date(a).getTime() : 0);
}

function compareVi(a: string, b: string) {
  return a.localeCompare(b, "vi", { numeric: true, sensitivity: "base" });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}
