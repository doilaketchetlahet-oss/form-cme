import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import type { PrizeResult } from "@/lib/prize-draw";

export const prizeCookie = (id: string) => `prize_${id}`;
export const prizeHash = (token: string) => createHash("sha256").update(token).digest("hex");
export function publicPrizeEntry(row: PrizeResult | null): PrizeResult | null {
  if (!row) return null;
  return { id: row.id, prize_id: row.prize_id, prize_name: row.prize_name, prize_color: row.prize_color,
    claim_code: row.prize_id ? row.claim_code : "", drawn_at: row.drawn_at, redeemed_at: row.redeemed_at };
}
export function prizeError(error: { message?: string; code?: string } | null, fallback = "Không thực hiện được thao tác. Vui lòng thử lại.") {
  const messages: Record<string, string> = {
    NOT_FOUND: "Không tìm thấy chương trình hoặc lượt quay.",
    PHONE_USED: "SĐT này đã đăng ký chương trình. Hãy mở trên thiết bị đã đăng ký hoặc liên hệ nhân viên; không được cấp thêm lượt.",
    NOT_ACTIVE: "Chương trình chưa mở hoặc đã tạm dừng/đóng.",
    OUTSIDE_WINDOW: "Ngoài thời gian diễn ra chương trình.",
    SOLD_OUT: "Quà đã hết. Cảm ơn bạn đã tham gia!",
    FORM_CLOSED: "Form đã đóng đăng ký.",
    REGISTRATION_REQUIRED: "Vui lòng điền form trên thiết bị này trước khi quay.",
    PHONE_QUESTION_INVALID: "Câu hỏi SĐT của chương trình không còn hợp lệ. Vui lòng liên hệ ban tổ chức.",
    FORM_UNAVAILABLE: "Chọn form khảo sát trống, chưa gắn chương trình và không có thanh toán/check-in.",
    STALE_REVISION: "Cấu hình đã được sửa ở nơi khác. Hãy tải lại trước khi lưu.",
    BELOW_DISTRIBUTED: "Số lượng mới không được ít hơn số quà đã trúng.",
    PRIZES_LOCKED: "Đã có người đăng ký: không thể xóa loại quà. Có thể điều chỉnh tồn kho hoặc thêm loại mới.",
    REDEMPTION_DISABLED: "Chương trình đang tắt xác nhận trao quà.",
  };
  const code = Object.keys(messages).find(key => error?.message?.includes(key));
  if (code) return NextResponse.json({ ok: false, error: messages[code] }, { status: code === "NOT_FOUND" ? 404 : 409 });
  if (["42P01", "42703", "PGRST202", "PGRST205"].includes(error?.code ?? "")) return NextResponse.json({ ok: false, error: "Cần chạy supabase/prize-draw.sql để khởi tạo công cụ." }, { status: 503 });
  return NextResponse.json({ ok: false, error: fallback }, { status: 500 });
}
