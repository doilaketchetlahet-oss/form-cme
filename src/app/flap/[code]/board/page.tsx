"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { motion } from "framer-motion";
import { Crown, Loader2, Wifi, WifiOff } from "lucide-react";
import { fetchRoomSnapshot, subscribeRoom, type FlapRoomSnapshot } from "@/lib/flap/realtime";
import type { TeamStanding } from "@/lib/flap/race";

/** Đường đua đại bàng: mỗi đội một làn, vị trí theo tiến độ 0..1. */
export default function FlapBoardPage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code ?? "").toString().toUpperCase();

  const [snapshot, setSnapshot] = useState<FlapRoomSnapshot | null>(null);
  const [error, setError] = useState("");
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const raceRef = useRef<HTMLDivElement>(null);

  const applySnapshot = useCallback(
    (snap: FlapRoomSnapshot | null) => {
      if (!snap) {
        setError("Không tìm thấy phòng");
        return;
      }
      setSnapshot(snap);
      setError("");
    },
    [],
  );

  const load = useCallback(async () => {
    applySnapshot(await fetchRoomSnapshot(code));
  }, [applySnapshot, code]);

  useEffect(() => {
    // Đồng bộ lần đầu trong microtask để tránh setState đồng bộ trong effect.
    queueMicrotask(() => void load());
    if (!code) return;
    const sub = subscribeRoom(code, (event) => {
      if (event.type === "state" || event.type === "reset") void load();
      if (event.type === "standings" && "standings" in event) {
        setSnapshot((prev) => (prev ? { ...prev, standings: event.standings } : prev));
      }
    });
    // Đồng bộ tuyệt đối với sổ cái mỗi 2s (broadcast chỉ để mượt hình).
    const sync = setInterval(() => void load(), 2000);
    const clock = setInterval(() => setNow(Date.now()), 250);
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      sub.close();
      clearInterval(sync);
      clearInterval(clock);
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, [code, load]);

  const standings = useMemo(() => snapshot?.standings ?? [], [snapshot]);
  const leader = standings[0];

  const remaining = useMemo(() => {
    const room = snapshot?.room;
    if (!room || room.status !== "running" || !room.started_at) return null;
    const end = Date.parse(room.started_at) + room.duration_sec * 1000;
    const left = Math.max(0, end - now);
    return { ms: left, sec: Math.ceil(left / 1000) };
  }, [snapshot, now]);

  if (error) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-900">
        <p className="text-lg font-bold text-white">{error}</p>
      </main>
    );
  }

  if (!snapshot) {
    return (
      <main className="flex min-h-dvh items-center justify-center gap-3 bg-slate-900">
        <Loader2 className="animate-spin text-sky-400" size={26} />
        <p className="text-sm text-slate-300">Đang tải…</p>
      </main>
    );
  }

  const room = snapshot.room;
  const finishedByScore = standings.some((s) => s.progress >= 1);

  return (
    <main ref={raceRef} className="flex min-h-dvh flex-col bg-gradient-to-b from-sky-950 via-slate-900 to-slate-950 px-6 py-6 text-white">
      {/* Thanh trên: tiêu đề + trạng thái + đồng hồ */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="rounded-full bg-sky-500/20 px-3 py-1 text-xs font-bold tracking-wider text-sky-300 uppercase">
            Phòng {room.code} · Vòng {room.round}
          </span>
          <h1 className="font-display mt-2 text-2xl font-black sm:text-3xl">🦅 {room.title}</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs text-slate-400">
            Chế độ: <strong className="text-slate-200">{room.score_mode === "average" ? "Trung bình/thiết bị" : "Tổng điểm"}</strong>
          </span>
          <span className={`flex items-center gap-1.5 text-xs font-semibold ${online ? "text-emerald-400" : "text-red-400"}`}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {online ? "Trực tuyến" : "Mất mạng"}
          </span>
          <span className="font-display rounded-2xl bg-white/10 px-5 py-2 text-3xl font-black tabular-nums">
            {remaining ? remaining.sec : room.status === "finished" ? "HẾT" : "—"}
          </span>
        </div>
      </header>

      {/* Trạng thái lớn giữa màn hình khi chưa chạy */}
      {room.status !== "running" && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="font-display text-4xl font-black text-sky-300 sm:text-5xl">
            {room.status === "lobby" && "Chờ MC bắt đầu"}
            {room.status === "countdown" && "Sẵn sàng…"}
            {room.status === "paused" && "⏸ Tạm dừng"}
            {room.status === "finished" && "🏁 Kết thúc"}
          </p>
          <p className="text-sm text-slate-400">
            {snapshot.playerCount} thiết bị đã tham gia · Quét mã QR để vào đội
          </p>
        </div>
      )}

      {/* Đường đua */}
      <div className="mt-6 flex flex-1 flex-col justify-center gap-4">
        {standings.map((team, index) => (
          <Lane
            key={team.team_id}
            team={team}
            index={index}
            isLeader={leader?.team_id === team.team_id && room.status !== "lobby"}
            scoreMode={room.score_mode}
            showAverage
          />
        ))}
        {standings.length === 0 && (
          <p className="text-center text-sm text-slate-400">Chưa có đội nào trong phòng.</p>
        )}
      </div>

      {/* Bảng vàng khi kết thúc */}
      {room.status === "finished" && leader && (
        <div className="mt-6 rounded-3xl bg-gradient-to-r from-amber-500/20 to-amber-300/10 p-6 text-center">
          <Crown className="mx-auto text-amber-300" size={30} />
          <p className="font-display mt-2 text-3xl font-black text-amber-200">
            {leader.name} vô địch!
          </p>
          <p className="text-sm text-slate-300">
            {room.score_mode === "average" ? `${leader.average} điểm/thiết bị` : `${leader.total} điểm`} ·{" "}
            {leader.players} thiết bị
          </p>
        </div>
      )}

      {finishedByScore && room.status === "running" && leader && (
        <p className="mt-4 text-center text-sm font-bold text-amber-300">
          🏁 {leader.name} đã chạm đích!
        </p>
      )}
    </main>
  );
}

function Lane({
  team,
  index,
  isLeader,
  scoreMode,
  showAverage,
}: {
  team: TeamStanding;
  index: number;
  isLeader: boolean;
  scoreMode: "total" | "average";
  showAverage: boolean;
}) {
  const percent = Math.round(team.progress * 100);

  return (
    <div className="flex items-center gap-4">
      <div className="w-28 shrink-0 text-right sm:w-40">
        <div className="flex items-center justify-end gap-2">
          {isLeader && <Crown size={16} className="text-amber-300" />}
          <span className="truncate text-sm font-bold sm:text-base" style={{ color: team.color }}>
            {team.name}
          </span>
        </div>
        <div className="text-[11px] text-slate-400 tabular-nums">
          {scoreMode === "average" ? `${team.average}/máy` : `${team.total} điểm`}
          {showAverage && scoreMode === "total" ? ` · TB ${team.average}` : ""}
          {` · ${team.players} máy`}
        </div>
      </div>

      <div className="relative h-14 flex-1 overflow-hidden rounded-2xl bg-white/5 ring-1 ring-white/10">
        {/* Vạch xuất phát / đích */}
        <div className="absolute inset-y-0 left-0 w-1 bg-white/20" />
        <div className="absolute inset-y-0 right-0 w-1.5 bg-emerald-400/60" />
        {/* Vạch chia mốc 25/50/75% */}
        {[25, 50, 75].map((mark) => (
          <div key={mark} className="absolute inset-y-0 w-px bg-white/10" style={{ left: `${mark}%` }} />
        ))}
        <motion.div
          className="absolute top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-full text-2xl shadow-lg"
          style={{ background: team.color }}
          animate={{ left: `calc(${percent}% - ${Math.round(percent * 0.44)}px)` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        >
          🦅
        </motion.div>
      </div>

      <div className="w-14 shrink-0 text-right">
        <span className="font-display text-xl font-black tabular-nums" style={{ color: team.color }}>
          {scoreMode === "average" ? Math.round(team.average) : team.total}
        </span>
      </div>
      <span className="w-6 shrink-0 text-xs font-bold text-slate-500">#{index + 1}</span>
    </div>
  );
}
