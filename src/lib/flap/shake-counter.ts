"use client";

/**
 * Đếm động tác lắc điện thoại bằng cảm biến gia tốc.
 *
 * Nguyên tắc để công bằng giữa các dòng máy:
 * - Hiệu chuẩn 1,5s khi vào phòng để tách trọng lực khỏi chuyển động.
 * - Tính cường độ trên cả 3 trục, sau khi đã trừ trọng lực.
 * - Chỉ tính điểm khi có đổi hướng rõ ràng (vượt ngưỡng dương -> âm hoặc ngược lại).
 * - Có khoảng nghỉ tối thiểu giữa hai lần tính điểm (tránh một cú lắc ăn nhiều điểm).
 */

export type ShakeStats = {
  /** Số lần lắc đã đếm được (tổng). */
  shakes: number;
  /** Cường độ tức thời để hiển thị thanh năng lượng. */
  intensity: number;
  /** true khi cảm biến đã sẵn sàng (đã cấp quyền + hiệu chuẩn xong). */
  ready: boolean;
};

export type ShakeCounter = {
  /** Bắt đầu nghe cảm biến. Trả về false nếu trình duyệt không hỗ trợ. */
  start: (onSample: (stats: ShakeStats) => void) => void;
  /** Tạm dừng/Khởi động lại việc ghi nhận (dùng giữa các lượt chơi). */
  setActive: (active: boolean) => void;
  /** Chạy lại hiệu chuẩn cảm biến. */
  recalibrate: () => void;
  /** Số lần lắc hiện tại. */
  count: () => number;
  /** Có đang dùng được cảm biến không. */
  supported: () => boolean;
  stop: () => void;
};

const MIN_SWING_G = 1.1;      // ngưỡng đổi hướng (đơn vị ~g)
const MIN_SAMPLE_MS = 90;     // khoảng nghỉ giữa 2 lần tính điểm
const CALIBRATION_MS = 1500;

type DeviceMotionEventWithPermission = typeof DeviceMotionEvent & {
  requestPermission?: () => Promise<"granted" | "denied">;
};

/** iOS yêu cầu xin quyền từ một thao tác của người dùng. */
export async function requestMotionPermission(): Promise<boolean> {
  if (typeof window === "undefined" || !("DeviceMotionEvent" in window)) return false;
  const ctor = window.DeviceMotionEvent as DeviceMotionEventWithPermission;
  if (typeof ctor.requestPermission !== "function") return true; // Android: không cần hỏi
  try {
    return (await ctor.requestPermission()) === "granted";
  } catch {
    return false;
  }
}

export function motionSupported(): boolean {
  return typeof window !== "undefined" && "DeviceMotionEvent" in window;
}

export function createShakeCounter(): ShakeCounter {
  let shakes = 0;
  let ready = false;
  let active = true;
  let listening = false;

  // Ước lượng trọng lực bằng trung bình trượt (low-pass) để tách khỏi chuyển động.
  const gravity = { x: 0, y: 9.8, z: 0 };
  const GRAVITY_ALPHA = 0.8;
  let lastSign = 0;
  let lastCountAt = 0;
  let calibrating = true;
  let calibrationUntil = 0;
  let onSample: ((stats: ShakeStats) => void) | null = null;

  const handler = (event: DeviceMotionEvent) => {
    const acc = event.accelerationIncludingGravity;
    if (!acc || acc.x == null || acc.y == null || acc.z == null) return;

    const now = performance.now();

    // Hiệu chuẩn: giai đoạn đầu chỉ học trọng lực, không tính điểm.
    if (calibrating) {
      gravity.x = gravity.x * GRAVITY_ALPHA + acc.x * (1 - GRAVITY_ALPHA);
      gravity.y = gravity.y * GRAVITY_ALPHA + acc.y * (1 - GRAVITY_ALPHA);
      gravity.z = gravity.z * GRAVITY_ALPHA + acc.z * (1 - GRAVITY_ALPHA);
      if (now >= calibrationUntil) {
        calibrating = false;
        ready = true;
      }
      onSample?.({ shakes, intensity: 0, ready });
      return;
    }

    // Gia tốc tuyến tính = gia tốc đo được - trọng lực ước lượng.
    const lx = acc.x - gravity.x;
    const ly = acc.y - gravity.y;
    const lz = acc.z - gravity.z;
    const magnitude = Math.sqrt(lx * lx + ly * ly + lz * lz);

    // Cập nhật trọng lực chậm hơn để không "ăn" mất chuyển động thật.
    gravity.x = gravity.x * 0.95 + acc.x * 0.05;
    gravity.y = gravity.y * 0.95 + acc.y * 0.05;
    gravity.z = gravity.z * 0.95 + acc.z * 0.05;

    const intensity = Math.min(1, magnitude / 18);

    if (active) {
      // Chỉ tính khi vượt ngưỡng đổi hướng và đủ khoảng nghỉ.
      const swing = magnitude >= MIN_SWING_G * 9.8 ? 1 : 0;
      const sign = magnitude >= MIN_SWING_G * 9.8 ? Math.sign(lx + ly + lz) || 1 : 0;

      if (swing === 1 && sign !== 0 && sign !== lastSign && now - lastCountAt >= MIN_SAMPLE_MS) {
        shakes += 1;
        lastSign = sign;
        lastCountAt = now;
      } else if (sign !== 0) {
        lastSign = sign;
      }
    }

    onSample?.({ shakes, intensity, ready });
  };

  return {
    start(cb) {
      onSample = cb;
      if (listening) return;
      calibrating = true;
      calibrationUntil = performance.now() + CALIBRATION_MS;
      lastCountAt = 0;
      lastSign = 0;
      window.addEventListener("devicemotion", handler, { passive: true });
      listening = true;
    },
    setActive(next) {
      active = next;
      if (next) {
        // Nghỉ một nhịp sau khi bật lại để không cộng dồn cú lắc cũ.
        lastCountAt = performance.now();
        lastSign = 0;
      }
    },
    recalibrate() {
      calibrating = true;
      calibrationUntil = performance.now() + CALIBRATION_MS;
      ready = false;
    },
    count() {
      return shakes;
    },
    supported() {
      return motionSupported();
    },
    stop() {
      if (!listening) return;
      window.removeEventListener("devicemotion", handler);
      listening = false;
      onSample = null;
    },
  };
}
