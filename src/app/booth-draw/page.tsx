import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft, Dices, LogIn } from "lucide-react";
import { PublicBoothDrawManager } from "@/components/admin/BoothDrawManager";
import { BackgroundMesh } from "@/components/ui/BackgroundMesh";

export const metadata: Metadata = {
  title: "Bốc thăm gian hàng miễn phí | I-solution Manager",
  description: "Quay số gian hàng theo pool, bố trí trên sơ đồ và quản lý trao đổi. Không cần đăng nhập.",
};

export default async function PublicBoothDrawPage({
  searchParams,
}: {
  searchParams: Promise<{ session?: string }>;
}) {
  const { session } = await searchParams;
  const initialSessionId = typeof session === "string" ? session : "";
  return (
    <main className="relative min-h-dvh">
      <BackgroundMesh />
      <header className="sticky top-0 z-40 border-b border-sky-100/70 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-8">
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-sky-700">
            <ArrowLeft size={16} /> Trang chủ
          </Link>
          <div className="inline-flex items-center gap-2 font-bold text-slate-900"><Dices size={18} className="text-sky-500" /> Booth Draw</div>
          <Link href="/login" className="inline-flex items-center gap-2 rounded-xl border border-sky-100 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-sky-50 hover:text-sky-700">
            <LogIn size={14} /> Bản admin
          </Link>
        </div>
      </header>
      <div className="relative z-10">
        <PublicBoothDrawManager initialSessionId={initialSessionId} />
      </div>
    </main>
  );
}
