"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import {
  AlignLeft, Copy, Eye, Image as ImageIcon, Loader2, Mail, Paperclip, Pencil,
  Plus, RefreshCw, Trash2, X,
} from "lucide-react";
import { useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { useConfirm } from "@/lib/ui/confirm";
import { supabase } from "@/lib/supabase";
import { parseEmailTemplate } from "@/lib/email-template";
import { PageHeader } from "./PageHeader";
import { EmailPreviewFrame } from "./EmailPreviewFrame";

type TemplateSummary = {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  updated_at: string | null;
};

function templateHighlights(body: string) {
  const parsed = parseEmailTemplate(body);
  const heading = parsed.blocks.find((block) => block.type === "heading" && block.text?.trim())
    || parsed.blocks.find((block) => block.type === "text" && block.text?.trim());
  return {
    hasBlocks: parsed.includeBlocks !== false,
    hasOverlay: parsed.includeOverlay === true && !!parsed.overlay?.imageUrl,
    overlayImage: parsed.overlay?.imageUrl ?? null,
    attachmentCount: parsed.attachments?.length ?? 0,
    snippet: heading?.text?.replace(/\{\{\w+\}\}/g, "…").slice(0, 90) ?? "",
  };
}

export function EmailTemplatesManager() {
  const { canManageForms } = useAdminAccess();
  const confirm = useConfirm();
  const [templates, setTemplates] = useState<TemplateSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [previewing, setPreviewing] = useState<TemplateSummary | null>(null);

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const token = await getToken();
      if (!token) return;
      const response = await fetch("/api/admin/email-templates", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        setMessage({ type: "error", text: result?.error ?? "Không tải được template." });
        return;
      }
      setTemplates((result.templates ?? []) as TemplateSummary[]);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      await Promise.resolve();
      if (active) await load();
    };
    void run();
    return () => { active = false; };
  }, [load]);

  const duplicate = async (template: TemplateSummary) => {
    if (!canManageForms) return;
    setBusyId(template.id);
    setMessage(null);
    try {
      const token = await getToken();
      if (!token) return;
      const response = await fetch("/api/admin/email-templates", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ name: `${template.name} (bản sao)`, subject: template.subject, body: template.body }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        setMessage({ type: "error", text: result?.error ?? "Nhân bản thất bại." });
        return;
      }
      setMessage({ type: "success", text: "Đã nhân bản template." });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (template: TemplateSummary) => {
    if (!canManageForms) return;
    if (!(await confirm({ title: `Xóa template “${template.name}”?`, destructive: true, confirmText: "Xóa" }))) return;
    setBusyId(template.id);
    setMessage(null);
    try {
      const token = await getToken();
      if (!token) return;
      const response = await fetch(`/api/admin/email-templates?id=${encodeURIComponent(template.id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        setMessage({ type: "error", text: result?.error ?? "Xóa template thất bại." });
        return;
      }
      setMessage({ type: "success", text: "Đã xóa template." });
      await load();
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10 max-w-7xl">
      <PageHeader
        title="Template thư"
        subtitle="Kho thư mời dùng lại: nội dung, ảnh thiệp và file đính kèm. Tạo, xem trước, sửa và xóa tại đây."
        action={
          <div className="flex items-center gap-2">
            <button
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white/10 disabled:opacity-50"
            >
              <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Làm mới
            </button>
            {canManageForms && (
              <Link
                href="/admin/templates/new"
                className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-sky-400"
              >
                <Plus size={16} /> Template mới
              </Link>
            )}
          </div>
        }
      />

      {message && (
        <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
          message.type === "success" ? "border-sky-200 bg-sky-50 text-sky-700" : "border-red-200 bg-red-50 text-red-600"
        }`}>
          {message.text}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {[0, 1, 2].map((item) => <div key={item} className="glass h-64 rounded-2xl animate-pulse" />)}
        </div>
      ) : templates.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <Mail size={38} className="mx-auto mb-3 text-slate-500" />
          <h3 className="mb-1 text-base font-semibold text-slate-900">Chưa có template nào</h3>
          <p className="mx-auto mb-5 max-w-md text-sm text-slate-500">
            Tạo template đầu tiên để dùng lại cho nhiều form và nhiều sự kiện.
          </p>
          {canManageForms && (
            <Link href="/admin/templates/new" className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-sky-400">
              <Plus size={16} /> Tạo template mới
            </Link>
          )}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {templates.map((template, index) => (
            <TemplateCard
              key={template.id}
              template={template}
              index={index}
              canManage={canManageForms}
              busy={busyId === template.id}
              onPreview={() => setPreviewing(template)}
              onDuplicate={() => void duplicate(template)}
              onRemove={() => void remove(template)}
            />
          ))}
        </div>
      )}

      {previewing && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-auto bg-slate-900/50 p-4 backdrop-blur-sm" onClick={() => setPreviewing(null)}>
          <div className="mt-8 w-full max-w-2xl rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl" onClick={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-900">{previewing.name}</div>
                <div className="text-xs text-slate-500">Bản xem trước với dữ liệu mẫu</div>
              </div>
              <button onClick={() => setPreviewing(null)} className="rounded-lg p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-700">
                <X size={16} />
              </button>
            </div>
            <EmailPreviewFrame subject={previewing.subject ?? ""} body={previewing.body} className="max-h-[70vh] overflow-auto" />
          </div>
        </div>
      )}
    </div>
  );
}

function TemplateCard({
  template,
  index,
  canManage,
  busy,
  onPreview,
  onDuplicate,
  onRemove,
}: {
  template: TemplateSummary;
  index: number;
  canManage: boolean;
  busy: boolean;
  onPreview: () => void;
  onDuplicate: () => void;
  onRemove: () => void;
}) {
  const info = templateHighlights(template.body);
  const updatedAt = template.updated_at ? new Date(template.updated_at).toLocaleString("vi-VN") : "—";

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index, 8) * 0.03 }}
      className="glass-strong flex flex-col overflow-hidden rounded-2xl"
    >
      <div className="relative h-36 overflow-hidden border-b border-white/10 bg-slate-100">
        {info.hasOverlay && info.overlayImage ? (
          <img src={info.overlayImage} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full items-center justify-center bg-gradient-to-br from-sky-50 to-cyan-50 px-4 text-center">
            <span className="line-clamp-3 text-sm text-slate-500">{info.snippet || "Thư mời"}</span>
          </div>
        )}
        <div className="absolute left-2 top-2 flex flex-wrap gap-1">
          {info.hasBlocks && <Badge icon={<AlignLeft size={11} />} label="Nội dung" />}
          {info.hasOverlay && <Badge icon={<ImageIcon size={11} />} label="Ảnh thiệp" />}
          {info.attachmentCount > 0 && <Badge icon={<Paperclip size={11} />} label={`${info.attachmentCount} file`} />}
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-3 p-4">
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-900">{template.name}</div>
          <div className="mt-0.5 truncate text-xs text-slate-500">{template.subject || "Chưa đặt tiêu đề"}</div>
          <div className="mt-1 text-[11px] text-slate-400">Cập nhật {updatedAt}</div>
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-1.5">
          <button onClick={onPreview} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-sky-600">
            <Eye size={13} /> Xem
          </button>
          {canManage && (
            <>
              <Link href={`/admin/templates/${template.id}`} className="inline-flex items-center gap-1.5 rounded-lg border border-sky-200 bg-sky-50 px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-100">
                <Pencil size={13} /> Sửa
              </Link>
              <button onClick={onDuplicate} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-slate-900 disabled:opacity-50">
                {busy ? <Loader2 size={13} className="animate-spin" /> : <Copy size={13} />} Nhân bản
              </button>
              <button onClick={onRemove} disabled={busy} className="inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                <Trash2 size={13} /> Xóa
              </button>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
}

function Badge({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-full bg-white/90 px-2 py-0.5 text-[10px] font-semibold text-slate-700 shadow-sm">
      {icon}
      {label}
    </span>
  );
}
