"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Lock, Mail } from "lucide-react";
import { useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { getRegistrationForm } from "@/lib/forms";
import { supabase } from "@/lib/supabase";
import type { Survey, SurveyQuestion } from "@/lib/surveys";
import { EmailTemplateEditor } from "./EmailTemplateEditor";

export function EmailTemplatePage({ formId }: { formId: string }) {
  const { canManageForms } = useAdminAccess();
  const [form, setForm] = useState<(Survey & { questions: SurveyQuestion[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

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

  const handleSave = async () => {
    if (!canManageForms || saving) return;
    setSaving(true);
    setMessage(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setMessage({ type: "error", text: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." });
        return;
      }

      const response = await fetch(`/api/admin/forms/${formId}/email`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email_subject: subject.trim() || null,
          email_body: body.trim() || null,
        }),
      });
      const result = await response.json().catch(() => ({ ok: false, error: "Không đọc được phản hồi từ server." }));
      if (!result.ok) {
        setMessage({ type: "error", text: result.error ?? "Lưu thư thất bại." });
        return;
      }
      setMessage({ type: "success", text: "Đã lưu thư mời." });
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Lưu thư thất bại.",
      });
    } finally {
      setSaving(false);
    }
  };

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
          <button
            type="button"
            onClick={handleSave}
            disabled={saving}
            className="rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-on-brand hover:bg-sky-400 disabled:opacity-50"
          >
            {saving ? "Đang lưu..." : "Lưu thư mời"}
          </button>
        )}
      </div>

      {message?.type === "error" && (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">
          {message.text}
        </div>
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
        <div className="rounded-2xl border border-sky-100 bg-white p-4 sm:p-6">
          <EmailTemplateEditor
            subject={subject}
            body={body}
            surveyTitle={form.title}
            questions={form.questions.map((question) => ({
              id: question.id,
              text: question.text,
              type: question.type,
              options: question.options,
            }))}
            onSubjectChange={setSubject}
            onBodyChange={setBody}
          />
        </div>
      )}
    </div>
  );
}
