"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, QrCode, Trash2, Type, Upload } from "lucide-react";
import { supabase } from "@/lib/supabase";
import {
  listMergeFields,
  newEmailBlockId,
  parseEmailTemplate,
  sampleMergeValues,
  serializeEmailTemplate,
  type EmailMergeQuestion,
  type EmailOverlay,
  type OverlayField,
} from "@/lib/email-template";

type Props = {
  body: string;
  surveyTitle: string;
  questions: EmailMergeQuestion[];
  onBodyChange: (value: string) => void;
};

function tokenKey(token: string) {
  return token.replace(/^\{\{|\}\}$/g, "").trim();
}

export function EmailOverlayEditor({ body, surveyTitle, questions, onBodyChange }: Props) {
  const parsed = useMemo(() => parseEmailTemplate(body), []);
  const [overlay, setOverlay] = useState<EmailOverlay | null>(() => parsed.overlay ?? null);
  const [selectedId, setSelectedId] = useState<string | null>(parsed.overlay?.fields[0]?.id ?? null);
  const [uploading, setUploading] = useState(false);
  const canvasRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; mode: "move" | "resize"; startX: number; startY: number; field: OverlayField } | null>(null);
  const overlayRef = useRef(overlay);

  const mergeFields = useMemo(
    () => listMergeFields(questions).filter((field) => field.token !== "{{qr_url}}" && field.token !== "{{checkin_url}}"),
    [questions],
  );
  const previewValues = useMemo(() => sampleMergeValues(surveyTitle || "Sự kiện"), [surveyTitle]);

  const commit = (next: EmailOverlay | null) => {
    setOverlay(next);
    overlayRef.current = next;
    onBodyChange(serializeEmailTemplate({
      ...parseEmailTemplate(body),
      overlay: next,
    }));
  };

  const updateField = (id: string, patch: Partial<OverlayField>, persist = true) => {
    const current = overlayRef.current;
    if (!current) return;
    const next = {
      ...current,
      fields: current.fields.map((field) => field.id === id ? { ...field, ...patch } : field),
    };
    setOverlay(next);
    overlayRef.current = next;
    if (persist) commit(next);
  };

  useEffect(() => {
    const onPointerMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      const box = canvasRef.current?.getBoundingClientRect();
      if (!drag || !box) return;
      const dx = ((event.clientX - drag.startX) / box.width) * 100;
      const dy = ((event.clientY - drag.startY) / box.height) * 100;
      if (drag.mode === "move") {
        updateField(drag.id, {
          x: Math.max(0, Math.min(100 - drag.field.w, drag.field.x + dx)),
          y: Math.max(0, Math.min(100 - drag.field.h, drag.field.y + dy)),
        }, false);
      } else {
        updateField(drag.id, {
          w: Math.max(6, Math.min(100 - drag.field.x, drag.field.w + dx)),
          h: Math.max(4, Math.min(100 - drag.field.y, drag.field.h + dy)),
        }, false);
      }
    };
    const onPointerUp = () => {
      if (dragRef.current && overlayRef.current) commit(overlayRef.current);
      dragRef.current = null;
    };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
    };
  }, [body, onBodyChange]);

  const addField = (token: string, kind: OverlayField["kind"]) => {
    if (!overlay) return;
    const field: OverlayField = {
      id: newEmailBlockId(),
      kind,
      token,
      x: kind === "qr" ? 70 : 12,
      y: kind === "qr" ? 72 : 18,
      w: kind === "qr" ? 18 : 50,
      h: kind === "qr" ? 18 : 8,
      fontSize: kind === "qr" ? undefined : 36,
      color: "#0f172a",
      align: "left",
      bold: kind !== "qr",
    };
    commit({ ...overlay, fields: [...overlay.fields, field] });
    setSelectedId(field.id);
  };

  const handleUpload = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const bitmap = await createImageBitmap(file);
      const canvas = document.createElement("canvas");
      const maxW = 1600;
      let { width, height } = bitmap;
      if (width > maxW) {
        height = Math.round((height * maxW) / width);
        width = maxW;
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(bitmap, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.88));
      if (!blob) return;
      const pathName = `email/invite-${Date.now()}.jpg`;
      const { error } = await supabase.storage.from("survey-uploads").upload(pathName, blob, { contentType: "image/jpeg", upsert: true });
      if (error) return;
      const { data } = supabase.storage.from("survey-uploads").getPublicUrl(pathName);
      commit({
        imageUrl: data.publicUrl,
        width,
        height,
        fields: overlay?.fields ?? [],
      });
    } finally {
      setUploading(false);
    }
  };

  const onPointerDown = (event: React.PointerEvent, field: OverlayField, mode: "move" | "resize") => {
    event.preventDefault();
    event.stopPropagation();
    setSelectedId(field.id);
    dragRef.current = { id: field.id, mode, startX: event.clientX, startY: event.clientY, field: { ...field } };
  };

  const selected = overlay?.fields.find((field) => field.id === selectedId) ?? null;

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px] xl:items-start">
      <div className="space-y-3">
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-sky-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700">
          {uploading ? <Loader2 size={15} className="animate-spin" /> : <Upload size={15} />}
          {overlay?.imageUrl ? "Đổi ảnh thiệp" : "Tải ảnh thiệp"}
          <input
            type="file"
            accept="image/*"
            className="hidden"
            onChange={(event) => {
              const file = event.target.files?.[0];
              if (file) handleUpload(file);
              event.target.value = "";
            }}
          />
        </label>

        {!overlay?.imageUrl ? (
          <div className="rounded-2xl border border-dashed border-sky-200 bg-sky-50 px-6 py-16 text-center text-sm text-slate-500">
            Tải ảnh thư mời đã xóa chỗ tên/QR. Sau đó kéo field vào đúng vị trí.
          </div>
        ) : (
          <div
            ref={canvasRef}
            className="relative overflow-hidden rounded-2xl border border-slate-200 bg-slate-100"
            onClick={() => setSelectedId(null)}
          >
            <img src={overlay.imageUrl} alt="Thiệp mời" className="block w-full select-none" draggable={false} />
            {overlay.fields.map((field) => {
              const key = tokenKey(field.token);
              const label = field.kind === "qr" ? "QR" : previewValues[key] || field.token;
              return (
                <div
                  key={field.id}
                  onClick={(event) => { event.stopPropagation(); setSelectedId(field.id); }}
                  onPointerDown={(event) => onPointerDown(event, field, "move")}
                  className={`absolute cursor-move border ${selectedId === field.id ? "border-sky-500 bg-sky-400/10" : "border-white/80 bg-black/5"}`}
                  style={{
                    left: `${field.x}%`,
                    top: `${field.y}%`,
                    width: `${field.w}%`,
                    height: `${field.h}%`,
                  }}
                >
                  <div
                    className="flex h-full w-full items-center overflow-hidden px-1"
                    style={{
                      justifyContent: field.align === "center" ? "center" : field.align === "right" ? "flex-end" : "flex-start",
                      color: field.color || "#0f172a",
                      fontWeight: field.bold ? 700 : 400,
                      fontSize: Math.max(10, (field.fontSize || 24) * 0.35),
                    }}
                  >
                    {field.kind === "qr" ? <QrCode size={18} /> : label}
                  </div>
                  <div
                    onPointerDown={(event) => onPointerDown(event, field, "resize")}
                    className="absolute right-0 bottom-0 h-3 w-3 cursor-se-resize bg-sky-500"
                  />
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="space-y-3 xl:sticky xl:top-6">
        <div className="rounded-2xl border border-sky-100 bg-white p-3">
          <div className="mb-2 text-[10px] uppercase tracking-widest text-slate-400">Thêm field</div>
          <div className="flex flex-wrap gap-1.5">
            {mergeFields.map((field) => (
              <button
                key={field.token}
                type="button"
                disabled={!overlay?.imageUrl}
                onClick={() => addField(field.token, "text")}
                className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700 disabled:opacity-40"
              >
                <Type size={10} className="mr-1 inline" />
                {field.label}
              </button>
            ))}
            <button
              type="button"
              disabled={!overlay?.imageUrl}
              onClick={() => addField("{{qr_image}}", "qr")}
              className="rounded-full bg-slate-900 px-2.5 py-1 text-[11px] font-medium text-white disabled:opacity-40"
            >
              <QrCode size={10} className="mr-1 inline" />
              QR
            </button>
          </div>
        </div>

        {selected && overlay && (
          <div className="rounded-2xl border border-sky-100 bg-white p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-slate-800">{selected.token}</div>
              <button
                type="button"
                onClick={() => commit({ ...overlay, fields: overlay.fields.filter((field) => field.id !== selected.id) })}
                className="text-slate-400 hover:text-red-500"
              >
                <Trash2 size={15} />
              </button>
            </div>
            {selected.kind === "text" && (
              <>
                <label className="block text-[11px] text-slate-500">
                  Cỡ chữ
                  <input
                    type="number"
                    min={12}
                    max={120}
                    value={selected.fontSize || 36}
                    onChange={(event) => updateField(selected.id, { fontSize: Number(event.target.value) || 36 })}
                    className="admin-field mt-1 w-full rounded-xl px-3 py-2 text-sm focus:outline-none"
                  />
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="color"
                    value={selected.color || "#0f172a"}
                    onChange={(event) => updateField(selected.id, { color: event.target.value })}
                    className="h-8 w-10 cursor-pointer rounded border-0 bg-transparent p-0"
                  />
                  <button
                    type="button"
                    onClick={() => updateField(selected.id, { bold: !selected.bold })}
                    className={`rounded-lg px-2 py-1 text-xs font-bold ${selected.bold ? "bg-sky-100 text-sky-700" : "text-slate-500"}`}
                  >
                    B
                  </button>
                  {(["left", "center", "right"] as const).map((align) => (
                    <button
                      key={align}
                      type="button"
                      onClick={() => updateField(selected.id, { align })}
                      className={`rounded-lg px-2 py-1 text-[11px] ${selected.align === align ? "bg-sky-100 text-sky-700" : "text-slate-500"}`}
                    >
                      {align === "left" ? "Trái" : align === "center" ? "Giữa" : "Phải"}
                    </button>
                  ))}
                </div>
              </>
            )}
            <p className="text-[11px] text-slate-400">Kéo box để đặt vị trí, kéo góc phải dưới để đổi kích thước.</p>
          </div>
        )}
      </div>
    </div>
  );
}
