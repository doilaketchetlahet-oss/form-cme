"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import {
  Check,
  Eye,
  HeartHandshake,
  Image as ImageIcon,
  Loader2,
  MonitorPlay,
  Pause,
  Play,
  Send,
  Sparkles,
  Sprout,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { QRCodeView } from "@/components/ui/QRCodeView";
import { buildPublicUrl } from "@/lib/site-url";
import { useConfirm } from "@/lib/ui/confirm";
import { DrawingSvg } from "@/components/wish/DrawingSvg";
import {
  DEFAULT_WISH_SETTINGS,
  WISH_SYMBOLS,
  WISH_THEMES,
  type Wish,
  type WishEvent,
  type WishSettings,
} from "@/lib/wish/config";

type Snapshot = { event: WishEvent; wishes: Wish[]; counts: { total: number; pending: number; approved: number } };
type Tab = "setup" | "moderate" | "wishes" | "display";

export function WishWallManager() {
  const confirm = useConfirm();
  const [event, setEvent] = useState<WishEvent | null>(null);
  const [wishes, setWishes] = useState<Wish[]>([]);
  const [counts, setCounts] = useState({ total: 0, pending: 0, approved: 0 });
  const [draft, setDraft] = useState<WishSettings>(DEFAULT_WISH_SETTINGS);
  const [title, setTitle] = useState("Trao lời chúc, nhận yêu thương");
  const [subtitle, setSubtitle] = useState("");
  const [moderation, setModeration] = useState(false);
  const [status, setStatus] = useState<WishEvent["status"]>("live");
  const [tab, setTab] = useState<Tab>("setup");
  const [busy, setBusy] = useState(false);
  const [filter, setFilter] = useState<"pending" | "approved" | "hidden" | "rejected">("pending");
  const assetInputRef = useRef<HTMLInputElement>(null);
  const assetTargetRef = useRef<"shieldImageUrl" | "targetImageUrl" | "backgroundUrl">("shieldImageUrl");

  const authHeaders = useCallback(async (json = true) => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return {
      ...(json ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  const load = useCallback(
    async (eventCode: string) => {
      const res = await fetch(`/api/wish/${encodeURIComponent(eventCode)}?scope=all`, {
        cache: "no-store",
        headers: await authHeaders(false),
      });
      if (!res.ok) return null;
      const snap = (await res.json()) as Snapshot;
      setEvent(snap.event);
      setWishes(snap.wishes);
      setCounts(snap.counts);
      setDraft(snap.event.settings);
      setTitle(snap.event.title);
      setSubtitle(snap.event.subtitle);
      setModeration(snap.event.moderation);
      setStatus(snap.event.status);
      return snap;
    },
    [authHeaders],
  );

  useEffect(() => {
    const saved = window.localStorage.getItem("wish-wall-code");
    if (!saved) return;
    queueMicrotask(() => void load(saved));
  }, [load]);

  useEffect(() => {
    if (!event) return;
    const timer = setInterval(() => void load(event.code), 5000);
    return () => clearInterval(timer);
  }, [event, load]);

  const createEvent = useCallback(async () => {
    setBusy(true);
    try {
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let generated = "";
      for (let i = 0; i < 6; i += 1) generated += alphabet[Math.floor(Math.random() * alphabet.length)];

      const res = await fetch(`/api/wish/${generated}`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          action: "create",
          title,
          subtitle,
          moderation,
          settings: draft,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
      if (!res.ok) {
        toast.error(body?.detail || body?.error || "Không tạo được chương trình.");
        return;
      }
      window.localStorage.setItem("wish-wall-code", generated);
      await load(generated);
      toast.success(`Đã tạo chương trình ${generated}`);
      setTab("setup");
    } finally {
      setBusy(false);
    }
  }, [authHeaders, draft, load, moderation, subtitle, title]);

  const control = useCallback(
    async (payload: Record<string, unknown>) => {
      if (!event) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/wish/${encodeURIComponent(event.code)}`, {
          method: "PUT",
          headers: await authHeaders(),
          body: JSON.stringify(payload),
        });
        const body = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
        if (!res.ok) {
          toast.error(body?.detail || body?.error || "Thao tác thất bại.");
          return;
        }
        await load(event.code);
      } finally {
        setBusy(false);
      }
    },
    [authHeaders, event, load],
  );

  const saveSettings = useCallback(
    async (next?: WishSettings) => {
      const settings = next ?? draft;
      await control({ action: "settings", settings, title, subtitle, moderation, status });
      toast.success("Đã lưu cấu hình.");
    },
    [control, draft, moderation, status, subtitle, title],
  );

  const patch = (value: Partial<WishSettings>) => setDraft((prev) => ({ ...prev, ...value }));

  const openAssetPicker = (target: "shieldImageUrl" | "targetImageUrl" | "backgroundUrl") => {
    assetTargetRef.current = target;
    assetInputRef.current?.click();
  };

  const handleAsset = async (file: File | undefined) => {
    if (!file || !event) return;
    setBusy(true);
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch(`/api/wish/${encodeURIComponent(event.code)}/asset`, {
        method: "POST",
        headers: await authHeaders(false),
        body: form,
      });
      const body = (await res.json().catch(() => null)) as { url?: string; error?: string } | null;
      if (!res.ok || !body?.url) {
        toast.error(body?.error || "Tải ảnh thất bại.");
        return;
      }
      const next = { ...draft, [assetTargetRef.current]: body.url } as WishSettings;
      setDraft(next);
      await saveSettings(next);
      toast.success("Đã tải ảnh lên.");
    } finally {
      setBusy(false);
      if (assetInputRef.current) assetInputRef.current.value = "";
    }
  };

  const composerUrl = useMemo(
    () => (event ? buildPublicUrl(`/wish/${event.code}?edge=${event.settings.edge}`) : ""),
    [event],
  );
  const wallUrl = useMemo(() => (event ? buildPublicUrl(`/wish/${event.code}/wall`) : ""), [event]);
  const edgeUrls = useMemo(
    () =>
      event
        ? (["left", "center", "right"] as const).map((edge) => ({
            edge,
            label: { left: "Bên trái", center: "Chính giữa", right: "Bên phải" }[edge],
            url: buildPublicUrl(`/wish/${event.code}?edge=${edge}`),
          }))
        : [],
    [event],
  );

  const filtered = useMemo(() => wishes.filter((wish) => wish.status === filter), [wishes, filter]);

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-[11px] font-bold tracking-wider text-sky-600 uppercase">Công cụ</span>
          <h1 className="font-display flex items-center gap-2 text-2xl font-black text-slate-900">
            <HeartHandshake className="text-rose-500" size={22} /> Trao lời chúc, nhận yêu thương
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Khách nhập hoặc vẽ lời chúc trên tablet; lời chúc bay lên màn LED, xuyên qua tấm khiên rồi
            hội tụ thành một hình ghép tập thể.
          </p>
        </div>
        {event && (
          <div className="flex items-center gap-2">
            <span className="rounded-xl bg-rose-50 px-3 py-2 text-sm font-bold text-rose-700">Mã {event.code}</span>
            <button
              onClick={() => {
                window.localStorage.removeItem("wish-wall-code");
                setEvent(null);
                setWishes([]);
                setTab("setup");
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Đổi chương trình
            </button>
          </div>
        )}
      </header>

      <input
        ref={assetInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
        className="hidden"
        onChange={(e) => void handleAsset(e.target.files?.[0])}
      />

      {!event && (
        <div className="glass rounded-3xl p-5 sm:p-6">
          <h2 className="text-base font-bold text-slate-900">Tạo chương trình mới</h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Tên chương trình</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className="admin-field w-full rounded-xl px-3 py-2.5 text-sm" maxLength={160} />
            </label>
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Dòng phụ (không bắt buộc)</span>
              <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="admin-field w-full rounded-xl px-3 py-2.5 text-sm" maxLength={200} />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Chủ đề</span>
              <select value={draft.theme} onChange={(e) => patch({ theme: e.target.value as WishSettings["theme"] })} className="admin-field w-full rounded-xl px-3 py-2.5 text-sm">
                {Object.entries(WISH_THEMES).map(([key, theme]) => (
                  <option key={key} value={key}>{theme.label}</option>
                ))}
              </select>
            </label>
            <label className="flex items-end gap-2 pb-1">
              <input type="checkbox" checked={moderation} onChange={(e) => setModeration(e.target.checked)} className="h-4 w-4" />
              <span className="text-sm text-slate-700">Duyệt lời chúc trước khi lên màn hình</span>
            </label>
          </div>
          <button
            onClick={() => void createEvent()}
            disabled={busy}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-rose-600 py-3 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            Tạo chương trình & lấy mã QR
          </button>
        </div>
      )}

      {event && (
        <>
          <div className="mb-4 flex flex-wrap gap-1 rounded-2xl bg-slate-100 p-1">
            {(
              [
                ["setup", "Thiết lập"],
                ["moderate", `Kiểm duyệt (${counts.pending})`],
                ["wishes", `Lời chúc (${counts.total})`],
                ["display", "Trình diễn"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => {
                  setTab(key);
                  if (key === "moderate") setFilter("pending");
                  if (key === "wishes") setFilter("approved");
                }}
                className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold transition-colors sm:text-sm ${
                  tab === key ? "bg-white text-rose-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "setup" && (
            <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_auto]">
              <div className="glass space-y-4 rounded-3xl p-5 sm:p-6">
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-semibold text-slate-600">Tên chương trình</span>
                    <input value={title} onChange={(e) => setTitle(e.target.value)} className="admin-field w-full rounded-xl px-3 py-2.5 text-sm" />
                  </label>
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-semibold text-slate-600">Dòng phụ</span>
                    <input value={subtitle} onChange={(e) => setSubtitle(e.target.value)} className="admin-field w-full rounded-xl px-3 py-2.5 text-sm" />
                  </label>
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-600">Trạng thái</span>
                    <select value={status} onChange={(e) => setStatus(e.target.value as WishEvent["status"])} className="admin-field w-full rounded-xl px-3 py-2.5 text-sm">
                      <option value="live">Đang mở</option>
                      <option value="paused">Tạm dừng nhận</option>
                      <option value="ended">Đã kết thúc</option>
                      <option value="draft">Nháp</option>
                    </select>
                  </label>
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-600">Chủ đề</span>
                    <select value={draft.theme} onChange={(e) => patch({ theme: e.target.value as WishSettings["theme"] })} className="admin-field w-full rounded-xl px-3 py-2.5 text-sm">
                      {Object.entries(WISH_THEMES).map(([key, theme]) => (
                        <option key={key} value={key}>{theme.label}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-600">Cạnh tablet trên màn LED</span>
                    <select value={draft.edge} onChange={(e) => patch({ edge: e.target.value as WishSettings["edge"] })} className="admin-field w-full rounded-xl px-3 py-2.5 text-sm">
                      <option value="center">Chính giữa (từ trên xuống)</option>
                      <option value="left">Bên trái</option>
                      <option value="right">Bên phải</option>
                    </select>
                  </label>
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-600">Hình ghép tập thể</span>
                    <select value={draft.shape} onChange={(e) => patch({ shape: e.target.value as WishSettings["shape"] })} className="admin-field w-full rounded-xl px-3 py-2.5 text-sm">
                      <option value="heart">Trái tim</option>
                      <option value="star">Ngôi sao</option>
                      <option value="flower">Bông hoa</option>
                      <option value="text">Chữ / tên</option>
                      <option value="image">Ảnh tự thiết kế</option>
                    </select>
                  </label>
                  {draft.shape === "text" && (
                    <label className="sm:col-span-2">
                      <span className="mb-1.5 block text-xs font-semibold text-slate-600">Nội dung chữ</span>
                      <input value={draft.shapeText} onChange={(e) => patch({ shapeText: e.target.value })} className="admin-field w-full rounded-xl px-3 py-2.5 text-sm" maxLength={60} />
                    </label>
                  )}
                  <label className="sm:col-span-2">
                    <span className="mb-1.5 block text-xs font-semibold text-slate-600">Vật phẩm mặc định</span>
                    <div className="flex flex-wrap gap-2">
                      {WISH_SYMBOLS.map((item) => (
                        <button
                          key={item}
                          type="button"
                          onClick={() => patch({ symbol: item })}
                          className={`flex h-10 w-10 items-center justify-center rounded-xl text-xl ${
                            draft.symbol === item ? "bg-rose-100 ring-2 ring-rose-400" : "bg-slate-100"
                          }`}
                        >
                          {item}
                        </button>
                      ))}
                    </div>
                  </label>
                </div>

                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={draft.allowText} onChange={(e) => patch({ allowText: e.target.checked })} className="h-4 w-4" />
                    <span className="text-xs text-slate-700">Cho viết chữ</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={draft.allowDrawing} onChange={(e) => patch({ allowDrawing: e.target.checked })} className="h-4 w-4" />
                    <span className="text-xs text-slate-700">Cho vẽ tay</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={draft.showNames} onChange={(e) => patch({ showNames: e.target.checked })} className="h-4 w-4" />
                    <span className="text-xs text-slate-700">Hiện tên người gửi</span>
                  </label>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={moderation} onChange={(e) => setModeration(e.target.checked)} className="h-4 w-4" />
                    <span className="text-xs text-slate-700">Duyệt trước</span>
                  </label>
                  <label>
                    <span className="mb-1 block text-[11px] text-slate-500">Độ dài tối đa</span>
                    <input type="number" min={20} max={300} value={draft.maxLength} onChange={(e) => patch({ maxLength: Number(e.target.value) })} className="admin-field w-full rounded-lg px-2 py-1.5 text-xs" />
                  </label>
                  <label>
                    <span className="mb-1 block text-[11px] text-slate-500">Số lời chúc trôi</span>
                    <input type="number" min={6} max={60} value={draft.maxFloating} onChange={(e) => patch({ maxFloating: Number(e.target.value) })} className="admin-field w-full rounded-lg px-2 py-1.5 text-xs" />
                  </label>
                </div>

                <div className="flex flex-wrap gap-2">
                  {(
                    [
                      ["shieldImageUrl", "Ảnh khiên", draft.shieldImageUrl],
                      ["targetImageUrl", "Ảnh hình ghép", draft.targetImageUrl],
                      ["backgroundUrl", "Ảnh nền LED", draft.backgroundUrl],
                    ] as const
                  ).map(([key, label, url]) => (
                    <div key={key} className="flex items-center gap-2 rounded-2xl border border-slate-200 bg-white p-2">
                      <div className="flex h-10 w-10 items-center justify-center overflow-hidden rounded-lg bg-slate-100">
                        {url ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={url} alt={label} className="h-full w-full object-contain" />
                        ) : (
                          <ImageIcon size={16} className="text-slate-400" />
                        )}
                      </div>
                      <button onClick={() => openAssetPicker(key)} className="flex items-center gap-1 text-xs font-semibold text-sky-700">
                        <Upload size={12} /> {label}
                      </button>
                      {url && (
                        <button onClick={() => patch({ [key]: null } as Partial<WishSettings>)} className="text-slate-400 hover:text-red-500">
                          <X size={14} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                <button
                  onClick={() => void saveSettings()}
                  disabled={busy}
                  className="rounded-xl bg-rose-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-rose-700 disabled:opacity-50"
                >
                  Lưu cấu hình
                </button>
              </div>

              <div className="glass flex flex-col items-center gap-4 rounded-3xl p-5">
                <div className="flex flex-col items-center gap-2">
                  <span className="text-xs font-bold text-slate-600">Tablet gửi lời chúc</span>
                  <p className="max-w-[220px] text-center text-[11px] text-slate-500">
                    Mỗi tablet quét một mã theo vị trí của nó — lời chúc sẽ bay vào màn LED từ đúng cạnh đó.
                  </p>
                  <div className="flex flex-wrap justify-center gap-3">
                    {edgeUrls.map((item) => (
                      <div key={item.edge} className="flex flex-col items-center gap-1">
                        <QRCodeView value={item.url} size={112} />
                        <span className="text-[11px] font-semibold text-slate-600">{item.label}</span>
                      </div>
                    ))}
                  </div>
                  <a
                    href={composerUrl}
                    target="_blank"
                    rel="noopener"
                    className="flex items-center gap-1 text-xs font-semibold text-sky-700"
                  >
                    <Send size={12} /> Mở thử
                  </a>
                </div>
                <div className="flex flex-col items-center gap-2 border-t border-slate-100 pt-4">
                  <span className="text-xs font-bold text-slate-600">Màn hình LED</span>
                  <QRCodeView value={wallUrl} size={150} />
                  <a
                    href={wallUrl}
                    target="_blank"
                    rel="noopener"
                    className="flex items-center gap-1 text-xs font-semibold text-sky-700"
                  >
                    <MonitorPlay size={12} /> Mở màn hình lớn
                  </a>
                </div>
              </div>
            </div>
          )}

          {tab === "moderate" && (
            <WishList
              wishes={filtered}
              empty="Không có lời chúc nào đang chờ duyệt."
              actions={(wish) => (
                <>
                  <ActionButton tone="ok" onClick={() => void control({ action: "moderate", wishId: wish.id, status: "approved" })}>
                    <Check size={14} /> Duyệt
                  </ActionButton>
                  <ActionButton tone="muted" onClick={() => void control({ action: "moderate", wishId: wish.id, status: "hidden" })}>
                    <X size={14} /> Ẩn
                  </ActionButton>
                  <ActionButton tone="danger" onClick={() => void control({ action: "delete", wishId: wish.id })}>
                    <Trash2 size={14} />
                  </ActionButton>
                </>
              )}
            />
          )}

          {tab === "wishes" && (
            <>
              <div className="mb-3 flex flex-wrap gap-1 rounded-2xl bg-slate-100 p-1">
                {(["approved", "hidden", "rejected", "pending"] as const).map((key) => (
                  <button
                    key={key}
                    onClick={() => setFilter(key)}
                    className={`rounded-xl px-3 py-1.5 text-xs font-bold ${filter === key ? "bg-white text-rose-700 shadow-sm" : "text-slate-500"}`}
                  >
                    {{ approved: "Đang hiển thị", hidden: "Đã ẩn", rejected: "Từ chối", pending: "Chờ duyệt" }[key]}
                  </button>
                ))}
              </div>
              <WishList
                wishes={filtered}
                empty="Chưa có lời chúc nào."
                actions={(wish) => (
                  <>
                    {wish.status !== "approved" && (
                      <ActionButton tone="ok" onClick={() => void control({ action: "moderate", wishId: wish.id, status: "approved" })}>
                        <Check size={14} /> Duyệt
                      </ActionButton>
                    )}
                    {wish.status === "approved" && (
                      <ActionButton tone="muted" onClick={() => void control({ action: "moderate", wishId: wish.id, status: "hidden" })}>
                        <Eye size={14} /> Ẩn
                      </ActionButton>
                    )}
                    <ActionButton tone="accent" onClick={() => void control({ action: "spotlight", wishId: wish.id })}>
                      <Sparkles size={14} /> Chiếu
                    </ActionButton>
                    <ActionButton tone="danger" onClick={() => void control({ action: "delete", wishId: wish.id })}>
                      <Trash2 size={14} />
                    </ActionButton>
                  </>
                )}
              />
            </>
          )}

          {tab === "display" && (
            <div className="glass space-y-5 rounded-3xl p-5 sm:p-6">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Stat label="Tổng lời chúc" value={counts.total} />
                <Stat label="Đang hiển thị" value={counts.approved} />
                <Stat label="Chờ duyệt" value={counts.pending} />
                <Stat label="Hình ghép" value={`${Math.min(48, counts.approved)}/48`} />
              </div>

              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => void control({ action: "settings", status: status === "paused" ? "live" : "paused", settings: draft, title, subtitle, moderation })}
                  disabled={busy}
                  className="flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                >
                  {status === "paused" ? <Play size={15} /> : <Pause size={15} />}
                  {status === "paused" ? "Mở lại nhận lời chúc" : "Tạm dừng nhận"}
                </button>
                <button
                  onClick={() => void control({ action: "demo" })}
                  disabled={busy}
                  className="flex items-center gap-2 rounded-xl border border-rose-200 bg-white px-4 py-2.5 text-sm font-semibold text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  <Sparkles size={15} /> Gửi lời chúc thử
                </button>
                <button
                  onClick={() => void control({ action: "absorb-all" })}
                  disabled={busy}
                  className="flex items-center gap-2 rounded-xl border border-sky-200 bg-white px-4 py-2.5 text-sm font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                >
                  <Sprout size={15} /> Ghép tất cả vào hình
                </button>
                <button
                  onClick={async () => {
                    if (await confirm({ title: "Xoá toàn bộ lời chúc?", description: "Hành động này không thể hoàn tác.", confirmText: "Xoá hết" }))
                      void control({ action: "clear" });
                  }}
                  disabled={busy}
                  className="flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <Trash2 size={15} /> Xoá hết
                </button>
              </div>

              <div>
                <p className="mb-2 text-xs font-bold tracking-wider text-slate-500 uppercase">Chiếu nổi bật ngay</p>
                <div className="flex flex-wrap gap-2">
                  {wishes.filter((wish) => wish.status === "approved").slice(0, 24).map((wish) => (
                    <button
                      key={wish.id}
                      onClick={() => void control({ action: "spotlight", wishId: wish.id })}
                      className="flex max-w-[180px] items-center gap-2 rounded-xl border border-slate-200 bg-white px-3 py-2 text-left text-xs hover:border-rose-300"
                    >
                      <span className="text-lg">{wish.symbol}</span>
                      <span className="truncate text-slate-700">{wish.content || "(vật phẩm)"}</span>
                    </button>
                  ))}
                  {counts.approved === 0 && <p className="text-sm text-slate-500">Chưa có lời chúc đã duyệt.</p>}
                </div>
              </div>
            </div>
          )}
        </>
      )}

      {!event && (
        <p className="mt-4 text-center text-xs text-slate-500">
          Nhớ chạy <span className="font-mono">supabase/wish-wall.sql</span> một lần trước khi dùng.
        </p>
      )}
    </div>
  );
}

function WishList({
  wishes,
  empty,
  actions,
}: {
  wishes: Wish[];
  empty: string;
  actions: (wish: Wish) => React.ReactNode;
}) {
  if (!wishes.length) {
    return <p className="glass rounded-3xl px-4 py-10 text-center text-sm text-slate-500">{empty}</p>;
  }
  return (
    <div className="glass divide-y divide-slate-100 overflow-hidden rounded-3xl">
      {wishes.map((wish) => (
        <div key={wish.id} className="flex items-center gap-3 px-4 py-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-xl bg-slate-100">
            {wish.drawing ? (
              <DrawingSvg drawing={wish.drawing} className="h-full w-full p-1" />
            ) : (
              <span className="text-2xl">{wish.symbol}</span>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold text-slate-800">{wish.content || "(chỉ có vật phẩm)"}</p>
            <p className="text-[11px] text-slate-500">
              {wish.nickname || "Ẩn danh"} · {new Date(wish.created_at).toLocaleString("vi-VN")}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap justify-end gap-1.5">{actions(wish)}</div>
        </div>
      ))}
    </div>
  );
}

type ActionTone = "ok" | "danger" | "muted" | "accent";

function ActionButton({
  children,
  tone,
  onClick,
}: {
  children: React.ReactNode;
  tone: ActionTone;
  onClick: () => void;
}) {
  const tones: Record<ActionTone, string> = {
    ok: "border-emerald-200 text-emerald-700 hover:bg-emerald-50",
    danger: "border-red-200 text-red-600 hover:bg-red-50",
    muted: "border-slate-200 text-slate-600 hover:bg-slate-50",
    accent: "border-rose-200 text-rose-600 hover:bg-rose-50",
  };
  return (
    <button onClick={onClick} className={`flex items-center gap-1 rounded-lg border bg-white px-2.5 py-1.5 text-xs font-semibold ${tones[tone]}`}>
      {children}
    </button>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-2xl bg-white/70 p-3 text-center ring-1 ring-slate-200">
      <p className="font-display text-2xl font-black text-slate-900">{value}</p>
      <p className="text-[11px] font-semibold text-slate-500">{label}</p>
    </div>
  );
}
