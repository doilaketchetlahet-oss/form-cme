"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion } from "framer-motion";
import {
  AlertTriangle,
  CheckCircle2,
  Lock,
  RefreshCw,
  Search,
  ShieldCheck,
  ShieldPlus,
  Trash2,
  UserCog,
  UserPlus,
  Users,
} from "lucide-react";
import { getAdminRoleLabel, type AdminRole, useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { useConfirm } from "@/lib/ui/confirm";
import { supabase } from "@/lib/supabase";
import { cn } from "@/lib/utils";
import { PageHeader } from "./PageHeader";

type AdminMember = {
  id: string;
  email: string;
  role: AdminRole;
  active: boolean;
  created_at: string | null;
};

type RegisteredUser = {
  email: string;
  created_at: string | null;
};

type ToastMessage = {
  type: "success" | "error";
  text: string;
};

const ROLE_META: Record<AdminRole, { label: string; tone: string; description: string }> = {
  owner: {
    label: "Chủ sở hữu",
    tone: "border-sky-200 bg-sky-100 text-sky-700",
    description: "Toàn quyền quản lý form và thành viên.",
  },
  admin: {
    label: "Quản trị",
    tone: "border-cyan-200 bg-cyan-100 text-cyan-700",
    description: "Tạo, sửa, xóa form và vận hành sự kiện.",
  },
  viewer: {
    label: "Chỉ xem",
    tone: "border-slate-200 bg-slate-100 text-slate-600",
    description: "Xem dashboard, xuất dữ liệu và theo dõi check-in.",
  },
};

export function PermissionsView() {
  const access = useAdminAccess();
  const confirm = useConfirm();
  const [members, setMembers] = useState<AdminMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [bootstrapping, setBootstrapping] = useState(false);
  const [query, setQuery] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newRole, setNewRole] = useState<AdminRole>("viewer");
  const [message, setMessage] = useState<ToastMessage | null>(null);
  const [registeredUsers, setRegisteredUsers] = useState<RegisteredUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [usersError, setUsersError] = useState<string | null>(null);

  const canManage = access.isOwner && !access.setupRequired;

  const loadMembers = useCallback(async () => {
    if (access.setupRequired) return;
    setLoading(true);
    const { data, error } = await supabase
      .from("admin_members")
      .select("id, email, role, active, created_at")
      .eq("active", true)
      .order("created_at", { ascending: true });
    setLoading(false);

    if (error) {
      setMessage({ type: "error", text: error.message });
      return;
    }

    setMembers((data ?? []) as AdminMember[]);
  }, [access.setupRequired]);

  const loadRegisteredUsers = useCallback(async () => {
    if (access.setupRequired) return;
    setLoadingUsers(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;
    if (!token) {
      setLoadingUsers(false);
      return;
    }

    const response = await fetch("/api/admin/permissions/users", {
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await response.json().catch(() => null);
    setLoadingUsers(false);

    if (!response.ok || !result?.ok) {
      setUsersError(result?.error ?? "Không tải được danh sách tài khoản.");
      return;
    }

    setUsersError(null);
    setRegisteredUsers((result.users ?? []) as RegisteredUser[]);
  }, [access.setupRequired]);

  useEffect(() => {
    let active = true;

    const refresh = async () => {
      await Promise.resolve();
      if (!active) return;
      await loadMembers();
      await loadRegisteredUsers();
    };

    refresh();
    return () => { active = false; };
  }, [loadMembers, loadRegisteredUsers]);

  const filteredMembers = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return members;
    return members.filter((member) =>
      member.email.toLowerCase().includes(needle) || ROLE_META[member.role].label.toLowerCase().includes(needle),
    );
  }, [members, query]);

  const stats = useMemo(() => ({
    total: members.length,
    owner: members.filter((member) => member.role === "owner").length,
    admin: members.filter((member) => member.role === "admin").length,
    viewer: members.filter((member) => member.role === "viewer").length,
  }), [members]);

  const memberRoles = useMemo(() => {
    const map = new Map<string, AdminRole>();
    members.forEach((member) => map.set(member.email.toLowerCase(), member.role));
    return map;
  }, [members]);

  const showMessage = (nextMessage: ToastMessage) => {
    setMessage(nextMessage);
    window.setTimeout(() => setMessage(null), 4500);
  };

  const handleBootstrap = async () => {
    setBootstrapping(true);
    const { data: sessionData } = await supabase.auth.getSession();
    const token = sessionData.session?.access_token;

    if (!token) {
      setBootstrapping(false);
      showMessage({ type: "error", text: "Bạn cần đăng nhập lại trước khi khởi tạo." });
      return;
    }

    const response = await fetch("/api/admin/permissions/bootstrap", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    const result = await response.json();
    setBootstrapping(false);

    if (!response.ok || !result.ok) {
      showMessage({ type: "error", text: result.error ?? "Không thể khởi tạo phân quyền." });
      return;
    }

    showMessage({ type: "success", text: `Đã khởi tạo phân quyền và đặt ${result.ownerEmail} làm owner.` });
    window.setTimeout(() => window.location.reload(), 1200);
  };

  const grantUser = async (email: string, role: AdminRole) => {
    if (!canManage || saving) return;

    const normalized = email.trim().toLowerCase();
    if (!normalized || !normalized.includes("@")) {
      showMessage({ type: "error", text: "Email không hợp lệ." });
      return;
    }

    setSaving(true);
    const { error } = await supabase
      .from("admin_members")
      .upsert({ email: normalized, role, active: true }, { onConflict: "email" });
    setSaving(false);

    if (error) {
      showMessage({ type: "error", text: error.message });
      return;
    }

    showMessage({ type: "success", text: `Đã cấp quyền ${getAdminRoleLabel(role)} cho ${normalized}.` });
    await loadMembers();
  };

  const handleAddMember = async () => {
    const email = newEmail.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      showMessage({ type: "error", text: "Nhập email hợp lệ để cấp quyền." });
      return;
    }

    await grantUser(email, newRole);
    setNewEmail("");
    setNewRole("viewer");
  };

  const handleRoleChange = async (member: AdminMember, role: AdminRole) => {
    if (!canManage) return;

    if (member.email.toLowerCase() === access.email && role !== "owner") {
      showMessage({ type: "error", text: "Bạn không thể tự hạ quyền owner của chính mình." });
      return;
    }

    const { error } = await supabase.from("admin_members").update({ role }).eq("id", member.id);
    if (error) {
      showMessage({ type: "error", text: error.message });
      return;
    }

    showMessage({ type: "success", text: "Đã đổi vai trò thành viên." });
    await loadMembers();
  };

  const handleRemoveMember = async (member: AdminMember) => {
    if (!canManage) return;

    if (member.email.toLowerCase() === access.email) {
      showMessage({ type: "error", text: "Bạn không thể tự xóa quyền của chính mình." });
      return;
    }

    if (!(await confirm({ title: `Gỡ quyền quản trị của ${member.email}?`, destructive: true, confirmText: "Gỡ quyền" }))) return;

    const { error } = await supabase.from("admin_members").delete().eq("id", member.id);
    if (error) {
      showMessage({ type: "error", text: error.message });
      return;
    }

    showMessage({ type: "success", text: "Đã gỡ thành viên khỏi danh sách quản trị." });
    await loadMembers();
  };

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10 max-w-7xl">
      <PageHeader
        title="Phân quyền"
        subtitle="Quản lý quyền truy cập nội bộ cho dashboard form, QR check-in và dữ liệu đăng ký."
        action={
          <button
            onClick={loadMembers}
            disabled={loading || access.setupRequired}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Làm mới
          </button>
        }
      />

      {message && <MessageBanner message={message} />}

      {access.setupRequired ? (
        <BootstrapPanel bootstrapping={bootstrapping} onBootstrap={handleBootstrap} />
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4 mb-6">
            <StatCard label="Thành viên" value={stats.total} icon={Users} color="#0ea5e9" />
            <StatCard label="Owner" value={stats.owner} icon={ShieldCheck} color="#22c55e" />
            <StatCard label="Quản trị" value={stats.admin} icon={UserCog} color="#06b6d4" />
            <StatCard label="Chỉ xem" value={stats.viewer} icon={Lock} color="#94a3b8" />
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
            <section className="glass rounded-2xl overflow-hidden">
              <div className="border-b border-white/10 p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="text-base font-semibold text-slate-900">Thành viên quản trị</h2>
                    <p className="text-xs text-slate-500 mt-1">Danh sách email được phép vào khu vực admin.</p>
                  </div>
                  <div className="relative w-full sm:w-72">
                    <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                    <input
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Tìm email hoặc vai trò..."
                      className="w-full bg-white/5 border border-white/10 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>

              <div className="hidden md:grid grid-cols-[minmax(0,1fr)_180px_170px_48px] gap-3 border-b border-white/10 px-5 py-3 text-[11px] uppercase tracking-widest text-slate-500">
                <span>Email</span>
                <span>Vai trò</span>
                <span>Ngày thêm</span>
                <span />
              </div>

              {loading ? (
                <div className="p-5 space-y-3">
                  {[0, 1, 2].map((item) => <div key={item} className="h-16 rounded-xl bg-white/[0.04] animate-pulse" />)}
                </div>
              ) : filteredMembers.length === 0 ? (
                <div className="p-10 text-center">
                  <Users size={36} className="mx-auto mb-3 text-slate-600" />
                  <h3 className="text-sm font-semibold text-slate-900 mb-1">Chưa có thành viên phù hợp</h3>
                  <p className="text-sm text-slate-500">Thêm email nội bộ ở panel bên phải để cấp quyền.</p>
                </div>
              ) : (
                <div className="divide-y divide-white/10">
                  {filteredMembers.map((member, index) => (
                    <MemberRow
                      key={member.id}
                      member={member}
                      index={index}
                      canManage={canManage}
                      isCurrentUser={member.email.toLowerCase() === access.email}
                      onRoleChange={handleRoleChange}
                      onRemove={handleRemoveMember}
                    />
                  ))}
                </div>
              )}
            </section>

            <aside className="space-y-5">
              <AddMemberPanel
                canManage={canManage}
                saving={saving}
                email={newEmail}
                role={newRole}
                onEmailChange={setNewEmail}
                onRoleChange={setNewRole}
                onAdd={handleAddMember}
              />
              <RegisteredAccountsPanel
                users={registeredUsers}
                memberRoles={memberRoles}
                loading={loadingUsers}
                error={usersError}
                canManage={canManage}
                saving={saving}
                query={query}
                onReload={loadRegisteredUsers}
                onGrant={(email) => grantUser(email, newRole)}
              />
              <RoleGuide />
            </aside>
          </div>
        </>
      )}
    </div>
  );
}

function BootstrapPanel({ bootstrapping, onBootstrap }: { bootstrapping: boolean; onBootstrap: () => void }) {
  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
      <section className="glass rounded-2xl p-7">
        <div className="mb-5 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-700">
          <ShieldPlus size={22} />
        </div>
        <h2 className="text-xl font-semibold text-slate-900 mb-2">Khởi tạo phân quyền</h2>
        <p className="max-w-2xl text-sm leading-6 text-slate-500 mb-5">
          Hệ thống chưa có bảng phân quyền. Bấm khởi tạo để tạo bảng thành viên, các policy RLS và tự đặt email đang đăng nhập làm owner đầu tiên.
        </p>
        <button
          onClick={onBootstrap}
          disabled={bootstrapping}
          className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-5 py-3 text-sm font-semibold text-on-brand hover:bg-sky-500 disabled:opacity-50"
        >
          <ShieldPlus size={16} /> {bootstrapping ? "Đang khởi tạo..." : "Khởi tạo phân quyền"}
        </button>
      </section>

      <aside className="glass rounded-2xl p-5">
        <h3 className="text-sm font-semibold text-slate-900 mb-3 flex items-center gap-2">
          <AlertTriangle size={15} className="text-amber-300" /> Cần biến môi trường
        </h3>
        <p className="text-sm leading-6 text-slate-500">
          Nút khởi tạo cần `SUPABASE_DB_URL` trên Vercel để server có quyền tạo table và policy. Sau khi khởi tạo xong, mọi thao tác thêm/sửa/gỡ thành viên dùng UI này.
        </p>
      </aside>
    </div>
  );
}

function AddMemberPanel({
  canManage,
  saving,
  email,
  role,
  onEmailChange,
  onRoleChange,
  onAdd,
}: {
  canManage: boolean;
  saving: boolean;
  email: string;
  role: AdminRole;
  onEmailChange: (email: string) => void;
  onRoleChange: (role: AdminRole) => void;
  onAdd: () => void;
}) {
  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="text-base font-semibold text-slate-900 mb-1 flex items-center gap-2">
        <UserPlus size={16} /> Thêm thành viên
      </h2>
      <p className="text-xs text-slate-500 mb-4">Cấp quyền theo email đã tạo trong Supabase Auth.</p>

      {!canManage && (
        <div className="mb-4 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          Chỉ owner mới được thêm hoặc chỉnh sửa quyền.
        </div>
      )}

      <div className="space-y-3">
        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Email</label>
          <input
            type="email"
            value={email}
            onChange={(event) => onEmailChange(event.target.value)}
            disabled={!canManage}
            placeholder="ban-to-chuc@domain.com"
            className="w-full rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-emerald-500 disabled:opacity-50"
          />
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-medium text-slate-500">Vai trò</label>
          <div className="grid grid-cols-3 gap-2">
            {(["viewer", "admin", "owner"] as AdminRole[]).map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => onRoleChange(item)}
                disabled={!canManage}
                className={cn(
                  "rounded-xl border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50",
                  role === item ? ROLE_META[item].tone : "border-white/10 bg-white/5 text-slate-500 hover:text-white",
                )}
              >
                {ROLE_META[item].label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={onAdd}
          disabled={!canManage || saving}
          className="w-full inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-on-brand hover:bg-sky-500 disabled:opacity-50"
        >
          <UserPlus size={16} /> {saving ? "Đang lưu..." : "Cấp quyền"}
        </button>
      </div>
    </section>
  );
}

function RegisteredAccountsPanel({
  users,
  memberRoles,
  loading,
  error,
  canManage,
  saving,
  query,
  onReload,
  onGrant,
}: {
  users: RegisteredUser[];
  memberRoles: Map<string, AdminRole>;
  loading: boolean;
  error: string | null;
  canManage: boolean;
  saving: boolean;
  query: string;
  onReload: () => void;
  onGrant: (email: string) => void;
}) {
  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const filtered = needle
      ? users.filter((user) => user.email.includes(needle))
      : users;
    return [...filtered].sort((a, b) => {
      const aMember = memberRoles.has(a.email) ? 1 : 0;
      const bMember = memberRoles.has(b.email) ? 1 : 0;
      if (aMember !== bMember) return aMember - bMember;
      return (b.created_at ?? "").localeCompare(a.created_at ?? "");
    });
  }, [users, memberRoles, query]);

  return (
    <section className="glass rounded-2xl p-5">
      <div className="mb-1 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-base font-semibold text-slate-900">
          <Users size={16} /> Tài khoản đã đăng ký
        </h2>
        <button
          onClick={onReload}
          disabled={loading}
          title="Tải lại"
          className="text-slate-500 hover:text-white disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
        </button>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        Tài khoản đã sign up trong hệ thống. Tài khoản chưa có quyền hiển thị trên cùng.
      </p>

      {error ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">{error}</div>
      ) : loading ? (
        <div className="space-y-2">
          {[0, 1, 2].map((item) => <div key={item} className="h-11 rounded-xl bg-white/[0.04] animate-pulse" />)}
        </div>
      ) : rows.length === 0 ? (
        <p className="text-sm text-slate-500">Chưa có tài khoản nào phù hợp.</p>
      ) : (
        <div className="max-h-80 space-y-1.5 overflow-auto pr-1">
          {rows.map((user) => {
            const role = memberRoles.get(user.email);
            return (
              <div key={user.email} className="flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm text-white">{user.email}</div>
                  {user.created_at && (
                    <div className="text-[11px] text-slate-500">Đăng ký {new Date(user.created_at).toLocaleDateString("vi-VN")}</div>
                  )}
                </div>
                {role ? (
                  <span className={cn("inline-flex shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold", ROLE_META[role].tone)}>
                    {ROLE_META[role].label}
                  </span>
                ) : canManage ? (
                  <button
                    onClick={() => onGrant(user.email)}
                    disabled={saving}
                    className="shrink-0 rounded-lg bg-sky-600 px-2.5 py-1.5 text-[11px] font-semibold text-on-brand hover:bg-sky-500 disabled:opacity-50"
                  >
                    Cấp quyền
                  </button>
                ) : (
                  <span className="shrink-0 text-[11px] text-slate-500">Chưa cấp</span>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function RoleGuide() {
  return (
    <section className="glass rounded-2xl p-5">
      <h2 className="text-base font-semibold text-slate-900 mb-4">Vai trò</h2>
      <div className="space-y-3">
        {(["owner", "admin", "viewer"] as AdminRole[]).map((role) => (
          <div key={role} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
            <div className={cn("mb-2 inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", ROLE_META[role].tone)}>
              {ROLE_META[role].label}
            </div>
            <p className="text-xs leading-5 text-slate-500">{ROLE_META[role].description}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

function MemberRow({
  member,
  index,
  canManage,
  isCurrentUser,
  onRoleChange,
  onRemove,
}: {
  member: AdminMember;
  index: number;
  canManage: boolean;
  isCurrentUser: boolean;
  onRoleChange: (member: AdminMember, role: AdminRole) => void;
  onRemove: (member: AdminMember) => void;
}) {
  const createdAt = member.created_at ? new Date(member.created_at).toLocaleDateString("vi-VN") : "-";

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.025 }}
      className="grid gap-3 p-4 md:grid-cols-[minmax(0,1fr)_180px_170px_48px] md:items-center md:px-5"
    >
      <div className="min-w-0">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-white/5 text-xs font-bold text-slate-300">
            {member.email.slice(0, 2).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-900">{member.email}</div>
            <div className="text-xs text-slate-500">{isCurrentUser ? "Tài khoản của bạn" : "Thành viên nội bộ"}</div>
          </div>
        </div>
      </div>

      <div>
        {canManage ? (
          <select
            value={member.role}
            onChange={(event) => onRoleChange(member, event.target.value as AdminRole)}
            className="admin-dark-select w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-white focus:outline-none focus:border-emerald-500"
          >
            <option value="viewer">Chỉ xem</option>
            <option value="admin">Quản trị</option>
            <option value="owner">Chủ sở hữu</option>
          </select>
        ) : (
          <span className={cn("inline-flex rounded-full border px-2.5 py-1 text-xs font-semibold", ROLE_META[member.role].tone)}>
            {getAdminRoleLabel(member.role)}
          </span>
        )}
      </div>

      <div className="text-sm text-slate-500">{createdAt}</div>

      <button
        onClick={() => onRemove(member)}
        disabled={!canManage || isCurrentUser}
        title="Gỡ quyền"
        className="h-10 w-10 rounded-xl flex items-center justify-center text-slate-500 hover:text-red-300 hover:bg-red-500/10 disabled:opacity-30"
      >
        <Trash2 size={15} />
      </button>
    </motion.div>
  );
}

function StatCard({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: number;
  icon: React.ComponentType<{ size?: number; className?: string }>;
  color: string;
}) {
  return (
    <div className="glass rounded-2xl p-4">
      <div className="flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: `${color}18`, border: `1px solid ${color}35`, color }}>
          <Icon size={17} />
        </div>
        <div>
          <div className="text-2xl font-bold tabular-nums text-slate-900">{value.toLocaleString("vi-VN")}</div>
          <div className="text-xs text-slate-500">{label}</div>
        </div>
      </div>
    </div>
  );
}

function MessageBanner({ message }: { message: ToastMessage }) {
  const success = message.type === "success";

  return (
    <div className={cn(
      "mb-5 flex items-start gap-3 rounded-xl border px-4 py-3 text-sm",
      success ? "border-sky-200 bg-sky-50 text-sky-700" : "border-red-200 bg-red-50 text-red-600",
    )}>
      {success ? <CheckCircle2 size={16} className="mt-0.5 shrink-0" /> : <AlertTriangle size={16} className="mt-0.5 shrink-0" />}
      <span>{message.text}</span>
    </div>
  );
}
