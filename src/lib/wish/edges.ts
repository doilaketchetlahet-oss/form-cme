/** `center` remains the legacy name for entry from the top of the LED. */
export const WISH_EDGES = ["left", "center", "right", "bottom"] as const;
export type WishEdge = (typeof WISH_EDGES)[number];

export function parseWishEdge(value: unknown): WishEdge | null {
  return typeof value === "string" && WISH_EDGES.includes(value as WishEdge)
    ? (value as WishEdge)
    : null;
}

/** Travel continues in the same direction from the tablet onto the LED. */
const DIRECTIONS = {
  left: { x: 1, y: 0 },
  right: { x: -1, y: 0 },
  center: { x: 0, y: 1 },
  bottom: { x: 0, y: -1 },
} as const;

export function wishFlyTarget(edge: WishEdge, distance: number) {
  const direction = DIRECTIONS[edge];
  return { x: direction.x * distance, y: direction.y * distance, rotate: direction.x * 20 };
}

export function wishEntryPoints(edge: WishEdge, w: number, h: number, card: { w: number; h: number }) {
  const jitter = Math.random() * 0.3 + 0.35;
  const direction = DIRECTIONS[edge];
  if (direction.x) {
    return {
      from: { x: direction.x > 0 ? -card.w * 0.7 : w + card.w * 0.7, y: h * jitter },
      entry: { x: direction.x > 0 ? w * 0.08 : w * 0.92, y: h * jitter },
    };
  }
  return {
    from: { x: w * jitter, y: direction.y > 0 ? -card.h * 0.7 : h + card.h * 0.7 },
    entry: { x: w * jitter, y: direction.y > 0 ? h * 0.1 : h * 0.9 },
  };
}
