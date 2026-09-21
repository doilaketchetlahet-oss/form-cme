import type { WishShape } from "./config";

export type ShapePoint = { x: number; y: number };

/** Rút `count` điểm trải đều trên một danh sách điểm dày đặc. */
function sample(dense: ShapePoint[], count: number): ShapePoint[] {
  if (dense.length === 0) return [];
  const out: ShapePoint[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(dense[Math.floor((i / count) * dense.length)]!);
  }
  return out;
}

function heartDense(): ShapePoint[] {
  const points: ShapePoint[] = [];
  for (let i = 0; i < 600; i += 1) {
    const t = (i / 600) * Math.PI * 2;
    const x = 16 * Math.sin(t) ** 3;
    const y = 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t);
    // Vùng chứa thực tế: x ∈ [-16, 16], y ∈ [-17, 13].
    points.push({ x: (x + 16) / 32, y: 1 - (y + 17) / 30 });
  }
  return points;
}

function starDense(): ShapePoint[] {
  const points: ShapePoint[] = [];
  const spikes = 5;
  const outer = 0.5;
  const inner = 0.21;
  const vertices: ShapePoint[] = [];
  for (let i = 0; i < spikes * 2; i += 1) {
    const radius = i % 2 === 0 ? outer : inner;
    const angle = (Math.PI / spikes) * i - Math.PI / 2;
    vertices.push({ x: 0.5 + radius * Math.cos(angle), y: 0.5 + radius * Math.sin(angle) });
  }
  for (let i = 0; i < vertices.length; i += 1) {
    const a = vertices[i]!;
    const b = vertices[(i + 1) % vertices.length]!;
    for (let s = 0; s < 24; s += 1) {
      const t = s / 24;
      points.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
    }
  }
  return points;
}

function flowerDense(): ShapePoint[] {
  const points: ShapePoint[] = [];
  for (let i = 0; i < 600; i += 1) {
    const theta = (i / 600) * Math.PI * 2;
    const r = Math.cos(5 * theta);
    points.push({ x: 0.5 + 0.42 * r * Math.cos(theta), y: 0.5 + 0.42 * r * Math.sin(theta) });
  }
  return points;
}

function ringDense(): ShapePoint[] {
  const points: ShapePoint[] = [];
  for (let i = 0; i < 300; i += 1) {
    const theta = (i / 300) * Math.PI * 2;
    points.push({ x: 0.5 + 0.34 * Math.cos(theta), y: 0.5 + 0.3 * Math.sin(theta) });
  }
  return points;
}

/** Dải chữ: lấp theo hàng ngang để các lời chúc ghép thành một khối chữ. */
function textDense(): ShapePoint[] {
  const points: ShapePoint[] = [];
  const rows = 4;
  const cols = 22;
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      points.push({
        x: 0.12 + (c / (cols - 1)) * 0.76,
        y: 0.32 + (r / (rows - 1)) * 0.36,
      });
    }
  }
  return points;
}

/**
 * Điểm hội tụ của hình ghép tập thể (toạ độ chuẩn hoá 0..1).
 * Hình dạng có thể thay bằng ảnh admin tải lên sau (shape = "image").
 */
export function buildShapePoints(shape: WishShape, count: number): ShapePoint[] {
  const dense =
    shape === "heart"
      ? heartDense()
      : shape === "star"
        ? starDense()
        : shape === "flower"
          ? flowerDense()
          : shape === "text"
            ? textDense()
            : ringDense();
  // Nhân đôi để vòng theo viền liền mạch, rồi trải đều.
  return sample([...dense, ...dense], Math.max(1, count));
}
