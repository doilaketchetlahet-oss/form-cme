"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Link from "next/link";
import { motion } from "framer-motion";
import { Loader2, RefreshCw, Smartphone, Trophy, Users, Wifi, WifiOff } from "lucide-react";
import {
  createShakeCounter,
  motionSupported,
  requestMotionPermission,
  type ShakeCounter,
} from "@/lib/flap/shake-counter";
import { fetchRoomSnapshot, subscribeRoom, type FlapRoomSnapshot } from "@/lib/flap/realtime";
import type { FlapTeam } from "@/lib/flap/race";

type Phase = "loading" | "picker" | "permission" | "ready" | "playing" | "blocked" | "error";

type JoinResult = {
  playerId: string;
  token: string;
  team: FlapTeam;
  nickname: string | null;
  room: FlapRoomSnapshot["room"];
};

export default function FlapPlayerPage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code ?? "").toString().toUpperCase();

  const [phase, setPhase] = useState<Phase>("loading");
  const [error, setError] = useState("");
  const [snapshot, setSnapshot] = useState<FlapRoomSnapshot | null>(null);
  const [nickname, setNickname] = useState("");
  const [join, setJoin] = useState<JoinResult | null>(null);
  const [shakes, setShakes] = useState(0);
  const [intensity, setIntensity] = useState(0);
  const [myScore, setMyScore] = useState(0);
  const [online, setOnline] = useState(true);
  const [tapMode, setTapMode] = useState(false);

  const counterRef = useRef<ShakeCounter | null>(null);
  const pendingRef = useRef(0);
  const lastSentRef = useRef(0);
  const scoreRef = useRef(0);

  // ---- Tải trạng thái phòng -------------------------------------------------
  const loadSnapshot = useCallback(async () => {
    const snap = await fetchRoomSnapshot(code);
    if (!snap) {
      setError("Không tìm thấy phòng. Kiểm tra lại mã QR.");
      setPhase("error");
      return null;
    }
    setSnapshot(snap);
    return snap;
  }, [code]);

  useEffect(() => {
    void (async () => {
      const snap = await loadSnapshot();
      if (!snap) return;
      if (join) return;
      setPhase("picker");
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadSnapshot]);

  // ---- Nghe broadcast để đồng bộ trạng thái --------------------------------
  useEffect(() => {
    if (!code) return;
    const sub = subscribeRoom(code, (event) => {
      if (event.type === "state" || event.type === "reset" || event.type === "standings") {
        void loadSnapshot();
      }
    });
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      sub.close();
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [code, loadSnapshot]);

  // ---- Chuyển sang trạng thái chơi khi MC bắt đầu ---------------------------
  const roomStatus = snapshot?.room.status ?? null;
  useEffect(() => {
    if (!join || !roomStatus) return;
    if (roomStatus === "running") {
      counterRef.current?.setActive(true);
    } else {
      counterRef.current?.setActive(false);
    }
  }, [join, roomStatus]);

  /** Phase hiển thị suy ra từ trạng thái phòng, không setState trong effect. */
  const roomPhase: Phase | null = !join
    ? null
    : roomStatus === "running"
      ? "playing"
      : roomStatus === "paused" || roomStatus === "lobby" || roomStatus === "countdown"
        ? "ready"
        : null;
  const displayPhase: Phase = phase === "permission" ? "permission" : (roomPhase ?? phase);

  // ---- Gửi điểm đã gom lên server ------------------------------------------
  const flushScore = useCallback(async () => {
    const player = join;
    if (!player) return;
    const delta = pendingRef.current;
    if (delta <= 0) return;
    pendingRef.current = 0;

    try {
      const res = await fetch(`/api/flap/${encodeURIComponent(code)}/score`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ playerId: player.playerId, token: player.token, delta }),
      });
      if (res.ok) {
        const json = (await res.json()) as { score?: number; throttled?: boolean };
        if (typeof json.score === "number") {
          scoreRef.current = json.score;
          setMyScore(json.score);
        }
        setOnline(true);
      } else {
        // Chưa tới lượt hoặc bị chặn: trả điểm về hàng chờ để không mất.
        pendingRef.current += delta;
        if (res.status === 409) counterRef.current?.setActive(false);
      }
    } catch {
      pendingRef.current += delta;
      setOnline(false);
    }
  }, [code, join]);

  useEffect(() => {
    if (!join) return;
    const timer = setInterval(() => void flushScore(), 200);
    return () => clearInterval(timer);
  }, [join, flushScore]);

  // ---- Bắt đầu đếm lắc -----------------------------------------------------
  const startSensors = useCallback(async () => {
    setPhase("permission");
    const granted = await requestMotionPermission();
    if (!granted) {
      // Không có cảm biến hoặc khách từ chối -> chơi bằng chạm dự phòng.
      setTapMode(true);
      setPhase("ready");
      return;
    }
    const counter = createShakeCounter();
    counterRef.current = counter;
    counter.start((stats) => {
      setShakes(stats.shakes);
      setIntensity(stats.intensity);
      if (stats.shakes > lastSentRef.current) {
        pendingRef.current += stats.shakes - lastSentRef.current;
        lastSentRef.current = stats.shakes;
      }
    });
    setTapMode(false);
    setPhase("ready");
  }, []);

  const handleJoin = useCallback(
    async (teamId: string) => {
      setPhase("loading");
      try {
        const res = await fetch(`/api/flap/${encodeURIComponent(code)}/join`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ team_id: teamId, nickname, sensor_ok: motionSupported() }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => null)) as { error?: string } | null;
          setError(
            body?.error === "team_full"
              ? "Đội này đã đủ người."
              : body?.error === "round_started"
                ? "Lượt chơi đã bắt đầu, vui lòng chờ lượt sau."
                : "Không vào được phòng. Thử lại.",
          );
          setPhase("picker");
          return;
        }
        const json = (await res.json()) as JoinResult;
        setJoin(json);
        scoreRef.current = 0;
        setMyScore(0);
        lastSentRef.current = 0;
        pendingRef.current = 0;
        await startSensors();
      } catch {
        setError("Lỗi kết nối. Thử lại.");
        setPhase("picker");
      }
    },
    [code, nickname, startSensors],
  );

  const handleTap = useCallback(() => {
    if (!join || snapshot?.room.status !== "running") return;
    pendingRef.current += 1;
    setShakes((s) => s + 1);
  }, [join, snapshot]);

  const teams = useMemo(() => snapshot?.room.teams ?? [], [snapshot]);

  // ---- Giao diện -----------------------------------------------------------
  if (displayPhase === "error") {
    return (
      <Shell>
        <p className="text-lg font-bold text-slate-900">Không vào được phòng</p>
        <p className="text-sm text-slate-600">{error}</p>
        <Link href="/" className="text-sm font-semibold text-sky-600">← Về trang chủ</Link>
      </Shell>
    );
  }

  if (displayPhase === "loading") {
    return (
      <Shell>
        <Loader2 className="animate-spin text-sky-500" size={28} />
        <p className="text-sm text-slate-600">Đang kết nối phòng…</p>
      </Shell>
    );
  }

  if (displayPhase === "picker") {
    return (
      <Shell>
        <span className="text-xs font-bold tracking-wider text-sky-600 uppercase">Phòng {code}</span>
        <h1 className="text-lg font-black text-slate-900">{snapshot?.room.title ?? "Lắc điện thoại"}</h1>
        {snapshot?.room.teams_locked && (
          <p className="text-xs text-amber-600">MC đã khoá đội — chọn đúng đội của bạn.</p>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <input
          value={nickname}
          onChange={(e) => setNickname(e.target.value)}
          placeholder="Tên của bạn (không bắt buộc)"
          className="w-full rounded-xl border border-slate-200 px-4 py-3 text-sm focus:border-sky-400 focus:outline-none"
          maxLength={32}
        />
        <div className="grid w-full grid-cols-1 gap-2">
          {teams.map((team) => (
            <button
              key={team.id}
              onClick={() => void handleJoin(team.id)}
              className="flex items-center justify-between rounded-xl px-4 py-3 text-sm font-bold text-white transition-transform active:scale-[0.98]"
              style={{ background: team.color }}
            >
              <span>{team.name}</span>
              <Users size={16} />
            </button>
          ))}
        </div>
        <p className="text-center text-[11px] text-slate-500">
          {snapshot?.playerCount ?? 0} thiết bị đã vào phòng
        </p>
      </Shell>
    );
  }

  if (displayPhase === "permission") {
    return (
      <Shell>
        <Smartphone className="text-sky-500" size={30} />
        <p className="text-sm font-semibold text-slate-800">Cho phép truy cập cảm biến chuyển động</p>
        <p className="text-center text-xs text-slate-500">
          Khi hộp thoại hiện ra, hãy bấm <strong>Cho phép</strong>. Nếu không thấy hộp thoại, bạn vẫn có thể
          chơi bằng cách chạm liên tục.
        </p>
      </Shell>
    );
  }

  const status = displayPhase === "playing" ? "running" : roomStatus ?? "lobby";
  const canPlay = displayPhase === "playing";

  return (
    <Shell>
      <div className="flex w-full items-center justify-between text-xs">
        <span className="flex items-center gap-1.5 font-semibold" style={{ color: join?.team.color }}>
          {join?.team.name}
        </span>
        <span className={`flex items-center gap-1 ${online ? "text-emerald-600" : "text-red-500"}`}>
          {online ? <Wifi size={13} /> : <WifiOff size={13} />}
          {online ? "Đã kết nối" : "Mất kết nối"}
        </span>
      </div>

      <div className="flex w-full flex-col items-center gap-1">
        <span className="text-[11px] font-semibold tracking-wider text-slate-500 uppercase">Điểm của bạn</span>
        <span className="font-display text-5xl font-black text-slate-900">{myScore}</span>
        <span className="text-xs text-slate-500">Số lần lắc: {shakes}</span>
      </div>

      {(intensity > 0 || tapMode) && (
        <div className="h-2 w-full overflow-hidden rounded-full bg-slate-200">
          <div
            className="h-full rounded-full transition-[width] duration-100"
            style={{ width: `${Math.round((tapMode ? Math.min(shakes / 60, 1) : intensity) * 100)}%`, background: join?.team.color }}
          />
        </div>
      )}

      {tapMode ? (
        <button
          onPointerDown={handleTap}
          disabled={!canPlay}
          className="w-full rounded-2xl py-10 text-xl font-black text-white transition-transform active:scale-[0.98] disabled:opacity-40"
          style={{ background: join?.team.color }}
        >
          CHẠM LIÊN TỤC
        </button>
      ) : (
        <motion.div
          animate={canPlay ? { rotate: [-8, 8, -8] } : { rotate: 0 }}
          transition={canPlay ? { duration: 0.5, repeat: Infinity } : { duration: 0.2 }}
          className="flex h-32 w-32 items-center justify-center rounded-full"
          style={{ background: `${join?.team.color}22`, border: `2px solid ${join?.team.color}` }}
        >
          <Smartphone size={56} style={{ color: join?.team.color }} />
        </motion.div>
      )}

      <p className="text-center text-sm font-semibold text-slate-700">
        {!canPlay
          ? status === "paused"
            ? "Tạm dừng — chờ MC"
            : "Chờ MC bắt đầu…"
          : tapMode
            ? "Chạm thật nhanh!"
            : "Lắc thật mạnh!"}
      </p>

      {!tapMode && (
        <button onClick={() => void startSensors()} className="flex items-center gap-1.5 text-xs font-semibold text-sky-600">
          <RefreshCw size={13} /> Hiệu chỉnh lại cảm biến
        </button>
      )}

      {join && (
        <Link href={`/flap/${code}/board`} className="text-[11px] text-slate-400 hover:text-sky-600">
          <Trophy size={11} className="mr-1 inline" /> Xem màn hình chung
        </Link>
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-slate-50 px-6 py-8">
      <div className="flex w-full max-w-sm flex-col items-center gap-4 rounded-3xl bg-white p-6 shadow-lg">
        {children}
      </div>
    </main>
  );
}
