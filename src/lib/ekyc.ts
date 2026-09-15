import type { SupabaseClient } from "@supabase/supabase-js";
import type { Config } from "@vladmandic/human";

type HumanModule = typeof import("@vladmandic/human");
type HumanInstance = InstanceType<HumanModule["default"]>;

const MODEL_BASE = "/models/human/";

// Human (~ArcFace embedder + BlazeFace + FaceMesh + antispoof) runs in the
// browser only. It is loaded lazily so SSR never evaluates TensorFlow.
let humanPromise: Promise<HumanInstance> | null = null;

function humanConfig(): Partial<Config> {
  return {
    modelBasePath: MODEL_BASE,
    cacheModels: true,
    warmup: "none",
    debug: false,
    filter: { enabled: false },
    face: {
      enabled: true,
      detector: { enabled: true, modelPath: "blazeface.json", rotation: true, maxDetected: 4, minConfidence: 0.3, minSize: 40 },
      mesh: { enabled: true, modelPath: "facemesh.json" },
      description: { enabled: true, modelPath: "faceres.json", minConfidence: 0.3 },
      antispoof: { enabled: true, modelPath: "antispoof.json" },
      iris: { enabled: false },
      emotion: { enabled: false },
      gear: { enabled: false },
      liveness: { enabled: false },
    },
    body: { enabled: false },
    hand: { enabled: false },
    object: { enabled: false },
  };
}

async function getHuman(): Promise<HumanInstance> {
  if (!humanPromise) {
    humanPromise = import("@vladmandic/human").then((mod) => {
      const HumanClass = (mod.default ?? mod) as HumanModule["default"];
      return new HumanClass(humanConfig());
    });
  }
  return humanPromise;
}

export async function loadFaceModels(): Promise<void> {
  const human = await getHuman();
  await human.load();
}

export async function extractFaceDescriptor(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
): Promise<Float32Array | null> {
  const human = await getHuman();
  await human.load();
  const result = await human.detect(input);
  const face = (result.face ?? []).slice().sort((a, b) => b.score - a.score)[0];
  if (!face?.embedding || face.embedding.length === 0) return null;
  return Float32Array.from(face.embedding);
}

// Cosine distance: 0 = identical, 1 = unrelated, 2 = opposite.
export function compareFaces(descriptor1: Float32Array, descriptor2: Float32Array): number {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < descriptor1.length; i += 1) {
    dot += descriptor1[i] * descriptor2[i];
    normA += descriptor1[i] * descriptor1[i];
    normB += descriptor2[i] * descriptor2[i];
  }
  if (normA === 0 || normB === 0) return 1;
  const cosine = dot / (Math.sqrt(normA) * Math.sqrt(normB));
  return 1 - cosine;
}

export interface FaceQualityReport {
  score: number;
  isFrontal: boolean;
  isGoodLight: boolean;
  isNotBlurry: boolean;
  singleFace: boolean;
  yaw: number;
  pitch: number;
  brightness: number;
  blurScore: number;
  faceCount: number;
  directionHint: string;
  canAutoCapture: boolean;
}

function toDegrees(value: number) {
  // Human returns radians; keep degree values as-is.
  return Math.abs(value) <= 3.5 ? (value * 180) / Math.PI : value;
}

export async function assessFaceQuality(
  input: HTMLVideoElement | HTMLCanvasElement
): Promise<FaceQualityReport> {
  const defaultReport: FaceQualityReport = {
    score: 0,
    isFrontal: false,
    isGoodLight: false,
    isNotBlurry: false,
    singleFace: false,
    yaw: 999,
    pitch: 999,
    brightness: 0,
    blurScore: 0,
    faceCount: 0,
    directionHint: "Không phát hiện khuôn mặt",
    canAutoCapture: false,
  };

  const human = await getHuman();
  await human.load();

  const canvas = document.createElement("canvas");
  canvas.width = input instanceof HTMLVideoElement ? input.videoWidth : input.width;
  canvas.height = input instanceof HTMLVideoElement ? input.videoHeight : input.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return defaultReport;
  ctx.drawImage(input, 0, 0, canvas.width, canvas.height);

  const result = await human.detect(canvas);
  const faces = (result.face ?? []).slice().sort((a, b) => b.score - a.score);
  const faceCount = faces.length;
  if (faceCount === 0) return defaultReport;

  if (faceCount > 1) {
    return {
      ...defaultReport,
      faceCount,
      directionHint: "Phát hiện nhiều khuôn mặt. Chỉ giữ 1 người trong khung.",
    };
  }

  const face = faces[0];
  const [fx, fy, fw, fh] = face.box;

  const yaw = toDegrees(face.rotation?.angle.yaw ?? 0);
  const pitch = toDegrees(face.rotation?.angle.pitch ?? 0);
  const isFrontal = Math.abs(yaw) < 25 && Math.abs(pitch) < 28;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data: pixels } = imageData;
  let totalBrightness = 0;
  let pixelCount = 0;
  for (let y = Math.max(0, Math.floor(fy)); y < Math.min(canvas.height, Math.floor(fy + fh)); y++) {
    for (let x = Math.max(0, Math.floor(fx)); x < Math.min(canvas.width, Math.floor(fx + fw)); x++) {
      const idx = (y * canvas.width + x) * 4;
      totalBrightness += pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
      pixelCount++;
    }
  }
  const brightness = pixelCount > 0 ? totalBrightness / pixelCount : 0;
  const isGoodLight = brightness > 35 && brightness < 230;

  const faceRegion = ctx.getImageData(
    Math.max(0, Math.floor(fx)),
    Math.max(0, Math.floor(fy)),
    Math.max(1, Math.min(Math.floor(fw), canvas.width - Math.floor(fx))),
    Math.max(1, Math.min(Math.floor(fh), canvas.height - Math.floor(fy)))
  );
  const blurScore = computeLaplacianVariance(faceRegion);
  const isNotBlurry = blurScore > 10;

  const faceAreaRatio = (fw * fh) / (canvas.width * canvas.height);
  const isGoodSize = faceAreaRatio > 0.06 && faceAreaRatio < 0.6;

  const spoofed = typeof face.real === "number" && face.real < 0.3;

  let directionHint = "";
  if (Math.abs(yaw) > 25) {
    directionHint = yaw > 0 ? "← Di chuyển sang trái" : "Di chuyển sang phải →";
  } else if (Math.abs(pitch) > 28) {
    directionHint = pitch > 0 ? "Nhìn lên một chút" : "Nhìn xuống một chút";
  } else if (!isGoodLight && brightness <= 35) {
    directionHint = "Cần thêm ánh sáng";
  } else if (!isGoodLight && brightness > 230) {
    directionHint = "Quá sáng, giảm ánh sáng";
  } else if (!isNotBlurry) {
    directionHint = "Giữ camera ổn định hơn";
  } else if (!isGoodSize && faceAreaRatio < 0.06) {
    directionHint = "Tiến gần camera hơn";
  } else if (!isGoodSize && faceAreaRatio > 0.6) {
    directionHint = "Lùi lại xa hơn";
  } else if (spoofed) {
    directionHint = "Có dấu hiệu ảnh giả. Đưa khuôn mặt thật vào khung.";
  } else {
    directionHint = "Đang nhận diện...";
  }

  let score = 0;
  if (isFrontal) score += 25;
  else {
    const yawPenalty = Math.min(Math.abs(yaw) - 25, 20) * 0.5;
    const pitchPenalty = Math.min(Math.abs(pitch) - 28, 20) * 0.5;
    score += Math.max(0, 25 - yawPenalty - pitchPenalty);
  }
  if (isGoodLight) score += 25;
  else score += Math.max(0, 25 - Math.max(0, 35 - brightness) * 0.5);

  if (isNotBlurry) score += 20;
  if (isGoodSize) score += 15;
  score += Math.max(0, 15 - Math.abs(yaw) * 0.3 - Math.abs(pitch) * 0.2);
  if (spoofed) score = Math.min(score, 30);

  const canAutoCapture = isFrontal && isGoodLight && isNotBlurry && isGoodSize && faceCount === 1 && !spoofed;

  return {
    score: Math.min(100, Math.round(score)),
    isFrontal,
    isGoodLight,
    isNotBlurry,
    singleFace: true,
    yaw: Math.round(yaw * 10) / 10,
    pitch: Math.round(pitch * 10) / 10,
    brightness: Math.round(brightness),
    blurScore: Math.round(blurScore),
    faceCount: 1,
    directionHint,
    canAutoCapture,
  };
}

function computeLaplacianVariance(imageData: ImageData): number {
  const { data: d, width: w, height: h } = imageData;
  if (w < 3 || h < 3) return 0;

  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    gray[i] = d[idx] * 0.299 + d[idx + 1] * 0.587 + d[idx + 2] * 0.114;
  }

  let sum = 0;
  let sumSq = 0;
  let count = 0;

  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const lap =
        gray[(y - 1) * w + x] +
        gray[(y + 1) * w + x] +
        gray[y * w + x - 1] +
        gray[y * w + x + 1] -
        4 * gray[y * w + x];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }

  const mean = sum / count;
  const variance = sumSq / count - mean * mean;
  return variance;
}

export function captureFrameCanvas(
  video: HTMLVideoElement,
  maxWidth = 640
): HTMLCanvasElement {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (!sourceWidth || !sourceHeight) {
    throw new Error("Video frame is not ready");
  }

  const scale = Math.min(1, maxWidth / sourceWidth);
  const w = Math.round(sourceWidth * scale);
  const h = Math.round(sourceHeight * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d")!;
  ctx.drawImage(video, 0, 0, w, h);
  return canvas;
}

export async function canvasToJpegBlob(
  canvas: HTMLCanvasElement,
  quality = 0.85
): Promise<Blob> {
  return new Promise<Blob>((resolve) => {
    canvas.toBlob((blob) => resolve(blob!), "image/jpeg", quality);
  });
}

export async function captureFrame(
  video: HTMLVideoElement,
  maxWidth = 640
): Promise<Blob> {
  return canvasToJpegBlob(captureFrameCanvas(video, maxWidth));
}

export async function uploadFacePhoto(
  blob: Blob,
  responseId: string,
  supabaseClient: SupabaseClient
): Promise<string | null> {
  const filename = `face_${responseId}_${Date.now()}.jpg`;
  const { error } = await supabaseClient.storage
    .from("survey-uploads")
    .upload(`faces/${filename}`, blob, { upsert: true, contentType: "image/jpeg" });
  if (error) {
    console.error("Face photo upload failed:", error);
    return null;
  }
  const { data } = supabaseClient.storage.from("survey-uploads").getPublicUrl(`faces/${filename}`);
  return data.publicUrl;
}

export async function saveFaceRegistration(
  supabaseClient: SupabaseClient,
  data: {
    response_id: string;
    survey_id: string;
    photo_url: string;
    embedding: number[];
  }
): Promise<boolean> {
  const { error } = await supabaseClient.from("face_registrations").upsert({
    response_id: data.response_id,
    survey_id: data.survey_id,
    photo_url: data.photo_url,
    embedding: data.embedding,
  }, { onConflict: "response_id" });
  if (error) {
    console.error("Face registration save failed:", error);
    return false;
  }
  return true;
}

// Resolve the best display name from a survey response, using the survey's
// question definitions to find the answer that holds the guest's name.
function resolveGuestName(
  answers: Record<string, unknown> | null | undefined,
  nameQuestionIds: string[]
): string {
  if (!answers) return "";

  // 1. Prefer answers to questions explicitly identified as a "name" field.
  for (const qid of nameQuestionIds) {
    const s = String(answers[qid] ?? "").trim();
    if (s.length > 1 && s.length < 60 && !/[@\d]/.test(s)) return s;
  }

  // 2. Fallback: first plausible free-text answer (not email / phone / numeric).
  for (const val of Object.values(answers)) {
    const s = String(val ?? "").trim();
    if (s.length > 1 && s.length < 50 && !/[@\d]/.test(s)) return s;
  }

  return "";
}

// From the survey's questions, return the ids of text questions that most
// likely hold the guest's name, ordered best-first.
function pickNameQuestionIds(
  questions: { id: string; type: string; text: string; position: number; is_hall_selector?: boolean }[]
): string[] {
  const NAME_KEYWORDS = ["họ và tên", "họ tên", "ho ten", "fullname", "full name", "tên của", "tên đại biểu", "tên khách", "your name", "tên"];
  const EXCLUDE_KEYWORDS = ["công ty", "đơn vị", "tổ chức", "cơ quan", "company", "sản phẩm", "địa chỉ", "chức"];

  const textQuestions = questions
    .filter((q) => q.type === "text" && !q.is_hall_selector)
    .sort((a, b) => a.position - b.position);

  const scored = textQuestions
    .map((q) => {
      const label = (q.text ?? "").toLowerCase();
      if (EXCLUDE_KEYWORDS.some((k) => label.includes(k))) return { id: q.id, score: -1, position: q.position };
      const kwIndex = NAME_KEYWORDS.findIndex((k) => label.includes(k));
      const score = kwIndex >= 0 ? NAME_KEYWORDS.length - kwIndex : 0;
      return { id: q.id, score, position: q.position };
    })
    .filter((q) => q.score >= 0)
    .sort((a, b) => b.score - a.score || a.position - b.position);

  return scored.map((q) => q.id);
}

export async function findFaceMatch(
  supabaseClient: SupabaseClient,
  surveyId: string,
  liveDescriptor: Float32Array,
  threshold = 0.5
): Promise<{ response_id: string; similarity: number; display_name: string } | null> {
  const [{ data: registrations }, { data: questions }] = await Promise.all([
    supabaseClient
      .from("face_registrations")
      .select("response_id, embedding, survey_responses(answers)")
      .eq("survey_id", surveyId),
    supabaseClient
      .from("survey_questions")
      .select("id, type, text, position, is_hall_selector")
      .eq("survey_id", surveyId),
  ]);

  if (!registrations || registrations.length === 0) return null;

  const nameQuestionIds = pickNameQuestionIds(questions ?? []);

  let bestMatch: { response_id: string; similarity: number; display_name: string } | null = null;
  let bestDistance = Infinity;

  for (const reg of registrations) {
    if (!reg.embedding || reg.embedding.length === 0) continue;
    const storedDescriptor = new Float32Array(reg.embedding);
    // Skip embeddings from a different model (e.g. old 128-d face-api data).
    if (storedDescriptor.length !== liveDescriptor.length) continue;
    const distance = compareFaces(liveDescriptor, storedDescriptor);
    const similarity = 1 - Math.min(distance, 1);

    if (distance < bestDistance && distance < threshold) {
      bestDistance = distance;
      const resp = reg.survey_responses as unknown as { answers: Record<string, unknown> } | null;
      const displayName = resolveGuestName(resp?.answers, nameQuestionIds);
      bestMatch = {
        response_id: reg.response_id,
        similarity: Math.round(similarity * 100),
        display_name: displayName || "VIP",
      };
    }
  }

  return bestMatch;
}
