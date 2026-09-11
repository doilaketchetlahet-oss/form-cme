"use client";
import { useEffect, useRef, useState } from "react";
import { Loader2, Paperclip, RefreshCw } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { parseEmailTemplate } from "@/lib/email-template";

type Props = {
  subject: string;
  body: string;
  surveyTitle?: string;
  className?: string;
};

export function EmailPreviewFrame({ subject, body, surveyTitle, className }: Props) {
  const [html, setHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [previewSubject, setPreviewSubject] = useState("");
  const requestId = useRef(0);
  const attachments = parseEmailTemplate(body).attachments ?? [];

  useEffect(() => {
    const handle = window.setTimeout(async () => {
      const id = requestId.current + 1;
      requestId.current = id;
      setLoading(true);
      setError(null);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const token = sessionData.session?.access_token;
        if (!token) {
          setError("Bạn cần đăng nhập lại.");
          return;
        }
        const response = await fetch("/api/admin/email-templates/preview", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ subject, body, surveyTitle }),
        });
        const result = await response.json().catch(() => null);
        if (id !== requestId.current) return;
        if (!response.ok || !result?.ok) {
          setError(result?.error ?? "Không tạo được bản xem trước.");
          return;
        }
        setHtml(result.html as string);
        setPreviewSubject((result.subject as string) ?? "");
      } catch (err) {
        if (id === requestId.current) setError(err instanceof Error ? err.message : "Không tạo được bản xem trước.");
      } finally {
        if (id === requestId.current) setLoading(false);
      }
    }, 500);

    return () => window.clearTimeout(handle);
  }, [subject, body, surveyTitle, reloadKey]);

  const srcDoc = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"></head><body style="margin:0;background:#eef2f6">${html}</body></html>`;

  return (
    <div className={className}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="text-[10px] uppercase tracking-widest text-slate-400">Xem trước</div>
        <button
          type="button"
          onClick={() => setReloadKey((key) => key + 1)}
          disabled={loading}
          className="inline-flex items-center gap-1 text-[11px] font-semibold text-slate-500 hover:text-sky-600 disabled:opacity-50"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> Làm mới
        </button>
      </div>

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
        <div className="border-b border-slate-100 px-4 py-3">
          <div className="text-[10px] uppercase tracking-widest text-slate-400">Subject</div>
          <div className="mt-1 text-sm font-semibold text-slate-800">{previewSubject || subject || "—"}</div>
          {attachments.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-1.5">
              {attachments.map((attachment) => (
                <span key={attachment.id} className="inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] text-slate-600">
                  <Paperclip size={10} /> {attachment.name}
                </span>
              ))}
            </div>
          )}
        </div>
        {error ? (
          <div className="px-4 py-6 text-sm text-red-600">{error}</div>
        ) : loading && !html ? (
          <div className="flex items-center justify-center gap-2 px-4 py-16 text-sm text-slate-400">
            <Loader2 size={16} className="animate-spin" /> Đang tạo bản xem trước…
          </div>
        ) : (
          <iframe title="Email preview" srcDoc={srcDoc} className="h-[620px] w-full bg-white" />
        )}
      </div>
    </div>
  );
}
