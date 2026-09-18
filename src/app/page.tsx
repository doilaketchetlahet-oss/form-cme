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
    <main className="relative min-h-dvh overflow-x-hidden">
      <AnimatedBackground />

      <div className="relative z-10 flex min-h-dvh flex-col px-4 py-4 sm:px-6 sm:py-8">
        {checkingSession && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-white/70 backdrop-blur-sm">
            <div className="h-2 w-2 rounded-full bg-sky-400 animate-ping" />
          </div>
        )}

        <header className="mx-auto flex w-full max-w-5xl items-center justify-between gap-3">
          <Link href="/" className="flex min-w-0 items-center gap-2 sm:gap-2.5">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl sm:h-9 sm:w-9" style={{ background: BRAND_GRADIENT, boxShadow: "0 6px 20px rgba(6,182,212,0.3)" }}>
              <QrCode size={16} className="text-on-brand sm:hidden" />
              <QrCode size={18} className="text-on-brand hidden sm:block" />
            </div>
            <span className="truncate text-sm font-semibold tracking-tight text-slate-900 sm:text-base">I-solution Manager</span>
          </Link>
          <Link href="/login" className="shrink-0 rounded-xl px-3 py-1.5 text-xs font-medium text-slate-600 glass hover:text-slate-900 sm:px-4 sm:py-2 sm:text-sm">
            Đăng nhập
          </Link>
        </header>

        <section className="mx-auto flex w-full max-w-4xl flex-1 flex-col items-center justify-center py-6 text-center sm:py-16">
          <motion.span
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 inline-flex items-center gap-2 rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-[11px] font-medium text-sky-700 sm:mb-7 sm:px-3.5 sm:py-1.5 sm:text-xs"
          >
            <Sparkles size={12} className="text-sky-500" />
            Bộ công cụ chuyên biệt cho hội thảo y tế
          </motion.span>

          <motion.h1
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 }}
            className="font-display mb-3 max-w-[18ch] text-[1.85rem] leading-[1.12] font-black tracking-tight text-slate-900 text-balance sm:mb-6 sm:max-w-none sm:text-5xl md:text-7xl sm:leading-[1.05]"
          >
            I-solution <span className="text-sky-600">Manager</span>
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.16 }}
            className="mb-6 max-w-md text-sm leading-relaxed text-slate-600 sm:mb-10 sm:max-w-2xl sm:text-lg"
          >
            Hệ thống tạo form đăng ký sự kiện và giải pháp check-in bằng QR hoặc khuôn mặt.
          </motion.p>

          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.24 }}
            className="mb-8 flex w-full max-w-sm flex-col gap-2.5 sm:mb-14 sm:max-w-none sm:flex-row sm:justify-center sm:gap-3"
          >
            <Link href="/signup" className="flex items-center justify-center gap-2 rounded-2xl px-6 py-3 text-sm font-semibold text-on-brand transition-transform hover:scale-[1.02] sm:px-7 sm:py-3.5 sm:text-base"
              style={{ background: BRAND_GRADIENT, boxShadow: "0 12px 36px rgba(6,182,212,0.3)" }}>
              Thử ngay <ArrowRight size={16} />
            </Link>
            <Link href="/login" className="rounded-2xl px-6 py-3 text-sm font-semibold text-slate-700 glass hover:text-slate-900 sm:px-7 sm:py-3.5 sm:text-base">
              Đăng nhập
            </Link>
          </motion.div>

          <div className="grid w-full max-w-3xl grid-cols-1 gap-3 text-left sm:grid-cols-3 sm:gap-4">
            <Feature icon={ClipboardList} iconClass="text-sky-600" title="Trình tạo form" text="Dễ dàng tạo form đăng ký, khảo sát hoặc post-test, chấm điểm cho hội thảo" />
            <Feature icon={QrCode} iconClass="text-cyan-600" title="QR check-in" text="Hệ thống check in bằng QR code, quản lý người tham dự hội thảo và hệ thống auto-mailing chuyên nghiệp." />
            <Feature icon={ShieldCheck} iconClass="text-indigo-600" title="Face VIP" text="Hệ thống nhận diện khuôn mặt hiện đại, tỉ lệ chính xác cao và miễn phí, dùng cho hội thảo chuyên nghiệp." />
          </div>
        </section>

        <footer className="flex items-center justify-center gap-2 pb-1 text-center text-[11px] text-slate-500 sm:pb-2 sm:text-xs">
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
  title: string;
  text: string;
  iconClass: string;
}) {
  return (
    <div className="glass rounded-2xl p-4 sm:p-5">
      <Icon size={18} className={`${iconClass} mb-2 sm:mb-3`} />
      <h3 className="mb-1 text-sm font-semibold text-slate-900">{title}</h3>
      <p className="text-xs leading-5 text-slate-600">{text}</p>
    </div>
  );
}
