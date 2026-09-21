"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import {
  Crown,
  Loader2,
  Pause,
  Play,
  Plus,
  QrCode,
  RotateCcw,
  Settings2,
  Square,
  Trash2,
  Users,
} from "lucide-react";
import { supabase } from "@/lib/supabase";
import { QRCodeView } from "@/components/ui/QRCodeView";
import { buildPublicUrl } from "@/lib/site-url";
import { useConfirm } from "@/lib/ui/confirm";
import { subscribeRoom, type FlapRoomSnapshot } from "@/lib/flap/realtime";
import { MAX_TEAMS, MIN_TEAMS, TEAM_PALETTE, type FlapTeam } from "@/lib/flap/race";

type Room = FlapRoomSnapshot["room"];

const DEFAULT_TEAMS: FlapTeam[] = [
  { id: "team-1", name: "Bàn 1", color: TEAM_PALETTE[0], capacity: null },
  { id: "team-2", name: "Bàn 2", color: TEAM_PALETTE[1], capacity: null },
  { id: "team-3", name: "Bàn 3", color: TEAM_PALETTE[2], capacity: null },
  { id: "team-4", name: "Bàn 4", color: TEAM_PALETTE[3], capacity: null },
];

export function FlapRaceManager() {
  const confirm = useConfirm();
  const [room, setRoom] = useState<Room | null>(null);
  const [snapshot, setSnapshot] = useState<FlapRoomSnapshot | null>(null);
  const [teams, setTeams] = useState<FlapTeam[]>(DEFAULT_TEAMS);
  const [title, setTitle] = useState("Lắc điện thoại - Đại bàng tung cánh");
  const [trackLength, setTrackLength] = useState(1000);
  const [duration, setDuration] = useState(60);
  const [scoreMode, setScoreMode] = useState<"total" | "average">("average");
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<"setup" | "control" | "players">("setup");

  const authHeaders = useCallback(async () => {
    const { data } = await supabase.auth.getSession();
    const token = data.session?.access_token;
    return {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    };
  }, []);

  const loadRoom = useCallback(
    async (roomCode: string) => {
      const res = await fetch(`/api/flap/${encodeURIComponent(roomCode)}`, { cache: "no-store" });
      if (!res.ok) return null;
      const json = (await res.json()) as FlapRoomSnapshot;
      setSnapshot(json);
      setRoom(json.room);
      setTeams(json.room.teams);
      setTitle(json.room.title);
      setTrackLength(json.room.track_length);
      setDuration(json.room.duration_sec);
      setScoreMode(json.room.score_mode);
      return json;
    },
    [],
  );

  // Nhớ phòng đang điều khiển giữa các lần tải lại trang.
  useEffect(() => {
    const saved = window.localStorage.getItem("flap-room-code");
    if (!saved) return;
    // Gọi trong microtask để không setState đồng bộ ngay trong thân effect.
    queueMicrotask(() => {
      void loadRoom(saved);
    });
  }, [loadRoom]);

  useEffect(() => {
    if (!room) return;
    const sub = subscribeRoom(room.code, () => void loadRoom(room.code));
    const sync = setInterval(() => void loadRoom(room.code), 2000);
    return () => {
      sub.close();
      clearInterval(sync);
    };
  }, [room, loadRoom]);

  const createRoom = useCallback(async () => {
    setBusy(true);
    try {
      // Sinh mã phòng ngẫu nhiên ở client để MC biết trước khi gọi API.
      const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      let generated = "";
      for (let i = 0; i < 6; i += 1) generated += alphabet[Math.floor(Math.random() * alphabet.length)];

      const res = await fetch(`/api/flap/${generated}`, {
        method: "POST",
        headers: await authHeaders(),
        body: JSON.stringify({
          action: "create",
          title,
          teams,
          track_length: trackLength,
          duration_sec: duration,
          score_mode: scoreMode,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string; detail?: string } | null;
        toast.error(body?.detail || body?.error || "Không tạo được phòng.");
        return;
      }
      window.localStorage.setItem("flap-room-code", generated);
      await loadRoom(generated);
      toast.success(`Đã tạo phòng ${generated}`);
      setTab("control");
    } finally {
      setBusy(false);
    }
  }, [authHeaders, duration, loadRoom, scoreMode, teams, title, trackLength]);

  const control = useCallback(
    async (action: string, extra: Record<string, unknown> = {}) => {
      if (!room) return;
      setBusy(true);
      try {
        const res = await fetch(`/api/flap/${encodeURIComponent(room.code)}`, {
          method: "PUT",
          headers: await authHeaders(),
          body: JSON.stringify({ action, ...extra }),
        });
        const body = (await res.json().catch(() => null)) as {
          error?: string;
          detail?: string;
          room?: Room;
          summary?: unknown;
        } | null;
        if (!res.ok) {
          toast.error(body?.detail || body?.error || "Thao tác thất bại.");
          return;
        }
        if (action === "finish") {
          toast.success("Đã chốt vòng đấu");
        }
        await loadRoom(room.code);
      } finally {
        setBusy(false);
      }
    },
    [authHeaders, loadRoom, room],
  );

  const standings = snapshot?.standings ?? [];
  const leader = standings[0];

  const joinUrl = useMemo(() => (room ? buildPublicUrl(`/flap/${room.code}`) : ""), [room]);
  const boardUrl = useMemo(() => (room ? buildPublicUrl(`/flap/${room.code}/board`) : ""), [room]);

  const addTeam = () => {
    if (teams.length >= MAX_TEAMS) return;
    const index = teams.length;
    setTeams([
      ...teams,
      {
        id: `team-${Date.now()}`,
        name: `Bàn ${index + 1}`,
        color: TEAM_PALETTE[index % TEAM_PALETTE.length],
        capacity: null,
      },
    ]);
  };

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <span className="text-[11px] font-bold tracking-wider text-sky-600 uppercase">Công cụ</span>
          <h1 className="font-display text-2xl font-black text-slate-900">🦅 Lắc điện thoại — Đại bàng tung cánh</h1>
          <p className="mt-1 text-sm text-slate-600">
            Khán giả lắc điện thoại, đại bàng của mỗi đội bay trên màn hình LED.
          </p>
        </div>
        {room && (
          <div className="flex items-center gap-2">
            <span className="rounded-xl bg-sky-50 px-3 py-2 text-sm font-bold text-sky-700">
              Phòng {room.code}
            </span>
            <button
              onClick={() => {
                window.localStorage.removeItem("flap-room-code");
                setRoom(null);
                setSnapshot(null);
                setTab("setup");
              }}
              className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
            >
              Đổi phòng
            </button>
          </div>
        )}
      </header>

      {!room && (
        <div className="glass rounded-3xl p-5 sm:p-6">
          <h2 className="flex items-center gap-2 text-base font-bold text-slate-900">
            <Settings2 size={17} className="text-sky-600" /> Tạo phòng chơi
          </h2>
          <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="sm:col-span-2">
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Tên chương trình</span>
              <input
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="admin-field w-full rounded-xl px-3 py-2.5 text-sm"
                maxLength={120}
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Điểm để về đích</span>
              <input
                type="number"
                value={trackLength}
                onChange={(e) => setTrackLength(Number(e.target.value))}
                min={100}
                max={50000}
                className="admin-field w-full rounded-xl px-3 py-2.5 text-sm"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Thời lượng (giây)</span>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(Number(e.target.value))}
                min={10}
                max={600}
                className="admin-field w-full rounded-xl px-3 py-2.5 text-sm"
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold text-slate-600">Cách tính điểm</span>
              <select
                value={scoreMode}
                onChange={(e) => setScoreMode(e.target.value === "total" ? "total" : "average")}
                className="admin-field w-full rounded-xl px-3 py-2.5 text-sm"
              >
                <option value="average">Trung bình mỗi thiết bị (công bằng)</option>
                <option value="total">Tổng điểm (đội đông lợi thế)</option>
              </select>
            </label>
          </div>

          <div className="mt-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-slate-600">
                Đội / Bàn ({teams.length}/{MAX_TEAMS})
              </span>
              <button
                onClick={addTeam}
                disabled={teams.length >= MAX_TEAMS}
                className="flex items-center gap-1 rounded-lg border border-sky-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
              >
                <Plus size={13} /> Thêm đội
              </button>
            </div>
            <div className="mt-3 space-y-2">
              {teams.map((team, index) => (
                <div key={team.id} className="flex items-center gap-2">
                  <input
                    type="color"
                    value={team.color}
                    onChange={(e) =>
                      setTeams(teams.map((t) => (t.id === team.id ? { ...t, color: e.target.value } : t)))
                    }
                    className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-slate-200"
                  />
                  <input
                    value={team.name}
                    onChange={(e) =>
                      setTeams(teams.map((t) => (t.id === team.id ? { ...t, name: e.target.value } : t)))
                    }
                    className="admin-field min-w-0 flex-1 rounded-xl px-3 py-2 text-sm"
                    maxLength={40}
                  />
                  <button
                    onClick={() => setTeams(teams.filter((t) => t.id !== team.id))}
                    disabled={teams.length <= MIN_TEAMS}
                    className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                    title="Xoá đội"
                  >
                    <Trash2 size={15} />
                  </button>
                  <span className="w-6 text-center text-xs font-bold text-slate-400">{index + 1}</span>
                </div>
              ))}
            </div>
          </div>

          <button
            onClick={() => void createRoom()}
            disabled={busy || teams.length < MIN_TEAMS}
            className="mt-6 flex w-full items-center justify-center gap-2 rounded-2xl bg-sky-600 py-3 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
          >
            {busy ? <Loader2 size={16} className="animate-spin" /> : <Play size={16} />}
            Tạo phòng & lấy mã QR
          </button>
        </div>
      )}

      {room && (
        <>
          <div className="mb-4 flex gap-1 rounded-2xl bg-slate-100 p-1">
            {(
              [
                ["setup", "Thiết lập"],
                ["control", "Điều khiển"],
                ["players", `Người chơi (${snapshot?.playerCount ?? 0})`],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                onClick={() => setTab(key)}
                className={`flex-1 rounded-xl px-3 py-2 text-xs font-bold transition-colors sm:text-sm ${
                  tab === key ? "bg-white text-sky-700 shadow-sm" : "text-slate-500 hover:text-slate-800"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "setup" && (
            <div className="glass rounded-3xl p-5 sm:p-6">
              <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_auto]">
                <div className="space-y-4">
                  <label>
                    <span className="mb-1.5 block text-xs font-semibold text-slate-600">Tên chương trình</span>
                    <input
                      value={title}
                      onChange={(e) => setTitle(e.target.value)}
                      className="admin-field w-full rounded-xl px-3 py-2.5 text-sm"
                    />
                  </label>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                    <label>
                      <span className="mb-1.5 block text-xs font-semibold text-slate-600">Điểm về đích</span>
                      <input
                        type="number"
                        value={trackLength}
                        onChange={(e) => setTrackLength(Number(e.target.value))}
                        className="admin-field w-full rounded-xl px-3 py-2.5 text-sm"
                      />
                    </label>
                    <label>
                      <span className="mb-1.5 block text-xs font-semibold text-slate-600">Thời lượng (giây)</span>
                      <input
                        type="number"
                        value={duration}
                        onChange={(e) => setDuration(Number(e.target.value))}
                        className="admin-field w-full rounded-xl px-3 py-2.5 text-sm"
                      />
                    </label>
                    <label>
                      <span className="mb-1.5 block text-xs font-semibold text-slate-600">Tính điểm</span>
                      <select
                        value={scoreMode}
                        onChange={(e) => setScoreMode(e.target.value === "total" ? "total" : "average")}
                        className="admin-field w-full rounded-xl px-3 py-2.5 text-sm"
                      >
                        <option value="average">Trung bình/máy</option>
                        <option value="total">Tổng điểm</option>
                      </select>
                    </label>
                  </div>

                  <div className="space-y-2">
                    {teams.map((team) => (
                      <div key={team.id} className="flex items-center gap-2">
                        <input
                          type="color"
                          value={team.color}
                          onChange={(e) =>
                            setTeams(teams.map((t) => (t.id === team.id ? { ...t, color: e.target.value } : t)))
                          }
                          className="h-9 w-9 shrink-0 cursor-pointer rounded-lg border border-slate-200"
                        />
                        <input
                          value={team.name}
                          onChange={(e) =>
                            setTeams(teams.map((t) => (t.id === team.id ? { ...t, name: e.target.value } : t)))
                          }
                          className="admin-field min-w-0 flex-1 rounded-xl px-3 py-2 text-sm"
                        />
                        <input
                          type="number"
                          value={team.capacity ?? ""}
                          placeholder="Giới hạn máy"
                          onChange={(e) =>
                            setTeams(
                              teams.map((t) =>
                                t.id === team.id
                                  ? { ...t, capacity: e.target.value ? Number(e.target.value) : null }
                                  : t,
                              ),
                            )
                          }
                          className="admin-field w-28 rounded-xl px-3 py-2 text-sm"
                          min={1}
                        />
                        <button
                          onClick={() => setTeams(teams.filter((t) => t.id !== team.id))}
                          disabled={teams.length <= MIN_TEAMS}
                          className="rounded-lg p-2 text-slate-400 hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                        >
                          <Trash2 size={15} />
                        </button>
                      </div>
                    ))}
                    <button
                      onClick={addTeam}
                      disabled={teams.length >= MAX_TEAMS}
                      className="flex items-center gap-1 rounded-lg border border-sky-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-sky-700 hover:bg-sky-50 disabled:opacity-50"
                    >
                      <Plus size={13} /> Thêm đội
                    </button>
                  </div>

                  <div className="flex flex-wrap gap-2">
                    <button
                      onClick={() =>
                        void control("settings", {
                          title,
                          teams,
                          track_length: trackLength,
                          duration_sec: duration,
                          score_mode: scoreMode,
                        })
                      }
                      disabled={busy}
                      className="rounded-xl bg-sky-600 px-4 py-2.5 text-sm font-bold text-white hover:bg-sky-700 disabled:opacity-50"
                    >
                      Lưu cấu hình
                    </button>
                    <button
                      onClick={() => void control(room.teams_locked ? "unlock_teams" : "lock_teams")}
                      disabled={busy}
                      className="rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50"
                    >
                      {room.teams_locked ? "Mở khoá đội" : "Khoá đội"}
                    </button>
                  </div>
                </div>

                <div className="flex flex-col items-center gap-3">
                  <QRCodeView value={joinUrl} size={190} />
                  <p className="max-w-[190px] text-center text-xs text-slate-500">
                    Quét mã để vào đội. Chiếu mã này trên màn hình LED.
                  </p>
                  <code className="rounded-lg bg-slate-100 px-3 py-1.5 font-mono text-sm font-bold text-slate-800">
                    {room.code}
                  </code>
                </div>
              </div>
            </div>
          )}

          {tab === "control" && (
            <div className="space-y-4">
              <div className="glass flex flex-wrap items-center gap-2 rounded-3xl p-4">
                <button
                  onClick={() => void control("start")}
                  disabled={busy || room.status === "running" || room.status === "finished"}
                  className="flex items-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-bold text-white hover:bg-emerald-700 disabled:opacity-50"
                >
                  <Play size={16} /> Bắt đầu
                </button>
                <button
                  onClick={() => void control("pause")}
                  disabled={busy || room.status !== "running"}
                  className="flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-3 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50"
                >
                  <Pause size={16} /> Tạm dừng
                </button>
                <button
                  onClick={() => void control("finish")}
                  disabled={busy}
                  className="flex items-center gap-2 rounded-xl bg-slate-800 px-5 py-3 text-sm font-bold text-white hover:bg-slate-900 disabled:opacity-50"
                >
                  <Square size={16} /> Kết thúc vòng
                </button>
                <button
                  onClick={async () => {
                    if (await confirm({ title: "Xoá toàn bộ người chơi?", description: "Điểm và phiên sẽ bị xoá.", confirmText: "Xoá" }))
                      void control("reset");
                  }}
                  disabled={busy}
                  className="flex items-center gap-2 rounded-xl border border-red-200 bg-white px-4 py-3 text-sm font-semibold text-red-600 hover:bg-red-50 disabled:opacity-50"
                >
                  <RotateCcw size={15} /> Reset phòng
                </button>

                <span className="ml-auto flex items-center gap-2 text-xs text-slate-500">
                  <span className={`rounded-full px-2.5 py-1 font-bold ${
                    room.status === "running"
                      ? "bg-emerald-100 text-emerald-700"
                      : room.status === "paused"
                        ? "bg-amber-100 text-amber-700"
                        : "bg-slate-100 text-slate-600"
                  }`}>
                    {room.status}
                  </span>
                  <span>Vòng {room.round}</span>
                </span>
              </div>

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
                <div className="glass overflow-hidden rounded-3xl">
                  <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
                    Bảng xếp hạng ({room.score_mode === "average" ? "trung bình/máy" : "tổng điểm"})
                  </div>
                  <div className="divide-y divide-slate-100">
                    {standings.map((team, index) => (
                      <div key={team.team_id} className="flex items-center gap-3 px-4 py-3">
                        <span className="w-5 text-xs font-bold text-slate-400">#{index + 1}</span>
                        <span className="h-3 w-3 rounded-full" style={{ background: team.color }} />
                        <span className="min-w-0 flex-1 truncate text-sm font-semibold text-slate-800">
                          {team.name}
                          {index === 0 && leader && <Crown size={13} className="ml-1.5 inline text-amber-500" />}
                        </span>
                        <span className="text-xs text-slate-500">{team.players} máy</span>
                        <span className="w-20 text-right text-sm font-black tabular-nums text-slate-900">
                          {room.score_mode === "average" ? team.average : team.total}
                        </span>
                      </div>
                    ))}
                    {standings.length === 0 && (
                      <p className="px-4 py-6 text-center text-sm text-slate-500">Chưa có đội.</p>
                    )}
                  </div>
                </div>

                <div className="glass rounded-3xl p-4">
                  <div className="mb-3 flex items-center gap-2 text-sm font-bold text-slate-900">
                    <QrCode size={15} className="text-sky-600" /> Màn hình LED
                  </div>
                  <p className="mb-3 text-xs text-slate-500">
                    Mở màn hình này trên máy tính nối vào LED/TV của hội trường:
                  </p>
                  <a
                    href={boardUrl}
                    target="_blank"
                    rel="noopener"
                    className="block break-all rounded-xl bg-slate-900 px-4 py-3 font-mono text-xs text-sky-300 hover:bg-slate-800"
                  >
                    {boardUrl}
                  </a>
                  <div className="mt-4 flex flex-col items-center gap-2">
                    <QRCodeView value={joinUrl} size={150} />
                    <p className="text-center text-[11px] text-slate-500">
                      Link vào đội cho khán giả: <br />
                      <code className="font-mono text-slate-700">{joinUrl}</code>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {tab === "players" && (
            <div className="glass overflow-hidden rounded-3xl">
              <div className="border-b border-slate-100 px-4 py-3 text-sm font-bold text-slate-900">
                <Users size={15} className="mr-1.5 inline text-sky-600" />
                {snapshot?.playerCount ?? 0} thiết bị đã tham gia
              </div>
              <p className="px-4 py-6 text-center text-sm text-slate-500">
                Danh sách chi tiết thiết bị nằm trong bảng xếp hạng theo đội. Dùng tab Điều khiển để theo dõi
                điểm trực tiếp.
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
