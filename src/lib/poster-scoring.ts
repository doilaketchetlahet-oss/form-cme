import type { ScoringConfig, Survey, SurveyQuestion, SurveyResponse } from "@/lib/surveys";

export type ScoreAnswer = string | number | number[] | null | undefined;

export interface PosterCriterionScore {
  questionId: string;
  label: string;
  weight: number;
  max: number;
  average: number | null;
  weightedAverage: number | null;
  scoreCount: number;
}

export interface PosterJudgeScore {
  responseId: string;
  judge: string;
  poster: string;
  submittedAt: string;
  total: number | null;
  weightedTotal: number | null;
  criteria: Record<string, number | null>;
}

export interface PosterScoreRow {
  poster: string;
  rank: number;
  average: number | null;
  weightedAverage: number | null;
  judgeCount: number;
  scoreCount: number;
  latestSubmittedAt: string | null;
  criteria: PosterCriterionScore[];
  judgeScores: PosterJudgeScore[];
}

export interface PosterScoreboard {
  survey: Survey;
  config: ScoringConfig | null;
  ready: boolean;
  missing: string[];
  criteria: PosterCriterionScore[];
  rows: PosterScoreRow[];
  rawScores: PosterJudgeScore[];
  judges: string[];
  posters: string[];
  totalResponses: number;
  usedResponses: number;
  duplicateMode: "latest" | "all";
}

export function buildPosterScoreboard(
  survey: Survey,
  questions: SurveyQuestion[],
  responses: SurveyResponse[],
): PosterScoreboard {
  const config = normalizeConfig(survey.scoring_config);
  const questionById = new Map(questions.map((question) => [question.id, question]));
  const missing: string[] = [];

  if (!config?.enabled) missing.push("Chưa bật scoring cho form này.");
  if (!config?.judgeQuestionId || !questionById.has(config.judgeQuestionId)) missing.push("Chưa chọn câu Giám khảo.");
  if (!config?.posterQuestionId || !questionById.has(config.posterQuestionId)) missing.push("Chưa chọn câu Poster.");

  const criteria = (config?.criteria ?? [])
    .map((criterion) => {
      const question = questionById.get(criterion.questionId);
      if (!question || (question.type !== "rating" && question.type !== "nps")) return null;
      return {
        questionId: question.id,
        label: criterion.label?.trim() || question.text,
        weight: Number.isFinite(Number(criterion.weight)) ? Math.max(0, Number(criterion.weight)) : 1,
        max: getScoreMax(question),
        average: null,
        weightedAverage: null,
        scoreCount: 0,
      } satisfies PosterCriterionScore;
    })
    .filter(Boolean) as PosterCriterionScore[];

  if (criteria.length === 0) missing.push("Chưa chọn tiêu chí điểm.");

  const ready = missing.length === 0 && !!config;
  const empty: PosterScoreboard = {
    survey,
    config,
    ready,
    missing,
    criteria,
    rows: [],
    rawScores: [],
    judges: [],
    posters: [],
    totalResponses: responses.length,
    usedResponses: 0,
    duplicateMode: config?.duplicateMode === "all" ? "all" : "latest",
  };

  if (!ready || !config?.judgeQuestionId || !config.posterQuestionId) return empty;

  const raw = responses
    .map((response) => toJudgeScore(response, config, criteria, questionById))
    .filter((score): score is PosterJudgeScore => !!score);

  const used = config.duplicateMode === "all" ? raw : keepLatestByJudgePoster(raw);
  const rows = buildRows(used, criteria);
  const globalCriteria = criteria.map((criterion) => summarizeCriterion(criterion, used));

  return {
    ...empty,
    criteria: globalCriteria,
    rows,
    rawScores: used,
    judges: [...new Set(used.map((score) => score.judge))].sort(compareVi),
    posters: rows.map((row) => row.poster),
    usedResponses: used.length,
  };
}

export function buildPosterLeaderboardCSV(scoreboard: PosterScoreboard) {
  const headers = [
    "Hạng",
    "Poster",
    "Điểm trung bình",
    "Điểm có trọng số",
    "Số giám khảo",
    "Số lượt chấm",
    "Cập nhật gần nhất",
    ...scoreboard.criteria.map((criterion) => `${criterion.label} TB`),
  ];

  const rows = scoreboard.rows.map((row) => [
    row.rank,
    row.poster,
    formatScore(row.average),
    formatScore(row.weightedAverage),
    row.judgeCount,
    row.scoreCount,
    row.latestSubmittedAt ? formatDateTime(row.latestSubmittedAt) : "",
    ...row.criteria.map((criterion) => formatScore(criterion.average)),
  ]);

  return toCsv([headers, ...rows]);
}

export function buildPosterRawScoresCSV(scoreboard: PosterScoreboard) {
  const headers = [
    "Thời gian",
    "Giám khảo",
    "Poster",
    "Tổng điểm",
    "Tổng điểm có trọng số",
    ...scoreboard.criteria.map((criterion) => criterion.label),
  ];

  const rows = scoreboard.rawScores.map((score) => [
    formatDateTime(score.submittedAt),
    score.judge,
    score.poster,
    formatScore(score.total),
    formatScore(score.weightedTotal),
    ...scoreboard.criteria.map((criterion) => formatScore(score.criteria[criterion.questionId] ?? null)),
  ]);

  return toCsv([headers, ...rows]);
}

export function formatScore(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "";
  return new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 2 }).format(value);
}

function normalizeConfig(config: ScoringConfig | null | undefined): ScoringConfig | null {
  if (!config) return null;
  return {
    enabled: !!config.enabled,
    judgeQuestionId: config.judgeQuestionId ?? null,
    posterQuestionId: config.posterQuestionId ?? null,
    criteria: Array.isArray(config.criteria) ? config.criteria : [],
    duplicateMode: config.duplicateMode === "all" ? "all" : "latest",
  };
}

function toJudgeScore(
  response: SurveyResponse,
  config: ScoringConfig,
  criteria: PosterCriterionScore[],
  questionById: Map<string, SurveyQuestion>,
): PosterJudgeScore | null {
  const judgeQuestion = questionById.get(config.judgeQuestionId ?? "");
  const posterQuestion = questionById.get(config.posterQuestionId ?? "");
  const judge = answerToDisplayText(response.answers[config.judgeQuestionId ?? ""], judgeQuestion);
  const poster = answerToDisplayText(response.answers[config.posterQuestionId ?? ""], posterQuestion);
  if (!judge || !poster) return null;

  const scoreValues = criteria.map((criterion) => {
    const question = questionById.get(criterion.questionId);
    const value = parseScore(response.answers[criterion.questionId]);
    if (!question || value === null) return { criterion, value: null };
    return { criterion, value };
  });

  const values = scoreValues.map((item) => item.value).filter((value): value is number => value !== null);
  const weightedValues = scoreValues
    .filter((item): item is { criterion: PosterCriterionScore; value: number } => item.value !== null)
    .map((item) => ({ value: item.value, weight: item.criterion.weight || 0 }));
  const weightTotal = weightedValues.reduce((sum, item) => sum + item.weight, 0);

  return {
    responseId: response.id,
    judge,
    poster,
    submittedAt: response.submitted_at,
    total: values.length > 0 ? average(values) : null,
    weightedTotal: weightTotal > 0
      ? weightedValues.reduce((sum, item) => sum + item.value * item.weight, 0) / weightTotal
      : values.length > 0 ? average(values) : null,
    criteria: Object.fromEntries(scoreValues.map((item) => [item.criterion.questionId, item.value])),
  };
}

function keepLatestByJudgePoster(scores: PosterJudgeScore[]) {
  const map = new Map<string, PosterJudgeScore>();
  scores.forEach((score) => {
    const key = `${normalizeKey(score.judge)}::${normalizeKey(score.poster)}`;
    const existing = map.get(key);
    if (!existing || new Date(score.submittedAt).getTime() >= new Date(existing.submittedAt).getTime()) {
      map.set(key, score);
    }
  });
  return [...map.values()];
}

function buildRows(scores: PosterJudgeScore[], criteria: PosterCriterionScore[]) {
  const byPoster = new Map<string, PosterJudgeScore[]>();
  scores.forEach((score) => {
    if (!byPoster.has(score.poster)) byPoster.set(score.poster, []);
    byPoster.get(score.poster)!.push(score);
  });

  const rows = [...byPoster.entries()].map(([poster, posterScores]) => {
    const totals = posterScores.map((score) => score.total).filter((value): value is number => value !== null);
    const weightedTotals = posterScores.map((score) => score.weightedTotal).filter((value): value is number => value !== null);
    const latestSubmittedAt = posterScores
      .map((score) => score.submittedAt)
      .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] ?? null;

    return {
      poster,
      rank: 0,
      average: totals.length > 0 ? average(totals) : null,
      weightedAverage: weightedTotals.length > 0 ? average(weightedTotals) : null,
      judgeCount: new Set(posterScores.map((score) => score.judge)).size,
      scoreCount: posterScores.length,
      latestSubmittedAt,
      criteria: criteria.map((criterion) => summarizeCriterion(criterion, posterScores)),
      judgeScores: posterScores.sort((a, b) => compareVi(a.judge, b.judge)),
    } satisfies PosterScoreRow;
  });

  rows.sort((a, b) => {
    const aScore = a.weightedAverage ?? a.average ?? -Infinity;
    const bScore = b.weightedAverage ?? b.average ?? -Infinity;
    if (bScore !== aScore) return bScore - aScore;
    return compareVi(a.poster, b.poster);
  });

  let previousScore: number | null = null;
  let previousRank = 0;
  rows.forEach((row, index) => {
    const score = row.weightedAverage ?? row.average ?? null;
    if (score !== null && previousScore !== null && Math.abs(score - previousScore) < 0.000001) {
      row.rank = previousRank;
      return;
    }
    row.rank = index + 1;
    previousRank = row.rank;
    previousScore = score;
  });

  return rows;
}

function summarizeCriterion(criterion: PosterCriterionScore, scores: PosterJudgeScore[]): PosterCriterionScore {
  const values = scores
    .map((score) => score.criteria[criterion.questionId])
    .filter((value): value is number => value !== null && value !== undefined);
  const avg = values.length > 0 ? average(values) : null;
  return {
    ...criterion,
    average: avg,
    weightedAverage: avg === null ? null : avg * criterion.weight,
    scoreCount: values.length,
  };
}

function parseScore(value: ScoreAnswer) {
  if (Array.isArray(value)) return null;
  if (value === null || value === undefined || value === "") return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function answerToDisplayText(value: ScoreAnswer, question?: SurveyQuestion): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map((item) => answerToDisplayText(item, question)).filter(Boolean).join(", ");
  if (question?.type === "choice") {
    const index = typeof value === "number" ? value : Number(value);
    if (Number.isInteger(index) && index >= 0 && question.options?.[index]) return question.options[index].trim();
  }
  return String(value).trim();
}

function getScoreMax(question: SurveyQuestion) {
  if (question.type === "rating") return 5;
  if (question.type === "nps") return Number.parseInt(question.options?.[2] ?? "10", 10) || 10;
  return 0;
}

function average(values: number[]) {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function compareVi(a: string, b: string) {
  return a.localeCompare(b, "vi", { numeric: true, sensitivity: "base" });
}

function normalizeKey(value: string) {
  return value.trim().toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function formatDateTime(value: string) {
  return new Date(value).toLocaleString("vi-VN", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function toCsv(rows: (string | number)[][]) {
  return "\uFEFF" + rows.map((row) => row.map(escapeCsv).join(",")).join("\n");
}

function escapeCsv(value: string | number | null | undefined) {
  if (value === null || value === undefined) return "";
  const text = String(value);
  if (/[",\n\r]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}
