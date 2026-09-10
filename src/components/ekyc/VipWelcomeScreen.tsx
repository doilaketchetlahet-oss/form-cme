"use client";
import { useEffect, useMemo, useState, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { CheckCircle } from "lucide-react";

interface VipWelcomeScreenProps {
  name: string;
  hall?: string;
  onComplete: () => void;
}

function Particle({ delay, x }: { delay: number; x: number }) {
  return (
    <motion.div
      className="absolute w-2 h-2 rounded-full bg-white/30"
      initial={{ opacity: 0, y: "100vh", x: `${x}vw`, scale: 0 }}
      animate={{ opacity: [0, 0.8, 0], y: "-10vh", scale: [0, 1.5, 0.5] }}
      transition={{ duration: 4, delay, repeat: Infinity, ease: "easeOut" }}
    />
  );
}

export function VipWelcomeScreen({ name, hall, onComplete }: VipWelcomeScreenProps) {
  const [phase, setPhase] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 300);
    const t2 = setTimeout(() => setPhase(2), 800);
    const t3 = setTimeout(() => setPhase(3), 1400);
    timerRef.current = setTimeout(() => {
      onComplete();
    }, 5000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [onComplete]);

  const particles = useMemo(() => Array.from({ length: 20 }, (_, i) => ({
    id: i,
    delay: ((i * 37) % 30) / 10,
    x: (i * 53) % 100,
  })), []);

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[60] flex flex-col items-center justify-center overflow-hidden"
      style={{
        background: "linear-gradient(135deg, #0284c7 0%, #0ea5e9 30%, #06b6d4 70%, #0e7490 100%)",
      }}
    >
      {particles.map((p) => (
        <Particle key={p.id} delay={p.delay} x={p.x} />
      ))}

      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        <motion.div
          className="absolute w-[600px] h-[600px] rounded-full bg-sky-400/10 blur-3xl"
          style={{ top: "10%", left: "10%" }}
          animate={{ scale: [1, 1.3, 1], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 6, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          className="absolute w-[500px] h-[500px] rounded-full bg-teal-400/10 blur-3xl"
          style={{ bottom: "10%", right: "10%" }}
          animate={{ scale: [1.3, 1, 1.3], opacity: [0.3, 0.5, 0.3] }}
          transition={{ duration: 5, repeat: Infinity, ease: "easeInOut" }}
        />
      </div>

      <div className="relative z-10 flex flex-col items-center gap-4 px-6 text-center">
        <AnimatePresence>
          {phase >= 0 && (
            <motion.div
              initial={{ scale: 0, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              transition={{ type: "spring", stiffness: 200, damping: 12 }}
              className="w-28 h-28 rounded-full bg-white/15 backdrop-blur-lg flex items-center justify-center mb-2"
            >
              <CheckCircle size={64} className="text-on-brand" strokeWidth={1.5} />
            </motion.div>
          )}
        </AnimatePresence>

        <motion.p
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: phase >= 1 ? 0 : 20, opacity: phase >= 1 ? 1 : 0 }}
          transition={{ duration: 0.5 }}
          className="text-white/70 text-lg font-medium"
        >
          Chào mừng
        </motion.p>

        <motion.h1
          initial={{ y: 20, opacity: 0 }}
          animate={{ y: phase >= 2 ? 0 : 20, opacity: phase >= 2 ? 1 : 0 }}
          transition={{ duration: 0.5, delay: 0.1 }}
          className="text-on-brand text-4xl sm:text-5xl font-bold"
        >
          {name || "VIP Guest"}
        </motion.h1>

        {hall && (
          <motion.div
            initial={{ y: 20, opacity: 0 }}
            animate={{ y: phase >= 3 ? 0 : 20, opacity: phase >= 3 ? 1 : 0 }}
            transition={{ duration: 0.5, delay: 0.2 }}
            className="px-4 py-2 rounded-full bg-white/15 backdrop-blur text-white/90 text-base font-medium"
          >
            {hall}
          </motion.div>
        )}

        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 3 ? 1 : 0 }}
          transition={{ duration: 0.5, delay: 0.3 }}
          className="text-sky-200/80 text-sm mt-4"
        >
          Cảm ơn quý khách đã tham dự.
        </motion.p>

        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: phase >= 3 ? 1 : 0 }}
          transition={{ delay: 0.5 }}
          className="flex items-center gap-2 mt-6 px-4 py-2 rounded-full bg-white/10 backdrop-blur"
        >
          <ShieldCheck size={16} className="text-sky-300" />
          <span className="text-sky-200 text-xs font-semibold tracking-wider uppercase">VIP Check-in thành công</span>
        </motion.div>
      </div>

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: phase >= 3 ? 0.4 : 0 }}
        transition={{ delay: 1 }}
        className="absolute bottom-8 text-white/40 text-xs"
      >
        Tự động đóng sau 5 giây...
      </motion.div>
    </motion.div>
  );
}

function ShieldCheck({ size, className }: { size: number; className?: string }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
      <path d="m9 12 2 2 4-4" />
    </svg>
  );
}
