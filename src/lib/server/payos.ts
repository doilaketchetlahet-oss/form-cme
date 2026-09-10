import { PayOS } from "@payos/node";
import type { PaymentConfig } from "@/lib/surveys";

export function createPayOSClient() {
  const clientId = process.env.PAYOS_CLIENT_ID;
  const apiKey = process.env.PAYOS_API_KEY;
  const checksumKey = process.env.PAYOS_CHECKSUM_KEY;

  if (!clientId || !apiKey || !checksumKey) return null;

  return new PayOS({
    clientId,
    apiKey,
    checksumKey,
  });
}

export function normalizePaymentConfig(value: unknown): Required<PaymentConfig> | null {
  const config = (value ?? {}) as PaymentConfig;
  const amount = Number(config.amount ?? 0);
  if (!config.enabled || !Number.isFinite(amount) || amount <= 0) return null;

  return {
    enabled: true,
    amount: Math.round(amount),
    itemName: String(config.itemName || "Vé tham dự").trim().slice(0, 80) || "Vé tham dự",
    description: String(config.description || "Phí đăng ký").trim().slice(0, 120) || "Phí đăng ký",
    expiresInMinutes: Math.max(5, Math.min(7 * 24 * 60, Number(config.expiresInMinutes ?? 60) || 60)),
  };
}

export function isPaymentSettled(status: unknown) {
  return !status || status === "not_required" || status === "paid";
}

export function createOrderCode() {
  const timePart = Date.now().toString().slice(-9);
  const randomPart = Math.floor(Math.random() * 1000).toString().padStart(3, "0");
  return Number(`${timePart}${randomPart}`);
}

export function createPayOSDescription(orderCode: number) {
  return `CME-${orderCode}`.slice(0, 25);
}

export function formatVnd(amount: number) {
  return new Intl.NumberFormat("vi-VN", {
    style: "currency",
    currency: "VND",
    maximumFractionDigits: 0,
  }).format(amount);
}
