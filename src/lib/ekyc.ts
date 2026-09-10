import * as faceapi from "@vladmandic/face-api";
import type { SupabaseClient } from "@supabase/supabase-js";

const MODEL_URL = "/models";

let modelsLoaded = false;
let loadingPromise: Promise<void> | null = null;

export async function loadFaceModels(): Promise<void> {
  if (modelsLoaded) return;
  if (loadingPromise) return loadingPromise;

  loadingPromise = (async () => {
    await Promise.all([
      faceapi.nets.ssdMobilenetv1.loadFromUri(MODEL_URL),
      faceapi.nets.faceLandmark68Net.loadFromUri(MODEL_URL),
      faceapi.nets.faceRecognitionNet.loadFromUri(MODEL_URL),
    ]);
    modelsLoaded = true;
  })();

  return loadingPromise;
}

export async function extractFaceDescriptor(
  input: HTMLVideoElement | HTMLCanvasElement | HTMLImageElement
): Promise<Float32Array | null> {
  await loadFaceModels();
  const detection = await faceapi
    .detectSingleFace(input, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.5 }))
    .withFaceLandmarks()
    .withFaceDescriptor();

  return detection?.descriptor ?? null;
}

export function compareFaces(
  descriptor1: Float32Array,
  descriptor2: Float32Array
): number {
  return faceapi.euclideanDistance(descriptor1, descriptor2);
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

  await loadFaceModels();

  const canvas = document.createElement("canvas");
  canvas.width = input instanceof HTMLVideoElement ? input.videoWidth : input.width;
  canvas.height = input instanceof HTMLVideoElement ? input.videoHeight : input.height;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return defaultReport;
  ctx.drawImage(input, 0, 0, canvas.width, canvas.height);

  const allDetections = await faceapi
    .detectAllFaces(canvas, new faceapi.SsdMobilenetv1Options({ minConfidence: 0.3 }))
    .withFaceLandmarks();

  const faceCount = allDetections.length;
  if (faceCount === 0) return defaultReport;

  if (faceCount > 1) {
    return {
      ...defaultReport,
      faceCount,
      singleFace: false,
      directionHint: "Phát hiện nhiều khuôn mặt. Chỉ giữ 1 người trong khung.",
    };
  }

  const det = allDetections[0];
  const landmarks = det.landmarks;
  const leftEye = landmarks.getLeftEye();
  const rightEye = landmarks.getRightEye();
  const nose = landmarks.getNose();
  const jaw = landmarks.getJawOutline();

  const leftEyeCenter = center(leftEye);
  const rightEyeCenter = center(rightEye);
  const noseTip = center(nose.slice(Math.max(0, nose.length - 4)));
  const jawBottom = jaw.length > 0 ? jaw[Math.floor(jaw.length * 0.97)] : noseTip;

  const eyeCenterX = (leftEyeCenter.x + rightEyeCenter.x) / 2;
  const eyeCenterY = (leftEyeCenter.y + rightEyeCenter.y) / 2;

  const dx = noseTip.x - eyeCenterX;
  const dy = noseTip.y - eyeCenterY;
  const eyeDistance = Math.sqrt(
    (rightEyeCenter.x - leftEyeCenter.x) ** 2 +
    (rightEyeCenter.y - leftEyeCenter.y) ** 2
  );

  const yaw = (dx / eyeDistance) * 100;
  const rawPitch = (dy / eyeDistance) * 100;
  const faceBox = det.detection.box;
  const faceCenterYRatio = (faceBox.y + faceBox.height / 2) / canvas.height;
  // Top-down camera often makes pitch look negative when user is centered well
  const pitch = rawPitch + (faceCenterYRatio > 0.45 ? -8 : 0);

  const isFrontal = Math.abs(yaw) < 25 && Math.abs(pitch) < 28;

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const { data: pixels } = imageData;
  let totalBrightness = 0;
  let pixelCount = 0;
  const { x: fx, y: fy, width: fw, height: fh } = faceBox;
  for (let y = Math.floor(fy); y < Math.floor(fy + fh); y++) {
    for (let x = Math.floor(fx); x < Math.floor(fx + fw); x++) {
      const idx = (y * canvas.width + x) * 4;
      totalBrightness += pixels[idx] * 0.299 + pixels[idx + 1] * 0.587 + pixels[idx + 2] * 0.114;
      pixelCount++;
    }
  }
  const brightness = pixelCount > 0 ? totalBrightness / pixelCount : 0;
  const isGoodLight = brightness > 35 && brightness < 230;

  let blurScore = 0;
  const faceRegion = ctx.getImageData(
    Math.floor(fx),
    Math.floor(fy),
    Math.min(Math.floor(fw), canvas.width - Math.floor(fx)),
    Math.min(Math.floor(fh), canvas.height - Math.floor(fy))
  );
  blurScore = computeLaplacianVariance(faceRegion);
  const isNotBlurry = blurScore > 10;

  // Face size ratio (how large face is in frame)
  const faceAreaRatio = (faceBox.width * faceBox.height) / (canvas.width * canvas.height);
  const isGoodSize = faceAreaRatio > 0.06 && faceAreaRatio < 0.6;

  let directionHint = "";
  if (faceCount > 1) {
    directionHint = "Phát hiện nhiều khuôn mặt. Chỉ giữ 1 người trong khung.";
  } else if (Math.abs(yaw) > 25) {
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

  const canAutoCapture = isFrontal && isGoodLight && isNotBlurry && isGoodSize && faceCount === 1;

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

function center(points: { x: number; y: number }[]): { x: number; y: number } {
  const sx = points.reduce((s, p) => s + p.x, 0);
  const sy = points.reduce((s, p) => s + p.y, 0);
  return { x: sx / points.length, y: sy / points.length };
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
  threshold = 0.8
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
