"use client";
import { motion } from "framer-motion";

interface Props {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}

export function PageHeader({ title, subtitle, action }: Props) {
  return (
    <motion.div
      initial={{ opacity: 0, y: -10 }}
      animate={{ opacity: 1, y: 0 }}
      className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-10"
    >
      <div>
        <div
          className="mb-3 h-1.5 w-14 rounded-full"
          style={{ background: "linear-gradient(135deg, #0ea5e9, #06b6d4)" }}
        />
        <h1 className="text-3xl sm:text-4xl font-bold text-slate-900 tracking-tight">{title}</h1>
        {subtitle && <p className="text-slate-600 mt-2">{subtitle}</p>}
      </div>
      {action && <div className="flex-shrink-0">{action}</div>}
    </motion.div>
  );
}
