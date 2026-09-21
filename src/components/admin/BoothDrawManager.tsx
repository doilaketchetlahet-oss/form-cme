"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import {
  ArrowLeft,
  ArrowRightLeft,
  Building2,
  CalendarDays,
  Check,
  CircleHelp,
  Copy,
  Dices,
  History,
  ImagePlus,
  LayoutGrid,
  Loader2,
  LockKeyhole,
  Map as MapIcon,
  MapPin,
  Pencil,
  Plus,
  RefreshCw,
  RotateCw,
  Settings2,
  Shuffle,
  Trash2,
  Upload,
  Users,
} from "lucide-react";
import { useAdminAccess } from "@/components/auth/AdminAccessProvider";
import { useConfirm } from "@/lib/ui/confirm";
import {
  loadBoothDraw,
  mutateBoothDraw,
  uploadBoothMap,
  type BoothApiOptions,
  type BoothAssignment,
  type BoothCompany,
  type BoothDrawResponse,
  type BoothDrawRpcResult,
  type BoothDrawState,
  type BoothPool,
  type BoothSessionStatus,
  type BoothZone,
} from "@/lib/booth-draw";
import { cn } from "@/lib/utils";
import { PageHeader } from "./PageHeader";

type Tab = "setup" | "map" | "draw" | "exchange" | "history";
type Notice = { type: "success" | "error"; text: string } | null;

const ADMIN_API_OPTIONS: BoothApiOptions = {};
const BoothApiContext = createContext<BoothApiOptions>(ADMIN_API_OPTIONS);

function useBoothApiOptions() {
  return useContext(BoothApiContext);
}

const TABS: Array<{ id: Tab; label: string; icon: typeof Settings2 }> = [
  { id: "setup", label: "Thiết lập", icon: Settings2 },
  { id: "map", label: "Sơ đồ", icon: MapIcon },
  { id: "draw", label: "Vòng quay", icon: Dices },
  { id: "exchange", label: "Trao đổi", icon: ArrowRightLeft },
  { id: "history", label: "Lịch sử", icon: History },
];

const STATUS_LABEL: Record<BoothSessionStatus, string> = {
  draft: "Đang thiết lập",
  active: "Đang quay",
  exchange: "Đang trao đổi",
  finalized: "Đã chốt",
};

const SUGGESTED_POOLS = ["Kim cương", "Bạch kim", "Vàng", "Bạc", "Đồng"];

const fieldClass = "w-full rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 outline-none transition focus:border-sky-400 focus:ring-2 focus:ring-sky-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400";
const primaryButton = "inline-flex items-center justify-center gap-2 rounded-xl bg-sky-500 px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-sky-600 disabled:cursor-not-allowed disabled:opacity-50";
const secondaryButton = "inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 transition hover:border-sky-300 hover:bg-sky-50 disabled:cursor-not-allowed disabled:opacity-50";

function lines(value: string) {
  return value.split(/[\n,;]+/).map((item) => item.trim()).filter(Boolean);
}

function dateTime(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { dateStyle: "short", timeStyle: "short" }).format(new Date(value));
}

function dateTimeInput(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : "Có lỗi xảy ra.";
}

export function BoothDrawManager() {
  const { canManageForms } = useAdminAccess();
  return (
    <BoothApiContext.Provider value={ADMIN_API_OPTIONS}>
      <BoothDrawWorkspace canManageForms={canManageForms} />
    </BoothApiContext.Provider>
  );
}

export function PublicBoothDrawManager({ initialSessionId = "" }: { initialSessionId?: string }) {
  const [passcode, setPasscode] = useState(() => {
    if (typeof window === "undefined" || !initialSessionId) return "";
    return window.sessionStorage.getItem(`booth-passcode:${initialSessionId}`) ?? "";
  });
  const apiOptions = useMemo<BoothApiOptions>(() => ({ publicMode: true, passcode }), [passcode]);
  return (
    <BoothApiContext.Provider value={apiOptions}>
      <BoothDrawWorkspace
        canManageForms={passcode.trim().length >= 6}
        publicMode
        initialSessionId={initialSessionId}
        passcode={passcode}
        onPasscodeChange={setPasscode}
      />
    </BoothApiContext.Provider>
  );
}

function BoothDrawWorkspace({
  canManageForms,
  publicMode = false,
  initialSessionId = "",
  passcode = "",
  onPasscodeChange,
}: {
  canManageForms: boolean;
  publicMode?: boolean;
  initialSessionId?: string;
  passcode?: string;
  onPasscodeChange?: (value: string) => void;
}) {
  const confirm = useConfirm();
  const apiOptions = useBoothApiOptions();
  const [payload, setPayload] = useState<BoothDrawResponse | null>(null);
  const [sessionId, setSessionId] = useState("");
  const [tab, setTab] = useState<Tab>("setup");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [newEventId, setNewEventId] = useState("");
  const [newSessionName, setNewSessionName] = useState("Bốc thăm gian hàng");
  const [newPoolText, setNewPoolText] = useState("");

  const refresh = useCallback(async (id?: string) => {
    setLoading(true);
    try {
      const next = await loadBoothDraw(id, { publicMode: apiOptions.publicMode });
      setPayload(next);
      if (id) setSessionId(id);
    } catch (error) {
      setNotice({ type: "error", text: errorText(error) });
    } finally {
      setLoading(false);
    }
  }, [apiOptions.publicMode]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      await Promise.resolve();
      if (active) await refresh(initialSessionId || undefined);
    };
    void load();
    return () => { active = false; };
  }, [initialSessionId, refresh]);

  const current = payload?.current;
  const selectedSession = payload?.sessions.find((session) => session.id === sessionId);

  const run = async (operation: () => Promise<void>, success?: string) => {
    if (busy) return;
    setBusy(true);
    setNotice(null);
    try {
      await operation();
      if (success) setNotice({ type: "success", text: success });
    } catch (error) {
      setNotice({ type: "error", text: errorText(error) });
    } finally {
      setBusy(false);
    }
  };

  const createSession = () => run(async () => {
    const poolNames = lines(newPoolText);
    const result = await mutateBoothDraw<{ id: string; expiresAt?: string }>({
      action: publicMode ? "create_public_session" : "create_session",
      eventId: newEventId,
      name: newSessionName,
      poolNames,
    }, apiOptions);
    if (publicMode && typeof window !== "undefined") {
      window.sessionStorage.setItem(`booth-passcode:${result.id}`, passcode);
      window.history.replaceState(null, "", `/booth-draw?session=${encodeURIComponent(result.id)}`);
    }
    setTab("setup");
    await refresh(result.id);
  }, `Đã tạo phiên với ${lines(newPoolText).length} pool.`);

  const openSession = (id: string) => {
    setTab("setup");
    setNotice(null);
    void refresh(id);
  };

  const closeSession = () => {
    setSessionId("");
    setTab("setup");
    setNotice(null);
    if (publicMode && typeof window !== "undefined") window.history.replaceState(null, "", "/booth-draw");
    void refresh();
  };

  const updateStatus = async (status: BoothSessionStatus) => {
    if (status === "finalized") {
      const remaining = (current?.companies.length ?? 0) - (current?.assignments.length ?? 0);
      const accepted = await confirm({
        title: "Chốt kết quả bốc thăm?",
        description: remaining > 0
          ? `Vẫn còn ${remaining} công ty chưa quay. Sau khi chốt, mọi chỉnh sửa và trao đổi sẽ bị khóa.`
          : "Sau khi chốt, mọi chỉnh sửa và trao đổi sẽ bị khóa. Bạn vẫn có thể mở lại khi cần.",
        confirmText: "Chốt kết quả",
      });
      if (!accepted) return;
    }
    await run(async () => {
      await mutateBoothDraw({ action: "update_session", sessionId, status }, apiOptions);
      await refresh(sessionId);
    }, status === "finalized" ? "Đã khóa kết quả phiên." : "Đã mở lại phiên.");
  };

  const deleteSession = async () => {
    if (!selectedSession || !canManageForms) return;
    const accepted = await confirm({
      title: `Xóa phiên “${selectedSession.name}”?`,
      description: "Toàn bộ pool, công ty, kết quả quay, sơ đồ và lịch sử trao đổi của phiên này sẽ bị xóa.",
      destructive: true,
      confirmText: "Xóa phiên",
    });
    if (!accepted) return;
    await run(async () => {
      await mutateBoothDraw({ action: "delete_session", sessionId }, apiOptions);
      setSessionId("");
      if (publicMode && typeof window !== "undefined") {
        window.sessionStorage.removeItem(`booth-passcode:${sessionId}`);
        window.history.replaceState(null, "", "/booth-draw");
      }
      await refresh();
    }, "Đã xóa phiên bốc thăm.");
  };

  const copyShareLink = async () => {
    const token = current?.session.share_token;
    if (typeof window === "undefined" || !token || current?.session.share_enabled === false) return;
    const url = `${window.location.origin}/booth-map/${encodeURIComponent(token)}`;
    try {
      await navigator.clipboard.writeText(url);
      setNotice({ type: "success", text: "Đã sao chép link xem sơ đồ. Người nhận không cần đăng nhập hoặc passcode." });
    } catch {
      setNotice({ type: "error", text: `Không thể tự sao chép. Link xem: ${url}` });
    }
  };

  return (
    <div className="mx-auto max-w-[1600px] px-4 py-8 sm:px-8 sm:py-10">
      <PageHeader
        title="Bốc thăm gian hàng"
        subtitle={publicMode ? "Công cụ miễn phí, không cần đăng nhập. Dữ liệu được tự động xoá sau 7 ngày." : "Quay số theo từng pool tài trợ, hiển thị vị trí trên sơ đồ và quản lý trao đổi sau bốc thăm."}
        action={
          <button onClick={() => void refresh(sessionId || undefined)} disabled={loading} className={secondaryButton}>
            <RefreshCw size={16} className={loading ? "animate-spin" : ""} /> Làm mới
          </button>
        }
      />

      {notice && <NoticeBox notice={notice} />}

      {loading && !payload ? (
        <div className="glass flex min-h-64 items-center justify-center rounded-2xl text-slate-500">
          <Loader2 className="mr-2 animate-spin" size={20} /> Đang tải công cụ…
        </div>
      ) : !current ? (
        <SessionHome
          data={payload}
          canManage={publicMode ? true : canManageForms}
          eventId={newEventId}
          sessionName={newSessionName}
          poolText={newPoolText}
          passcode={passcode}
          publicMode={publicMode}
          busy={busy}
          onEventId={setNewEventId}
          onSessionName={setNewSessionName}
          onPoolText={setNewPoolText}
          onPasscode={onPasscodeChange}
          onCreate={() => void createSession()}
          onOpen={openSession}
        />
      ) : (
        <>
          <section className="glass mb-5 rounded-2xl p-4 sm:p-5">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
              <div className="flex min-w-0 items-center gap-3">
                <button onClick={closeSession} className="grid h-10 w-10 shrink-0 place-items-center rounded-xl border border-slate-200 bg-white text-slate-600 hover:bg-sky-50" title="Danh sách phiên">
                  <ArrowLeft size={18} />
                </button>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="truncate text-lg font-bold text-slate-900">{current.session.name}</h2>
                    <StatusBadge status={current.session.status} />
                  </div>
                  <p className="mt-0.5 text-xs text-slate-500">
                    {publicMode ? "Phiên công khai" : payload?.events.find((event) => event.id === current.session.event_id)?.name ?? "Sự kiện"}
                    {" · "}{current.companies.length} công ty · {current.booths.length} gian
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button onClick={() => void copyShareLink()} disabled={!current.session.share_token || current.session.share_enabled === false} className={secondaryButton} title={current.session.share_enabled === false ? "Bật chia sẻ trong tab Thiết lập" : "Link chỉ xem, không cần đăng nhập"}>
                  <Copy size={15} /> Link xem sơ đồ
                </button>
                {canManageForms && <>
                  {current.session.status === "finalized" ? (
                    <button onClick={() => void updateStatus("exchange")} disabled={busy} className={secondaryButton}>
                      <RotateCw size={15} /> Mở lại
                    </button>
                  ) : (
                    <button onClick={() => void updateStatus("finalized")} disabled={busy} className={secondaryButton}>
                      <LockKeyhole size={15} /> Chốt kết quả
                    </button>
                  )}
                  <button onClick={() => void deleteSession()} disabled={busy} className="inline-flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-semibold text-red-600 hover:bg-red-100 disabled:opacity-50">
                    <Trash2 size={15} /> Xóa phiên
                  </button>
                </>}
              </div>
            </div>
            {publicMode && (
              <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-[1fr_auto] sm:items-end">
                <label className="block">
                  <span className="mb-1.5 block text-xs font-semibold text-slate-500">Passcode chỉnh sửa</span>
                  <input
                    type="password"
                    value={passcode}
                    onChange={(event) => {
                      onPasscodeChange?.(event.target.value);
                      if (sessionId && typeof window !== "undefined") window.sessionStorage.setItem(`booth-passcode:${sessionId}`, event.target.value);
                    }}
                    className={fieldClass}
                    placeholder="Nhập passcode của phiên"
                    autoComplete="current-password"
                  />
                </label>
                <div className="rounded-xl bg-amber-50 px-4 py-2.5 text-xs text-amber-700">
                  Hết hạn {current.session.expires_at ? dateTime(current.session.expires_at) : "sau 7 ngày"}
                </div>
              </div>
            )}
          </section>

          <div className="mb-6 overflow-x-auto pb-1">
            <div className="inline-flex min-w-max gap-1 rounded-2xl border border-sky-100 bg-white/80 p-1.5 shadow-sm">
              {TABS.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.id}
                    onClick={() => setTab(item.id)}
                    className={cn(
                      "inline-flex items-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition",
                      tab === item.id ? "bg-sky-500 text-white shadow-md shadow-sky-200" : "text-slate-500 hover:bg-sky-50 hover:text-sky-700",
                    )}
                  >
                    <Icon size={16} /> {item.label}
                  </button>
                );
              })}
            </div>
          </div>

          {tab === "setup" && (
            <SetupTab current={current} canManage={canManageForms} busy={busy} run={run} refresh={() => refresh(sessionId)} />
          )}
          {tab === "map" && (
            <MapTab current={current} canManage={canManageForms} busy={busy} setNotice={setNotice} onRefresh={() => refresh(sessionId)} />
          )}
          {tab === "draw" && (
            <DrawTab current={current} canManage={canManageForms} busy={busy} run={run} refresh={() => refresh(sessionId)} />
          )}
          {tab === "exchange" && (
            <ExchangeTab current={current} canManage={canManageForms} busy={busy} run={run} refresh={() => refresh(sessionId)} />
          )}
          {tab === "history" && <HistoryTab current={current} />}
        </>
      )}
    </div>
  );
}

function NoticeBox({ notice }: { notice: Exclude<Notice, null> }) {
  return (
    <div className={cn("mb-5 rounded-xl border px-4 py-3 text-sm", notice.type === "success" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-red-200 bg-red-50 text-red-700")}>
      {notice.text}
    </div>
  );
}

function SessionHome({
  data,
  canManage,
  eventId,
  sessionName,
  poolText,
  passcode,
  publicMode,
  busy,
  onEventId,
  onSessionName,
  onPoolText,
  onPasscode,
  onCreate,
  onOpen,
}: {
  data: BoothDrawResponse | null;
  canManage: boolean;
  eventId: string;
  sessionName: string;
  poolText: string;
  passcode: string;
  publicMode: boolean;
  busy: boolean;
  onEventId: (value: string) => void;
  onSessionName: (value: string) => void;
  onPoolText: (value: string) => void;
  onPasscode?: (value: string) => void;
  onCreate: () => void;
  onOpen: (id: string) => void;
}) {
  return (
    <div className={cn("grid gap-6", publicMode ? "mx-auto max-w-xl" : "xl:grid-cols-[380px_1fr]")}>
      <section className="glass h-fit rounded-2xl p-5">
        <h2 className="flex items-center gap-2 text-base font-bold text-slate-900"><Plus size={17} className="text-sky-500" /> Tạo phiên bốc thăm</h2>
        <p className="mt-1 text-sm text-slate-500">{publicMode ? "Tạo miễn phí, không cần tài khoản. Phiên và dữ liệu sẽ tự xoá sau 7 ngày." : "Mỗi phiên thuộc một sự kiện. Bạn tự đặt tên và số lượng pool theo cơ cấu tài trợ thực tế."}</p>
        <div className="mt-5 space-y-4">
          {!publicMode && <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-500">Sự kiện</span>
            <select value={eventId} onChange={(event) => onEventId(event.target.value)} disabled={!canManage} className={fieldClass}>
              <option value="">Chọn sự kiện…</option>
              {(data?.events ?? []).map((event) => <option key={event.id} value={event.id}>{event.name}</option>)}
            </select>
          </label>}
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-500">Tên phiên</span>
            <input value={sessionName} onChange={(event) => onSessionName(event.target.value)} disabled={!canManage} className={fieldClass} />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center justify-between gap-2 text-xs font-semibold text-slate-500">
              <span>Danh sách pool <span className="text-red-500">*</span></span>
              <button type="button" onClick={() => onPoolText(SUGGESTED_POOLS.join("\n"))} disabled={!canManage} className="font-semibold text-sky-600 hover:text-sky-700 disabled:opacity-50">Dùng 5 pool gợi ý</button>
            </span>
            <textarea rows={6} value={poolText} onChange={(event) => onPoolText(event.target.value)} disabled={!canManage} className={fieldClass} placeholder={"VIP\nĐối tác chiến lược\nNhà tài trợ"} />
            <span className="mt-1 block text-[11px] text-slate-400">Mỗi dòng một pool; có thể đổi tên và màu sau khi tạo.</span>
          </label>
          {publicMode && <label className="block">
            <span className="mb-1.5 block text-xs font-semibold text-slate-500">Passcode chỉnh sửa <span className="text-red-500">*</span></span>
            <input type="password" value={passcode} onChange={(event) => onPasscode?.(event.target.value)} className={fieldClass} placeholder="Ít nhất 6 ký tự" minLength={6} maxLength={64} autoComplete="new-password" />
            <span className="mt-1 block text-[11px] text-slate-400">Hãy lưu lại passcode. Hệ thống chỉ lưu bản băm và không thể khôi phục passcode.</span>
          </label>}
          {!publicMode && data?.events.length === 0 && <p className="rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-700">Chưa có sự kiện. Hãy tạo sự kiện tại mục “Sự kiện” trước.</p>}
          <button onClick={onCreate} disabled={!canManage || busy || (!publicMode && !eventId) || (publicMode && passcode.trim().length < 6) || lines(poolText).length === 0} className={cn(primaryButton, "w-full")}>
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />} Tạo phiên
          </button>
          {!publicMode && !canManage && <p className="text-xs text-slate-500">Tài khoản của bạn chỉ có quyền xem.</p>}
        </div>
      </section>

      {!publicMode && <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">Các phiên đã tạo</h2>
          <span className="text-xs text-slate-500">{data?.sessions.length ?? 0} phiên</span>
        </div>
        {(data?.sessions.length ?? 0) === 0 ? (
          <div className="glass grid min-h-56 place-items-center rounded-2xl p-8 text-center">
            <div><Dices className="mx-auto mb-3 text-sky-300" size={36} /><p className="font-semibold text-slate-700">Chưa có phiên bốc thăm</p><p className="mt-1 text-sm text-slate-500">Tạo phiên đầu tiên để nhập công ty và số gian hàng.</p></div>
          </div>
        ) : (
          <div className="grid gap-3 md:grid-cols-2">
            {data?.sessions.map((session) => {
              const event = data.events.find((item) => item.id === session.event_id);
              return (
                <button key={session.id} onClick={() => onOpen(session.id)} className="glass group rounded-2xl p-5 text-left transition hover:-translate-y-0.5 hover:border-sky-300 hover:shadow-lg hover:shadow-sky-100">
                  <div className="flex items-start justify-between gap-3">
                    <div className="grid h-10 w-10 place-items-center rounded-xl bg-sky-50 text-sky-600"><Dices size={19} /></div>
                    <StatusBadge status={session.status} />
                  </div>
                  <h3 className="mt-4 font-bold text-slate-900 group-hover:text-sky-700">{session.name}</h3>
                  <p className="mt-1 truncate text-sm text-slate-500">{event?.name ?? "Sự kiện"}</p>
                  <p className="mt-3 text-xs text-slate-400">Cập nhật {dateTime(session.updated_at)}</p>
                </button>
              );
            })}
          </div>
        )}
      </section>}
    </div>
  );
}

function StatusBadge({ status }: { status: BoothSessionStatus }) {
  return (
    <span className={cn(
      "rounded-full border px-2.5 py-1 text-[11px] font-bold",
      status === "finalized" ? "border-slate-200 bg-slate-100 text-slate-600" :
        status === "exchange" ? "border-violet-200 bg-violet-50 text-violet-700" :
          status === "active" ? "border-emerald-200 bg-emerald-50 text-emerald-700" :
            "border-amber-200 bg-amber-50 text-amber-700",
    )}>{STATUS_LABEL[status]}</span>
  );
}

type RunOperation = (operation: () => Promise<void>, success?: string) => Promise<void>;

function SetupTab({ current, canManage, busy, run, refresh }: { current: BoothDrawState; canManage: boolean; busy: boolean; run: RunOperation; refresh: () => Promise<void> }) {
  const confirm = useConfirm();
  const apiOptions = useBoothApiOptions();
  const [companyPoolId, setCompanyPoolId] = useState("");
  const [boothPoolId, setBoothPoolId] = useState("");
  const [companyText, setCompanyText] = useState("");
  const [boothText, setBoothText] = useState("");
  const [poolName, setPoolName] = useState("");
  const [poolColor, setPoolColor] = useState("#0ea5e9");
  const [editingPoolId, setEditingPoolId] = useState("");
  const [editingPoolName, setEditingPoolName] = useState("");
  const [editingPoolColor, setEditingPoolColor] = useState("#0ea5e9");
  const [shareName, setShareName] = useState(current.session.name);
  const [startsAt, setStartsAt] = useState(dateTimeInput(current.session.starts_at));
  const [endsAt, setEndsAt] = useState(dateTimeInput(current.session.ends_at));
  const [venue, setVenue] = useState(current.session.venue ?? "");
  const [publicNote, setPublicNote] = useState(current.session.public_note ?? "");
  const [shareEnabled, setShareEnabled] = useState(current.session.share_enabled !== false);
  const defaultPoolId = current.pools[0]?.id ?? "";
  const selectedCompanyPool = companyPoolId || defaultPoolId;
  const selectedBoothPool = boothPoolId || defaultPoolId;
  const assignedCompanyIds = useMemo(() => new Set(current.assignments.map((item) => item.company_id)), [current.assignments]);
  const assignedBoothIds = useMemo(() => new Set(current.assignments.map((item) => item.booth_id)), [current.assignments]);

  const addCompanies = () => run(async () => {
    await mutateBoothDraw({ action: "bulk_add_companies", sessionId: current.session.id, poolId: selectedCompanyPool, names: lines(companyText) }, apiOptions);
    setCompanyText("");
    await refresh();
  }, "Đã cập nhật danh sách công ty.");

  const addBooths = () => run(async () => {
    await mutateBoothDraw({ action: "bulk_add_booths", sessionId: current.session.id, poolId: selectedBoothPool, codes: lines(boothText) }, apiOptions);
    setBoothText("");
    await refresh();
  }, "Đã cập nhật danh sách gian hàng.");

  const addPool = () => run(async () => {
    await mutateBoothDraw({ action: "create_pool", sessionId: current.session.id, name: poolName, color: poolColor, sortOrder: current.pools.length * 10 + 10 }, apiOptions);
    setPoolName("");
    await refresh();
  }, "Đã thêm pool.");

  const saveShareInfo = () => run(async () => {
    await mutateBoothDraw({
      action: "update_session",
      sessionId: current.session.id,
      name: shareName,
      startsAt: startsAt ? new Date(startsAt).toISOString() : null,
      endsAt: endsAt ? new Date(endsAt).toISOString() : null,
      venue,
      publicNote,
      shareEnabled,
    }, apiOptions);
    await refresh();
  }, "Đã lưu thông tin trang chia sẻ.");

  const beginEditPool = (pool: BoothPool) => {
    setEditingPoolId(pool.id);
    setEditingPoolName(pool.name);
    setEditingPoolColor(pool.color);
  };

  const savePool = () => {
    const pool = current.pools.find((item) => item.id === editingPoolId);
    if (!pool) return Promise.resolve();
    return run(async () => {
      await mutateBoothDraw({
        action: "update_pool",
        sessionId: current.session.id,
        poolId: pool.id,
        name: editingPoolName,
        color: editingPoolColor,
        sortOrder: pool.sort_order,
      }, apiOptions);
      setEditingPoolId("");
      await refresh();
    }, "Đã cập nhật pool.");
  };

  const remove = async (kind: "company" | "booth" | "pool", id: string, name: string) => {
    if (!(await confirm({ title: `Xóa “${name}”?`, description: "Chỉ có thể xóa dữ liệu chưa phát sinh kết quả quay.", destructive: true, confirmText: "Xóa" }))) return;
    await run(async () => {
      await mutateBoothDraw({ action: kind === "company" ? "delete_company" : kind === "booth" ? "delete_booth" : "delete_pool", sessionId: current.session.id, [`${kind}Id`]: id }, apiOptions);
      await refresh();
    }, "Đã xóa dữ liệu.");
  };

  return (
    <div className="space-y-6">
      <section className="glass overflow-hidden rounded-2xl">
        <div className="border-b border-slate-100 bg-gradient-to-r from-sky-50 to-cyan-50 px-5 py-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h3 className="flex items-center gap-2 font-bold text-slate-900"><MapIcon size={17} className="text-sky-500" /> Thông tin trang chia sẻ</h3>
              <p className="mt-1 text-xs text-slate-500">Tên, thời gian và địa điểm này sẽ hiển thị trên link xem sơ đồ dành cho khách.</p>
            </div>
            <label className="inline-flex cursor-pointer items-center gap-2 text-sm font-semibold text-slate-700">
              <input type="checkbox" checked={shareEnabled} onChange={(event) => setShareEnabled(event.target.checked)} disabled={!canManage} className="h-4 w-4 accent-sky-500" /> Cho phép xem qua link
            </label>
          </div>
        </div>
        <div className="grid gap-4 p-5 lg:grid-cols-2">
          <label className="block lg:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold text-slate-500">Tên sự kiện / phiên hiển thị</span>
            <input value={shareName} onChange={(event) => setShareName(event.target.value)} disabled={!canManage} className={fieldClass} placeholder="Triển lãm Y khoa 2026" />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500"><CalendarDays size={13} /> Bắt đầu</span>
            <input type="datetime-local" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} disabled={!canManage} className={fieldClass} />
          </label>
          <label className="block">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500"><CalendarDays size={13} /> Kết thúc</span>
            <input type="datetime-local" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} disabled={!canManage} className={fieldClass} />
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1.5 flex items-center gap-1.5 text-xs font-semibold text-slate-500"><MapPin size={13} /> Địa điểm</span>
            <input value={venue} onChange={(event) => setVenue(event.target.value)} disabled={!canManage} className={fieldClass} placeholder="Trung tâm Hội nghị…, 123 đường…" />
          </label>
          <label className="block lg:col-span-2">
            <span className="mb-1.5 block text-xs font-semibold text-slate-500">Ghi chú dành cho khách</span>
            <textarea rows={3} value={publicNote} onChange={(event) => setPublicNote(event.target.value)} disabled={!canManage} className={fieldClass} placeholder="Hướng dẫn check-in, giờ set-up gian hàng hoặc đầu mối liên hệ…" />
          </label>
          {canManage && <div className="flex flex-wrap items-center justify-between gap-3 lg:col-span-2">
            <p className="text-xs text-slate-500">Link xem không chứa passcode và chỉ cho phép tra cứu, không thể chỉnh sửa.</p>
            <button onClick={() => void saveShareInfo()} disabled={busy || !shareName.trim()} className={primaryButton}><Check size={16} /> Lưu thông tin</button>
          </div>}
        </div>
      </section>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {current.pools.map((pool) => {
          const companies = current.companies.filter((item) => item.pool_id === pool.id);
          const booths = current.booths.filter((item) => item.pool_id === pool.id);
          const drawn = current.assignments.filter((item) => item.pool_id === pool.id).length;
          const shortage = booths.length < companies.length;
          return (
            <div key={pool.id} className="glass relative overflow-hidden rounded-2xl p-4">
              <div className="absolute inset-x-0 top-0 h-1" style={{ background: pool.color }} />
              <div className="flex items-start justify-between gap-2">
                <div><p className="font-bold text-slate-900">{pool.name}</p><p className="text-[11px] font-semibold uppercase tracking-wider text-slate-400">{pool.code}</p></div>
                {canManage && current.session.status !== "finalized" && (
                  <div className="flex items-center gap-2">
                    <button onClick={() => beginEditPool(pool)} className="text-slate-300 hover:text-sky-600" title="Đổi tên và màu"><Pencil size={14} /></button>
                    {companies.length === 0 && booths.length === 0 && <button onClick={() => void remove("pool", pool.id, pool.name)} className="text-slate-300 hover:text-red-500" title="Xóa pool"><Trash2 size={14} /></button>}
                  </div>
                )}
              </div>
              <div className="mt-4 grid grid-cols-3 gap-2 text-center">
                <Metric value={companies.length} label="Công ty" />
                <Metric value={booths.length} label="Gian" />
                <Metric value={drawn} label="Đã quay" />
              </div>
              {shortage && <p className="mt-3 rounded-lg bg-red-50 px-2 py-1.5 text-[11px] font-medium text-red-600">Thiếu {companies.length - booths.length} gian</p>}
            </div>
          );
        })}
      </div>

      {canManage && current.session.status !== "finalized" && editingPoolId && (
        <section className="glass rounded-2xl border-sky-200 p-5">
          <h3 className="flex items-center gap-2 font-bold text-slate-900"><Pencil size={16} className="text-sky-500" /> Chỉnh sửa pool</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_90px_auto_auto]">
            <input value={editingPoolName} onChange={(event) => setEditingPoolName(event.target.value)} className={fieldClass} placeholder="Tên pool" />
            <input type="color" value={editingPoolColor} onChange={(event) => setEditingPoolColor(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white p-1" title="Màu pool" />
            <button onClick={() => void savePool()} disabled={busy || !editingPoolName.trim()} className={primaryButton}><Check size={16} /> Lưu</button>
            <button onClick={() => setEditingPoolId("")} disabled={busy} className={secondaryButton}>Huỷ</button>
          </div>
          <p className="mt-2 text-xs text-slate-500">Đổi tên không làm thay đổi công ty, gian hàng hay kết quả đã gắn với pool này.</p>
        </section>
      )}

      {canManage && current.session.status !== "finalized" && (
        <div className="grid gap-6 xl:grid-cols-2">
          <BulkCard icon={Users} title="Nhập công ty" hint="Mỗi dòng một công ty; các tên trùng sẽ được bỏ qua.">
            <select value={selectedCompanyPool} onChange={(event) => setCompanyPoolId(event.target.value)} className={fieldClass}>{current.pools.map((pool) => <option key={pool.id} value={pool.id}>Pool {pool.name}</option>)}</select>
            <textarea rows={7} value={companyText} onChange={(event) => setCompanyText(event.target.value)} className={fieldClass} placeholder={"Công ty ABC\nCông ty XYZ"} />
            <button onClick={() => void addCompanies()} disabled={busy || lines(companyText).length === 0 || !selectedCompanyPool} className={primaryButton}><Plus size={16} /> Thêm công ty</button>
          </BulkCard>
          <BulkCard icon={LayoutGrid} title="Nhập số gian hàng" hint="Mỗi dòng một mã gian; hệ thống tự đặt ô sơ bộ lên sơ đồ.">
            <select value={selectedBoothPool} onChange={(event) => setBoothPoolId(event.target.value)} className={fieldClass}>{current.pools.map((pool) => <option key={pool.id} value={pool.id}>Pool {pool.name}</option>)}</select>
            <textarea rows={7} value={boothText} onChange={(event) => setBoothText(event.target.value)} className={fieldClass} placeholder={"A01\nA02\nA03"} />
            <button onClick={() => void addBooths()} disabled={busy || lines(boothText).length === 0 || !selectedBoothPool} className={primaryButton}><Plus size={16} /> Thêm gian hàng</button>
          </BulkCard>
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <DataList title="Công ty" icon={Building2} empty="Chưa có công ty.">
          {current.pools.map((pool) => {
            const rows = current.companies.filter((item) => item.pool_id === pool.id);
            if (rows.length === 0) return null;
            return <ListGroup key={pool.id} pool={pool}>{rows.map((company) => <ListRow key={company.id} color={pool.color} main={company.name} detail={assignedCompanyIds.has(company.id) ? "Đã quay" : "Chưa quay"} onDelete={canManage && !assignedCompanyIds.has(company.id) && current.session.status !== "finalized" ? () => void remove("company", company.id, company.name) : undefined} />)}</ListGroup>;
          })}
        </DataList>
        <DataList title="Gian hàng" icon={LayoutGrid} empty="Chưa có gian hàng.">
          {current.pools.map((pool) => {
            const rows = current.booths.filter((item) => item.pool_id === pool.id);
            if (rows.length === 0) return null;
            return <ListGroup key={pool.id} pool={pool}>{rows.map((booth) => <ListRow key={booth.id} color={pool.color} main={booth.booth_code} detail={assignedBoothIds.has(booth.id) ? "Đã cấp" : "Còn trống"} onDelete={canManage && !assignedBoothIds.has(booth.id) && current.session.status !== "finalized" ? () => void remove("booth", booth.id, booth.booth_code) : undefined} />)}</ListGroup>;
          })}
        </DataList>
      </div>

      {canManage && current.session.status !== "finalized" && (
        <section className="glass rounded-2xl p-5">
          <h3 className="font-bold text-slate-900">Thêm pool khác</h3>
          <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_90px_auto]">
            <input value={poolName} onChange={(event) => setPoolName(event.target.value)} className={fieldClass} placeholder="Tên pool" />
            <input type="color" value={poolColor} onChange={(event) => setPoolColor(event.target.value)} className="h-11 w-full rounded-xl border border-slate-200 bg-white p-1" title="Màu pool" />
            <button onClick={() => void addPool()} disabled={busy || !poolName.trim()} className={secondaryButton}><Plus size={16} /> Thêm pool</button>
          </div>
        </section>
      )}
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return <div className="rounded-lg bg-slate-50 px-1 py-2"><p className="text-lg font-bold text-slate-800">{value}</p><p className="text-[10px] text-slate-400">{label}</p></div>;
}

function BulkCard({ icon: Icon, title, hint, children }: { icon: typeof Users; title: string; hint: string; children: React.ReactNode }) {
  return <section className="glass rounded-2xl p-5"><h3 className="flex items-center gap-2 font-bold text-slate-900"><Icon size={17} className="text-sky-500" /> {title}</h3><p className="mt-1 text-xs text-slate-500">{hint}</p><div className="mt-4 space-y-3">{children}</div></section>;
}

function DataList({ title, icon: Icon, empty, children }: { title: string; icon: typeof Users; empty: string; children: React.ReactNode }) {
  const rows = Array.isArray(children) ? children.filter(Boolean) : children;
  const isEmpty = Array.isArray(rows) && rows.length === 0;
  return <section className="glass rounded-2xl p-5"><h3 className="flex items-center gap-2 font-bold text-slate-900"><Icon size={17} className="text-sky-500" /> {title}</h3><div className="mt-4 max-h-[480px] space-y-4 overflow-auto pr-1">{isEmpty ? <p className="py-8 text-center text-sm text-slate-400">{empty}</p> : rows}</div></section>;
}

function ListGroup({ pool, children }: { pool: BoothPool; children: React.ReactNode }) {
  return <div><div className="mb-2 flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ background: pool.color }} /><span className="text-xs font-bold uppercase tracking-wider text-slate-500">{pool.name}</span></div><div className="space-y-1.5">{children}</div></div>;
}

function ListRow({ color, main, detail, onDelete }: { color: string; main: string; detail: string; onDelete?: () => void }) {
  return <div className="flex items-center gap-3 rounded-xl border border-slate-100 bg-white/70 px-3 py-2.5"><span className="h-7 w-1 rounded-full" style={{ background: color }} /><span className="min-w-0 flex-1 truncate text-sm font-medium text-slate-700">{main}</span><span className="text-xs text-slate-400">{detail}</span>{onDelete && <button onClick={onDelete} className="text-slate-300 hover:text-red-500"><Trash2 size={14} /></button>}</div>;
}

function MapTab({ current, canManage, busy, setNotice, onRefresh }: { current: BoothDrawState; canManage: boolean; busy: boolean; setNotice: (notice: Notice) => void; onRefresh: () => Promise<void> }) {
  const apiOptions = useBoothApiOptions();
  const confirm = useConfirm();
  const [selectedId, setSelectedId] = useState(current.booths[0]?.id ?? "");
  const [localBooths, setLocalBooths] = useState(current.booths);
  const [uploading, setUploading] = useState(false);
  const drag = useRef<{ id: string; pointerId: number; startX: number; startY: number; x: number; y: number; nextX: number; nextY: number } | null>(null);
  const selected = localBooths.find((booth) => booth.id === selectedId) ?? localBooths[0];
  const poolById = useMemo(() => new Map(current.pools.map((pool) => [pool.id, pool])), [current.pools]);
  const assignedByBooth = useMemo(() => new Map(current.assignments.map((item) => [item.booth_id, item])), [current.assignments]);
  const companyById = useMemo(() => new Map(current.companies.map((item) => [item.id, item])), [current.companies]);

  const patchLocal = (id: string, patch: Partial<BoothZone>) => {
    setLocalBooths((items) => items.map((item) => item.id === id ? { ...item, ...patch } : item));
  };

  const saveZone = async (zone: BoothZone) => {
    try {
      await mutateBoothDraw({ action: "update_booth", sessionId: current.session.id, boothId: zone.id, x: zone.x, y: zone.y, width: zone.width, height: zone.height, rotation: zone.rotation }, apiOptions);
      setNotice({ type: "success", text: `Đã lưu vị trí gian ${zone.booth_code}.` });
    } catch (error) {
      setNotice({ type: "error", text: errorText(error) });
      setLocalBooths(current.booths);
      await onRefresh();
    }
  };

  const pointerDown = (event: ReactPointerEvent<HTMLButtonElement>, zone: BoothZone) => {
    if (!canManage || current.session.status === "finalized") return;
    event.currentTarget.setPointerCapture(event.pointerId);
    drag.current = { id: zone.id, pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, x: zone.x, y: zone.y, nextX: zone.x, nextY: zone.y };
    setSelectedId(zone.id);
  };

  const pointerMove = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    const canvas = event.currentTarget.parentElement?.getBoundingClientRect();
    const zone = localBooths.find((item) => item.id === state.id);
    if (!canvas || !zone) return;
    const nextX = Math.max(0, Math.min(100 - zone.width, state.x + (event.clientX - state.startX) / canvas.width * 100));
    const nextY = Math.max(0, Math.min(100 - zone.height, state.y + (event.clientY - state.startY) / canvas.height * 100));
    state.nextX = nextX;
    state.nextY = nextY;
    patchLocal(state.id, { x: nextX, y: nextY });
  };

  const pointerUp = (event: ReactPointerEvent<HTMLButtonElement>) => {
    const state = drag.current;
    if (!state || state.pointerId !== event.pointerId) return;
    drag.current = null;
    const zone = localBooths.find((item) => item.id === state.id);
    if (zone) void saveZone({ ...zone, x: state.nextX, y: state.nextY });
  };

  const upload = async (file?: File) => {
    if (!file || !canManage) return;
    setUploading(true);
    setNotice(null);
    try {
      await uploadBoothMap(current.session.id, file, apiOptions);
      setNotice({ type: "success", text: "Đã tải sơ đồ lên." });
      await onRefresh();
    } catch (error) {
      setNotice({ type: "error", text: errorText(error) });
    } finally {
      setUploading(false);
    }
  };

  const applyStyleToPool = async () => {
    if (!selected || !canManage) return;
    const pool = poolById.get(selected.pool_id);
    const count = localBooths.filter((booth) => booth.pool_id === selected.pool_id).length;
    const accepted = await confirm({
      title: `Áp dụng cho ${count} gian pool ${pool?.name ?? "này"}?`,
      description: "Chiều rộng, chiều cao và góc xoay của ô đang chọn sẽ được áp dụng cho tất cả gian trong pool. Vị trí X/Y của từng gian vẫn được giữ riêng.",
      confirmText: "Áp dụng tất cả",
    });
    if (!accepted) return;
    setNotice(null);
    try {
      await mutateBoothDraw({
        action: "apply_booth_style_to_pool",
        sessionId: current.session.id,
        poolId: selected.pool_id,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
      }, apiOptions);
      setLocalBooths((items) => items.map((booth) => booth.pool_id === selected.pool_id ? {
        ...booth,
        width: selected.width,
        height: selected.height,
        rotation: selected.rotation,
        x: Math.min(booth.x, 100 - selected.width),
        y: Math.min(booth.y, 100 - selected.height),
      } : booth));
      setNotice({ type: "success", text: `Đã áp dụng kích thước cho ${count} gian thuộc pool ${pool?.name ?? "đã chọn"}.` });
      await onRefresh();
    } catch (error) {
      setNotice({ type: "error", text: errorText(error) });
    }
  };

  return (
    <div className="grid gap-6 xl:grid-cols-[1fr_320px]">
      <section className="glass rounded-2xl p-4 sm:p-5">
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><h3 className="font-bold text-slate-900">Sơ đồ 2D tương tác</h3><p className="mt-1 text-xs text-slate-500">Kéo ô gian hàng tới đúng vị trí; dùng bảng bên phải để chỉnh kích thước và góc xoay.</p></div>
          {canManage && current.session.status !== "finalized" && (
            <label className={cn(secondaryButton, "cursor-pointer")}>
              {uploading ? <Loader2 size={16} className="animate-spin" /> : <Upload size={16} />} {current.mapUrl ? "Thay ảnh" : "Tải sơ đồ"}
              <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" disabled={uploading || busy} onChange={(event) => void upload(event.target.files?.[0])} />
            </label>
          )}
        </div>
        <div className="relative aspect-video w-full touch-none overflow-hidden rounded-xl border border-slate-200 bg-white" style={!current.mapUrl ? { backgroundImage: "linear-gradient(#e2e8f0 1px, transparent 1px), linear-gradient(90deg, #e2e8f0 1px, transparent 1px)", backgroundSize: "24px 24px" } : undefined}>
          {current.mapUrl ? <MapImage src={current.mapUrl} /> : <div className="absolute inset-0 grid place-items-center text-center text-slate-400"><div><ImagePlus className="mx-auto mb-2" size={32} /><p className="text-sm font-medium">Chưa tải ảnh sơ đồ</p><p className="mt-1 text-xs">Bạn vẫn có thể sắp ô trên lưới tạm</p></div></div>}
          {localBooths.map((zone) => {
            const pool = poolById.get(zone.pool_id);
            const assignment = assignedByBooth.get(zone.id);
            const company = assignment ? companyById.get(assignment.company_id) : undefined;
            return (
              <button
                key={zone.id}
                type="button"
                onPointerDown={(event) => pointerDown(event, zone)}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={pointerUp}
                onClick={() => setSelectedId(zone.id)}
                className={cn("absolute grid select-none place-items-center overflow-hidden border-2 text-[10px] font-black shadow-md transition-shadow sm:text-xs", selected?.id === zone.id ? "z-20 ring-4 ring-sky-300/60" : "z-10 hover:z-20 hover:ring-2 hover:ring-white", canManage && current.session.status !== "finalized" ? "cursor-move" : "cursor-default")}
                style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.width}%`, height: `${zone.height}%`, transform: `rotate(${zone.rotation}deg)`, borderColor: pool?.color ?? "#0ea5e9", background: `${pool?.color ?? "#0ea5e9"}d9`, color: "white" }}
                title={company ? `${zone.booth_code} · ${company.name}` : `${zone.booth_code} · Còn trống`}
              >
                <span className="truncate px-1 drop-shadow">{zone.booth_code}</span>
              </button>
            );
          })}
        </div>
        <div className="mt-3 flex flex-wrap gap-3 text-xs text-slate-500">{current.pools.map((pool) => <span key={pool.id} className="inline-flex items-center gap-1.5"><span className="h-2.5 w-2.5 rounded-full" style={{ background: pool.color }} />{pool.name}</span>)}</div>
      </section>

      <section className="glass h-fit rounded-2xl p-5">
        <h3 className="font-bold text-slate-900">Thuộc tính ô gian</h3>
        {!selected ? <p className="mt-5 text-sm text-slate-500">Chưa có gian hàng để bố trí.</p> : (
          <div className="mt-4 space-y-4">
            <div className="rounded-xl border border-slate-100 bg-white p-3"><p className="text-xl font-black text-slate-900">{selected.booth_code}</p><p className="text-xs text-slate-500">Pool {poolById.get(selected.pool_id)?.name}</p>{assignedByBooth.has(selected.id) && <p className="mt-2 text-xs font-medium text-emerald-600">{companyById.get(assignedByBooth.get(selected.id)!.company_id)?.name}</p>}</div>
            <ZoneField label="Trái (X)" value={selected.x} max={100 - selected.width} disabled={!canManage || current.session.status === "finalized"} onChange={(value) => patchLocal(selected.id, { x: value })} onCommit={() => void saveZone(selected)} />
            <ZoneField label="Trên (Y)" value={selected.y} max={100 - selected.height} disabled={!canManage || current.session.status === "finalized"} onChange={(value) => patchLocal(selected.id, { y: value })} onCommit={() => void saveZone(selected)} />
            <ZoneField label="Chiều rộng" value={selected.width} min={1} max={100 - selected.x} disabled={!canManage || current.session.status === "finalized"} onChange={(value) => patchLocal(selected.id, { width: value })} onCommit={() => void saveZone(selected)} />
            <ZoneField label="Chiều cao" value={selected.height} min={1} max={100 - selected.y} disabled={!canManage || current.session.status === "finalized"} onChange={(value) => patchLocal(selected.id, { height: value })} onCommit={() => void saveZone(selected)} />
            <ZoneField label="Góc xoay" value={selected.rotation} min={-180} max={180} disabled={!canManage || current.session.status === "finalized"} onChange={(value) => patchLocal(selected.id, { rotation: value })} onCommit={() => void saveZone(selected)} />
            <button onClick={() => void applyStyleToPool()} disabled={!canManage || busy || current.session.status === "finalized"} className={cn(secondaryButton, "w-full")}>
              <LayoutGrid size={16} /> Áp dụng cho tất cả gian cùng pool
            </button>
            <p className="rounded-xl bg-sky-50 p-3 text-xs leading-5 text-sky-700"><CircleHelp size={14} className="mr-1 inline" /> Tọa độ dùng phần trăm nên sơ đồ giữ đúng vị trí trên màn hình lớn lẫn nhỏ.</p>
          </div>
        )}
      </section>
    </div>
  );
}

function ZoneField({ label, value, min = 0, max, disabled, onChange, onCommit }: { label: string; value: number; min?: number; max: number; disabled: boolean; onChange: (value: number) => void; onCommit: () => void }) {
  const safeMax = Math.max(min, max);
  const update = (raw: string) => {
    if (raw === "") return;
    const number = Number(raw);
    if (Number.isFinite(number)) onChange(Math.max(min, Math.min(safeMax, number)));
  };
  return <label className="block"><span className="mb-1 block text-xs font-semibold text-slate-500">{label}</span><div className="grid grid-cols-[1fr_82px] items-center gap-3"><input type="range" value={value} min={min} max={safeMax} step="0.2" disabled={disabled} onChange={(event) => onChange(Number(event.target.value))} onPointerUp={onCommit} onKeyUp={onCommit} className="w-full accent-sky-500" /><input type="number" value={Number(value).toFixed(1)} min={min} max={safeMax} step="0.2" disabled={disabled} onChange={(event) => update(event.target.value)} onBlur={onCommit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); onCommit(); } }} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-right text-xs font-semibold text-slate-700 outline-none focus:border-sky-400 disabled:bg-slate-50" /></div></label>;
}

function DrawTab({ current, canManage, busy, run, refresh }: { current: BoothDrawState; canManage: boolean; busy: boolean; run: RunOperation; refresh: () => Promise<void> }) {
  const apiOptions = useBoothApiOptions();
  const [poolId, setPoolId] = useState("");
  const [companyId, setCompanyId] = useState("");
  const [rotation, setRotation] = useState(0);
  const [spinning, setSpinning] = useState(false);
  const [winner, setWinner] = useState<BoothDrawRpcResult | null>(null);
  const activePoolId = poolId || current.pools[0]?.id || "";
  const pool = current.pools.find((item) => item.id === activePoolId);
  const assignedCompanies = useMemo(() => new Set(current.assignments.map((item) => item.company_id)), [current.assignments]);
  const assignedBooths = useMemo(() => new Set(current.assignments.map((item) => item.booth_id)), [current.assignments]);
  const drawnBooths = useMemo(() => new Set(current.results.map((item) => item.booth_id)), [current.results]);
  const companies = current.companies.filter((item) => item.pool_id === activePoolId && item.active && !assignedCompanies.has(item.id));
  const booths = current.booths.filter((item) => item.pool_id === activePoolId && item.active && !assignedBooths.has(item.id) && !drawnBooths.has(item.id));
  const selectedCompanyId = companies.some((item) => item.id === companyId) ? companyId : companies[0]?.id ?? "";
  const wheelGradient = booths.length > 0 ? `conic-gradient(${booths.map((_, index) => `${index % 2 === 0 ? pool?.color ?? "#0ea5e9" : "#e0f2fe"} ${index / booths.length * 100}% ${(index + 1) / booths.length * 100}%`).join(",")})` : "#e2e8f0";

  const spin = () => run(async () => {
    if (!selectedCompanyId || booths.length === 0) throw new Error("Pool chưa đủ công ty hoặc gian hàng còn lại.");
    setSpinning(true);
    setWinner(null);
    let result: BoothDrawRpcResult;
    try {
      const response = await mutateBoothDraw<{ result: BoothDrawRpcResult }>({ action: "draw", sessionId: current.session.id, companyId: selectedCompanyId, requestKey: crypto.randomUUID() }, apiOptions);
      result = response.result;
      if (!result) throw new Error("Không nhận được kết quả quay.");
      const selectedIndex = Math.max(0, booths.findIndex((item) => item.id === result.booth_id));
      const segment = 360 / Math.max(1, booths.length);
      setRotation((value) => {
        const normalized = ((value % 360) + 360) % 360;
        const target = (360 - selectedIndex * segment - segment / 2 + 360) % 360;
        return value + 1800 + (target - normalized + 360) % 360;
      });
      await new Promise((resolve) => window.setTimeout(resolve, 3600));
      setWinner(result);
    } finally {
      setSpinning(false);
    }
  });

  const closeWinner = async () => {
    setWinner(null);
    setCompanyId("");
    await refresh();
  };

  const poolStats = current.pools.map((item) => {
    const totalCompanies = current.companies.filter((company) => company.pool_id === item.id).length;
    const done = current.assignments.filter((assignment) => assignment.pool_id === item.id).length;
    const available = current.booths.filter((booth) => booth.pool_id === item.id && !assignedBooths.has(booth.id) && !drawnBooths.has(booth.id)).length;
    return { ...item, totalCompanies, done, available };
  });

  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[360px_1fr]">
        <section className="glass h-fit rounded-2xl p-5">
          <h3 className="font-bold text-slate-900">Lượt quay tiếp theo</h3>
          <div className="mt-4 space-y-4">
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-500">Pool tài trợ</span><select value={activePoolId} onChange={(event) => { setPoolId(event.target.value); setCompanyId(""); }} className={fieldClass}>{current.pools.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
            <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-500">Công ty</span><select value={selectedCompanyId} onChange={(event) => setCompanyId(event.target.value)} className={fieldClass}><option value="">Chọn công ty…</option>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</select></label>
            <div className="grid grid-cols-2 gap-3"><Metric value={companies.length} label="Công ty chưa quay" /><Metric value={booths.length} label="Gian còn lại" /></div>
            {companies.length > booths.length && <p className="rounded-xl border border-red-200 bg-red-50 p-3 text-xs leading-5 text-red-700">Pool {pool?.name} thiếu {companies.length - booths.length} gian hàng. Hãy bổ sung trước khi quay hết.</p>}
            <button onClick={() => void spin()} disabled={!canManage || busy || spinning || !selectedCompanyId || booths.length === 0 || current.session.status === "finalized"} className={cn(primaryButton, "w-full py-3")}><Dices size={18} /> {spinning ? "Đang quay…" : "Quay gian hàng"}</button>
            {current.session.status === "finalized" && <p className="text-center text-xs text-slate-500">Phiên đã chốt, không thể quay thêm.</p>}
          </div>
        </section>

        <section className="glass rounded-2xl p-5 sm:p-8">
          <div className="mx-auto flex max-w-2xl flex-col items-center">
            <div className="relative w-full max-w-[480px]">
              <div className="absolute -top-3 left-1/2 z-20 h-0 w-0 -translate-x-1/2 border-x-[16px] border-t-[28px] border-x-transparent border-t-red-500 drop-shadow" />
              <div className="relative aspect-square w-full rounded-full border-[10px] border-white shadow-2xl transition-transform duration-[3500ms] ease-[cubic-bezier(.12,.8,.18,1)]" style={{ background: wheelGradient, transform: `rotate(${rotation}deg)` }}>
                {booths.length <= 36 && booths.map((booth, index) => (
                  <span
                    key={booth.id}
                    className="absolute left-1/2 top-1/2 z-10 w-[47%] origin-left -translate-y-1/2 pr-2 text-right text-[9px] font-black text-slate-900 sm:text-[11px]"
                    style={{ transform: `translateY(-50%) rotate(${(index + 0.5) * 360 / booths.length - 90}deg)` }}
                  >
                    <span className="rounded bg-white/75 px-1 py-0.5 shadow-sm">{booth.booth_code}</span>
                  </span>
                ))}
                <div className="absolute inset-[36%] z-20 grid place-items-center rounded-full border-8 border-white bg-slate-900 text-center text-white shadow-xl"><Dices size={30} /><span className="mt-1 text-[10px] font-bold uppercase tracking-wider">{pool?.name ?? "Pool"}</span></div>
              </div>
            </div>
            <div className="mt-7 flex max-h-28 flex-wrap justify-center gap-2 overflow-auto">{booths.map((booth) => <span key={booth.id} className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-bold text-slate-600">{booth.booth_code}</span>)}</div>
          </div>
        </section>
      </div>

      <section className="glass mt-6 rounded-2xl p-5">
        <h3 className="mb-4 font-bold text-slate-900">Tiến độ theo pool</h3>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">{poolStats.map((item) => <div key={item.id} className="rounded-xl border border-slate-100 bg-white p-3"><div className="mb-2 flex items-center justify-between"><span className="text-sm font-bold text-slate-700">{item.name}</span><span className="h-2.5 w-2.5 rounded-full" style={{ background: item.color }} /></div><div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full" style={{ width: `${item.totalCompanies ? item.done / item.totalCompanies * 100 : 0}%`, background: item.color }} /></div><p className="mt-2 text-xs text-slate-500">{item.done}/{item.totalCompanies} đã quay · {item.available} gian trống</p></div>)}</div>
      </section>

      {winner && <WinnerOverlay current={current} winner={winner} onClose={() => void closeWinner()} />}
    </>
  );
}

function WinnerOverlay({ current, winner, onClose }: { current: BoothDrawState; winner: BoothDrawRpcResult; onClose: () => void }) {
  const zone = current.booths.find((item) => item.id === winner.booth_id);
  return (
    <div className="fixed inset-0 z-[80] overflow-auto bg-slate-950/80 p-4 backdrop-blur-md">
      <div className="mx-auto flex min-h-full max-w-6xl items-center justify-center">
        <div className="w-full overflow-hidden rounded-3xl bg-white shadow-2xl">
          <div className="p-5 text-center text-white" style={{ background: `linear-gradient(135deg, ${winner.pool_color}, #0f172a)` }}><p className="text-sm font-semibold uppercase tracking-[0.25em]">Kết quả pool {winner.pool_name}</p><h2 className="mt-2 text-3xl font-black sm:text-5xl">Gian {winner.booth_code}</h2><p className="mt-2 text-lg font-semibold">{winner.company_name}</p></div>
          <div className="p-4 sm:p-6">
            <div className="relative aspect-video overflow-hidden rounded-2xl border border-slate-200 bg-slate-100" style={!current.mapUrl ? { backgroundImage: "linear-gradient(#cbd5e1 1px, transparent 1px), linear-gradient(90deg, #cbd5e1 1px, transparent 1px)", backgroundSize: "24px 24px" } : undefined}>
              {current.mapUrl && <MapImage src={current.mapUrl} />}
              {zone && <div className="absolute z-10 grid animate-pulse place-items-center border-4 border-white bg-red-500 text-sm font-black text-white shadow-[0_0_0_8px_rgba(239,68,68,.35),0_0_40px_rgba(239,68,68,.9)] sm:text-xl" style={{ left: `${zone.x}%`, top: `${zone.y}%`, width: `${zone.width}%`, height: `${zone.height}%`, transform: `rotate(${zone.rotation}deg)` }}>{winner.booth_code}</div>}
            </div>
            <button onClick={onClose} className={cn(primaryButton, "mx-auto mt-5 min-w-40 py-3")}><Check size={18} /> OK, quay tiếp</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function MapImage({ src }: { src: string }) {
  // Signed private-storage URLs should be loaded directly rather than cached by
  // the Next image optimizer after their token expires.
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={src} alt="Sơ đồ gian hàng" className="pointer-events-none absolute inset-0 h-full w-full select-none object-fill" />;
}

function ExchangeTab({ current, canManage, busy, run, refresh }: { current: BoothDrawState; canManage: boolean; busy: boolean; run: RunOperation; refresh: () => Promise<void> }) {
  const apiOptions = useBoothApiOptions();
  const [poolId, setPoolId] = useState("");
  const [mode, setMode] = useState<"swap" | "move">("swap");
  const [companyA, setCompanyA] = useState("");
  const [companyB, setCompanyB] = useState("");
  const [targetBooth, setTargetBooth] = useState("");
  const [reason, setReason] = useState("");
  const activePoolId = poolId || current.pools[0]?.id || "";
  const companyById = useMemo(() => new Map(current.companies.map((item) => [item.id, item])), [current.companies]);
  const boothById = useMemo(() => new Map(current.booths.map((item) => [item.id, item])), [current.booths]);
  const assignmentByCompany = useMemo(() => new Map(current.assignments.map((item) => [item.company_id, item])), [current.assignments]);
  const occupied = useMemo(() => new Set(current.assignments.map((item) => item.booth_id)), [current.assignments]);
  const poolAssignments = current.assignments.filter((item) => item.pool_id === activePoolId);
  const emptyBooths = current.booths.filter((item) => item.pool_id === activePoolId && item.active && !occupied.has(item.id));

  const submit = () => run(async () => {
    if (mode === "swap") {
      await mutateBoothDraw({ action: "swap", sessionId: current.session.id, companyAId: companyA, companyBId: companyB, reason }, apiOptions);
    } else {
      await mutateBoothDraw({ action: "move", sessionId: current.session.id, companyId: companyA, targetBoothId: targetBooth, reason }, apiOptions);
    }
    setCompanyA(""); setCompanyB(""); setTargetBooth(""); setReason("");
    await refresh();
  }, mode === "swap" ? "Đã đổi gian cho hai công ty." : "Đã chuyển công ty sang gian trống.");

  return (
    <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
      <section className="glass h-fit rounded-2xl p-5">
        <h3 className="flex items-center gap-2 font-bold text-slate-900"><Shuffle size={17} className="text-violet-500" /> Thực hiện trao đổi</h3>
        <p className="mt-1 text-xs leading-5 text-slate-500">Chỉ đổi trong cùng pool. Kết quả quay gốc được giữ nguyên; thay đổi này được ghi vào nhật ký.</p>
        <div className="mt-4 grid grid-cols-2 rounded-xl bg-slate-100 p-1"><button onClick={() => setMode("swap")} className={cn("rounded-lg px-3 py-2 text-sm font-semibold", mode === "swap" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500")}>Đổi 2 công ty</button><button onClick={() => setMode("move")} className={cn("rounded-lg px-3 py-2 text-sm font-semibold", mode === "move" ? "bg-white text-violet-700 shadow-sm" : "text-slate-500")}>Chuyển sang gian trống</button></div>
        <div className="mt-4 space-y-4">
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-500">Pool</span><select value={activePoolId} onChange={(event) => { setPoolId(event.target.value); setCompanyA(""); setCompanyB(""); setTargetBooth(""); }} className={fieldClass}>{current.pools.map((pool) => <option key={pool.id} value={pool.id}>{pool.name}</option>)}</select></label>
          <AssignmentSelect label={mode === "swap" ? "Công ty A" : "Công ty cần chuyển"} value={companyA} assignments={poolAssignments} companyById={companyById} boothById={boothById} onChange={setCompanyA} />
          {mode === "swap" ? <AssignmentSelect label="Công ty B" value={companyB} assignments={poolAssignments.filter((item) => item.company_id !== companyA)} companyById={companyById} boothById={boothById} onChange={setCompanyB} /> : <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-500">Gian trống đích</span><select value={targetBooth} onChange={(event) => setTargetBooth(event.target.value)} className={fieldClass}><option value="">Chọn gian trống…</option>{emptyBooths.map((booth) => <option key={booth.id} value={booth.id}>{booth.booth_code}</option>)}</select></label>}
          <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-500">Lý do / ghi chú</span><textarea rows={3} value={reason} onChange={(event) => setReason(event.target.value)} className={fieldClass} placeholder="Hai công ty đã thống nhất đổi vị trí…" /></label>
          <button onClick={() => void submit()} disabled={!canManage || busy || current.session.status === "finalized" || !companyA || (mode === "swap" ? !companyB : !targetBooth)} className={cn(primaryButton, "w-full bg-violet-600 hover:bg-violet-700")}><ArrowRightLeft size={16} /> Xác nhận {mode === "swap" ? "đổi gian" : "chuyển gian"}</button>
          {current.session.status === "finalized" && <p className="text-center text-xs text-slate-500">Mở lại phiên nếu cần thay đổi.</p>}
        </div>
      </section>

      <section className="glass rounded-2xl p-5">
        <h3 className="font-bold text-slate-900">Vị trí hiện tại</h3>
        <div className="mt-4 grid gap-3 md:grid-cols-2">{current.pools.map((pool) => {
          const rows = current.assignments.filter((item) => item.pool_id === pool.id);
          return <div key={pool.id} className="rounded-2xl border border-slate-100 bg-white p-4"><div className="mb-3 flex items-center gap-2"><span className="h-3 w-3 rounded-full" style={{ background: pool.color }} /><h4 className="text-sm font-bold text-slate-800">{pool.name}</h4><span className="ml-auto text-xs text-slate-400">{rows.length}</span></div><div className="space-y-2">{rows.length === 0 ? <p className="py-3 text-center text-xs text-slate-400">Chưa có kết quả</p> : rows.map((assignment) => <div key={assignment.id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-3 py-2 text-sm"><span className="min-w-0 flex-1 truncate text-slate-600">{companyById.get(assignment.company_id)?.name}</span><ArrowRightLeft size={12} className="text-slate-300" /><span className="font-black text-slate-900">{boothById.get(assignment.booth_id)?.booth_code}</span></div>)}</div></div>;
        })}</div>
        {current.assignments.length === 0 && <div className="mt-5 rounded-xl bg-amber-50 p-4 text-sm text-amber-700">Chưa có công ty nào quay gian hàng.</div>}
        {companyA && <ExchangePreview mode={mode} first={assignmentByCompany.get(companyA)} second={assignmentByCompany.get(companyB)} target={boothById.get(targetBooth)} companyById={companyById} boothById={boothById} />}
      </section>
    </div>
  );
}

function AssignmentSelect({ label, value, assignments, companyById, boothById, onChange }: { label: string; value: string; assignments: BoothAssignment[]; companyById: Map<string, BoothCompany>; boothById: Map<string, BoothZone>; onChange: (value: string) => void }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-500">{label}</span><select value={value} onChange={(event) => onChange(event.target.value)} className={fieldClass}><option value="">Chọn công ty…</option>{assignments.map((assignment) => <option key={assignment.id} value={assignment.company_id}>{companyById.get(assignment.company_id)?.name} — Gian {boothById.get(assignment.booth_id)?.booth_code}</option>)}</select></label>;
}

function ExchangePreview({ mode, first, second, target, companyById, boothById }: { mode: "swap" | "move"; first?: BoothAssignment; second?: BoothAssignment; target?: BoothZone; companyById: Map<string, BoothCompany>; boothById: Map<string, BoothZone> }) {
  if (!first) return null;
  const firstName = companyById.get(first.company_id)?.name;
  const firstBooth = boothById.get(first.booth_id)?.booth_code;
  return <div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50 p-4"><p className="text-xs font-bold uppercase tracking-wider text-violet-500">Xem trước</p>{mode === "swap" && second ? <div className="mt-2 space-y-2 text-sm text-violet-900"><p><strong>{firstName}</strong>: {firstBooth} → {boothById.get(second.booth_id)?.booth_code}</p><p><strong>{companyById.get(second.company_id)?.name}</strong>: {boothById.get(second.booth_id)?.booth_code} → {firstBooth}</p></div> : target ? <p className="mt-2 text-sm text-violet-900"><strong>{firstName}</strong>: {firstBooth} → {target.booth_code}</p> : null}</div>;
}

function HistoryTab({ current }: { current: BoothDrawState }) {
  const companyById = useMemo(() => new Map(current.companies.map((item) => [item.id, item])), [current.companies]);
  const boothById = useMemo(() => new Map(current.booths.map((item) => [item.id, item])), [current.booths]);
  const poolById = useMemo(() => new Map(current.pools.map((item) => [item.id, item])), [current.pools]);
  const currentByCompany = useMemo(() => new Map(current.assignments.map((item) => [item.company_id, item])), [current.assignments]);
  return (
    <div className="space-y-6">
      <section className="glass overflow-hidden rounded-2xl">
        <div className="border-b border-slate-100 p-5"><h3 className="font-bold text-slate-900">Kết quả quay gốc</h3><p className="mt-1 text-xs text-slate-500">Bảng này không thay đổi khi các công ty trao đổi gian.</p></div>
        <div className="overflow-x-auto"><table className="w-full min-w-[760px] text-left text-sm"><thead className="bg-slate-50 text-xs uppercase tracking-wider text-slate-400"><tr><th className="px-5 py-3">Thời gian</th><th className="px-5 py-3">Pool</th><th className="px-5 py-3">Công ty</th><th className="px-5 py-3">Gian quay được</th><th className="px-5 py-3">Gian hiện tại</th></tr></thead><tbody className="divide-y divide-slate-100">{current.results.map((result) => { const assignment = currentByCompany.get(result.company_id); const changed = assignment?.booth_id !== result.booth_id; return <tr key={result.id} className="bg-white/60"><td className="px-5 py-3 text-slate-500">{dateTime(result.drawn_at)}</td><td className="px-5 py-3"><span className="inline-flex items-center gap-1.5"><span className="h-2 w-2 rounded-full" style={{ background: poolById.get(result.pool_id)?.color }} />{poolById.get(result.pool_id)?.name}</span></td><td className="px-5 py-3 font-medium text-slate-700">{companyById.get(result.company_id)?.name}</td><td className="px-5 py-3 font-black text-slate-900">{boothById.get(result.booth_id)?.booth_code}</td><td className="px-5 py-3"><span className={cn("font-black", changed ? "text-violet-600" : "text-slate-900")}>{assignment ? boothById.get(assignment.booth_id)?.booth_code : "—"}</span>{changed && <span className="ml-2 rounded-full bg-violet-50 px-2 py-0.5 text-[10px] font-bold text-violet-600">Đã đổi</span>}</td></tr>; })}{current.results.length === 0 && <tr><td colSpan={5} className="px-5 py-12 text-center text-slate-400">Chưa có lượt quay.</td></tr>}</tbody></table></div>
      </section>

      <section className="glass rounded-2xl p-5">
        <h3 className="font-bold text-slate-900">Nhật ký trao đổi</h3>
        <div className="mt-4 space-y-3">{current.exchanges.map((log) => {
          const firstName = companyById.get(log.company_a_id)?.name;
          const secondName = log.company_b_id ? companyById.get(log.company_b_id)?.name : null;
          return <div key={log.id} className="rounded-xl border border-slate-100 bg-white p-4"><div className="flex flex-wrap items-center justify-between gap-2"><span className="rounded-full bg-violet-50 px-2.5 py-1 text-[11px] font-bold text-violet-700">{log.action === "swap" ? "Đổi 2 công ty" : "Chuyển gian trống"}</span><span className="text-xs text-slate-400">{dateTime(log.created_at)}</span></div><p className="mt-3 text-sm text-slate-700">{log.action === "swap" ? <><strong>{firstName}</strong>: {boothById.get(log.booth_a_before_id)?.booth_code} → {boothById.get(log.booth_a_after_id)?.booth_code}; <strong>{secondName}</strong>: {log.booth_b_before_id ? boothById.get(log.booth_b_before_id)?.booth_code : "—"} → {log.booth_b_after_id ? boothById.get(log.booth_b_after_id)?.booth_code : "—"}</> : <><strong>{firstName}</strong>: {boothById.get(log.booth_a_before_id)?.booth_code} → {boothById.get(log.booth_a_after_id)?.booth_code}</>}</p>{log.reason && <p className="mt-2 text-xs italic text-slate-500">“{log.reason}”</p>}<p className="mt-2 text-[11px] text-slate-400">Thực hiện bởi {log.created_by ?? "—"}</p></div>;
        })}{current.exchanges.length === 0 && <p className="rounded-xl bg-slate-50 py-10 text-center text-sm text-slate-400">Chưa có trao đổi nào.</p>}</div>
      </section>
    </div>
  );
}
