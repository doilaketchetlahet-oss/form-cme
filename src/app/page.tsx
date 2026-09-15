"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { ArrowRight, ClipboardList, QrCode, ShieldCheck, Users, Sparkles } from "lucide-react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";

const AnimatedBackground = dynamic(
  () => import("@/components/ui/AnimatedBackground").then((m) => ({ default: m.AnimatedBackground })),
  { ssr: false },
);

const BRAND_GRADIENT = "linear-gradient(135deg, #0ea5e9, #06b6d4)";

export default function HomePage() {
  const router = useRouter();
  const [checkingSession, setCheckingSession] = useState(true);

  useEffect(() => {
    let mounted = true;

    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (!mounted) return;
        if (session) {
          router.replace("/admin");
          return;
        }
        setCheckingSession(false);
      })
      .catch(() => {
        if (mounted) setCheckingSession(false);
      });

    return () => {
      mounted = false;
    };
  }, [router]);

  return (
    <main className="relative min-h-dvh">
      <AnimatedBackground />

      <div className="relative z-10 min-h-dvh flex flex-col px-6 py-8">
        {checkingSession && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-sm">
            <div className="h-2 w-2 rounded-full bg-sky-400 animate-ping" />
          </div>
        )}

        <header className="flex items-center justify-between max-w-5xl mx-auto w-full">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl flex items-center justify-center" style={{ background: BRAND_GRADIENT, boxShadow: "0 6px 20px rgba(6,182,212,0.3)" }}>
              <QrCode size={18} className="text-on-brand" />
            </div>
            <span className="font-semibold text-slate-900 tracking-tight">Form CME</span>
          </Link>
          <Link href="/login" className="px-4 py-2 rounded-xl text-sm font-medium text-slate-600 glass hover:text-slate-900">
            Đăng nhập
          </Link>
        </header>

        <section className="flex-1 flex flex-col items-center justify-center text-center max-w-4xl mx-auto py-16 w-full">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full text-xs font-medium text-sky-700 bg-sky-50 border border-sky-200 mb-7"
          >
            <Sparkles size={13} className="text-sky-500" />
            Bộ công cụ chuyên biệt cho hội thảo y tế
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="font-display text-5xl sm:text-6xl md:text-7xl font-black tracking-tight text-slate-900 leading-[1.05] mb-6"
          >
            i-Solution<span className="text-sky-600">Manager</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16 }}
            className="text-base sm:text-lg text-slate-600 max-w-2xl mb-10 leading-relaxed"
          >
            Hệ thống tạo form đăng ký sự kiện và giải pháp check-in bằng QR hoặc khuôn mặt.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24 }}
            className="flex flex-col sm:flex-row gap-3 mb-14"
          >
            <Link href="/admin" className="px-7 py-3.5 rounded-2xl font-semibold text-on-brand flex items-center justify-center gap-2 transition-transform hover:scale-[1.02]"
              style={{ background: BRAND_GRADIENT, boxShadow: "0 12px 36px rgba(6,182,212,0.3)" }}>
              Mở dashboard <ArrowRight size={18} />
            </Link>
            <Link href="/login" className="px-7 py-3.5 rounded-2xl font-semibold text-slate-700 glass hover:text-slate-900">
              Đăng nhập admin
            </Link>
          </motion.div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-3xl text-left">
            <Feature icon={ClipboardList} iconClass="text-sky-600" title="Trình tạo form" text="Dễ dàng tạo form đăng ký, khảo sát hoặc post-test, chấm điểm cho hội thảo" />
            <Feature icon={QrCode} iconClass="text-cyan-600" title="QR check-in" text="Hệ thống check in bằng QR code, quản lý người tham dự hội thảo và hệ thống auto-mailing chuyên nghiệp." />
            <Feature icon={ShieldCheck} iconClass="text-indigo-600" title="Face VIP" text="Hệ thống nhận diện khuôn mặt hiện đại, tỉ lệ chính xác cao và miễn phí, dùng cho hội thảo chuyên nghiệp." />
          </div>
        </section>

        <footer className="text-center text-xs text-slate-500 pb-2 flex items-center justify-center gap-2">
          <Users size={12} /> Bản quyền thuộc về Phi Lao
        </footer>
      </div>
    </main>
  );
}

function Feature({
  icon: Icon,
  iconClass,
  title,
  text,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>;
  iconClass: string;
  title: string;
  text: string;
}) {
  return (
    <div className="glass rounded-2xl p-5">
      <Icon size={20} className={`${iconClass} mb-3`} />
      <h3 className="text-sm font-semibold text-slate-900 mb-1">{title}</h3>
      <p className="text-xs leading-5 text-slate-600">{text}</p>
    </div>
  );
}