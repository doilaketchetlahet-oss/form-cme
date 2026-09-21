"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ShieldCheck, AlertTriangle, Loader2, RefreshCw, X } from "lucide-react";
import { extractFaceDescriptor, loadFaceModels, assessFaceQuality, findFaceMatch, FACE_MATCH_MIN_SIMILARITY } from "@/lib/ekyc";
import { useVipVerifyStore } from "@/lib/ekyc-store";
import { supabase } from "@/lib/supabase";
import { VipWelcomeScreen } from "./VipWelcomeScreen";

interface VIPFaceCheckinProps {
  surveyId: string;
  hall?: string;
  session?: string;
  onManualConfirm?: (responseId: string) => Promise<void>;
  onClose?: () => void;
}

const VERIFY_THRESHOLD = 65;
const STABLE_FRAMES_REQUIRED = 12;

async function waitForVideoElement(videoRef: React.RefObject<HTMLVideoElement | null>) {
  for (let i = 0; i < 20; i++) {
    if (videoRef.current) return videoRef.current;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
  }
  throw new Error("Video element is not ready");
}

export function VIPFaceCheckin({ surveyId, onManualConfirm, onClose }: VIPFaceCheckinProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const animFrameRef = useRef<number>(0);
  const streamRef = useRef<MediaStream | null>(null);
  const scanAttemptedRef = useRef(false);
  const verifyingRef = useRef(false);
  const mountedRef = useRef(true);

  const { step, matchedName, matchedResponseId, similarity, errorMsg, setStep, setMatch, setError, reset } =
    useVipVerifyStore();
  const [modelsReady, setModelsReady] = useState(false);
  const [qualityScore, setQualityScore] = useState(0);
  const [showWelcome, setShowWelcome] = useState(false);

  useEffect(() => {
    mountedRef.current = true;
    loadFaceModels()
      .then(() => {
        if (mountedRef.current) setModelsReady(true);
      })
      .catch(() => {
        if (mountedRef.current) {
          setError("Không thể tải bộ nhận diện khuôn mặt. Vui lòng tải lại trang và thử lại.");
        }
      });

    return () => {
      mountedRef.current = false;
    };
  }, [setError]);

  const stopCamera = useCallback(() => {
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = 0;
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startCamera = useCallback(async () => {
    stopCamera();
    scanAttemptedRef.current = false;
    verifyingRef.current = false;
    setQualityScore(0);
    setStep("scanning");

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

      const video = await waitForVideoElement(videoRef);
      streamRef.current = stream;
      video.srcObject = stream;
      video.muted = true;
      video.playsInline = true;
      await video.play();
    } catch (error) {
      stopCamera();
      const name = error instanceof DOMException ? error.name : "";
      setError(
        name === "NotAllowedError"
          ? "Bạn chưa cấp quyền camera. Hãy cho phép camera trong trình duyệt rồi thử lại."
          : name === "NotFoundError"
            ? "Không tìm thấy camera trên thiết bị này."
            : "Không thể truy cập camera. Hãy thử đổi trình duyệt hoặc kiểm tra quyền camera.",
      );
    }
  }, [setError, setStep, stopCamera]);

  const drawOverlay = useCallback((report: { score: number }) => {
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
    const centerY = displayHeight * 0.4;
    const rx = Math.min(displayWidth * 0.34, displayHeight * 0.22);
    const ry = Math.min(displayHeight * 0.29, rx * 1.42);
    const color = report.score >= VERIFY_THRESHOLD ? "#22c55e" : report.score >= 35 ? "#eab308" : "#ef4444";

    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.setLineDash(report.score >= VERIFY_THRESHOLD ? [] : [8, 4]);
    ctx.beginPath();
    ctx.ellipse(centerX, centerY, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (report.score >= VERIFY_THRESHOLD) {
      ctx.fillStyle = "rgba(34, 197, 94, 0.06)";
      ctx.beginPath();
      ctx.ellipse(centerX, centerY, rx, ry, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }, []);

  const doVerification = useCallback(async () => {
    if (!videoRef.current || verifyingRef.current) return;
    verifyingRef.current = true;
    scanAttemptedRef.current = true;
    if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
    animFrameRef.current = 0;
    setStep("verifying");

    try {
      const descriptor = await extractFaceDescriptor(videoRef.current);
      stopCamera();

      if (!descriptor) {
        setError("Không phát hiện khuôn mặt. Vui lòng thử lại.");
        return;
      }

      // Only auto-confirm strong matches; weaker ones fall through to review
      // so an operator confirms them manually.
      const match = await findFaceMatch(supabase, surveyId, descriptor);
      if (match) {
        setMatch(match.display_name, match.response_id, match.similarity);
        setStep("verified");
      } else {
        setMatch("", "", 0);
        setStep("review");
      }
    } catch {
      stopCamera();
      setError("Lỗi xác thực khuôn mặt. Vui lòng thử lại.");
    } finally {
      verifyingRef.current = false;
    }
  }, [setError, setMatch, setStep, stopCamera, surveyId]);

  useEffect(() => {
    if (step !== "scanning" || !modelsReady || !videoRef.current) return;

    let stableFrames = 0;
    let cancelled = false;

    const loop = async () => {
      if (cancelled || step !== "scanning" || verifyingRef.current) return;

      if (!videoRef.current || videoRef.current.readyState < 2) {
        animFrameRef.current = requestAnimationFrame(loop);
        return;
      }

      try {
        const report = await assessFaceQuality(videoRef.current);
        setQualityScore(report.score);
        drawOverlay(report);

        if (report.score >= VERIFY_THRESHOLD && report.singleFace) {
          stableFrames += 1;
          if (stableFrames >= STABLE_FRAMES_REQUIRED && !scanAttemptedRef.current) {
            void doVerification();
            return;
          }
        } else {
          stableFrames = Math.max(0, stableFrames - 1);
        }
      } catch {
        setQualityScore(0);
      }

      animFrameRef.current = requestAnimationFrame(loop);
    };

    animFrameRef.current = requestAnimationFrame(loop);
    return () => {
      cancelled = true;
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      animFrameRef.current = 0;
    };
  }, [step, modelsReady, drawOverlay, doVerification]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void startCamera();
    }, 0);

    return () => {
      window.clearTimeout(timer);
      stopCamera();
    };
  }, [startCamera, stopCamera]);

  const handleClose = () => {
    stopCamera();
    reset();
    onClose?.();
  };

  const confirmVIP = async () => {
    stopCamera();
    if (onManualConfirm && matchedResponseId) {
      await onManualConfirm(matchedResponseId);
    }
    setShowWelcome(true);
  };

  const handleManualConfirm = async () => {
    stopCamera();
    if (onManualConfirm && matchedResponseId) {
      await onManualConfirm(matchedResponseId);
    }
    setShowWelcome(true);
  };

  const retryScan = () => {
    reset();
    void startCamera();
  };

  const handleWelcomeComplete = () => {
    setShowWelcome(false);
    reset();
    setQualityScore(0);

    if (onClose) {
      onClose();
      return;
    }

    window.setTimeout(() => {
      void startCamera();
    }, 250);
  };

  if (showWelcome) {
    return <VipWelcomeScreen name={matchedName || "Quý khách"} onComplete={handleWelcomeComplete} />;
  }

  return (
    <div className="fixed inset-0 z-50 bg-black flex flex-col items-center justify-center">
      <AnimatePresence mode="wait">
        {step === "scanning" && (
          <motion.div
            key="scanning"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative w-full h-full flex flex-col"
          >
            <div className="absolute top-4 left-4 z-10">
              <button
                onClick={handleClose}
                className="w-10 h-10 rounded-full bg-black/60 flex items-center justify-center text-on-brand"
                aria-label="Đóng"
              >
                <X size={20} />
              </button>
            </div>

            <div className="absolute top-4 right-4 z-10 flex items-center gap-2 px-3 py-1.5 rounded-full bg-sky-600/80 backdrop-blur">
              <ShieldCheck size={16} className="text-on-brand" />
              <span className="text-on-brand text-sm font-semibold">VIP Check-in</span>
            </div>

            <div className="flex-1 relative overflow-hidden bg-black">
              <video ref={videoRef} className="w-full h-full object-cover" playsInline muted style={{ transform: "scaleX(-1)" }} />
              <canvas
                ref={overlayCanvasRef}
                className="absolute inset-0 w-full h-full pointer-events-none"
                style={{ transform: "scaleX(-1)" }}
              />
              <div
                className="absolute inset-0 pointer-events-none"
                style={{
                  background:
                    "radial-gradient(ellipse 34% 28% at 50% 40%, transparent 0%, transparent 58%, rgba(0,0,0,0.72) 100%)",
                }}
              />
            </div>

            <div
              className="absolute bottom-0 left-0 right-0 p-6 pb-8"
              style={{ background: "linear-gradient(transparent, rgba(0,0,0,0.95))" }}
            >
              <div className="flex items-center gap-3 mb-3">
                <div className="w-10 h-10 rounded-full bg-sky-600/20 flex items-center justify-center">
                  <ShieldCheck size={20} className="text-sky-400" />
                </div>
                <div>
                  <p className="text-on-brand font-bold">Đưa khuôn mặt vào khung</p>
                  <p className="text-white/50 text-sm">Hệ thống sẽ tự động nhận diện</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-2 rounded-full bg-white/10 overflow-hidden">
                  <motion.div className="h-full rounded-full bg-sky-500" animate={{ width: `${qualityScore}%` }} transition={{ duration: 0.3 }} />
                </div>
                <span className="text-white/60 text-xs font-mono w-10 text-right">{qualityScore}%</span>
              </div>
            </div>
          </motion.div>
        )}

        {step === "verifying" && (
          <motion.div
            key="verifying"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-6 px-6"
          >
            <div className="relative w-32 h-32">
              <motion.div
                className="absolute inset-0 rounded-full border-4 border-sky-500/30"
                animate={{ rotate: 360 }}
                transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
              />
              <div className="absolute inset-3 rounded-full bg-sky-600/10 flex items-center justify-center">
                <Loader2 size={40} className="text-sky-400 animate-spin" />
              </div>
            </div>
            <div className="text-center">
              <p className="text-on-brand text-xl font-bold">Đang xác thực...</p>
              <p className="text-white/50 text-sm mt-1">So khớp khuôn mặt với dữ liệu đăng ký</p>
            </div>
          </motion.div>
        )}

        {step === "verified" && (
          <motion.div
            key="verified"
            initial={{ opacity: 0, scale: 0.9 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0 }}
            className="flex flex-col items-center gap-6 p-6"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 12 }}
              className="w-24 h-24 rounded-full bg-sky-500/20 flex items-center justify-center"
            >
              <ShieldCheck size={56} className="text-sky-400" />
            </motion.div>
            <div className="text-center">
              <motion.p
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.2 }}
                className="text-sky-400 font-semibold text-sm uppercase tracking-wider"
              >
                Đã xác thực
              </motion.p>
              <motion.h2
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.3 }}
                className="text-on-brand text-3xl font-bold mt-2"
              >
                {matchedName || "Khách mời"}
              </motion.h2>
              <motion.div
                initial={{ y: 20, opacity: 0 }}
                animate={{ y: 0, opacity: 1 }}
                transition={{ delay: 0.4 }}
                className="mt-3 flex items-center justify-center gap-2"
              >
                <span className="px-3 py-1 rounded-full bg-sky-500/20 text-sky-400 text-sm font-medium">
                  Độ khớp: {similarity}%
                </span>
              </motion.div>
            </div>
            <button
              onClick={confirmVIP}
              className="w-full max-w-xs py-4 rounded-2xl bg-sky-600 text-on-brand font-bold text-lg hover:bg-sky-500 transition-colors"
            >
              Tiếp tục check-in
            </button>
          </motion.div>
        )}

        {step === "review" && (
          <motion.div key="review" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center gap-6 p-6">
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 12 }}
              className="w-24 h-24 rounded-full bg-amber-500/20 flex items-center justify-center"
            >
              <AlertTriangle size={56} className="text-amber-400" />
            </motion.div>
            <div className="text-center">
              <p className="text-amber-400 font-semibold text-sm uppercase tracking-wider">Cần kiểm tra</p>
              <h2 className="text-on-brand text-2xl font-bold mt-2">Cần xác nhận thủ công</h2>
              <p className="text-white/50 text-sm mt-2">
                Không có kết quả khớp đủ {Math.round(FACE_MATCH_MIN_SIMILARITY * 100)}%. Lễ tân có thể thử quét lại hoặc xác nhận thủ công.
              </p>
            </div>
            <div className="w-full max-w-xs flex flex-col gap-3">
              <button onClick={handleManualConfirm} className="w-full py-3 rounded-xl bg-sky-600 text-on-brand font-bold hover:bg-sky-500 transition-colors">
                Xác nhận thủ công
              </button>
              <button
                onClick={retryScan}
                className="w-full py-3 rounded-xl bg-white/10 text-on-brand font-medium flex items-center justify-center gap-2 hover:bg-white/20 transition-colors"
              >
                <RefreshCw size={18} /> Thử lại
              </button>
              <button onClick={handleClose} className="w-full py-3 rounded-xl text-white/50 font-medium hover:text-white/90 transition-colors">
                Đóng
              </button>
            </div>
          </motion.div>
        )}

        {step === "error" && (
          <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="flex flex-col items-center gap-4 p-6">
            <div className="w-16 h-16 rounded-full bg-red-500/20 flex items-center justify-center">
              <X size={32} className="text-red-400" />
            </div>
            <p className="text-on-brand text-lg font-semibold">Lỗi xác thực</p>
            <p className="text-white/50 text-sm text-center">{errorMsg || "Không thể khởi tạo camera"}</p>
            <div className="flex gap-3">
              <button onClick={retryScan} className="px-6 py-3 rounded-xl bg-white/10 text-on-brand font-medium hover:bg-white/20 transition-colors">
                Thử lại
              </button>
              <button onClick={handleClose} className="px-6 py-3 rounded-xl bg-red-600/80 text-on-brand font-medium hover:bg-red-600 transition-colors">
                Đóng
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
