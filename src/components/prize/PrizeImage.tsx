"use client";
import Image from "next/image";
import { useState } from "react";
import { Gift } from "lucide-react";

export function PrizeImage({ src, name, className = "", priority = false }: { src?: string | null; name: string; className?: string; priority?: boolean }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <div className={`relative grid aspect-square place-items-center overflow-hidden rounded-2xl bg-slate-100 ${className}`}>
    {src && src !== failed ? <Image src={src} alt={name} fill sizes="(max-width: 640px) 45vw, 240px" className="object-contain p-3" unoptimized priority={priority} onError={() => setFailed(src)} /> : <Gift size={40} className="text-slate-400" aria-label={name} />}
  </div>;
}
