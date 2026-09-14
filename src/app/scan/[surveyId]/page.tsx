"use client";
import { useEffect, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, UserCheck, SwitchCamera, AlertTriangle } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PinGate } from "@/components/ui/PinGate";
import { CheckinThemeLayer } from "@/components/ui/CheckinThemeLayer";
import type { CheckinTheme } from "@/lib/surveys";
import { logCheckinEvent } from "@/lib/checkinLogs";
import jsQR from "jsqr";

function getInitialScanQuery() {
  if (typeof window === "undefined") return { hall: "", session: "" };
  const url = new URL(window.location.href);
  return {
    hall: url.searchParams.get("hall") ?? "",
    session: url.searchParams.get("session") ?? "",
  };
}

interface PendingCheckin {
  responseId: string;
  name: string;
  answers: { label: string; value: string }[];
  alreadyCheckedIn: boolean;
  wrongHall?: string | null;
  notCheckedInGeneral?: boolean;
}

function isPaymentSettled(status: unknown) {
  return !status || status === "not_required" || status === "paid";
}

interface ScanResult {
  type: "success" | "error" | "already" | "wrong_hall";
  message: string;
  name?: string;
}

// Beep sound
function playBeep(success: boolean) {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = success ? 800 : 300;
    gain.gain.value = 0.3;
    osc.start();
    osc.stop(ctx.currentTime + (success ? 0.15 : 0.3));
  } catch { /* no audio */ }
}

export default function ScanPage({ params }: { params: Promise<{ surveyId: string }> }) {
  const [sid, setSid] = useState("");
  useEffect(() => { params.then(({ surveyId }) => setSid(surveyId)); }, [params]);
  if (!sid) return <div className="min-h-dvh bg-sky-50" />;
  return <PinGate surveyId={sid}><ScanInner surveyId={sid} /></PinGate>;
}

function ScanInner({ surveyId }: { surveyId: string }) {
  const initialQuery = getInitialScanQuery();
  const [surveyTitle, setSurveyTitle] = useState("");
  const [questionLabels, setQuestionLabels] = useState<Record<string, string>>({});
  const [questionOrder, setQuestionOrder] = useState<string[]>([]);
  const labelsRef = useRef<Record<string, string>>({});
  const orderRef = useRef<string[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [pending, setPending] = useState<PendingCheckin | null>(null);
  const [checkedCount, setCheckedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [hall, setHall] = useState<string>(initialQuery.hall); // current hall filter
  const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
  const [welcome, setWelcome] = useState<{ name: string; hall: string } | null>(null);
  const [session, setSession] = useState<string>(initialQuery.session);
  const [theme, setTheme] = useState<CheckinTheme | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const scanningRef = useRef(false);
  const lastScannedRef = useRef("");
  const surveyIdRef = useRef(surveyId);
  const hallRef = useRef(initialQuery.hall);
  const sessionRef = useRef(initialQuery.session);
  const busyRef = useRef(false); // true while modal/welcome is showing — blocks scanning

  useEffect(() => { hallRef.current = hall; }, [hall]);
  useEffect(() => { sessionRef.current = session; }, [session]);
  useEffect(() => { busyRef.current = !!pending || !!welcome; }, [pending, welcome]);

  useEffect(() => {
    const id = surveyId;
    if (!id) return;
    surveyIdRef.current = id;
    Promise.all([
      supabase.from("surveys").select("title, checkin_theme").eq("id", id).single(),
      supabase.from("survey_questions").select("id, text, position").eq("survey_id", id).order("position"),
    ]).then(([{ data: survey }, { data: questions }]) => {
      setSurveyTitle(survey?.title ?? "");
      setTheme((survey?.checkin_theme as CheckinTheme) ?? null);
      const labels: Record<string, string> = {};
      const order: string[] = [];
      (questions ?? []).forEach((q: { id: string; text: string }) => { labels[q.id] = q.text; order.push(q.id); });
      setQuestionLabels(labels);
      setQuestionOrder(order);
      labelsRef.current = labels;
      orderRef.current = order;
    });
  }, [surveyId]);

  // Realtime counter
  useEffect(() => {
    if (!surveyId) return;
    const fetchCount = async () => {
      const totalQ = supabase.from("survey_responses").select("*", { count: "exact", head: true }).eq("survey_id", surveyId);
      if (hall) totalQ.eq("hall", hall);

      if (session) {
        // Session mode: count rows where session_checkins has this session key
        const [{ count: total }, { data: rows }] = await Promise.all([
          totalQ,
          supabase.from("survey_responses").select("session_checkins").eq("survey_id", surveyId),
        ]);
        const checked = (rows ?? []).filter((r) => {
          const sc = r.session_checkins as Record<string, string> | null;
          return sc && sc[session];
        }).length;
        setTotalCount(total ?? 0);
        setCheckedCount(checked);
      } else {
        const checkedQ = supabase.from("survey_responses").select("*", { count: "exact", head: true }).eq("survey_id", surveyId).eq("checked_in", true);
        if (hall) checkedQ.eq("hall", hall);
        const [{ count: total }, { count: checked }] = await Promise.all([totalQ, checkedQ]);
        setTotalCount(total ?? 0);
        setCheckedCount(checked ?? 0);
      }
    };
    fetchCount();
    const interval = setInterval(fetchCount, 5000);
    return () => clearInterval(interval);
  }, [surveyId, hall, session]);

  const getFirstTextField = (answers: Record<string, unknown>): string => {
    for (const k of orderRef.current) {
      const v = answers[k];
      if (typeof v === "string" && v.length > 1 && v.length < 50 && !/^https?:/.test(v) && !/^\d+$/.test(v)) return v;
    }
    return "";
  };

  const handleScan = async (responseId: string) => {
    const sid = surveyIdRef.current;
    const { data: resp } = await supabase
      .from("survey_responses")
      .select("id, survey_id, answers, checked_in, hall, session_checkins, payment_status")
      .eq("id", responseId)
      .single();

    if (!resp) {
      playBeep(false);
      setScanResult({ type: "error", message: "Mã không hợp lệ — không tìm thấy" });
      return;
    }
    if (resp.survey_id !== sid) {
      playBeep(false);
      setScanResult({ type: "error", message: "Mã thuộc khảo sát khác!" });
      return;
    }
    if (!isPaymentSettled(resp.payment_status)) {
      playBeep(false);
      setScanResult({ type: "error", message: "Đăng ký này chưa hoàn tất thanh toán" });
      return;
    }

    const name = getFirstTextField(resp.answers as Record<string, unknown>) || resp.id.slice(0, 8).toUpperCase();

    // Build answers
    const answersArr: { label: string; value: string }[] = [];
    const ansMap = resp.answers as Record<string, unknown>;
    const keys = orderRef.current.length > 0 ? orderRef.current.filter((k) => k in ansMap) : Object.keys(ansMap);
    keys.forEach((k) => {
      const v = ansMap[k];
      if (typeof v === "string" && !v.startsWith("http")) {
        answersArr.push({ label: labelsRef.current[k] || k, value: v });
      }
    });

    const currentHall = hallRef.current;
    const currentSession = sessionRef.current;

    // Check hall mismatch (applies in both modes)
    if (currentHall && resp.hall && resp.hall !== currentHall) {
      playBeep(false);
      setPending({ responseId, name, answers: answersArr, alreadyCheckedIn: false, wrongHall: resp.hall });
      return;
    }

    // SESSION MODE: check session_checkins[currentSession]
    if (currentSession) {
      const sessionCheckins = (resp.session_checkins as Record<string, string>) ?? {};
      const alreadyInSession = !!sessionCheckins[currentSession];
      playBeep(!alreadyInSession);
      setPending({ responseId, name, answers: answersArr, alreadyCheckedIn: alreadyInSession });
      return;
    }

    // GENERAL/HALL MODE (original logic)
    if (resp.checked_in && !currentHall) {
      playBeep(false);
      setPending({ responseId, name, answers: answersArr, alreadyCheckedIn: true });
    } else if (!resp.checked_in && currentHall) {
      playBeep(true);
      setPending({ responseId, name, answers: answersArr, alreadyCheckedIn: false, notCheckedInGeneral: true });
    } else {
      playBeep(true);
      setPending({ responseId, name, answers: answersArr, alreadyCheckedIn: false });
    }
  };

  const confirmCheckin = async () => {
    if (!pending) return;
    const currentHall = hallRef.current;
    const currentSession = sessionRef.current;

    if (currentSession) {
      // Session mode: atomic RPC update to session_checkins
      await supabase.rpc("checkin_session", { resp_id: pending.responseId, session_name: currentSession });
      await logCheckinEvent({ surveyId, responseId: pending.responseId, action: "session_checkin", method: "qr", hall: currentHall, sessionName: currentSession });
    } else {
      // General/hall mode: update checked_in boolean
      await supabase.from("survey_responses")
        .update({ checked_in: true, checked_in_at: new Date().toISOString() })
        .eq("id", pending.responseId);
      await logCheckinEvent({ surveyId, responseId: pending.responseId, action: "checkin", method: "qr", hall: currentHall });
    }

    setCheckedCount((c) => c + 1);
    lastScannedRef.current = pending.responseId;
    setTimeout(() => { lastScannedRef.current = ""; }, 3000);
    setWelcome({ name: pending.name, hall: currentSession || currentHall });
    setTimeout(() => setWelcome(null), 2000);
    setPending(null);
  };

  const cancelCheckin = () => {
    if (pending) {
      lastScannedRef.current = pending.responseId;
      setTimeout(() => { lastScannedRef.current = ""; }, 3000);
    }
    setPending(null);
  };

  const handleScannedUrl = (url: string) => {
    if (busyRef.current) return; // block while modal or welcome screen is showing
    const match = url.match(/\/checkin\/([a-f0-9-]+)/i);
    if (!match) {
      if (url && url.length > 5) setScanResult({ type: "error", message: "Mã QR không phải mã check-in" });
      return;
    }
    const responseId = match[1];
    if (responseId === lastScannedRef.current) return;
    lastScannedRef.current = responseId;
    setTimeout(() => { lastScannedRef.current = ""; }, 2000);
    handleScan(responseId);
  };

  // Camera
  useEffect(() => {
    if (!surveyId) return;
    let stream: MediaStream | null = null;
    let animFrame: number;
    const start = async () => {
      try {
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: facingMode }, width: { ideal: 1280 }, height: { ideal: 720 } } });
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play(); scanningRef.current = true; loop(); }
      } catch { /* denied */ }
    };
    const loop = () => {
      if (!scanningRef.current || !videoRef.current || !canvasRef.current) return;
      const video = videoRef.current;
      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      if (!ctx || video.readyState < 2) { animFrame = requestAnimationFrame(loop); return; }
      canvas.width = video.videoWidth; canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const code = jsQR(imageData.data, imageData.width, imageData.height, { inversionAttempts: "dontInvert" });
      if (code?.data) handleScannedUrl(code.data);
      animFrame = requestAnimationFrame(loop);
    };
    start();
    return () => { scanningRef.current = false; cancelAnimationFrame(animFrame); stream?.getTracks().forEach((t) => t.stop()); };
  }, [surveyId, facingMode]);

  // Auto-clear toast
  useEffect(() => {
    if (!scanResult) return;
    const t = setTimeout(() => setScanResult(null), 4000);
    return () => clearTimeout(t);
  }, [scanResult]);

  return (
    <CheckinThemeLayer theme={theme}>
      {/* Hidden video/canvas feed (rendered into card below) */}
      <canvas ref={canvasRef} className="hidden" />

      {/* Glassmorphism check-in card */}
      <div
        className="relative w-full max-w-[900px] rounded-[32px] p-5 sm:p-8 flex flex-col items-center"
        style={{
          background: "rgba(255,255,255,0.12)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.25)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
        }}
      >
        {/* Sub-info */}
        <div className="absolute top-4 left-5 flex items-center gap-2 text-xs sm:text-sm">
          {hall && <span className="px-2.5 py-1 rounded-full bg-white/15 text-on-brand font-medium">🏛 {hall}</span>}
          {session && <span className="px-2.5 py-1 rounded-full bg-white/15 text-on-brand font-medium">🕐 {session}</span>}
        </div>
        <button onClick={() => setFacingMode((f) => f === "environment" ? "user" : "environment")}
          title={facingMode === "environment" ? "Chuyển sang camera trước" : "Chuyển sang camera sau"}
          className="absolute top-4 right-5 flex h-9 items-center gap-1.5 rounded-full bg-white/15 px-3 text-on-brand hover:bg-white/25">
          <SwitchCamera size={16} />
          <span className="text-xs font-semibold">Lật</span>
        </button>

        <h2 className="text-on-brand font-bold text-xl sm:text-2xl text-center mt-6 sm:mt-2 mb-4 drop-shadow">
          Vui lòng đưa mã QR vào khung
        </h2>

        {/* Camera box with scan line */}
        <div className="relative w-full max-w-[720px] aspect-video rounded-[24px] overflow-hidden bg-black/40 border border-white/20">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted
            style={{ transform: facingMode === "user" ? "scaleX(-1)" : "none" }} />
          {/* corner frame */}
          <div className="absolute inset-6 pointer-events-none">
            <span className="absolute top-0 left-0 w-10 h-10 border-t-4 border-l-4 rounded-tl-xl" style={{ borderColor: "var(--checkin-accent)" }} />
            <span className="absolute top-0 right-0 w-10 h-10 border-t-4 border-r-4 rounded-tr-xl" style={{ borderColor: "var(--checkin-accent)" }} />
            <span className="absolute bottom-0 left-0 w-10 h-10 border-b-4 border-l-4 rounded-bl-xl" style={{ borderColor: "var(--checkin-accent)" }} />
            <span className="absolute bottom-0 right-0 w-10 h-10 border-b-4 border-r-4 rounded-br-xl" style={{ borderColor: "var(--checkin-accent)" }} />
          </div>
          {/* scan line */}
          <motion.div
            className="absolute left-6 right-6 h-0.5 rounded-full"
            style={{ background: "var(--checkin-accent)", boxShadow: "0 0 12px var(--checkin-accent)" }}
            initial={{ top: "12%" }}
            animate={{ top: ["12%", "88%", "12%"] }}
            transition={{ duration: 3, repeat: Infinity, ease: "easeInOut" }}
          />
        </div>

        {/* Counter */}
        <div className="mt-4 flex items-center gap-2 text-on-brand">
          <UserCheck size={18} style={{ color: "var(--checkin-accent)" }} />
          <span className="text-lg font-bold">{checkedCount}</span>
          <span className="text-white/60 text-sm">/ {totalCount} đã check-in</span>
        </div>
      </div>

      {/* Confirmation modal */}
      <AnimatePresence>
        {pending && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">

              {/* Wrong hall warning */}
              {pending.wrongHall && (
                <div className="mb-3 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm font-medium text-center flex items-center justify-center gap-2">
                  <AlertTriangle size={16} /> Sai hội trường! Người này thuộc: <strong>{pending.wrongHall}</strong>
                </div>
              )}

              {/* Already checked in */}
              {pending.alreadyCheckedIn && !pending.wrongHall && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium text-center">
                  ⚠️ Đã check-in {session ? `buổi "${session}"` : "trước đó"}
                </div>
              )}

              {/* Not checked in at general counter */}
              {pending.notCheckedInGeneral && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm font-medium text-center">
                  ℹ️ Người này chưa check-in ở quầy chung
                </div>
              )}

              <h2 className="text-lg font-bold text-slate-800 mb-1">
                {pending.wrongHall ? "Sai hội trường" : pending.alreadyCheckedIn ? "Đã check-in" : "Xác nhận check-in"}
              </h2>
              <p className="text-2xl font-bold text-indigo-600 mb-3">{pending.name}</p>
              <div className="bg-slate-50 rounded-xl p-3 space-y-1.5 mb-4 max-h-40 overflow-y-auto">
                {pending.answers.slice(0, 6).map((item, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="text-slate-500 flex-shrink-0">{item.label}:</span>
                    <span className="text-slate-800 font-medium">{item.value}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={cancelCheckin}
                  className="flex-1 py-3 rounded-xl text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors">
                  Đóng
                </button>
                {!pending.wrongHall && (
                  <button onClick={confirmCheckin}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-on-brand bg-sky-600 hover:bg-sky-500 transition-colors">
                    ✓ Check-in
                  </button>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Result toast */}
      <AnimatePresence>
        {scanResult && !pending && (
          <motion.div
            initial={{ opacity: 0, y: 50, scale: 0.9 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 50, scale: 0.9 }}
            className={`absolute bottom-12 left-4 right-4 z-30 p-5 rounded-2xl flex items-center gap-4 shadow-2xl ${
              scanResult.type === "success" ? "bg-emerald-500" :
              scanResult.type === "already" ? "bg-amber-500" :
              scanResult.type === "wrong_hall" ? "bg-orange-500" : "bg-red-500"
            }`}>
            {scanResult.type === "success" ? <CheckCircle size={32} className="text-on-brand" /> :
             scanResult.type === "already" ? <UserCheck size={32} className="text-on-brand" /> :
             <XCircle size={32} className="text-on-brand" />}
            <div>
              {scanResult.name && <p className="text-on-brand font-bold text-lg">{scanResult.name}</p>}
              <p className="text-white/90 text-sm">{scanResult.message}</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Fullscreen welcome */}
      <AnimatePresence>
        {welcome && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 flex flex-col items-center justify-center bg-gradient-to-br from-sky-500 via-cyan-600 to-teal-700 px-6"
          >
            <motion.div
              initial={{ scale: 0 }}
              animate={{ scale: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 12 }}
              className="w-24 h-24 rounded-full bg-white/20 backdrop-blur flex items-center justify-center mb-6"
            >
              <CheckCircle size={56} className="text-on-brand" />
            </motion.div>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 }}
              className="text-white/80 text-lg font-medium mb-2"
            >
              Chào mừng
            </motion.p>
            <motion.h1
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.3 }}
              className="text-on-brand text-4xl sm:text-5xl font-bold text-center mb-3"
            >
              {welcome.name}
            </motion.h1>
            <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.4 }}
              className="text-white/90 text-lg text-center"
            >
              {welcome.hall ? `🏛 ${welcome.hall}` : surveyTitle}
            </motion.p>
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.6 }}
              className="text-white/70 text-sm mt-6"
            >
              ✓ Check-in thành công
            </motion.p>
          </motion.div>
        )}
      </AnimatePresence>
    </CheckinThemeLayer>
  );
}

function findName(answers: Record<string, unknown>): string {
  for (const v of Object.values(answers)) {
    if (typeof v === "string" && v.length > 1 && v.length < 50 && !/^https?:/.test(v) && !/^\d+$/.test(v)) return v;
  }
  return "";
}
