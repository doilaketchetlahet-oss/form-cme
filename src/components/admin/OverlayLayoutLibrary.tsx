"use client";

import { useState } from "react";
import { FolderOpen, Loader2, RefreshCw, Save } from "lucide-react";
import { supabase } from "@/lib/supabase";
import { parseEmailTemplate, serializeEmailTemplate, type EmailOverlay } from "@/lib/email-template";
import { applyOverlayLayout, validateReusableLayout, type SavedOverlayLayout } from "@/lib/overlay-layouts";
import { getInvitePdfPages } from "@/lib/invite-pdf";
import { useConfirm } from "@/lib/ui/confirm";

async function templatesApi(payload?: { name: string; body: string }) {
  const { data } = await supabase.auth.getSession();
  if (!data.session?.access_token) throw new Error("Bạn cần đăng nhập lại.");
  const response = await fetch("/api/admin/email-templates", {
    method: payload ? "POST" : "GET", headers: { Authorization: `Bearer ${data.session.access_token}`, ...(payload ? { "Content-Type": "application/json" } : {}) },
    ...(payload ? { body: JSON.stringify(payload) } : {}), cache: "no-store",
  });
  const result = await response.json().catch(() => null);
  if (!response.ok || !result?.ok) throw new Error(result?.error ?? "Không truy cập được kho bố cục.");
  return result;
}

export function OverlayLayoutLibrary({ overlay, title, savedLetters = [], disabled, onApply }: {
  overlay: EmailOverlay | null; title: string; savedLetters?: SavedOverlayLayout[]; disabled: boolean;
  onApply: (overlay: EmailOverlay) => void;
}) {
  const confirm = useConfirm();
  const [layouts, setLayouts] = useState<SavedOverlayLayout[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState("");
  const [selected, setSelected] = useState("");
  const [mode, setMode] = useState<"positions" | "full">("positions");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const options = [...layouts.map(layout => ({ ...layout, id: `layout:${layout.id}` })), ...savedLetters.map(layout => ({ ...layout, id: `letter:${layout.id}` }))].filter(layout => {
    try { validateReusableLayout(layout.overlay); return true; } catch { return false; }
  });
  const chosen = options.find(option => option.id === selected);
  const refresh = async () => {
    if (busy || disabled) return;
    setBusy(true); setError("");
    try {
      const result = await templatesApi();
      const next: SavedOverlayLayout[] = (result.templates ?? []).flatMap((item: { id: string; name: string; body: string }) => {
        const saved = parseEmailTemplate(item.body).overlay;
        if (!saved) return [];
        try { validateReusableLayout(saved); return [{ id: item.id, name: item.name, overlay: saved }]; } catch { return []; }
      });
      setLayouts(next); setLoaded(true);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không tải được bố cục."); }
    finally { setBusy(false); }
  };
  const save = async () => {
    if (!overlay || disabled || busy || !name.trim()) return;
    setBusy(true); setError(""); setMessage("");
    try {
      validateReusableLayout(overlay);
      const result = await templatesApi({ name: name.trim(), body: serializeEmailTemplate({ v: 1, mode: "overlay", includeBlocks: false, includeOverlay: true, blocks: [], overlay, attachments: [] }) });
      setLayouts(previous => [{ id: result.id, name: name.trim(), overlay: structuredClone(overlay) }, ...previous]);
      setSelected(`layout:${result.id}`);
      setMessage(`Đã lưu bố cục “${name.trim()}” vào Kho template. Có thể nạp lại ở thư hoặc sự kiện khác.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không lưu được bố cục."); }
    finally { setBusy(false); }
  };
  const apply = async () => {
    if (!chosen || disabled || busy) return;
    setError(""); setMessage("");
    try {
      const next = applyOverlayLayout(overlay, chosen.overlay, mode);
      if (overlay && Object.values(getInvitePdfPages(overlay)).some(page => page.fields.length) && !await confirm({ title: "Nạp bố cục đã lưu?", description: mode === "full" ? "Nền thiệp và các trường hiện tại sẽ được thay bằng bản sao của mẫu đã chọn." : "Các trường sẽ được thay bằng bố cục đã chọn; nền thiệp hiện tại được giữ lại.", confirmText: "Nạp bố cục", cancelText: "Hủy" })) return;
      onApply(next);
      setMessage(`Đã nạp “${chosen.name}”. Kiểm tra trường dữ liệu và vị trí trước khi lưu thư.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Không nạp được bố cục."); }
  };
  const field = "admin-field mt-1 min-h-11 w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm";
  const button = "inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-sky-200 bg-white px-3 py-2 text-sm font-semibold text-sky-800 hover:bg-sky-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-sky-600 disabled:opacity-50";
  return <details className="rounded-xl border border-sky-100 bg-sky-50/60 p-3" onToggle={event => { if (event.currentTarget.open && !loaded && !busy && !disabled) void refresh(); }}>
    <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-sky-800">Lưu / nạp bố cục dùng lại</summary>
    <div className="mt-2 space-y-4">
      <p className="text-sm text-slate-600">Lưu riêng bố cục tên/QR để dùng cho thư khác. Kho này dùng chung với Kho template.</p>
      {busy && <p role="status" className="text-sm text-sky-800">Đang truy cập kho bố cục…</p>}
      <div className="flex flex-wrap items-end gap-2">
        <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">Tên bố cục<input className={field} value={name} placeholder={`${title || "Thiệp mời"} · Bố cục tên/QR`} maxLength={160} disabled={busy || disabled} onChange={event => setName(event.target.value)} /></label>
        <button type="button" className={button} disabled={busy || disabled || !overlay || !name.trim()} onClick={() => void save()}><Save size={16} aria-hidden="true" />Lưu bố cục mới</button>
      </div>
      <div className="space-y-3 border-t border-sky-100 pt-3">
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-0 flex-1 text-sm font-medium text-slate-700">Bố cục hoặc thư đã lưu<select aria-label="Bố cục hoặc thư đã lưu" className={field} value={selected} disabled={busy || disabled} onChange={event => setSelected(event.target.value)}>
            <option value="">Chọn mẫu để nạp lại…</option>
            <optgroup label="Kho template">{layouts.map(layout => <option key={layout.id} value={`layout:${layout.id}`}>{layout.name}</option>)}</optgroup>
            {!!savedLetters.length && <optgroup label="Thiệp từ chiến dịch đã lưu">{savedLetters.map(layout => <option key={layout.id} value={`letter:${layout.id}`}>{layout.name}</option>)}</optgroup>}
          </select></label>
          <button type="button" className={button} disabled={busy || disabled} onClick={() => void refresh()}>{busy ? <Loader2 size={16} aria-hidden="true" className="animate-spin" /> : <RefreshCw size={16} aria-hidden="true" />}Tải lại danh sách</button>
        </div>
        <label className="block text-sm font-medium text-slate-700">Cách nạp bố cục<select aria-label="Cách nạp bố cục" className={field} value={mode} disabled={busy || disabled} onChange={event => setMode(event.target.value as "positions" | "full")}>
          <option value="positions">Chỉ lấy vị trí, giữ nền thiệp hiện tại</option><option value="full">Mở cả mẫu thiệp: nền + vị trí</option>
        </select></label>
        {chosen && <p className="text-sm text-slate-600">{Object.values(getInvitePdfPages(chosen.overlay)).reduce((sum, page) => sum + page.fields.length, 0)} trường · {chosen.overlay.pdf ? `${chosen.overlay.pdf.pageCount} trang PDF` : "Thiệp ảnh một trang"}. Bố cục giữ vị trí, kích thước, font và tên trường dữ liệu.</p>}
        <button type="button" className={button} disabled={busy || disabled || !chosen} onClick={() => void apply()}><FolderOpen size={16} aria-hidden="true" />Nạp bố cục</button>
      </div>
      {message && <p role="status" className="text-sm text-sky-800">{message}</p>}
      {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
    </div>
  </details>;
}
