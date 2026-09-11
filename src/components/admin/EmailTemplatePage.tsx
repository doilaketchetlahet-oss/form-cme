"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Bookmark, CheckCircle2, ExternalLink, Lock, Mail, RefreshCw, Save, Send } from "lucide-react";
import { useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { getRegistrationForm } from "@/lib/forms";
import { supabase } from "@/lib/supabase";
import type { Survey, SurveyQuestion } from "@/lib/surveys";
import type { EmailMergeQuestion } from "@/lib/email-template";
import { EmailComposer } from "./EmailComposer";

type EmailTemplateSummary = {
  id: string;
  name: string;
  subject: string | null;
  body: string;
  updated_at: string | null;
};

export function EmailTemplatePage({ formId }: { formId: string }) {
  const { canManageForms } = useAdminAccess();
  const [form, setForm] = useState<(Survey & { questions: SurveyQuestion[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [sendingTest, setSendingTest] = useState(false);
  const [templates, setTemplates] = useState<EmailTemplateSummary[]>([]);
  const [loadingTemplates, setLoadingTemplates] = useState(false);
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [editorKey, setEditorKey] = useState(0);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const next = await getRegistrationForm(formId);
      setForm(next);
      setSubject(next?.email_subject ?? "");
      setBody(next?.email_body ?? "");
      setLoading(false);
    })();
  }, [formId]);

  const getToken = useCallback(async () => {
    const { data: sessionData } = await supabase.auth.getSession();
    return sessionData.session?.access_token ?? null;
  }, []);

  const loadTemplates = useCallback(async () => {
    if (!canManageForms) return;
    setLoadingTemplates(true);
    try {
      const token = await getToken();
      if (!token) return;
      const response = await fetch("/api/admin/email-templates", {
        headers: { Authorization: `Bearer ${token}` },
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) return;
      setTemplates((result.templates ?? []) as EmailTemplateSummary[]);
    } finally {
      setLoadingTemplates(false);
    }
  }, [canManageForms, getToken]);

  useEffect(() => {
    let active = true;
    const run = async () => {
      await Promise.resolve();
      if (active) await loadTemplates();
    };
    void run();
    return () => { active = false; };
  }, [loadTemplates]);

  const applyTemplate = (templateId: string) => {
    setSelectedTemplateId(templateId);
    const template = templates.find((item) => item.id === templateId);
    if (!template) return;
    setSubject(template.subject ?? "");
    setBody(template.body);
    setEditorKey((key) => key + 1);
    setMessage({ type: "success", text: `Đã nạp template “${template.name}”.` });
  };

  const saveAsTemplate = async () => {
    if (!canManageForms || savingTemplate) return;
    const input = window.prompt("Tên template:", form?.title ?? "Template thư mời");
    const name = input?.trim();
    if (!name) return;
    setSavingTemplate(true);
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
        body: JSON.stringify({ name, subject: subject.trim() || null, body }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) {
        setMessage({ type: "error", text: result?.error ?? "Lưu template thất bại." });
        return;
      }
      setSelectedTemplateId(result.id);
      setMessage({ type: "success", text: `Đã lưu template “${name}”. Quản lý trong Kho template.` });
      await loadTemplates();
    } finally {
      setSavingTemplate(false);
    }
  };

  const handleSave = async () => {
    if (!canManageForms || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const token = await getToken();
      if (!token) {
        setMessage({ type: "error", text: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." });
        return;
      }
      const response = await fetch(`/api/admin/forms/${formId}/email`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ email_subject: subject.trim() || null, email_body: body.trim() || null }),
      });
      const result = await response.json().catch(() => ({ ok: false, error: `Lỗi server (HTTP ${response.status}).` }));
      if (!result.ok) {
        setMessage({ type: "error", text: result.error ?? "Lưu thư thất bại." });
        return;
      }
      setMessage({ type: "success", text: "Đã lưu thư mời." });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Lưu thư thất bại." });
    } finally {
      setSaving(false);
    }
  };

  const handleTestSend = async () => {
    if (!canManageForms || sendingTest) return;
    setSendingTest(true);
    setMessage(null);
    try {
      const token = await getToken();
      const { data: sessionData } = await supabase.auth.getSession();
      const userEmail = sessionData.session?.user.email;
      if (!token) {
        setMessage({ type: "error", text: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." });
        return;
      }
      const response = await fetch(`/api/admin/forms/${formId}/email/test`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ to: userEmail, email_subject: subject.trim() || null, email_body: body.trim() || null }),
      });
      const result = await response.json().catch(() => ({ ok: false, error: `Lỗi server (HTTP ${response.status}).` }));
      if (!result.ok) {
        setMessage({ type: "error", text: result.error ?? "Gửi thử thất bại." });
        return;
      }
      setMessage({ type: "success", text: `Đã gửi thư thử đến ${result.to}.` });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : "Gửi thử thất bại." });
    } finally {
      setSendingTest(false);
    }
  };

  const questionPayload: EmailMergeQuestion[] = useMemo(
    () => (form?.questions ?? []).map((question) => ({
      id: question.id,
      text: question.text,
      type: question.type,
      options: question.options,
    })),
    [form],
  );

  if (loading) {
    return (
      <div className="px-4 py-8 sm:px-8">
        <div className="glass rounded-2xl h-96 animate-pulse" />
      </div>
    );
  }

  if (!form) {
    return (
      <div className="px-4 py-8 sm:px-8 max-w-4xl">
        <Link href="/admin/forms" className="text-sm text-slate-400 hover:text-white flex items-center gap-2 mb-6">
          <ArrowLeft size={15} /> Quay lại
        </Link>
        <div className="glass rounded-2xl p-8 text-sm text-slate-400">Không tìm thấy form.</div>
      </div>
    );
  }

  const isCheckinForm = !form.form_type || form.form_type === "registration";

  return (
    <div className="px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link href={`/admin/forms/${form.id}`} className="mb-3 flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900">
            <ArrowLeft size={15} /> Quay lại form
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <Mail size={22} className="text-sky-500" /> Soạn thư mời
          </h1>
          <p className="mt-1 text-sm text-slate-600">{form.title}</p>
        </div>
        {canManageForms && isCheckinForm && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={handleTestSend}
              disabled={sendingTest || saving}
              className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-4 py-3 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
            >
              <Send size={15} /> {sendingTest ? "Đang gửi..." : "Gửi thử cho tôi"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-on-brand hover:bg-sky-400 disabled:opacity-50"
            >
              {saving ? "Đang lưu..." : "Lưu thư mời"}
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

      {!isCheckinForm ? (
        <div className="glass rounded-2xl p-8 text-sm text-slate-600">
          Form này không gửi email check-in. Đổi loại form sang Đăng ký CME để soạn thư mời.
        </div>
      ) : !canManageForms ? (
        <div className="glass rounded-2xl p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
            <Lock size={20} />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">Chỉ xem thư mời</h2>
          <p className="text-sm text-slate-600">Tài khoản này không được chỉnh sửa nội dung email.</p>
        </div>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap items-center gap-2 rounded-2xl border border-sky-100 bg-white p-3">
            <Bookmark size={16} className="text-sky-500" />
            <span className="text-sm font-semibold text-slate-700">Template</span>
            <select
              value={selectedTemplateId}
              onChange={(event) => applyTemplate(event.target.value)}
              disabled={loadingTemplates}
              className="admin-dark-select min-w-[180px] rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm text-slate-700 focus:outline-none disabled:opacity-60"
            >
              <option value="">Chọn template…</option>
              {templates.map((template) => (
                <option key={template.id} value={template.id}>{template.name}</option>
              ))}
            </select>
            <button
              type="button"
              onClick={saveAsTemplate}
              disabled={savingTemplate}
              className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
            >
              <Save size={14} /> Lưu thành template
            </button>
            <Link
              href="/admin/templates"
              className="inline-flex items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:text-sky-600"
            >
              <ExternalLink size={14} /> Kho template
            </Link>
            <button
              type="button"
              onClick={() => void loadTemplates()}
              disabled={loadingTemplates}
              title="Tải lại template"
              className="ml-auto inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500 hover:text-sky-600 disabled:opacity-50"
            >
              <RefreshCw size={14} className={loadingTemplates ? "animate-spin" : ""} /> Tải lại
            </button>
          </div>

          <div className="rounded-2xl border border-sky-100 bg-white p-4 sm:p-6">
            <EmailComposer
              key={`composer-${editorKey}`}
              subject={subject}
              body={body}
              surveyTitle={form.title}
              questions={questionPayload}
              onSubjectChange={setSubject}
              onBodyChange={setBody}
            />
          </div>
        </>
      )}
    </div>
  );
}
