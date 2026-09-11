"use client";
import { useRef, useState } from "react";
import { FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  newEmailBlockId,
  parseEmailTemplate,
  serializeEmailTemplate,
  type EmailAttachment,
} from "@/lib/email-template";

const MAX_FILE_BYTES = 10 * 1024 * 1024;

function sanitizeFileName(name: string) {
  const cleaned = name.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9._-]+/g, "-");
  return cleaned.replace(/^-+|-+$/g, "").slice(-80) || "tep";
}

function formatSize(bytes?: number) {
  const value = Number(bytes) || 0;
  if (value <= 0) return "";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}

export function EmailAttachmentEditor({ body, onBodyChange }: { body: string; onBodyChange: (value: string) => void }) {
  const attachments = parseEmailTemplate(body).attachments ?? [];
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = (next: EmailAttachment[]) => {
    onBodyChange(serializeEmailTemplate({ ...parseEmailTemplate(body), attachments: next }));
  };

  const handleFiles = async (files: FileList) => {
    setError(null);
    setUploading(true);
    const next = [...attachments];
    try {
      for (const file of Array.from(files)) {
        if (file.size > MAX_FILE_BYTES) {
          setError(`"${file.name}" vượt quá 10MB nên bị bỏ qua.`);
          continue;
        }
        const path = `email-attachments/${Date.now()}-${sanitizeFileName(file.name)}`;
        const { error: uploadError } = await supabase.storage
          .from("survey-uploads")
          .upload(path, file, { contentType: file.type || "application/octet-stream", upsert: false });
        if (uploadError) {
          setError(`Không tải được "${file.name}": ${uploadError.message}`);
          continue;
        }
        const { data } = supabase.storage.from("survey-uploads").getPublicUrl(path);
        next.push({
          id: newEmailBlockId(),
          name: file.name,
          url: data.publicUrl,
          size: file.size,
          type: file.type,
        });
      }
      commit(next);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-4 py-2.5 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
        >
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {attachments.length > 0 ? "Thêm file đính kèm" : "Tải file đính kèm"}
        </button>
        <span className="text-xs text-slate-400">PDF, DOCX, hình ảnh… tối đa 10MB mỗi file.</span>
        <input
          ref={inputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(event) => {
            const files = event.target.files;
            if (files && files.length > 0) void handleFiles(files);
          }}
        />
      </div>

      {error && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">{error}</div>
      )}

      {attachments.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50 px-6 py-10 text-center text-sm text-slate-500">
          Chưa có file đính kèm. File tải lên đây sẽ được gửi kèm trong email.
        </div>
      ) : (
        <ul className="space-y-2">
          {attachments.map((attachment) => (
            <li key={attachment.id} className="flex items-center gap-3 rounded-xl border border-sky-100 bg-white px-3 py-2.5">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-sky-50 text-sky-600">
                <FileText size={16} />
              </div>
              <div className="min-w-0 flex-1">
                <a href={attachment.url} target="_blank" rel="noreferrer" className="block truncate text-sm font-semibold text-slate-800 hover:text-sky-600">
                  {attachment.name}
                </a>
                <div className="text-[11px] text-slate-400">{formatSize(attachment.size) || "File đính kèm"}</div>
              </div>
              <button
                type="button"
                onClick={() => commit(attachments.filter((item) => item.id !== attachment.id))}
                className="shrink-0 rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-500"
                title="Xóa file"
              >
                <Trash2 size={15} />
              </button>
            </li>
          ))}
        </ul>
      )}

      <p className="flex items-center gap-1.5 text-xs text-slate-400">
        <Paperclip size={12} /> {attachments.length} file sẽ được gửi kèm khi gửi thư.
      </p>
    </div>
  );
}
