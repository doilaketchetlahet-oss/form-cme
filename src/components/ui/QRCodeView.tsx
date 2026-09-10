"use client";

import { useMemo, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { buildQrImagePath } from "@/lib/qr-style";
import type { QRBranding } from "@/lib/surveys";

interface Props {
  value: string;
  size?: number;
  qrStyle?: QRBranding | null;
}

function qrSrc(value: string, size: number, qrStyle?: QRBranding | null) {
  return buildQrImagePath(value, size, qrStyle);
}

export function QRCodeView({ value, size = 180, qrStyle }: Props) {
  const [modalOpen, setModalOpen] = useState(false);
  const src = useMemo(() => qrSrc(value, size, qrStyle), [value, size, qrStyle]);
  const modalSize = typeof window !== "undefined" ? Math.min(window.innerWidth - 80, 420) : 360;
  const modalSrc = useMemo(() => qrSrc(value, modalSize, qrStyle), [value, modalSize, qrStyle]);

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="rounded-2xl bg-white p-3 cursor-pointer hover:scale-105 transition-transform"
        style={{ width: size + 24, height: size + 24 }}
        title="Bấm để phóng to QR"
      >
        <img src={src} alt="Mã QR check-in" width={size} height={size} className="block h-auto w-full" />
      </button>

      <AnimatePresence>
        {modalOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setModalOpen(false)}
            className="fixed inset-0 z-50 bg-black/70 backdrop-blur-md flex items-center justify-center cursor-pointer"
          >
            <motion.div
              initial={{ scale: 0.7, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.7, opacity: 0 }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              onClick={(e) => e.stopPropagation()}
              className="bg-white rounded-3xl p-6 shadow-2xl flex flex-col items-center gap-4"
            >
              <img src={modalSrc} alt="Mã QR check-in phóng to" width={modalSize} height={modalSize} className="block h-auto max-w-full" />
              <p className="text-sm text-slate-600 font-medium">Quét mã để check-in</p>
              <p className="text-xs text-slate-400">Bấm ra ngoài để đóng</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}
