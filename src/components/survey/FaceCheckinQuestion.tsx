"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { Camera, Check, RotateCcw, ShieldCheck } from "lucide-react";
import { FaceCapture } from "@/components/ekyc/FaceCapture";
import { uploadFacePhoto } from "@/lib/ekyc";
import { supabase } from "@/lib/supabase";

interface FaceCheckinQuestionProps {
  surveyId: string;
  questionId: string;
  accent: string;
  value: string;
  onChange: (url: string) => void;
  faceDataRef: React.MutableRefObject<{ photoUrl: string; embedding: number[]; responseId: string } | null>;
  required?: boolean;
  preview?: boolean;
}

export function FaceCheckinQuestion({ surveyId, questionId, accent, value, onChange, faceDataRef, required, preview = false }: FaceCheckinQuestionProps) {
  const [showCapture, setShowCapture] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [photoUrl, setPhotoUrl] = useState(value);

  const handleConfirm = async (blob: Blob, descriptor: Float32Array | null) => {
    setUploading(true);
    try {
      const tempId = crypto.randomUUID();
      const url = await uploadFacePhoto(blob, tempId, supabase);
      if (url) {
        setPhotoUrl(url);
        onChange(url);
        if (descriptor) {
          faceDataRef.current = {
            photoUrl: url,
            embedding: Array.from(descriptor),
            responseId: "",
          };
        }
      }
    } finally {
      setUploading(false);
      setShowCapture(false);
    }
  };

  const handleSkip = () => {
    setShowCapture(false);
  };

  const handleRetake = () => {
    setPhotoUrl("");
    onChange("");
    faceDataRef.current = null;
    setShowCapture(true);
  };

  if (preview) {
    return (
      <div
        className="w-full rounded-2xl border-2 border-dashed px-5 py-6 flex flex-col items-center gap-3 text-center"
        style={{ borderColor: `${accent}35`, backgroundColor: `${accent}08` }}
      >
        <div className="w-14 h-14 rounded-full flex items-center justify-center" style={{ backgroundColor: `${accent}15` }}>
          <Camera size={24} style={{ color: accent }} />
        </div>
        <div>
          <p className="font-medium text-slate-700">
            Chụp ảnh chân dung
            {required && <span className="text-red-500 ml-0.5">*</span>}
          </p>
          <p className="text-xs text-slate-500 mt-1">
            Camera được tắt trong chế độ preview để tránh treo dashboard.
          </p>
        </div>
      </div>
    );
  }

  if (showCapture) {
    return (
      <FaceCapture
        surveyId={surveyId}
        onConfirm={handleConfirm}
        onCancel={() => setShowCapture(false)}
        onSkip={handleSkip}
      />
    );
  }

  if (photoUrl) {
    return (
      <div className="flex flex-col items-center gap-3">
        <div className="relative w-32 h-32 rounded-2xl overflow-hidden border-2 border-emerald-500/30">
          <img src={photoUrl} alt="Portrait" className="w-full h-full object-cover" />
          <div className="absolute inset-0 flex items-center justify-center bg-emerald-500/10">
            <ShieldCheck size={28} className="text-emerald-500" />
          </div>
        </div>
        <div className="flex items-center gap-1.5 text-emerald-600 text-sm font-medium">
          <Check size={16} />
          Đã chụp ảnh chân dung
        </div>
        <button
          onClick={handleRetake}
          className="text-sm text-slate-500 hover:text-slate-700 flex items-center gap-1 transition-colors"
        >
          <RotateCcw size={14} />
          Chụp lại
        </button>
      </div>
    );
  }

  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={() => setShowCapture(true)}
      disabled={uploading}
      className="w-full py-8 rounded-2xl border-2 border-dashed flex flex-col items-center gap-3 transition-colors"
      style={{ borderColor: `${accent}40`, backgroundColor: `${accent}08` }}
    >
      <div className="w-16 h-16 rounded-full flex items-center justify-center" style={{ backgroundColor: `${accent}15` }}>
        <Camera size={28} style={{ color: accent }} />
      </div>
      <div className="text-center">
        <p className="font-medium text-slate-700">
          Chụp ảnh chân dung
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </p>
        <p className="text-xs text-slate-500 mt-0.5">Ảnh sẽ được dùng để xác thực VIP tại sự kiện</p>
      </div>
    </motion.button>
  );
}
