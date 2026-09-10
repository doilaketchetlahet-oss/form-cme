"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import { Mail, Lock, ArrowRight, QrCode, AlertCircle, CheckCircle } from "lucide-react";
import { GlassCard } from "@/components/ui/GlassCard";
import { signIn, signUp } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";

interface Props { mode: "login" | "signup"; }

const BRAND_GRADIENT = "linear-gradient(135deg, #0ea5e9, #06b6d4)";

export function AuthForm({ mode }: Props) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const nextUrl = searchParams.get("next") || "/admin";
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const isSignup = mode === "signup";

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) router.replace(nextUrl);
    });
  }, [nextUrl, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setLoading(true);

    try {
      if (isSignup) {
        const { data, error } = await signUp(email, password);
        if (error) {
          setError(translateError(error.message));
        } else if (data.session) {
          router.push(nextUrl);
        } else {
          setSuccess("Đã gửi email xác thực. Vui lòng kiểm tra hộp thư.");
        }
      } else {
        const { error } = await signIn(email, password);
        if (error) setError(translateError(error.message));
        else router.push(nextUrl);
      }
    } catch {
      setError("Có lỗi xảy ra. Thử lại sau.");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-dvh flex flex-col items-center justify-center px-4 py-16">
      <Link href="/" className="flex items-center gap-2 mb-12">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: BRAND_GRADIENT, boxShadow: "0 6px 18px rgba(6,182,212,0.3)" }}>
          <QrCode size={16} className="text-on-brand" />
        </div>
        <span className="text-xl font-semibold tracking-tight text-slate-900">Form CME</span>
      </Link>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="text-center mb-8">
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 mb-2 tracking-tight">
          {isSignup ? "Tạo tài khoản" : "Đăng nhập dashboard"}
        </h1>
        <p className="text-slate-600">
          {isSignup ? "Tạo tài khoản quản trị Form CME" : "Quản lý form đăng ký, QR check-in và attendee"}
        </p>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }} className="w-full max-w-sm">
        <GlassCard className="p-8">
          <form onSubmit={handleSubmit} className="flex flex-col gap-4">
            <div>
              <label className="text-xs text-slate-600 uppercase tracking-widest mb-2 block">Email</label>
              <div className="relative">
                <Mail size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="email"
                  required
                  autoFocus
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="admin@example.com"
                  className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 transition-all"
                />
              </div>
            </div>

            <div>
              <label className="text-xs text-slate-600 uppercase tracking-widest mb-2 block">Mật khẩu</label>
              <div className="relative">
                <Lock size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="password"
                  required
                  minLength={6}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Tối thiểu 6 ký tự"
                  className="w-full bg-white border border-slate-200 rounded-xl pl-10 pr-4 py-3 text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-sky-500 focus:ring-4 focus:ring-sky-500/10 transition-all"
                />
              </div>
            </div>

            <AnimatePresence>
              {error && (
                <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="flex items-start gap-2 px-3 py-2 rounded-lg bg-red-50 border border-red-200 text-sm text-red-600">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>{error}</span>
                </motion.div>
              )}
              {success && (
                <motion.div initial={{ opacity: 0, y: -5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
                  className="flex items-start gap-2 px-3 py-2 rounded-lg bg-teal-50 border border-teal-200 text-sm text-teal-700">
                  <CheckCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <span>{success}</span>
                </motion.div>
              )}
            </AnimatePresence>

            <motion.button
              type="submit"
              disabled={loading}
              className="w-full py-3 rounded-xl font-semibold text-on-brand flex items-center justify-center gap-2 disabled:opacity-50 mt-2 transition-transform hover:scale-[1.01]"
              style={{ background: BRAND_GRADIENT, boxShadow: "0 8px 24px rgba(6,182,212,0.3)" }}
              whileTap={{ scale: 0.98 }}
            >
              {loading ? "Đang xử lý..." : <>{isSignup ? "Đăng ký" : "Đăng nhập"} <ArrowRight size={16} /></>}
            </motion.button>
          </form>
        </GlassCard>

        <p className="text-center text-sm text-slate-600 mt-6">
          {isSignup ? (
            <>
              Đã có tài khoản?{" "}
              <Link href={`/login${nextUrl !== "/admin" ? `?next=${encodeURIComponent(nextUrl)}` : ""}`} className="text-sky-600 hover:text-sky-500 transition-colors font-medium">
                Đăng nhập
              </Link>
            </>
          ) : (
            <>
              Chưa có tài khoản?{" "}
              <Link href={`/signup${nextUrl !== "/admin" ? `?next=${encodeURIComponent(nextUrl)}` : ""}`} className="text-sky-600 hover:text-sky-500 transition-colors font-medium">
                Đăng ký
              </Link>
            </>
          )}
        </p>
      </motion.div>
    </div>
  );
}

function translateError(msg: string): string {
  if (msg.includes("Invalid login")) return "Email hoặc mật khẩu không đúng";
  if (msg.includes("already registered")) return "Email này đã được đăng ký";
  if (msg.includes("Email not confirmed")) return "Vui lòng xác thực email trước khi đăng nhập";
  if (msg.includes("Password should be")) return "Mật khẩu cần ít nhất 6 ký tự";
  return msg;
}