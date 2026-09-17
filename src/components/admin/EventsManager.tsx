"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Calendar, Layers, Loader2, Plus, RefreshCw, Save, Trash2, Users } from "lucide-react";
import { useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { useConfirm } from "@/lib/ui/confirm";
import { listRegistrationForms, type RegistrationFormSummary } from "@/lib/forms";
import { listEvents, saveEvent, deleteEvent, type EventRecord } from "@/lib/events";
import { PageHeader } from "./PageHeader";

type Draft = {
  name: string;
  event_date: string;
  form_ids: string[];
  from_name: string;
  from_email: string;
  reply_to: string;
};

function formTypeLabel(type: RegistrationFormSummary["formType"]) {
  if (type === "poster_scoring") return "Chấm điểm";
  if (type === "feedback") return "Khảo sát";
  return "Đăng ký";
}

export function EventsManager() {
  const { canManageForms } = useAdminAccess();
  const confirm = useConfirm();
  const [events, setEvents] = useState<EventRecord[]>([]);
  const [forms, setForms] = useState<RegistrationFormSummary[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newDate, setNewDate] = useState("");
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const [eventList, formList] = await Promise.all([listEvents(), listRegistrationForms()]);
    setEvents(eventList);
    setForms(formList);
    const nextDrafts: Record<string, Draft> = {};
    eventList.forEach((event) => {
      nextDrafts[event.id] = {
        name: event.name,
        event_date: event.event_date ?? "",
        form_ids: [...event.form_ids],
        from_name: event.from_name ?? "",
        from_email: event.from_email ?? "",
        reply_to: event.reply_to ?? "",
      };
    });
    setDrafts(nextDrafts);
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

  const formById = useMemo(() => new Map(forms.map((form) => [form.id, form])), [forms]);

  const patchDraft = (id: string, patch: Partial<Draft>) => {
    setDrafts((current) => ({ ...current, [id]: { ...current[id], ...patch } }));
  };

  const handleCreate = async () => {
    if (!canManageForms || creating) return;
    const name = newName.trim();
    if (!name) {
      setMessage({ type: "error", text: "Nhập tên sự kiện trước." });
      return;
    }
    setCreating(true);
    setMessage(null);
    const result = await saveEvent({ name, event_date: newDate || null, form_ids: [] });
    setCreating(false);
    if (!result.ok) {
      setMessage({ type: "error", text: result.error ?? "Tạo sự kiện thất bại." });
      return;
    }
    setNewName("");
    setNewDate("");
    setMessage({ type: "success", text: `Đã tạo sự kiện “${name}”.` });
    await load();
  };

  const handleSave = async (event: EventRecord) => {
    if (!canManageForms || busyId) return;
    const draft = drafts[event.id];
    if (!draft?.name.trim()) {
      setMessage({ type: "error", text: "Tên sự kiện không được để trống." });
      return;
    }
    setBusyId(event.id);
    setMessage(null);
    const result = await saveEvent({
      id: event.id,
      name: draft.name.trim(),
      event_date: draft.event_date || null,
      form_ids: draft.form_ids,
      from_name: draft.from_name.trim() || null,
      from_email: draft.from_email.trim() || null,
      reply_to: draft.reply_to.trim() || null,
    });
    setBusyId(null);
    if (!result.ok) {
      setMessage({ type: "error", text: result.error ?? "Lưu sự kiện thất bại." });
      return;
    }
    setMessage({ type: "success", text: "Đã lưu sự kiện." });
    await load();
  };

  const handleDelete = async (event: EventRecord) => {
    if (!canManageForms) return;
    if (!(await confirm({ title: `Xóa sự kiện “${event.name}”?`, description: "Form vẫn được giữ, chỉ bỏ nhóm.", destructive: true, confirmText: "Xóa" }))) return;
    setBusyId(event.id);
    const result = await deleteEvent(event.id);
    setBusyId(null);
    if (!result.ok) {
      setMessage({ type: "error", text: result.error ?? "Xóa sự kiện thất bại." });
      return;
    }
    setMessage({ type: "success", text: "Đã xóa sự kiện." });
    await load();
  };

  const toggleForm = (eventId: string, formId: string) => {
    const draft = drafts[eventId];
    if (!draft) return;
    const set = new Set(draft.form_ids);
    if (set.has(formId)) set.delete(formId);
    else set.add(formId);
    patchDraft(eventId, { form_ids: [...set] });
  };

  return (
    <div className="px-4 py-8 sm:px-8 sm:py-10 max-w-6xl">
      <PageHeader
        title="Sự kiện"
        subtitle="Gom nhiều form (đăng ký, khảo sát, chấm điểm) thuộc cùng một sự kiện và tách số liệu theo sự kiện."
        action={
          <button
            onClick={() => void load()}
            disabled={loading}
            className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-white/10 disabled:opacity-50"
          >
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Làm mới
          </button>
        }
      />

      {message && (
        <div className={`mb-5 rounded-xl border px-4 py-3 text-sm ${
          message.type === "success" ? "border-sky-200 bg-sky-50 text-sky-700" : "border-red-200 bg-red-50 text-red-600"
        }`}>
          {message.text}
        </div>
      )}

      {canManageForms && (
        <section className="glass relative mb-6 overflow-hidden rounded-2xl p-5">
          <div className="absolute inset-x-0 top-0 h-1" style={{ background: "linear-gradient(90deg, #0ea5e9, #06b6d400)" }} />
          <h2 className="mb-3 flex items-center gap-2 text-base font-semibold text-slate-900">
            <Plus size={16} className="text-sky-500" /> Tạo sự kiện mới
          </h2>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <label className="flex-1">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Tên sự kiện</span>
              <input
                value={newName}
                onChange={(event) => setNewName(event.target.value)}
                placeholder="VD: Hội thảo HUNA 2026"
                className="admin-field w-full rounded-xl px-4 py-3 text-sm admin-placeholder focus:outline-none"
              />
            </label>
            <label className="sm:w-48">
              <span className="mb-1.5 block text-xs font-medium text-slate-500">Ngày</span>
              <input
                type="date"
                value={newDate}
                onChange={(event) => setNewDate(event.target.value)}
                className="admin-field w-full rounded-xl px-4 py-3 text-sm focus:outline-none"
              />
            </label>
            <button
              onClick={handleCreate}
              disabled={creating}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-5 py-3 text-sm font-semibold text-on-brand hover:bg-sky-400 disabled:opacity-50"
            >
              {creating ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />} Tạo
            </button>
          </div>
        </section>
      )}

      {loading ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {[0, 1].map((item) => <div key={item} className="glass h-72 rounded-2xl animate-pulse" />)}
        </div>
      ) : events.length === 0 ? (
        <div className="glass rounded-2xl p-12 text-center">
          <Layers size={38} className="mx-auto mb-3 text-slate-500" />
          <h3 className="mb-1 text-base font-semibold text-slate-900">Chưa có sự kiện nào</h3>
          <p className="mx-auto max-w-md text-sm text-slate-500">
            Tạo sự kiện rồi gán các form đăng ký, khảo sát, chấm điểm vào cùng một nhóm.
          </p>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {events.map((eventRow) => {
            const draft = drafts[eventRow.id] ?? { name: eventRow.name, event_date: eventRow.event_date ?? "", form_ids: eventRow.form_ids };
            const assigned = draft.form_ids.map((id) => formById.get(id)).filter(Boolean) as RegistrationFormSummary[];
            const totalResponses = assigned.reduce((sum, form) => sum + form.responseCount, 0);
            const totalCheckins = assigned.reduce((sum, form) => sum + form.checkinCount, 0);

            return (
              <section key={eventRow.id} className="glass relative flex flex-col overflow-hidden rounded-2xl p-5">
                <div className="absolute inset-x-0 top-0 h-1" style={{ background: "linear-gradient(90deg, #6366f1, #6366f100)" }} />

                <div className="mb-3 flex items-center gap-2">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-indigo-200 bg-indigo-50 text-indigo-600">
                    <Layers size={15} />
                  </div>
                  <span className="text-xs uppercase tracking-widest text-slate-500">Sự kiện</span>
                  <div className="ml-auto flex items-center gap-2 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1"><Users size={12} /> {totalResponses} đăng ký</span>
                    <span>·</span>
                    <span>{totalCheckins} check-in</span>
                  </div>
                </div>

                <div className="mb-3 flex flex-col gap-3 sm:flex-row">
                  <label className="flex-1">
                    <span className="mb-1.5 block text-[11px] text-slate-400">Tên sự kiện</span>
                    <input
                      value={draft.name}
                      onChange={(event) => patchDraft(eventRow.id, { name: event.target.value })}
                      disabled={!canManageForms}
                      className="admin-field w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none disabled:opacity-60"
                    />
                  </label>
                  <label className="sm:w-40">
                    <span className="mb-1.5 block text-[11px] text-slate-400">Ngày</span>
                    <input
                      type="date"
                      value={draft.event_date}
                      onChange={(event) => patchDraft(eventRow.id, { event_date: event.target.value })}
                      disabled={!canManageForms}
                      className="admin-field w-full rounded-xl px-3 py-2.5 text-sm focus:outline-none disabled:opacity-60"
                    />
                  </label>
                </div>

                <div className="mb-3 grid gap-3 sm:grid-cols-3">
                  <label>
                    <span className="mb-1.5 block text-[11px] text-slate-400">Tên người gửi</span>
                    <input
                      value={draft.from_name}
                      onChange={(event) => patchDraft(eventRow.id, { from_name: event.target.value })}
                      disabled={!canManageForms}
                      placeholder="Hội thảo HUNA 2026"
                      className="admin-field w-full rounded-xl px-3 py-2.5 text-sm admin-placeholder focus:outline-none disabled:opacity-60"
                    />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-[11px] text-slate-400">Email người gửi</span>
                    <input
                      value={draft.from_email}
                      onChange={(event) => patchDraft(eventRow.id, { from_email: event.target.value })}
                      disabled={!canManageForms}
                      placeholder="hotro@hoithaotructuyen.net"
                      className="admin-field w-full rounded-xl px-3 py-2.5 text-sm admin-placeholder focus:outline-none disabled:opacity-60"
                    />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-[11px] text-slate-400">Reply-to (tùy chọn)</span>
                    <input
                      value={draft.reply_to}
                      onChange={(event) => patchDraft(eventRow.id, { reply_to: event.target.value })}
                      disabled={!canManageForms}
                      placeholder="Để trống = email người gửi"
                      className="admin-field w-full rounded-xl px-3 py-2.5 text-sm admin-placeholder focus:outline-none disabled:opacity-60"
                    />
                  </label>
                </div>

                <div className="mb-4 min-h-0 flex-1">
                  <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-slate-400">
                    <Calendar size={12} /> Form thuộc sự kiện
                  </div>
                  {forms.length === 0 ? (
                    <p className="text-sm text-slate-500">Chưa có form nào để gán.</p>
                  ) : (
                    <div className="max-h-56 space-y-1.5 overflow-auto pr-1">
                      {forms.map((form) => {
                        const checked = draft.form_ids.includes(form.id);
                        return (
                          <label
                            key={form.id}
                            className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition-colors ${
                              checked ? "border-sky-300 bg-sky-50" : "border-slate-200 bg-white hover:border-sky-200"
                            } ${canManageForms ? "" : "cursor-not-allowed opacity-70"}`}
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              disabled={!canManageForms}
                              onChange={() => toggleForm(eventRow.id, form.id)}
                              className="accent-sky-500"
                            />
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-medium text-slate-800">{form.title}</div>
                              <div className="text-[11px] text-slate-400">{formTypeLabel(form.formType)} · {form.responseCount} đăng ký</div>
                            </div>
                          </label>
                        );
                      })}
                    </div>
                  )}
                </div>

                {canManageForms && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => handleSave(eventRow)}
                      disabled={busyId === eventRow.id}
                      className="inline-flex items-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-on-brand hover:bg-sky-400 disabled:opacity-50"
                    >
                      {busyId === eventRow.id ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />} Lưu
                    </button>
                    <button
                      onClick={() => handleDelete(eventRow)}
                      disabled={busyId === eventRow.id}
                      className="ml-auto inline-flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                    >
                      <Trash2 size={15} /> Xóa
                    </button>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
