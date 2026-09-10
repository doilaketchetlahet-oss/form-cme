"use client";

import { createContext, useContext, useEffect, useMemo, useState } from "react";
import type { User } from "@supabase/supabase-js";
import { motion } from "framer-motion";
import { Lock, LogOut } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { signOut } from "@/hooks/useAuth";

export type AdminRole = "owner" | "admin" | "viewer";

interface AdminAccess {
  email: string;
  role: AdminRole;
  canManageForms: boolean;
  isOwner: boolean;
  setupRequired: boolean;
}

const AdminAccessContext = createContext<AdminAccess | null>(null);

export function AdminAccessProvider({ user, children }: { user: User; children: React.ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [access, setAccess] = useState<AdminAccess | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const email = user.email?.trim().toLowerCase() ?? "";

  useEffect(() => {
    let active = true;

    const loadAccess = async () => {
      await Promise.resolve();
      if (!active) return;

      setLoading(true);
      setErrorMessage("");

      if (!email) {
        setAccess(null);
        setErrorMessage("Tài khoản này chưa có email xác thực.");
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("admin_members")
        .select("role, active")
        .ilike("email", email)
        .eq("active", true)
        .maybeSingle();

        if (!active) return;

        if (error) {
          const missingTable = error.code === "42P01" || error.message.toLowerCase().includes("does not exist");
          if (missingTable) {
            setAccess({
              email,
              role: "owner",
              canManageForms: true,
              isOwner: true,
              setupRequired: true,
            });
            setLoading(false);
            return;
          }

          setAccess(null);
          setErrorMessage(error.message);
          setLoading(false);
          return;
        }

        if (!data?.active) {
          const status = await fetch("/api/admin/permissions/status").then((response) => response.json()).catch(() => null);
          if (status?.setupRequired) {
            setAccess({
              email,
              role: "owner",
              canManageForms: true,
              isOwner: true,
              setupRequired: true,
            });
            setLoading(false);
            return;
          }

          setAccess(null);
          setErrorMessage("Email này chưa được cấp quyền quản trị.");
          setLoading(false);
          return;
        }

        const role = data.role as AdminRole;
        setAccess({
          email,
          role,
          canManageForms: role === "owner" || role === "admin",
          isOwner: role === "owner",
          setupRequired: false,
        });
        setLoading(false);
    };

    loadAccess();

    return () => { active = false; };
  }, [email]);

  const value = useMemo(() => access, [access]);

  if (loading) {
    return (
      <div className="min-h-dvh flex items-center justify-center">
        <motion.div
          className="w-2 h-2 rounded-full"
          style={{ background: "#0ea5e9" }}
          animate={{ scale: [1, 1.5, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 1, repeat: Infinity }}
        />
      </div>
    );
  }

  if (!value) {
    return <AccessDenied email={email} message={errorMessage} />;
  }

  return <AdminAccessContext.Provider value={value}>{children}</AdminAccessContext.Provider>;
}

export function useAdminAccess() {
  const context = useContext(AdminAccessContext);
  if (!context) {
    throw new Error("useAdminAccess must be used inside AdminAccessProvider");
  }
  return context;
}

export function getAdminRoleLabel(role: AdminRole, setupRequired = false) {
  if (setupRequired) return "Chưa cấu hình quyền";
  if (role === "owner") return "Chủ sở hữu";
  if (role === "admin") return "Quản trị";
  return "Chỉ xem";
}

function AccessDenied({ email, message }: { email: string; message: string }) {
  const handleSignOut = async () => {
    await signOut();
    window.location.href = "/login";
  };

  return (
    <div className="min-h-dvh flex items-center justify-center px-4">
      <div className="glass rounded-2xl p-8 w-full max-w-sm text-center">
        <div className="w-14 h-14 rounded-2xl mx-auto mb-5 flex items-center justify-center bg-red-50 border border-red-200 text-red-600">
          <Lock size={24} />
        </div>
        <h1 className="text-2xl font-bold text-slate-900 mb-2">Không có quyền truy cập</h1>
        <p className="text-sm text-slate-600 mb-2">
          Email <span className="text-slate-700 font-medium">{email}</span> chưa nằm trong danh sách quản trị.
        </p>
        {message && <p className="text-xs text-slate-500 mb-5">{message}</p>}
        <button
          onClick={handleSignOut}
          className="mx-auto px-5 py-2.5 rounded-xl text-sm font-semibold text-red-600 bg-red-50 border border-red-200 hover:bg-red-100 flex items-center justify-center gap-2 transition-colors"
        >
          <LogOut size={14} /> Đăng xuất
        </button>
      </div>
    </div>
  );
}
