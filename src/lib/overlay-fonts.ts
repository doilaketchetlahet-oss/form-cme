/**
 * Danh sách font dùng cho thiệp mời (ảnh trong email + PDF).
 *
 * Mọi font đều có bộ ký tự tiếng Việt đầy đủ và 2 độ đậm Regular/Bold,
 * được bundle trong `public/fonts` để serverless render ổn định.
 *
 * File đặt tên `<file>-Regular.ttf` / `<file>-Bold.ttf`.
 */
export type OverlayFont = {
  id: string;
  label: string;
  hint: string;
  /** Tên family dùng cho canvas ở trình duyệt. */
  family: string;
  /** Tiền tố tên file trong public/fonts. */
  file: string;
};

export const OVERLAY_FONTS: OverlayFont[] = [
  { id: "noto-sans", label: "Noto Sans", hint: "Hiện đại, dễ đọc (mặc định)", family: "Noto Sans", file: "NotoSans" },
  { id: "noto-serif", label: "Noto Serif", hint: "Trang trọng, cổ điển", family: "Noto Serif", file: "NotoSerif" },
  { id: "playfair", label: "Playfair Display", hint: "Sang trọng, nét mảnh", family: "Playfair Display", file: "PlayfairDisplay" },
  { id: "be-vietnam", label: "Be Vietnam Pro", hint: "Gọn, hiện đại, tiếng Việt đẹp", family: "Be Vietnam Pro", file: "BeVietnamPro" },
];

export const DEFAULT_OVERLAY_FONT = "noto-sans";

export function resolveOverlayFont(id?: string | null): OverlayFont {
  return OVERLAY_FONTS.find((font) => font.id === id) ?? OVERLAY_FONTS[0];
}

export function overlayFontFile(id: string | null | undefined, bold: boolean | undefined, dir: string) {
  const font = resolveOverlayFont(id);
  return `${dir}/${font.file}-${bold ? "Bold" : "Regular"}.ttf`;
}
