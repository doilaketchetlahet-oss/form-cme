"use client";
import { useRef, useState, useEffect } from "react";
import { Trash2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Props {
  surveyId: string;
  questionId: string;
  value: string; // URL of uploaded signature
  onChange: (url: string) => void;
  accent?: string;
}

export function SurveySignaturePad({ surveyId, questionId, value, onChange, accent = "#6366f1" }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [drawing, setDrawing] = useState(false);
  const [hasStrokes, setHasStrokes] = useState(false);
  const [uploading, setUploading] = useState(false);
  const lastPos = useRef<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    // Set canvas size to match display size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * 2;
    canvas.height = rect.height * 2;
    ctx.scale(2, 2);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.lineWidth = 2;
    ctx.strokeStyle = "#1e293b";
  }, []);

  const getPos = (e: React.TouchEvent | React.MouseEvent): { x: number; y: number } => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    if ("touches" in e) {
      return { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
    }
    return { x: (e as React.MouseEvent).clientX - rect.left, y: (e as React.MouseEvent).clientY - rect.top };
  };

  const startDraw = (e: React.TouchEvent | React.MouseEvent) => {
    e.preventDefault();
    setDrawing(true);
    lastPos.current = getPos(e);
  };

  const draw = (e: React.TouchEvent | React.MouseEvent) => {
    if (!drawing) return;
    e.preventDefault();
    const ctx = canvasRef.current?.getContext("2d");
    if (!ctx || !lastPos.current) return;
    const pos = getPos(e);
    ctx.beginPath();
    ctx.moveTo(lastPos.current.x, lastPos.current.y);
    ctx.lineTo(pos.x, pos.y);
    ctx.stroke();
    lastPos.current = pos;
    setHasStrokes(true);
  };

  const endDraw = () => {
    setDrawing(false);
    lastPos.current = null;
  };

  const clear = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    setHasStrokes(false);
    onChange("");
  };

  const save = async () => {
    const canvas = canvasRef.current;
    if (!canvas || !hasStrokes) return;
    setUploading(true);
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.toBlob(resolve, "image/png")
      );
      if (!blob) { setUploading(false); return; }
      const path = `${surveyId}/sig-${questionId}-${Date.now()}.png`;
      const { error } = await supabase.storage
        .from("survey-uploads")
        .upload(path, blob, { contentType: "image/png", upsert: true });
      if (!error) {
        const { data } = supabase.storage.from("survey-uploads").getPublicUrl(path);
        onChange(data.publicUrl);
      }
    } catch { /* ignore */ }
    setUploading(false);
  };

  if (value) {
    return (
      <div className="relative">
        <img src={value} alt="Chữ ký" className="w-full h-24 object-contain rounded-xl border border-slate-200 bg-white" />
        <button onClick={clear}
          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 border border-slate-200 flex items-center justify-center text-slate-600 hover:text-red-500 shadow-sm">
          <Trash2 size={12} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="relative rounded-xl border-2 border-dashed overflow-hidden bg-white"
        style={{ borderColor: hasStrokes ? accent : "#e2e8f0" }}>
        <canvas
          ref={canvasRef}
          className="w-full h-32 touch-none cursor-crosshair"
          onMouseDown={startDraw}
          onMouseMove={draw}
          onMouseUp={endDraw}
          onMouseLeave={endDraw}
          onTouchStart={startDraw}
          onTouchMove={draw}
          onTouchEnd={endDraw}
        />
        {!hasStrokes && (
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <span className="text-sm text-slate-400">Ký tên tại đây ✍️</span>
          </div>
        )}
      </div>
      <div className="flex items-center justify-between mt-2">
        <button onClick={clear} disabled={!hasStrokes}
          className="text-xs text-slate-500 hover:text-red-500 disabled:opacity-30 transition-colors flex items-center gap-1">
          <Trash2 size={11} /> Xoá
        </button>
        <button onClick={save} disabled={!hasStrokes || uploading}
          className="text-xs font-semibold px-3 py-1.5 rounded-lg text-on-brand disabled:opacity-40"
          style={{ background: accent }}>
          {uploading ? "..." : "Xác nhận chữ ký"}
        </button>
      </div>
    </div>
  );
}
