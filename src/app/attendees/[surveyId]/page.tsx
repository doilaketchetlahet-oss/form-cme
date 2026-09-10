"use client";
import { useEffect, useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Users, UserCheck, Search, QrCode, Trash2, RotateCcw, Download, Plus, Save, X, Pencil, Printer, CheckSquare, Mail, ShieldCheck, Upload, CreditCard } from "lucide-react";
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
  const [surveyTitle, setSurveyTitle] = useState("");
  const [responses, setResponses] = useState<SurveyResponse[]>([]);
  const [questionLabels, setQuestionLabels] = useState<Record<string, string>>({});
  const [questionOrder, setQuestionOrder] = useState<string[]>([]);
  const [questionMeta, setQuestionMeta] = useState<Record<string, { type: string; options: string[] | null; isHall: boolean }>>({});
  const [search, setSearch] = useState("");
  const [sortBy, setSortBy] = useState<"newest" | "oldest" | "name" | "checkin" | "hall">("newest");
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
      alert("Người này chưa hoàn tất thanh toán, chưa thể check-in.");
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
    if (!confirm("Xoá người này?")) return;
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
    const patch: Record<string, unknown> = { answers: finalAnswers };
    if (derivedHall !== undefined) patch.hall = derivedHall;

    await supabase.from("survey_responses").update(patch).eq("id", editingId);
    setResponses((prev) => prev.map((r) => r.id === editingId
      ? { ...r, answers: finalAnswers, ...(derivedHall !== undefined ? { hall: derivedHall } : {}) }
      : r));
    if (selectedResponse?.id === editingId) {
      setSelectedResponse({ ...selectedResponse, answers: finalAnswers, ...(derivedHall !== undefined ? { hall: derivedHall } : {}) });
    }
    setEditingId(null);
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
      alert("Các dòng đã chọn đều chưa hoàn tất thanh toán.");
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
    if (!confirm(`Xoá ${ids.length} người đã chọn? Thao tác này không thể hoàn tác.`)) return;

    const { error } = await supabase.from("survey_responses").delete().in("id", ids);
    if (error) {
      alert(`Xoá thất bại: ${error.message}`);
      return;
    }

    setResponses((prev) => prev.filter((r) => !ids.includes(r.id)));
    setSelectedIds(new Set());
    setSelectedResponse((current) => current && ids.includes(current.id) ? null : current);
  };

  const resendEmail = async (r: SurveyResponse) => {
    const email = findEmail(r);
    if (!email) { alert("Không tìm thấy email của người này."); return; }
    setResending(true);
    const res = await fetch("/api/send-checkin-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: email,
        name: findName(r.answers) || "",
        checkinUrl: buildPublicUrl(`/checkin/${r.id}`),
        surveyTitle,
        responseId: r.id,
        qrStyle: qrBranding,
      }),
    });
    setResending(false);
    if (res.ok) {
      await markEmailStatus(r.id, "sent");
      alert(`Đã gửi lại QR đến ${email}`);
      return;
    }
    const body = await res.json().catch(() => null);
    await markEmailStatus(r.id, "failed", body?.detail || body?.error || "Gửi thất bại");
    alert("Gửi thất bại. Thử lại.");
  };

  const sendReminders = async () => {
    const targets = responses
      .map((r) => ({ r, email: findEmail(r) }))
      .filter((t) => t.email);
    if (targets.length === 0) { alert("Không có ai có email."); return; }
    if (!confirm(`Gửi email nhắc lịch đến ${targets.length} người? (Resend free: tối đa 100 email/ngày)`)) return;
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
            mode: "reminder",
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
    alert(`Đã gửi ${sent} email nhắc lịch.${failed > 0 ? ` ${failed} thất bại.` : ""}`);
  };

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
      <div className="bg-white border-b border-slate-200 px-4 py-4 sticky top-0 z-10 shadow-sm shadow-slate-200/40">
        <div className="max-w-6xl mx-auto">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-400">Danh sách đăng ký</p>
              <h1 className="mt-1 text-xl sm:text-2xl font-bold text-slate-900 leading-snug break-words">{surveyTitle}</h1>
            </div>
            <div className="flex items-center gap-2 text-sm text-slate-600 sm:pt-1">
              <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-3 py-1 font-medium"><Users size={14} /> {totalCount}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1 text-emerald-700 font-semibold"><UserCheck size={14} /> {checkedCount}</span>
            </div>
          </div>
          <div className="mt-4 flex items-center gap-2 overflow-x-auto pb-1 sm:flex-wrap sm:overflow-visible">
            <button onClick={() => { setShowAddForm(true); setNewAnswers({}); }}
              className="flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 text-on-brand text-sm font-medium hover:bg-sky-500 transition-colors">
              <Plus size={14} /> Thêm
            </button>
            <Link href={`/attendees/${surveyId}/import`}
              className="flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-medium transition-colors hover:bg-slate-200">
              <Upload size={14} /> Import CSV
            </Link>
            <button onClick={exportCSV}
              className="flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors">
              <Download size={14} /> CSV
            </button>
            <button onClick={printAllBadges}
              className="flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors">
              <Printer size={14} /> In thẻ
            </button>
            <button onClick={sendReminders} disabled={resending}
              className="flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-xl bg-slate-100 text-slate-700 text-sm font-medium hover:bg-slate-200 transition-colors disabled:opacity-50">
              <Mail size={14} /> {resending ? "Đang gửi..." : "Nhắc lịch"}
            </button>
            <Link href={`/scan/${surveyId}${hallFilter ? `?hall=${encodeURIComponent(hallFilter)}` : ""}`} target="_blank"
              className="flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-xl bg-indigo-600 text-on-brand text-sm font-medium hover:bg-indigo-500 transition-colors">
              <QrCode size={14} /> Scan
            </Link>
            {vipCheckinEnabled && (
              <Link href={`/face-checkin/${surveyId}${hallFilter ? `?hall=${encodeURIComponent(hallFilter)}` : ""}`} target="_blank"
                className="flex shrink-0 items-center gap-1.5 px-3 py-2 rounded-xl bg-sky-600 text-on-brand text-sm font-medium hover:bg-sky-500 transition-colors">
                <ShieldCheck size={14} /> VIP Face
              </Link>
            )}
          </div>
        </div>
      </div>

      <div className="max-w-6xl mx-auto px-4 py-4">
        {/* Stats dashboard */}
        <div className="grid grid-cols-3 gap-3 mb-4">
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <p className="text-2xl font-bold text-slate-800">{totalCount}</p>
            <p className="text-xs text-slate-500 mt-0.5">Tổng đăng ký</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <p className="text-2xl font-bold text-emerald-600">{checkedCount}</p>
            <p className="text-xs text-slate-500 mt-0.5">Đã check-in</p>
          </div>
          <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm">
            <p className="text-2xl font-bold text-indigo-600">{checkinRate}%</p>
            <p className="text-xs text-slate-500 mt-0.5">Tỷ lệ</p>
          </div>
        </div>

        {/* Progress bar */}
        <div className="bg-white rounded-2xl border border-slate-200 p-4 shadow-sm mb-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-600">Tiến độ check-in</span>
            <span className="text-xs text-slate-500">{checkedCount}/{totalCount}</span>
          </div>
          <div className="h-2.5 bg-slate-100 rounded-full overflow-hidden">
            <motion.div className="h-full bg-gradient-to-r from-sky-500 to-cyan-500 rounded-full"
              initial={{ width: 0 }} animate={{ width: `${checkinRate}%` }} transition={{ duration: 0.5 }} />
          </div>

          {/* Hall breakdown */}
          {hallStats.length > 0 && (
            <div className="mt-4 space-y-2">
              {hallStats.map((h) => (
                <div key={h.hall}>
                  <div className="flex items-center justify-between text-[11px] mb-1">
                    <span className="text-slate-600 font-medium">🏛 {h.hall}</span>
                    <span className="text-slate-500">{h.checked}/{h.total}</span>
                  </div>
                  <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                    <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${h.total > 0 ? (h.checked / h.total) * 100 : 0}%` }} />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Check-in by hour */}
          {hourRange.length > 0 && (
            <div className="mt-4 pt-3 border-t border-slate-100">
              <p className="text-[11px] font-medium text-slate-600 mb-2">Check-in theo giờ</p>
              <div className="flex items-end gap-1 h-16">
                {hourRange.map((h) => {
                  const count = hourBuckets[h] || 0;
                  return (
                    <div key={h} className="flex-1 flex flex-col items-center gap-1">
                      <div className={`w-full rounded-t ${count > 0 ? "bg-indigo-500" : "bg-slate-100"}`} style={{ height: `${count > 0 ? (count / maxHourCount) * 100 : 5}%`, minHeight: "2px" }} title={`${count} người`} />
                      <span className="text-[9px] text-slate-400">{h}h</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Sessions panel */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm mb-4 overflow-hidden">
          <button onClick={() => setShowSessions((s) => !s)}
            className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors">
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
                        <button onClick={() => { navigator.clipboard.writeText(scanUrl); alert("Đã copy link quét buổi này!"); }}
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

        {/* Add new form */}
        <AnimatePresence>
          {showAddForm && (
            <motion.div initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} className="overflow-hidden mb-4">
              <div className="bg-white rounded-2xl border border-emerald-200 p-4 shadow-sm">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-bold text-slate-800">Thêm người mới</h3>
                  <button onClick={() => setShowAddForm(false)} className="text-slate-400 hover:text-slate-600"><X size={16} /></button>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  {questionOrder.map((k) => (
                    <div key={k}>
                      <label className="text-[11px] text-slate-500 mb-0.5 block">{questionLabels[k]}</label>
                      <input value={newAnswers[k] ?? ""} onChange={(e) => setNewAnswers({ ...newAnswers, [k]: e.target.value })}
                        className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-indigo-400" />
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

        {/* Search + Hall filter */}
        <div className="flex flex-col gap-2 mb-4 lg:flex-row">
          <div className="relative flex-1">
            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
            <input value={search} onChange={(e) => setSearch(e.target.value)}
              placeholder="Tìm theo tên, SĐT, tỉnh thành..."
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 text-sm bg-white focus:outline-none focus:border-indigo-400 shadow-sm" />
          </div>
          <div className="flex gap-2">
            <select value={sortBy} onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
              className="min-w-44 flex-1 px-3 py-3 rounded-xl border border-slate-200 text-sm bg-white text-slate-800 focus:outline-none focus:border-indigo-400 lg:flex-none">
              <option value="newest">Mới nhất</option>
              <option value="oldest">Cũ nhất</option>
              <option value="name">Tên A-Z</option>
              <option value="checkin">Chưa check-in trước</option>
              <option value="hall">Theo hội trường</option>
            </select>
            {halls.length > 0 && (
              <select value={hallFilter} onChange={(e) => setHallFilter(e.target.value)}
                className="min-w-44 flex-1 px-3 py-3 rounded-xl border border-slate-200 text-sm bg-white text-slate-800 focus:outline-none focus:border-indigo-400 lg:flex-none">
                <option value="">Tất cả hội trường</option>
                {halls.map((h) => <option key={h} value={h}>{h}</option>)}
              </select>
            )}
          </div>
        </div>

        {/* Bulk actions */}
        {selectedIds.size > 0 && (
          <div className="mb-3 flex items-center gap-2 flex-wrap bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-2.5">
            <span className="text-sm font-medium text-indigo-700">{selectedIds.size} đã chọn</span>
            <button onClick={bulkCheckin} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-sky-600 text-on-brand hover:bg-sky-500">Check-in tất cả</button>
            <button onClick={() => {
              const name = prompt("Tên hội trường:");
              if (name) bulkAssignHall(name);
            }} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-on-brand hover:bg-indigo-500">Gán hội trường</button>
<button onClick={printAllBadges} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-slate-700 text-on-brand hover:bg-slate-600">In thẻ đã chọn</button>
            <button onClick={bulkDelete} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600 text-on-brand hover:bg-red-500">Xoá đã chọn</button>
            <button onClick={clearSelection} className="px-3 py-1.5 rounded-lg text-xs text-slate-600 bg-white border border-slate-200 hover:bg-slate-50">Bỏ chọn</button>
            <button onClick={selectAll} className="px-3 py-1.5 rounded-lg text-xs text-slate-600 bg-white border border-slate-200 hover:bg-slate-50">Chọn tất cả</button>
          </div>
        )}

        {/* List */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm divide-y divide-slate-100 overflow-hidden">
          {filtered.map((r, index) => {
            const name = findName(r.answers) || r.id.slice(0, 8).toUpperCase();
            const time = new Date(r.submitted_at).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" });
            const rowTone = selectedIds.has(r.id)
              ? "bg-indigo-50 hover:bg-indigo-100/70"
              : index % 2 === 0
                ? "bg-white hover:bg-slate-50"
                : "bg-cyan-50/45 hover:bg-cyan-50";

            return (
              <div key={r.id} className={`flex items-center gap-3 px-4 py-3 cursor-pointer transition-colors ${rowTone}`}>
                <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSelect(r.id)}
                  onClick={(e) => e.stopPropagation()}
                  className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 flex-shrink-0" />
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
                    className="px-2.5 py-1.5 rounded-lg text-xs font-medium bg-indigo-600 text-on-brand hover:bg-indigo-500 disabled:cursor-not-allowed disabled:bg-slate-300"
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
            <p className="text-center text-sm text-slate-500 py-8">Không có kết quả</p>
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
              className="bg-white rounded-2xl p-5 w-full max-w-md shadow-2xl max-h-[85vh] overflow-y-auto"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Status badge */}
              <div className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium mb-3 ${selectedResponse.checked_in ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-600"}`}>
                {selectedResponse.checked_in ? <><UserCheck size={12} /> Đã check-in</> : <><Users size={12} /> Chưa check-in</>}
              </div>
              <div className="mb-3">
                <PaymentStatusBadge response={selectedResponse} />
              </div>
              <div className="mb-3">
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
              {sessions.length > 0 && (
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
                    <button onClick={saveEdit} className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium bg-indigo-600 text-on-brand hover:bg-indigo-500">
                      <Save size={14} /> Lưu
                    </button>
                    <button onClick={() => setEditingId(null)} className="px-4 py-2 rounded-lg text-sm text-slate-600 bg-slate-100 hover:bg-slate-200">Huỷ</button>
                  </>
                ) : (
                  <>
                    <button onClick={() => startEdit(selectedResponse)} className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200">
                      <Pencil size={14} /> Sửa
                    </button>
                    <button onClick={() => printBadge(selectedResponse)} className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200">
                      <Printer size={14} /> In QR
                    </button>
                    <button onClick={() => resendEmail(selectedResponse)} disabled={resending}
                      className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium text-slate-700 bg-slate-100 hover:bg-slate-200 disabled:opacity-50">
                      <Mail size={14} /> {resending ? "Đang gửi..." : "Gửi lại QR"}
                    </button>
                    {!selectedResponse.checked_in ? (
                      <button onClick={() => { doCheckin(selectedResponse.id); setSelectedResponse({ ...selectedResponse, checked_in: true, checked_in_at: new Date().toISOString() }); }}
                        className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium bg-sky-600 text-on-brand hover:bg-sky-500">
                        <UserCheck size={14} /> Check-in
                      </button>
                    ) : (
                      <button onClick={() => { undoCheckin(selectedResponse.id); setSelectedResponse({ ...selectedResponse, checked_in: false, checked_in_at: null }); }}
                        className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium text-amber-700 bg-amber-50 hover:bg-amber-100">
                        <RotateCcw size={14} /> Huỷ check-in
                      </button>
                    )}
                    <button onClick={() => { deleteResponse(selectedResponse.id); setSelectedResponse(null); }}
                      className="flex items-center gap-1 px-4 py-2 rounded-lg text-sm font-medium text-red-700 bg-red-50 hover:bg-red-100">
                      <Trash2 size={14} /> Xoá
                    </button>
                  </>
                )}

                {/* Hall assignment */}
                {editingId !== selectedResponse.id && (
                  <div className="mt-3 pt-3 border-t border-slate-100 flex items-center gap-2">
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
                      className="flex-1 px-2.5 py-1.5 rounded-lg border border-slate-200 text-sm text-slate-800 focus:outline-none focus:border-indigo-400"
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


