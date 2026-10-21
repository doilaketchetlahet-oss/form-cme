"use client";

import { useCallback, useEffect, useState } from "react";
import { CheckCircle2, Loader2, Mail, Plus, RefreshCw, Save, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useConfirm } from "@/lib/ui/confirm";

type Account = {
  id: string;
  name: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromEmail: string;
  fromName: string;
  replyTo: string;
  updatedAt: string;
};

const EMPTY = {
  id: "",
  name: "",
  host: "smtp.office365.com",
  port: 587,
  secure: false,
  user: "",
  password: "",
  fromEmail: "",
  fromName: "",
  replyTo: "",
};

export function SmtpAccountsManager() {
  const confirm = useConfirm();
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState<typeof EMPTY | null>(null);

  const authHeaders = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/smtp-accounts", { headers: await authHeaders(), cache: "no-store" });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        toast.error(body?.error ?? "Không tải được danh sách tài khoản SMTP.");
        return;
      }
      setAccounts(body.accounts as Account[]);
    } finally {
      setLoading(false);
    }
  }, [authHeaders]);

  useEffect(() => {
    queueMicrotask(() => void load());
  }, [load]);

  const openEdit = (account: Account) => {
    setDraft({
      id: account.id,
      name: account.name,
      host: account.host,
      port: account.port,
      secure: account.secure,
      user: account.user,
      password: "",
      fromEmail: account.fromEmail,
      fromName: account.fromName,
      replyTo: account.replyTo,
    });
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await fetch("/api/admin/smtp-accounts", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ action: "save", ...draft, id: draft.id || undefined }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        toast.error(body?.error ?? "Không lưu được tài khoản.");
        return;
      }
      toast.success("Đã lưu tài khoản SMTP.");
      setDraft(null);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const verify = async (account: Account) => {
    setBusy(true);
    const id = toast.loading(`Đang kiểm tra ${account.name}…`);
    try {
      const res = await fetch("/api/admin/smtp-accounts", {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({ action: "verify", id: account.id }),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        toast.error(body?.error ?? "Không đăng nhập được SMTP.", { id, duration: 10000 });
        return;
      }
      toast.success("Đăng nhập SMTP thành công.", { id });
    } finally {
      setBusy(false);
    }
  };

  const remove = async (account: Account) => {
    const ok = await confirm({
      title: `Xoá tài khoản “${account.name}”?`,
      description: "Form đang dùng tài khoản này sẽ quay về gửi mặc định của hệ thống.",
      confirmText: "Xoá",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/admin/smtp-accounts?id=${encodeURIComponent(account.id)}`, {
        method: "DELETE",
        headers: await authHeaders(),
      });
      const body = await res.json().catch(() => null);
      if (!res.ok || !body?.ok) {
        toast.error(body?.error ?? "Không xoá được tài khoản.");
        return;
      }
      toast.success("Đã xoá tài khoản SMTP.");
      await load();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-[11px] font-bold tracking-wider text-sky-600 uppercase">Cài đặt</span>
          <h1 className="font-display flex items-center gap-2 text-2xl font-black text-slate-900">
            <Mail size={22} className="text-sky-500" /> Tài khoản SMTP
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-slate-600">
            Lưu hộp thư của từng khách để form gửi bằng chính tài khoản đó (ví dụ Microsoft 365).
            Mật khẩu được mã hoá ở server; giao diện không bao giờ hiển thị lại.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setDraft({ ...EMPTY })}
          className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-sky-700"
        >
          <Plus size={16} /> Thêm tài khoản
        </button>
      </header>

      <div className="mb-5 rounded-2xl border border-sky-100 bg-sky-50 px-4 py-3 text-xs leading-6 text-slate-700">
        <p className="font-semibold text-slate-800">Microsoft 365: smtp.office365.com · cổng 587 · STARTTLS</p>
        <p>Quản trị viên của khách phải bật <strong>Authenticated SMTP</strong> cho hộp thư, và dùng App Password nếu đã bật MFA.</p>
        <p className="text-slate-600">Địa chỉ gửi phải trùng hộp thư đăng nhập, nếu không Microsoft sẽ từ chối.</p>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-10 text-sm text-slate-500">
          <Loader2 size={16} className="animate-spin" /> Đang tải danh sách…
        </div>
      ) : accounts.length === 0 ? (
        <div className="rounded-2xl border border-slate-200 bg-white px-4 py-10 text-center text-sm text-slate-500">
          Chưa có tài khoản SMTP nào. Bấm <strong>Thêm tài khoản</strong> để bắt đầu.
        </div>
      ) : (
        <ul className="space-y-3">
          {accounts.map((account) => (
            <li key={account.id} className="rounded-2xl border border-slate-200 bg-white p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-bold text-slate-900">{account.name}</p>
                  <p className="mt-0.5 break-all text-xs text-slate-500">
                    {account.user} · {account.host}:{account.port} · {account.secure ? "SSL" : "STARTTLS"}
                  </p>
                  <p className="mt-0.5 break-all text-xs text-slate-500">
                    Gửi từ: {account.fromName} &lt;{account.fromEmail}&gt;
                    {account.replyTo ? ` · Reply-To: ${account.replyTo}` : ""}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => void verify(account)}
                    disabled={busy}
                    className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                  >
                    <RefreshCw size={13} /> Kiểm tra đăng nhập
                  </button>
                  <button
                    type="button"
                    onClick={() => openEdit(account)}
                    disabled={busy}
                    className="rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                  >
                    Sửa
                  </button>
                  <button
                    type="button"
                    onClick={() => void remove(account)}
                    disabled={busy}
                    className="rounded-xl border border-red-200 px-3 py-2 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                  >
                    <Trash2 size={13} />
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      {draft && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-6">
          <div className="max-h-[92vh] w-full max-w-lg overflow-auto rounded-t-3xl bg-white p-5 sm:rounded-3xl">
            <div className="mb-4 flex items-start justify-between gap-3">
              <div>
                <h2 className="text-lg font-bold text-slate-900">{draft.id ? "Sửa tài khoản SMTP" : "Thêm tài khoản SMTP"}</h2>
                <p className="mt-0.5 text-xs text-slate-500">Điền theo thông tin khách cung cấp.</p>
              </div>
              <button type="button" onClick={() => setDraft(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100">
                <X size={18} />
              </button>
            </div>

            <div className="grid gap-3">
              <Field label="Tên gợi nhớ">
                <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} placeholder="M365 - Bệnh viện X" className="admin-field w-full rounded-xl px-3 py-2.5 text-sm" />
              </Field>

              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <Field label="Máy chủ SMTP">
                    <input value={draft.host} onChange={(e) => setDraft({ ...draft, host: e.target.value })} placeholder="smtp.office365.com" className="admin-field w-full rounded-xl px-3 py-2.5 text-sm" />
                  </Field>
                </div>
                <Field label="Cổng">
                  <input type="number" value={draft.port} onChange={(e) => setDraft({ ...draft, port: Number(e.target.value) })} className="admin-field w-full rounded-xl px-3 py-2.5 text-sm" />
                </Field>
              </div>

              <label className="flex items-center gap-2 text-sm text-slate-700">
                <input type="checkbox" checked={draft.secure} onChange={(e) => setDraft({ ...draft, secure: e.target.checked })} className="h-4 w-4 accent-sky-600" />
                Dùng SSL ngay từ đầu (cổng 465). Bỏ trống với Office 365 / cổng 587.
              </label>

              <Field label="Tài khoản đăng nhập (email đầy đủ)">
                <input value={draft.user} onChange={(e) => setDraft({ ...draft, user: e.target.value })} placeholder="ten@congty-khach.com" className="admin-field w-full rounded-xl px-3 py-2.5 text-sm" />
              </Field>

              <Field label={draft.id ? "Mật khẩu / App Password (để trống = giữ nguyên)" : "Mật khẩu / App Password"}>
                <input type="password" value={draft.password} onChange={(e) => setDraft({ ...draft, password: e.target.value })} placeholder={draft.id ? "••••••••" : ""} className="admin-field w-full rounded-xl px-3 py-2.5 text-sm" autoComplete="new-password" />
              </Field>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Tên hiển thị người gửi">
                  <input value={draft.fromName} onChange={(e) => setDraft({ ...draft, fromName: e.target.value })} placeholder="Ban tổ chức" className="admin-field w-full rounded-xl px-3 py-2.5 text-sm" />
                </Field>
                <Field label="Email người gửi">
                  <input value={draft.fromEmail} onChange={(e) => setDraft({ ...draft, fromEmail: e.target.value })} placeholder="ten@congty-khach.com" className="admin-field w-full rounded-xl px-3 py-2.5 text-sm" />
                </Field>
              </div>

              <Field label="Reply-To (tùy chọn)">
                <input value={draft.replyTo} onChange={(e) => setDraft({ ...draft, replyTo: e.target.value })} placeholder="hotro@congty-khach.com" className="admin-field w-full rounded-xl px-3 py-2.5 text-sm" />
              </Field>
            </div>

            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={() => void save()} disabled={busy} className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50">
                {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu tài khoản
              </button>
              <button type="button" onClick={() => setDraft(null)} className="rounded-xl border border-slate-200 px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50">
                Huỷ
              </button>
            </div>

            <p className="mt-3 flex items-start gap-1.5 text-[11px] leading-5 text-slate-500">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
              Mật khẩu chỉ dùng để đăng nhập SMTP, được mã hoá AES-256-GCM và gắn với tài khoản của bạn.
            </p>
          </div>
        </div>
      )}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600">{label}</span>
      {children}
    </label>
  );
}
