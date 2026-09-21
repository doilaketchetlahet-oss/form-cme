"use client";

import { useCallback, useEffect, useRef } from "react";
import type { WishStroke } from "@/lib/wish/config";

type Props = {
  strokes: WishStroke[];
  onStrokesChange: (strokes: WishStroke[]) => void;
  color: string;
  /** Độ dày bút theo pixel màn hình. */
  brushSize: number;
  className?: string;
};

/** Khung vẽ tay hình vuông; nét lưu dạng chuẩn hoá 0..1 để LED vẽ lại đúng tỉ lệ. */
export function DrawingPad({ strokes, onStrokesChange, color, brushSize, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const currentRef = useRef<{ x: number; y: number }[] | null>(null);

  const paint = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = Math.max(1, rect.width);
    const h = Math.max(1, rect.height);
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const current = currentRef.current;
    const all: WishStroke[] = current
      ? [...strokes, { c: color, w: Math.max(0.002, brushSize / w), p: flatten(current) }]
      : strokes;

    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of all) {
      if (stroke.p.length < 2) continue;
      ctx.strokeStyle = stroke.c;
      ctx.lineWidth = Math.max(1, stroke.w * w);
      ctx.beginPath();
      ctx.moveTo((stroke.p[0] ?? 0) * w, (stroke.p[1] ?? 0) * h);
      for (let i = 2; i + 1 < stroke.p.length; i += 2) {
        ctx.lineTo((stroke.p[i] ?? 0) * w, (stroke.p[i + 1] ?? 0) * h);
      }
      ctx.stroke();
    }
  }, [brushSize, color, strokes]);

  useEffect(() => {
    paint();
  }, [paint]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const observer = new ResizeObserver(() => paint());
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [paint]);

  const pointFromEvent = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    return {
      x: Math.min(1, Math.max(0, (event.clientX - rect.left) / rect.width)),
      y: Math.min(1, Math.max(0, (event.clientY - rect.top) / rect.height)),
    };
  };

  const handleDown = (event: React.PointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    currentRef.current = [pointFromEvent(event)];
    paint();
  };

  const handleMove = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const points = currentRef.current;
    if (!points) return;
    const point = pointFromEvent(event);
    const last = points[points.length - 1];
    // Bỏ điểm quá sát nhau để nét mượt và payload nhẹ.
    if (last && Math.hypot(point.x - last.x, point.y - last.y) < 0.004) return;
    points.push(point);
    paint();
  };

  const handleUp = () => {
    const points = currentRef.current;
    currentRef.current = null;
    if (!points || points.length < 2) {
      paint();
      return;
    }
    const rect = canvasRef.current?.getBoundingClientRect();
    const width = rect?.width ?? 1;
    onStrokesChange([
      ...strokes,
      { c: color, w: Math.max(0.002, brushSize / width), p: flatten(points) },
    ]);
  };

  return (
    <canvas
      ref={canvasRef}
      onPointerDown={handleDown}
      onPointerMove={handleMove}
      onPointerUp={handleUp}
      onPointerCancel={handleUp}
      className={className}
      style={{ touchAction: "none" }}
    />
  );
}

function flatten(points: { x: number; y: number }[]) {
  const out: number[] = [];
  for (const point of points) {
    out.push(Math.round(point.x * 1000) / 1000, Math.round(point.y * 1000) / 1000);
  }
  return out;
}
