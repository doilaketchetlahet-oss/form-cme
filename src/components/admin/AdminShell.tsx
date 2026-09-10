"use client";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Link from "next/link";
import { motion, AnimatePresence } from "framer-motion";
import {
  LayoutDashboard,
  ClipboardList,
  ShieldCheck,
  Settings,
  QrCode,
  LogOut,
  Menu,
  X,
  ChevronRight,
} from "lucide-react";
import { useAuth, signOut } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { getAdminRoleLabel, useAdminAccess } from "@/components/auth/AdminAccessProvider";

const NAV_ITEMS = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard, exact: true },
  { href: "/admin/forms", label: "Form đăng ký", icon: ClipboardList },
  { href: "/admin/permissions", label: "Phân quyền", icon: ShieldCheck },
  { href: "/admin/settings", label: "Cài đặt", icon: Settings },
];

const BRAND_GRADIENT = "linear-gradient(135deg, #0ea5e9, #06b6d4)";

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const { user } = useAuth();
  const access = useAdminAccess();
  const [mobileOpen, setMobileOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    router.push("/login");
  };

  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname === href || pathname.startsWith(href + "/");

  const initials = user?.email?.slice(0, 2).toUpperCase() ?? "--";

  return (
    <div className="min-h-dvh flex">
      <aside className="hidden lg:flex w-64 flex-col fixed inset-y-0 left-0 glass border-r z-30">
        <SidebarContent isActive={isActive} />
        <UserSection
          email={user?.email ?? ""}
          initials={initials}
          roleLabel={getAdminRoleLabel(access.role, access.setupRequired)}
          onSignOut={handleSignOut}
        />
      </aside>

      <AnimatePresence>
        {mobileOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setMobileOpen(false)}
              className="lg:hidden fixed inset-0 bg-sky-900/40 backdrop-blur-sm z-40"
            />
            <motion.aside
              initial={{ x: -288 }}
              animate={{ x: 0 }}
              exit={{ x: -288 }}
              transition={{ type: "spring", damping: 30, stiffness: 300 }}
              className="lg:hidden fixed inset-y-0 left-0 w-72 flex flex-col glass-strong border-r z-50"
            >
              <button
                onClick={() => setMobileOpen(false)}
                className="absolute top-4 right-4 w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-800 hover:bg-sky-50"
              >
                <X size={18} />
              </button>
              <SidebarContent isActive={isActive} onNavigate={() => setMobileOpen(false)} />
              <UserSection
                email={user?.email ?? ""}
                initials={initials}
                roleLabel={getAdminRoleLabel(access.role, access.setupRequired)}
                onSignOut={handleSignOut}
              />
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <div className="flex-1 lg:ml-64 flex flex-col min-w-0">
        <header className="lg:hidden sticky top-0 z-20 glass border-b px-4 py-3 flex items-center justify-between">
          <button
            onClick={() => setMobileOpen(true)}
            className="w-10 h-10 rounded-xl flex items-center justify-center text-slate-600 hover:text-slate-900 hover:bg-sky-50"
          >
            <Menu size={20} />
          </button>
          <Link href="/admin" className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: BRAND_GRADIENT }}>
              <QrCode size={14} className="text-on-brand" />
            </div>
            <span className="text-sm font-semibold text-slate-900">Form CME</span>
          </Link>
          <div className="w-10 h-10 rounded-full flex items-center justify-center bg-sky-100 text-xs font-bold text-sky-700">
            {initials}
          </div>
        </header>

        <main className="flex-1 min-w-0">
          {access.setupRequired && (
            <div className="mx-4 mt-4 sm:mx-8 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-800">
              Chưa cấu hình bảng phân quyền. Hãy chạy file <span className="font-mono">supabase/authorization.sql</span> và thêm email owner để khóa trang quản trị đúng cách.
            </div>
          )}
          {children}
        </main>
      </div>
    </div>
  );
}

function SidebarContent({
  isActive,
  onNavigate,
}: {
  isActive: (h: string, e?: boolean) => boolean;
  onNavigate?: () => void;
}) {
  return (
    <>
      <Link href="/" className="flex items-center gap-2 px-6 py-6 border-b border-sky-100">
        <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: BRAND_GRADIENT }}>
          <QrCode size={16} className="text-on-brand" />
        </div>
        <span className="text-base font-semibold tracking-tight text-slate-900">Form CME</span>
      </Link>

      <nav className="flex-1 px-3 py-4 flex flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const active = isActive(item.href, item.exact);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={cn(
                "flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all relative",
                active ? "text-sky-800" : "text-slate-500 hover:text-slate-800 hover:bg-sky-50",
              )}
            >
              {active && (
                <motion.div
                  layoutId="active-pill"
                  className="absolute inset-0 rounded-xl"
                  style={{ background: "linear-gradient(135deg, rgba(14,165,233,0.14), rgba(6,182,212,0.06))", border: "1px solid rgba(14,165,233,0.28)" }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <Icon size={16} className="relative z-10 flex-shrink-0" />
              <span className="relative z-10">{item.label}</span>
              {active && <ChevronRight size={14} className="relative z-10 ml-auto text-sky-600" />}
            </Link>
          );
        })}
      </nav>
    </>
  );
}

function UserSection({
  email,
  initials,
  roleLabel,
  onSignOut,
}: {
  email: string;
  initials: string;
  roleLabel: string;
  onSignOut: () => void;
}) {
  return (
    <div className="px-3 py-3 border-t border-sky-100">
      <div className="flex items-center gap-3 px-3 py-2.5 rounded-xl">
        <div
          className="w-9 h-9 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0"
          style={{ background: BRAND_GRADIENT, color: "white" }}
        >
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-slate-500">Đang nhập</div>
          <div className="text-sm text-slate-900 truncate">{email}</div>
          <div className="text-[11px] text-sky-600 truncate">{roleLabel}</div>
        </div>
        <button
          onClick={onSignOut}
          title="Đăng xuất"
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:text-slate-900 hover:bg-sky-50 transition-colors flex-shrink-0"
        >
          <LogOut size={14} />
        </button>
      </div>
    </div>
  );
}
