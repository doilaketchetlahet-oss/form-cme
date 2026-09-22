"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import { Crown, Loader2, Wifi, WifiOff } from "lucide-react";
import { fetchRoomSnapshot, subscribeRoom, type FlapRoomSnapshot } from "@/lib/flap/realtime";
import type { TeamStanding } from "@/lib/flap/race";
import { detectMilestones, SPARK_DIRECTIONS, type MilestoneEvent } from "@/lib/flap/hype";

/** Đường đua đại bàng: mỗi đội một làn, vị trí theo tiến độ 0..1. */
export default function FlapBoardPage() {
  const params = useParams<{ code: string }>();
  const code = (params?.code ?? "").toString().toUpperCase();

  const [snapshot, setSnapshot] = useState<FlapRoomSnapshot | null>(null);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const raceRef = useRef<HTMLDivElement>(null);

  const applySnapshot = useCallback(
    (snap: FlapRoomSnapshot | null) => {
      if (!snap) {
        // Không xoá hình cũ khi mạng chớp: chỉ báo mất kết nối.
        setOnline(false);
        return;
      }
      setSnapshot(snap);
      setOnline(true);
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
    // Broadcast chỉ là lớp làm mượt; nguồn dữ liệu chuẩn là API (mạng hội
    // trường hay chặn websocket nên không được phụ thuộc vào nó).
    const sub = subscribeRoom(code, (event) => {
      if (event.type === "state" || event.type === "reset") void load();
      if (event.type === "standings" && "standings" in event) {
        setSnapshot((prev) => (prev ? { ...prev, standings: event.standings } : prev));
      }
    });
    // Đồng bộ với sổ cái mỗi giây để hình chạy mượt mà vẫn đúng số.
    const sync = setInterval(() => void load(), 1000);
    const clock = setInterval(() => setNow(Date.now()), 250);
    return () => {
      sub.close();
      clearInterval(sync);
      clearInterval(clock);
    };
  }, [code, load]);

  const standings = useMemo(() => snapshot?.standings ?? [], [snapshot]);
  const leader = standings[0];

  // ---- Mốc tiến độ: banner hối thúc + pháo hoa ------------------------------
  const progressRef = useRef<Map<string, number>>(new Map());
  const [activeHype, setActiveHype] = useState<MilestoneEvent | null>(null);
  const [sparks, setSparks] = useState<MilestoneEvent[]>([]);
  const seedRef = useRef(0);

  useEffect(() => {
    if (snapshot?.room.status !== "running") {
      // Vòng mới/lượt mới: quên tiến độ cũ để không bắn lại hiệu ứng đã qua.
      if (snapshot?.room.status === "lobby" || snapshot?.room.status === "finished") {
        progressRef.current = new Map();
      }
      return;
    }

    const prev = progressRef.current;
    const next = new Map<string, number>();
    const names = new Map<string, { name: string; color: string }>();
    for (const team of standings) {
      next.set(team.team_id, team.progress);
      names.set(team.team_id, { name: team.name, color: team.color });
    }

    // Lần cập nhật đầu tiên sau khi bắt đầu: ghi nhận mốc, chưa bắn hiệu ứng.
    if (prev.size === 0) {
      progressRef.current = next;
      return;
    }

    seedRef.current += 1;
    const events = detectMilestones(prev, next, names, seedRef.current);
    progressRef.current = next;
    if (events.length === 0) return;

    setActiveHype(events[0]);
    setSparks(events);
  }, [snapshot?.room.status, standings]);

  // Banner tự ẩn và dọn pháo hoa sau khi bắn xong.
  const hypeId = activeHype?.id;
  useEffect(() => {
    if (!hypeId) return;
    const hide = setTimeout(() => setActiveHype(null), 4200);
    return () => clearTimeout(hide);
  }, [hypeId]);

  const sparkIds = sparks.map((s) => s.id).join("|");
  useEffect(() => {
    if (!sparkIds) return;
    const clear = setTimeout(() => setSparks([]), 1400);
    return () => clearTimeout(clear);
  }, [sparkIds]);

  const remaining = useMemo(() => {
    const room = snapshot?.room;
    if (!room || room.status !== "running" || !room.started_at) return null;
    const end = Date.parse(room.started_at) + room.duration_sec * 1000;
    const left = Math.max(0, end - now);
    return { ms: left, sec: Math.ceil(left / 1000) };
  }, [snapshot, now]);

  if (!snapshot) {
    return (
      <main className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-slate-50 px-6 text-center">
        <Loader2 className="animate-spin text-sky-500" size={26} />
        <p className="text-sm font-semibold text-slate-700">
          {online ? "Đang tải phòng…" : "Đang kết nối lại…"}
        </p>
        <p className="text-xs text-slate-500">
          Nếu đứng mãi ở đây, kiểm tra mạng hoặc mã phòng <strong>{code}</strong>.
        </p>
      </main>
    );
  }

  const room = snapshot.room;
  const finishedByScore = standings.some((s) => s.progress >= 1);

  return (
    <main ref={raceRef} className="flex min-h-dvh flex-col bg-gradient-to-b from-sky-50 via-white to-cyan-50/60 px-6 py-6 text-slate-900">
      {/* Thanh trên: tiêu đề + trạng thái + đồng hồ */}
      <header className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-bold tracking-wider text-sky-700 uppercase ring-1 ring-sky-200">
            Phòng {room.code} · Vòng {room.round}
          </span>
          <h1 className="font-display mt-2 text-2xl font-black text-slate-900 sm:text-3xl">🦅 {room.title}</h1>
        </div>
        <div className="flex items-center gap-4">
          <span className="text-xs font-medium text-slate-500">
            Chế độ: <strong className="text-slate-800">{room.score_mode === "average" ? "Trung bình/thiết bị" : "Tổng điểm"}</strong>
          </span>
          <span className={`flex items-center gap-1.5 text-xs font-bold ${online ? "text-emerald-600" : "text-red-600"}`}>
            {online ? <Wifi size={14} /> : <WifiOff size={14} />}
            {online ? "Trực tuyến" : "Mất mạng"}
          </span>
          <span className="font-display rounded-2xl bg-white px-5 py-2 text-3xl font-black text-sky-700 tabular-nums shadow-sm ring-1 ring-sky-200">
            {remaining ? remaining.sec : room.status === "finished" ? "HẾT" : "—"}
          </span>
        </div>
      </header>

      {/* Trạng thái lớn giữa màn hình khi chưa chạy */}
      {room.status !== "running" && (
        <div className="mt-6 flex flex-col items-center gap-2">
          <p className="font-display text-4xl font-black text-sky-600 sm:text-5xl">
            {room.status === "lobby" && "Chờ MC bắt đầu"}
            {room.status === "countdown" && "Sẵn sàng…"}
            {room.status === "paused" && "⏸ Tạm dừng"}
            {room.status === "finished" && "🏁 Kết thúc"}
          </p>
          <p className="text-sm font-medium text-slate-600">
            {snapshot.playerCount} thiết bị đã tham gia · Quét mã QR để vào đội
          </p>
        </div>
      )}

      {/* Banner hối thúc khi vừa qua mốc */}
      <AnimatePresence>
        {activeHype && room.status === "running" && (
          <motion.div
            key={activeHype.id}
            initial={{ opacity: 0, y: -18, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -12, scale: 0.98 }}
            transition={{ type: "spring", stiffness: 240, damping: 22 }}
            className="pointer-events-none mx-auto mt-4 w-full max-w-3xl"
          >
            <div
              className="flex items-center justify-center gap-3 rounded-2xl px-5 py-3 text-center shadow-lg ring-1"
              style={{
                background: activeHype.finished
                  ? "linear-gradient(135deg, #fef3c7, #fde68a)"
                  : activeHype.leading
                    ? "linear-gradient(135deg, #e0f2fe, #cffafe)"
                    : "#ffffff",
                borderColor: activeHype.teamColor,
                boxShadow: `0 10px 30px ${activeHype.teamColor}33`,
                ...(activeHype.finished ? {} : { border: `1px solid ${activeHype.teamColor}` }),
              }}
            >
              <span
                className="h-3 w-3 shrink-0 animate-pulse rounded-full"
                style={{ background: activeHype.teamColor }}
              />
              <p
                className={`font-display text-lg font-black sm:text-2xl ${
                  activeHype.finished ? "text-amber-800" : "text-slate-900"
                }`}
              >
                {activeHype.text}
              </p>
              <span className="shrink-0 rounded-full bg-slate-900/5 px-2.5 py-1 text-[11px] font-bold text-slate-600">
                {activeHype.checkpoint}%
              </span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

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
            spark={sparks.find((s) => s.teamId === team.team_id) ?? null}
          />
        ))}
        {standings.length === 0 && (
          <p className="text-center text-sm text-slate-500">Chưa có đội nào trong phòng.</p>
        )}
      </div>

      {/* Bảng vàng khi kết thúc */}
      {room.status === "finished" && leader && (
        <div className="mt-6 rounded-3xl bg-gradient-to-r from-amber-100 to-amber-50 p-6 text-center ring-1 ring-amber-200">
          <Crown className="mx-auto text-amber-500" size={30} />
          <p className="font-display mt-2 text-3xl font-black text-amber-700">
            {leader.name} vô địch!
          </p>
          <p className="text-sm font-medium text-slate-600">
            {room.score_mode === "average" ? `${leader.average} điểm/thiết bị` : `${leader.total} điểm`} ·{" "}
            {leader.players} thiết bị
          </p>
        </div>
      )}

      {finishedByScore && room.status === "running" && leader && (
        <p className="mt-4 text-center text-sm font-bold text-amber-600">
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
  spark,
}: {
  team: TeamStanding;
  index: number;
  isLeader: boolean;
  scoreMode: "total" | "average";
  showAverage: boolean;
  spark: MilestoneEvent | null;
}) {
  const percent = Math.round(team.progress * 100);

  return (
    <div className="flex items-center gap-4">
      <div className="w-28 shrink-0 text-right sm:w-40">
        <div className="flex items-center justify-end gap-2">
          {isLeader && <Crown size={16} className="text-amber-500" />}
          <span className="truncate text-sm font-black sm:text-base" style={{ color: team.color }}>
            {team.name}
          </span>
        </div>
        <div className="text-[11px] font-medium text-slate-500 tabular-nums">
          {scoreMode === "average" ? `${team.average}/máy` : `${team.total} điểm`}
          {showAverage && scoreMode === "total" ? ` · TB ${team.average}` : ""}
          {` · ${team.players} máy`}
        </div>
      </div>

      <div className="relative h-14 flex-1 overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {/* Vạch xuất phát / đích */}
        <div className="absolute inset-y-0 left-0 w-1 bg-slate-300" />
        <div className="absolute inset-y-0 right-0 w-1.5 bg-emerald-500" />
        {/* Vạch chia mốc 25/50/75% */}
        {[25, 50, 75].map((mark) => (
          <div key={mark} className="absolute inset-y-0 w-px bg-slate-200" style={{ left: `${mark}%` }} />
        ))}
        {/* Vệt màu cho biết đội đang ở đâu trên đường đua */}
        <div
          className="absolute inset-y-0 left-0 rounded-r-2xl opacity-15 transition-[width] duration-200"
          style={{ width: `${percent}%`, background: team.color }}
        />
        <motion.div
          className="absolute top-1/2 flex h-14 w-14 -translate-y-1/2 items-center justify-center"
          animate={{ left: `calc(${percent}% - ${Math.round(percent * 0.56)}px)` }}
          transition={{ type: "spring", stiffness: 120, damping: 20 }}
        >
          {/* Hoạt ảnh đại bàng. Nếu trình duyệt không phát được WebM thì
              component tự chuyển sang emoji. */}
          <EagleSprite />

          {/* Pháo hoa nhỏ khi đội vừa qua mốc */}
          <AnimatePresence>
            {spark && <Sparkle key={spark.id} color={team.color} big={spark.finished} />}
          </AnimatePresence>
        </motion.div>
      </div>

      <div className="w-14 shrink-0 text-right">
        <span className="font-display text-xl font-black tabular-nums" style={{ color: team.color }}>
          {scoreMode === "average" ? Math.round(team.average) : team.total}
        </span>
      </div>
      <span className="w-6 shrink-0 text-xs font-bold text-slate-400">#{index + 1}</span>
    </div>
  );
}

/**
 * Hoạt ảnh đại bàng cho làn đua.
 *
 * `fly-eagle.webm` là VP9 không có kênh alpha, nên khi phát được thì nó che
 * hoàn toàn emoji. Chỉ khi trình duyệt không phát nổi (một số Safari/iOS cũ)
 * hoặc mạng chặn file thì mới rơi về emoji, nhờ đó bảng không bao giờ trống.
 */
function EagleSprite() {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <span className="text-3xl" style={{ textShadow: "0 1px 3px rgba(255,255,255,0.9)" }} aria-label="Đại bàng">
        🦅
      </span>
    );
  }

  return (
    <video
      src="/fly-eagle.webm"
      autoPlay
      loop
      muted
      playsInline
      disablePictureInPicture
      preload="auto"
      onError={() => setFailed(true)}
      className="h-full w-full object-contain drop-shadow-md"
      aria-label="Đại bàng"
    />
  );
}

/**
 * Pháo hoa nhỏ tại vị trí con đại bàng khi đội vừa qua mốc.
 *
 * Dùng CSS transform + opacity (được GPU tăng tốc) thay vì canvas hay thư viện
 * ngoài, để màn LED chạy nhẹ. Mỗi tia chỉ là một phần tử, tổng cộng 9 tia.
 */
function Sparkle({ color, big }: { color: string; big: boolean }) {
  const count = big ? SPARK_DIRECTIONS.length : 7;
  const rays = SPARK_DIRECTIONS.slice(0, count);
  const scale = big ? 1.35 : 1;

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      {/* Vòng sáng lan ra */}
      <motion.span
        className="absolute rounded-full"
        style={{ border: `2px solid ${color}` }}
        initial={{ width: 14, height: 14, opacity: 0.9 }}
        animate={{ width: 64 * scale, height: 64 * scale, opacity: 0 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.7, ease: "easeOut" }}
      />
      {/* Các tia bắn tỏa */}
      {rays.map((ray, i) => {
        const rad = (ray.angle * Math.PI) / 180;
        const dx = Math.cos(rad) * ray.distance * scale;
        const dy = Math.sin(rad) * ray.distance * scale;
        return (
          <motion.span
            key={i}
            className="absolute h-2 w-2 rounded-full"
            style={{ background: i % 3 === 0 ? "#fbbf24" : color }}
            initial={{ x: 0, y: 0, opacity: 1, scale: 1 }}
            animate={{ x: dx, y: dy, opacity: 0, scale: 0.2 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.75, delay: ray.delay / 1000, ease: "easeOut" }}
          />
        );
      })}
    </div>
  );
}
