"use client";
import { useEffect, useState, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle, XCircle, UserCheck, SwitchCamera, FlipHorizontal2, LoaderCircle, AlertTriangle, Maximize2, Minimize2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { PinGate } from "@/components/ui/PinGate";
import { CheckinThemeLayer } from "@/components/ui/CheckinThemeLayer";
import type { CheckinTheme } from "@/lib/surveys";
import { logCheckinEvent } from "@/lib/checkinLogs";
import { useQrCamera } from "@/hooks/useQrCamera";
import { useFullscreen } from "@/hooks/useFullscreen";
import { canAttendSession, normalizeSessionConfig } from "@/lib/checkin-sessions";
import { recordSessionCheckin } from "@/lib/session-checkin-client";
import { assignedHallForDisplay, attendanceDetails, attendanceQuestionPriority, formatAttendanceAnswer, type DisplayQuestion } from "@/lib/attendance-display";
import { findAttendeeName } from "@/lib/email-template";

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
  assignedHall: string;
  identityDetails: { label: string; value: string }[];
  alreadyCheckedIn: boolean;
  wrongHall?: string | null;
  notCheckedInGeneral?: boolean;
  checkedInAt?: string | null;
  blockedReason?: string;
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
  const questionsRef = useRef<DisplayQuestion[]>([]);
  const [scanResult, setScanResult] = useState<ScanResult | null>(null);
  const [pending, setPending] = useState<PendingCheckin | null>(null);
  const [checkedCount, setCheckedCount] = useState(0);
  const [totalCount, setTotalCount] = useState(0);
  const [hall, setHall] = useState<string>(initialQuery.hall); // current hall filter
  const [assignedHalls, setAssignedHalls] = useState<string[]>([]);
  const [welcome, setWelcome] = useState<{ name: string; hall: string; details: { label: string; value: string }[] } | null>(null);
  const [session] = useState<string>(initialQuery.session);
  const [theme, setTheme] = useState<CheckinTheme | null>(null);
  const [confirming, setConfirming] = useState(false);
  const sessionConfig = useMemo(() => normalizeSessionConfig(theme?.sessionConfig), [theme]);
  const sessionConfigRef = useRef(sessionConfig);
  const surveyReadyRef = useRef(false);
  useEffect(() => { sessionConfigRef.current = sessionConfig; }, [sessionConfig]);
  const configuredSession = sessionConfig?.sessions.find((item) => item.id === session);
  const sessionName = configuredSession?.name ?? session;
  const currentVenue = configuredSession?.checkHall ? hall : configuredSession?.hall ?? hall;
  const videoRef = useRef<HTMLVideoElement>(null);
  const scanRootRef = useRef<HTMLDivElement>(null);
  const fullscreen = useFullscreen(scanRootRef);
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
    surveyReadyRef.current = false;
    surveyIdRef.current = id;
    Promise.all([
      supabase.from("surveys").select("title, checkin_theme").eq("id", id).single(),
      supabase.from("survey_questions").select("id, text, position, type, options, is_hall_selector").eq("survey_id", id).order("position"),
    ]).then(([{ data: survey, error }, { data: questions, error: questionError }]) => {
      if (error || questionError || !survey) {
        setScanResult({ type: "error", message: "Không tải được cấu hình check-in. Tải lại trang để thử lại." });
        return;
      }
      setSurveyTitle(survey?.title ?? "");
      setTheme((survey?.checkin_theme as CheckinTheme) ?? null);
      sessionConfigRef.current = normalizeSessionConfig(survey.checkin_theme?.sessionConfig);
      surveyReadyRef.current = true;
      questionsRef.current = questions ?? [];
    });
  }, [surveyId]);

  // Realtime counter
  useEffect(() => {
    if (!surveyId) return;
    const fetchCount = async () => {
      if (session) {
        const { data: rows, error } = await supabase.from("survey_responses").select("answers, hall, session_checkins").eq("survey_id", surveyId);
        if (error) return;
        setAssignedHalls([...new Set((rows ?? []).map((row) => row.hall as string).filter(Boolean))].sort());
        const checksHall = !sessionConfig || sessionConfig.sessions.find((s) => s.id === session)?.checkHall;
        const eligible = (rows ?? []).filter((row) => canAttendSession(sessionConfig, session, row.answers ?? {}) && (!checksHall || !hall || row.hall === hall));
        setTotalCount(eligible.length);
        setCheckedCount(eligible.filter((row) => row.session_checkins?.[session]).length);
      } else {
        const totalQ = supabase.from("survey_responses").select("*", { count: "exact", head: true }).eq("survey_id", surveyId);
        if (hall) totalQ.eq("hall", hall);
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
  }, [surveyId, hall, session, sessionConfig]);

  const handleScan = async (responseId: string) => {
    if (!surveyReadyRef.current) return;
    const sid = surveyIdRef.current;
    if (sessionConfigRef.current && !sessionRef.current) {
      playBeep(false);
      setScanResult({ type: "error", message: "Mở link quét của từng buổi từ Danh sách khách trước khi check-in." });
      return;
    }
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

    const name = findAttendeeName(resp.answers, questionsRef.current) || resp.id.slice(0, 8).toUpperCase();

    const answersArr = attendanceDetails(questionsRef.current, resp, sessionConfigRef.current);
    const identityDetails = [...questionsRef.current].sort((a, b) => attendanceQuestionPriority(a) - attendanceQuestionPriority(b)).flatMap((question) => {
      const rank = attendanceQuestionPriority(question);
      const value = resp.answers[question.id];
      return rank >= 1 && rank <= 3 && value != null && value !== ""
        ? [{ label: question.text, value: formatAttendanceAnswer(value, question) }] : [];
    });
    const attendee = { responseId, name, answers: answersArr, assignedHall: assignedHallForDisplay(questionsRef.current, resp), identityDetails };

    const currentHall = hallRef.current;
    const currentSession = sessionRef.current;

    // Check hall mismatch (applies in both modes)
    if (!sessionConfigRef.current && currentHall && resp.hall && resp.hall !== currentHall) {
      playBeep(false);
      setPending({ ...attendee, alreadyCheckedIn: false, wrongHall: resp.hall });
      return;
    }

    // SESSION MODE: check session_checkins[currentSession]
    if (currentSession) {
      const result = await recordSessionCheckin(sid, responseId, currentSession, "preview", "qr", currentHall);
      if (!result.ok) {
        playBeep(false);
        setPending({ ...attendee, alreadyCheckedIn: false, blockedReason: result.error ?? "Không được tham dự buổi này." });
        return;
      }
      const alreadyInSession = result.code === "already";
      playBeep(!alreadyInSession);
      setPending({ ...attendee, alreadyCheckedIn: alreadyInSession, checkedInAt: result.checkedInAt });
      return;
    }

    // GENERAL/HALL MODE (original logic)
    if (resp.checked_in && !currentHall) {
      playBeep(false);
      setPending({ ...attendee, alreadyCheckedIn: true });
    } else if (!resp.checked_in && currentHall) {
      playBeep(true);
      setPending({ ...attendee, alreadyCheckedIn: false, notCheckedInGeneral: true });
    } else {
      playBeep(true);
      setPending({ ...attendee, alreadyCheckedIn: false });
    }
  };

  const confirmCheckin = async () => {
    if (!pending || confirming || pending.blockedReason || pending.wrongHall) return;
    setConfirming(true);
    const currentHall = hallRef.current;
    const currentSession = sessionRef.current;

    if (currentSession) {
      const result = await recordSessionCheckin(surveyId, pending.responseId, currentSession, "checkin", "qr", currentHall);
      if (!result.ok || result.code === "already") {
        playBeep(false);
        setScanResult({ type: result.code === "already" ? "already" : "error", message: result.code === "already" ? "Đã check-in buổi này. Không ghi nhận thêm." : result.error ?? "Chưa ghi nhận được check-in." });
        setPending(null);
        setConfirming(false);
        return;
      }
    } else {
      // General/hall mode: update checked_in boolean
      await supabase.from("survey_responses")
        .update({ checked_in: true, checked_in_at: new Date().toISOString() })
        .eq("id", pending.responseId);
      await logCheckinEvent({ surveyId, responseId: pending.responseId, action: "checkin", method: "qr", hall: currentHall });
    }

    setCheckedCount((c) => c + 1);
    setConfirming(false);
    lastScannedRef.current = pending.responseId;
    setTimeout(() => { lastScannedRef.current = ""; }, 3000);
    setWelcome({ name: pending.name, hall: pending.assignedHall, details: pending.identityDetails });
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
    if (busyRef.current || !surveyReadyRef.current) return;
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

  const camera = useQrCamera(videoRef, handleScannedUrl, !!pending || !!welcome);

  // Auto-clear toast
  useEffect(() => {
    if (!scanResult) return;
    const t = setTimeout(() => setScanResult(null), 4000);
    return () => clearTimeout(t);
  }, [scanResult]);

  return (
    <div ref={scanRootRef} data-scan-root data-scan-expanded={fullscreen.expanded}>
    <CheckinThemeLayer theme={theme}>
      {/* Glassmorphism check-in card */}
      <div
        data-expanded={fullscreen.expanded}
        className="scan-camera-card relative max-h-full w-full max-w-[900px] overflow-y-auto rounded-[32px] p-5 sm:p-8 flex flex-col items-center [&>*]:shrink-0"
        style={{
          background: "rgba(255,255,255,0.12)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          border: "1px solid rgba(255,255,255,0.25)",
          boxShadow: "0 24px 60px rgba(0,0,0,0.35)",
        }}
      >
        {/* Sub-info */}
        {(currentVenue || session) && <div className="scan-camera-subinfo absolute top-4 left-5 flex items-center gap-2 text-xs sm:text-sm">
          {currentVenue && <span className="px-2.5 py-1 rounded-full bg-white/15 text-on-brand font-medium">🏛 {currentVenue}</span>}
          {session && <span className="px-2.5 py-1 rounded-full bg-white/15 text-on-brand font-medium">🕐 {sessionName}</span>}
        </div>}
        <h2 className="scan-camera-title text-on-brand font-bold text-xl sm:text-2xl text-center mt-6 sm:mt-2 mb-4 drop-shadow">
          Vui lòng đưa mã QR vào khung
        </h2>
        <div className="scan-camera-controls w-full max-w-[720px]">
        <div className="scan-camera-toolbar mb-4 flex w-full flex-wrap items-end justify-center gap-2">
          <label className="min-w-0 basis-full text-xs font-semibold text-on-brand sm:flex-1 sm:basis-0">Camera đang dùng
            <select aria-label="Camera đang dùng" value={camera.activeCamera} disabled={camera.switching || !!pending || !!welcome || !camera.cameras.length}
              onChange={(event) => void camera.selectCamera(event.target.value)}
              className="mt-1 min-h-11 w-full rounded-xl border border-white/40 bg-white px-3 text-base text-slate-900 disabled:opacity-70 sm:text-sm">
              {!camera.activeCamera && <option value="">{camera.switching ? "Đang mở camera…" : "Camera hiện tại"}</option>}
              {camera.cameras.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
            </select>
          </label>
          <button type="button" onClick={camera.switchCamera} disabled={camera.switching || camera.cameras.length < 2 || !!pending || !!welcome}
            title={camera.cameras.length === 1 ? "Thiết bị chỉ có một camera" : "Đổi camera trước/sau"}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-white/40 bg-white px-3 text-sm font-semibold text-slate-900 hover:bg-slate-100 disabled:opacity-60">
            {camera.switching ? <LoaderCircle size={18} className="animate-spin" /> : <SwitchCamera size={18} />}
            {camera.switching ? "Đang mở…" : "Đổi trước/sau"}
          </button>
          <button type="button" onClick={camera.toggleMirror} aria-pressed={camera.mirrored}
            className="flex min-h-11 items-center gap-2 rounded-xl border border-white/40 bg-white px-3 text-sm font-semibold text-slate-900 hover:bg-slate-100">
            <FlipHorizontal2 size={18} /> Lật hình
          </button>
          {camera.cameras.length === 1 && <p className="w-full text-center text-xs text-on-brand">Thiết bị chỉ có một camera.</p>}
        </div>
        {configuredSession?.checkHall && <label className="mb-4 flex flex-wrap items-center gap-2 text-sm text-white">Hội trường tại quầy quét
          <select aria-label="Hội trường tại quầy quét" value={hall} disabled={!!pending || confirming} onChange={(e) => { hallRef.current = e.target.value; setHall(e.target.value); }} className="rounded-lg border bg-white p-2 text-slate-900">
            <option value="">Chọn hội trường</option>{[...new Set([...assignedHalls, ...(hall ? [hall] : [])])].map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>}
        {configuredSession && (configuredSession.opensAt || configuredSession.closesAt) && <p className="mb-3 text-center text-xs text-white/70">Giờ check-in: {configuredSession.opensAt ? new Date(configuredSession.opensAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Không giới hạn mở"} — {configuredSession.closesAt ? new Date(configuredSession.closesAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" }) : "Không giới hạn đóng"}</p>}
        </div>

        <div className="scan-camera-feed flex w-full flex-col items-center">
        {/* Camera box with scan line */}
        <div className="scan-camera-preview relative w-full max-w-[720px] aspect-video rounded-[24px] overflow-hidden bg-black/40 border border-white/20">
          <video ref={videoRef} className="w-full h-full object-cover" playsInline muted
            onPlay={camera.syncVideoMirror} style={{ transform: camera.mirrored ? "scaleX(-1)" : "none" }} />
          <button type="button" onClick={() => void fullscreen.toggle()} disabled={fullscreen.busy}
            aria-label={fullscreen.expanded ? "Thoát toàn màn hình" : "Toàn màn hình"}
            title={fullscreen.expanded ? "Thoát toàn màn hình (Esc)" : "Toàn màn hình"}
            aria-pressed={fullscreen.expanded}
            className="absolute right-2 top-2 z-20 flex h-11 w-11 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-900 shadow-sm hover:bg-slate-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:opacity-60">
            {fullscreen.expanded ? <Minimize2 size={20} /> : <Maximize2 size={20} />}
          </button>
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
          {camera.cameraError && (
            <div role="alert" className="absolute inset-x-3 bottom-3 z-20 rounded-xl bg-amber-100 px-3 py-2 text-center text-sm font-semibold text-amber-950 shadow-lg">
              <p>{camera.cameraError}</p>
              <button type="button" onClick={() => void camera.retryCamera()} disabled={camera.switching}
                className="mt-1 min-h-11 rounded-lg border border-amber-700 px-3 font-semibold disabled:opacity-60">Thử lại camera</button>
            </div>
          )}
        </div>

        {/* Counter */}
        <div className="scan-camera-counter mt-4 flex items-center gap-2 text-on-brand">
          <UserCheck size={18} style={{ color: "var(--checkin-accent)" }} />
          <span className="text-lg font-bold">{checkedCount}</span>
          <span className="text-white/60 text-sm">/ {totalCount} đã check-in</span>
        </div>
        </div>
      </div>

      <style jsx>{`
        :global([data-scan-root][data-scan-expanded="true"] header), :global([data-scan-root][data-scan-expanded="true"] footer) { display: none; }
        :global([data-scan-root][data-scan-expanded="true"] main) { padding: 12px; }
        .scan-camera-card[data-expanded="true"] { max-width: none; }
        .scan-camera-card[data-expanded="true"] .scan-camera-preview {
          max-width: none;
          width: min(100%, calc((100dvh - 260px) * 16 / 9));
        }
        @media (min-width: 640px) and (max-height: 500px) {
          .scan-camera-card {
            display: grid;
            grid-template-columns: 220px minmax(0, 1fr);
            align-items: start;
            gap: 12px 16px;
            padding: 12px;
          }
          .scan-camera-title { grid-column: 1 / -1; margin: 0; font-size: 18px; line-height: 24px; }
          .scan-camera-controls { grid-column: 1; min-width: 0; }
          .scan-camera-toolbar { margin-bottom: 0; }
          .scan-camera-toolbar label { flex: 0 0 100%; }
          .scan-camera-feed { grid-column: 2; grid-row: 2; }
          .scan-camera-preview { width: min(100%, calc((100dvh - 206px) * 16 / 9)); }
          .scan-camera-counter { margin-top: 8px; }
          .scan-camera-subinfo { position: static; grid-column: 1 / -1; }
          .scan-camera-card:has(.scan-camera-subinfo) .scan-camera-feed { grid-row: 3; }
          .scan-camera-card:has(.scan-camera-subinfo) .scan-camera-preview { width: min(100%, calc((100dvh - 244px) * 16 / 9)); }
          .scan-camera-card[data-expanded="true"] .scan-camera-preview { width: min(100%, calc((100dvh - 110px) * 16 / 9)); }
          .scan-camera-card[data-expanded="true"]:has(.scan-camera-subinfo) .scan-camera-preview { width: min(100%, calc((100dvh - 148px) * 16 / 9)); }
        }
      `}</style>

      {/* Confirmation modal */}
      <AnimatePresence>
        {pending && (
          <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-40 bg-black/60 flex items-center justify-center p-4">
            <motion.div initial={{ scale: 0.9, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.9, opacity: 0 }}
              className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-2xl">

              {/* Wrong hall warning */}
              {pending.blockedReason && <p className="mb-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm font-medium text-red-800">{pending.blockedReason}</p>}
              {pending.wrongHall && (
                <div className="mb-3 px-3 py-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm font-medium text-center flex items-center justify-center gap-2">
                  <AlertTriangle size={16} /> Sai hội trường! Người này thuộc: <strong>{pending.wrongHall}</strong>
                </div>
              )}

              {/* Already checked in */}
              {pending.alreadyCheckedIn && !pending.wrongHall && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-amber-50 border border-amber-200 text-amber-800 text-sm font-medium text-center">
                  ⚠️ Đã check-in {session ? `buổi "${sessionName}"` : "trước đó"}
                  {pending.checkedInAt && <p className="mt-1">{new Date(pending.checkedInAt).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</p>}
                </div>
              )}

              {/* Not checked in at general counter */}
              {pending.notCheckedInGeneral && (
                <div className="mb-3 px-3 py-2 rounded-lg bg-blue-50 border border-blue-200 text-blue-800 text-sm font-medium text-center">
                  ℹ️ Người này chưa check-in ở quầy chung
                </div>
              )}

              <h2 className="text-lg font-bold text-slate-800 mb-1">
                {pending.blockedReason ? "Chưa thể check-in" : pending.wrongHall ? "Sai hội trường" : pending.alreadyCheckedIn ? "Đã check-in" : "Xác nhận check-in"}
              </h2>
              <p className="text-2xl font-bold text-indigo-600 mb-3">{pending.name}</p>
              <div className="bg-slate-50 rounded-xl p-3 space-y-1.5 mb-4 max-h-40 overflow-y-auto">
                {pending.answers.map((item, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="text-slate-500 flex-shrink-0">{item.label}:</span>
                    <span className="text-slate-800 font-medium">{item.value}</span>
                  </div>
                ))}
              </div>
              <div className="flex gap-3">
                <button onClick={cancelCheckin} disabled={confirming}
                  className="flex-1 py-3 rounded-xl text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 transition-colors">
                  Đóng
                </button>
                {!pending.blockedReason && !pending.wrongHall && !(session && pending.alreadyCheckedIn) && (
                  <button onClick={confirmCheckin} disabled={confirming}
                    className="flex-1 py-3 rounded-xl text-sm font-bold text-on-brand bg-sky-600 hover:bg-sky-500 transition-colors">
                    {confirming ? "Đang ghi nhận…" : "✓ Check-in"}
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
            role="status"
            aria-label="Check-in thành công"
            className="absolute inset-0 z-50 flex flex-col items-center justify-center overflow-y-auto bg-gradient-to-br from-sky-500 via-cyan-600 to-teal-700 px-6 py-6"
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
            {welcome.details.length > 0 && <motion.dl initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.4 }} className="mb-3 w-full max-w-md space-y-1 text-center text-white/95">
              {welcome.details.map((item, index) => <div key={index} className="text-sm sm:text-base"><dt className="inline text-white/75">{item.label}: </dt><dd className="inline font-medium">{item.value}</dd></div>)}
            </motion.dl>}
            {(welcome.hall || surveyTitle) && <motion.p
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.5 }}
              className="text-white/90 text-lg text-center"
            >
              {welcome.hall ? `🏛 ${welcome.hall}` : surveyTitle}
            </motion.p>}
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
    </div>
  );
}
