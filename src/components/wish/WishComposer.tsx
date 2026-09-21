"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { Eraser, Loader2, PenLine, Send, Sparkles, Undo2 } from "lucide-react";
import { DrawingPad } from "@/components/wish/DrawingPad";
import { submitWish, type SubmitWishPayload } from "@/lib/wish/realtime";
import {
  WISH_COLORS,
  WISH_SYMBOLS,
  WISH_THEMES,
  type WishEvent,
  type WishStroke,
} from "@/lib/wish/config";

type Props = {
  code: string;
  event: WishEvent;
  edge: "left" | "right" | "center";
};

type Feedback = { tone: "ok" | "warn" | "error"; text: string };

export function WishComposer({ code, event, edge }: Props) {
  const settings = event.settings;
  const theme = WISH_THEMES[settings.theme];
  const queueKey = `wish-queue:${code}`;

  const [symbol, setSymbol] = useState(settings.symbol);
  const [content, setContent] = useState("");
  const [nickname, setNickname] = useState("");
  const [tab, setTab] = useState<"text" | "draw">(settings.allowDrawing ? "draw" : "text");
  const [strokes, setStrokes] = useState<WishStroke[]>([]);
  const [color, setColor] = useState<string>(theme.accent);
  const [brush, setBrush] = useState(6);
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"compose" | "flying" | "sent">("compose");
  const [feedback, setFeedback] = useState<Feedback | null>(null);
  const [pending, setPending] = useState(0);
  const flushedRef = useRef(false);

  const canSend = content.trim().length > 0 || strokes.length > 0 || symbol.length > 0;

  const buildPayload = useCallback(
    (): SubmitWishPayload => ({
      symbol,
      content: content.trim(),
      drawing: strokes.length ? { strokes } : null,
      color,
      nickname: nickname.trim(),
      edge,
    }),
    [color, content, edge, nickname, strokes, symbol],
  );

  const readQueue = useCallback((): SubmitWishPayload[] => {
    try {
      const raw = window.localStorage.getItem(queueKey);
      return raw ? (JSON.parse(raw) as SubmitWishPayload[]) : [];
    } catch {
      return [];
    }
  }, [queueKey]);

  const writeQueue = useCallback(
    (queue: SubmitWishPayload[]) => {
      try {
        window.localStorage.setItem(queueKey, JSON.stringify(queue));
      } catch {
        // bỏ qua khi trình duyệt chặn localStorage
      }
      setPending(queue.length);
    },
    [queueKey],
  );

  const flushQueue = useCallback(async () => {
    const queue = readQueue();
    if (!queue.length) return;
    const remaining: SubmitWishPayload[] = [];
    for (const payload of queue) {
      const result = await submitWish(code, payload);
      if (!result.ok && result.error === "network") remaining.push(payload);
    }
    writeQueue(remaining);
  }, [code, readQueue, writeQueue]);

  useEffect(() => {
    queueMicrotask(() => setPending(readQueue().length));
    if (!flushedRef.current) {
      flushedRef.current = true;
      void flushQueue();
    }
    const onOnline = () => void flushQueue();
    window.addEventListener("online", onOnline);
    const timer = setInterval(() => void flushQueue(), 15000);
    return () => {
      window.removeEventListener("online", onOnline);
      clearInterval(timer);
    };
  }, [flushQueue, readQueue]);

  const reset = () => {
    setContent("");
    setStrokes([]);
    setFeedback(null);
    setPhase("compose");
  };

  const handleSend = async () => {
    if (busy || !canSend) return;
    setBusy(true);
    setFeedback(null);
    setPhase("flying");

    const payload = buildPayload();
    const [result] = await Promise.all([submitWish(code, payload), delay(1000)]);

    if (result.ok) {
      setFeedback(
        result.moderated
          ? { tone: "warn", text: "Đã gửi! Lời chúc đang chờ ban tổ chức duyệt." }
          : { tone: "ok", text: "Lời chúc của bạn đã bay lên màn hình lớn." },
      );
    } else if (result.error === "network") {
      writeQueue([...readQueue(), payload]);
      setFeedback({ tone: "warn", text: "Mất mạng — đã lưu lại, sẽ tự gửi khi có kết nối." });
    } else if (result.error === "too_fast") {
      setFeedback({ tone: "error", text: "Bạn vừa gửi rồi, chờ vài giây nhé." });
    } else if (result.error === "paused" || result.error === "closed") {
      setFeedback({ tone: "error", text: "Chương trình đang tạm dừng nhận lời chúc." });
    } else {
      setFeedback({ tone: "error", text: "Không gửi được, vui lòng thử lại." });
    }
    setPhase("sent");
    setBusy(false);
  };

  const flyTarget = useMemo(() => {
    const distance = typeof window === "undefined" ? 800 : Math.max(window.innerWidth, window.innerHeight);
    if (edge === "left") return { x: -distance, y: 0, rotate: -20 };
    if (edge === "right") return { x: distance, y: 0, rotate: 20 };
    return { x: 0, y: -distance, rotate: 0 };
  }, [edge]);

  return (
    <div className="flex w-full max-w-xl flex-col gap-4">
      {phase !== "compose" && (
        <AnimatePresence>
          <motion.div
            key="flyer"
            initial={{ opacity: 0, scale: 0.6, x: 0, y: 0 }}
            animate={
              phase === "flying"
                ? { opacity: 1, scale: 1, x: flyTarget.x, y: flyTarget.y, rotate: flyTarget.rotate }
                : { opacity: 0, scale: 0.4 }
            }
            transition={{ duration: phase === "flying" ? 1 : 0.3, ease: "easeIn" }}
            className="pointer-events-none fixed top-1/2 left-1/2 z-50 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-2"
          >
            <div
              className="flex h-24 w-24 items-center justify-center rounded-full text-5xl shadow-2xl"
              style={{ background: `${color}33`, boxShadow: `0 0 50px ${color}` }}
            >
              {symbol}
            </div>
            {content ? <p className="max-w-[160px] text-center text-sm font-semibold text-slate-200">{content}</p> : null}
          </motion.div>
        </AnimatePresence>
      )}

      {phase === "sent" && feedback && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="flex flex-col items-center gap-3 rounded-3xl bg-white/95 p-6 text-center shadow-xl"
        >
          <Sparkles style={{ color: theme.accent }} size={34} />
          <p className="text-lg font-black text-slate-900">
            {feedback.tone === "ok" ? "Đã trao yêu thương!" : "Ghi nhận lời chúc"}
          </p>
          <p className="text-sm text-slate-600">{feedback.text}</p>
          <button
            type="button"
            onClick={reset}
            className="mt-1 rounded-2xl px-6 py-3 text-sm font-bold text-white"
            style={{ background: theme.accent }}
          >
            Gửi lời chúc khác
          </button>
        </motion.div>
      )}

      {phase === "compose" && (
        <>
          <div className="rounded-3xl bg-white/10 p-4 backdrop-blur">
            <p className="mb-2 text-[11px] font-bold tracking-wider text-white/60 uppercase">Chọn vật phẩm</p>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {WISH_SYMBOLS.map((item) => (
                <button
                  key={item}
                  type="button"
                  onClick={() => setSymbol(item)}
                  className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl text-2xl transition-all ${
                    symbol === item ? "scale-110 bg-white/30 ring-2 ring-white" : "bg-white/10 hover:bg-white/20"
                  }`}
                >
                  {item}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-3xl bg-white/95 p-4 shadow-xl">
            <div className="mb-3 flex gap-1 rounded-2xl bg-slate-100 p-1">
              {settings.allowText && (
                <button
                  type="button"
                  onClick={() => setTab("text")}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-bold ${
                    tab === "text" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  <PenLine size={14} className="mr-1 inline" /> Viết lời chúc
                </button>
              )}
              {settings.allowDrawing && (
                <button
                  type="button"
                  onClick={() => setTab("draw")}
                  className={`flex-1 rounded-xl px-3 py-2 text-sm font-bold ${
                    tab === "draw" ? "bg-white text-slate-900 shadow-sm" : "text-slate-500"
                  }`}
                >
                  <Sparkles size={14} className="mr-1 inline" /> Vẽ tay
                </button>
              )}
            </div>

            {tab === "text" && settings.allowText && (
              <div className="space-y-3">
                <textarea
                  value={content}
                  onChange={(e) => setContent(e.target.value.slice(0, settings.maxLength))}
                  placeholder="Viết lời chúc của bạn…"
                  rows={4}
                  className="w-full resize-none rounded-2xl border border-slate-200 px-4 py-3 text-base focus:border-slate-400 focus:outline-none"
                />
                <p className="text-right text-[11px] text-slate-400">
                  {content.length}/{settings.maxLength}
                </p>
              </div>
            )}

            {tab === "draw" && settings.allowDrawing && (
              <div className="space-y-3">
                <DrawingPad
                  strokes={strokes}
                  onStrokesChange={setStrokes}
                  color={color}
                  brushSize={brush}
                  className="aspect-square w-full touch-none rounded-2xl border-2 border-dashed border-slate-300 bg-white"
                />
                <div className="flex flex-wrap items-center gap-2">
                  {WISH_COLORS.map((swatch) => (
                    <button
                      key={swatch}
                      type="button"
                      onClick={() => setColor(swatch)}
                      className={`h-8 w-8 rounded-full border-2 transition-transform ${
                        color === swatch ? "scale-110 border-slate-900" : "border-white"
                      }`}
                      style={{ background: swatch }}
                    />
                  ))}
                  <input
                    type="color"
                    value={color}
                    onChange={(e) => setColor(e.target.value)}
                    className="h-8 w-8 cursor-pointer rounded-full border border-slate-200 bg-white"
                    title="Màu khác"
                  />
                  <input
                    type="range"
                    min={2}
                    max={20}
                    value={brush}
                    onChange={(e) => setBrush(Number(e.target.value))}
                    className="flex-1"
                  />
                  <button
                    type="button"
                    onClick={() => setStrokes(strokes.slice(0, -1))}
                    disabled={!strokes.length}
                    className="rounded-xl border border-slate-200 p-2 text-slate-500 disabled:opacity-40"
                    title="Hoàn tác"
                  >
                    <Undo2 size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setStrokes([])}
                    disabled={!strokes.length}
                    className="rounded-xl border border-slate-200 p-2 text-slate-500 disabled:opacity-40"
                    title="Xoá hết"
                  >
                    <Eraser size={16} />
                  </button>
                </div>
              </div>
            )}

            <input
              value={nickname}
              onChange={(e) => setNickname(e.target.value.slice(0, 32))}
              placeholder="Tên của bạn (không bắt buộc)"
              className="mt-3 w-full rounded-2xl border border-slate-200 px-4 py-3 text-sm focus:border-slate-400 focus:outline-none"
            />
          </div>

          {feedback && phase === "compose" && (
            <p
              className={`rounded-2xl px-4 py-2 text-center text-sm font-semibold ${
                feedback.tone === "error" ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"
              }`}
            >
              {feedback.text}
            </p>
          )}

          {pending > 0 && (
            <p className="text-center text-xs font-semibold text-amber-200">
              {pending} lời chúc đang chờ gửi lại…
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={busy || !canSend}
            className="flex w-full items-center justify-center gap-2 rounded-3xl py-5 text-lg font-black text-white shadow-2xl transition-transform active:scale-[0.98] disabled:opacity-60"
            style={{ background: theme.accent, boxShadow: `0 10px 40px ${theme.accent}66` }}
          >
            {busy ? <Loader2 className="animate-spin" size={22} /> : <Send size={22} />}
            TRAO LỜI CHÚC
          </button>
        </>
      )}
    </div>
  );
}

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
