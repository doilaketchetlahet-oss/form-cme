"use client";
import { useRef, useState } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Props {
  label: string;
  value: string | null | undefined;
  onChange: (url: string | null) => void;
  /** Target max width for compression. Background: 1920, logo: 600. */
  maxWidth?: number;
  /** Preview aspect hint for the box. */
  aspect?: "wide" | "square";
}

async function compress(file: File, maxWidth: number): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let { width, height } = img;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      const isLogo = maxWidth <= 600;
      canvas.toBlob((b) => resolve(b ?? file), isLogo ? "image/png" : "image/jpeg", 0.82);
    };
    img.src = URL.createObjectURL(file);
  });
}

/** Delete a previously uploaded theme file (by its public URL) to avoid orphans. */
async function deleteByUrl(url: string | null | undefined) {
  if (!url) return;
  const marker = "/survey-uploads/";
  const i = url.indexOf(marker);
  if (i === -1) return;
  const path = url.slice(i + marker.length).split("?")[0];
  if (path.startsWith("theme/")) {
    await supabase.storage.from("survey-uploads").remove([path]).catch(() => {});
  }
}

export function ThemeImageUpload({ label, value, onChange, maxWidth = 1920, aspect = "wide" }: Props) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const blob = await compress(file, maxWidth);
      const ext = blob.type === "image/png" ? "png" : "jpg";
      const path = `theme/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
      const { error } = await supabase.storage.from("survey-uploads").upload(path, blob, { contentType: blob.type, upsert: true });
      if (!error) {
        const { data } = supabase.storage.from("survey-uploads").getPublicUrl(path);
        deleteByUrl(value); // remove previous image to avoid orphan
        onChange(data.publicUrl);
      }
    } catch { /* ignore */ }
    setUploading(false);
  };

  return (
    <div>
      <label className="text-[11px] text-slate-400 mb-1 block">{label}</label>
      <input ref={inputRef} type="file" accept="image/*" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; if (f) handleFile(f); e.target.value = ""; }} />
      {value ? (
        <div className="relative">
          <div className={`rounded-lg overflow-hidden border border-white/10 bg-white/5 ${aspect === "wide" ? "aspect-video" : "aspect-square w-24"}`}>
            <img src={value} alt={label} className={`w-full h-full ${aspect === "wide" ? "object-cover" : "object-contain p-2"}`} />
          </div>
          <button onClick={() => { deleteByUrl(value); onChange(null); }}
            className="absolute top-1 right-1 w-6 h-6 rounded-full bg-black/60 flex items-center justify-center text-on-brand hover:bg-red-500/80">
            <X size={12} />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading}
          className={`flex flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-slate-300 hover:border-sky-400 text-slate-500 hover:text-sky-500 transition-colors ${aspect === "wide" ? "w-full aspect-video" : "w-24 aspect-square"}`}>
          {uploading ? <Loader2 size={18} className="animate-spin" /> : <><Upload size={16} /><span className="text-[10px]">Tải ảnh</span></>}
        </button>
      )}
    </div>
  );
}
