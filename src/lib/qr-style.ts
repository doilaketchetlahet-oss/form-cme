import type { QRBranding } from "@/lib/surveys";

export const QR_STYLE_VERSION = "qr-v4";

export const DEFAULT_QR_BRANDING = {
  darkColor: "#000000",
  accentColor: "#000000",
  lightColor: "#ffffff",
  logoEnabled: false,
  logoUrl: null,
  logoSize: 24,
  moduleRadius: 0,
} satisfies Required<QRBranding>;

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
    darkColor: cleanHex(qr?.darkColor, DEFAULT_QR_BRANDING.darkColor),
    accentColor: cleanHex(qr?.accentColor, DEFAULT_QR_BRANDING.accentColor),
    lightColor: cleanHex(qr?.lightColor, DEFAULT_QR_BRANDING.lightColor),
    logoUrl: qr?.logoUrl?.trim() || null,
    logoEnabled: qr?.logoEnabled === true,
    logoSize: clamp(qr?.logoSize, 12, 28, DEFAULT_QR_BRANDING.logoSize),
    moduleRadius: clamp(qr?.moduleRadius, 0, 50, DEFAULT_QR_BRANDING.moduleRadius),
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
