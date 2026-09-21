"use client";

import type { WishDrawing } from "@/lib/wish/config";

/** Vẽ lại nét vẽ đã chuẩn hoá (0..1) bằng SVG — dùng cho thumbnail/admin. */
export function DrawingSvg({ drawing, className }: { drawing: WishDrawing; className?: string }) {
  return (
    <svg viewBox="0 0 100 100" className={className} preserveAspectRatio="xMidYMid meet">
      {drawing.strokes.map((stroke, index) => {
        const points: string[] = [];
        for (let i = 0; i + 1 < stroke.p.length; i += 2) {
          points.push(`${(stroke.p[i] ?? 0) * 100},${(stroke.p[i + 1] ?? 0) * 100}`);
        }
        return (
          <polyline
            key={index}
            points={points.join(" ")}
            fill="none"
            stroke={stroke.c}
            strokeWidth={Math.max(0.4, stroke.w * 100)}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        );
      })}
    </svg>
  );
}
