import Link from "next/link";
import { Lock, ArrowRight, QrCode } from "lucide-react";
import { BackgroundMesh } from "@/components/ui/BackgroundMesh";

export default function SignupPage() {
  return (
    <main className="relative min-h-dvh">
      <BackgroundMesh />
      <div className="relative z-10 min-h-dvh flex flex-col items-center justify-center px-4 py-16">
        <Link href="/" className="flex items-center gap-2 mb-12">
          <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: "linear-gradient(135deg, #0ea5e9, #06b6d4)", boxShadow: "0 6px 18px rgba(6,182,212,0.3)" }}>
            <QrCode size={16} className="text-on-brand" />
          </div>
          <span className="text-xl font-semibold tracking-tight text-slate-900">Form CME</span>
        </Link>

        <div className="glass rounded-2xl p-8 w-full max-w-sm text-center">
          <div className="w-14 h-14 rounded-2xl mx-auto mb-5 flex items-center justify-center bg-sky-50 border border-sky-200 text-sky-600">
            <Lock size={24} />
          </div>
          <h1 className="text-2xl font-bold text-slate-900 mb-2">Đăng ký đã khóa</h1>
          <p className="text-sm text-slate-600 mb-6">
            Tài khoản quản trị được tạo trực tiếp trong Supabase Auth. Vui lòng dùng tài khoản nội bộ đã được cấp.
          </p>
          <Link
            href="/login"
            className="w-full py-3 rounded-xl font-semibold text-on-brand flex items-center justify-center gap-2"
            style={{ background: "linear-gradient(135deg, #0ea5e9, #0284c7)" }}
          >
            Đăng nhập <ArrowRight size={16} />
          </Link>
        </div>
      </div>
    </main>
  );
}