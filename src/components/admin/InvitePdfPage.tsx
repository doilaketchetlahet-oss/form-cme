"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, FileText, Loader2, Lock, Save, Upload } from "lucide-react";
import { toast } from "sonner";
import { useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { getRegistrationForm } from "@/lib/forms";
import { supabase } from "@/lib/supabase";
import type { Survey, SurveyQuestion, SurveyResponse } from "@/lib/surveys";
import {
  buildMergeValues,
  parseEmailTemplate,
  serializeEmailTemplate,
  type EmailMergeQuestion,
  type EmailOverlay,
  type OverlayField,
} from "@/lib/email-template";
import { buildPublicUrl } from "@/lib/site-url";
import { EmailOverlayEditor } from "./EmailOverlayEditor";

function tokenKey(token: string) {
  return token.replace(/^\{\{|\}\}$/g, "").trim();
}

function isQrField(field: OverlayField) {
  const key = tokenKey(field.token);
  return field.kind === "qr" || key === "qr_url" || key === "qr_image";
}

function sanitizeFilename(name: string) {
  return name.replace(/[\\/:*?"<>|]/g, " ").replace(/\s+/g, " ").replace(/\.+$/g, "").trim().slice(0, 80) || "khach";
}

function loadImageElement(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

export function InvitePdfPage({ formId }: { formId: string }) {
  const { canManageForms } = useAdminAccess();
  const [form, setForm] = useState<(Survey & { questions: SurveyQuestion[] }) | null>(null);
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [rasterizing, setRasterizing] = useState(false);
  const [editorKey, setEditorKey] = useState(0);
  const [overlay, setOverlay] = useState<EmailOverlay | null>(null);

  useEffect(() => {
    (async () => {
      setLoading(true);
      const [next, respResult] = await Promise.all([
        getRegistrationForm(formId),
        supabase.from("survey_responses").select("*").eq("survey_id", formId).order("submitted_at", { ascending: true }),
      ]);
      setForm(next);
      setResponses((respResult.data ?? []) as SurveyResponse[]);
      const template = (next as { pdf_template?: EmailOverlay | null } | null)?.pdf_template ?? null;
      setOverlay(template);
      setLoading(false);
    })();
  }, [formId]);

  const questionPayload: EmailMergeQuestion[] = useMemo(
    () => (form?.questions ?? []).map((q) => ({ id: q.id, text: q.text, type: q.type, options: q.options })),
    [form],
  );

  const editorBody = serializeEmailTemplate({
    v: 1,
    mode: "overlay",
    includeBlocks: false,
    includeOverlay: true,
    blocks: [],
    overlay,
    attachments: [],
  });

  const handleSave = async () => {
    if (!canManageForms || saving) return;
    setSaving(true);
    try {
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) { toast.error("Phiên đăng nhập đã hết hạn."); return; }
      const response = await fetch(`/api/admin/forms/${formId}/pdf`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ pdf_template: overlay }),
      });
      const result = await response.json().catch(() => null);
      if (!response.ok || !result?.ok) { toast.error(result?.error ?? "Lưu thất bại."); return; }
      toast.success("Đã lưu mẫu PDF thư mời.");
    } finally {
      setSaving(false);
    }
  };

  const exportZip = async () => {
    if (exporting) return;
    if (!overlay?.imageUrl) { toast.error("Chưa có ảnh nền thư mời."); return; }
    if (responses.length === 0) { toast.error("Chưa có người đăng ký."); return; }

    setExporting(true);
    toast.info(`Đang tạo ${responses.length} PDF…`);
    try {
      const [{ jsPDF }, JSZipModule, qrcodeModule, bg] = await Promise.all([
        import("jspdf"),
        import("jszip"),
        import("qrcode"),
        loadImageElement(overlay.imageUrl),
      ]);
      const JSZip = JSZipModule.default;
      const QRCode = (qrcodeModule.default ?? qrcodeModule) as { toDataURL: (text: string, options?: unknown) => Promise<string> };
      const zip = new JSZip();
      const width = Math.max(1, overlay.width || bg.naturalWidth);
      const height = Math.max(1, overlay.height || bg.naturalHeight);
      const used = new Map<string, number>();

      for (const response of responses) {
        const checkinUrl = buildPublicUrl(`/checkin/${response.id}`);
        const values = buildMergeValues({
          name: "",
          email: response.email ?? "",
          hall: response.hall ?? "",
          surveyTitle: form?.title ?? "",
          checkinUrl,
          qrImgUrl: "",
          answers: response.answers,
          questions: questionPayload,
        }, false);

        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext("2d");
        if (!ctx) continue;
        ctx.drawImage(bg, 0, 0, width, height);

        for (const field of overlay.fields) {
          const left = (field.x / 100) * width;
          const top = (field.y / 100) * height;
          const boxW = Math.max(8, (field.w / 100) * width);
          const boxH = Math.max(8, (field.h / 100) * height);

          if (isQrField(field)) {
            const size = Math.max(48, Math.round(Math.min(boxW, boxH)));
            const qrDataUrl = await QRCode.toDataURL(checkinUrl, {
              width: size,
              margin: 1,
              errorCorrectionLevel: "M",
              color: { dark: "#0f172a", light: "#ffffff" },
            });
            const qrImg = await loadImageElement(qrDataUrl);
            const x = field.align === "center" ? left + (boxW - size) / 2 : field.align === "right" ? left + boxW - size : left;
            ctx.drawImage(qrImg, x, top + (boxH - size) / 2, size, size);
            continue;
          }

          const text = values[tokenKey(field.token)] ?? "";
          if (!text) continue;
          let fontSize = Math.max(12, Number(field.fontSize) || Math.round(boxH * 0.55));
          const color = field.color || "#0f172a";
          ctx.fillStyle = color;
          ctx.textBaseline = "middle";
          ctx.textAlign = field.align === "center" ? "center" : field.align === "right" ? "right" : "left";
          const cx = field.align === "center" ? left + boxW / 2 : field.align === "right" ? left + boxW : left;
          const cy = top + boxH / 2;
          ctx.font = `${field.bold ? "bold " : ""}${fontSize}px Arial, sans-serif`;
          while (ctx.measureText(text).width > boxW && fontSize > 8) {
            fontSize -= 1;
            ctx.font = `${field.bold ? "bold " : ""}${fontSize}px Arial, sans-serif`;
          }
          ctx.fillText(text, cx, cy);
        }

        const imageData = canvas.toDataURL("image/jpeg", 0.92);
        const orientation = width >= height ? "landscape" : "portrait";
        const pdf = new jsPDF({ orientation, unit: "px", format: [width, height] });
        pdf.addImage(imageData, "JPEG", 0, 0, width, height);

        const rawName = values.name || (response.email ? String(response.email).split("@")[0] : "") || response.id.slice(0, 8);
        let filename = sanitizeFilename(rawName);
        const seen = used.get(filename) ?? 0;
        used.set(filename, seen + 1);
        if (seen > 0) filename = `${filename}_${seen + 1}`;

        zip.file(`${filename}.pdf`, pdf.output("blob"));
      }

      const content = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(content);
      const a = document.createElement("a");
      a.href = url;
      a.download = `thumoi-${(form?.title || "export").replace(/\s+/g, "-").toLowerCase()}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      toast.success(`Đã xuất ${responses.length} PDF.`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Xuất PDF thất bại.");
    } finally {
      setExporting(false);
    }
  };

  const handlePdfFile = async (file: File) => {
    if (file.type !== "application/pdf") { toast.error("Vui lòng chọn file PDF."); return; }
    setRasterizing(true);
    try {
      const pdfjs = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      const buffer = await file.arrayBuffer();
      const doc = await pdfjs.getDocument({ data: buffer }).promise;
      const page = await doc.getPage(1);
      const viewport = page.getViewport({ scale: 2 });
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Không tạo được canvas.");
      await page.render({ canvasContext: ctx, viewport, canvas }).promise;
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.9));
      if (!blob) throw new Error("Không tạo được ảnh từ PDF.");
      const pathName = `theme/pdf-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("survey-uploads").upload(pathName, blob, { contentType: "image/jpeg", upsert: true });
      if (error) throw new Error(error.message);
      const { data } = supabase.storage.from("survey-uploads").getPublicUrl(pathName);
      setOverlay((prev) => ({ imageUrl: data.publicUrl, width: canvas.width, height: canvas.height, fields: prev?.fields ?? [] }));
      setEditorKey((key) => key + 1);
      toast.success("Đã nạp PDF gốc làm ảnh nền.");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Đọc PDF thất bại.");
    } finally {
      setRasterizing(false);
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
        <Link href="/admin/forms" className="mb-6 flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900">
          <ArrowLeft size={15} /> Quay lại
        </Link>
        <div className="glass rounded-2xl p-8 text-sm text-slate-500">Không tìm thấy form.</div>
      </div>
    );
  }

  return (
    <div className="px-4 py-8 sm:px-8">
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link href={`/admin/forms/${form.id}`} className="mb-3 flex items-center gap-2 text-sm text-slate-500 hover:text-slate-900">
            <ArrowLeft size={15} /> Quay lại form
          </Link>
          <h1 className="flex items-center gap-2 text-2xl font-bold text-slate-900">
            <FileText size={22} className="text-sky-500" /> Thư mời PDF
          </h1>
          <p className="mt-1 text-sm text-slate-600">{form.title} · {responses.length} người đăng ký</p>
        </div>
        {canManageForms && (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={exportZip}
              disabled={exporting || saving}
              className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-4 py-3 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
            >
              {exporting ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />} {exporting ? "Đang xuất…" : "Xuất PDF (ZIP)"}
            </button>
            <button
              type="button"
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-on-brand hover:bg-sky-400 disabled:opacity-50"
            >
              {saving ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu mẫu
            </button>
          </div>
        )}
      </div>

      {!canManageForms ? (
        <div className="glass rounded-2xl p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-amber-200 bg-amber-50 text-amber-600">
            <Lock size={20} />
          </div>
          <h2 className="mb-2 text-lg font-semibold text-slate-900">Chỉ xem</h2>
          <p className="text-sm text-slate-600">Tài khoản này không được chỉnh sửa mẫu PDF.</p>
        </div>
      ) : (
        <div className="rounded-2xl border border-sky-100 bg-white p-4 sm:p-6">
          <div className="mb-4 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-700">
            Tải <strong>file PDF gốc</strong> (tự chuyển thành ảnh nền) hoặc ảnh nền, rồi kéo field <strong>tên</strong> và <strong>QR</strong> vào đúng vị trí. Khi xuất, mỗi người nhận 1 file PDF với tên file = tên người.
          </div>
          <label className="mb-4 inline-flex cursor-pointer items-center gap-2 rounded-xl border border-sky-200 bg-white px-4 py-2.5 text-sm font-semibold text-sky-700 hover:bg-sky-50">
            {rasterizing ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
            {rasterizing ? "Đang đọc PDF…" : "Tải PDF gốc"}
            <input
              type="file"
              accept="application/pdf"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0];
                if (file) void handlePdfFile(file);
                event.target.value = "";
              }}
            />
          </label>
          <EmailOverlayEditor
            key={editorKey}
            body={editorBody}
            surveyTitle={form.title}
            questions={questionPayload}
            onBodyChange={(next) => setOverlay(parseEmailTemplate(next).overlay ?? null)}
          />
          <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
            <CheckCircle2 size={13} /> Xuất PDF chạy ngay trên trình duyệt, không cần chờ server.
          </p>
        </div>
      )}
    </div>
  );
}
