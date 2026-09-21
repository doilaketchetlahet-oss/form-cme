"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef } from "react";
import { WISH_THEMES, type Wish, type WishEdge, type WishEvent } from "@/lib/wish/config";
import { buildShapePoints, type ShapePoint } from "@/lib/wish/shapes";

export type WishWallHandle = {
  addWish: (wish: Wish, edge?: WishEdge) => void;
  syncWishes: (wishes: Wish[]) => void;
  removeWish: (wishId: string) => void;
  setEvent: (event: WishEvent) => void;
  spotlight: (wishId: string) => void;
  absorbAll: () => void;
  clear: () => void;
};

type Phase = "incoming" | "free" | "absorbing";

type Item = {
  id: string;
  wish: Wish;
  w: number;
  h: number;
  x: number;
  y: number;
  vx: number;
  vy: number;
  rot: number;
  vr: number;
  scale: number;
  alpha: number;
  phase: Phase;
  born: number;
  from: ShapePoint;
  to: ShapePoint;
  t: number;
  tDur: number;
  bob: number;
  target: ShapePoint | null;
};

type Settled = {
  x: number;
  y: number;
  w: number;
  h: number;
  angle: number;
  sprite: HTMLCanvasElement;
};

type Ring = { x: number; y: number; r: number; maxR: number; alpha: number };

type Spark = { x: number; y: number; vx: number; vy: number; life: number; color: string };

type Spotlight = { wish: Wish; t: number; phase: "in" | "hold" | "out" };

type CardLayout = {
  w: number;
  h: number;
  pad: number;
  symbolSize: number;
  lines: string[];
  lineHeight: number;
  drawingSize: number;
  width: number;
};

const LIFETIME_MS = 46_000;
const SPOTLIGHT_INTERVAL_MS = 24_000;
const SPOTLIGHT_HOLD = 6.2;
const SHAPE_CAPACITY = 48;

const BASE_CARD_W = 220;
const BASE_FONT = 14;
const LINE_HEIGHT = 19;

let measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx() {
  if (measureCtx) return measureCtx;
  if (typeof document === "undefined") return null;
  measureCtx = document.createElement("canvas").getContext("2d");
  return measureCtx;
}

function wrapLines(ctx: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (ctx.measureText(candidate).width <= maxWidth || !current) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
      if (lines.length >= maxLines) break;
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  return lines;
}

const layoutCache = new Map<string, CardLayout>();

function measureCard(wish: Wish, baseW: number): CardLayout {
  const key = `${wish.id}:${baseW}:${wish.content}`;
  const cached = layoutCache.get(key);
  if (cached) return cached;

  const pad = 14;
  const scale = baseW / BASE_CARD_W;
  const font = Math.round(BASE_FONT * scale);
  const inner = baseW - pad * 2;
  const hasDrawing = wish.drawing !== null;
  const symbolSize = hasDrawing ? Math.round(24 * scale) : wish.content ? Math.round(40 * scale) : Math.round(72 * scale);
  const lineHeight = Math.round(LINE_HEIGHT * scale);

  let lines: string[] = [];
  const ctx = getMeasureCtx();
  if (wish.content && ctx) {
    ctx.font = `600 ${font}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    lines = wrapLines(ctx, wish.content, inner, 8);
  }

  const drawingSize = hasDrawing ? inner : 0;
  let h = pad * 2 + symbolSize;
  if (lines.length) h += Math.round(6 * scale) + lines.length * lineHeight;
  if (drawingSize) h += Math.round(8 * scale) + drawingSize;
  if (wish.nickname) h += Math.round(6 * scale) + Math.round(15 * scale);

  const layout: CardLayout = {
    w: baseW,
    h: Math.max(baseW * 0.5, h),
    pad,
    symbolSize,
    lines,
    lineHeight,
    drawingSize,
    width: inner,
  };
  if (layoutCache.size > 800) layoutCache.clear();
  layoutCache.set(key, layout);
  return layout;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  if (typeof ctx.roundRect === "function") {
    ctx.roundRect(x, y, w, h, r);
    return;
  }
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawWishCard(
  ctx: CanvasRenderingContext2D,
  wish: Wish,
  layout: CardLayout,
  light: boolean,
) {
  const { w, h, pad, symbolSize, lines, lineHeight, drawingSize } = layout;
  const x = -w / 2;
  const y = -h / 2;

  ctx.save();
  ctx.shadowColor = wish.color;
  ctx.shadowBlur = 26;
  roundRect(ctx, x, y, w, h, Math.min(26, w * 0.12));
  ctx.fillStyle = light ? "rgba(255,255,255,0.88)" : "rgba(8,13,26,0.72)";
  ctx.fill();
  ctx.restore();

  roundRect(ctx, x, y, w, h, Math.min(26, w * 0.12));
  ctx.lineWidth = 2;
  ctx.strokeStyle = wish.color;
  ctx.stroke();

  const textColor = light ? "#0f172a" : "#f8fafc";
  const mutedColor = light ? "#64748b" : "rgba(226,232,240,0.72)";
  let cursor = y + pad;

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = `${symbolSize}px "Segoe UI Emoji", "Apple Color Emoji", sans-serif`;
  ctx.fillText(wish.symbol, 0, cursor);
  cursor += symbolSize;

  if (lines.length) {
    cursor += Math.round(6 * (layout.w / BASE_CARD_W));
    ctx.fillStyle = textColor;
    ctx.font = `600 ${Math.round(BASE_FONT * (layout.w / BASE_CARD_W))}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    for (const line of lines) {
      ctx.fillText(line, 0, cursor);
      cursor += lineHeight;
    }
  }

  if (wish.drawing && drawingSize) {
    cursor += Math.round(8 * (layout.w / BASE_CARD_W));
    const left = -drawingSize / 2;
    const strokeScale = drawingSize;
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    for (const stroke of wish.drawing.strokes) {
      if (stroke.p.length < 2) continue;
      ctx.strokeStyle = stroke.c;
      ctx.lineWidth = Math.max(1, stroke.w * strokeScale);
      ctx.beginPath();
      ctx.moveTo(left + (stroke.p[0] ?? 0) * strokeScale, cursor + (stroke.p[1] ?? 0) * strokeScale);
      for (let i = 2; i + 1 < stroke.p.length; i += 2) {
        ctx.lineTo(left + (stroke.p[i] ?? 0) * strokeScale, cursor + (stroke.p[i + 1] ?? 0) * strokeScale);
      }
      ctx.stroke();
    }
    cursor += drawingSize;
  }

  if (wish.nickname) {
    cursor += Math.round(6 * (layout.w / BASE_CARD_W));
    ctx.fillStyle = mutedColor;
    ctx.font = `500 ${Math.round(12 * (layout.w / BASE_CARD_W))}px system-ui, -apple-system, "Segoe UI", sans-serif`;
    ctx.fillText(`— ${wish.nickname}`, 0, cursor);
  }
}

/** Tỉ lệ thu nhỏ của mảnh đã kết tinh so với thẻ gốc. */
function settledScale(w: number, h: number) {
  return Math.min(0.5, Math.max(0.22, (Math.min(w, h) * 0.11) / BASE_CARD_W));
}

const SPRITE_PAD = 34;

/** Vẽ sẵn thẻ lời chúc ra canvas ngoài (cache) để màn LED vẽ lại nhanh. */
function renderCardSprite(wish: Wish, width: number, light: boolean): HTMLCanvasElement | null {
  if (typeof document === "undefined") return null;
  const layout = measureCard(wish, width);
  const scale = 2;
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.ceil((layout.w + SPRITE_PAD * 2) * scale));
  canvas.height = Math.max(1, Math.ceil((layout.h + SPRITE_PAD * 2) * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(scale, scale);
  ctx.translate(SPRITE_PAD + layout.w / 2, SPRITE_PAD + layout.h / 2);
  drawWishCard(ctx, wish, layout, light);
  return canvas;
}

function edgePoints(edge: WishEdge, w: number, h: number, layout: CardLayout): { from: ShapePoint; shield: ShapePoint } {
  const jitter = Math.random() * 0.3 + 0.35;
  switch (edge) {
    case "left":
      return { from: { x: -layout.w * 0.7, y: h * jitter }, shield: { x: w * 0.11, y: h * jitter } };
    case "right":
      return { from: { x: w + layout.w * 0.7, y: h * jitter }, shield: { x: w * 0.89, y: h * jitter } };
    default:
      return { from: { x: w * jitter, y: -layout.h * 0.7 }, shield: { x: w * jitter, y: h * 0.13 } };
  }
}

function easeOutCubic(t: number) {
  return 1 - Math.pow(1 - t, 3);
}

const SHAPE_BOX = 0.84;

/** Ánh xạ điểm hình ghép (0..1) vào giữa màn hình theo một ô vuông vừa phải. */
function shapeToScreen(point: ShapePoint, w: number, h: number) {
  const size = Math.min(w, h) * SHAPE_BOX;
  return {
    x: (w - size) / 2 + point.x * size,
    y: (h - size) / 2 + point.y * size,
  };
}

/** Tỉ lệ vừa khít ảnh vào ô vuông (giữ đúng tỉ lệ ảnh), toạ độ 0..1. */
function fitRect(width: number, height: number) {
  if (width >= height) {
    const dh = height / width;
    return { dx: 0, dy: (1 - dh) / 2, dw: 1, dh };
  }
  const dw = width / height;
  return { dx: (1 - dw) / 2, dy: 0, dw, dh: 1 };
}

export type WishCue = "arrive" | "complete" | "milestone";

export const WishWallCanvas = forwardRef<
  WishWallHandle,
  { className?: string; onCue?: (cue: WishCue) => void }
>(function WishWallCanvas({ className, onCue }, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onCueRef = useRef<((cue: WishCue) => void) | null>(onCue);

  const itemsRef = useRef<Item[]>([]);
  const settledRef = useRef<Settled[]>([]);
  const spriteRef = useRef<Map<string, HTMLCanvasElement>>(new Map());
  const ringsRef = useRef<Ring[]>([]);
  const sparksRef = useRef<Spark[]>([]);
  const knownRef = useRef<Set<string>>(new Set());
  const wishMapRef = useRef<Map<string, Wish>>(new Map());
  const itemDestRef = useRef<Map<string, ShapePoint>>(new Map());
  const eventRef = useRef<WishEvent | null>(null);
  const shapeRef = useRef<ShapePoint[]>([]);
  const assignRef = useRef(0);
  const messageRef = useRef<{
    text: string;
    sub: string;
    until: number;
    color: string;
    startedAt: number;
  } | null>(null);
  const spotlightRef = useRef<Spotlight | null>(null);
  const lastSpotRef = useRef(0);
  const capacityRef = useRef(SHAPE_CAPACITY);
  const completionRef = useRef(0);
  const clearSettledAtRef = useRef(0);
  const flashRef = useRef<{ startedAt: number; color: string; duration: number } | null>(null);
  const sizeRef = useRef({ w: 1, h: 1 });
  const imagesRef = useRef<{
    shield?: HTMLImageElement;
    target?: HTMLImageElement;
    bg?: HTMLImageElement;
    urls: { shield: string | null; target: string | null; bg: string | null };
  }>({ urls: { shield: null, target: null, bg: null } });

  useEffect(() => {
    onCueRef.current = onCue;
  }, [onCue]);

  const spawnSparks = useCallback((x: number, y: number, color: string, count = 18) => {
    for (let i = 0; i < count; i += 1) {
      const angle = Math.random() * Math.PI * 2;
      const speed = 60 + Math.random() * 220;
      sparksRef.current.push({
        x,
        y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 0.5 + Math.random() * 0.7,
        color,
      });
    }
  }, []);

  const spawnRings = useCallback((x: number, y: number, maxR: number) => {
    ringsRef.current.push({ x, y, r: maxR * 0.15, maxR, alpha: 1 });
    ringsRef.current.push({ x, y, r: maxR * 0.05, maxR: maxR * 0.7, alpha: 0.8 });
  }, []);

  const showMessage = useCallback((text: string, sub: string, color: string, ms = 6000) => {
    const now = Date.now();
    messageRef.current = { text, sub, until: now + ms, color, startedAt: now };
  }, []);

  const addWish = useCallback(
    (wish: Wish, edge?: WishEdge) => {
      if (knownRef.current.has(wish.id)) return;
      knownRef.current.add(wish.id);
      wishMapRef.current.set(wish.id, wish);

      const count = knownRef.current.size;
      if (count === 10 || count === 50 || count === 100 || count === 200) {
        onCueRef.current?.("milestone");
        showMessage(`${count} lời chúc`, count === 100 ? "một biển yêu thương" : "cả hội trường đang trao nhau", "#facc15", 5000);
      }

      if (wish.status !== "approved") return;

      const event = eventRef.current;
      const { w, h } = sizeRef.current;
      const layout = measureCard(wish, BASE_CARD_W);
      const from = edge ?? wish.edge ?? event?.settings.edge ?? "center";
      const points = edgePoints(from, w, h, layout);
      const dest = {
        x: w * (0.2 + Math.random() * 0.6),
        y: h * (0.3 + Math.random() * 0.4),
      };

      itemsRef.current.push({
        id: wish.id,
        wish,
        w: layout.w,
        h: layout.h,
        x: points.from.x,
        y: points.from.y,
        vx: 0,
        vy: 0,
        rot: (Math.random() - 0.5) * 0.2,
        vr: (Math.random() - 0.5) * 0.25,
        scale: 0.35,
        alpha: 0,
        phase: "incoming",
        born: Date.now(),
        from: points.from,
        to: points.shield,
        t: 0,
        tDur: 0.9 + Math.random() * 0.4,
        bob: Math.random() * Math.PI * 2,
        target: null,
      });

      // Lời chúc đích đến để sau khi qua khiên sẽ tự trôi về vùng này.
      itemDestRef.current.set(wish.id, dest);
    },
    [showMessage],
  );

  const beginAbsorb = useCallback((item: Item) => {
    const points = shapeRef.current;
    const { w, h } = sizeRef.current;
    item.phase = "absorbing";
    if (!points.length) {
      item.target = { x: w * 0.5, y: h * 0.5 };
      return;
    }
    const point = points[assignRef.current % points.length] ?? points[0]!;
    item.target = shapeToScreen(point, w, h);
    assignRef.current += 1;
  }, []);

  const syncWishes = useCallback(
    (wishes: Wish[]) => {
      for (const wish of wishes) addWish(wish);
    },
    [addWish],
  );

  const removeWish = useCallback((wishId: string) => {
    knownRef.current.delete(wishId);
    wishMapRef.current.delete(wishId);
    itemDestRef.current.delete(wishId);
    itemsRef.current = itemsRef.current.filter((item) => item.id !== wishId);
  }, []);

  /**
   * Đọc hình dạng ảnh do admin tải lên để biến chính ảnh thành vùng tụ:
   * lấy các pixel đậm (ảnh nền trắng) hoặc không trong suốt (ảnh PNG) làm điểm hội tụ.
   */
  const extractShapePoints = useCallback((img: HTMLImageElement): ShapePoint[] => {
    const maxSide = 96;
    const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
    const iw = Math.max(1, Math.round(img.width * scale));
    const ih = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = iw;
    canvas.height = ih;
    const ctx = canvas.getContext("2d");
    if (!ctx) return [];
    ctx.drawImage(img, 0, 0, iw, ih);
    let data: Uint8ClampedArray;
    try {
      data = ctx.getImageData(0, 0, iw, ih).data;
    } catch {
      return [];
    }

    let hasAlpha = false;
    for (let i = 3; i < data.length; i += 4) {
      if ((data[i] ?? 255) < 250) {
        hasAlpha = true;
        break;
      }
    }

    const fit = fitRect(iw, ih);
    const ink: ShapePoint[] = [];
    for (let y = 0; y < ih; y += 1) {
      for (let x = 0; x < iw; x += 1) {
        const i = (y * iw + x) * 4;
        const alpha = data[i + 3] ?? 255;
        const lum = 0.299 * (data[i] ?? 0) + 0.587 * (data[i + 1] ?? 0) + 0.114 * (data[i + 2] ?? 0);
        const on = hasAlpha ? alpha > 128 : lum < 200;
        if (on) {
          ink.push({
            x: fit.dx + ((x + 0.5) / iw) * fit.dw,
            y: fit.dy + ((y + 0.5) / ih) * fit.dh,
          });
        }
      }
    }

    if (!ink.length) return [];
    const target = 160;
    if (ink.length <= target) return ink;
    const step = ink.length / target;
    const out: ShapePoint[] = [];
    for (let i = 0; i < target; i += 1) out.push(ink[Math.floor(i * step)]!);
    return out;
  }, []);

  const setEvent = useCallback(
    (event: WishEvent) => {
      eventRef.current = event;
      shapeRef.current = buildShapePoints(event.settings.shape, SHAPE_CAPACITY);
      capacityRef.current = Math.min(
        shapeRef.current.length || SHAPE_CAPACITY,
        event.settings.shapeCapacity,
      );

      const applyTarget = (img: HTMLImageElement) => {
        const current = eventRef.current;
        if (current?.settings.shape !== "image") return;
        const points = extractShapePoints(img);
        if (points.length) {
          shapeRef.current = points;
          capacityRef.current = Math.min(points.length, current.settings.shapeCapacity);
        }
      };

      const next = {
        shield: event.settings.shieldImageUrl,
        target: event.settings.targetImageUrl,
        bg: event.settings.backgroundUrl,
      };
      const load = (url: string | null, key: "shield" | "target" | "bg") => {
        if (!url || imagesRef.current.urls[key] === url) {
          if (key === "target" && imagesRef.current.target) applyTarget(imagesRef.current.target);
          return;
        }
        const img = new Image();
        img.crossOrigin = "anonymous";
        img.src = url;
        img.onload = () => {
          imagesRef.current[key] = img;
          if (key === "target") applyTarget(img);
        };
        imagesRef.current.urls[key] = url;
      };
      load(next.shield, "shield");
      load(next.target, "target");
      load(next.bg, "bg");
    },
    [extractShapePoints],
  );

  const spotlight = useCallback(
    (wishId: string) => {
      const wish = wishMapRef.current.get(wishId);
      if (!wish) return;
      spotlightRef.current = { wish, t: 0, phase: "in" };
      lastSpotRef.current = Date.now();
    },
    [],
  );

  const absorbAll = useCallback(() => {
    for (const item of itemsRef.current) {
      if (item.phase !== "absorbing") beginAbsorb(item);
    }
  }, [beginAbsorb]);

  const clear = useCallback(() => {
    itemsRef.current = [];
    settledRef.current = [];
    ringsRef.current = [];
    sparksRef.current = [];
    knownRef.current.clear();
    wishMapRef.current.clear();
    itemDestRef.current.clear();
    spriteRef.current.clear();
    assignRef.current = 0;
    spotlightRef.current = null;
    messageRef.current = null;
  }, []);

  useImperativeHandle(
    ref,
    () => ({ addWish, syncWishes, removeWish, setEvent, spotlight, absorbAll, clear }),
    [addWish, syncWishes, removeWish, setEvent, spotlight, absorbAll, clear],
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1);
      const rect = canvas.getBoundingClientRect();
      const w = Math.max(1, rect.width);
      const h = Math.max(1, rect.height);
      sizeRef.current = { w, h };
      if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
        canvas.width = Math.round(w * dpr);
        canvas.height = Math.round(h * dpr);
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const update = (dt: number, now: number) => {
      const event = eventRef.current;
      const { w, h } = sizeRef.current;
      const maxFloating = event?.settings.maxFloating ?? 22;

      let floating = 0;
      for (const item of itemsRef.current) if (item.phase !== "absorbing") floating += 1;

      for (const item of itemsRef.current) {
        if (item.phase === "incoming") {
          item.t += dt;
          const k = Math.min(1, item.t / item.tDur);
          const e = easeOutCubic(k);
          item.x = item.from.x + (item.to.x - item.from.x) * e;
          item.y = item.from.y + (item.to.y - item.from.y) * e;
          item.scale = 0.35 + 0.65 * e;
          item.alpha = Math.min(1, k * 1.4);
          if (k >= 1) {
            const dest = itemDestRef.current.get(item.id) ?? { x: w * 0.5, y: h * 0.5 };
            const dx = dest.x - item.x;
            const dy = dest.y - item.y;
            const dist = Math.hypot(dx, dy) || 1;
            const speed = 70 + Math.random() * 90;
            item.vx = (dx / dist) * speed;
            item.vy = (dy / dist) * speed;
            item.phase = "free";
            spawnRings(item.x, item.y, Math.min(w, h) * 0.32);
            spawnSparks(item.x, item.y, item.wish.color, 22);
            onCueRef.current?.("arrive");
          }
        } else if (item.phase === "free") {
          item.x += item.vx * dt;
          item.y += item.vy * dt;
          item.rot += item.vr * dt;
          const drag = Math.pow(0.5, dt);
          item.vx *= drag;
          item.vy *= drag;
          const marginX = item.w * 0.45;
          const marginY = item.h * 0.45;
          if (item.x < marginX) {
            item.x = marginX;
            item.vx = Math.abs(item.vx) + 6;
          } else if (item.x > w - marginX) {
            item.x = w - marginX;
            item.vx = -Math.abs(item.vx) - 6;
          }
          if (item.y < marginY) {
            item.y = marginY;
            item.vy = Math.abs(item.vy) + 6;
          } else if (item.y > h - marginY) {
            item.y = h - marginY;
            item.vy = -Math.abs(item.vy) - 6;
          }
          if (now - item.born > LIFETIME_MS || floating > maxFloating) {
            beginAbsorb(item);
            floating -= 1;
          }
        } else {
          const target = item.target ?? { x: w * 0.5, y: h * 0.5 };
          const k = Math.min(1, dt * 4);
          const targetScale = settledScale(w, h);
          item.x += (target.x - item.x) * k;
          item.y += (target.y - item.y) * k;
          item.scale += (targetScale - item.scale) * Math.min(1, dt * 2);
          item.alpha -= dt * 0.7;
          item.rot *= Math.pow(0.4, dt);
          const dist = Math.hypot(target.x - item.x, target.y - item.y);
          if (dist < 6 || item.alpha <= 0.05) {
            // Mảnh kết tinh = chính thẻ lời chúc thu nhỏ, không phải icon.
            const light = eventRef.current?.settings.theme === "light";
            const key = `${item.id}:${light ? 1 : 0}`;
            let sprite = spriteRef.current.get(key);
            if (!sprite) {
              const rendered = renderCardSprite(item.wish, BASE_CARD_W, light);
              if (rendered) {
                spriteRef.current.set(key, rendered);
                sprite = rendered;
              }
            }
            if (sprite) {
              const layout = measureCard(item.wish, BASE_CARD_W);
              settledRef.current.push({
                x: target.x,
                y: target.y,
                w: (layout.w + SPRITE_PAD * 2) * targetScale,
                h: (layout.h + SPRITE_PAD * 2) * targetScale,
                angle: (Math.random() - 0.5) * 0.25,
                sprite,
              });
            }
            item.alpha = -1;
          }
        }
      }

      itemsRef.current = itemsRef.current.filter((item) => item.alpha >= 0);

      for (const ring of ringsRef.current) {
        ring.r += (ring.maxR - ring.r) * Math.min(1, dt * 2.6) + dt * 60;
        ring.alpha -= dt * 1.1;
      }
      ringsRef.current = ringsRef.current.filter((ring) => ring.alpha > 0.02);

      for (const spark of sparksRef.current) {
        spark.x += spark.vx * dt;
        spark.y += spark.vy * dt;
        spark.vx *= Math.pow(0.3, dt);
        spark.vy *= Math.pow(0.3, dt);
        spark.life -= dt;
      }
      sparksRef.current = sparksRef.current.filter((spark) => spark.life > 0);

      if (spotlightRef.current) {
        const spot = spotlightRef.current;
        spot.t += dt;
        if (spot.phase === "in" && spot.t > 0.6) {
          spot.phase = "hold";
          spot.t = 0;
        } else if (spot.phase === "hold" && spot.t > SPOTLIGHT_HOLD) {
          spot.phase = "out";
          spot.t = 0;
        } else if (spot.phase === "out" && spot.t > 0.5) {
          spotlightRef.current = null;
        }
      } else if (knownRef.current.size > 0 && now - lastSpotRef.current > SPOTLIGHT_INTERVAL_MS) {
        const pool = itemsRef.current.filter((item) => item.phase === "free");
        if (pool.length) {
          const pick = pool[Math.floor(Math.random() * pool.length)]!;
          spotlightRef.current = { wish: pick.wish, t: 0, phase: "in" };
          lastSpotRef.current = now;
        }
      }

      // Đủ số mảnh thì bùng sáng thành hình ghép tập thể.
      if (settledRef.current.length >= capacityRef.current && now > completionRef.current) {
        completionRef.current = now + 12_000;
        const event2 = eventRef.current;
        const accent2 = event2 ? WISH_THEMES[event2.settings.theme].accent : "#facc15";
        flashRef.current = { startedAt: now, color: accent2, duration: 1300 };
        onCueRef.current?.("complete");
        // Pháo hoa rải khắp màn hình.
        const palette = ["#facc15", "#fb7185", "#38bdf8", "#a855f7", "#22c55e", accent2];
        for (let i = 0; i < 9; i += 1) {
          spawnSparks(
            w * (0.15 + Math.random() * 0.7),
            h * (0.15 + Math.random() * 0.6),
            palette[i % palette.length]!,
            34,
          );
        }
        showMessage(
          event2 && event2.settings.shape === "text" && event2.settings.shapeText
            ? event2.settings.shapeText
            : "Một hình ghép đã hoàn thành",
          "cả hội trường cùng trao yêu thương",
          accent2,
          7000,
        );
        // Giữ hình ghép sáng thêm vài giây cho khán giả chiêm ngưỡng rồi mới tan.
        clearSettledAtRef.current = now + 4500;
      }

      if (clearSettledAtRef.current && now > clearSettledAtRef.current) {
        settledRef.current = [];
        clearSettledAtRef.current = 0;
      }
    };

    const drawShield = (
      x: number,
      y: number,
      radius: number,
      accent: string,
      alpha: number,
      now: number,
    ) => {
      const img = imagesRef.current.shield;
      ctx.save();
      ctx.globalAlpha = alpha;
      if (img) {
        const size = radius * 2.4;
        ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
        ctx.restore();
        return;
      }
      const glow = ctx.createRadialGradient(x, y, 0, x, y, radius * 1.8);
      glow.addColorStop(0, `${accent}cc`);
      glow.addColorStop(0.45, `${accent}44`);
      glow.addColorStop(1, "transparent");
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, radius * 1.8, 0, Math.PI * 2);
      ctx.fill();

      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(now / 6000);
      ctx.strokeStyle = accent;
      ctx.lineWidth = 3.5;
      ctx.shadowColor = accent;
      ctx.shadowBlur = 18;
      ctx.beginPath();
      for (let i = 0; i <= 6; i += 1) {
        const angle = (Math.PI / 3) * i - Math.PI / 2;
        const px = Math.cos(angle) * radius;
        const py = Math.sin(angle) * radius;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
      ctx.closePath();
      ctx.stroke();

      ctx.rotate(-now / 3500);
      ctx.shadowBlur = 0;
      ctx.strokeStyle = `${accent}88`;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 10]);
      ctx.beginPath();
      ctx.arc(0, 0, radius * 0.72, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      ctx.restore();
    };

    const render = (now: number) => {
      const event = eventRef.current;
      const { w, h } = sizeRef.current;
      const theme = event ? WISH_THEMES[event.settings.theme] : WISH_THEMES.aurora;
      const light = event?.settings.theme === "light";
      const accent = theme.accent;

      const gradient = ctx.createLinearGradient(0, 0, w, h);
      gradient.addColorStop(0, theme.bg[0]);
      gradient.addColorStop(0.5, theme.bg[1]);
      gradient.addColorStop(1, theme.bg[2]);
      ctx.fillStyle = gradient;
      ctx.fillRect(0, 0, w, h);

      const bg = imagesRef.current.bg;
      if (bg) {
        ctx.save();
        ctx.globalAlpha = 0.4;
        const scale = Math.max(w / bg.width, h / bg.height);
        ctx.drawImage(bg, (w - bg.width * scale) / 2, (h - bg.height * scale) / 2, bg.width * scale, bg.height * scale);
        ctx.restore();
      }

      // Khiên ở cạnh mặc định của chương trình, luôn phát sáng nhẹ.
      if (event) {
        const edge = event.settings.edge;
        const x = edge === "left" ? w * 0.11 : edge === "right" ? w * 0.89 : w * 0.5;
        const y = edge === "center" ? h * 0.13 : h * 0.5;
        const pulse = 0.5 + 0.2 * Math.sin(now / 700);
        drawShield(x, y, Math.min(w, h) * 0.14, accent, pulse, now);
      }

      // Hình ghép tập thể: nền mờ + ảnh admin tải lên.
      const points = shapeRef.current;
      const target = imagesRef.current.target;
      if (event?.settings.shape === "image" && target) {
        ctx.save();
        ctx.globalAlpha = 0.4;
        const size = Math.min(w, h) * SHAPE_BOX;
        const bx = (w - size) / 2;
        const by = (h - size) / 2;
        const fit = fitRect(target.width, target.height);
        ctx.drawImage(target, bx + fit.dx * size, by + fit.dy * size, fit.dw * size, fit.dh * size);
        ctx.restore();

        // Điểm tụ theo hình dạng ảnh — hiện rất mờ để thấy vùng sẽ lấp đầy.
        ctx.save();
        ctx.globalAlpha = 0.22;
        ctx.fillStyle = accent;
        for (const point of points) {
          const screen = shapeToScreen(point, w, h);
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, 2, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      } else if (event && event.settings.shape === "text" && event.settings.shapeText) {
        ctx.save();
        ctx.globalAlpha = 0.14;
        ctx.fillStyle = light ? "#0f172a" : "#f8fafc";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        const size = Math.min(w * 0.12, h * 0.22);
        ctx.font = `900 ${size}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.fillText(event.settings.shapeText, w / 2, h / 2);
        ctx.restore();
      } else if (points.length) {
        // Viền hình ghép tập thể — luôn nhìn thấy để khách biết đang cùng dệt hình gì.
        ctx.save();
        ctx.globalAlpha = 0.3;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.shadowColor = accent;
        ctx.shadowBlur = 22;
        ctx.beginPath();
        points.forEach((point, index) => {
          const screen = shapeToScreen(point, w, h);
          if (index === 0) ctx.moveTo(screen.x, screen.y);
          else ctx.lineTo(screen.x, screen.y);
        });
        ctx.closePath();
        ctx.stroke();

        ctx.shadowBlur = 0;
        ctx.globalAlpha = 0.45;
        ctx.fillStyle = accent;
        const radius = Math.min(w, h) * 0.005 + 1.6;
        for (const point of points) {
          const screen = shapeToScreen(point, w, h);
          ctx.beginPath();
          ctx.arc(screen.x, screen.y, radius, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Các mảnh đã kết tinh = những lời chúc thu nhỏ xếp thành hình ghép.
      for (const node of settledRef.current) {
        ctx.save();
        ctx.globalAlpha = 0.96;
        ctx.translate(node.x, node.y);
        ctx.rotate(node.angle);
        ctx.drawImage(node.sprite, -node.w / 2, -node.h / 2, node.w, node.h);
        ctx.restore();
      }

      const dim = spotlightRef.current ? 0.28 : 1;

      for (const item of itemsRef.current) {
        const bob = Math.sin(now / 1100 + item.bob) * 7;
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, item.alpha)) * dim;
        ctx.translate(item.x, item.y + bob);
        ctx.rotate(item.rot);
        ctx.scale(item.scale, item.scale);
        drawWishCard(ctx, item.wish, measureCard(item.wish, BASE_CARD_W), light);
        ctx.restore();
      }

      for (const ring of ringsRef.current) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, ring.alpha) * 0.8;
        ctx.strokeStyle = accent;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(ring.x, ring.y, ring.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.restore();
      }

      for (const spark of sparksRef.current) {
        ctx.save();
        ctx.globalAlpha = Math.max(0, Math.min(1, spark.life));
        ctx.fillStyle = spark.color;
        ctx.beginPath();
        ctx.arc(spark.x, spark.y, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      const spot = spotlightRef.current;
      if (spot) {
        const targetW = Math.min(w * 0.5, 560);
        const layout = measureCard(spot.wish, targetW);
        const progress = spot.phase === "in" ? Math.min(1, spot.t / 0.6) : spot.phase === "out" ? 1 - Math.min(1, spot.t / 0.5) : 1;
        const scale = 0.6 + 0.4 * progress;
        ctx.save();
        ctx.globalAlpha = progress * 0.55;
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        ctx.restore();

        ctx.save();
        ctx.globalAlpha = progress;
        ctx.translate(w / 2, h / 2);
        ctx.scale(scale, scale);
        drawWishCard(ctx, spot.wish, layout, light);
        ctx.restore();
      }

      // Tiến độ dệt hình ghép.
      if (capacityRef.current > 0 && knownRef.current.size > 0) {
        ctx.save();
        ctx.globalAlpha = 0.75;
        ctx.textAlign = "center";
        ctx.textBaseline = "alphabetic";
        ctx.fillStyle = light ? "#334155" : "rgba(248,250,252,0.88)";
        ctx.font = `700 ${Math.round(Math.min(w * 0.014, 22))}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.fillText(
          `Đang dệt hình ${Math.min(settledRef.current.length, capacityRef.current)}/${capacityRef.current}`,
          w / 2,
          h - 26,
        );
        ctx.restore();
      }

      const flash = flashRef.current;
      if (flash) {
        const progress = (now - flash.startedAt) / flash.duration;
        if (progress >= 1) {
          flashRef.current = null;
        } else {
          ctx.save();
          ctx.globalAlpha = Math.max(0, 1 - progress) * 0.6;
          ctx.fillStyle = flash.color;
          ctx.fillRect(0, 0, w, h);
          ctx.restore();
        }
      }

      const message = messageRef.current;
      if (message && now < message.until) {
        const appear = Math.min(1, (now - message.startedAt) / 650);
        const scale = 0.7 + 0.3 * easeOutCubic(appear);
        const fade = Math.min(1, Math.max(0, (message.until - now) / 800));
        ctx.save();
        ctx.globalAlpha = Math.min(1, appear * 1.5) * fade;
        ctx.translate(w / 2, h * 0.5);
        ctx.scale(scale, scale);
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillStyle = light ? "#0f172a" : "#f8fafc";
        ctx.font = `900 ${Math.round(Math.min(w * 0.055, h * 0.11))}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.shadowColor = message.color;
        ctx.shadowBlur = 28;
        ctx.fillText(message.text, 0, -18);
        ctx.font = `600 ${Math.round(Math.min(w * 0.022, h * 0.045))}px system-ui, -apple-system, "Segoe UI", sans-serif`;
        ctx.shadowBlur = 10;
        ctx.fillText(message.sub, 0, 34);
        ctx.restore();
      }
    };

    const loop = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      update(dt, now);
      render(now);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      observer.disconnect();
    };
  }, [beginAbsorb, showMessage, spawnRings, spawnSparks]);

  return <canvas ref={canvasRef} className={className} />;
});
