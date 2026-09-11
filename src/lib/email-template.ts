export const EMAIL_TEMPLATE_VERSION = 1;

export type EmailBlockAlign = "left" | "center" | "right";
export type EmailBlockType = "heading" | "text" | "image" | "button" | "qr" | "divider" | "spacer" | "html";
export type EmailMode = "blocks" | "overlay" | "combined";
export type OverlayFieldKind = "text" | "qr";

export type OverlayField = {
  id: string;
  kind: OverlayFieldKind;
  token: string;
  x: number;
  y: number;
  w: number;
  h: number;
  fontSize?: number;
  color?: string;
  align?: EmailBlockAlign;
  bold?: boolean;
};

export type EmailOverlay = {
  imageUrl: string;
  width: number;
  height: number;
  fields: OverlayField[];
};

export type EmailTheme = {
  accent?: string;
  background?: string;
  card?: string;
  buttonColor?: string;
  headingColor?: string;
  textColor?: string;
  headingSize?: number;
  textSize?: number;
  logoUrl?: string | null;
  footer?: string;
};

export type EmailBlock = {
  id: string;
  type: EmailBlockType;
  text?: string;
  url?: string;
  alt?: string;
  align?: EmailBlockAlign;
  height?: number;
  fontSize?: number;
  bold?: boolean;
  color?: string;
  qrSize?: number;
  buttonColor?: string;
};

export type EmailTemplate = {
  v: typeof EMAIL_TEMPLATE_VERSION;
  mode?: EmailMode;
  blocks: EmailBlock[];
  theme?: EmailTheme;
  overlay?: EmailOverlay | null;
};

export type EmailMergeQuestion = {
  id?: string;
  text: string;
  type: string;
  options?: string[] | null;
};

export type EmailMergeInput = {
  name?: string;
  email?: string;
  hall?: string;
  surveyTitle?: string;
  checkinUrl?: string;
  qrImgUrl?: string;
  answers?: Record<string, unknown>;
  questions?: EmailMergeQuestion[];
};

const SKIP_QUESTION_TYPES = new Set(["section", "image_banner", "face_checkin", "signature", "file_upload"]);

const DEFAULT_THEME: Required<Omit<EmailTheme, "logoUrl" | "footer">> & { logoUrl: string | null; footer: string } = {
  accent: "#0ea5e9",
  background: "#f1f5f9",
  card: "#ffffff",
  buttonColor: "#0ea5e9",
  headingColor: "#0f172a",
  textColor: "#334155",
  headingSize: 22,
  textSize: 14,
  logoUrl: null,
  footer: "",
};

function cleanHex(value: string | undefined, fallback: string) {
  const normalized = value?.trim() ?? "";
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(value ?? fallback, max));
}

export function normalizeEmailTheme(theme?: EmailTheme | null): typeof DEFAULT_THEME {
  return {
    accent: cleanHex(theme?.accent, DEFAULT_THEME.accent),
    background: cleanHex(theme?.background, DEFAULT_THEME.background),
    card: cleanHex(theme?.card, DEFAULT_THEME.card),
    buttonColor: cleanHex(theme?.buttonColor || theme?.accent, DEFAULT_THEME.buttonColor),
    headingColor: cleanHex(theme?.headingColor, DEFAULT_THEME.headingColor),
    textColor: cleanHex(theme?.textColor, DEFAULT_THEME.textColor),
    headingSize: clamp(theme?.headingSize, 16, 32, DEFAULT_THEME.headingSize),
    textSize: clamp(theme?.textSize, 12, 18, DEFAULT_THEME.textSize),
    logoUrl: theme?.logoUrl?.trim() || null,
    footer: theme?.footer?.trim() || "",
  };
}

export function newEmailBlockId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
  return `blk_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function defaultEmailBlocks(): EmailBlock[] {
  return [
    { id: newEmailBlockId(), type: "heading", text: "Xin chào {{name}}", align: "left" },
    {
      id: newEmailBlockId(),
      type: "text",
      text: "Đăng ký của bạn đã được ghi nhận cho sự kiện {{survey_title}}.\nVui lòng xuất trình mã QR bên dưới khi đến sự kiện.",
      align: "left",
    },
    { id: newEmailBlockId(), type: "qr", align: "center", qrSize: 220 },
    { id: newEmailBlockId(), type: "button", text: "Mở mã check-in", url: "{{checkin_url}}", align: "center" },
  ];
}

export function normalizeOverlay(overlay?: EmailOverlay | null): EmailOverlay | null {
  if (!overlay?.imageUrl) return null;
  const fields = Array.isArray(overlay.fields)
    ? overlay.fields.filter((field) => field && typeof field.id === "string" && typeof field.token === "string")
    : [];
  return {
    imageUrl: overlay.imageUrl,
    width: Math.max(1, Number(overlay.width) || 1),
    height: Math.max(1, Number(overlay.height) || 1),
    fields,
  };
}

function normalizeMode(value: unknown): EmailMode {
  if (value === "overlay" || value === "combined") return value;
  return "blocks";
}

export function serializeEmailTemplate(template: EmailTemplate): string {
  return JSON.stringify({
    v: EMAIL_TEMPLATE_VERSION,
    mode: normalizeMode(template.mode),
    blocks: template.blocks,
    theme: normalizeEmailTheme(template.theme),
    overlay: normalizeOverlay(template.overlay),
  });
}

export function isVisualEmailTemplate(raw: string | null | undefined): boolean {
  try {
    const parsed = JSON.parse(String(raw ?? "").trim());
    return parsed?.v === EMAIL_TEMPLATE_VERSION && Array.isArray(parsed.blocks);
  } catch {
    return false;
  }
}

function isValidBlock(value: unknown): value is EmailBlock {
  if (!value || typeof value !== "object") return false;
  const block = value as EmailBlock;
  return typeof block.id === "string" && typeof block.type === "string";
}

export function parseEmailTemplate(raw: string | null | undefined): EmailTemplate {
  const value = String(raw ?? "").trim();
  if (!value) {
    return {
      v: EMAIL_TEMPLATE_VERSION,
      mode: "blocks",
      blocks: defaultEmailBlocks(),
      theme: normalizeEmailTheme(),
      overlay: null,
    };
  }
  try {
    const parsed = JSON.parse(value);
    if (parsed?.v === EMAIL_TEMPLATE_VERSION && (Array.isArray(parsed.blocks) || parsed.mode === "overlay" || parsed.mode === "combined")) {
      const blocks = (Array.isArray(parsed.blocks) ? parsed.blocks : []).filter(isValidBlock);
      return {
        v: EMAIL_TEMPLATE_VERSION,
        mode: normalizeMode(parsed.mode),
        blocks: blocks.length > 0 ? blocks : defaultEmailBlocks(),
        theme: normalizeEmailTheme(parsed.theme),
        overlay: normalizeOverlay(parsed.overlay),
      };
    }
  } catch {
    // legacy HTML
  }
  return {
    v: EMAIL_TEMPLATE_VERSION,
    mode: "blocks",
    blocks: [{ id: newEmailBlockId(), type: "html", text: value }],
    theme: normalizeEmailTheme(),
    overlay: null,
  };
}

export function getEmailMode(raw: string | null | undefined): EmailMode {
  try {
    const parsed = JSON.parse(String(raw ?? "").trim());
    if (parsed?.v === EMAIL_TEMPLATE_VERSION) return normalizeMode(parsed.mode);
  } catch {
    // legacy HTML
  }
  return "blocks";
}

// True when the email should include a composed invitation image, either as
// the whole body (overlay) or above the HTML content (combined).
export function hasOverlayImage(raw: string | null | undefined): boolean {
  const mode = getEmailMode(raw);
  if (mode !== "overlay" && mode !== "combined") return false;
  return !!parseEmailTemplate(raw).overlay?.imageUrl;
}

export function isOverlayEmailTemplate(raw: string | null | undefined): boolean {
  return hasOverlayImage(raw);
}

export function overlayEmailHtml() {
  return `<div style="margin:0;padding:0;background:#ffffff"><img src="cid:invite" alt="Thư mời" width="640" style="width:100%;max-width:640px;height:auto;display:block;border:0" /></div>`;
}

export function slugifyEmailField(text: string): string {
  const slug = text
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40);
  return slug || "field";
}

export function listMergeFields(questions: EmailMergeQuestion[] = []) {
  const fields: { token: string; label: string }[] = [
    { token: "{{name}}", label: "Tên" },
    { token: "{{email}}", label: "Email" },
    { token: "{{hall}}", label: "Hội trường" },
    { token: "{{survey_title}}", label: "Tên sự kiện" },
    { token: "{{checkin_url}}", label: "Link check-in" },
    { token: "{{qr_url}}", label: "Ảnh QR" },
  ];

  const used = new Set(fields.map((field) => field.token));
  questions.forEach((question, index) => {
    if (!question.text.trim() || SKIP_QUESTION_TYPES.has(question.type)) return;
    let slug = slugifyEmailField(question.text);
    let token = `{{${slug}}}`;
    if (used.has(token)) {
      slug = `${slug}_${index + 1}`;
      token = `{{${slug}}}`;
    }
    used.add(token);
    fields.push({ token, label: question.text.trim() });
  });

  return fields;
}

export function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatAnswer(value: unknown, question?: EmailMergeQuestion): string {
  if (value == null) return "";
  if (Array.isArray(value)) {
    return value.map((item) => formatAnswer(item, question)).filter(Boolean).join(", ");
  }
  if (question?.options && (typeof value === "number" || (typeof value === "string" && /^\d+$/.test(value)))) {
    const option = question.options[Number(value)];
    if (option) return option;
  }
  return String(value);
}

export function findAttendeeName(answers: Record<string, unknown> = {}, questions: EmailMergeQuestion[] = []): string {
  const nameQuestion = questions.find((question) => /ho ten|họ tên|full name|^tên$|ten khach|hovaten/i.test(question.text));
  if (nameQuestion?.id) {
    const value = answers[nameQuestion.id];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  for (const value of Object.values(answers)) {
    if (typeof value !== "string") continue;
    const text = value.trim();
    if (text.length > 1 && text.length < 80 && !text.includes("@") && !/^\d+$/.test(text) && !/^https?:/i.test(text)) {
      return text;
    }
  }
  return "";
}

export function buildMergeValues(input: EmailMergeInput, html = true): Record<string, string> {
  const wrap = (value: string) => html ? escapeHtml(value) : value;
  const values: Record<string, string> = {
    name: wrap(String(input.name || findAttendeeName(input.answers, input.questions) || "bạn")),
    email: wrap(String(input.email || "")),
    hall: wrap(String(input.hall || "")),
    survey_title: wrap(String(input.surveyTitle || "")),
    checkin_url: wrap(String(input.checkinUrl || "")),
    qr_image: wrap(String(input.qrImgUrl || "")),
  };

  const used = new Set(["name", "email", "hall", "survey_title", "checkin_url", "qr_image", "qr_url"]);
  (input.questions ?? []).forEach((question, index) => {
    if (!question.id || SKIP_QUESTION_TYPES.has(question.type)) return;
    let key = slugifyEmailField(question.text || `cau_${index + 1}`);
    if (used.has(key)) key = `${key}_${index + 1}`;
    used.add(key);
    values[key] = wrap(formatAnswer(input.answers?.[question.id], question));
    values[`q_${question.id.slice(0, 8)}`] = values[key];
  });

  return values;
}

export function fillMergeTokens(template: string, values: Record<string, string>, qrImgUrl = "") {
  const qrImageHtml = qrImgUrl
    ? `<div style="text-align:center;margin:22px 0"><img src="${escapeHtml(qrImgUrl)}" alt="Mã QR check-in" width="220" height="220" style="width:220px;height:220px;border-radius:12px;border:1px solid #e2e8f0" /></div>`
    : "";

  const safeQr = values.qr_image || escapeHtml(qrImgUrl);
  let result = template
    .replace(/src=(["'])\{\{qr_url\}\}\1/g, `src=$1${safeQr}$1`)
    .replace(/href=(["'])\{\{qr_url\}\}\1/g, `href=$1${safeQr}$1`)
    .replace(/\{\{qr_image\}\}/g, safeQr)
    .replace(/\{\{qr_url\}\}/g, qrImageHtml);

  for (const [key, value] of Object.entries(values)) {
    if (key === "qr_image" || key === "qr_url") continue;
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), value);
  }
  return result;
}

function alignCss(align?: EmailBlockAlign) {
  return align === "right" ? "right" : align === "center" ? "center" : "left";
}

function renderTextHtml(text: string) {
  return escapeHtml(text).replace(/\n/g, "<br />");
}

export function renderEmailBlocks(blocks: EmailBlock[], qrImgUrl = "", themeInput?: EmailTheme | null): string {
  const theme = normalizeEmailTheme(themeInput);
  const rows = blocks.map((block) => {
    const align = alignCss(block.align);
    if (block.type === "heading") {
      const size = clamp(block.fontSize, 16, 36, theme.headingSize);
      const color = cleanHex(block.color, theme.headingColor);
      const weight = block.bold === false ? 500 : 700;
      return `<tr><td style="padding:0 0 12px;text-align:${align}"><h2 style="margin:0;color:${color};font-size:${size}px;line-height:1.3;font-weight:${weight}">${renderTextHtml(block.text || "")}</h2></td></tr>`;
    }
    if (block.type === "text") {
      const size = clamp(block.fontSize, 12, 20, theme.textSize);
      const color = cleanHex(block.color, theme.textColor);
      const weight = block.bold ? 700 : 400;
      return `<tr><td style="padding:0 0 14px;text-align:${align};color:${color};font-size:${size}px;line-height:1.6;font-weight:${weight}">${renderTextHtml(block.text || "")}</td></tr>`;
    }
    if (block.type === "image" && block.url) {
      const src = escapeHtml(block.url);
      const alt = escapeHtml(block.alt || "");
      return `<tr><td style="padding:0 0 16px;text-align:${align}"><img src="${src}" alt="${alt}" style="max-width:100%;height:auto;border-radius:12px;display:inline-block" /></td></tr>`;
    }
    if (block.type === "button") {
      const href = escapeHtml(block.url || "{{checkin_url}}");
      const label = renderTextHtml(block.text || "Mở liên kết");
      const color = cleanHex(block.buttonColor, theme.buttonColor);
      return `<tr><td style="padding:4px 0 18px;text-align:${align}"><a href="${href}" style="display:inline-block;background:${color};color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-size:14px;font-weight:700">${label}</a></td></tr>`;
    }
    if (block.type === "qr") {
      const size = clamp(block.qrSize, 140, 280, 220);
      const src = escapeHtml(qrImgUrl || "{{qr_image}}");
      return `<tr><td style="padding:8px 0 18px;text-align:${align}"><img src="${src}" alt="Mã QR check-in" width="${size}" height="${size}" style="width:${size}px;height:${size}px;border-radius:12px;border:1px solid #e2e8f0" /></td></tr>`;
    }
    if (block.type === "divider") {
      return `<tr><td style="padding:8px 0 18px"><hr style="border:none;border-top:1px solid #e2e8f0;margin:0" /></td></tr>`;
    }
    if (block.type === "spacer") {
      const height = clamp(block.height, 8, 80, 16);
      return `<tr><td style="height:${height}px;line-height:${height}px;font-size:1px">&nbsp;</td></tr>`;
    }
    if (block.type === "html") {
      return `<tr><td style="padding:0 0 12px">${block.text || ""}</td></tr>`;
    }
    return "";
  }).join("");

  const logo = theme.logoUrl
    ? `<div style="text-align:center;padding:0 0 18px"><img src="${escapeHtml(theme.logoUrl)}" alt="" style="max-height:56px;max-width:180px;height:auto" /></div>`
    : "";
  const footer = theme.footer
    ? `<p style="color:#94a3b8;font-size:12px;line-height:1.6;text-align:center;margin:18px 0 0">${renderTextHtml(theme.footer)}</p>`
    : "";

  return `
    <div style="background:${theme.background};padding:24px 12px">
      <div style="font-family:Arial,Helvetica,sans-serif;max-width:520px;margin:0 auto;background:${theme.card};padding:28px 24px;border-radius:16px;color:${theme.textColor};line-height:1.55">
        ${logo}
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rows}</table>
        ${footer}
      </div>
    </div>
  `;
}

export function compileEmailHtml(raw: string | null | undefined, values: Record<string, string>, qrImgUrl = "") {
  const source = String(raw ?? "").trim();
  if (!source) return "";
  const mode = getEmailMode(source);
  if (mode === "overlay" || mode === "combined") {
    const template = parseEmailTemplate(source);
    const blocksHtml = mode === "combined"
      ? fillMergeTokens(renderEmailBlocks(template.blocks, qrImgUrl, template.theme), values, qrImgUrl)
      : "";
    return `${overlayEmailHtml()}${blocksHtml}`;
  }
  if (isVisualEmailTemplate(source)) {
    const template = parseEmailTemplate(source);
    return fillMergeTokens(renderEmailBlocks(template.blocks, qrImgUrl, template.theme), values, qrImgUrl);
  }
  return fillMergeTokens(source, values, qrImgUrl);
}

export function sampleMergeValues(surveyTitle = "Sự kiện mẫu", html = false): Record<string, string> {
  const wrap = (value: string) => html ? escapeHtml(value) : value;
  return {
    name: wrap("Nguyễn Văn A"),
    email: wrap("nguyenvana@email.com"),
    hall: wrap("Hội trường 1"),
    survey_title: wrap(surveyTitle),
    checkin_url: wrap("https://dangkyhoithao.online/checkin/preview"),
    qr_image: "",
  };
}
