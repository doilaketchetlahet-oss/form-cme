// Export attendee QR codes as PNG files (filename = attendee name).
//
// Usage:
//   node scripts/export-qr.cjs --survey <surveyId> --out "D:\qr" [options]
//
// Options:
//   --survey <id>     Survey/form id (required)
//   --out <dir>       Output folder (required)
//   --size <px>       QR image size, default 600
//   --base <url>      Base URL for check-in link (default NEXT_PUBLIC_SITE_URL or https://dangkyhoithao.online)
//   --hall <name>     Only export attendees in this hall
//   --no-logo         Do not embed the logo
//   --dark <hex>      QR dark color, default #0f172a

const fs = require("node:fs");
const path = require("node:path");
const { createClient } = require("@supabase/supabase-js");
const QRCode = require("qrcode");

const root = path.resolve(__dirname, "..");

function loadEnv() {
  const envPath = path.join(root, ".env.local");
  if (!fs.existsSync(envPath)) return;
  for (const line of fs.readFileSync(envPath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
    if (!match) continue;
    let value = match[2].trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!process.env[match[1]]) process.env[match[1]] = value;
  }
}

function parseArgs(argv) {
  const args = { size: 600, logo: true, dark: "#0f172a" };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const next = argv[i + 1];
    if (key === "--survey") { args.survey = next; i += 1; }
    else if (key === "--out") { args.out = next; i += 1; }
    else if (key === "--size") { args.size = Number(next) || 600; i += 1; }
    else if (key === "--base") { args.base = next; i += 1; }
    else if (key === "--hall") { args.hall = next; i += 1; }
    else if (key === "--dark") { args.dark = next; i += 1; }
    else if (key === "--no-logo") { args.logo = false; }
  }
  return args;
}

function sanitizeFilename(name) {
  return name
    .replace(/[\\/:*?"<>|]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\.+$/g, "")
    .trim()
    .slice(0, 80) || "khach";
}

function pickNameQuestionIds(questions) {
  const NAME_KEYWORDS = ["họ và tên", "họ tên", "ho ten", "fullname", "full name", "tên của", "tên đại biểu", "tên khách", "your name", "tên"];
  const EXCLUDE_KEYWORDS = ["công ty", "đơn vị", "tổ chức", "cơ quan", "company", "sản phẩm", "địa chỉ", "chức"];
  return questions
    .filter((q) => q.type === "text" && !q.is_hall_selector)
    .sort((a, b) => a.position - b.position)
    .map((q) => {
      const label = (q.text || "").toLowerCase();
      if (EXCLUDE_KEYWORDS.some((k) => label.includes(k))) return { id: q.id, score: -1, position: q.position };
      const kwIndex = NAME_KEYWORDS.findIndex((k) => label.includes(k));
      return { id: q.id, score: kwIndex >= 0 ? NAME_KEYWORDS.length - kwIndex : 0, position: q.position };
    })
    .filter((q) => q.score >= 0)
    .sort((a, b) => b.score - a.score || a.position - b.position)
    .map((q) => q.id);
}

function resolveName(answers, nameQuestionIds) {
  for (const qid of nameQuestionIds) {
    const value = String(answers?.[qid] ?? "").trim();
    if (value.length > 1 && value.length < 60 && !/[@\d]/.test(value)) return value;
  }
  for (const value of Object.values(answers ?? {})) {
    const text = String(value ?? "").trim();
    if (text.length > 1 && text.length < 50 && !/[@\d]/.test(text)) return text;
  }
  return "";
}

async function buildLogoComposite(qrBuffer, size) {
  let sharp;
  try {
    sharp = require("sharp");
  } catch {
    return qrBuffer;
  }
  const logoPath = path.join(root, "public", "logo_qr.png");
  if (!fs.existsSync(logoPath)) return qrBuffer;

  const logoSize = Math.round(size * 0.22);
  const padding = Math.round(size * 0.022);
  const boxSize = logoSize + padding * 2;
  const offset = Math.round((size - boxSize) / 2);
  const boxSvg = `<svg width="${boxSize}" height="${boxSize}"><rect width="100%" height="100%" rx="${Math.round(boxSize * 0.22)}" fill="#ffffff"/></svg>`;
  const logo = await sharp(logoPath)
    .resize(logoSize, logoSize, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return sharp(qrBuffer)
    .composite([
      { input: Buffer.from(boxSvg), left: offset, top: offset },
      { input: logo, left: Math.round((size - logoSize) / 2), top: Math.round((size - logoSize) / 2) },
    ])
    .png()
    .toBuffer();
}

async function main() {
  loadEnv();
  const args = parseArgs(process.argv.slice(2));

  if (!args.survey || !args.out) {
    console.error("Thiếu tham số. Ví dụ:\n  node scripts/export-qr.cjs --survey <id> --out \"D:\\qr\"");
    process.exit(1);
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    console.error("Thiếu NEXT_PUBLIC_SUPABASE_URL hoặc SUPABASE_SERVICE_ROLE_KEY trong .env.local");
    process.exit(1);
  }

  const base = (args.base || process.env.NEXT_PUBLIC_SITE_URL || "https://dangkyhoithao.online").replace(/\/+$/, "");
  const supabase = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });

  const [{ data: survey }, { data: questions }, { data: responses }] = await Promise.all([
    supabase.from("surveys").select("title").eq("id", args.survey).single(),
    supabase.from("survey_questions").select("id, text, type, position, is_hall_selector").eq("survey_id", args.survey),
    supabase.from("survey_responses").select("id, answers, email, hall").eq("survey_id", args.survey).order("submitted_at", { ascending: true }),
  ]);

  if (!survey) {
    console.error("Không tìm thấy form.");
    process.exit(1);
  }

  const rows = args.hall ? (responses ?? []).filter((r) => r.hall === args.hall) : (responses ?? []);
  if (rows.length === 0) {
    console.error("Không có người đăng ký nào để xuất.");
    process.exit(1);
  }

  const nameQuestionIds = pickNameQuestionIds(questions ?? []);
  const outDir = path.resolve(args.out);
  fs.mkdirSync(outDir, { recursive: true });

  const used = new Map();
  let index = 0;

  for (const row of rows) {
    index += 1;
    const rawName = resolveName(row.answers, nameQuestionIds) || (row.email ? String(row.email).split("@")[0] : "") || row.id.slice(0, 8);
    let filename = sanitizeFilename(rawName);
    const seen = used.get(filename) ?? 0;
    used.set(filename, seen + 1);
    if (seen > 0) filename = `${filename}_${seen + 1}`;

    const checkinUrl = `${base}/checkin/${row.id}`;
    const qrBuffer = await QRCode.toBuffer(checkinUrl, {
      type: "png",
      width: args.size,
      margin: 2,
      errorCorrectionLevel: args.logo ? "H" : "M",
      color: { dark: args.dark, light: "#ffffff" },
    });
    const finalBuffer = args.logo ? await buildLogoComposite(qrBuffer, args.size) : qrBuffer;
    fs.writeFileSync(path.join(outDir, `${filename}.png`), finalBuffer);

    if (index % 25 === 0 || index === rows.length) {
      console.log(`  ${index}/${rows.length}…`);
    }
  }

  console.log(`\n✓ Đã xuất ${rows.length} mã QR vào: ${outDir}`);
  console.log(`  Tên file = tên người đăng ký. Nội dung QR = ${base}/checkin/<id>`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
