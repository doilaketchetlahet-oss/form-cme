"use client";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Bold, Copy, Download, FileSpreadsheet, Image as ImageIcon, Loader2, Mail, Maximize2, Minimize2, Paperclip, Pause, Plus, Send, Trash2, Upload } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/lib/supabase";
import { useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { useConfirm } from "@/lib/ui/confirm";
import { PageHeader } from "./PageHeader";
import { mergeTable, parseMergeText, prepareMergeRecipients, renderMergeMail, toggleMergeBold, validateMergeTemplate, type MergeAttachment, type MergeBlock, type MergeCampaign, type MergeColumn, type MergeRecipient, type MergeSourceRow, type MergeTemplate, type SmtpAccount } from "@/lib/mail-merge";
import { EmailAttachmentEditor } from "./EmailAttachmentEditor";
import { EmailOverlayEditor } from "./EmailOverlayEditor";
import { parseEmailTemplate, serializeEmailTemplate, type EmailMergeQuestion, type EmailOverlay } from "@/lib/email-template";

const emptySmtp = (): SmtpAccount => ({ host: "", port: 587, secure: false, user: "", password: "", fromEmail: "", fromName: "", replyTo: "" });
const block = (type: MergeBlock["type"] = "text"): MergeBlock => ({ id: crypto.randomUUID(), type, text: type === "heading" ? "Thư mời" : type === "text" ? "Kính gửi Quý khách,\n\nTrân trọng kính mời Quý khách tham dự chương trình." : "", url: "" });
const STATUS: Record<MergeRecipient["status"], string> = { pending: "Chờ gửi", sending: "Đang gửi", sent: "SMTP đã nhận", failed: "Lỗi", uncertain: "Cần kiểm tra", skipped: "Bỏ qua" };
const CAMPAIGN_STATUS: Record<MergeCampaign["status"], string> = { draft: "Bản nháp", running: "Đang gửi", paused: "Tạm dừng", completed: "Hoàn tất" };
const fieldClass = "admin-field w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none disabled:opacity-60";
const cardClass = "glass-strong rounded-2xl border border-slate-200 p-5";
const buttonClass = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-semibold text-slate-700 disabled:opacity-50";

async function api(body?: Record<string, unknown>, id?: string) {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Bạn cần đăng nhập lại.");
  const response = await fetch(`/api/admin/mail-merge${id ? `?id=${encodeURIComponent(id)}` : ""}`, {
    method: body ? "POST" : "GET", headers: { Authorization: `Bearer ${data.session.access_token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error ?? "Không kết nối được tool gửi thư.");
  return result;
}

export function MailMergeManager() {
  const { canManageForms } = useAdminAccess();
  const confirm = useConfirm();
  const [campaigns, setCampaigns] = useState<MergeCampaign[]>([]);
  const [campaign, setCampaign] = useState<MergeCampaign | null>(null);
  const [name, setName] = useState("Chiến dịch gửi thư mới");
  const [columns, setColumns] = useState<MergeColumn[]>([]);
  const [rows, setRows] = useState<MergeSourceRow[]>([]);
  const [emailColumn, setEmailColumn] = useState("");
  const [duplicateEmailPolicy, setDuplicateEmailPolicy] = useState<NonNullable<MergeTemplate["duplicateEmailPolicy"]>>("skip");
  const [subject, setSubject] = useState("Thư mời tham dự chương trình");
  const [blocks, setBlocks] = useState<MergeBlock[]>([]);
  const [card, setCard] = useState<EmailOverlay | null>(null);
  const [cardAttachment, setCardAttachment] = useState<MergeTemplate["cardAttachment"]>("pdf");
  const [attachments, setAttachments] = useState<MergeAttachment[]>([]);
  const [trackingEnabled, setTrackingEnabled] = useState(true);
  const [cardEditorKey, setCardEditorKey] = useState(0);
  const [attachmentEditorKey, setAttachmentEditorKey] = useState(0);
  const [smtp, setSmtp] = useState<SmtpAccount>(emptySmtp);
  const [pasted, setPasted] = useState("");
  const [fileName, setFileName] = useState("");
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [previewIndex, setPreviewIndex] = useState(0);
  const [wideComposer, setWideComposer] = useState(false);
  const [recipientPage, setRecipientPage] = useState(0);
  const [recipientFilter, setRecipientFilter] = useState("");
  const [focus, setFocus] = useState<{ id: string; field: "text" | "url" } | "subject">("subject");
  const [testEmail, setTestEmail] = useState("");
  const [error, setError] = useState("");
  const [dirty, setDirty] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const focusedInput = useRef<HTMLInputElement | HTMLTextAreaElement | null>(null);
  const blockInputs = useRef(new Map<string, HTMLTextAreaElement>());
  const restoreSelection = useRef<{ target: HTMLInputElement | HTMLTextAreaElement; start: number; end: number } | null>(null);
  const stopRef = useRef(false);
  const dirtyRef = useRef(false);
  const mounted = useRef(true);
  const editable = (!campaign || campaign.status === "draft") && !busy && !running;
  const template: MergeTemplate = useMemo(() => ({ columns, emailColumn, duplicateEmailPolicy, subject, blocks, card, cardAttachment, attachments, trackingEnabled }), [columns, emailColumn, duplicateEmailPolicy, subject, blocks, card, cardAttachment, attachments, trackingEnabled]);
  const cardQuestions: EmailMergeQuestion[] = useMemo(() => columns.map((column) => ({ id: column.key, text: column.label, type: "text" })), [columns]);
  const cardBody = useMemo(() => serializeEmailTemplate({ v: 1, includeBlocks: false, includeOverlay: true, blocks: [], overlay: card, attachments: [] }), [card]);
  const attachmentBody = useMemo(() => serializeEmailTemplate({ v: 1, includeBlocks: true, includeOverlay: false, blocks: [], attachments }), [attachments]);
  const issue = validateMergeTemplate(template);
  const previewRows = useMemo(() => {
    try { return prepareMergeRecipients(template, rows); } catch { return []; }
  }, [template, rows]);
  const recipients: MergeRecipient[] = campaign?.recipients ?? previewRows.map((row) => ({ ...row, id: String(row.source_row), sourceRow: row.source_row, status: row.status as MergeRecipient["status"] }));
  const counts = Object.fromEntries(Object.keys(STATUS).map((status) => [status, recipients.filter((row) => row.status === status).length]));
  const openedCount = campaign?.tracking?.opened ?? recipients.filter((row) => row.status === "sent" && !!row.opened_at).length;
  const filteredRecipients = recipients.filter((row) => !recipientFilter || row.status === recipientFilter);
  const currentRecipientPage = Math.min(recipientPage, Math.max(0, Math.ceil(filteredRecipients.length / 100) - 1));
  const selectedRow = rows[Math.min(previewIndex, Math.max(0, rows.length - 1))];
  const preview = (() => { if (!selectedRow) return null; try { return renderMergeMail(template, selectedRow.fields); } catch { return null; } })();
  useLayoutEffect(() => {
    const selection = restoreSelection.current;
    restoreSelection.current = null;
    if (selection?.target.isConnected) { selection.target.focus(); selection.target.setSelectionRange(selection.start, selection.end); }
  }, [blocks, subject]);

  const refreshList = useCallback(async () => { const result = await api(); if (mounted.current) setCampaigns(result.campaigns); }, []);
  useEffect(() => {
    mounted.current = true;
    if (canManageForms) void refreshList().catch((cause) => setError(cause.message));
    return () => { mounted.current = false; stopRef.current = true; };
  }, [canManageForms, refreshList]);
  const markDirty = () => { dirtyRef.current = true; setDirty(true); };
  const clearDirty = () => { dirtyRef.current = false; setDirty(false); };
  const patchSmtp = (patch: Partial<SmtpAccount>) => { markDirty(); setSmtp((current) => ({ ...current, ...patch })); };

  const load = async (id: string) => {
    const result = await api(undefined, id);
    const next = result.campaign as MergeCampaign;
    if (mounted.current) setCampaign(next);
    return next;
  };
  const populate = (next: MergeCampaign) => {
    setName(next.name); setColumns(next.template.columns); setEmailColumn(next.template.emailColumn); setSubject(next.template.subject); setBlocks(next.template.blocks); setCard(next.template.card ?? null); setCardAttachment(next.template.cardAttachment ?? "pdf"); setAttachments(next.template.attachments ?? []); setTrackingEnabled(next.template.trackingEnabled !== false); setCardEditorKey((key) => key + 1); setAttachmentEditorKey((key) => key + 1);
    setRows((next.recipients ?? []).map(({ sourceRow, fields }) => ({ sourceRow, fields }))); setSmtp({ ...emptySmtp(), ...next.smtp_public, password: "" });
    setDuplicateEmailPolicy(next.template.duplicateEmailPolicy ?? "skip");
    setFileName("Danh sách đã lưu"); setPasted(""); setPreviewIndex(0); setRecipientPage(0); setRecipientFilter(""); setFocus("subject"); focusedInput.current = null; clearDirty();
    setCampaigns((current) => current.some((item) => item.id === next.id) ? current : [next, ...current]);
  };
  const open = async (id: string) => {
    if (dirtyRef.current && !await confirm({ title: "Mở chiến dịch khác?", description: "Các chỉnh sửa chưa lưu sẽ được bỏ qua.", confirmText: "Mở chiến dịch" })) return;
    setBusy(true); setError("");
    try {
      populate(await load(id));
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không mở được chiến dịch."); } finally { setBusy(false); }
  };
  const newCampaign = async () => {
    if (dirtyRef.current && !await confirm({ title: "Tạo chiến dịch mới?", description: "Các chỉnh sửa chưa lưu sẽ được bỏ qua.", confirmText: "Tạo mới" })) return;
    setCampaign(null); setName("Chiến dịch gửi thư mới"); setColumns([]); setRows([]); setEmailColumn(""); setSubject("Thư mời tham dự chương trình"); setBlocks([]); setCard(null); setCardAttachment("pdf"); setAttachments([]); setTrackingEnabled(true); setSmtp(emptySmtp()); setFileName(""); setPasted(""); setPreviewIndex(0); setError(""); setFocus("subject"); focusedInput.current = null; setCardEditorKey((key) => key + 1); setAttachmentEditorKey((key) => key + 1); clearDirty();
    setDuplicateEmailPolicy("skip");
  };

  const importMatrix = (matrix: string[][], label: string) => {
    const parsed = mergeTable(matrix);
    setColumns(parsed.columns); setRows(parsed.rows); setEmailColumn(parsed.emailColumn); setFileName(label); setPreviewIndex(0); setCardEditorKey((key) => key + 1);
    if (!blocks.length) setBlocks([block()]);
    if (campaign) setCampaign({ ...campaign, recipients: undefined });
    markDirty(); toast.success(`Đã đọc ${parsed.rows.length} dòng và ${parsed.columns.length} cột.`);
  };
  const importFile = async (file: File) => {
    if (file.size > 10 * 1024 * 1024) { toast.error("File tối đa 10 MB."); return; }
    setBusy(true); setError("");
    try {
      if (/\.xlsx?$/i.test(file.name)) {
        const XLSX = await import("xlsx");
        const workbook = XLSX.read(await file.arrayBuffer(), { type: "array", cellDates: false });
        const sheet = workbook.Sheets[workbook.SheetNames[0]];
        if (!sheet) throw new Error("File Excel không có sheet dữ liệu.");
        importMatrix(XLSX.utils.sheet_to_json<string[]>(sheet, { header: 1, raw: false, defval: "" }) as string[][], `${file.name} · ${workbook.SheetNames[0]}`);
      } else importMatrix(parseMergeText(await file.text()), file.name);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không đọc được danh sách."); } finally { setBusy(false); if (inputRef.current) inputRef.current.value = ""; }
  };

  const patchBlock = (id: string, patch: Partial<MergeBlock>) => { markDirty(); setBlocks((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item)); };
  const boldBlock = (id: string) => {
    if (!editable) return;
    const target = blockInputs.current.get(id), item = blocks.find((entry) => entry.id === id);
    if (!target || !item) return;
    const next = toggleMergeBold(target.value, target.selectionStart, target.selectionEnd, item.format === "markdown");
    if (!next) { toast.info("Bôi đen đoạn nội dung cần in đậm trước."); target.focus(); return; }
    restoreSelection.current = { target, start: next.start, end: next.end };
    patchBlock(id, { text: next.text, format: "markdown" });
  };
  const patchRow = (sourceRow: number, key: string, value: string) => {
    if (!editable) return;
    markDirty();
    setRows((current) => current.map((row) => row.sourceRow === sourceRow ? { ...row, fields: { ...row.fields, [key]: value } } : row));
    setCampaign((current) => current ? { ...current, recipients: undefined } : current);
  };
  const insertField = (key: string) => {
    const token = `{{${key}}}`, target = focusedInput.current;
    const current = target?.value ?? (focus === "subject" ? subject : blocks.find((item) => item.id === focus.id)?.[focus.field] ?? "");
    const start = target?.selectionStart ?? current.length, end = target?.selectionEnd ?? current.length;
    const next = `${current.slice(0, start)}${token}${current.slice(end)}`;
    if (target) restoreSelection.current = { target, start: start + token.length, end: start + token.length };
    if (focus === "subject") { setSubject(next); markDirty(); } else patchBlock(focus.id, { [focus.field]: next });
  };

  const act = async (task: () => Promise<void>) => {
    setBusy(true); setError("");
    try { await task(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Thao tác chưa hoàn tất."); } finally { setBusy(false); }
  };
  const revise = async () => {
    if (!campaign || busy || running || campaign.status === "running") return;
    if (dirtyRef.current && !await confirm({ title: "Tạo bản chỉnh sửa từ dữ liệu đã lưu?", description: "Các thay đổi SMTP chưa lưu sẽ được bỏ qua. Tracking đợt cũ vẫn được giữ.", confirmText: "Tạo bản chỉnh sửa" })) return;
    await act(async () => {
      const result = await api({ action: "revise", id: campaign.id, newId: crypto.randomUUID() });
      populate(await load(result.id)); await refreshList();
      toast.success("Đã tạo bản nháp để chỉnh sửa. Tracking đợt trước vẫn được giữ.");
    });
  };
  const save = () => act(async () => {
    if (issue) throw new Error(issue);
    const id = campaign?.id ?? crypto.randomUUID();
    await api({ action: "save", id, name, template, rows, smtp });
    await load(id); setSmtp((value) => ({ ...value, password: "" })); clearDirty(); await refreshList(); toast.success("Đã lưu danh sách, mẫu thư và SMTP.");
  });
  const saveAccount = () => act(async () => {
    await api({ action: "account", id: campaign?.id, smtp }); setSmtp((value) => ({ ...value, password: "" })); clearDirty(); toast.success("Đã cập nhật SMTP.");
  });

  const start = async () => {
    if (!campaign) return;
    if (dirtyRef.current) { toast.info("Lưu các chỉnh sửa trước khi gửi."); return; }
    if (!await confirm({ title: `Gửi ${counts.pending ?? 0} thư qua SMTP?`, description: `Chiến dịch “${campaign.name}”. Mỗi dòng có một thư riêng với dữ liệu tương ứng.${campaign.previous_campaign_id ? " Đây là đợt mới: người đã nhận thư ở đợt trước sẽ nhận thêm thư nếu còn trong danh sách này." : ""}${campaign.template.duplicateEmailPolicy === "allow" ? " Email xuất hiện ở nhiều dòng sẽ nhận nhiều thư, mỗi thư có thiệp theo dòng đó." : ""}`, confirmText: "Bắt đầu gửi" })) return;
    stopRef.current = false; setRunning(true); setError("");
    try {
      await api({ action: "start", id: campaign.id });
      setCampaign((value) => value ? { ...value, status: "running" } : value);
      while (!stopRef.current && mounted.current) {
        const result = await api({ action: "process", id: campaign.id });
        if (result.processed) {
          setCampaign((value) => value ? { ...value, status: result.status === "sent" ? value.status : "paused", recipients: value.recipients?.map((row) => row.id === result.recipientId ? { ...row, status: result.status, last_error: result.error ?? null, sent_at: result.status === "sent" ? new Date().toISOString() : null } : row) } : value);
          if (result.status !== "sent") { setError(result.error ?? "SMTP chưa xác nhận thư."); break; }
        } else {
          const next = await load(campaign.id);
          if (next.status !== "running") break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    } catch (cause) { if (mounted.current) setError(cause instanceof Error ? cause.message : "Mất kết nối. Mở lại chiến dịch để kiểm tra kết quả."); }
    finally { if (mounted.current) { setRunning(false); await refreshList().catch(() => {}); } }
  };
  const pause = async () => {
    stopRef.current = true;
    await act(async () => { await api({ action: "pause", id: campaign?.id }); await load(campaign!.id); toast.info("Đã tạm dừng. Thư đang xử lý sẽ hoàn tất trước khi dừng."); });
  };
  const resolve = async (recipient: MergeRecipient, action: "resolve_sent" | "resolve_retry") => {
    if (!await confirm({ title: action === "resolve_sent" ? "Đánh dấu đã gửi?" : "Gửi lại dòng này?", description: action === "resolve_sent" ? "Chọn khi đã kiểm tra SMTP / hộp thư và xác nhận thư đã được gửi." : "Chỉ chọn khi đã kiểm tra thư chưa được gửi. Nếu SMTP đã nhận, người nhận có thể nhận thêm một thư.", confirmText: action === "resolve_sent" ? "Đã kiểm tra, đánh dấu" : "Đã kiểm tra, cho gửi lại" })) return;
    await act(async () => { await api({ action, id: campaign?.id, recipientId: recipient.id }); await load(campaign!.id); });
  };
  const exportResults = () => {
    const matrix = [["Dòng", "Email", "Trạng thái", "Đã mở", "Chi tiết", ...columns.map((column) => column.label)], ...recipients.map((recipient) => [String(recipient.sourceRow), recipient.email, STATUS[recipient.status], recipient.opened_at ? "Có" : "Chưa", recipient.last_error ?? "", ...columns.map((column) => recipient.fields[column.key] ?? "")])];
    const csv = "\uFEFF" + matrix.map((row) => row.map((cell) => `"${/^[=+@-]/.test(cell) ? "'" : ""}${cell.replace(/"/g, '""')}"`).join(",")).join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = "ket-qua-gui-thu.csv"; anchor.click(); URL.revokeObjectURL(url);
  };

  if (!canManageForms) return <p className="mx-4 my-8 rounded-xl bg-slate-100 p-5 text-slate-600 sm:mx-8 sm:my-10">Tool dành cho tài khoản quản trị có quyền chỉnh sửa.</p>;
  return <div className="mx-auto w-full max-w-[1600px] space-y-5 px-4 py-8 sm:px-8 sm:py-10">
    <PageHeader title="Gửi mail theo trường" subtitle="Nhập danh sách, chèn trường và gửi từng thư qua tài khoản SMTP của bạn." action={<button className={buttonClass} disabled={busy || running} onClick={() => void newCampaign()}><Plus size={16} /> Chiến dịch mới</button>} />
    <div className="flex flex-wrap items-center gap-3">
      <select aria-label="Chiến dịch đã lưu" className={`${fieldClass} max-w-lg`} value={campaign?.id ?? ""} disabled={busy || running} onChange={(event) => event.target.value && void open(event.target.value)}><option value="">Mở chiến dịch đã lưu…</option>{campaigns.map((item) => <option key={item.id} value={item.id}>{item.name} · {CAMPAIGN_STATUS[item.status]} · {new Date(item.created_at).toLocaleString("vi-VN", { timeZone: "Asia/Ho_Chi_Minh" })}</option>)}</select>
      {campaign && <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">{CAMPAIGN_STATUS[campaign.status]}</span>}
      {campaign && <button className={buttonClass} disabled={busy || running} onClick={() => void act(async () => { await load(campaign.id); await refreshList(); })}>Cập nhật trạng thái</button>}
      {campaign && campaign.status !== "draft" && <button className={buttonClass} disabled={busy || running || campaign.status === "running" || !!counts.sending} onClick={() => void revise()}><Copy size={15} /> Chỉnh sửa / tạo đợt mới</button>}
      {campaign?.previous_campaign_id && <button className={buttonClass} disabled={busy || running} onClick={() => void open(campaign.previous_campaign_id!)}>Xem tracking đợt trước</button>}
    </div>
    {campaign?.previous_campaign_id && <p className="rounded-xl border border-violet-200 bg-violet-50 p-4 text-sm leading-6 text-violet-800">Đây là bản chỉnh sửa cho một đợt gửi mới. Bạn có thể sửa dữ liệu, thay Excel, nội dung và thiệp khi còn là bản nháp. Tracking đợt trước được giữ riêng. Khi gửi đợt này, mọi dòng hợp lệ trong danh sách sẽ nhận một thư mới, kể cả người đã nhận ở đợt trước.</p>}
    {campaign && campaign.status !== "draft" && <p className="text-sm leading-6 text-slate-600">Chọn <strong>Chỉnh sửa / tạo đợt mới</strong> để sửa danh sách hoặc nội dung và giữ lịch sử gửi hiện tại.{campaign.status === "running" || counts.sending ? " Tạm dừng và chờ thư đang xử lý hoàn tất trước khi chỉnh sửa." : ""}</p>}
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</p>}
    <div className={cardClass}>
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900"><FileSpreadsheet size={18} className="text-sky-600" /> 1. Danh sách người nhận</h2>
      <div className="grid gap-4 sm:grid-cols-2"><label className="text-sm text-slate-600">Tên chiến dịch<input className={`${fieldClass} mt-1`} value={name} disabled={!editable} onChange={(event) => { markDirty(); setName(event.target.value); }} /></label><label className="text-sm text-slate-600">Cột Email<select className={`${fieldClass} mt-1`} value={emailColumn} disabled={!editable || !columns.length} onChange={(event) => { markDirty(); setEmailColumn(event.target.value); if (campaign) setCampaign({ ...campaign, recipients: undefined }); }}>{columns.map((column) => <option key={column.key} value={column.key}>{column.label}</option>)}</select></label></div>
      <label className="mt-4 block max-w-xl text-sm text-slate-600">Xử lý Email trùng<select className={`${fieldClass} mt-1`} value={duplicateEmailPolicy} disabled={!editable} onChange={(event) => { setDuplicateEmailPolicy(event.target.value as NonNullable<MergeTemplate["duplicateEmailPolicy"]>); markDirty(); setCampaign((current) => current ? { ...current, recipients: undefined } : current); }}><option value="skip">Bỏ qua Email trùng (mỗi Email một thư)</option><option value="allow">Gửi riêng từng dòng (cho phép Email trùng)</option></select></label>
      <p className="mt-2 text-xs leading-5 text-slate-500">{duplicateEmailPolicy === "allow" ? "Một người có 2 bài báo cáo: nhập 2 dòng cùng tên và Email, mỗi dòng có thông tin bài riêng. Người đó sẽ nhận 2 thư và thiệp tương ứng; tracking được ghi nhận riêng từng thư. Lưu chiến dịch sau khi đổi lựa chọn." : "Chỉ dòng đầu của mỗi Email được xét gửi; các dòng trùng bị bỏ qua. Chọn gửi riêng từng dòng nếu một người có nhiều bài báo cáo."}</p>
      {(!campaign || campaign.status === "draft") && <div className="mt-4 space-y-3">
        <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv,.tsv,.txt" className="hidden" onChange={(event) => { if (event.target.files?.[0]) void importFile(event.target.files[0]); }} />
        <button className={buttonClass} disabled={!editable} onClick={() => inputRef.current?.click()}><Upload size={15} /> Import Excel / CSV</button><span className="ml-3 text-xs text-slate-500">Dòng đầu là tên cột · Excel đọc sheet đầu tiên · Tối đa 5.000 dòng</span>
        <details><summary className="cursor-pointer text-sm font-medium text-sky-700">Hoặc dán danh sách từ Excel / CSV</summary><textarea className={`${fieldClass} mt-2 h-28 font-mono text-xs`} disabled={!editable} placeholder={"Email\tHọ tên\tTrường\nkhach@example.com\tNguyễn Văn A\tĐại học A"} value={pasted} onChange={(event) => setPasted(event.target.value)} /><button className={`${buttonClass} mt-2`} disabled={!editable || !pasted.trim()} onClick={() => { try { importMatrix(parseMergeText(pasted), "Danh sách đã dán"); } catch (cause) { setError(cause instanceof Error ? cause.message : "Không đọc được danh sách."); } }}>Đọc danh sách</button></details>
      </div>}
      {fileName && <p className="mt-3 text-xs text-slate-500">{fileName} · {rows.length} dòng · {columns.length} cột</p>}
      {selectedRow && <details className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-3 sm:p-4">
        <summary className="cursor-pointer text-sm font-semibold text-sky-700">{!campaign || campaign.status === "draft" ? "Sửa dữ liệu đã nhập" : "Xem dữ liệu đã nhập (đã khóa)"}</summary>
        <label className="mt-3 block text-sm text-slate-600">Dòng cần chỉnh sửa<select className={`${fieldClass} mt-1 max-w-lg`} value={Math.min(previewIndex, rows.length - 1)} onChange={(event) => setPreviewIndex(Number(event.target.value))}>{rows.map((row, index) => <option key={row.sourceRow} value={index}>Dòng {row.sourceRow} · {row.fields[emailColumn] || "Chưa có Email"}</option>)}</select></label>
        <div className="mt-3 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">{columns.map((column) => <label key={column.key} className="text-sm text-slate-600">{column.label}<input aria-label={`Dữ liệu ${column.label}`} className={`${fieldClass} mt-1`} maxLength={4000} value={selectedRow.fields[column.key] ?? ""} disabled={!editable} onChange={(event) => patchRow(selectedRow.sourceRow, column.key, event.target.value)} /></label>)}</div>
        <p className="mt-3 text-xs text-slate-500">{!campaign || campaign.status === "draft" ? "Sửa từng ô tại đây; bản xem trước và kiểm tra Email cập nhật ngay. Bấm Lưu chiến dịch để lưu các thay đổi trước khi gửi." : "Đây là dữ liệu của đợt đã bắt đầu gửi. Chọn Chỉnh sửa / tạo đợt mới để thay dữ liệu và giữ tracking đợt này."}</p>
      </details>}
      <details className="mt-4 rounded-xl border border-sky-100 bg-sky-50/50 p-3 sm:p-4">
        <summary className="cursor-pointer text-sm font-semibold text-sky-700"><ImageIcon size={15} className="mr-1 inline" /> Thiệp cá nhân hóa đính kèm</summary>
        <div className="mt-3 space-y-3">
          <p className="text-xs leading-5 text-slate-600">Tải ảnh nền thiệp, kéo các trường vào vị trí tương ứng. Mỗi người sẽ nhận thiệp đã chèn dữ liệu của dòng đó.</p>
          <fieldset disabled={!editable} className="min-w-0"><div inert={!editable}><EmailOverlayEditor key={cardEditorKey} body={cardBody} surveyTitle={name} questions={cardQuestions} onBodyChange={(value) => { if (!editable) return; const next = parseEmailTemplate(value).overlay ?? null; setCard(next); markDirty(); }} /></div></fieldset>
          {card && <label className="block max-w-sm text-sm text-slate-600">Định dạng thiệp gửi kèm<select className={`${fieldClass} mt-1`} value={cardAttachment} disabled={!editable} onChange={(event) => { setCardAttachment(event.target.value as MergeTemplate["cardAttachment"]); markDirty(); }}><option value="pdf">PDF cá nhân hóa</option><option value="jpg">Ảnh JPG cá nhân hóa</option><option value="both">PDF + ảnh JPG</option><option value="none">Chỉ hiển thị trong email</option></select></label>}
        </div>
      </details>
    </div>
    <div className={`grid items-start gap-5 ${wideComposer ? "" : "xl:grid-cols-2"}`}>
      <div className={`${cardClass} min-w-0`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="flex items-center gap-2 font-semibold text-slate-900"><Mail size={18} className="text-sky-600" /> 2. Soạn nội dung</h2><button type="button" className={`${buttonClass} hidden xl:inline-flex`} aria-expanded={wideComposer} onClick={() => setWideComposer((value) => !value)}>{wideComposer ? <Minimize2 size={14} /> : <Maximize2 size={14} />}{wideComposer ? "Thu gọn vùng soạn" : "Mở rộng vùng soạn"}</button></div>
        <p className="mb-3 text-xs text-slate-500">Đặt con trỏ trong tiêu đề / nội dung / liên kết, rồi bấm trường để chèn. Kéo góc dưới bên phải ô nội dung để tăng chiều cao.</p>
        <div className="mb-4 flex flex-wrap gap-2">{columns.map((column) => <button key={column.key} type="button" className="rounded-lg bg-sky-50 px-2.5 py-1.5 text-xs font-semibold text-sky-700 disabled:opacity-50" disabled={!editable} onMouseDown={(event) => event.preventDefault()} onClick={() => insertField(column.key)}>{column.label} <span className="font-mono font-normal">{`{{${column.key}}}`}</span></button>)}</div>
        <label className="text-sm text-slate-600">Tiêu đề thư<input className={`${fieldClass} mt-1`} value={subject} disabled={!editable} onFocus={(event) => { setFocus("subject"); focusedInput.current = event.target; }} onChange={(event) => { markDirty(); setSubject(event.target.value); }} /></label>
        <div className="mt-4 space-y-3">{blocks.map((item, index) => <div key={item.id} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3">
          <div className="flex items-center gap-2"><select aria-label={`Loại khối ${index + 1}`} className={`${fieldClass} flex-1`} value={item.type} disabled={!editable} onChange={(event) => patchBlock(item.id, { type: event.target.value as MergeBlock["type"] })}><option value="text">Đoạn văn</option><option value="heading">Tiêu đề</option><option value="image">Hình ảnh</option><option value="button">Nút bấm</option><option value="divider">Đường kẻ</option></select><button className={buttonClass} title="Đưa lên" disabled={!editable || !index} onClick={() => { markDirty(); setBlocks((current) => { const next = [...current]; [next[index - 1], next[index]] = [next[index], next[index - 1]]; return next; }); }}>↑</button><button className={buttonClass} title="Xóa khối" disabled={!editable} onClick={() => { markDirty(); setBlocks((current) => current.filter((entry) => entry.id !== item.id)); setFocus("subject"); focusedInput.current = null; }}><Trash2 size={14} /></button></div>
          {!["divider", "image"].includes(item.type) && <div className="flex flex-wrap items-center gap-2"><button type="button" aria-label={`In đậm khối ${index + 1}`} className={buttonClass} disabled={!editable} title="Bôi đen đoạn cần nhấn mạnh, rồi bấm In đậm (Ctrl+B)" onMouseDown={(event) => event.preventDefault()} onClick={() => boldBlock(item.id)}><Bold size={14} /> In đậm</button><span className="text-xs text-slate-500">Chọn đoạn chữ hoặc trường cần nhấn mạnh. Bấm lại để bỏ in đậm.</span></div>}
          {item.type !== "divider" && <textarea ref={(node) => { if (node) blockInputs.current.set(item.id, node); else blockInputs.current.delete(item.id); }} aria-label={`Nội dung khối ${index + 1}`} rows={item.type === "text" ? 10 : 2} className={`${fieldClass} resize-y leading-relaxed ${item.type === "text" ? "min-h-60" : "min-h-20"}`} value={item.text} placeholder={item.type === "image" ? "Mô tả ảnh" : item.type === "button" ? "Nhãn nút" : "Nội dung…"} disabled={!editable} onFocus={(event) => { setFocus({ id: item.id, field: "text" }); focusedInput.current = event.target; }} onChange={(event) => patchBlock(item.id, { text: event.target.value })} onKeyDown={(event) => { if (item.type !== "image" && (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "b") { event.preventDefault(); boldBlock(item.id); } }} />}
          {["image", "button"].includes(item.type) && <input aria-label={`Liên kết khối ${index + 1}`} className={fieldClass} value={item.url} placeholder="https://… (có thể chèn trường)" disabled={!editable} onFocus={(event) => { setFocus({ id: item.id, field: "url" }); focusedInput.current = event.target; }} onChange={(event) => patchBlock(item.id, { url: event.target.value })} />}
        </div>)}</div>
        <button className={`${buttonClass} mt-3`} disabled={!editable || blocks.length >= 50} onClick={() => { markDirty(); setBlocks((current) => [...current, block()]); }}><Plus size={14} /> Thêm khối</button>
        {issue && rows.length > 0 && <p className="mt-3 text-xs text-amber-700">{issue}</p>}
      </div>
      <div className={`${cardClass} min-w-0`}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2"><h2 className="font-semibold text-slate-900">Xem trước từng người nhận</h2><select aria-label="Người nhận xem trước" className={`${fieldClass} max-w-xs`} value={previewIndex} disabled={!rows.length} onChange={(event) => setPreviewIndex(Number(event.target.value))}>{rows.map((row, index) => <option key={row.sourceRow} value={index}>Dòng {row.sourceRow} · {row.fields[emailColumn] || "Chưa có Email"}</option>)}</select></div>
        {preview ? <><p className="mb-3 text-sm font-semibold text-slate-800">{preview.subject}</p><iframe title="Xem trước thư cá nhân hóa" sandbox="" referrerPolicy="no-referrer" className="h-[440px] w-full rounded-xl border border-slate-200 bg-white" srcDoc={`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0">${preview.html}</body></html>`} /></> : <p className="rounded-xl bg-slate-50 p-8 text-sm text-slate-500">Import danh sách và thêm nội dung để xem thư sẽ gửi.</p>}
      </div>
    </div>
    <div className={cardClass}>
      <h2 className="mb-3 flex items-center gap-2 font-semibold text-slate-900"><Paperclip size={18} className="text-sky-600" /> File dùng chung đính kèm</h2>
      <fieldset disabled={!editable} className="min-w-0"><div inert={!editable}><EmailAttachmentEditor key={attachmentEditorKey} body={attachmentBody} onBodyChange={(value) => { if (!editable) return; setAttachments(parseEmailTemplate(value).attachments as MergeAttachment[]); markDirty(); }} /></div></fieldset>
    </div>
    <div className={cardClass}>
      <h2 className="mb-3 font-semibold text-slate-900">3. Tài khoản SMTP</h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {([{ key: "host", label: "Máy chủ SMTP", placeholder: "smtp.gmail.com" }, { key: "user", label: "Tài khoản đăng nhập", placeholder: "ten@example.com" }, { key: "password", label: campaign?.hasPassword ? "Mật khẩu (để trống để giữ mật khẩu đã lưu)" : "Mật khẩu / mật khẩu ứng dụng", placeholder: "Mật khẩu SMTP" }, { key: "fromEmail", label: "Địa chỉ Email gửi", placeholder: "ten@example.com" }, { key: "fromName", label: "Tên hiển thị người gửi", placeholder: "Ban tổ chức" }, { key: "replyTo", label: "Email nhận trả lời (tùy chọn)", placeholder: "lienhe@example.com" }] as const).map(({ key, label, placeholder }) => <label key={key} className="text-sm text-slate-600">{label}<input className={`${fieldClass} mt-1`} type={key === "password" ? "password" : "text"} autoComplete={key === "password" ? "new-password" : "off"} placeholder={placeholder} value={smtp[key]} disabled={busy || running || campaign?.status === "running"} onChange={(event) => patchSmtp({ [key]: event.target.value })} /></label>)}
        <label className="text-sm text-slate-600">Cổng SMTP<input type="number" className={`${fieldClass} mt-1`} value={smtp.port} disabled={busy || running || campaign?.status === "running"} onChange={(event) => patchSmtp({ port: Number(event.target.value) })} /></label>
        <label className="text-sm text-slate-600">Mã hóa kết nối<select className={`${fieldClass} mt-1`} value={smtp.secure ? "tls" : "starttls"} disabled={busy || running || campaign?.status === "running"} onChange={(event) => patchSmtp({ secure: event.target.value === "tls", port: event.target.value === "tls" ? 465 : 587 })}><option value="starttls">STARTTLS (thường dùng cổng 587)</option><option value="tls">TLS trực tiếp (thường dùng cổng 465)</option></select></label>
      </div>
      <div className="mt-4 flex flex-wrap gap-2"><button className={buttonClass} disabled={busy || running} onClick={() => void act(async () => { await api({ action: "verify", ...(campaign ? { id: campaign.id } : {}), smtp }); toast.success("SMTP kết nối và đăng nhập thành công."); })}>Kiểm tra SMTP</button>{campaign && campaign.status !== "draft" && <button className={buttonClass} disabled={busy || running || campaign.status === "running"} onClick={() => void saveAccount()}>Lưu SMTP</button>}</div>
      <p className="mt-2 text-xs text-slate-500">Mật khẩu được mã hóa phía server. Chỉ tài khoản tạo chiến dịch có thể mở danh sách và dùng cấu hình này.</p>
      <label className="mt-4 flex items-start gap-2 text-sm text-slate-700"><input type="checkbox" checked={trackingEnabled} disabled={!editable} onChange={(event) => { setTrackingEnabled(event.target.checked); markDirty(); }} className="mt-0.5 h-4 w-4 accent-sky-600" /><span><strong>Theo dõi mở thư</strong><span className="mt-0.5 block text-xs text-slate-500">Chèn ảnh theo dõi 1px. Một số ứng dụng email chặn ảnh nên số liệu chỉ là lượt mở được ghi nhận.</span></span></label>
    </div>
    <div className={cardClass}>
      <h2 className="mb-3 font-semibold text-slate-900">4. Gửi thử và gửi danh sách</h2>
      <div className="flex flex-wrap gap-2"><input aria-label="Email nhận thư thử" className={`${fieldClass} max-w-sm`} value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="Email nhận thư thử" /><button className={buttonClass} disabled={busy || running || !!issue || !selectedRow || !testEmail} onClick={() => void act(async () => { await api({ action: "test", ...(campaign ? { id: campaign.id } : {}), smtp, template, row: selectedRow, to: testEmail }); toast.success("SMTP đã nhận thư thử. Kiểm tra hộp thư của bạn."); })}><Send size={14} /> Gửi thử dòng đang xem</button></div>
      <div className="mt-4 flex flex-wrap items-center gap-2">{(!campaign || campaign.status === "draft") && <button className="admin-primary rounded-xl px-4 py-2.5 text-sm font-semibold disabled:opacity-50" disabled={!editable || !!issue || !rows.length} onClick={() => void save()}>Lưu chiến dịch</button>}
        <button className="inline-flex items-center gap-2 rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-semibold text-white disabled:opacity-50" disabled={!campaign || dirty || busy || running || !(counts.pending || counts.sending)} onClick={() => void start()}>{running ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />} {running ? "Đang gửi…" : "Gửi / tiếp tục"}</button>
        {campaign && (running || campaign.status === "running") && <button className={buttonClass} disabled={busy} onClick={() => void pause()}><Pause size={14} /> Tạm dừng</button>}
        {campaign && counts.failed > 0 && <button className={buttonClass} disabled={busy || running || campaign.status === "running"} onClick={() => void act(async () => { await api({ action: "retry_failed", id: campaign.id }); await load(campaign.id); })}>Đưa thư lỗi vào hàng chờ</button>}
        <button className={buttonClass} disabled={!recipients.length} onClick={exportResults}><Download size={14} /> Xuất kết quả CSV</button>
      </div>
      {(!campaign || campaign.status === "draft") && <p className="mt-3 text-xs text-sky-700">Bấm Lưu chiến dịch để lưu danh sách, nội dung và SMTP, rồi bấm Gửi / tiếp tục. Khi chỉnh sửa, cần lưu lại trước khi gửi.</p>}
      <p className="mt-3 text-xs text-slate-500">Giữ tab mở khi gửi. Mỗi lần gửi một thư riêng; có thể tạm dừng và mở lại chiến dịch để tiếp tục. “SMTP đã nhận” chưa phải xác nhận người nhận đã đọc thư.</p>
      <div className="mt-4 flex flex-wrap gap-2">{Object.entries(STATUS).map(([status, label]) => <span key={status} className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700">{label}: {counts[status] ?? 0}</span>)}{campaign?.template.trackingEnabled !== false && <span className="rounded-full bg-violet-100 px-3 py-1 text-xs font-semibold text-violet-700">Đã mở: {openedCount}{counts.sent ? ` / ${counts.sent}` : ""}</span>}</div>
      {recipients.length > 0 && <><div className="mt-4 flex flex-wrap items-center gap-2"><select aria-label="Lọc trạng thái gửi" className={`${fieldClass} max-w-xs`} value={recipientFilter} onChange={(event) => { setRecipientFilter(event.target.value); setRecipientPage(0); }}><option value="">Tất cả trạng thái</option>{Object.entries(STATUS).map(([status, label]) => <option key={status} value={status}>{label}</option>)}</select><button className={buttonClass} disabled={!currentRecipientPage} onClick={() => setRecipientPage(currentRecipientPage - 1)}>Trước</button><span className="text-xs text-slate-500">Trang {currentRecipientPage + 1} / {Math.max(1, Math.ceil(filteredRecipients.length / 100))}</span><button className={buttonClass} disabled={(currentRecipientPage + 1) * 100 >= filteredRecipients.length} onClick={() => setRecipientPage(currentRecipientPage + 1)}>Sau</button></div><div className="mt-3 overflow-x-auto"><table className="w-full text-left text-xs"><thead className="bg-slate-50 text-slate-500"><tr><th className="p-2">Dòng</th><th className="p-2">Email</th><th className="p-2">Trạng thái</th><th className="p-2">Mở</th><th className="p-2">Chi tiết</th>{columns.slice(0, 4).map((column) => <th key={column.key} className="p-2">{column.label}</th>)}</tr></thead><tbody>{filteredRecipients.slice(currentRecipientPage * 100, (currentRecipientPage + 1) * 100).map((recipient) => <tr key={recipient.id} className="border-t border-slate-100"><td className="p-2">{recipient.sourceRow}</td><td className="p-2">{recipient.email || "—"}</td><td className={`p-2 font-semibold ${recipient.status === "sent" ? "text-emerald-700" : recipient.status === "failed" || recipient.status === "uncertain" ? "text-red-700" : "text-slate-600"}`}>{STATUS[recipient.status]}</td><td className="p-2 text-slate-600">{recipient.opened_at ? `Có${recipient.open_count && recipient.open_count > 1 ? ` (${recipient.open_count})` : ""}` : "Chưa"}</td><td className="max-w-xs p-2">{recipient.last_error}{recipient.status === "uncertain" && campaign && <div className="mt-1 flex gap-2"><button className="text-sky-700 underline" disabled={busy || running || campaign.status === "running"} onClick={() => void resolve(recipient, "resolve_sent")}>Đã kiểm tra: đã gửi</button><button className="text-amber-700 underline" disabled={busy || running || campaign.status === "running"} onClick={() => void resolve(recipient, "resolve_retry")}>Đã kiểm tra: gửi lại</button></div>}</td>{columns.slice(0, 4).map((column) => <td key={column.key} className="max-w-xs p-2">{recipient.fields[column.key]}</td>)}</tr>)}</tbody></table></div></>}
      {busy && <p className="mt-3 flex items-center gap-2 text-xs text-sky-700"><Loader2 size={13} className="animate-spin" /> Đang xử lý…</p>}
    </div>
  </div>;
}
