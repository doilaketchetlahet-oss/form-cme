"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Loader2, Mail, Plus, RefreshCw, RotateCcw, Save, Send, Trash2, X } from "lucide-react";
import { useConfirm } from "@/lib/ui/confirm";
import { useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { getAccessToken, listEvents, type EventRecord } from "@/lib/events";
import { listRegistrationForms, type RegistrationFormSummary } from "@/lib/forms";
import { PageHeader } from "./PageHeader";

type Campaign = {
  id: string;
  name: string;
  event_id: string | null;
  survey_id: string | null;
  email_subject: string | null;
  email_body: string | null;
  filter: { notCheckedIn?: boolean; hall?: string; paymentStatus?: string } | null;
  send_at: string | null;
  status: "draft" | "scheduled" | "sending" | "sent" | "failed" | "cancelled";
  total: number;
  sent: number;
  failed: number;
  created_at: string | null;
};

type TemplateOption = { id: string; name: string; subject: string | null; body: string };

const STATUS_META: Record<Campaign["status"], { label: string; className: string }> = {
  draft: { label: "Nháp", className: "border-slate-200 bg-slate-100 text-slate-600" },
  scheduled: { label: "Đã hẹn", className: "border-sky-200 bg-sky-100 text-sky-700" },
  sending: { label: "Đang gửi", className: "border-indigo-200 bg-indigo-100 text-indigo-700" },
  sent: { label: "Đã gửi", className: "border-emerald-200 bg-emerald-100 text-emerald-700" },
  failed: { label: "Lỗi", className: "border-red-200 bg-red-100 text-red-700" },
  cancelled: { label: "Đã hủy", className: "border-slate-200 bg-slate-100 text-slate-500" },
};

function emptyDraft() {
  return {
    id: "" as string,
    name: "",
    targetType: "event" as "event" | "form",
    eventId: "",
    surveyId: "",
    sendAt: "",
    notCheckedIn: false,
    hall: "",
    paymentStatus: "",
    subject: "",
    body: "",
  };
}

export function EmailCampaignsManager() {
  const { canManageForms } = useAdminAccess();
  const confirm = useConfirm();
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [forms, setForms] = useState<RegistrationFormSummary[]>([]);
  const [templates, setTemplates] = useState<TemplateOption[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState(emptyDraft());
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const token = await getAccessToken();
    if (token) {
      // Process any due campaigns/jobs first (Hobby plan runs the cron once a day).
      try {
        await fetch("/api/cron/email-campaigns", { headers: { Authorization: `Bearer ${token}` } });
      } catch {
        // ignore queue errors; still refresh the list
      }
    }
    const [eventList, formList, campaignRes, templateRes] = await Promise.all([
      listEvents(),
      listRegistrationForms(),
      token
        ? fetch("/api/admin/campaigns", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).catch(() => null)
        : Promise.resolve(null),
      token
        ? fetch("/api/admin/email-templates", { headers: { Authorization: `Bearer ${token}` } }).then((r) => r.json()).catch(() => null)
        : Promise.resolve(null),
    ]);
    setEvents(eventList);
    setForms(formList);
    setCampaigns((campaignRes?.campaigns ?? []) as Campaign[]);
    setTemplates(((templateRes?.templates ?? []) as { id: string; name: string; subject: string | null; body: string }[])
      .map((t) => ({ id: t.id, name: t.name, subject: t.subject, body: t.body })));
    setLoading(false);
  }, []);

  useEffect(() => {
    let active = true;
    const run = async () => {
      await Promise.resolve();
      if (active) await load();
    };
    void run();
    return () => { active = false; };
  }, [load]);

  const patch = (next: Partial<ReturnType<typeof emptyDraft>>) => setDraft((current) => ({ ...current, ...next }));

  const eventById = useMemo(() => new Map(events.map((e) => [e.id, e])), [events]);
  const formById = useMemo(() => new Map(forms.map((f) => [f.id, f])), [forms]);

  const applyTemplate = async (templateId: string) => {
    const template = templates.find((t) => t.id === templateId);
    if (template) patch({ subject: template.subject ?? "", body: template.body });
  };

  const save = async (action: "save" | "cancel" | "send_now" | "retry_failed" = "save") => {
    if (!canManageForms || busy) return;
    const token = await getAccessToken();
    if (!token) { setMessage({ type: "error", text: "Phiên đăng nhập đã hết hạn." }); return; }

    if (action === "save") {
      if (!draft.name.trim()) { setMessage({ type: "error", text: "Nhập tên chiến dịch." }); return; }
      if (draft.targetType === "event" && !draft.eventId) { setMessage({ type: "error", text: "Chọn sự kiện." }); return; }
      if (draft.targetType === "form" && !draft.surveyId) { setMessage({ type: "error", text: "Chọn form." }); return; }
    }

    setBusy(true);
    setMessage(null);
    const payload = action === "save"
      ? {
          id: draft.id || undefined,
          name: draft.name.trim(),
          event_id: draft.targetType === "event" ? draft.eventId : null,
          survey_id: draft.targetType === "form" ? draft.surveyId : null,
          email_subject: draft.subject.trim() || null,
          email_body: draft.body || null,
          filter: {
            notCheckedIn: draft.notCheckedIn,
            hall: draft.hall.trim() || undefined,
            paymentStatus: draft.paymentStatus || undefined,
          },
          send_at: draft.sendAt ? new Date(draft.sendAt).toISOString() : null,
        }
      : { id: draft.id, action };

    const response = await fetch("/api/admin/campaigns", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const result = await response.json().catch(() => null);
    setBusy(false);
    if (!response.ok || !result?.ok) {
      setMessage({ type: "error", text: result?.error ?? "Lưu chiến dịch thất bại." });
      return;
    }
    setMessage({ type: "success", text: action === "save" ? "Đã lưu chiến dịch." : "Đã cập nhật chiến dịch." });
    setDraft(emptyDraft());
    await load();
  };

  const action = async (id: string, kind: "cancel" | "send_now" | "retry_failed") => {
    if (!canManageForms || busy) return;
    const token = await getAccessToken();
    if (!token) return;
    setBusy(true);
    await fetch("/api/admin/campaigns", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ id, action: kind }),
    });
    setBusy(false);
    setMessage({ type: "success", text: "Đã cập nhật chiến dịch." });
    await load();
  };

  const remove = async (id: string) => {
    if (!canManageForms) return;
    if (!(await confirm({ title: "Xóa chiến dịch này?", destructive: true, confirmText: "Xóa" }))) return;
    const token = await getAccessToken();
    if (!token) return;
    setBusy(true);
    await fetch(`/api/admin/campaigns?id=${encodeURIComponent(id)}`, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
    setBusy(false);
    await load();
  };

  const edit = (campaign: Campaign) => {
    setDraft({
      id: campaign.id,
      name: campaign.name,
      targetType: campaign.event_id ? "event" : "form",
      eventId: campaign.event_id ?? "",
      surveyId: campaign.survey_id ?? "",
      sendAt: campaign.send_at ? new Date(campaign.send_at).toISOString().slice(0, 16) : "",
      notCheckedIn: !!campaign.filter?.notCheckedIn,
      hall: campaign.filter?.hall ?? "",
      paymentStatus: campaign.filter?.paymentStatus ?? "",
      subject: campaign.email_subject ?? "",
      body: campaign.email_body ?? "",
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  const targetLabel = (campaign: Campaign) => {
    if (campaign.event_id) return eventById.get(campaign.event_id)?.name ?? "Sự kiện";
    if (campaign.survey_id) return formById.get(campaign.survey_id)?.title ?? "Form";
    return "—";
  };

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10 max-w-6xl">
      <PageHeader
        title="Chiến dịch email"
        subtitle="Hẹn giờ hoặc gửi ngay theo sự kiện/form, có điều kiện lọc người nhận. Hệ thống gửi dần qua cron."
        action={
          <button
            onClick={() => { setDraft(emptyDraft()); void load(); }}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Chạy &amp; làm mới
          </button>
        }
      />

      {message && (
        <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
          message.type === "success" ? "border-sky-200 bg-sky-50 text-sky-700" : "border-red-200 bg-red-50 text-red-600"
        }`}>{message.text}</div>
      )}

      {canManageForms && (
        <section className="glass relative mb-6 overflow-hidden rounded-2xl p-5">
          <div className="absolute inset-x-0 top-0 h-1" style={{ background: "linear-gradient(90deg, #0ea5e9, #06b6d400)" }} />
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
            {draft.id ? <Save size={16} className="text-sky-500" /> : <Plus size={16} className="text-sky-500" />}
            {draft.id ? "Sửa chiến dịch" : "Tạo chiến dịch"}
            {draft.id && (
              <button onClick={() => setDraft(emptyDraft())} className="ml-auto inline-flex items-center gap-1 text-xs text-slate-500 hover:text-slate-800">
                <X size={13} /> Hủy sửa
              </button>
            )}
          </h2>

          <div className="grid gap-3 sm:grid-cols-2">
            <label>
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Tên chiến dịch</span>
              <input value={draft.name} onChange={(e) => patch({ name: e.target.value })} placeholder="VD: Nhắc lịch sự kiện A"
                className="admin-field w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none" />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Gửi lúc (để trống = nháp)</span>
              <input type="datetime-local" value={draft.sendAt} onChange={(e) => patch({ sendAt: e.target.value })}
                className="admin-field w-full rounded-xl px-4 py-3 text-sm focus:outline-none" />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Gửi theo</span>
              <select value={draft.targetType} onChange={(e) => patch({ targetType: e.target.value as "event" | "form" })}
                className="admin-dark-select admin-field w-full rounded-xl px-4 py-3 text-sm focus:outline-none">
                <option value="event">Sự kiện</option>
                <option value="form">Form</option>
              </select>
            </label>
            {draft.targetType === "event" ? (
              <label>
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Sự kiện</span>
                <select value={draft.eventId} onChange={(e) => patch({ eventId: e.target.value })}
                  className="admin-dark-select admin-field w-full rounded-xl px-4 py-3 text-sm focus:outline-none">
                  <option value="">Chọn sự kiện…</option>
                  {events.map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
                </select>
              </label>
            ) : (
              <label>
                <span className="mb-1.5 block text-xs font-medium text-slate-500">Form</span>
                <select value={draft.surveyId} onChange={(e) => patch({ surveyId: e.target.value })}
                  className="admin-dark-select admin-field w-full rounded-xl px-4 py-3 text-sm focus:outline-none">
                  <option value="">Chọn form…</option>
                  {forms.map((form) => <option key={form.id} value={form.id}>{form.title}</option>)}
                </select>
              </label>
            )}
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-700">
              <input type="checkbox" checked={draft.notCheckedIn} onChange={(e) => patch({ notCheckedIn: e.target.checked })} className="accent-sky-500" />
              Chỉ người chưa check-in
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Hội trường (tùy chọn)</span>
              <input value={draft.hall} onChange={(e) => patch({ hall: e.target.value })} placeholder="VD: Hội trường 1"
                className="admin-field w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none" />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Thanh toán (tùy chọn)</span>
              <select value={draft.paymentStatus} onChange={(e) => patch({ paymentStatus: e.target.value })}
                className="admin-dark-select admin-field w-full rounded-xl px-4 py-3 text-sm focus:outline-none">
                <option value="">Tất cả</option>
                <option value="paid">Đã thanh toán</option>
                <option value="pending">Chờ thanh toán</option>
              </select>
            </label>
          </div>

          {templates.length > 0 && (
            <label className="mt-3 block">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Nạp từ template</span>
              <select defaultValue="" onChange={(e) => { if (e.target.value) void applyTemplate(e.target.value); }}
                className="admin-dark-select admin-field w-full rounded-xl px-4 py-3 text-sm focus:outline-none">
                <option value="">Chọn template…</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </select>
            </label>
          )}

          <label className="mt-3 block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">Tiêu đề email</span>
            <input value={draft.subject} onChange={(e) => patch({ subject: e.target.value })} placeholder="Mã check-in: {{survey_title}}"
              className="admin-field w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none" />
          </label>
          <label className="mt-3 block">
            <span className="mb-1.5 block text-xs font-medium text-slate-500">Nội dung (HTML hoặc để trống = mẫu mặc định)</span>
            <textarea value={draft.body} onChange={(e) => patch({ body: e.target.value })} rows={5}
              className="admin-field w-full rounded-xl px-4 py-3 text-sm focus:outline-none" />
          </label>

          <div className="mt-4 flex flex-wrap gap-2">
            <button onClick={() => void save("save")} disabled={busy}
              className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-on-brand hover:bg-sky-400 disabled:opacity-50">
              {busy ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} {draft.id ? "Cập nhật" : "Lưu chiến dịch"}
            </button>
            {draft.id && (
              <>
                <button onClick={() => void save("send_now")} disabled={busy}
                  className="inline-flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-4 py-3 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50">
                  <Send size={15} /> Gửi ngay
                </button>
                <button onClick={() => void save("cancel")} disabled={busy}
                  className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                  <X size={15} /> Hủy
                </button>
                <button onClick={() => void save("retry_failed")} disabled={busy}
                  className="inline-flex items-center gap-2 rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50">
                  <RotateCcw size={15} /> Gửi lại lỗi
                </button>
              </>
            )}
          </div>
        </section>
      )}

      {loading ? (
        <div className="glass rounded-2xl h-64 animate-pulse" />
      ) : campaigns.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <Mail size={38} className="mx-auto mb-3 text-slate-500" />
          <h3 className="mb-1 text-base font-semibold text-slate-900">Chưa có chiến dịch nào</h3>
          <p className="text-sm text-slate-500">Tạo chiến dịch để hẹn giờ hoặc gửi hàng loạt theo điều kiện.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {campaigns.map((campaign) => {
            const meta = STATUS_META[campaign.status] ?? STATUS_META.draft;
            return (
              <div key={campaign.id} className="glass flex flex-col gap-3 rounded-2xl p-4 sm:flex-row sm:items-center">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="truncate text-sm font-semibold text-slate-900">{campaign.name}</span>
                    <span className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold ${meta.className}`}>{meta.label}</span>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-500">
                    <span>{targetLabel(campaign)}</span>
                    {campaign.send_at && (
                      <span className="inline-flex items-center gap-1"><CalendarClock size={12} /> {new Date(campaign.send_at).toLocaleString("vi-VN")}</span>
                    )}
                    <span>{campaign.sent}/{campaign.total} đã gửi</span>
                    {campaign.failed > 0 && <span className="text-red-500">{campaign.failed} lỗi</span>}
                    {campaign.filter?.notCheckedIn && <span>· chưa check-in</span>}
                    {campaign.filter?.hall && <span>· {campaign.filter.hall}</span>}
                    {campaign.filter?.paymentStatus && <span>· {campaign.filter.paymentStatus}</span>}
                  </div>
                </div>
                {canManageForms && (
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button onClick={() => edit(campaign)} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:text-sky-600">Sửa</button>
                    {(campaign.status === "draft" || campaign.status === "scheduled") && (
                      <button onClick={() => void action(campaign.id, "send_now")} disabled={busy} className="rounded-lg border border-sky-200 bg-white px-3 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50">Gửi ngay</button>
                    )}
                    {campaign.status === "scheduled" && (
                      <button onClick={() => void action(campaign.id, "cancel")} disabled={busy} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Hủy</button>
                    )}
                    {campaign.failed > 0 && (
                      <button onClick={() => void action(campaign.id, "retry_failed")} disabled={busy} className="rounded-lg border border-amber-200 bg-white px-3 py-1.5 text-xs font-semibold text-amber-700 hover:bg-amber-50 disabled:opacity-50">Gửi lại lỗi</button>
                    )}
                    <button onClick={() => void remove(campaign.id)} disabled={busy} className="inline-flex items-center gap-1 rounded-lg border border-red-200 bg-white px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50">
                      <Trash2 size={13} /> Xóa
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
