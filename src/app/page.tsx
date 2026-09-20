"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { motion } from "framer-motion";
import {
  ArrowRight,
  BarChart3,
  ClipboardList,
  Gamepad2,
  Mail,
  QrCode,
  ScanFace,
  Sparkles,
  Users,
} from "lucide-react";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { GAME_MODULES } from "@/lib/game/catalog";

const AnimatedBackground = dynamic(
  () => import("@/components/ui/AnimatedBackground").then((m) => ({ default: m.AnimatedBackground })),
  { ssr: false },
);

const BRAND_GRADIENT = "linear-gradient(135deg, #0ea5e9, #06b6d4)";

const HERO_STATS = [
  { value: "18", label: "Game tương tác" },
  { value: "6", label: "Nhóm tính năng" },
  { value: "02", label: "Cách check-in: QR & khuôn mặt" },
  { value: "24/7", label: "Gửi email tự động" },
];

const FEATURES = [
  {
    icon: ClipboardList,
    emoji: "📋",
    title: "Form đăng ký & chấm điểm CME",
    text: "Tạo form tùy chỉnh đầy đủ trường, khảo sát, post-test và chấm điểm cho hội thảo.",
    href: "/admin/forms",
    cta: "Mở form",
  },
  {
    icon: QrCode,
    emoji: "📷",
    title: "Quét QR check-in",
    text: "Quét mã QR ngay trên trình duyệt điện thoại, xác nhận tham dự nhanh và chính xác.",
    href: "/admin/forms",
    cta: "Bắt đầu",
  },
  {
    icon: ScanFace,
    emoji: "🧑",
    title: "Face Check-in VIP",
    text: "Nhận diện khuôn mặt ngay trên trình duyệt, không cần thiết bị đầu đọc chuyên dụng.",
    href: "/admin/forms",
    cta: "Bắt đầu",
  },
  {
    icon: Gamepad2,
    emoji: "🎮",
    title: "Thư viện game",
    text: "18 game tương tác cho hội thảo: Quiz, Lucky Wheel, Trúc Xanh, Chém Hoa Quả…",
    href: "/games",
    cta: "Chơi thử",
  },
  {
    icon: Mail,
    emoji: "✉️",
    title: "Email tự động (Resend)",
    text: "Gửi email xác nhận, nhắc nhở và thiệp mời PDF cá nhân hóa với template chuyên nghiệp.",
    href: "/admin/templates",
    cta: "Cấu hình",
  },
  {
    icon: BarChart3,
    emoji: "📊",
    title: "Báo cáo & thống kê",
    text: "Theo dõi lượt đăng ký, check-in theo khung giờ và xuất dữ liệu QR/Excel dễ dàng.",
    href: "/admin/forms",
    cta: "Xem báo cáo",
  },
];

const STEPS = [
  { title: "Tạo form đăng ký", text: "Chọn loại form, thêm câu hỏi và cấu hình thời gian mở/đóng." },
  { title: "Cấu hình email & QR", text: "Soạn template thư, bật QR check-in và thiệp mời PDF cá nhân hóa." },
  { title: "Check-in bằng QR / khuôn mặt", text: "Phát QR cho người tham dự, quét tại sự kiện bằng điện thoại." },
  { title: "Game & báo cáo", text: "Chạy game tương tác, tổng hợp dữ liệu và xuất danh sách." },
];

const GAME_BADGES: Record<string, string> = {
  quiz: "Hot",
  wheel: "Live",
  trucxanh: "Fun",
  handslice: "AR",
  jigsaw: "Mới",
  picword: "Hot",
};

const FEATURED_GAME_IDS = ["quiz", "wheel", "trucxanh", "handslice", "jigsaw", "picword"];

export default function HomePage() {
  const [signedIn, setSignedIn] = useState(false);

  useEffect(() => {
    let mounted = true;
    supabase.auth
      .getSession()
      .then(({ data: { session } }) => {
        if (mounted) setSignedIn(!!session);
      })
      .catch(() => undefined);
    return () => {
      mounted = false;
    };
  }, []);

  const featuredGames = FEATURED_GAME_IDS.map((id) => GAME_MODULES.find((m) => m.id === id)).filter(
    (m): m is (typeof GAME_MODULES)[number] => Boolean(m),
  );

  return (
    <main className="relative min-h-dvh overflow-x-hidden">
      <AnimatedBackground />

      <div className="relative z-10">
        {/* ── NAV ── */}
        <header className="sticky top-0 z-40 border-b border-sky-100/70 bg-white/80 backdrop-blur-xl">
          <div className="mx-auto flex h-16 w-full max-w-6xl items-center justify-between gap-3 px-4 sm:px-6">
            <Link href="/" className="flex min-w-0 items-center gap-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl" style={{ background: BRAND_GRADIENT, boxShadow: "0 6px 20px rgba(6,182,212,0.3)" }}>
                <QrCode size={18} className="text-on-brand" />
              </div>
              <span className="truncate text-sm font-semibold tracking-tight text-slate-900 sm:text-base">
                I-solution <span className="text-sky-600">Manager</span>
              </span>
            </Link>

            <nav className="hidden items-center gap-1 md:flex">
              <a href="#features" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-sky-50 hover:text-sky-700">Tính năng</a>
              <a href="#how" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-sky-50 hover:text-sky-700">Quy trình</a>
              <a href="#games" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-sky-50 hover:text-sky-700">Thư viện game</a>
              <Link href="/login" className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 hover:bg-sky-50 hover:text-sky-700">Đăng nhập</Link>
            </nav>

            <div className="flex shrink-0 items-center gap-2">
              <Link href="/login" className="rounded-xl px-3 py-2 text-xs font-medium text-slate-600 glass hover:text-slate-900 md:hidden">
                Đăng nhập
              </Link>
              <Link
                href={signedIn ? "/admin" : "/signup"}
                className="flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-semibold text-on-brand sm:px-4 sm:text-sm"
                style={{ background: BRAND_GRADIENT, boxShadow: "0 8px 24px rgba(6,182,212,0.28)" }}
              >
                {signedIn ? "Vào dashboard" : "Thử ngay"} <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </header>

        {/* ── HERO ── */}
        <section className="relative overflow-hidden px-4 pt-14 pb-12 sm:px-6 sm:pt-24 sm:pb-20">
          <div className="pointer-events-none absolute -top-24 left-1/2 h-72 w-[36rem] -translate-x-1/2 rounded-full bg-sky-300/25 blur-3xl" />
          <div className="relative mx-auto w-full max-w-5xl text-center">
            <motion.span
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="inline-flex items-center gap-2 rounded-full border border-sky-200 bg-white/70 px-3 py-1 text-[11px] font-semibold text-sky-700 sm:px-3.5 sm:py-1.5 sm:text-xs"
            >
              <Sparkles size={12} className="text-sky-500" />
              Nền tảng hội thảo All-in-One
            </motion.span>

            <motion.h1
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.06 }}
              className="font-display mx-auto mt-4 max-w-[20ch] text-[2rem] leading-[1.1] font-black tracking-tight text-slate-900 text-balance sm:mt-6 sm:max-w-3xl sm:text-5xl md:text-6xl"
            >
              Quản lý hội thảo <span className="bg-gradient-to-r from-sky-600 to-cyan-500 bg-clip-text text-transparent">chuyên nghiệp</span> & dễ dàng
            </motion.h1>

            <motion.p
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.12 }}
              className="mx-auto mt-4 max-w-md text-sm leading-relaxed text-slate-600 sm:mt-6 sm:max-w-2xl sm:text-lg"
            >
              Tất cả công cụ bạn cần: form đăng ký CME, QR check-in, face check-in VIP, email tự động và 18 game tương tác — trong một nền tảng duy nhất.
            </motion.p>

            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.18 }}
              className="mx-auto mt-7 flex w-full max-w-sm flex-col gap-2.5 sm:mt-9 sm:max-w-none sm:flex-row sm:justify-center sm:gap-3"
            >
              <Link
                href={signedIn ? "/admin" : "/signup"}
                className="flex items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-bold text-on-brand transition-transform hover:scale-[1.02] sm:text-base"
                style={{ background: BRAND_GRADIENT, boxShadow: "0 14px 40px rgba(6,182,212,0.32)" }}
              >
                {signedIn ? "Vào dashboard" : "Bắt đầu miễn phí"} <ArrowRight size={16} />
              </Link>
              <Link href="/games" className="flex items-center justify-center gap-2 rounded-2xl px-6 py-3.5 text-sm font-semibold text-slate-700 glass hover:text-slate-900 sm:text-base">
                Khám phá thư viện game
              </Link>
            </motion.div>

            <div className="mx-auto mt-10 grid w-full max-w-3xl grid-cols-2 gap-3 sm:mt-14 sm:grid-cols-4 sm:gap-4">
              {HERO_STATS.map((stat) => (
                <div key={stat.label} className="glass rounded-2xl px-3 py-3.5 text-center sm:px-4 sm:py-4">
                  <div className="font-display text-xl font-black text-slate-900 sm:text-2xl">{stat.value}</div>
                  <div className="mt-0.5 text-[11px] leading-snug text-slate-500 sm:text-xs">{stat.label}</div>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── FEATURES ── */}
        <section id="features" className="scroll-mt-20 px-4 py-12 sm:px-6 sm:py-20">
          <div className="mx-auto w-full max-w-6xl">
            <SectionHeading
              eyebrow="Tính năng"
              title="Tất cả trong một nền tảng"
              text="Từ đăng ký, check-in QR/khuôn mặt đến game tương tác và gửi mail tự động."
            />
            <div className="mt-8 grid grid-cols-1 gap-3 sm:mt-12 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <motion.div
                  key={feature.title}
                  initial={{ opacity: 0, y: 14 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true, margin: "-60px" }}
                  className="glass group flex flex-col rounded-2xl p-5 sm:p-6"
                >
                  <span className="text-2xl">{feature.emoji}</span>
                  <h3 className="mt-3 text-base font-bold text-slate-900">{feature.title}</h3>
                  <p className="mt-1.5 flex-1 text-sm leading-6 text-slate-600">{feature.text}</p>
                  <Link href={feature.href} className="mt-4 inline-flex items-center gap-1.5 text-sm font-semibold text-sky-600 hover:text-sky-700">
                    {feature.cta} <ArrowRight size={14} className="transition-transform group-hover:translate-x-0.5" />
                  </Link>
                </motion.div>
              ))}
            </div>
          </div>
        </section>

        {/* ── HOW ── */}
        <section id="how" className="scroll-mt-20 px-4 py-12 sm:px-6 sm:py-20">
          <div className="mx-auto w-full max-w-6xl">
            <SectionHeading
              eyebrow="Quy trình"
              title="Hoạt động như thế nào?"
              text="4 bước đơn giản để tổ chức một hội thảo hoàn chỉnh."
            />
            <div className="mt-8 grid grid-cols-1 gap-3 sm:mt-12 sm:grid-cols-2 sm:gap-4 lg:grid-cols-4">
              {STEPS.map((step, index) => (
                <div key={step.title} className="glass relative rounded-2xl p-5">
                  <div
                    className="flex h-9 w-9 items-center justify-center rounded-xl text-sm font-black text-on-brand"
                    style={{ background: BRAND_GRADIENT }}
                  >
                    {index + 1}
                  </div>
                  <h3 className="mt-3 text-sm font-bold text-slate-900 sm:text-base">{step.title}</h3>
                  <p className="mt-1.5 text-sm leading-6 text-slate-600">{step.text}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ── GAMES ── */}
        <section id="games" className="scroll-mt-20 px-4 py-12 sm:px-6 sm:py-20">
          <div className="mx-auto w-full max-w-6xl">
            <SectionHeading
              eyebrow="Game"
              title="Thư viện game tương tác"
              text="Tăng tương tác và sự gắn kết cho hội thảo của bạn."
            />
            <div className="mt-8 grid grid-cols-1 gap-3 sm:mt-12 sm:grid-cols-2 sm:gap-4 lg:grid-cols-3">
              {featuredGames.map((game) => (
                <Link
                  key={game.id}
                  href="/games"
                  className="glass group flex items-center gap-4 rounded-2xl p-4 transition-transform hover:-translate-y-0.5 sm:p-5"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-sky-50 text-2xl">{game.icon}</span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="truncate text-sm font-bold text-slate-900">{game.name}</span>
                      <span className="rounded-full bg-sky-100 px-2 py-0.5 text-[10px] font-bold text-sky-700">
                        {GAME_BADGES[game.id] ?? "Game"}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-slate-500">{game.tagline}</span>
                  </span>
                  <ArrowRight size={16} className="shrink-0 text-sky-500 transition-transform group-hover:translate-x-0.5" />
                </Link>
              ))}
            </div>
            <div className="mt-6 text-center">
              <Link href="/games" className="inline-flex items-center gap-1.5 text-sm font-semibold text-sky-600 hover:text-sky-700">
                Xem tất cả {GAME_MODULES.length} game <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </section>

        {/* ── CTA ── */}
        <section className="px-4 py-12 sm:px-6 sm:py-20">
          <div
            className="mx-auto w-full max-w-5xl overflow-hidden rounded-3xl px-6 py-10 text-center sm:px-12 sm:py-16"
            style={{ background: "linear-gradient(135deg, #0284c7 0%, #0ea5e9 55%, #06b6d4 100%)", boxShadow: "0 24px 60px rgba(6,182,212,0.32)" }}
          >
            <p className="text-xs font-bold tracking-wider text-sky-100 uppercase">Bắt đầu ngay</p>
            <h2 className="font-display mt-3 text-2xl font-black text-white sm:text-4xl">Sẵn sàng tổ chức hội thảo tiếp theo?</h2>
            <p className="mx-auto mt-3 max-w-xl text-sm text-sky-50 sm:text-base">
              Miễn phí bắt đầu — tạo form, gửi QR check-in và chạy game chỉ trong vài phút.
            </p>
            <div className="mx-auto mt-7 flex w-full max-w-sm flex-col gap-2.5 sm:max-w-none sm:flex-row sm:justify-center sm:gap-3">
              <Link href={signedIn ? "/admin" : "/signup"} className="flex items-center justify-center gap-2 rounded-2xl bg-white px-6 py-3.5 text-sm font-bold text-sky-700 transition-transform hover:scale-[1.02] sm:text-base">
                {signedIn ? "Vào dashboard" : "Tạo tài khoản"}
              </Link>
              <Link href="/games" className="flex items-center justify-center gap-2 rounded-2xl border border-white/40 px-6 py-3.5 text-sm font-semibold text-white hover:bg-white/10 sm:text-base">
                Khám phá game
              </Link>
            </div>
          </div>
        </section>

        {/* ── FOOTER ── */}
        <footer className="border-t border-sky-100/70 bg-white/60 px-4 py-10 sm:px-6">
          <div className="mx-auto grid w-full max-w-6xl grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl" style={{ background: BRAND_GRADIENT }}>
                  <QrCode size={18} className="text-on-brand" />
                </div>
                <span className="text-sm font-semibold text-slate-900">I-solution Manager</span>
              </div>
              <p className="mt-3 text-xs leading-5 text-slate-500">
                Nền tảng quản lý hội thảo trực tuyến all-in-one cho y tế và giáo dục.
              </p>
            </div>

            <FooterColumn
              title="Công cụ"
              links={[
                { label: "Form CME", href: "/admin/forms" },
                { label: "QR check-in", href: "/admin/forms" },
                { label: "Template email", href: "/admin/templates" },
                { label: "Báo cáo", href: "/admin/forms" },
              ]}
            />
            <FooterColumn
              title="Nội dung"
              links={[
                { label: "Thư viện game", href: "/games" },
                { label: "Đăng nhập", href: "/login" },
                { label: "Đăng ký", href: "/signup" },
              ]}
            />
            <div>
              <h3 className="text-xs font-bold tracking-wider text-slate-900 uppercase">Liên hệ</h3>
              <ul className="mt-3 space-y-2 text-xs text-slate-500">
                <li>
                  <a href="mailto:hotro@hoithaotructuyen.net" className="hover:text-sky-600">hotro@hoithaotructuyen.net</a>
                </li>
                <li>Hỗ trợ qua email trong giờ làm việc</li>
              </ul>
            </div>
          </div>
          <div className="mx-auto mt-8 flex w-full max-w-6xl items-center justify-center gap-2 border-t border-sky-100 pt-6 text-center text-[11px] text-slate-500 sm:text-xs">
            <Users size={12} /> © 2026 Phi Lao · I-solution Manager
          </div>
        </footer>
      </div>
    </main>
  );
}

function SectionHeading({ eyebrow, title, text }: { eyebrow: string; title: string; text: string }) {
  return (
    <div className="mx-auto max-w-2xl text-center">
      <span className="text-[11px] font-bold tracking-wider text-sky-600 uppercase sm:text-xs">{eyebrow}</span>
      <h2 className="font-display mt-2 text-2xl font-black tracking-tight text-slate-900 sm:text-4xl">{title}</h2>
      <p className="mt-2 text-sm text-slate-600 sm:text-base">{text}</p>
    </div>
  );
}

function FooterColumn({ title, links }: { title: string; links: { label: string; href: string }[] }) {
  return (
    <div>
      <h3 className="text-xs font-bold tracking-wider text-slate-900 uppercase">{title}</h3>
      <ul className="mt-3 space-y-2 text-xs text-slate-500">
        {links.map((link) => (
          <li key={link.label}>
            <Link href={link.href} className="hover:text-sky-600">{link.label}</Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
