"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, CheckCircle2, Loader2, Mail, Save, Trash2 } from "lucide-react";
import { useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { useUnsavedChangesWarning } from "@/hooks/useUnsavedChangesWarning";
import { supabase } from "@/lib/supabase";
import {
  defaultEmailBlocks,
  normalizeEmailTheme,
  serializeEmailTemplate,
  type EmailMergeQuestion,
} from "@/lib/email-template";
import { EmailComposer } from "./EmailComposer";
import { EmailPreviewFrame } from "./EmailPreviewFrame";

function defaultBody() {
  return serializeEmailTemplate({
    v: 1,
    includeBlocks: true,
    includeOverlay: false,
    blocks: defaultEmailBlocks(),
    theme: normalizeEmailTheme(),
    overlay: null,
    attachments: [],
  });
}

export function EmailTemplateEditPage({ templateId }: { templateId?: string }) {
  const router = useRouter();
  const { canManageForms } = useAdminAccess();
  const initialBody = useMemo(() => defaultBody(), []);
  const [loading, setLoading] = useState(!!templateId);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState(initialBody);
  const [saved, setSaved] = useState({ name: "", subject: "", body: initialBody });
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const dirty = !loading
    && (name !== saved.name || subject !== saved.subject || body !== saved.body);

  useUnsavedChangesWarning(dirty && canManageForms, "Template có thay đổi chưa lưu. Rời trang?");

  const getToken = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token ?? null;
  }, []);

  useEffect(() => {
    if (!templateId) return;
    (async () => {
      setLoading(true);
      try {
        const token = await getToken();
        if (!token) return;
        const response = await fetch("/api/admin/email-templates", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const result = await response.json().catch(() => null);
        const found = (result?.templates ?? []).find((item: { id: string }) => item.id === templateId);
        if (found) {
          const nextBody = found.body || defaultBody();
          setName(found.name ?? "");
          setSubject(found.subject ?? "");
          setBody(nextBody);
          setSaved({ name: found.name ?? "", subject: found.subject ?? "", body: nextBody });
        } else {
          setMessage({ type: "error", text: "Không tìm thấy template." });
        }
      } finally {
        setLoading(false);
      }
    })();
  }, [templateId, getToken]);

  const handleSave = async () => {
    if (!canManageForms || saving) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setMessage({ type: "error", text: "Nhập tên template trước khi lưu." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const token = await getToken();
      if (!token) {
        setMessage({ type: "error", text: "Phiên đăng nhập đã hết hạn." });
        return;
      }
      const response = await fetch("/api/admin/email-templates", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ ...(templateId ? { id: templateId } : {}), name: trimmed, subject: subject.trim() || null, body }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        setMessage({ type: "error", text: result?.error ?? "Lưu template thất bại." });
        return;
      }
      setMessage({ type: "success", text: templateId ? "Đã cập nhật template." : "Đã tạo template." });
      setSaved({ name, subject, body });
      if (!templateId && result.id) {
        router.replace(`/admin/templates/${result.id}`);
      }
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!templateId || !canManageForms) return;
    if (!window.confirm("Xóa template này?")) return;
    const token = await getToken();
    if (!token) return;
    await fetch(`/api/admin/email-templates?id=${encodeURIComponent(templateId)}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    router.push("/admin/templates");
  };

  const questions: EmailMergeQuestion[] = [];

  if (loading) {
    return (
      <div className="px-4 py-8 sm:px-8">
        <div className="glass rounded-2xl h-96 animate-pulse" />
      </div>
    );
  }

  return (
    <div className="px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link href="/admin/templates" className="mb-3 flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900">
            <ArrowLeft size={15} /> Kho template
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Mail size={22} className="text-sky-500" /> {templateId ? "Sửa template" : "Template mới"}
          </h1>
          <p className="mt-1 text-sm text-slate-600">Soạn nội dung, ảnh thiệp và file đính kèm rồi lưu để dùng lại.</p>
        </div>
        {canManageForms && (
          <div className="flex flex-wrap items-center gap-2">
            {dirty && (
              <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-700">
                Chưa lưu
              </span>
            )}
            {templateId && (
              <button
                type="button"
                onClick={handleDelete}
                className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50"
              >
                <Trash2 size={15} /> Xóa
              </button>
            )}
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-on-brand hover:bg-sky-400 disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu template
            </button>
          </div>
        )}
      </div>

      {message?.type === "error" && (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">{message.text}</div>
      )}
      {message?.type === "success" && (
        <div className="mb-5 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50 px-5 py-4 text-sm text-emerald-700">
          <CheckCircle2 size={16} /> {message.text}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
        <div className="rounded-2xl border border-sky-100 bg-white p-4 sm:p-6">
          <label className="mb-4 block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">Tên template</span>
            <input
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="VD: Thư mời HUNA 2026"
              className="admin-field w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none"
            />
          </label>
          <EmailComposer
            subject={subject}
            body={body}
            surveyTitle={name || "Sự kiện"}
            questions={questions}
            onSubjectChange={setSubject}
            onBodyChange={setBody}
          />
        </div>

        <div className="rounded-2xl border border-sky-100 bg-slate-50 p-3 xl:sticky xl:top-6">
          <EmailPreviewFrame subject={subject} body={body} surveyTitle={name || "Sự kiện"} />
        </div>
      </div>
    </div>
  );
}
