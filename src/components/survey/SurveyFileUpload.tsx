"use client";
import { useState, useRef } from "react";
import { motion } from "framer-motion";
import { Camera, Upload, X, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";

interface Props {
  surveyId: string;
  questionId: string;
  value: string; // URL of uploaded file
  onChange: (url: string) => void;
  accent?: string;
}

const MAX_SIZE_MB = 5;
const MAX_WIDTH = 1200;
const QUALITY = 0.75;

async function compressImage(file: File): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let { width, height } = img;
      if (width > MAX_WIDTH) {
        height = (height * MAX_WIDTH) / width;
        width = MAX_WIDTH;
      }
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      canvas.toBlob(
        (blob) => resolve(blob ?? file),
        "image/jpeg",
        QUALITY
      );
    };
    img.src = URL.createObjectURL(file);
  });
}

export function SurveyFileUpload({ surveyId, questionId, value, onChange, accent = "#6366f1" }: Props) {
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) {
      setError("Chỉ hỗ trợ file ảnh (JPG, PNG, HEIC)");
      return;
    }
    if (file.size > MAX_SIZE_MB * 1024 * 1024) {
      setError(`File quá lớn (tối đa ${MAX_SIZE_MB}MB)`);
      return;
    }
    setError(null);
    setUploading(true);

    try {
      const compressed = await compressImage(file);
      const path = `${surveyId}/${questionId}/${Date.now()}.jpg`;
      const { error: uploadErr } = await supabase.storage
        .from("survey-uploads")
        .upload(path, compressed, { contentType: "image/jpeg", upsert: true });

      if (uploadErr) {
        setError("Upload thất bại. Thử lại.");
        console.error(uploadErr);
      } else {
        const { data } = supabase.storage.from("survey-uploads").getPublicUrl(path);
        onChange(data.publicUrl);
      }
    } catch {
      setError("Lỗi khi xử lý ảnh");
    } finally {
      setUploading(false);
    }
  };

  const handleRemove = () => {
    onChange("");
  };

  if (value) {
    return (
      <div className="relative">
        <img src={value} alt="Uploaded" className="w-full max-h-48 object-cover rounded-xl border border-slate-200" />
        <button
          onClick={handleRemove}
          className="absolute top-2 right-2 w-7 h-7 rounded-full bg-white/90 border border-slate-200 flex items-center justify-center text-slate-600 hover:text-red-500 shadow-sm"
        >
          <X size={14} />
        </button>
      </div>
    );
  }

  return (
    <div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) handleFile(f);
          e.target.value = "";
        }}
        className="hidden"
      />
      <motion.button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        whileTap={{ scale: 0.98 }}
        className="w-full flex flex-col items-center gap-2 px-4 py-6 rounded-xl border-2 border-dashed transition-all disabled:opacity-60"
        style={{
          borderColor: `${accent}40`,
          background: `${accent}05`,
        }}
      >
        {uploading ? (
          <Loader2 size={24} className="animate-spin" style={{ color: accent }} />
        ) : (
          <>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${accent}15`, color: accent }}>
                <Camera size={20} />
              </div>
              <div className="w-10 h-10 rounded-xl flex items-center justify-center" style={{ background: `${accent}15`, color: accent }}>
                <Upload size={20} />
              </div>
            </div>
            <span className="text-sm font-medium text-slate-700">Chụp ảnh hoặc chọn từ thư viện</span>
            <span className="text-xs text-slate-500">JPG, PNG · Tối đa {MAX_SIZE_MB}MB</span>
          </>
        )}
      </motion.button>
      {error && <p className="text-xs text-red-600 mt-1.5">{error}</p>}
    </div>
  );
}
