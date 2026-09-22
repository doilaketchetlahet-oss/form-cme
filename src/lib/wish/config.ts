/**
 * Cấu hình dùng chung cho công cụ "Trao lời chúc, nhận yêu thương".
 *
 * File này chứa kiểu dữ liệu, giá trị mặc định và hàm chuẩn hoá. Cả API
 * (server) lẫn tablet/LED (client) đều import từ đây nên luôn khớp nhau.
 */

export const WISH_SYMBOLS = [
  "❤️",
  "💛",
  "💚",
  "💙",
  "💜",
  "🌸",
  "🌷",
  "🌺",
  "⭐",
  "✨",
  "🍀",
  "🕊️",
  "🌙",
  "🎈",
  "🎁",
  "🔆",
] as const;

export const WISH_COLORS = [
  "#f43f5e",
  "#fb7185",
  "#f97316",
  "#facc15",
  "#22c55e",
  "#14b8a6",
  "#38bdf8",
  "#6366f1",
  "#a855f7",
  "#ec4899",
  "#f8fafc",
] as const;

export const WISH_THEMES = {
  aurora: {
    label: "Cực quang",
    bg: ["#0b1220", "#14284a", "#0a2a3a"],
    accent: "#38bdf8",
  },
  romance: {
    label: "Lãng mạn",
    bg: ["#2a0a1c", "#4a1130", "#1c0a2a"],
    accent: "#fb7185",
  },
  galaxy: {
    label: "Ngân hà",
    bg: ["#05030f", "#1b1140", "#060b2e"],
    accent: "#a855f7",
  },
  sunset: {
    label: "Hoàng hôn",
    bg: ["#2b1004", "#5b1d0a", "#2a0a1c"],
    accent: "#f97316",
  },
  light: {
    label: "Sáng",
    bg: ["#e0f2fe", "#f0f9ff", "#ede9fe"],
    accent: "#0ea5e9",
  },
} as const;

export type WishThemeKey = keyof typeof WISH_THEMES;

export type WishShape = "heart" | "star" | "flower" | "text" | "image";

export type WishSettings = {
  /** Biểu tượng mặc định khi khách chưa chọn. */
  symbol: string;
  allowText: boolean;
  allowDrawing: boolean;
  /** Độ dài tối đa của lời chúc. */
  maxLength: number;
  theme: WishThemeKey;
  /** Cạnh tablet so với màn LED: lời chúc bay vào từ cạnh này. */
  edge: "left" | "right" | "center";
  /** Hình dạng tập thể mà các lời chúc hội tụ thành. */
  shape: WishShape;
  /** Chữ cho shape = "text" (tên cô dâu/chú rể, tên thương hiệu…). */
  shapeText: string;
  /** Ảnh khiên (tấm lá chắn ánh sáng) — admin tải lên sau. */
  shieldImageUrl: string | null;
  /** Ảnh hình ghép tập thể — admin tải lên sau. */
  targetImageUrl: string | null;
  /** Ảnh nền màn LED. */
  backgroundUrl: string | null;
  /** Hiện tên người gửi trên thẻ lời chúc. */
  showNames: boolean;
  /** Số lời chúc trôi nổi cùng lúc trước khi lời cũ kết tinh vào hình ghép. */
  maxFloating: number;
  /** Số lời chúc kết tinh để hoàn thành (bùng sáng) hình ghép tập thể. */
  shapeCapacity: number;
  /** Kích thước hình ghép so với cạnh ngắn màn LED (40..96%). */
  shapeScale: number;
  /** Độ mờ của ảnh/hình gợi ý phía sau các mảnh ghép (0..80%). */
  shapeGuideOpacity: number;
  /** Ngưỡng tách nền cho ảnh hình ghép không có kênh alpha. */
  shapeImageThreshold: number;
  /** Đảo vùng sáng/tối khi tách hình từ JPG hoặc PNG nền đặc. */
  shapeImageInvert: boolean;
  /** Kích thước khiên so với mặc định (50..180%). */
  shieldScale: number;
  /** Độ hiển thị của ảnh nền LED (0..100%). */
  backgroundOpacity: number;
};

export const DEFAULT_WISH_SETTINGS: WishSettings = {
  symbol: "❤️",
  allowText: true,
  allowDrawing: true,
  maxLength: 160,
  theme: "aurora",
  edge: "center",
  shape: "heart",
  shapeText: "",
  shieldImageUrl: null,
  targetImageUrl: null,
  backgroundUrl: null,
  showNames: true,
  maxFloating: 22,
  shapeCapacity: 48,
  shapeScale: 82,
  shapeGuideOpacity: 20,
  shapeImageThreshold: 210,
  shapeImageInvert: false,
  shieldScale: 100,
  backgroundOpacity: 40,
};

export type WishKind = "symbol" | "text" | "drawing";
export type WishStatus = "pending" | "approved" | "rejected" | "hidden";
export type WishEdge = "left" | "right" | "center";

export type WishStroke = {
  /** Màu nét vẽ. */
  c: string;
  /** Độ dày nét (0..1, tương đối theo cạnh dài của khung vẽ). */
  w: number;
  /** Toạ độ đã chuẩn hoá: [x0, y0, x1, y1, ...] trong khoảng 0..1. */
  p: number[];
};

export type WishDrawing = { strokes: WishStroke[] };

export type Wish = {
  id: string;
  event_id: string;
  kind: WishKind;
  symbol: string;
  content: string;
  drawing: WishDrawing | null;
  color: string;
  nickname: string;
  edge: WishEdge;
  status: WishStatus;
  created_at: string;
};

export type WishEvent = {
  id: string;
  code: string;
  title: string;
  subtitle: string;
  status: "draft" | "live" | "paused" | "ended";
  moderation: boolean;
  settings: WishSettings;
  created_at: string;
  updated_at: string;
};

export type WishSnapshot = {
  event: WishEvent;
  wishes: Wish[];
  counts: { total: number; pending: number; approved: number };
};

export const MAX_STROKES = 60;
/** Tổng số toạ độ (x,y) tối đa cho cả bức vẽ; quá ngưỡng sẽ giảm mẫu đều. */
export const MAX_STROKE_POINTS = 2400;
export const MAX_TEXT_LENGTH = 300;
export const MAX_NICKNAME_LENGTH = 32;

const THEME_KEYS = Object.keys(WISH_THEMES) as WishThemeKey[];
const SHAPES: WishShape[] = ["heart", "star", "flower", "text", "image"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function cleanUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^https?:\/\//i.test(trimmed) && !trimmed.startsWith("/")) return null;
  return trimmed.slice(0, 600);
}

/** Chuẩn hoá settings từ DB/API về dạng an toàn (không tin dữ liệu thô). */
export function normalizeWishSettings(input: unknown): WishSettings {
  const raw = isRecord(input) ? input : {};
  const theme = THEME_KEYS.includes(raw.theme as WishThemeKey)
    ? (raw.theme as WishThemeKey)
    : DEFAULT_WISH_SETTINGS.theme;
  const shape = SHAPES.includes(raw.shape as WishShape) ? (raw.shape as WishShape) : DEFAULT_WISH_SETTINGS.shape;
  const edge =
    raw.edge === "left" || raw.edge === "right" || raw.edge === "center"
      ? raw.edge
      : DEFAULT_WISH_SETTINGS.edge;
  const symbol =
    typeof raw.symbol === "string" && raw.symbol.trim().length > 0
      ? Array.from(raw.symbol.trim()).slice(0, 4).join("")
      : DEFAULT_WISH_SETTINGS.symbol;

  return {
    symbol,
    allowText: raw.allowText !== false,
    allowDrawing: raw.allowDrawing !== false,
    maxLength: clampInt(raw.maxLength, 20, MAX_TEXT_LENGTH, DEFAULT_WISH_SETTINGS.maxLength),
    theme,
    edge,
    shape,
    shapeText:
      typeof raw.shapeText === "string" ? raw.shapeText.trim().slice(0, 60) : DEFAULT_WISH_SETTINGS.shapeText,
    shieldImageUrl: cleanUrl(raw.shieldImageUrl),
    targetImageUrl: cleanUrl(raw.targetImageUrl),
    backgroundUrl: cleanUrl(raw.backgroundUrl),
    showNames: raw.showNames !== false,
    maxFloating: clampInt(raw.maxFloating, 6, 60, DEFAULT_WISH_SETTINGS.maxFloating),
    shapeCapacity: clampInt(raw.shapeCapacity, 12, 200, DEFAULT_WISH_SETTINGS.shapeCapacity),
    shapeScale: clampInt(raw.shapeScale, 40, 96, DEFAULT_WISH_SETTINGS.shapeScale),
    shapeGuideOpacity: clampInt(
      raw.shapeGuideOpacity,
      0,
      80,
      DEFAULT_WISH_SETTINGS.shapeGuideOpacity,
    ),
    shapeImageThreshold: clampInt(
      raw.shapeImageThreshold,
      20,
      245,
      DEFAULT_WISH_SETTINGS.shapeImageThreshold,
    ),
    shapeImageInvert: raw.shapeImageInvert === true,
    shieldScale: clampInt(raw.shieldScale, 50, 180, DEFAULT_WISH_SETTINGS.shieldScale),
    backgroundOpacity: clampInt(
      raw.backgroundOpacity,
      0,
      100,
      DEFAULT_WISH_SETTINGS.backgroundOpacity,
    ),
  };
}

export function normalizeWishEvent(row: Record<string, unknown>): WishEvent {
  return {
    id: String(row.id),
    code: String(row.code ?? "").toUpperCase(),
    title:
      typeof row.title === "string" && row.title.trim()
        ? row.title.trim().slice(0, 160)
        : "Trao lời chúc, nhận yêu thương",
    subtitle: typeof row.subtitle === "string" ? row.subtitle : "",
    status: (["draft", "live", "paused", "ended"] as const).includes(
      row.status as WishEvent["status"],
    )
      ? (row.status as WishEvent["status"])
      : "live",
    moderation: row.moderation === true,
    settings: normalizeWishSettings(row.settings),
    created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
    updated_at: typeof row.updated_at === "string" ? row.updated_at : new Date().toISOString(),
  };
}

export function normalizeWishRow(row: Record<string, unknown>): Wish {
  const kind = (["symbol", "text", "drawing"] as const).includes(row.kind as WishKind)
    ? (row.kind as WishKind)
    : "symbol";
  const edge = (["left", "right", "center"] as const).includes(row.edge as WishEdge)
    ? (row.edge as WishEdge)
    : "center";
  const status = (["pending", "approved", "rejected", "hidden"] as const).includes(
    row.status as WishStatus,
  )
    ? (row.status as WishStatus)
    : "approved";

  return {
    id: String(row.id),
    event_id: String(row.event_id),
    kind,
    symbol:
      typeof row.symbol === "string" && row.symbol.trim()
        ? Array.from(row.symbol.trim()).slice(0, 4).join("")
        : DEFAULT_WISH_SETTINGS.symbol,
    content: typeof row.content === "string" ? row.content.slice(0, MAX_TEXT_LENGTH) : "",
    drawing: normalizeDrawing(row.drawing),
    color: typeof row.color === "string" && /^#[0-9a-f]{3,8}$/i.test(row.color) ? row.color : "#38bdf8",
    nickname: typeof row.nickname === "string" ? row.nickname.slice(0, MAX_NICKNAME_LENGTH) : "",
    edge,
    status,
    created_at: typeof row.created_at === "string" ? row.created_at : new Date().toISOString(),
  };
}

const HEX = /^#[0-9a-f]{3,8}$/i;

/** Lấy mẫu đều `keep` điểm (cặp x,y) trên một nét dài. */
function downsample(points: number[], keep: number): number[] {
  const pairs = Math.floor(points.length / 2);
  if (keep >= pairs) return points;
  const out: number[] = [];
  for (let i = 0; i < keep; i += 1) {
    const index = Math.round((i / Math.max(1, keep - 1)) * (pairs - 1)) * 2;
    out.push(points[index] ?? 0, points[index + 1] ?? 0);
  }
  return out;
}

/**
 * Nét vẽ chỉ nhận toạ độ 0..1, màu hợp lệ. Khi tổng số điểm vượt ngưỡng thì
 * GIẢM MẪU ĐỀU từng nét (không bỏ nét), nên bức vẽ không bị mất đoạn sau.
 */
export function normalizeDrawing(input: unknown): WishDrawing | null {
  if (!isRecord(input) || !Array.isArray(input.strokes)) return null;

  const raw: WishStroke[] = [];
  for (const rawStroke of input.strokes.slice(0, MAX_STROKES)) {
    if (!isRecord(rawStroke) || !Array.isArray(rawStroke.p)) continue;
    const color = typeof rawStroke.c === "string" && HEX.test(rawStroke.c) ? rawStroke.c : "#f8fafc";
    const width = Math.min(0.2, Math.max(0.002, Number(rawStroke.w) || 0.01));
    const points: number[] = [];
    for (const value of rawStroke.p) {
      const n = Number(value);
      if (!Number.isFinite(n)) continue;
      points.push(Math.min(1, Math.max(0, Math.round(n * 1000) / 1000)));
    }
    if (points.length < 4) continue;
    raw.push({ c: color, w: width, p: points });
  }

  if (!raw.length) return null;

  const totalPairs = raw.reduce((sum, stroke) => sum + Math.floor(stroke.p.length / 2), 0);
  const maxPairs = Math.floor(MAX_STROKE_POINTS / 2);
  const factor = totalPairs > maxPairs ? maxPairs / totalPairs : 1;

  const strokes = raw.map((stroke) => {
    const pairs = Math.floor(stroke.p.length / 2);
    const keep = Math.max(2, Math.floor(pairs * factor));
    return keep < pairs ? { ...stroke, p: downsample(stroke.p, keep) } : stroke;
  });

  return { strokes };
}

/** Kiểm tra một yêu cầu gửi lời chúc từ tablet. */
export function validateWishInput(
  settings: WishSettings,
  body: Record<string, unknown>,
): { ok: true; data: { symbol: string; content: string; drawing: WishDrawing | null; color: string; nickname: string; edge: WishEdge } } | { ok: false; error: string } {
  const symbol =
    typeof body.symbol === "string" && body.symbol.trim()
      ? Array.from(body.symbol.trim()).slice(0, 4).join("")
      : settings.symbol;
  const content = settings.allowText
    ? typeof body.content === "string"
      ? body.content.trim().slice(0, settings.maxLength)
      : ""
    : "";
  const drawing = settings.allowDrawing ? normalizeDrawing(body.drawing) : null;
  const nickname =
    typeof body.nickname === "string" ? body.nickname.trim().slice(0, MAX_NICKNAME_LENGTH) : "";
  const color = typeof body.color === "string" && HEX.test(body.color) ? body.color : "#38bdf8";
  const edge =
    body.edge === "left" || body.edge === "right" || body.edge === "center" ? body.edge : settings.edge;

  return {
    ok: true,
    data: {
      symbol,
      content,
      drawing,
      color,
      nickname,
      edge,
    },
  };
}

/** Mã chương trình ngắn, bỏ các ký tự dễ nhầm. */
export function generateWishCode(length = 6): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < length; i += 1) code += alphabet[Math.floor(Math.random() * alphabet.length)];
  return code;
}
