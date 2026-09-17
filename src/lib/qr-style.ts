import type { QRBranding } from "@/lib/surveys";

export const QR_STYLE_VERSION = "ocean-logo-v2";

function cleanHex(value: string | undefined, fallback: string) {
  if (!value) return fallback;
  const normalized = value.trim();
  return /^#[0-9a-fA-F]{6}$/.test(normalized) ? normalized : fallback;
}

function clamp(value: number | undefined, min: number, max: number, fallback: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(value ?? fallback, max));
}

export function normalizeQrBranding(qr?: QRBranding | null): Required<Omit<QRBranding, "logoUrl">> & { logoUrl: string | null } {
  return {
    darkColor: cleanHex(qr?.darkColor, "#0369a1"),
    accentColor: cleanHex(qr?.accentColor, "#0891b2"),
    lightColor: cleanHex(qr?.lightColor, "#f8fdff"),
    logoUrl: qr?.logoUrl?.trim() || "/logo_qr.png",
    logoEnabled: qr?.logoEnabled !== false,
    logoSize: clamp(qr?.logoSize, 12, 28, 24),
    moduleRadius: clamp(qr?.moduleRadius, 0, 50, 32),
  };
}

export function qrStyleKey(qr?: QRBranding | null) {
  const normalized = normalizeQrBranding(qr);
  return [
    QR_STYLE_VERSION,
    normalized.darkColor.replace("#", ""),
    normalized.accentColor.replace("#", ""),
    normalized.lightColor.replace("#", ""),
    normalized.logoEnabled ? "logo" : "nologo",
    normalized.logoSize,
    normalized.moduleRadius,
    normalized.logoUrl ? encodeURIComponent(normalized.logoUrl).slice(-18) : "default",
  ].join("-");
}

export function buildQrImagePath(data: string, size: number, qr?: QRBranding | null, format: "svg" | "png" = "svg") {
  const normalized = normalizeQrBranding(qr);
  const params = new URLSearchParams({
    size: String(size),
    style: qrStyleKey(qr),
    dark: normalized.darkColor,
    accent: normalized.accentColor,
    light: normalized.lightColor,
    logo: normalized.logoEnabled ? "1" : "0",
    logoSize: String(normalized.logoSize),
    radius: String(normalized.moduleRadius),
    data,
  });
  if (format === "png") params.set("format", "png");
  if (normalized.logoUrl) params.set("logoUrl", normalized.logoUrl);
  return `/api/qr?${params.toString()}`;
}
