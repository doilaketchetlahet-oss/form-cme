"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlignCenter, AlignLeft, AlignRight, Bold, ChevronDown, ChevronUp, Heading, ImageIcon,
  Link2, Loader2, Minus, QrCode, Square, Trash2, Type, Upload,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { ThemeImageUpload } from "./ThemeImageUpload";
import {
  compileEmailHtml,
  defaultEmailBlocks,
  fillMergeTokens,
  listMergeFields,
  newEmailBlockId,
  normalizeEmailTheme,
  parseEmailTemplate,
  sampleMergeValues,
  serializeEmailTemplate,
  type EmailBlock,
  type EmailBlockAlign,
  type EmailBlockType,
  type EmailMergeQuestion,
  type EmailTheme,
} from "@/lib/email-template";

type Props = {
  subject: string;
  body: string;
  surveyTitle: string;
  questions: EmailMergeQuestion[];
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
};

const BLOCK_OPTIONS: { type: EmailBlockType; label: string; icon: React.ReactNode }[] = [
  { type: "heading", label: "Tiêu đề", icon: <Heading size={13} /> },
  { type: "text", label: "Đoạn văn", icon: <Type size={13} /> },
  { type: "image", label: "Hình ảnh", icon: <ImageIcon size={13} /> },
  { type: "button", label: "Nút bấm", icon: <Link2 size={13} /> },
  { type: "qr", label: "Mã QR", icon: <QrCode size={13} /> },
  { type: "divider", label: "Đường kẻ", icon: <Minus size={13} /> },
  { type: "spacer", label: "Khoảng trống", icon: <Square size={13} /> },
];

async function compress(file: File, maxWidth = 1200): Promise<Blob> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      let { width, height } = img;
      if (width > maxWidth) {
        height = (height * maxWidth) / width;
        width = maxWidth;
      }
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
      canvas.toBlob((blob) => resolve(blob ?? file), "image/jpeg", 0.84);
    };
    img.src = URL.createObjectURL(file);
  });
}

export function EmailTemplateEditor({
  subject,
  body,
  surveyTitle,
  questions,
  onSubjectChange,
  onBodyChange,
}: Props) {
  const parsed = useMemo(() => parseEmailTemplate(body), []);
  const [blocks, setBlocks] = useState<EmailBlock[]>(() => parsed.blocks);
  const [theme, setTheme] = useState<EmailTheme>(() => normalizeEmailTheme(parsed.theme));
  const [focusId, setFocusId] = useState<string | null>(parsed.blocks[0]?.id ?? null);
  const initialized = useRef(false);

  const commit = (nextBlocks: EmailBlock[], nextTheme = theme) => {
    setBlocks(nextBlocks);
    setTheme(nextTheme);
    const current = parseEmailTemplate(body);
    onBodyChange(serializeEmailTemplate({
      ...current,
      mode: "blocks",
      blocks: nextBlocks,
      theme: nextTheme,
    }));
  };

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    if (!body.trim()) {
      onBodyChange(serializeEmailTemplate({ v: 1, mode: "blocks", blocks, theme, overlay: null }));
    }
  }, [body, blocks, theme, onBodyChange]);

  const mergeFields = useMemo(() => listMergeFields(questions), [questions]);
  const previewHtml = useMemo(() => {
    const values = sampleMergeValues(surveyTitle || "Sự kiện");
    const qrPreview = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=preview";
    values.qr_image = qrPreview;
    const serialized = serializeEmailTemplate({ v: 1, mode: "blocks", blocks, theme, overlay: parseEmailTemplate(body).overlay });
    return compileEmailHtml(serialized, values, qrPreview);
  }, [blocks, theme, surveyTitle]);

  const updateBlock = (id: string, patch: Partial<EmailBlock>) => {
    commit(blocks.map((block) => block.id === id ? { ...block, ...patch } : block));
  };

  const patchTheme = (patch: Partial<EmailTheme>) => {
    commit(blocks, { ...theme, ...patch });
  };

  const addBlock = (type: EmailBlockType) => {
    const nextBlock: EmailBlock = {
      id: newEmailBlockId(),
      type,
      align: type === "qr" || type === "button" || type === "image" ? "center" : "left",
      text: type === "heading" ? "Tiêu đề email" : type === "text" ? "Nhập nội dung..." : type === "button" ? "Mở mã check-in" : "",
      url: type === "button" ? "{{checkin_url}}" : "",
      height: type === "spacer" ? 16 : undefined,
      qrSize: type === "qr" ? 220 : undefined,
    };
    const index = focusId ? blocks.findIndex((block) => block.id === focusId) : blocks.length - 1;
    const next = [...blocks];
    next.splice(index + 1, 0, nextBlock);
    commit(next);
    setFocusId(nextBlock.id);
  };

  const moveBlock = (id: string, direction: -1 | 1) => {
    const index = blocks.findIndex((block) => block.id === id);
    const target = index + direction;
    if (index < 0 || target < 0 || target >= blocks.length) return;
    const next = [...blocks];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    commit(next);
  };

  const insertToken = (token: string) => {
    const target = blocks.find((block) => block.id === focusId) ?? blocks.find((block) => block.type === "heading" || block.type === "text" || block.type === "button");
    if (!target) return;
    if (target.type === "button") {
      updateBlock(target.id, { text: `${target.text || ""}${token}` });
      return;
    }
    if (target.type === "heading" || target.type === "text" || target.type === "html") {
      updateBlock(target.id, { text: `${target.text || ""}${token}` });
    }
  };

  const resetDefault = () => {
    const next = defaultEmailBlocks();
    const nextTheme = normalizeEmailTheme();
    commit(next, nextTheme);
    setFocusId(next[0]?.id ?? null);
  };

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_400px] xl:items-start">
      <div className="space-y-3">
        <label className="block">
          <span className="mb-1.5 block text-xs font-medium text-slate-500">Tiêu đề email</span>
          <input
            value={subject}
            onChange={(event) => onSubjectChange(event.target.value)}
            placeholder="Mã check-in: {{survey_title}}"
            className="admin-field w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none"
          />
        </label>

        <div className="rounded-2xl border border-sky-100 bg-white p-3">
          <div className="mb-3 text-[10px] uppercase tracking-widest text-slate-400">Giao diện thư</div>
          <div className="grid gap-3 sm:grid-cols-2">
            <ColorField label="Màu chủ đạo" value={theme.accent || "#0ea5e9"} onChange={(accent) => patchTheme({ accent, buttonColor: accent })} />
            <ColorField label="Màu nền" value={theme.background || "#f1f5f9"} onChange={(background) => patchTheme({ background })} />
            <ColorField label="Màu nút" value={theme.buttonColor || theme.accent || "#0ea5e9"} onChange={(buttonColor) => patchTheme({ buttonColor })} />
            <ColorField label="Màu chữ" value={theme.textColor || "#334155"} onChange={(textColor) => patchTheme({ textColor })} />
          </div>
          <div className="mt-3 grid gap-3 sm:grid-cols-[160px_minmax(0,1fr)]">
            <ThemeImageUpload label="Logo đầu thư" value={theme.logoUrl} onChange={(logoUrl) => patchTheme({ logoUrl })} maxWidth={600} aspect="square" />
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-slate-400">Footer / liên hệ</span>
              <textarea
                value={theme.footer || ""}
                onChange={(event) => patchTheme({ footer: event.target.value })}
                rows={4}
                placeholder={"Ban tổ chức\nHotline: 0900 000 000\nĐịa điểm: ..."}
                className="admin-field w-full rounded-xl px-3 py-2 text-sm admin-placeholder focus:outline-none"
              />
            </label>
          </div>
        </div>

        <div className="flex flex-wrap gap-1.5">
          {BLOCK_OPTIONS.map((option) => (
            <button
              key={option.type}
              type="button"
              onClick={() => addBlock(option.type)}
              className="inline-flex items-center gap-1.5 rounded-lg border border-sky-100 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-sky-300 hover:text-sky-700"
            >
              {option.icon}
              {option.label}
            </button>
          ))}
          <button
            type="button"
            onClick={resetDefault}
            className="ml-auto text-[11px] font-semibold text-slate-500 hover:text-sky-600"
          >
            Khôi phục mẫu
          </button>
        </div>

        <div className="rounded-2xl border border-sky-100 bg-white p-2">
          <div className="mb-2 px-2 pt-1 text-[10px] uppercase tracking-widest text-slate-400">Trường attendee</div>
          <div className="flex flex-wrap gap-1.5 px-2 pb-2">
            {mergeFields.map((field) => (
              <button
                key={field.token}
                type="button"
                onClick={() => insertToken(field.token)}
                title={field.label}
                className="rounded-full bg-sky-50 px-2.5 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-100"
              >
                {field.token}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          {blocks.map((block, index) => (
            <BlockEditor
              key={block.id}
              block={block}
              theme={theme}
              focused={focusId === block.id}
              canMoveUp={index > 0}
              canMoveDown={index < blocks.length - 1}
              onFocus={() => setFocusId(block.id)}
              onChange={(patch) => updateBlock(block.id, patch)}
              onMove={(direction) => moveBlock(block.id, direction)}
              onRemove={() => commit(blocks.filter((item) => item.id !== block.id))}
            />
          ))}
        </div>
      </div>

      <div className="rounded-2xl border border-sky-100 bg-slate-50 p-3 xl:sticky xl:top-6">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-slate-400">Preview</div>
        <div className="overflow-hidden rounded-xl border border-slate-200 bg-white">
          <div className="border-b border-slate-100 px-4 py-3">
            <div className="text-[10px] uppercase tracking-widest text-slate-400">Subject</div>
            <div className="mt-1 text-sm font-semibold text-slate-800">
              {fillMergeTokens(subject || "Mã check-in: {{survey_title}}", sampleMergeValues(surveyTitle))}
            </div>
          </div>
          <div className="max-h-[760px] overflow-auto" dangerouslySetInnerHTML={{ __html: previewHtml }} />
        </div>
      </div>
    </div>
  );
}

function ColorField({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[11px] text-slate-400">{label}</span>
      <div className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2">
        <input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0" />
        <span className="text-xs font-medium text-slate-600">{value}</span>
      </div>
    </label>
  );
}

function BlockEditor({
  block,
  theme,
  focused,
  canMoveUp,
  canMoveDown,
  onFocus,
  onChange,
  onMove,
  onRemove,
}: {
  block: EmailBlock;
  theme: EmailTheme;
  focused: boolean;
  canMoveUp: boolean;
  canMoveDown: boolean;
  onFocus: () => void;
  onChange: (patch: Partial<EmailBlock>) => void;
  onMove: (direction: -1 | 1) => void;
  onRemove: () => void;
}) {
  return (
    <div
      onClick={onFocus}
      className={`rounded-2xl border p-3 ${focused ? "border-sky-400 bg-sky-50/60" : "border-sky-100 bg-white"}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-slate-400">{blockLabel(block.type)}</span>
        <div className="ml-auto flex items-center gap-1">
          <AlignButton current={block.align} value="left" onClick={() => onChange({ align: "left" })} />
          <AlignButton current={block.align} value="center" onClick={() => onChange({ align: "center" })} />
          <AlignButton current={block.align} value="right" onClick={() => onChange({ align: "right" })} />
          <button type="button" disabled={!canMoveUp} onClick={() => onMove(-1)} className="rounded-md p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30">
            <ChevronUp size={14} />
          </button>
          <button type="button" disabled={!canMoveDown} onClick={() => onMove(1)} className="rounded-md p-1 text-slate-400 hover:text-slate-700 disabled:opacity-30">
            <ChevronDown size={14} />
          </button>
          <button type="button" onClick={onRemove} className="rounded-md p-1 text-slate-400 hover:text-red-500">
            <Trash2 size={14} />
          </button>
        </div>
      </div>

      {(block.type === "heading" || block.type === "text" || block.type === "html") && (
        <>
          <textarea
            value={block.text || ""}
            onFocus={onFocus}
            onChange={(event) => onChange({ text: event.target.value })}
            rows={block.type === "heading" ? 2 : 4}
            className="admin-field w-full rounded-xl px-3 py-2 text-sm admin-placeholder focus:outline-none"
          />
          {block.type !== "html" && (
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <label className="flex items-center gap-1 text-[11px] text-slate-500">
                Cỡ
                <input
                  type="number"
                  min={block.type === "heading" ? 16 : 12}
                  max={block.type === "heading" ? 36 : 20}
                  value={block.fontSize || (block.type === "heading" ? theme.headingSize || 22 : theme.textSize || 14)}
                  onChange={(event) => onChange({ fontSize: Number(event.target.value) || undefined })}
                  className="admin-field w-16 rounded-lg px-2 py-1 text-xs focus:outline-none"
                />
              </label>
              <button
                type="button"
                onClick={() => onChange({ bold: block.type === "heading" ? block.bold === false : !block.bold })}
                className={`rounded-lg p-1.5 ${(block.type === "heading" ? block.bold !== false : block.bold) ? "bg-sky-100 text-sky-700" : "text-slate-400 hover:text-slate-700"}`}
              >
                <Bold size={14} />
              </button>
              <input
                type="color"
                value={block.color || (block.type === "heading" ? theme.headingColor || "#0f172a" : theme.textColor || "#334155")}
                onChange={(event) => onChange({ color: event.target.value })}
                className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
              />
            </div>
          )}
        </>
      )}

      {block.type === "button" && (
        <div className="grid gap-2">
          <input
            value={block.text || ""}
            onFocus={onFocus}
            onChange={(event) => onChange({ text: event.target.value })}
            placeholder="Nhãn nút"
            className="admin-field w-full rounded-xl px-3 py-2 text-sm admin-placeholder focus:outline-none"
          />
          <input
            value={block.url || ""}
            onFocus={onFocus}
            onChange={(event) => onChange({ url: event.target.value })}
            placeholder="{{checkin_url}}"
            className="admin-field w-full rounded-xl px-3 py-2 text-sm admin-placeholder focus:outline-none"
          />
          <label className="flex items-center gap-2 text-[11px] text-slate-500">
            Màu nút
            <input
              type="color"
              value={block.buttonColor || theme.buttonColor || "#0ea5e9"}
              onChange={(event) => onChange({ buttonColor: event.target.value })}
              className="h-7 w-8 cursor-pointer rounded border-0 bg-transparent p-0"
            />
          </label>
        </div>
      )}

      {block.type === "image" && (
        <ImageBlock value={block.url || ""} onChange={(url) => onChange({ url })} />
      )}

      {block.type === "qr" && (
        <label className="flex items-center gap-2 text-xs text-slate-500">
          Cỡ QR
          <input
            type="number"
            min={140}
            max={280}
            value={block.qrSize || 220}
            onChange={(event) => onChange({ qrSize: Number(event.target.value) || 220 })}
            className="admin-field w-20 rounded-lg px-2 py-1 text-xs focus:outline-none"
          />
          px
        </label>
      )}

      {block.type === "spacer" && (
        <input
          type="number"
          min={8}
          max={80}
          value={block.height || 16}
          onChange={(event) => onChange({ height: Number(event.target.value) || 16 })}
          className="admin-field w-24 rounded-xl px-3 py-2 text-sm focus:outline-none"
        />
      )}
    </div>
  );
}

function AlignButton({
  current,
  value,
  onClick,
}: {
  current?: EmailBlockAlign;
  value: EmailBlockAlign;
  onClick: () => void;
}) {
  const Icon = value === "center" ? AlignCenter : value === "right" ? AlignRight : AlignLeft;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-md p-1 ${current === value ? "bg-sky-100 text-sky-700" : "text-slate-400 hover:text-slate-700"}`}
    >
      <Icon size={14} />
    </button>
  );
}

function ImageBlock({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFile = async (file: File) => {
    if (!file.type.startsWith("image/")) return;
    setUploading(true);
    try {
      const blob = await compress(file);
      const path = `email/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.jpg`;
      const { error } = await supabase.storage.from("survey-uploads").upload(path, blob, { contentType: "image/jpeg", upsert: true });
      if (!error) {
        const { data } = supabase.storage.from("survey-uploads").getPublicUrl(path);
        onChange(data.publicUrl);
      }
    } catch {
      // ignore
    }
    setUploading(false);
  };

  return (
    <div className="space-y-2">
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) handleFile(file);
          event.target.value = "";
        }}
      />
      {value ? (
        <div className="overflow-hidden rounded-xl border border-slate-200">
          <img src={value} alt="" className="max-h-40 w-full object-cover" />
        </div>
      ) : null}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="inline-flex items-center gap-1.5 rounded-xl border border-sky-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600"
        >
          {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
          Tải ảnh
        </button>
        {value && (
          <button type="button" onClick={() => onChange("")} className="text-xs font-semibold text-slate-500 hover:text-red-500">
            Xóa ảnh
          </button>
        )}
      </div>
    </div>
  );
}

function blockLabel(type: EmailBlockType) {
  if (type === "heading") return "Tiêu đề";
  if (type === "text") return "Đoạn văn";
  if (type === "image") return "Hình ảnh";
  if (type === "button") return "Nút bấm";
  if (type === "qr") return "Mã QR";
  if (type === "divider") return "Đường kẻ";
  if (type === "spacer") return "Khoảng trống";
  return "HTML cũ";
}
