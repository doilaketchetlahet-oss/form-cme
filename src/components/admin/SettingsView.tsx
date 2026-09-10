"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { motion } from "framer-motion";
import { Lock, LogOut, Mail, ShieldCheck, User } from "lucide-react";
import { getAdminRoleLabel, useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { signOut, useAuth } from "@/hooks/useAuth";
import { supabase } from "@/lib/supabase";
import { PageHeader } from "./PageHeader";

export function SettingsView() {
  const router = useRouter();
  const { user } = useAuth();
  const access = useAdminAccess();
  const [newPassword, setNewPassword] = useState("");
  const [updating, setUpdating] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const handleChangePassword = async () => {
    if (newPassword.length < 6) {
      setMessage({ type: "error", text: "Mật khẩu mới cần ít nhất 6 ký tự." });
      return;
    }

    setUpdating(true);
    const { error } = await supabase.auth.updateUser({ password: newPassword });
    setUpdating(false);

    if (error) {
      setMessage({ type: "error", text: error.message });
      return;
    }

    setMessage({ type: "success", text: "Đã cập nhật mật khẩu." });
    setNewPassword("");
    setTimeout(() => setMessage(null), 4000);
  };

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10 max-w-3xl">
      <PageHeader title="Cài đặt" subtitle="Thông tin tài khoản và phiên đăng nhập." />

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} className="glass rounded-2xl p-6 mb-4">
        <h2 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <User size={14} /> Thông tin tài khoản
        </h2>
        <div className="grid gap-3">
          <Field label="Email" icon={Mail} value={user?.email ?? ""} />
          <Field label="Vai trò" icon={ShieldCheck} value={getAdminRoleLabel(access.role, access.setupRequired)} />
          <Field label="ID người dùng" icon={User} value={user?.id ?? ""} mono />
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.04 }}
        className="glass rounded-2xl p-6 mb-4"
      >
        <h2 className="text-sm font-semibold text-slate-900 mb-4 flex items-center gap-2">
          <Lock size={14} /> Đổi mật khẩu
        </h2>
        <div className="flex flex-col gap-3">
          <input
            type="password"
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            placeholder="Mật khẩu mới, tối thiểu 6 ký tự"
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 transition-colors"
          />
          {message && (
            <div className={`text-sm px-3 py-2 rounded-lg ${
              message.type === "success"
                ? "bg-sky-50 border border-sky-200 text-sky-700"
                : "bg-red-50 border border-red-200 text-red-600"
            }`}>
              {message.text}
            </div>
          )}
          <motion.button
            onClick={handleChangePassword}
            disabled={updating || newPassword.length < 6}
            className="self-start px-5 py-2.5 rounded-xl text-sm font-semibold text-on-brand bg-sky-600 hover:bg-sky-500 disabled:opacity-50"
            whileTap={{ scale: 0.98 }}
          >
            {updating ? "Đang cập nhật..." : "Cập nhật mật khẩu"}
          </motion.button>
        </div>
      </motion.div>

      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }} className="glass rounded-2xl p-6">
        <h2 className="text-sm font-semibold text-slate-900 mb-1">Phiên đăng nhập</h2>
        <p className="text-xs text-slate-500 mb-4">Đăng xuất khỏi tài khoản này trên thiết bị hiện tại.</p>
        <button
          onClick={handleSignOut}
          className="flex items-center gap-2 px-5 py-2.5 rounded-xl text-sm font-medium text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 transition-colors"
        >
          <LogOut size={14} /> Đăng xuất
        </button>
      </motion.div>
    </div>
  );
}

function Field({
  label,
  icon: Icon,
  value,
  mono,
}: {
  label: string;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <label className="text-xs text-slate-500 uppercase tracking-widest mb-1.5 flex items-center gap-1">
        <Icon size={11} /> {label}
      </label>
      <div className={`bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-white ${mono ? "font-mono text-xs" : "text-sm"}`}>
        {value || <span className="text-slate-600">-</span>}
      </div>
    </div>
  );
}
