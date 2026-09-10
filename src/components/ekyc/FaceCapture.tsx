"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, RotateCcw, Check, X, Loader2 } from "lucide-react";
import { assessFaceQuality, canvasToJpegBlob, captureFrameCanvas, extractFaceDescriptor, loadFaceModels } from "@/lib/ekyc";
import { useEkycStore } from "@/lib/ekyc-store";

interface FaceCaptureProps {
  surveyId: string;
  logoUrl?: string | null;
  onConfirm: (blob: Blob, descriptor: Float32Array | null) => Promise<void>;
  onCancel: () => void;
  onSkip?: () => void;
}

const AUTO_CAPTURE_THRESHOLD = 55;
const AUTO_CAPTURE_FRAMES = 5;
const LOW_QUALITY_TIMEOUT = 15000;

export function FaceCapture({ logoUrl, onConfirm, onCancel, onSkip }: FaceCaptureProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const countdownRef = useRef<number | null>(null);
  const startAutoCaptureRef = useRef<() => void>(() => {});
  const goodFramesRef = useRef(0);
  const startTimeRef = useRef<number>(0);
  const manualCaptureRef = useRef(false);
  const capturedUrlRef = useRef<string | null>(null);

  const { step, qualityScore, directionHint, capturedUrl, setStep, setQuality, setCaptured, reset } = useEkycStore();
  const [modelsReady, setModelsReady] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [countdownActive, setCountdownActive] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [lowQualityMode, setLowQualityMode] = useState(false);
  const [capturing, setCapturing] = useState(false);

  useEffect(() => {
    capturedUrlRef.current = capturedUrl;
  }, [capturedUrl]);

  useEffect(() => {
    let mounted = true;
    loadFaceModels()
      .then(() => {
        if (mounted) setModelsReady(true);
      })
      .catch(() => {
        if (mounted) {
          useEkycStore.setState({
            step: "error",
            errorMsg: "Không thể tải bộ nhận diện khuôn mặt. Vui lòng tải lại trang và thử lại.",
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    if (countdownRef.current) window.clearTimeout(countdownRef.current);
    animFrameRef.current = 0;
    countdownRef.current = null;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const waitForVideoElement = async () => {
    for (let i = 0; i < 20; i++) {
      if (videoRef.current) return videoRef.current;
      await new Promise((resolve) => window.setTimeout(resolve, 50));
    }
    throw new Error("Video element is not ready");
  };

  const startCamera = useCallback(async () => {
    stopCamera();
    setStep("camera");
    setLowQualityMode(false);
    setCapturing(false);
    setCountdown(null);
    setCountdownActive(false);
    setQuality(0, "Đang mở camera...");
    startTimeRef.current = Date.now();
    manualCaptureRef.current = false;
    goodFramesRef.current = 0;

    try {
      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error("Camera API is not available");
      }

      const attempts: MediaStreamConstraints[] = [
        { video: { facingMode: "user", width: { ideal: 720 }, height: { ideal: 960 } }, audio: false },
        { video: { facingMode: "user" }, audio: false },
        { video: true, audio: false },
      ];

      let stream: MediaStream | null = null;
      let lastError: unknown = null;
      for (const constraints of attempts) {
        try {
          stream = await navigator.mediaDevices.getUserMedia(constraints);
          break;
        } catch (error) {
          lastError = error;
        }
      }

      if (!stream) {
        throw lastError instanceof Error ? lastError : new Error("Cannot access camera");
      }

      const video = await waitForVideoElement();
      streamRef.current = stream;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
    } catch (error) {
      stopCamera();
      setCapturing(false);
      const name = error instanceof DOMException ? error.name : "";
      useEkycStore.setState({
        step: "error",
        errorMsg:
          name === "NotAllowedError"
            ? "Bạn chưa cấp quyền camera. Hãy cho phép camera trong trình duyệt rồi thử lại."
            : name === "NotFoundError"
              ? "Không tìm thấy camera trên thiết bị này."
              : "Không thể truy cập camera. Hãy thử đổi trình duyệt hoặc kiểm tra quyền camera.",
      });
    }
  }, [setQuality, setStep, stopCamera]);

  useEffect(() => {
    if (step === "camera" && modelsReady && videoRef.current) {
      const loop = async () => {
        if (!videoRef.current || videoRef.current.readyState < 2) {
          animFrameRef.current = requestAnimationFrame(loop);
          return;
        }
        if (manualCaptureRef.current) return;

        try {
          const report = await assessFaceQuality(videoRef.current);
          setQuality(report.score, report.directionHint);
          drawOverlay(report);

          if (report.canAutoCapture) {
            goodFramesRef.current++;
            if (goodFramesRef.current >= AUTO_CAPTURE_FRAMES && !countdownActive && !capturing) {
              startAutoCaptureRef.current();
            }
          } else {
            goodFramesRef.current = Math.max(0, goodFramesRef.current - 1);
            if (countdownActive) {
              setCountdownActive(false);
              setCountdown(null);
              if (countdownRef.current) clearTimeout(countdownRef.current);
            }
          }

          if (!lowQualityMode && Date.now() - startTimeRef.current > LOW_QUALITY_TIMEOUT && report.score < AUTO_CAPTURE_THRESHOLD) {
            setLowQualityMode(true);
          }
        } catch {
          setQuality(0, "Đang chuẩn bị nhận diện...");
        }

        animFrameRef.current = requestAnimationFrame(loop);
      };

      animFrameRef.current = requestAnimationFrame(loop);
    }

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    };
  }, [step, modelsReady, countdownActive, lowQualityMode, capturing, setQuality]);

  function startAutoCapture() {
    if (capturing || countdownActive) return;
    setCountdownActive(true);
    setCountdown(3);
    let c = 3;
    const tick = () => {
      c--;
      if (c <= 0) {
        setCountdown(null);
        setCountdownActive(false);
        void doCapture();
        return;
      }
      setCountdown(c);
      countdownRef.current = window.setTimeout(tick, 1000);
    };
    countdownRef.current = window.setTimeout(tick, 1000);
  }
  startAutoCaptureRef.current = startAutoCapture;

  async function doCapture() {
    if (!videoRef.current || capturing) return;
    manualCaptureRef.current = true;
    setCapturing(true);
    setQuality(qualityScore, "Đang chụp ảnh...");
    if (countdownRef.current) window.clearTimeout(countdownRef.current);
    setCountdown(null);
    setCountdownActive(false);

    try {
      const frame = captureFrameCanvas(videoRef.current, 640);
      const blob = await canvasToJpegBlob(frame);
      const descriptor = modelsReady ? await extractFaceDescriptor(frame).catch(() => null) : null;
      const url = URL.createObjectURL(blob);
      capturedUrlRef.current = url;
      stopCamera();
      setCaptured(blob, url, descriptor);
    } catch {
      stopCamera();
      useEkycStore.setState({
        step: "error",
        errorMsg: "Lỗi khi chụp ảnh. Hãy giữ điện thoại ổn định và thử lại.",
      });
    } finally {
      setCapturing(false);
    }
  }

  function handleManualCapture() {
    if (!videoRef.current || capturing) return;
    void doCapture();
  }

  function drawOverlay(report: { score: number; canAutoCapture?: boolean }) {
    const overlay = overlayCanvasRef.current;
    if (!overlay) return;

    const rect = overlay.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const displayWidth = Math.max(1, rect.width);
    const displayHeight = Math.max(1, rect.height);
    overlay.width = Math.round(displayWidth * dpr);
    overlay.height = Math.round(displayHeight * dpr);

    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, overlay.width, overlay.height);
    ctx.scale(dpr, dpr);

    const centerX = displayWidth / 2;
    const centerY = displayHeight * 0.42;
    const rx = Math.min(displayWidth * 0.34, displayHeight * 0.22);
    const ry = Math.min(displayHeight * 0.27, rx * 1.42);
    const color = report.score >= 55 ? "#22c55e" : report.score >= 30 ? "#eab308" : "#ef4444";

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash(report.score >= 55 ? [] : [8, 4]);
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (report.score >= 55) {
      ctx.fillStyle = "rgba(34, 197, 94, 0.06)";
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const handleConfirm = async () => {
    const { capturedBlob, faceDescriptor } = useEkycStore.getState();
    if (!capturedBlob || uploading) return;
    setUploading(true);
    try {
      await onConfirm(capturedBlob, faceDescriptor);
    } finally {
      setUploading(false);
    }
  };

  const handleRetake = () => {
    URL.revokeObjectURL(capturedUrlRef.current ?? "");
    capturedUrlRef.current = null;
    manualCaptureRef.current = false;
    useEkycStore.setState({ capturedBlob: null, capturedUrl: null, faceDescriptor: null, qualityScore: 0 });
    void startCamera();
  };

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void startCamera();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      stopCamera();
      URL.revokeObjectURL(capturedUrlRef.current ?? "");
    };
  }, [startCamera, stopCamera]);

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
      {step === "camera" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="relative w-full h-full flex flex-col">
          <div className="absolute top-4 left-4 right-4 z-10 flex items-center justify-between">
            <button onClick={() => { stopCamera(); reset(); onCancel(); }}
              className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-on-brand">
              <X size={20} />
            </button>
            {logoUrl && <img src={logoUrl} alt="" className="h-8 object-contain" />}
          </div>

          <div className="flex-1 relative overflow-hidden bg-black">
            <video ref={videoRef} className="w-full h-full object-cover" playsInline muted
              style={{ transform: "scaleX(-1)" }} />
            <canvas ref={overlayCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none"
              style={{ transform: "scaleX(-1)" }} />

            <div className="absolute inset-0 pointer-events-none" style={{
              background: "radial-gradient(ellipse 34% 28% at 50% 42%, transparent 0%, transparent 58%, rgba(0,0,0,0.72) 100%)",
            }} />

            {capturing && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/45 backdrop-blur-sm text-on-brand"
              >
                <Loader2 size={34} className="animate-spin mb-3" />
                <p className="text-base font-semibold">Đang chụp ảnh...</p>
                <p className="text-xs text-white/70 mt-1">Giữ điện thoại ổn định trong giây lát</p>
              </motion.div>
            )}
          </div>

          <div className="absolute bottom-0 left-0 right-0 p-4 pb-6"
            style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.95))" }}>
            <AnimatePresence>
              {capturing ? (
                <motion.div key="capturing" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute bottom-36 left-1/2 -translate-x-1/2 text-white/90 text-base font-semibold">
                  Đang xử lý ảnh...
                </motion.div>
              ) : countdown !== null && countdown > 0 ? (
                <motion.div key="countdown" initial={{ scale: 0.5, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}
                  exit={{ scale: 1.5, opacity: 0 }}
                  className="absolute bottom-36 left-1/2 -translate-x-1/2">
                  <div className="w-24 h-24 rounded-full bg-white/20 backdrop-blur-lg flex items-center justify-center">
                    <span className="text-5xl font-bold text-on-brand">{countdown}</span>
                  </div>
                </motion.div>
              ) : countdownActive ? (
                <motion.div key="hold" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                  className="absolute bottom-36 left-1/2 -translate-x-1/2 text-white/80 text-base font-medium">
                  Giữ nguyên vị trí...
                </motion.div>
              ) : null}
            </AnimatePresence>

            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-2">
                <Camera size={16} className="text-white/60" />
                <span className="text-white/60 text-xs">eKYC</span>
              </div>
              <span className={`text-xs font-bold ${qualityScore >= 55 ? "text-green-400" : qualityScore >= 30 ? "text-yellow-400" : "text-red-400"}`}>
                {qualityScore}/100
              </span>
            </div>

            <div className="h-1.5 rounded-full bg-white/10 overflow-hidden mb-3">
              <motion.div className="h-full rounded-full"
                animate={{ width: `${qualityScore}%`, backgroundColor: qualityScore >= 55 ? "#22c55e" : qualityScore >= 30 ? "#eab308" : "#ef4444" }}
                transition={{ duration: 0.3 }} />
            </div>

            {directionHint && (
              <motion.div key={directionHint} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}
                className="text-center text-sm font-medium py-2 px-3 rounded-xl bg-white/10 backdrop-blur text-on-brand mb-3">
                {directionHint}
              </motion.div>
            )}

            {lowQualityMode && !countdownActive && !capturing && (
              <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                className="text-center text-xs py-2 px-3 rounded-xl bg-amber-500/20 text-yellow-200 mb-3">
                Khuôn mặt khó nhận diện tự động. Bấm &quot;Chụp ngay&quot; hoặc Trở về để dùng QR.
              </motion.div>
            )}

            <div className="flex gap-3">
              <button onClick={handleManualCapture} disabled={capturing}
                className="flex-1 py-3 rounded-xl bg-white font-bold text-slate-900 flex items-center justify-center gap-2 hover:bg-white/90 transition-colors disabled:opacity-70 disabled:cursor-not-allowed">
                {capturing ? <Loader2 size={18} className="animate-spin" /> : <Camera size={18} />}
                {capturing ? "Đang chụp..." : "Chụp ngay"}
              </button>
              {onSkip && (
                <button onClick={onSkip}
                  className="px-4 py-3 rounded-xl bg-white/10 text-on-brand font-medium hover:bg-white/20 transition-colors text-sm">
                  Trở về
                </button>
              )}
            </div>
          </div>
        </motion.div>
      )}

      {step === "preview" && capturedUrl && (
        <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
          className="w-full max-w-md mx-auto p-6 flex flex-col items-center gap-6">
          <h2 className="text-on-brand text-xl font-bold">Xác nhận ảnh chân dung</h2>
          <div className="relative w-64 h-80 rounded-2xl overflow-hidden border-2 border-white/20">
            <img src={capturedUrl} alt="Portrait" className="w-full h-full object-cover" />
            <div className="absolute bottom-2 right-2 px-2 py-1 rounded-lg bg-black/60 backdrop-blur text-xs">
              <span className={`font-bold ${qualityScore >= 55 ? "text-green-400" : "text-yellow-400"}`}>
                {qualityScore}/100
              </span>
            </div>
          </div>
          <div className="flex gap-4 w-full">
            <button onClick={handleRetake}
              className="flex-1 py-3 rounded-xl bg-white/10 text-on-brand font-medium flex items-center justify-center gap-2 hover:bg-white/20 transition-colors">
              <RotateCcw size={18} /> Chụp lại
            </button>
            <button onClick={handleConfirm} disabled={uploading}
              className="flex-1 py-3 rounded-xl bg-sky-600 text-on-brand font-bold flex items-center justify-center gap-2 hover:bg-sky-500 transition-colors disabled:opacity-50">
              {uploading ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
              {uploading ? "Đang xử lý..." : "Xác nhận"}
            </button>
          </div>
        </motion.div>
      )}

      {step === "error" && (
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }}
          className="w-full max-w-md mx-auto p-6 flex flex-col items-center gap-4">
          <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
            <X size={32} className="text-red-400" />
          </div>
          <h2 className="text-on-brand text-xl font-bold">Không mở được camera</h2>
          <p className="text-white/60 text-sm text-center">{useEkycStore.getState().errorMsg || "Không thể khởi tạo camera"}</p>
          <div className="flex gap-3">
            <button onClick={() => { reset(); void startCamera(); }}
              className="px-6 py-3 rounded-xl bg-white/10 text-on-brand font-medium hover:bg-white/20 transition-colors">
              Thử lại
            </button>
            {onSkip && (
              <button onClick={onSkip}
                className="px-6 py-3 rounded-xl bg-amber-600/80 text-on-brand font-medium hover:bg-amber-600 transition-colors">
                Trở về
              </button>
            )}
          </div>
        </motion.div>
      )}
    </div>
  );
}
