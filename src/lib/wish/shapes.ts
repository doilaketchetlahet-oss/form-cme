import type { WishShape } from "./config";

export type ShapePoint = { x: number; y: number };

const GRID_SIZE = 76;

function distanceSquared(a: ShapePoint, b: ShapePoint) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return dx * dx + dy * dy;
}

/**
 * Chọn điểm theo kiểu farthest-point sampling. Quan trọng nhất là mọi tiền tố
 * của danh sách cũng phủ đều hình: 10 lời chúc đầu không bị dồn vào một góc.
 */
export function spreadShapePoints(candidates: ShapePoint[], count: number): ShapePoint[] {
  const wanted = Math.max(1, Math.min(Math.round(count), candidates.length));
  if (!candidates.length) return [];
  if (wanted === 1) return [candidates[Math.floor(candidates.length / 2)]!];

  const selected: ShapePoint[] = [];
  const minDistances = new Float64Array(candidates.length);
  minDistances.fill(Number.POSITIVE_INFINITY);

  // Bắt đầu gần tâm, sau đó luôn chọn điểm xa nhất khỏi các điểm đã có.
  let nextIndex = 0;
  let centerDistance = Number.POSITIVE_INFINITY;
  for (let i = 0; i < candidates.length; i += 1) {
    const d = distanceSquared(candidates[i]!, { x: 0.5, y: 0.5 });
    if (d < centerDistance) {
      centerDistance = d;
      nextIndex = i;
    }
  }

  for (let n = 0; n < wanted; n += 1) {
    const chosen = candidates[nextIndex]!;
    selected.push(chosen);
    let farthest = -1;
    let farthestDistance = -1;
    for (let i = 0; i < candidates.length; i += 1) {
      const d = distanceSquared(candidates[i]!, chosen);
      if (d < minDistances[i]!) minDistances[i] = d;
      if (minDistances[i]! > farthestDistance) {
        farthestDistance = minDistances[i]!;
        farthest = i;
      }
    }
    nextIndex = Math.max(0, farthest);
  }

  return selected;
}

function insidePolygon(point: ShapePoint, polygon: ShapePoint[]) {
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i, i += 1) {
    const a = polygon[i]!;
    const b = polygon[j]!;
    if (
      a.y > point.y !== b.y > point.y &&
      point.x < ((b.x - a.x) * (point.y - a.y)) / (b.y - a.y || 1e-9) + a.x
    ) {
      inside = !inside;
    }
  }
  return inside;
}

function starVertices(): ShapePoint[] {
  const vertices: ShapePoint[] = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? 0.48 : 0.22;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    vertices.push({ x: 0.5 + radius * Math.cos(angle), y: 0.5 + radius * Math.sin(angle) });
  }
  return vertices;
}

function isInside(shape: Exclude<WishShape, "text" | "image">, point: ShapePoint) {
  const nx = (point.x - 0.5) / 0.48;
  const ny = (0.5 - point.y) / 0.46;
  if (shape === "heart") {
    const x = nx * 1.12;
    const y = ny * 1.12 + 0.12;
    const q = x * x + y * y - 1;
    return q * q * q - x * x * y * y * y <= 0;
  }
  if (shape === "star") return insidePolygon(point, starVertices());

  const theta = Math.atan2(ny, nx);
  const radius = Math.hypot(nx, ny);
  const boundary = 0.62 + 0.25 * Math.cos(5 * theta);
  return radius <= boundary || radius < 0.26;
}

function filledCandidates(shape: Exclude<WishShape, "text" | "image">): ShapePoint[] {
  const points: ShapePoint[] = [];
  for (let row = 0; row < GRID_SIZE; row += 1) {
    for (let col = 0; col < GRID_SIZE; col += 1) {
      const point = {
        x: 0.04 + (col / (GRID_SIZE - 1)) * 0.92,
        y: 0.04 + (row / (GRID_SIZE - 1)) * 0.92,
      };
      if (isInside(shape, point)) points.push(point);
    }
  }
  return points;
}

function fallbackCandidates(): ShapePoint[] {
  const points: ShapePoint[] = [];
  for (let row = 0; row < 24; row += 1) {
    for (let col = 0; col < 24; col += 1) {
      points.push({ x: 0.12 + (col / 23) * 0.76, y: 0.2 + (row / 23) * 0.6 });
    }
  }
  return points;
}

/**
 * Tạo các neo lấp đầy hình thay vì chỉ đi dọc đường viền. Thứ tự neo
 * được phân tán đều nên hình vẫn cân đối khi chưa đủ số lời chúc.
 */
export function buildShapePoints(shape: WishShape, count: number): ShapePoint[] {
  const candidates =
    shape === "heart" || shape === "star" || shape === "flower"
      ? filledCandidates(shape)
      : fallbackCandidates();
  return spreadShapePoints(candidates, count);
}
