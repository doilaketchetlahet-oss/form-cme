/**
 * Hiệu ứng cho màn đường đua: mốc tiến độ + câu hối thúc.
 *
 * Tách khỏi component để chỉ tính toán thuần, không phụ thuộc React.
 * Điểm quan trọng: xác định "vừa qua mốc" chỉ dựa vào tiến độ trước/sau, nhờ đó
 * hiệu ứng bắn đúng một lần cho mỗi mốc dù số được cập nhật liên tục.
 */

/** Các mốc trên đường đua (phần trăm tiến độ). */
export const CHECKPOINTS = [25, 50, 75] as const;
export type Checkpoint = (typeof CHECKPOINTS)[number];

/** Vạch đích. */
export const FINISH = 100;

/**
 * Câu hối thúc khi một đội vượt mốc. `lead` = đội đang dẫn, `all` = mọi đội.
 * Câu được chọn theo mốc và theo việc có đang dẫn đầu hay không, để màn hình
 * vừa gấp rút vừa có thông tin.
 */
type Line = { text: string; tone: "hype" | "lead" | "finish" };

const LINES: Record<number, Line[]> = {
  25: [
    { text: "Khởi động xong! Tăng tốc lên nào!", tone: "hype" },
    { text: "Vừa qua 25% — còn 3/4 chặng đường!", tone: "hype" },
    { text: "Đại bàng đã cất cánh, bay cao hơn đi!", tone: "hype" },
  ],
  50: [
    { text: "Nửa đường rồi! Giữ nhịp, đừng buông tay!", tone: "hype" },
    { text: "50% — khoảng cách đang dãn ra!", tone: "hype" },
    { text: "Sắp về đích, cố thêm chút nữa!", tone: "hype" },
  ],
  75: [
    { text: "75% rồi! Về đích hay không là ở đây!", tone: "hype" },
    { text: "Gần tới rồi, lắc mạnh hơn nữa!", tone: "hype" },
    { text: "Nước rút đi nào, khán đài đang chờ!", tone: "hype" },
  ],
};

const LEAD_PREFIX = "🏆 ";
const FINISH_LINES = [
  "🏁 Về đích! Tay lắc vàng đã lộ diện!",
  "🏁 Chạm đích rồi, tuyệt vời!",
];

export type MilestoneEvent = {
  /** Đội vượt mốc. */
  teamId: string;
  teamName: string;
  teamColor: string;
  /** Mốc vừa vượt. */
  checkpoint: Checkpoint | 100;
  /** Câu hối thúc hiển thị. */
  text: string;
  /** true khi là vạch đích. */
  finished: boolean;
  /** true khi đội này đang dẫn đầu toàn bộ. */
  leading: boolean;
  /** Khoá duy nhất cho hiệu ứng (dùng làm React key). */
  id: string;
};

function pickLine(lines: Line[], seed: number): Line {
  return lines[Math.abs(seed) % lines.length];
}

/**
 * Tìm các mốc vừa bị vượt giữa hai lần cập nhật.
 *
 * @param prev Tiến độ (0..1) trước đó, theo team_id.
 * @param next Tiến độ hiện tại, theo team_id.
 * @param names Tên + màu đội để hiển thị.
 * @param seed Hạt ngẫu nhiên để đổi câu giữa các lần, tránh lặp nhàm chán.
 */
export function detectMilestones(
  prev: Map<string, number>,
  next: Map<string, number>,
  names: Map<string, { name: string; color: string }>,
  seed: number,
): MilestoneEvent[] {
  const events: MilestoneEvent[] = [];
  // Chỉ đội cao nhất (và không đồng hạng) mới được coi là dẫn đầu, nếu không
  // hai đội bằng điểm sẽ cùng hiện "dẫn đầu" gây khó hiểu.
  const sorted = [...next.values()].sort((a, b) => b - a);
  const top = sorted[0] ?? 0;
  const isUniqueTop = sorted.length > 1 ? top > sorted[1] : top > 0;

  for (const [teamId, nextProgress] of next) {
    const prevProgress = prev.get(teamId);
    if (prevProgress === undefined) continue; // đội mới vào: không bắn hiệu ứng cũ
    if (nextProgress <= prevProgress) continue;

    const meta = names.get(teamId);
    if (!meta) continue;

    // Bỏ qua bước nhảy lớn (mạng chớp rồi bù): chỉ lấy mốc thấp nhất bị vượt
    // để hiệu ứng không dồn cục khi bảng xếp hạng nhảy cóc.
    const firstHit = [...CHECKPOINTS, FINISH].find(
      (mark) => prevProgress < mark / 100 && nextProgress >= mark / 100,
    );
    if (firstHit === undefined) continue;

    const leading = isUniqueTop && nextProgress >= top;

    if (firstHit === FINISH) {
      events.push({
        teamId,
        teamName: meta.name,
        teamColor: meta.color,
        checkpoint: 100,
        text: FINISH_LINES[Math.abs(seed + next.size) % FINISH_LINES.length],
        finished: true,
        leading,
        id: `${teamId}-100-${seed}`,
      });
      continue;
    }

    const line = pickLine(LINES[firstHit], seed + teamId.length);
    events.push({
      teamId,
      teamName: meta.name,
      teamColor: meta.color,
      checkpoint: firstHit as Checkpoint,
      text: leading ? `${LEAD_PREFIX}${meta.name} dẫn đầu! ${line.text}` : line.text,
      finished: false,
      leading,
      id: `${teamId}-${firstHit}-${seed}`,
    });
  }

  return events;
}

/** Pháo hoa nhỏ: danh sách hướng + độ trễ để tạo cảm giác bắn tỏa. */
export const SPARK_DIRECTIONS = [
  { angle: -90, distance: 34, delay: 0 },
  { angle: -50, distance: 40, delay: 40 },
  { angle: -130, distance: 40, delay: 40 },
  { angle: -10, distance: 34, delay: 90 },
  { angle: -170, distance: 34, delay: 90 },
  { angle: 30, distance: 30, delay: 140 },
  { angle: -210, distance: 30, delay: 140 },
  { angle: 0, distance: 46, delay: 180 },
  { angle: 180, distance: 46, delay: 180 },
];
