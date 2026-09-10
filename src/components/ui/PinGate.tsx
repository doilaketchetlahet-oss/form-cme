"use client";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import { Lock } from "lucide-react";
import { supabase } from "@/lib/supabase";

/**
 * Basic PIN gate for check-in pages (/attendees, /scan).
 * If the survey has a checkin_pin set, requires it before showing children.
 * Verified state is cached in sessionStorage per survey.
 * Note: this is a lightweight access gate, not strong auth.
 */
export function PinGate({ surveyId, children }: { surveyId: string; children: React.ReactNode }) {
  const [status, setStatus] = useState<"loading" | "open" | "locked">("loading");
  const [pin, setPin] = useState("");
  const [input, setInput] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!surveyId) return;
    (async () => {
      const { data } = await supabase.from("surveys").select("checkin_pin").eq("id", surveyId).single();
      const p = (data?.checkin_pin ?? "").trim();
      if (!p) { setStatus("open"); return; } // no pin → open
      if (typeof window !== "undefined" && sessionStorage.getItem(`pin-ok-${surveyId}`) === "1") {
        setStatus("open"); return;
      }
      setPin(p);
      setStatus("locked");
    })();
  }, [surveyId]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (input.trim() === pin) {
      sessionStorage.setItem(`pin-ok-${surveyId}`, "1");
      setStatus("open");
    } else {
      setError(true);
      setInput("");
    }
  };

  if (status === "loading") {
    return <div className="min-h-dvh bg-slate-50 flex items-center justify-center"><div className="animate-pulse w-12 h-12 rounded-full bg-slate-200" /></div>;
  }

  if (status === "locked") {
    return (
      <div className="min-h-dvh bg-sky-50 flex items-center justify-center px-4">
        <motion.form
          initial={{ scale: 0.95, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          onSubmit={submit}
          className="bg-white rounded-2xl p-6 w-full max-w-xs text-center shadow-2xl"
        >
          <div className="w-14 h-14 rounded-full bg-sky-100 flex items-center justify-center mx-auto mb-4">
            <Lock size={24} className="text-sky-600" />
          </div>
          <h1 className="text-lg font-bold text-slate-800 mb-1">Nhập mã PIN</h1>
          <p className="text-sm text-slate-500 mb-4">Trang này yêu cầu mã PIN để truy cập</p>
          <input
            value={input}
            onChange={(e) => { setInput(e.target.value); setError(false); }}
            type="password"
            inputMode="numeric"
            autoFocus
            placeholder="••••"
            className={`w-full px-4 py-3 rounded-xl border text-center text-lg tracking-widest text-slate-800 focus:outline-none ${error ? "border-red-400 focus:border-red-500" : "border-slate-200 focus:border-sky-400"}`}
          />
          {error && <p className="text-xs text-red-500 mt-2">Mã PIN không đúng</p>}
          <button type="submit" className="mt-4 w-full py-3 rounded-xl bg-sky-500 text-on-brand text-sm font-semibold hover:bg-sky-400 transition-colors">
            Mở khoá
          </button>
        </motion.form>
      </div>
    );
  }

  return <>{children}</>;
}
