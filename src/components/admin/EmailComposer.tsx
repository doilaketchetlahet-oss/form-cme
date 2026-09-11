"use client";
import { useMemo, useState } from "react";
import { AlignLeft, Image as ImageIcon, Paperclip } from "lucide-react";
import {
  parseEmailTemplate,
  serializeEmailTemplate,
  type EmailMergeQuestion,
} from "@/lib/email-template";
import { EmailTemplateEditor } from "./EmailTemplateEditor";
import { EmailOverlayEditor } from "./EmailOverlayEditor";
import { EmailAttachmentEditor } from "./EmailAttachmentEditor";

type ComposerTab = "blocks" | "overlay" | "attachments";

type Props = {
  subject: string;
  body: string;
  surveyTitle: string;
  questions: EmailMergeQuestion[];
  onSubjectChange: (value: string) => void;
  onBodyChange: (value: string) => void;
};

export function EmailComposer({
  subject,
  body,
  surveyTitle,
  questions,
  onSubjectChange,
  onBodyChange,
}: Props) {
  const [tab, setTab] = useState<ComposerTab>("blocks");
  const parsed = useMemo(() => parseEmailTemplate(body), [body]);
  const includeBlocks = parsed.includeBlocks !== false;
  const includeOverlay = parsed.includeOverlay === true;
  const hasOverlayImage = !!parsed.overlay?.imageUrl;
  const attachmentCount = parsed.attachments?.length ?? 0;

  const setFlags = (patch: Partial<{ includeBlocks: boolean; includeOverlay: boolean }>) => {
    const current = parseEmailTemplate(body);
    onBodyChange(serializeEmailTemplate({ ...current, ...patch }));
  };

  return (
    <div className="space-y-4">
      <label className="block">
        <span className="mb-1.5 block text-xs font-medium text-slate-500">Tiêu đề email</span>
        <input
          value={subject}
          onChange={(event) => onSubjectChange(event.target.value)}
          placeholder="Mã check-in: {{survey_title}}"
          className="admin-field w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none"
        />
      </label>

      <div className="rounded-2xl border border-sky-100 bg-sky-50/60 p-3">
        <div className="mb-2 text-[10px] uppercase tracking-widest text-slate-400">Gửi kèm trong email</div>
        <div className="flex flex-wrap gap-2">
          <ToggleChip
            active={includeBlocks}
            onClick={() => setFlags({ includeBlocks: !includeBlocks })}
            icon={<AlignLeft size={14} />}
            label="Nội dung (Khối)"
          />
          <ToggleChip
            active={includeOverlay}
            onClick={() => setFlags({ includeOverlay: !includeOverlay })}
            icon={<ImageIcon size={14} />}
            label="Ảnh thiệp"
            disabled={!hasOverlayImage}
            hint={!hasOverlayImage ? "chưa có ảnh" : undefined}
          />
          <ToggleChip
            active={attachmentCount > 0}
            onClick={() => setTab("attachments")}
            icon={<Paperclip size={14} />}
            label={`File đính kèm${attachmentCount > 0 ? ` (${attachmentCount})` : ""}`}
            hint={attachmentCount === 0 ? "thêm ở tab File đính kèm" : undefined}
          />
        </div>
        <p className="mt-2 text-[11px] leading-5 text-slate-400">
          {includeOverlay && includeBlocks
            ? "Email sẽ gồm ảnh thiệp ở trên và nội dung bên dưới."
            : includeOverlay
              ? "Email chỉ gồm ảnh thiệp."
              : includeBlocks
                ? "Email chỉ gồm nội dung."
                : "Chưa chọn nội dung nào — email sẽ dùng mẫu mặc định."}
        </p>
      </div>

      <div className="flex w-fit gap-1 rounded-xl border border-sky-100 bg-white p-1">
        <TabButton active={tab === "blocks"} onClick={() => setTab("blocks")} icon={<AlignLeft size={14} />} label="Khối" />
        <TabButton active={tab === "overlay"} onClick={() => setTab("overlay")} icon={<ImageIcon size={14} />} label="Ảnh thiệp" />
        <TabButton active={tab === "attachments"} onClick={() => setTab("attachments")} icon={<Paperclip size={14} />} label="File đính kèm" />
      </div>

      <div>
        {tab === "blocks" && (
          <EmailTemplateEditor
            subject={subject}
            body={body}
            surveyTitle={surveyTitle}
            questions={questions}
            onSubjectChange={onSubjectChange}
            onBodyChange={onBodyChange}
            showSubject={false}
          />
        )}
        {tab === "overlay" && (
          <EmailOverlayEditor
            body={body}
            surveyTitle={surveyTitle}
            questions={questions}
            onBodyChange={onBodyChange}
          />
        )}
        {tab === "attachments" && (
          <EmailAttachmentEditor body={body} onBodyChange={onBodyChange} />
        )}
      </div>
    </div>
  );
}

function ToggleChip({
  active,
  onClick,
  icon,
  label,
  disabled,
  hint,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  disabled?: boolean;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={hint}
      className={`inline-flex items-center gap-2 rounded-xl border px-3 py-2 text-xs font-semibold transition-colors ${
        active
          ? "border-sky-500 bg-sky-500 text-white"
          : "border-slate-200 bg-white text-slate-500 hover:text-slate-800"
      } disabled:cursor-not-allowed disabled:opacity-60`}
    >
      {icon}
      {label}
      {hint && !active ? <span className="text-[10px] font-normal text-slate-400">({hint})</span> : null}
    </button>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-semibold transition-colors ${
        active ? "bg-sky-500 text-on-brand" : "text-slate-600 hover:text-slate-900"
      }`}
    >
      {icon}
      {label}
    </button>
  );
}
