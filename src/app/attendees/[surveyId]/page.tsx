"use client";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { useConfirm } from "@/lib/ui/confirm";
import { Users, UserCheck, Search, QrCode, Trash2, RotateCcw, Download, Plus, Save, X, Pencil, Printer, Mail, ShieldCheck, Upload, CreditCard, BarChart3 } from "lucide-react";
import { supabase } from "@/lib/supabase";
import type { SurveyResponse } from "@/lib/surveys";
import { logCheckinEvent, type CheckinLog } from "@/lib/checkinLogs";
import { PinGate } from "@/components/ui/PinGate";
import Link from "next/link";
import { buildPublicUrl } from "@/lib/site-url";
import { buildQrImagePath } from "@/lib/qr-style";
import type { QRBranding } from "@/lib/surveys";

export default function AttendeesPage({ params }: { params: Promise<{ surveyId: string }> }) {
  const [sid, setSid] = useState("");
  useEffect(() => { params.then(({ surveyId }) => setSid(surveyId)); }, [params]);
  if (!sid) return <div className="min-h-dvh bg-slate-50" />;
  return <PinGate surveyId={sid}><AttendeesInner surveyId={sid} /></PinGate>;
}

function AttendeesInner({ surveyId }: { surveyId: string }) {
  const confirm = useConfirm();
  const [surveyTitle, setSurveyTitle] = useState("");
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const [questionLabels, setQuestionLabels] = useState<Record<string, string>>({});
  const [questionOrder, setQuestionOrder] = useState<string[]>([]);
  const [questionMeta, setQuestionMeta] = useState<Record<string, { type: string; options: string[] | null; isHall: boolean }>>({});
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name" | "checkin" | "hall">("newest");
  const [statusFilter, setStatusFilter] = useState<"all" | "checked" | "unchecked" | "email_failed" | "payment_pending">("all");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editAnswers, setEditAnswers] = useState<Record<string, string>>({});
  const [showAddForm, setShowAddForm] = useState(false);
  const [newAnswers, setNewAnswers] = useState<Record<string, string>>({});
  const [selectedResponse, setSelectedResponse] = useState<SurveyResponse | null>(null);
  const [selectedLogs, setSelectedLogs] = useState<CheckinLog[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [hallFilter, setHallFilter] = useState<string>("");
  const [halls, setHalls] = useState<string[]>([]);
  const [resending, setResending] = useState(false);
  const [sessions, setSessions] = useState<string[]>([]);
  const [showSessions, setShowSessions] = useState(false);
  const [showStats, setShowStats] = useState(false);
  const [sessionsEnabled, setSessionsEnabled] = useState(false);
  const [vipCheckinEnabled, setVipCheckinEnabled] = useState(false);
  const [qrBranding, setQrBranding] = useState<QRBranding | null>(null);

  const loadData = useCallback(async (id: string) => {
    const [{ data: survey }, { data: resps }, { data: questions }] = await Promise.all([
      supabase.from("surveys").select("title, vip_checkin_enabled, checkin_theme").eq("id", id).single(),
      supabase.from("survey_responses").select("*").eq("survey_id", id).order("submitted_at", { ascending: false }),
      supabase.from("survey_questions").select("id, text, position, type, options, is_hall_selector").eq("survey_id", id).order("position"),
    ]);
    setSurveyTitle(survey?.title ?? "Khảo sát");
    setVipCheckinEnabled(!!(survey as { vip_checkin_enabled?: boolean } | null)?.vip_checkin_enabled);
    setQrBranding(((survey as { checkin_theme?: { qr?: QRBranding } } | null)?.checkin_theme?.qr) ?? null);
    setSessionsEnabled(!!((survey as { checkin_theme?: { sessionsEnabled?: boolean } } | null)?.checkin_theme?.sessionsEnabled));
    setResponses(resps ?? []);
    const labels: Record<string, string> = {};
    const order: string[] = [];
    const meta: Record<string, { type: string; options: string[] | null; isHall: boolean }> = {};
    (questions ?? []).forEach((q: { id: string; text: string; type: string; options: string[] | null; is_hall_selector: boolean }) => {
      meta[q.id] = { type: q.type, options: q.options, isHall: !!q.is_hall_selector };
      if (q.type !== "section" && q.type !== "image_banner") {
        labels[q.id] = q.text;
        order.push(q.id);
      }
    });
    setQuestionLabels(labels);
    setQuestionOrder(order);
    setQuestionMeta(meta);
    // Extract unique halls
    const uniqueHalls = [...new Set((resps ?? []).map((r: SurveyResponse) => r.hall).filter(Boolean))] as string[];
    setHalls(uniqueHalls);
    // Load sessions: from localStorage + derive from existing session_checkins keys
    const stored = JSON.parse(localStorage.getItem(`sessions-${id}`) || "[]") as string[];
    const derived = new Set<string>(stored);
    (resps ?? []).forEach((r: SurveyResponse) => {
      Object.keys(r.session_checkins ?? {}).forEach((k) => derived.add(k));
    });
    setSessions([...derived]);
  }, []);

  useEffect(() => {
    if (!surveyId) return;
    const timer = window.setTimeout(() => { void loadData(surveyId); }, 0);
    return () => window.clearTimeout(timer);
  }, [surveyId, loadData]);

  const addSession = () => {
    const name = prompt("Tên buổi (vd: Buổi sáng, Buổi chiều):")?.trim();
    if (!name || sessions.includes(name)) return;
    const next = [...sessions, name];
    setSessions(next);
    localStorage.setItem(`sessions-${surveyId}`, JSON.stringify(next));
  };

  const removeSession = (name: string) => {
    const next = sessions.filter((s) => s !== name);
    setSessions(next);
    localStorage.setItem(`sessions-${surveyId}`, JSON.stringify(next));
  };

  const refreshData = useCallback(async () => {
    if (!surveyId) return;
    const { data } = await supabase.from("survey_responses").select("*").eq("survey_id", surveyId).order("submitted_at", { ascending: false });
    if (data) setResponses(data);
  }, [surveyId]);

  // Realtime + polling fallback
  useEffect(() => {
    if (!surveyId) return;
    const channel = supabase
      .channel(`attendees-${surveyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "survey_responses", filter: `survey_id=eq.${surveyId}` },
        () => { refreshData(); })
      .subscribe();

    // Polling fallback every 5s in case realtime doesn't fire
    const interval = setInterval(refreshData, 5000);

    return () => { supabase.removeChannel(channel); clearInterval(interval); };
  }, [surveyId, refreshData]);

  // Close the detail modal with Esc
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") { setSelectedResponse(null); setEditingId(null); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const findName = (answers: Record<string, unknown>): string => {
    // Use question order to get first text-like field (usually name)
    for (const k of questionOrder) {
      const v = answers[k];
      if (typeof v === "string" && v.length > 1 && v.length < 50 && !/^https?:/.test(v) && !/^\d+$/.test(v)) return v;
    }
    return "";
  };

  const findEmail = (r: SurveyResponse): string | undefined => {
    return r.email || (Object.values(r.answers).find((v) => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) as string | undefined);
  };

  const patchResponse = (id: string, patch: Partial<SurveyResponse>) => {
    setResponses((prev) => prev.map((r) => r.id === id ? { ...r, ...patch } : r));
    setSelectedResponse((current) => current?.id === id ? { ...current, ...patch } : current);
  };

  const markEmailStatus = async (id: string, status: "sent" | "failed", error?: string) => {
    const now = new Date().toISOString();
    const patch = {
      email_status: status,
      email_last_attempt_at: now,
      email_sent_at: status === "sent" ? now : null,
      email_error: status === "failed" ? error ?? "Gửi email thất bại" : null,
    } satisfies Partial<SurveyResponse>;

    patchResponse(id, patch);
    await supabase.from("survey_responses").update(patch).eq("id", id);
  };

  // CRUD
  const doCheckin = async (id: string) => {
    const response = responses.find((r) => r.id === id);
    if (response && !isPaymentSettled(response.payment_status)) {
      toast.error("Người này chưa hoàn tất thanh toán, chưa thể check-in.");
      return;
    }
    await supabase.from("survey_responses").update({ checked_in: true, checked_in_at: new Date().toISOString() }).eq("id", id);
    await logCheckinEvent({ surveyId, responseId: id, action: "checkin", method: "manual", hall: response?.hall });
    if (selectedResponse?.id === id) await loadCheckinLogs(id);
    setResponses((prev) => prev.map((r) => r.id === id ? { ...r, checked_in: true, checked_in_at: new Date().toISOString() } : r));
  };

  const undoCheckin = async (id: string) => {
    const response = responses.find((r) => r.id === id);
    await supabase.from("survey_responses").update({ checked_in: false, checked_in_at: null }).eq("id", id);
    await logCheckinEvent({ surveyId, responseId: id, action: "undo_checkin", method: "manual", hall: response?.hall });
    if (selectedResponse?.id === id) await loadCheckinLogs(id);
    setResponses((prev) => prev.map((r) => r.id === id ? { ...r, checked_in: false, checked_in_at: null } : r));
  };

  const deleteResponse = async (id: string) => {
    if (!(await confirm({ title: "Xoá người này?", destructive: true, confirmText: "Xoá" }))) return;
    await supabase.from("survey_responses").delete().eq("id", id);
    setResponses((prev) => prev.filter((r) => r.id !== id));
  };

  const startEdit = (r: SurveyResponse) => {
    setEditingId(r.id);
    const ans: Record<string, string> = {};
    questionOrder.forEach((k) => {
      const v = r.answers[k];
      // For choice (single), store the selected index as string for the <select> value
      ans[k] = Array.isArray(v) ? String(v[0] ?? "") : String(v ?? "");
    });
    setEditAnswers(ans);
  };

  const saveEdit = async () => {
    if (!editingId) return;
    // Convert edited values back to proper types (choice → number index)
    const finalAnswers: Record<string, string | number | number[]> = {};
    let derivedHall: string | null | undefined = undefined;
    for (const [qId, raw] of Object.entries(editAnswers)) {
      const m = questionMeta[qId];
      if (m?.type === "choice") {
        const idx = parseInt(raw, 10);
        finalAnswers[qId] = isNaN(idx) ? raw : idx;
        // Re-derive hall if this is the hall-selector question
        if (m.isHall && !isNaN(idx) && m.options?.[idx] !== undefined) {
          derivedHall = m.options[idx];
        }
      } else {
        finalAnswers[qId] = raw;
      }
    }
    const original = responses.find((r) => r.id === editingId);
    const prevEmail = original ? findEmail(original) : undefined;
    const newEmail = Object.values(finalAnswers).find(
      (value): value is string => typeof value === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value),
    );
    const emailChanged = !!newEmail && newEmail.toLowerCase() !== (prevEmail ?? "").toLowerCase();

    const patch: Record<string, unknown> = { answers: finalAnswers };
    if (derivedHall !== undefined) patch.hall = derivedHall;
    if (emailChanged && newEmail) patch.email = newEmail;

    await supabase.from("survey_responses").update(patch).eq("id", editingId);
    setResponses((prev) => prev.map((r) => r.id === editingId
      ? { ...r, answers: finalAnswers, ...(derivedHall !== undefined ? { hall: derivedHall } : {}), ...(emailChanged && newEmail ? { email: newEmail } : {}) }
      : r));
    if (selectedResponse?.id === editingId) {
      setSelectedResponse({ ...selectedResponse, answers: finalAnswers, ...(derivedHall !== undefined ? { hall: derivedHall } : {}), ...(emailChanged && newEmail ? { email: newEmail } : {}) });
    }
    setEditingId(null);

    // Auto re-send the check-in email when the email address changed.
    if (emailChanged && newEmail) {
      const merged: SurveyResponse = { ...(original ?? ({} as SurveyResponse)), id: editingId, answers: finalAnswers, email: newEmail };
      const ok = await sendCheckinFor(merged, newEmail);
      if (ok) toast.success(`Đã lưu và gửi lại QR đến ${newEmail}.`);
      else toast.error('Đã lưu email mới nhưng gửi thất bại. Bấm "Gửi lại QR" để thử lại.');
    }
  };

  const loadCheckinLogs = async (responseId: string) => {
    const { data } = await supabase
      .from("checkin_logs")
      .select("*")
      .eq("response_id", responseId)
      .order("created_at", { ascending: false })
      .limit(8);
    setSelectedLogs((data ?? []) as CheckinLog[]);
  };

  const openDetail = async (r: SurveyResponse) => {
    setSelectedResponse(r);
    setSelectedLogs([]);
    setEditingId(null);
    await loadCheckinLogs(r.id);
  };

  const toggleSession = async (r: SurveyResponse, sessionName: string) => {
    const current = r.session_checkins ?? {};
    const isChecked = !!current[sessionName];
    if (isChecked) {
      await supabase.rpc("uncheckin_session", { resp_id: r.id, session_name: sessionName });
      await logCheckinEvent({ surveyId, responseId: r.id, action: "session_uncheckin", method: "manual", hall: r.hall, sessionName });
    } else {
      await supabase.rpc("checkin_session", { resp_id: r.id, session_name: sessionName });
      await logCheckinEvent({ surveyId, responseId: r.id, action: "session_checkin", method: "manual", hall: r.hall, sessionName });
    }
    if (selectedResponse?.id === r.id) await loadCheckinLogs(r.id);
    const updated = { ...current };
    if (isChecked) delete updated[sessionName];
    else updated[sessionName] = new Date().toISOString();
    setResponses((prev) => prev.map((x) => x.id === r.id ? { ...x, session_checkins: updated } : x));
    if (selectedResponse?.id === r.id) setSelectedResponse({ ...selectedResponse, session_checkins: updated });
  };

  const addNew = async () => {
    const { data } = await supabase.from("survey_responses").insert({
      survey_id: surveyId,
      answers: newAnswers,
    }).select("*").single();
    if (data) {
      setResponses((prev) => [data, ...prev]);
      setShowAddForm(false);
      setNewAnswers({});
    }
  };

  const exportCSV = () => {
    const headers = [
      "STT",
      ...questionOrder.map((k) => questionLabels[k] || k),
      "Thanh toán",
      "Số tiền",
      "Tên tài khoản chuyển",
      "Ngân hàng chuyển",
      "Số TK chuyển",
      "Mã tham chiếu PayOS",
      "Mã đơn PayOS",
      "Thời gian giao dịch PayOS",
      "Check-in",
      "Thời gian check-in",
      ...sessions.map((s) => `Buổi: ${s}`),
      "Thời gian đăng ký",
    ];
    const rows = responses.map((r, i) => {
      const fields = questionOrder.map((k) => {
        const v = r.answers[k];
        const m = questionMeta[k];
        if (typeof v === "string" && v.startsWith("http")) return v;
        // Choice → export option label(s) instead of raw index
        if (m?.type === "choice" && m.options) {
          const idxs = Array.isArray(v) ? v : (typeof v === "number" ? [v] : []);
          return idxs.map((i) => m.options![i] ?? "").filter(Boolean).join(", ");
        }
        return v != null ? String(v) : "";
      });
      const sessionFields = sessions.map((s) => {
        const at = r.session_checkins?.[s];
        return at ? new Date(at).toLocaleString("vi-VN") : "";
      });
      return [
        String(i + 1),
        ...fields,
        formatPaymentStatus(r.payment_status),
        r.payment_amount ? String(r.payment_amount) : "",
        r.payment_payer_name ?? "",
        r.payment_payer_bank ?? "",
        r.payment_payer_account ?? "",
        r.payment_reference ?? "",
        r.payment_order_code ? String(r.payment_order_code) : "",
        r.payment_transaction_datetime ?? "",
        r.checked_in ? "Có" : "Chưa",
        r.checked_in_at ? new Date(r.checked_in_at).toLocaleString("vi-VN") : "",
        ...sessionFields,
        new Date(r.submitted_at).toLocaleString("vi-VN"),
      ];
    });
    const csv = [headers, ...rows].map((row) => row.map((c) => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const bom = "\uFEFF";
    const blob = new Blob([bom + csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `checkin-${surveyTitle || "export"}.csv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const checkedCount = responses.filter((r) => r.checked_in).length;
  const totalCount = responses.length;
  const uncheckedCount = totalCount - checkedCount;
  const pendingPaymentCount = responses.filter((r) => r.payment_status === "pending").length;
  const emailFailedCount = responses.filter((r) => r.email_status === "failed").length;

  // Stats: check-in by hour, by hall
  const checkinRate = totalCount > 0 ? Math.round((checkedCount / totalCount) * 100) : 0;
  const hallStats = halls.map((h) => {
    const inHall = responses.filter((r) => r.hall === h);
    const checked = inHall.filter((r) => r.checked_in).length;
    return { hall: h, total: inHall.length, checked };
  });
  // Check-in by hour
  const hourBuckets: Record<number, number> = {};
  responses.filter((r) => r.checked_in && r.checked_in_at).forEach((r) => {
    const h = new Date(r.checked_in_at!).getHours();
    hourBuckets[h] = (hourBuckets[h] || 0) + 1;
  });
  // Build range from min to max hour
  const hourKeys = Object.keys(hourBuckets).map(Number);
  const minHour = hourKeys.length > 0 ? Math.min(...hourKeys) : 0;
  const maxHour = hourKeys.length > 0 ? Math.max(...hourKeys) : 0;
  const hourRange: number[] = [];
  for (let i = minHour; i <= maxHour; i++) hourRange.push(i);
  const maxHourCount = Math.max(1, ...Object.values(hourBuckets));

  const filtered = responses.filter((r) => {
    if (hallFilter && r.hall !== hallFilter) return false;
    if (statusFilter === "checked" && !r.checked_in) return false;
    if (statusFilter === "unchecked" && r.checked_in) return false;
    if (statusFilter === "email_failed" && r.email_status !== "failed") return false;
    if (statusFilter === "payment_pending" && r.payment_status !== "pending") return false;
    if (!search) return true;
    const s = search.toLowerCase();
    const matchesAnswer = Object.values(r.answers).some((v) =>
      typeof v === "string" && v.toLowerCase().includes(s)
    );
    return matchesAnswer || r.id.includes(s);
  }).sort((a, b) => {
    if (sortBy === "oldest") {
      return new Date(a.submitted_at).getTime() - new Date(b.submitted_at).getTime();
    }
    if (sortBy === "name") {
      return (findName(a.answers) || "").localeCompare(findName(b.answers) || "", "vi");
    }
    if (sortBy === "checkin") {
      if (a.checked_in !== b.checked_in) return a.checked_in ? 1 : -1;
      return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
    }
    if (sortBy === "hall") {
      return (a.hall || "").localeCompare(b.hall || "", "vi") || new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
    }
    return new Date(b.submitted_at).getTime() - new Date(a.submitted_at).getTime();
  });

  // Bulk actions
  const toggleSelect = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const selectAll = () => { setSelectedIds(new Set(filtered.map((r) => r.id))); };
  const clearSelection = () => { setSelectedIds(new Set()); };
  const bulkCheckin = async () => {
    const ids = [...selectedIds].filter((id) => {
      const response = responses.find((r) => r.id === id);
      return !response || isPaymentSettled(response.payment_status);
    });
    if (ids.length === 0) {
      toast.warning("Các dòng đã chọn đều chưa hoàn tất thanh toán.");
      return;
    }
    await Promise.all(ids.map((id) => supabase.from("survey_responses").update({ checked_in: true, checked_in_at: new Date().toISOString() }).eq("id", id)));
    await Promise.all(ids.map((id) => {
      const response = responses.find((r) => r.id === id);
      return logCheckinEvent({ surveyId, responseId: id, action: "checkin", method: "bulk", hall: response?.hall });
    }));
    setResponses((prev) => prev.map((r) => ids.includes(r.id) ? { ...r, checked_in: true, checked_in_at: new Date().toISOString() } : r));
    setSelectedIds(new Set());
  };
  const bulkAssignHall = async (hallName: string) => {
    const ids = [...selectedIds];
    await Promise.all(ids.map((id) => supabase.from("survey_responses").update({ hall: hallName }).eq("id", id)));
    setResponses((prev) => prev.map((r) => ids.includes(r.id) ? { ...r, hall: hallName } : r));
    setSelectedIds(new Set());
    if (!halls.includes(hallName)) setHalls([...halls, hallName]);
  };
  const bulkDelete = async () => {
    const ids = [...selectedIds];
    if (ids.length === 0) return;
    if (!(await confirm({ title: `Xoá ${ids.length} người đã chọn?`, description: "Thao tác này không thể hoàn tác.", destructive: true, confirmText: "Xoá" }))) return;

    const { error } = await supabase.from("survey_responses").delete().in("id", ids);
    if (error) {
      toast.error(`Xoá thất bại: ${error.message}`);
      return;
    }

    setResponses((prev) => prev.filter((r) => !ids.includes(r.id)));
    setSelectedIds(new Set());
    setSelectedResponse((current) => current && ids.includes(current.id) ? null : current);
  };

  const sendCheckinFor = async (response: SurveyResponse, email: string): Promise<boolean> => {
    setResending(true);
    try {
      const res = await fetch("/api/send-checkin-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: email,
          name: findName(response.answers) || "",
          checkinUrl: buildPublicUrl(`/checkin/${response.id}`),
          surveyTitle,
          responseId: response.id,
          qrStyle: qrBranding,
        }),
      });
      if (res.ok) {
        await markEmailStatus(response.id, "sent");
        return true;
      }
      const body = await res.json().catch(() => null);
      await markEmailStatus(response.id, "failed", body?.detail || body?.error || "Gửi thất bại");
      return false;
    } finally {
      setResending(false);
    }
  };

  const resendEmail = async (r: SurveyResponse) => {
    const email = findEmail(r);
    if (!email) { toast.error("Không tìm thấy email của người này."); return; }
    const ok = await sendCheckinFor(r, email);
    if (ok) toast.success(`Đã gửi lại QR đến ${email}`);
    else toast.error("Gửi thất bại. Thử lại.");
  };

  const sendBulkEmails = async (
    targets: { r: SurveyResponse; email: string }[],
    mode: "reminder" | "default",
    label: string,
  ) => {
    if (targets.length === 0) { toast.error("Không có ai để gửi."); return; }
    if (!(await confirm({ title: label, description: `${targets.length} người? (Resend free: tối đa 100 email/ngày)`, confirmText: "Gửi" }))) return;
    setResending(true);
    let sent = 0, failed = 0;
    // Send sequentially to respect rate limits
    for (const { r, email } of targets) {
      try {
        const res = await fetch("/api/send-checkin-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            to: email,
            name: findName(r.answers) || "",
            checkinUrl: buildPublicUrl(`/checkin/${r.id}`),
            surveyTitle,
            ...(mode === "reminder" ? { mode: "reminder" } : {}),
            responseId: r.id,
            qrStyle: qrBranding,
          }),
        });
        if (res.ok) {
          sent++;
          await markEmailStatus(r.id, "sent");
        } else {
          failed++;
          const body = await res.json().catch(() => null);
          await markEmailStatus(r.id, "failed", body?.detail || body?.error || "Gửi thất bại");
        }
      } catch (error) {
        failed++;
        await markEmailStatus(r.id, "failed", error instanceof Error ? error.message : "Gửi thất bại");
      }
      await new Promise((res) => setTimeout(res, 600)); // ~1.6/s to stay under limits
    }
    setResending(false);
    if (failed > 0) toast.warning(`Đã gửi ${sent}. ${failed} thất bại.`);
    else toast.success(`Đã gửi ${sent}.`);
  };

  const sendReminders = () => sendBulkEmails(
    responses
      .map((r) => ({ r, email: findEmail(r) }))
      .filter((t): t is { r: SurveyResponse; email: string } => !!t.email),
    "reminder",
    "Gửi email nhắc lịch đến",
  );

  const sendFailed = () => sendBulkEmails(
    responses
      .filter((r) => r.email_status === "failed")
      .map((r) => ({ r, email: findEmail(r) }))
      .filter((t): t is { r: SurveyResponse; email: string } => !!t.email),
    "default",
    "Gửi lại email lỗi cho",
  );

  const sendSelected = () => sendBulkEmails(
    responses
      .filter((r) => selectedIds.has(r.id))
      .map((r) => ({ r, email: findEmail(r) }))
      .filter((t): t is { r: SurveyResponse; email: string } => !!t.email),
    "reminder",
    "Gửi email cho người đã chọn:",
  );

  const printBadge = (r: SurveyResponse) => {
    const name = findName(r.answers) || r.id.slice(0, 8);
    const checkinUrl = buildPublicUrl(`/checkin/${r.id}`);
    const qrImg = buildPublicUrl(buildQrImagePath(checkinUrl, 180, qrBranding));
    const w = window.open("", "_blank");
    if (!w) return;
    w.document.write(`<!DOCTYPE html><html><head><title>Badge</title>
      <style>body{font-family:sans-serif;display:flex;justify-content:center;align-items:center;min-height:100vh;margin:0}
      .badge{border:2px solid #333;border-radius:16px;padding:24px;width:300px;text-align:center}
      .name{font-size:24px;font-weight:bold;margin:12px 0 4px}
      .hall{font-size:14px;color:#666;margin-bottom:12px}
      .qr{margin:8px auto;display:block}
      @media print{body{padding:0}.badge{border:1px solid #000}}</style></head>
      <body><div class="badge">
      <div class="name">${name}</div>
      ${r.hall ? `<div class="hall">🏛 ${r.hall}</div>` : ""}
      <img class="qr" src="${qrImg}" width="180" height="180" />
      </div>
      <script>window.onload=function(){var img=document.querySelector('.qr');if(img.complete){window.print()}else{img.onload=function(){window.print()}}}<\/script>
      </body></html>`);
    w.document.close();
  };

  const printAllBadges = () => {
    const list = selectedIds.size > 0 ? filtered.filter((r) => selectedIds.has(r.id)) : filtered;
    if (list.length === 0) return;
    const w = window.open("", "_blank");
    if (!w) return;
    const cards = list.map((r) => {
      const name = findName(r.answers) || r.id.slice(0, 8);
      const checkinUrl = buildPublicUrl(`/checkin/${r.id}`);
      const qrImg = buildPublicUrl(buildQrImagePath(checkinUrl, 140, qrBranding));
      return `<div class="badge">
        <div class="name">${name}</div>
        ${r.hall ? `<div class="hall">🏛 ${r.hall}</div>` : '<div class="hall"></div>'}
        <img class="qr" src="${qrImg}" width="140" height="140" />
      </div>`;
    }).join("");
    w.document.write(`<!DOCTYPE html><html><head><title>Badges (${list.length})</title>
      <style>
        body{font-family:sans-serif;margin:0;padding:8mm;display:grid;grid-template-columns:repeat(2,1fr);gap:6mm}
        .badge{border:1px dashed #999;border-radius:12px;padding:16px;text-align:center;break-inside:avoid;page-break-inside:avoid}
        .name{font-size:18px;font-weight:bold;margin:8px 0 2px}
        .hall{font-size:12px;color:#666;margin-bottom:8px;min-height:14px}
        .qr{margin:4px auto;display:block}
        @media print{.badge{border:1px solid #ccc}}
      </style></head>
      <body>${cards}
      <script>window.onload=function(){var imgs=document.querySelectorAll('.qr');var loaded=0;var total=imgs.length;function done(){loaded++;if(loaded>=total){setTimeout(function(){window.print()},300)}}imgs.forEach(function(im){if(im.complete){done()}else{im.onload=done;im.onerror=done}})}<\/script>
      </body></html>`);
    w.document.close();
  };

  return (
    <div className="min-h-dvh bg-slate-50">
      {/* Header */}
      <div className="glass sticky top-0 z-20 border-b border-[color:var(--border)] px-4 py-4">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <div className="mb-2 h-1.5 w-12 rounded-full" style={{ background: "linear-gradient(135deg, #0ea5e9, #06b6d4)" }} />
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Danh sách đăng ký</p>
              <h1 className="mt-1 text-xl sm:text-2xl font-bold text-slate-900 leading-snug break-words">{surveyTitle}</h1>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-sm sm:pt-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-sky-100 bg-sky-50 px-3 py-1 font-semibold text-sky-700"><Users size={14} /> {totalCount}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 font-semibold text-emerald-700"><UserCheck size={14} /> {checkedCount}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 font-semibold text-indigo-700">{checkinRate}%</span>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
            <button onClick={() => { setShowAddForm(true); setNewAnswers({}); }}
              className="admin-primary flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold transition-transform hover:scale-[1.01]">
              <Plus size={14} /> Thêm
            </button>
            <Link href={`/attendees/${surveyId}/import`}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
              <Upload size={14} /> Import CSV
            </Link>
            <button onClick={exportCSV}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
              <Download size={14} /> CSV
            </button>
            <button onClick={printAllBadges}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50">
              <Printer size={14} /> In thẻ
            </button>
            <button onClick={sendReminders} disabled={resending}
              className="flex shrink-0 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:opacity-50">
              <Mail size={14} /> {resending ? "Đang gửi..." : "Nhắc lịch"}
            </button>
            {emailFailedCount > 0 && (
              <button onClick={sendFailed} disabled={resending}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-700 transition-colors hover:bg-amber-100 disabled:opacity-50">
                <RotateCcw size={14} /> Gửi lại lỗi ({emailFailedCount})
              </button>
            )}
            {selectedIds.size > 0 && (
              <button onClick={sendSelected} disabled={resending}
                className="flex shrink-0 items-center gap-1.5 rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-100 disabled:opacity-50">
                <Mail size={14} /> Gửi cho đã chọn ({selectedIds.size})
              </button>
            )}
            <Link href={`/scan/${surveyId}${hallFilter ? `?hall=${encodeURIComponent(hallFilter)}` : ""}`} target="_blank"
              className="flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-on-brand transition-transform hover:scale-[1.01]"
              style={{ background: "linear-gradient(135deg, #6366f1, #4f46e5)" }}>
              <QrCode size={14} /> Scan
            </Link>
            {vipCheckinEnabled && (
              <Link href={`/face-checkin/${surveyId}${hallFilter ? `?hall=${encodeURIComponent(hallFilter)}` : ""}`} target="_blank"
                className="flex shrink-0 items-center gap-1.5 rounded-xl px-3.5 py-2 text-sm font-semibold text-on-brand transition-transform hover:scale-[1.01]"
                style={{ background: "linear-gradient(135deg, #0ea5e9, #0891b2)" }}>
                <ShieldCheck size={14} /> VIP Face
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4">
        {/* Detailed stats: by hall + by hour */}
        {(hallStats.length > 0 || hourRange.length > 0) && (
          <div className="glass relative mb-4 overflow-hidden rounded-2xl">
            <div className="absolute inset-x-0 top-0 h-1" style={{ background: "linear-gradient(90deg, #0ea5e9, #06b6d400)" }} />
            <button onClick={() => setShowStats((s) => !s)}
              className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-white/50">
              <span className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                <BarChart3 size={15} className="text-sky-500" /> Thống kê chi tiết
                <span className="text-xs font-normal text-slate-400">{checkedCount}/{totalCount} đã check-in</span>
              </span>
              <span className="text-xs text-slate-400">{showStats ? "▲" : "▼"}</span>
            </button>
            <AnimatePresence>
              {showStats && (
                <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                  <div className="px-4 pb-4">
                    {hallStats.length > 0 && (
                      <div className="space-y-2">
                        <p className="text-[11px] font-medium text-slate-600">Theo hội trường</p>
                        {hallStats.map((h) => (
                          <div key={h.hall}>
                            <div className="flex items-center justify-between text-[11px] mb-1">
                              <span className="text-slate-600 font-medium">🏛 {h.hall}</span>
                              <span className="text-slate-500">{h.checked}/{h.total}</span>
                            </div>
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full rounded-full" style={{ width: `${h.total > 0 ? (h.checked / h.total) * 100 : 0}%`, background: "linear-gradient(90deg, #6366f1, #8b5cf6)" }} />
                            </div>
                          </div>
                        ))}
                      </div>
                    )}

                    {hourRange.length > 0 && (
                      <div className={hallStats.length > 0 ? "mt-4 border-t border-slate-100 pt-3" : ""}>
                        <p className="text-[11px] font-medium text-slate-600 mb-2">Check-in theo giờ</p>
                        <div className="flex items-end gap-1 h-16">
                          {hourRange.map((h) => {
                            const count = hourBuckets[h] || 0;
                            return (
                              <div key={h} className="flex-1 flex flex-col items-center gap-1">
                                <div className="w-full rounded-t" style={{ height: `${count > 0 ? (count / maxHourCount) * 100 : 5}%`, minHeight: "2px", background: count > 0 ? "linear-gradient(180deg, #818cf8, #6366f1)" : "#e2e8f0" }} title={`${count} người`} />
                                <span className="text-[9px] text-slate-400">{h}h</span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        )}

        {/* Sessions panel */}
        {sessionsEnabled && (
        <div className="glass relative mb-4 overflow-hidden rounded-2xl">
          <div className="absolute inset-x-0 top-0 h-1" style={{ background: "linear-gradient(90deg, #6366f1, #6366f100)" }} />
          <button onClick={() => setShowSessions((s) => !s)}
            className="flex w-full items-center justify-between px-4 py-3 transition-colors hover:bg-white/50">
            <span className="text-sm font-semibold text-slate-700 flex items-center gap-2">🕐 Điểm danh nhiều buổi {sessions.length > 0 && <span className="text-xs text-slate-400">({sessions.length} buổi)</span>}</span>
            <span className="text-slate-400 text-xs">{showSessions ? "▲" : "▼"}</span>
          </button>
          <AnimatePresence>
            {showSessions && (
              <motion.div initial={{ height: 0 }} animate={{ height: "auto" }} exit={{ height: 0 }} className="overflow-hidden">
                <div className="px-4 pb-4 space-y-2">
                  <p className="text-xs text-slate-500">Mỗi buổi có link quét riêng. Người tham dự check-in lại từng buổi (dùng cho CME cấp giờ tham dự).</p>
                  {sessions.map((s) => {
                    const checkedInSession = responses.filter((r) => r.session_checkins?.[s]).length;
                    const scanUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/scan/${surveyId}?session=${encodeURIComponent(s)}`;
                    return (
                      <div key={s} className="flex items-center gap-2 p-2.5 rounded-lg bg-slate-50">
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-slate-800 truncate">{s}</p>
                          <p className="text-[11px] text-slate-500">{checkedInSession}/{totalCount} đã điểm danh</p>
                        </div>
                        <button onClick={() => { navigator.clipboard.writeText(scanUrl); toast.success("Đã copy link quét buổi này!"); }}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-slate-700 bg-white border border-slate-200 hover:bg-slate-100">Copy link</button>
                        <a href={scanUrl} target="_blank" rel="noopener noreferrer"
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-medium text-on-brand bg-indigo-600 hover:bg-indigo-500">Mở scan</a>
                        <button onClick={() => removeSession(s)} className="px-2 py-1.5 rounded-lg text-red-600 hover:bg-red-50"><Trash2 size={12} /></button>
                      </div>
                    );
                  })}
                  <button onClick={addSession} className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-indigo-600 bg-indigo-50 hover:bg-indigo-100 transition-colors">
                    <Plus size={14} /> Thêm buổi
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
        )}

        {/* Add new form */}
        <AnimatePresence>
          {showAddForm && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-4">
              <div className="glass rounded-2xl border border-emerald-200 p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-800">Thêm người mới</h3>
                  <button onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {questionOrder.map((k) => (
                    <div key={k}>
                      <label className="text-[11px] text-slate-500 mb-0.5 block">{questionLabels[k]}</label>
                      <input value={newAnswers[k] ?? ""} onChange={(e) => setNewAnswers({ ...newAnswers, [k]: e.target.value })}
                        className="admin-field w-full rounded-lg px-3 py-2 text-sm focus:outline-none" />
                    </div>
                  ))}
                </div>
                <button onClick={addNew} className="mt-3 px-4 py-2 rounded-lg bg-sky-600 text-on-brand text-sm font-medium hover:bg-sky-500 transition-colors">
                  <Plus size={14} className="inline mr-1" /> Thêm vào danh sách
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Search + filters */}
        <div className="mb-4 space-y-2">
          <div className="flex flex-col gap-2 lg:flex-row">
            <div className="relative flex-1">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input value={search} onChange={(e) => setSearch(e.target.value)}
                placeholder="Tìm theo tên, SĐT, email, tỉnh thành..."
                className="admin-field w-full rounded-xl py-3 pl-10 pr-4 text-sm focus:outline-none" />
            </div>
            <div className="flex gap-2">
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
                className="admin-dark-select admin-field min-w-44 flex-1 rounded-xl px-3 py-3 text-sm focus:outline-none lg:flex-none">
                <option value="newest">Mới nhất</option>
                <option value="oldest">Cũ nhất</option>
                <option value="name">Tên A-Z</option>
                <option value="checkin">Chưa check-in trước</option>
                <option value="hall">Theo hội trường</option>
              </select>
              {halls.length > 0 && (
                <select value={hallFilter} onChange={(e) => setHallFilter(e.target.value)}
                  className="admin-dark-select admin-field min-w-44 flex-1 rounded-xl px-3 py-3 text-sm focus:outline-none lg:flex-none">
                  <option value="">Tất cả hội trường</option>
                  {halls.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              )}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {([
              { value: "all", label: `Tất cả (${totalCount})` },
              { value: "checked", label: `Đã check-in (${checkedCount})` },
              { value: "unchecked", label: `Chưa check-in (${uncheckedCount})` },
              { value: "payment_pending", label: `Chờ thanh toán (${pendingPaymentCount})` },
              { value: "email_failed", label: `Email lỗi (${emailFailedCount})` },
            ] as const).map((option) => (
              <button
                key={option.value}
                onClick={() => setStatusFilter(option.value)}
                className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors ${
                  statusFilter === option.value
                    ? "border-sky-300 bg-sky-500 text-on-brand"
                    : "border-slate-200 bg-white text-slate-600 hover:border-sky-200 hover:text-sky-700"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
        </div>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="glass-strong mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-indigo-200 px-4 py-2.5">
            <span className="text-sm font-semibold text-indigo-700">{selectedIds.size} đã chọn</span>
            <button onClick={bulkCheckin} className="rounded-lg bg-sky-500 px-3 py-1.5 text-xs font-semibold text-on-brand hover:bg-sky-400">Check-in tất cả</button>
            <button onClick={() => {
              const name = prompt("Tên hội trường:");
              if (name) bulkAssignHall(name);
            }} className="rounded-lg px-3 py-1.5 text-xs font-semibold text-on-brand" style={{ background: "linear-gradient(135deg, #6366f1, #4f46e5)" }}>Gán hội trường</button>
            <button onClick={printAllBadges} className="rounded-lg bg-slate-700 px-3 py-1.5 text-xs font-semibold text-on-brand hover:bg-slate-600">In thẻ đã chọn</button>
            <button onClick={bulkDelete} className="rounded-lg border border-red-200 bg-red-50 px-3 py-1.5 text-xs font-semibold text-red-600 hover:bg-red-100">Xoá đã chọn</button>
            <button onClick={clearSelection} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Bỏ chọn</button>
            <button onClick={selectAll} className="rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">Chọn tất cả</button>
          </div>
        )}

        {/* List */}
        <div className="glass-strong divide-y divide-[color:var(--border)] overflow-hidden rounded-2xl">
          {filtered.map((r) => {
            const name = findName(r.answers) || r.id.slice(0, 8).toUpperCase();
            const time = new Date(r.submitted_at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
            const rowTone = selectedIds.has(r.id)
              ? "bg-sky-50/80 hover:bg-sky-50"
              : "bg-transparent hover:bg-sky-50/50";

            return (
              <div key={r.id} className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${rowTone}`}>
                <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="h-4 w-4 flex-shrink-0 rounded border-slate-300 text-sky-600 focus:ring-sky-500" />
                <div className="flex-1 min-w-0 flex items-center gap-3" onClick={() => { void openDetail(r); }}>
                  <div className={`w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 ${r.checked_in ? "bg-emerald-100" : "bg-slate-100"}`}>
                    {r.checked_in ? <UserCheck size={16} className="text-emerald-600" /> : <Users size={16} className="text-slate-400" />}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{name}{r.hall && <span className="text-xs text-indigo-500 ml-2">🏛 {r.hall}</span>}</p>
                    <p className="text-xs text-slate-500">
                      {time}
                      {r.checked_in_at && <span className="text-emerald-600 ml-2">✓ {new Date(r.checked_in_at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span>}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <PaymentStatusBadge response={r} compact />
                      <EmailStatusBadge response={r} compact />
                    </div>
                  </div>
                </div>
                {!r.checked_in ? (
                  <button
                    onClick={(e) => { e.stopPropagation(); doCheckin(r.id); }}
                    disabled={!isPaymentSettled(r.payment_status)}
                    className="rounded-lg bg-sky-500 px-2.5 py-1.5 text-xs font-semibold text-on-brand hover:bg-sky-400 disabled:cursor-not-allowed disabled:bg-slate-300"
                  >
                    Check-in
                  </button>
                ) : (
                  <span className="text-emerald-600 text-xs font-semibold">✓</span>
                )}
              </div>
            );
          })}
          {filtered.length === 0 && (
            <div className="flex flex-col items-center gap-2 py-12 text-center">
              <Users size={34} className="text-slate-300" />
              <p className="text-sm text-slate-500">Không có kết quả phù hợp</p>
            </div>
          )}
        </div>
      </div>

      {/* Detail/Edit Modal */}
      <AnimatePresence>
        {selectedResponse && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4"
            onClick={() => { setSelectedResponse(null); setEditingId(null); }}
          >
            <motion.div
              initial={{ scale: 0.95, opacity: 0 }}
              animate={{ scale: 1, opacity: 1 }}
              exit={{ scale: 0.95, opacity: 0 }}
              className="glass-strong rounded-2xl p-5 w-full max-w-lg shadow-2xl max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Status badges */}
              <div className="mb-3 flex flex-wrap gap-1.5">
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-semibold ${selectedResponse.checked_in ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                  {selectedResponse.checked_in ? <><UserCheck size={12} /> Đã check-in</> : <><Users size={12} /> Chưa check-in</>}
                </span>
                <PaymentStatusBadge response={selectedResponse} />
                <EmailStatusBadge response={selectedResponse} />
              </div>

              {/* Name */}
              <h2 className="text-xl font-bold text-slate-800 mb-4">
                {findName(selectedResponse.answers) || selectedResponse.id.slice(0, 8).toUpperCase()}
              </h2>

              {/* Fields */}
              <div className="space-y-3 mb-5">
                {questionOrder.map((k) => {
                  const meta = questionMeta[k];
                  const isChoice = meta?.type === "choice" && meta.options;
                  return (
                    <div key={k}>
                      <label className="text-xs text-slate-500 mb-1 block">
                        {questionLabels[k]}{meta?.isHall && <span className="text-indigo-500 ml-1">🏛</span>}
                      </label>
                      {editingId === selectedResponse.id ? (
                        isChoice ? (
                          <select
                            value={editAnswers[k] ?? ""}
                            onChange={(e) => setEditAnswers({ ...editAnswers, [k]: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 bg-white focus:outline-none focus:border-indigo-400"
                          >
                            <option value="">— Chọn —</option>
                            {meta!.options!.map((opt, oi) => (
                              <option key={oi} value={oi}>{opt}</option>
                            ))}
                          </select>
                        ) : (
                          <input
                            value={editAnswers[k] ?? ""}
                            onChange={(e) => setEditAnswers({ ...editAnswers, [k]: e.target.value })}
                            className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-indigo-400"
                          />
                        )
                      ) : (
                        <p className="text-sm text-slate-800 font-medium">
                          {(() => {
                            const v = selectedResponse.answers[k];
                            if (typeof v === "string" && v.startsWith("http")) return <a href={v} target="_blank" rel="noopener noreferrer" className="text-indigo-600 underline">Xem file</a>;
                            // Choice → show option label instead of raw index
                            if (isChoice) {
                              const idx = Array.isArray(v) ? v[0] : v;
                              const label = typeof idx === "number" ? meta!.options![idx] : undefined;
                              return label ?? <span className="text-slate-400 italic">—</span>;
                            }
                            return v != null && v !== "" ? String(v) : <span className="text-slate-400 italic">—</span>;
                          })()}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Timestamps */}
              <div className="text-xs text-slate-500 space-y-0.5 mb-4 border-t border-slate-100 pt-3">
                <p>Đăng ký: {new Date(selectedResponse.submitted_at).toLocaleString("vi-VN")}</p>
                {selectedResponse.paid_at && <p>Thanh toán: {new Date(selectedResponse.paid_at).toLocaleString("vi-VN")}</p>}
                {selectedResponse.checked_in_at && <p>Check-in: {new Date(selectedResponse.checked_in_at).toLocaleString("vi-VN")}</p>}
              </div>

              {selectedResponse.payment_status && selectedResponse.payment_status !== "not_required" && (
                <div className="mb-4 rounded-xl border border-cyan-100 bg-cyan-50/70 p-3">
                  <p className="mb-2 text-xs font-semibold text-cyan-800">Đối chiếu thanh toán</p>
                  <div className="space-y-1 text-xs text-slate-700">
                    <p><span className="text-slate-500">Tên đăng ký:</span> {findName(selectedResponse.answers) || "—"}</p>
                    <p><span className="text-slate-500">Tên tài khoản chuyển:</span> {selectedResponse.payment_payer_name || "Chưa có từ PayOS"}</p>
                    <p><span className="text-slate-500">Ngân hàng:</span> {selectedResponse.payment_payer_bank || "—"}</p>
                    <p><span className="text-slate-500">Số TK chuyển:</span> {selectedResponse.payment_payer_account || "—"}</p>
                    <p><span className="text-slate-500">Mã tham chiếu:</span> {selectedResponse.payment_reference || "—"}</p>
                    <p><span className="text-slate-500">Mã đơn PayOS:</span> {selectedResponse.payment_order_code || "—"}</p>
                    <p><span className="text-slate-500">Thời gian giao dịch:</span> {selectedResponse.payment_transaction_datetime || "—"}</p>
                  </div>
                </div>
              )}

              {selectedLogs.length > 0 && (
                <div className="mb-4 border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium text-slate-600 mb-2">Lịch sử check-in</p>
                  <div className="space-y-1.5">
                    {selectedLogs.map((log) => (
                      <div key={log.id} className="flex items-center justify-between rounded-lg bg-slate-50 px-2.5 py-2 text-xs">
                        <span className="font-medium text-slate-700">{formatLogLabel(log)}</span>
                        <span className="text-slate-400">{new Date(log.created_at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Session check-ins */}
              {sessionsEnabled && sessions.length > 0 && (
                <div className="mb-4 border-t border-slate-100 pt-3">
                  <p className="text-xs font-medium text-slate-600 mb-2">Điểm danh theo buổi (bấm để đổi)</p>
                  <div className="space-y-1.5">
                    {sessions.map((s) => {
                      const at = selectedResponse.session_checkins?.[s];
                      return (
                        <button key={s} onClick={() => toggleSession(selectedResponse, s)}
                          className="w-full flex items-center justify-between text-xs px-2.5 py-2 rounded-lg hover:bg-slate-50 transition-colors">
                          <span className="text-slate-600">{s}</span>
                          {at ? (
                            <span className="text-emerald-600 font-medium">✓ {new Date(at).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })}</span>
                          ) : (
                            <span className="text-slate-400">Chưa · bấm để điểm danh</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2">
                {editingId === selectedResponse.id ? (
                  <>
                    <button onClick={saveEdit} className="flex items-center gap-1 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-on-brand hover:bg-sky-400">
                      <Save size={14} /> Lưu
                    </button>
                    <button onClick={() => setEditingId(null)} className="rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">Huỷ</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => startEdit(selectedResponse)} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                      <Pencil size={14} /> Sửa
                    </button>
                    <button onClick={() => printBadge(selectedResponse)} className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50">
                      <Printer size={14} /> In QR
                    </button>
                    <button onClick={() => resendEmail(selectedResponse)} disabled={resending}
                      className="flex items-center gap-1 rounded-lg border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
                      <Mail size={14} /> {resending ? "Đang gửi..." : "Gửi lại QR"}
                    </button>
                    {!selectedResponse.checked_in ? (
                      <button onClick={() => { doCheckin(selectedResponse.id); setSelectedResponse({ ...selectedResponse, checked_in: true, checked_in_at: new Date().toISOString() }); }}
                        className="flex items-center gap-1 rounded-lg bg-sky-500 px-4 py-2 text-sm font-semibold text-on-brand hover:bg-sky-400">
                        <UserCheck size={14} /> Check-in
                      </button>
                    ) : (
                      <button onClick={() => { undoCheckin(selectedResponse.id); setSelectedResponse({ ...selectedResponse, checked_in: false, checked_in_at: null }); }}
                        className="flex items-center gap-1 rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 hover:bg-amber-100">
                        <RotateCcw size={14} /> Huỷ check-in
                      </button>
                    )}
                    <button onClick={() => { deleteResponse(selectedResponse.id); setSelectedResponse(null); }}
                      className="flex items-center gap-1 rounded-lg border border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-600 hover:bg-red-100">
                      <Trash2 size={14} /> Xoá
                    </button>
                  </>
                )}

                {/* Hall assignment */}
                {editingId !== selectedResponse.id && (
                  <div className="mt-1 flex w-full items-center gap-2 border-t border-slate-100 pt-3">
                    <span className="text-xs text-slate-500">Hội trường:</span>
                    <input
                      value={selectedResponse.hall ?? ""}
                      onChange={(e) => setSelectedResponse({ ...selectedResponse, hall: e.target.value })}
                      onBlur={async () => {
                        await supabase.from("survey_responses").update({ hall: selectedResponse.hall || null }).eq("id", selectedResponse.id);
                        setResponses((prev) => prev.map((r) => r.id === selectedResponse.id ? { ...r, hall: selectedResponse.hall } : r));
                        const h = selectedResponse.hall;
                        if (h && !halls.includes(h)) setHalls([...halls, h]);
                      }}
                      placeholder="Nhập tên..."
                      className="admin-field flex-1 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none"
                    />
                  </div>
                )}
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function isPaymentSettled(status: SurveyResponse["payment_status"]) {
  return !status || status === "not_required" || status === "paid";
}

function formatPaymentStatus(status: SurveyResponse["payment_status"]) {
  if (!status || status === "not_required") return "Không yêu cầu";
  if (status === "paid") return "Đã thanh toán";
  if (status === "pending") return "Chờ thanh toán";
  if (status === "cancelled") return "Đã huỷ";
  if (status === "expired") return "Hết hạn";
  return "Lỗi thanh toán";
}

function PaymentStatusBadge({ response, compact = false }: { response: SurveyResponse; compact?: boolean }) {
  const status = response.payment_status;
  if (!status || status === "not_required") return null;

  const className = compact ? "px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs font-medium";
  const amount = response.payment_amount
    ? new Intl.NumberFormat("vi-VN", { maximumFractionDigits: 0 }).format(response.payment_amount)
    : "";

  if (status === "paid") {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-cyan-50 text-cyan-700 ${className}`} title={amount ? `${amount} VND` : undefined}>
        <CreditCard size={compact ? 10 : 12} /> Đã thanh toán
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 ${className}`} title={amount ? `${amount} VND` : undefined}>
        <CreditCard size={compact ? 10 : 12} /> Chờ thanh toán
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 ${className}`} title={response.payment_error ?? undefined}>
      <CreditCard size={compact ? 10 : 12} /> {formatPaymentStatus(status)}
    </span>
  );
}

function EmailStatusBadge({ response, compact = false }: { response: SurveyResponse; compact?: boolean }) {
  const hasEmail = !!(response.email || Object.values(response.answers).find((v) => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)));
  if (!hasEmail) {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-500 ${compact ? "mt-1 px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs font-medium"}`}>
        <Mail size={compact ? 10 : 12} /> Không có email
      </span>
    );
  }

  const status = response.email_status;
  if (status === "sent") {
    if (response.email_bounced_at || response.email_last_event === "bounced") {
      return (
        <span className={`inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 ${compact ? "mt-1 px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs font-medium"}`}>
          <Mail size={compact ? 10 : 12} /> Không tới
        </span>
      );
    }
    if (response.email_opened_at || response.email_last_event === "opened") {
      return (
        <span className={`inline-flex items-center gap-1 rounded-full bg-teal-50 text-teal-700 ${compact ? "mt-1 px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs font-medium"}`}>
          <Mail size={compact ? 10 : 12} /> Đã mở
        </span>
      );
    }
    if (response.email_delivered_at || response.email_last_event === "delivered") {
      return (
        <span className={`inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 ${compact ? "mt-1 px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs font-medium"}`}>
          <Mail size={compact ? 10 : 12} /> Đã nhận
        </span>
      );
    }
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-emerald-50 text-emerald-700 ${compact ? "mt-1 px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs font-medium"}`}>
        <Mail size={compact ? 10 : 12} /> Đã gửi QR
      </span>
    );
  }

  if (status === "failed") {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-red-50 text-red-700 ${compact ? "mt-1 px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs font-medium"}`} title={response.email_error ?? undefined}>
        <Mail size={compact ? 10 : 12} /> Lỗi gửi QR
      </span>
    );
  }

  if (status === "pending") {
    return (
      <span className={`inline-flex items-center gap-1 rounded-full bg-amber-50 text-amber-700 ${compact ? "mt-1 px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs font-medium"}`}>
        <Mail size={compact ? 10 : 12} /> Đang chờ gửi
      </span>
    );
  }

  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-slate-100 text-slate-500 ${compact ? "mt-1 px-1.5 py-0.5 text-[10px]" : "px-2.5 py-1 text-xs font-medium"}`}>
      <Mail size={compact ? 10 : 12} /> Chưa gửi QR
    </span>
  );
}

function formatLogLabel(log: CheckinLog) {
  const actionLabel: Record<CheckinLog["action"], string> = {
    checkin: "Check-in",
    undo_checkin: "Huỷ check-in",
    session_checkin: "Điểm danh buổi",
    session_uncheckin: "Huỷ điểm danh buổi",
  };
  const methodLabel: Record<CheckinLog["method"], string> = {
    qr: "QR",
    face: "Face",
    manual: "Thủ công",
    bulk: "Hàng loạt",
  };

  const extra = log.session_name || log.hall;
  return `${actionLabel[log.action]} · ${methodLabel[log.method]}${extra ? ` · ${extra}` : ""}`;
}


