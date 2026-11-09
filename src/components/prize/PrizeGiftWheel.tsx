"use client";

import { useId, useState, type CSSProperties } from "react";
import Image from "next/image";
import { Gift, Sparkles } from "lucide-react";
import type { PrizeItem } from "@/lib/prize-draw";
import styles from "./prize-wheel.module.css";

export const GIFT_WHEEL_SPIN_MS = 4200;
export const GIFT_WHEEL_REVEAL_MS = 650;

type WheelItem = Pick<PrizeItem, "id" | "name" | "color" | "image_url" | "remaining">;

function point(angle: number, radius: number) {
  const radians = (angle - 90) * Math.PI / 180;
  return { x: 200 + radius * Math.cos(radians), y: 200 + radius * Math.sin(radians) };
}

function segmentPath(index: number, count: number) {
  const start = point(index * 360 / count, 198);
  const end = point((index + 1) * 360 / count, 198);
  return `M 200 200 L ${start.x} ${start.y} A 198 198 0 ${count === 1 ? 1 : 0} 1 ${end.x} ${end.y} Z`;
}

function WheelImage({ item }: { item: WheelItem }) {
  const [failed, setFailed] = useState<string | null>(null);
  return <span className={styles.giftImage}>
    {item.image_url && item.image_url !== failed ? <Image
      src={item.image_url} alt="" fill unoptimized loading="eager" sizes="80px"
      className={styles.image} onError={() => setFailed(item.image_url!)}
    /> : <Gift className={styles.giftIcon} aria-hidden="true" strokeWidth={1.5} />}
  </span>;
}

/** Gift presentation only. Inventory and the winning index still come from the server. */
export function PrizeGiftWheel({ items, rotation, spinning, winnerId, onSpin, disabled = false }: {
  items: WheelItem[];
  rotation: number;
  spinning: boolean;
  winnerId?: string | null;
  onSpin?: () => void;
  disabled?: boolean;
}) {
  const id = useId().replace(/:/g, "");
  const compact = items.length > 6;
  const winner = items.find(item => item.id === winnerId);
  const turnStyle = { "--wheel-turn": `${rotation}deg`, "--wheel-counter-turn": `${-rotation}deg`, "--wheel-duration": `${GIFT_WHEEL_SPIN_MS}ms` } as CSSProperties;
  const hubContent = <>
    <Sparkles className={styles.hubIcon} aria-hidden="true" strokeWidth={1.6} />
    <span className={styles.hubEyebrow}>{winner ? "PHẦN QUÀ" : spinning ? "MAY MẮN" : onSpin ? "CHẠM ĐỂ" : "VÒNG QUAY"}</span>
    <span className={styles.hubLabel}>{winner ? "CỦA BẠN" : spinning ? "ĐANG ĐẾN" : onSpin ? "QUAY" : "NHẬN QUÀ"}</span>
  </>;

  return <div className={styles.wheel} style={turnStyle} data-spinning={spinning} data-landed={!!winner} aria-label="Vòng quay quà tặng" aria-busy={spinning}>
    <div className={styles.stage}>
      <svg className={styles.frame} viewBox="0 0 480 480" aria-hidden="true">
        <defs>
          <linearGradient id={`${id}-rim`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#284b63" /><stop offset=".5" stopColor="#102d42" /><stop offset="1" stopColor="#071d2d" />
          </linearGradient>
          <linearGradient id={`${id}-gold`} x1="0" y1="0" x2="1" y2="1">
            <stop stopColor="#fff3cb" /><stop offset=".5" stopColor="#e9bd69" /><stop offset="1" stopColor="#b97d34" />
          </linearGradient>
        </defs>
        <circle cx="240" cy="240" r="231" fill={`url(#${id}-rim)`} />
        <circle cx="240" cy="240" r="231" fill="none" stroke={`url(#${id}-gold)`} strokeWidth="2" />
        <circle cx="240" cy="240" r="211" fill="#fffdf7" stroke="#e9bd69" strokeWidth="2" />
        {Array.from({ length: 36 }, (_, i) => {
          const angle = i * Math.PI / 18;
          return <circle key={i} cx={240 + 221 * Math.sin(angle)} cy={240 - 221 * Math.cos(angle)} r={i % 3 === 0 ? 3.4 : 2.2} fill={i % 3 === 0 ? "#ffe6aa" : "#d7ba80"} opacity={i % 3 === 0 ? 1 : .6} />;
        })}
      </svg>

      <div className={styles.disc} aria-hidden="true">
        <svg className={styles.segments} viewBox="0 0 400 400">
          <defs>
            {items.map((item, index) => <radialGradient key={item.id} id={`${id}-slice-${index}`} cx="50%" cy="50%" r="70%">
              <stop stopColor="#ffffff" /><stop offset="1" stopColor={item.remaining > 0 ? item.color : "#cbd5e1"} stopOpacity=".28" />
            </radialGradient>)}
          </defs>
          <circle cx="200" cy="200" r="198" fill="#fffdf7" />
          {items.map((item, index) => <g key={item.id}>
            {items.length === 1 ? <circle cx="200" cy="200" r="198" fill={`url(#${id}-slice-${index})`} /> : <path d={segmentPath(index, items.length)} fill={`url(#${id}-slice-${index})`} stroke="#fffdf7" strokeWidth="2" />}
            {winnerId === item.id && (items.length === 1 ? <circle cx="200" cy="200" r="191" className={styles.winningSegment} /> : <path d={segmentPath(index, items.length)} className={styles.winningSegment} />)}
          </g>)}
          <circle cx="200" cy="200" r="195" fill="none" stroke="#fffdf7" strokeWidth="5" />
        </svg>
        {items.map((item, index) => {
          const position = point((index + .5) * 360 / items.length, compact ? 143 : 126);
          return <span key={item.id} className={`${styles.prizePosition} ${compact ? styles.compact : ""}`} style={{ left: `${position.x / 4}%`, top: `${position.y / 4}%` }}>
            <span className={styles.prize} data-sold-out={item.remaining <= 0} data-winner={winnerId === item.id}>
              <WheelImage item={item} />
              {compact ? <span className={styles.prizeNumber}>{String(index + 1).padStart(2, "0")}</span> : <span className={styles.prizeName}>{item.name}</span>}
              {item.remaining <= 0 && <span className={styles.soldOut}>Hết quà</span>}
            </span>
          </span>;
        })}
      </div>

      <svg className={styles.pointer} viewBox="0 0 48 64" aria-hidden="true">
        <path d="M24 59C20 50 5 31 5 21a19 19 0 0 1 38 0c0 10-15 29-19 38Z" fill={`url(#${id}-gold)`} stroke="#fff8e7" strokeWidth="3" />
        <circle cx="24" cy="21" r="7" fill="#17374b" /><circle cx="24" cy="21" r="3" fill="#ffe6aa" />
      </svg>

      {onSpin ? <button type="button" className={styles.hub} onClick={onSpin} disabled={disabled || spinning || !!winner} aria-label="Chạm vòng quay để nhận quà">{hubContent}</button> : <div className={styles.hub}>{hubContent}</div>}
    </div>
    <div className={styles.caption} role="status" aria-live="polite" aria-atomic="true">
      <span className={styles.captionDot} />
      {winner ? `Phần quà của bạn: ${winner.name}` : spinning ? "Vòng quay đang tìm phần quà của bạn…" : "Một vòng quay, một điều bất ngờ"}
    </div>
  </div>;
}

export function PrizeCelebration() {
  return <div className={styles.confetti} aria-hidden="true">{Array.from({ length: 20 }, (_, index) => <i key={index} style={{
    "--confetti-x": `${(index * 37 + 11) % 100}%`,
    "--confetti-drift": `${(index % 2 ? 1 : -1) * (24 + index * 3)}px`,
    "--confetti-delay": `${index % 5 * 70}ms`,
    "--confetti-color": ["#e9bd69", "#0e7490", "#f4a7a7", "#b6a4d9"][index % 4],
    "--confetti-turn": `${index % 2 ? 420 : -420}deg`,
  } as CSSProperties} />)}</div>;
}
