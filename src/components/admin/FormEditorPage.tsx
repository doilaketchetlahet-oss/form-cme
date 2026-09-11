"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, BarChart3, CheckCircle2, ExternalLink, Lock, Mail, QrCode, Smartphone, Trophy } from "lucide-react";
import { useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { getRegistrationForm, type RegistrationFormSave } from "@/lib/forms";
import { supabase } from "@/lib/supabase";
import type { Survey, SurveyQuestion } from "@/lib/surveys";
import { SurveyEditor } from "./SurveyEditor";

type StatusMessage = {
  type: "success" | "error";
  text: string;
};

export function FormEditorPage({ formId }: { formId: string }) {
  const { canManageForms } = useAdminAccess();
  const [form, setForm] = useState<(Survey & { questions: SurveyQuestion[] }) | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<StatusMessage | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      setForm(await getRegistrationForm(formId));
      setLoading(false);
    })();
  }, [formId]);

  const handleSave = async (payload: RegistrationFormSave) => {
    if (!canManageForms) {
      setMessage({ type: "error", text: "Bạn không có quyền chỉnh sửa form." });
      return;
    }
    setSaving(true);
    setMessage(null);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        setMessage({ type: "error", text: "Phiên đăng nhập đã hết hạn. Vui lòng đăng nhập lại." });
        return;
      }

      const response = await fetch(`/api/admin/forms/${formId}/save`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });
      const result = await response.json().catch(() => ({ ok: false, error: "Không đọc được phản hồi từ server." }));

      if (!result.ok) {
        setMessage({ type: "error", text: result.error ?? "Lưu thất bại. Vui lòng thử lại." });
        return;
      }
      setMessage({ type: "success", text: "Đã lưu form." });
      setForm(await getRegistrationForm(formId));
    } catch (error) {
      setMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Lưu thất bại. Vui lòng thử lại.",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="px-4 py-8 sm:px-8 max-w-4xl">
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
  const isScoringForm = form.form_type === "poster_scoring";

  return (
    <div className="px-4 py-8 sm:px-8 max-w-7xl">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-6">
        <div>
        <Link href="/admin/forms" className="text-sm text-slate-500 hover:text-slate-900 flex items-center gap-2 mb-3">
          <ArrowLeft size={15} /> Tất cả form
        </Link>
        <h1 className="text-2xl font-bold text-slate-900">{form.title}</h1>
        <p className="text-sm text-slate-600 mt-1">
            {canManageForms
              ? isCheckinForm
                ? "Chỉnh sửa câu hỏi, email, PIN check-in và giao diện màn quét."
                : "Chỉnh sửa câu hỏi, cấu hình chấm điểm và giao diện form."
              : "Bạn đang ở quyền chỉ xem. Người có quyền quản trị mới chỉnh sửa được form này."}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Link href={`/s/${form.id}`} target="_blank" className="w-10 h-10 rounded-xl glass flex items-center justify-center text-slate-500 hover:text-slate-900" title="Mở form public">
            <ExternalLink size={16} />
          </Link>
          {isCheckinForm && (
            <>
              <Link href={`/admin/forms/${form.id}/email`} className="w-10 h-10 rounded-xl glass flex items-center justify-center text-slate-500 hover:text-sky-600" title="Soạn thư mời">
                <Mail size={16} />
              </Link>
              <Link href={`/attendees/${form.id}`} target="_blank" className="w-10 h-10 rounded-xl glass flex items-center justify-center text-slate-500 hover:text-indigo-600" title="Dashboard check-in">
                <QrCode size={16} />
              </Link>
            </>
          )}
          <Link href={`/admin/forms/${form.id}/report`} className="w-10 h-10 rounded-xl glass flex items-center justify-center text-slate-500 hover:text-sky-600" title="Report">
            <BarChart3 size={16} />
          </Link>
          {isScoringForm && (
            <Link href={`/admin/forms/${form.id}/scoreboard`} className="w-10 h-10 rounded-xl glass flex items-center justify-center text-slate-500 hover:text-amber-600" title="Bảng điểm poster">
              <Trophy size={16} />
            </Link>
          )}
        </div>
      </div>

      {message?.type === "error" && (
        <div className="mb-5 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-sm text-red-600">
          <div className="font-semibold text-red-700">Lưu form thất bại</div>
          <div className="mt-1 text-red-600/90">{message.text}</div>
        </div>
      )}

      {message?.type === "success" && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-sky-900/40 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-2xl border border-sky-100 bg-white p-6 shadow-2xl shadow-sky-200/50">
            <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-sky-200 bg-sky-50 text-sky-600">
              <CheckCircle2 size={28} />
            </div>
            <div className="text-center">
              <h2 className="text-xl font-semibold text-slate-900">Đã lưu thay đổi</h2>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Cấu hình form đã được cập nhật. Bạn có thể tiếp tục chỉnh sửa hoặc mở form public để kiểm tra.
              </p>
            </div>
            <div className="mt-6 flex flex-col gap-2">
              <button
                type="button"
                onClick={() => setMessage(null)}
                className="w-full rounded-xl bg-sky-500 px-4 py-3 text-sm font-semibold text-on-brand transition-colors hover:bg-sky-400"
              >
                Tiếp tục chỉnh sửa
              </button>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <Link
                  href={`/s/${form.id}`}
                  target="_blank"
                  onClick={() => setMessage(null)}
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <ExternalLink size={15} /> Mở form
                </Link>
                <Link
                  href="/admin/forms"
                  className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm text-slate-700 transition-colors hover:bg-slate-50"
                >
                  <ArrowLeft size={15} /> Danh sách
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}

      {canManageForms ? (
        <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_420px] xl:items-start">
          <SurveyEditor
            initial={form}
            onSave={handleSave}
            onCancel={() => { window.location.href = "/admin/forms"; }}
            saving={saving}
          />
          <FormPreviewPanel formId={form.id} />
        </div>
      ) : (
        <div className="glass rounded-2xl p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
            <Lock size={20} />
          </div>
          <h2 className="text-lg font-semibold text-slate-900 mb-2">Chỉ xem form</h2>
          <p className="mx-auto max-w-lg text-sm text-slate-600 mb-5">
            Tài khoản này có thể xem danh sách form, mở form public, xuất dữ liệu và theo dõi check-in, nhưng không thể sửa cấu hình form.
          </p>
          <div className="flex flex-wrap justify-center gap-2">
            <Link href={`/s/${form.id}`} target="_blank" className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm text-slate-700 hover:bg-slate-50">
              <ExternalLink size={15} /> Mở form public
            </Link>
            {isCheckinForm && (
              <>
                <Link href={`/admin/forms/${form.id}/email`} className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-700 hover:bg-sky-100">
                  <Mail size={15} /> Soạn thư mời
                </Link>
                <Link href={`/attendees/${form.id}`} target="_blank" className="inline-flex items-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-2 text-sm text-indigo-700 hover:bg-indigo-100">
                  <QrCode size={15} /> Dashboard check-in
                </Link>
              </>
            )}
            <Link href={`/admin/forms/${form.id}/report`} className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-sky-50 px-4 py-2 text-sm text-sky-700 hover:bg-sky-100">
              <BarChart3 size={15} /> Report
            </Link>
            {isScoringForm && (
              <Link href={`/admin/forms/${form.id}/scoreboard`} className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-700 hover:bg-amber-100">
                <Trophy size={15} /> Bảng điểm
              </Link>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function FormPreviewPanel({ formId }: { formId: string }) {
  return (
    <div className="glass-strong rounded-2xl p-4 xl:sticky xl:top-6">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-sm font-semibold text-slate-900">
            <Smartphone size={16} className="text-sky-500" /> Preview form
          </div>
          <p className="mt-1 text-xs text-slate-600">Chế độ xem trước không ghi dữ liệu.</p>
        </div>
        <Link href={`/s/${formId}`} target="_blank" className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-slate-200 bg-white text-slate-500 hover:text-slate-900 hover:bg-slate-50" title="Mở form public">
          <ExternalLink size={15} />
        </Link>
      </div>
      <div className="mx-auto max-w-[390px] overflow-hidden rounded-[28px] border border-slate-700 bg-slate-950 shadow-2xl shadow-slate-300/60">
        <div className="flex h-8 items-center justify-center border-b border-slate-800 bg-slate-900">
          <div className="h-1.5 w-16 rounded-full bg-slate-600" />
        </div>
        <iframe
          title="Form preview"
          src={`/s/${formId}?preview=1`}
          className="h-[680px] w-full bg-white"
        />
      </div>
    </div>
  );
}
