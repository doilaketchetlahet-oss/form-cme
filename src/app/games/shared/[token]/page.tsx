import Link from "next/link";
import { validShareToken } from "@/lib/game/shares";

export const metadata = { title: "Game được chia sẻ | EventPlay", referrer: "no-referrer" as const, robots: { index: false, follow: false } };

export default async function SharedGamePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!validShareToken(token)) return <div className="flex min-h-dvh flex-col items-center justify-center gap-4"><p>Link chia sẻ không hợp lệ.</p><Link href="/games">Về thư viện game</Link></div>;
  return <div className="h-dvh bg-slate-50">
    <iframe src={`/studio/index.html#/shared/${token}`} title="Game được chia sẻ" className="h-full w-full border-0" referrerPolicy="no-referrer"
      allow="camera; microphone; fullscreen; autoplay; clipboard-write" allowFullScreen />
  </div>;
}
