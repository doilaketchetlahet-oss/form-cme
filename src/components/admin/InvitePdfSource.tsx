"use client";
import { useRef, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { EmailOverlay } from "@/lib/email-template";
import { getInvitePdfPages, MAX_INVITE_PDF_BYTES, MAX_INVITE_PDF_PAGES } from "@/lib/invite-pdf";

type Props = { overlay: EmailOverlay | null; disabled: boolean; onBusy: (busy: boolean) => void; onChange: (overlay: EmailOverlay) => void };

export function InvitePdfSource({ overlay, disabled, onBusy, onChange }: Props) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const pageLayouts = overlay ? getInvitePdfPages(overlay) : {};

  const load = async (file?: File, selectedPage = 1) => {
    if (lock.current || disabled) return;
    const cached = pageLayouts[selectedPage];
    if (!file && overlay?.pdf && cached?.imageUrl) {
      setError("");
      onChange({ ...cached, pdf: { ...overlay.pdf, page: selectedPage, pages: pageLayouts } });
      return;
    }
    lock.current = true; setBusy(true); onBusy(true); setError("");
    let task: import("pdfjs-dist").PDFDocumentLoadingTask | undefined;
    try {
      if (file && (file.type !== "application/pdf" || file.size > MAX_INVITE_PDF_BYTES)) throw new Error("Chọn PDF tối đa 10MB.");
      let buffer: ArrayBuffer;
      if (file) buffer = await file.arrayBuffer();
      else {
        if (!overlay?.pdf) return;
        const response = await fetch(overlay.pdf.url);
        if (!response.ok) throw new Error("Không tải được PDF gốc. Vui lòng thử lại hoặc tải lại file.");
        buffer = await response.arrayBuffer();
        if (buffer.byteLength > MAX_INVITE_PDF_BYTES) throw new Error("PDF gốc vượt quá 10MB.");
      }
      // Keep our bytes: PDF.js transfers its input buffer to the worker.
      const { PDFDocument } = await import("pdf-lib");
      await PDFDocument.load(buffer); // Reject encrypted/unsupported files before storing anything.
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      task = pdfjs.getDocument({ data: buffer.slice(0), password: "" });
      const doc = await task.promise;
      if (doc.numPages > MAX_INVITE_PDF_PAGES) throw new Error("Mẫu thiệp hỗ trợ tối đa 100 trang.");
      if (file && Object.entries(pageLayouts).some(([number, layout]) => Number(number) > doc.numPages && layout.fields.length)) throw new Error("PDF mới có ít trang hơn các trang đã đặt trường. Hãy xóa trường ở những trang không còn trong PDF mới trước khi thay file.");
      const page = await doc.getPage(selectedPage);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: Math.min(2, 2400 / Math.max(base.width, base.height)) });
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(viewport.width)); canvas.height = Math.max(1, Math.round(viewport.height));
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Không tạo được bản xem trước.");
      await page.render({ canvas, canvasContext: ctx, viewport }).promise;
      const preview = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!preview) throw new Error("Không tạo được bản xem trước.");
      const upload = async (path: string, body: Blob, contentType: string) => {
        const { error } = await supabase.storage.from("survey-uploads").upload(path, body, { contentType, upsert: false });
        if (error) throw new Error(`Không tải lên được file: ${error.message}`);
        return supabase.storage.from("survey-uploads").getPublicUrl(path).data.publicUrl;
      };
      const id = crypto.randomUUID();
      const originalUrl = file ? await upload(`email/pdf-${id}.pdf`, file, "application/pdf") : overlay!.pdf!.url;
      const imageUrl = await upload(`email/pdf-preview-${id}.jpg`, preview, "image/jpeg");
      const pages = file ? Object.fromEntries(Object.entries(pageLayouts).filter(([number]) => Number(number) <= doc.numPages).map(([number, layout]) => [number, { ...layout, imageUrl: "" }])) : pageLayouts;
      const current = { imageUrl, width: canvas.width, height: canvas.height, fields: pages[selectedPage]?.fields ?? [] };
      onChange({ ...current, pdf: {
        url: originalUrl, name: (file?.name ?? overlay!.pdf!.name).slice(0, 255), page: selectedPage, pageCount: doc.numPages,
        pages: { ...pages, [selectedPage]: current },
      } });
    } catch (error) {
      setError(error instanceof Error && (error.name === "PasswordException" || /encrypted/i.test(error.message)) ? "PDF có mật khẩu. Hãy tải bản PDF không khóa." : error instanceof Error ? error.message : "Không đọc được PDF.");
    } finally { await task?.destroy().catch(() => {}); lock.current = false; setBusy(false); onBusy(false); }
  };

  return <div className="mb-4 space-y-3 rounded-xl border border-sky-100 bg-sky-50/60 p-4" aria-busy={busy}>
    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-sky-200 bg-white px-4 py-2 text-sm font-semibold text-sky-800 focus-within:ring-2 focus-within:ring-sky-500">
      {busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <FileText size={16} aria-hidden="true" />}
      {busy ? "Đang xử lý PDF…" : overlay?.pdf ? "Thay PDF gốc" : "Tải PDF gốc"}
      <input type="file" accept="application/pdf" className="sr-only" disabled={disabled || busy} onChange={event => { const file = event.target.files?.[0]; event.target.value = ""; if (file) void load(file); }} />
    </label>
    {overlay?.pdf ? <>
      <p className="break-words text-sm font-medium text-slate-800">{overlay.pdf.name} · {overlay.pdf.pageCount} trang</p>
      <label className="block text-sm font-medium text-slate-700">Trang đang chỉnh sửa
        <select aria-label="Trang đang chỉnh sửa" className="mt-1 block min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-base sm:max-w-xs" disabled={disabled || busy} value={overlay.pdf.page} onChange={event => void load(undefined, Number(event.target.value))}>
          {Array.from({ length: overlay.pdf.pageCount }, (_, index) => <option key={index} value={index + 1}>Trang {index + 1} · {pageLayouts[index + 1]?.fields.length ?? 0} trường</option>)}
        </select>
      </label>
      <p className="text-sm text-slate-600">Đang sửa trang {overlay.pdf.page}. Mỗi trang có tên/QR riêng; chuyển trang giữ nguyên các trường đã đặt. Khi xuất hoặc gửi email, tất cả trang được cá nhân hóa trong cùng một PDF đủ {overlay.pdf.pageCount} trang.</p>
      <p className="text-sm font-medium text-sky-800">{Object.values(pageLayouts).filter(layout => layout.fields.length > 0).length} trang đã đặt trường · Nhấn Lưu mẫu sau khi chỉnh sửa xong.</p>
    </> : <p className="text-sm text-slate-600">PDF tối đa 10MB / 100 trang. Mẫu cũ chỉ có ảnh nền: tải lại PDF gốc để giữ đủ các trang.</p>}
    <p role="status" className="text-sm text-sky-800">{busy ? "Đang tải và tạo bản xem trước. Vui lòng chờ trước khi lưu hoặc xuất." : ""}</p>
    {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
  </div>;
}
