import { newEmailBlockId, type EmailOverlay, type EmailOverlayPage } from "./email-template";
import { getInvitePdfPages, validateInvitePdfOverlay } from "./invite-pdf";

export type SavedOverlayLayout = { id: string; name: string; overlay: EmailOverlay };

export function validateReusableLayout(overlay: EmailOverlay) {
  if (!overlay || typeof overlay.imageUrl !== "string" || !overlay.imageUrl) throw new Error("Mẫu đã chọn chưa có thiệp.");
  validateInvitePdfOverlay(overlay);
  for (const page of Object.values(getInvitePdfPages(overlay))) {
    if (!Number.isFinite(page.width) || !Number.isFinite(page.height) || page.width <= 0 || page.height <= 0 || !Array.isArray(page.fields) || page.fields.length > 40) throw new Error("Bố cục đã lưu không hợp lệ.");
    for (const field of page.fields) {
      if (!field || !["text", "qr"].includes(field.kind) || typeof field.token !== "string" || ![field.x, field.y, field.w, field.h].every(Number.isFinite)
        || field.x < 0 || field.y < 0 || field.w <= 0 || field.h <= 0 || field.x + field.w > 100.001 || field.y + field.h > 100.001) throw new Error("Vị trí trong bố cục đã lưu không hợp lệ.");
    }
  }
}

/** Copy layouts, never mutate saved templates. Position-only mode preserves the
 * current assets; full mode opens a separate copy of the saved invitation. */
export function applyOverlayLayout(current: EmailOverlay | null, source: EmailOverlay, mode: "positions" | "full"): EmailOverlay {
  validateReusableLayout(source);
  const cloneFields = (page: EmailOverlayPage, width = page.width) => page.fields.map(field => ({ ...field, id: newEmailBlockId(),
    ...(field.fontSize ? { fontSize: field.fontSize * width / page.width } : {}),
  }));
  if (mode === "full") {
    const copy: EmailOverlay = structuredClone(source);
    copy.fields = cloneFields(source);
    if (copy.pdf) copy.pdf.pages = Object.fromEntries(Object.entries(getInvitePdfPages(source)).map(([number, page]) => [number, { ...page, fields: cloneFields(page) }]));
    return copy;
  }
  if (!current?.imageUrl) throw new Error("Tải nền thiệp trước, hoặc chọn Mở cả mẫu thiệp.");
  if (!source.pdf) return { ...current, fields: cloneFields(source, current.width) };
  const sourcePages = getInvitePdfPages(source);
  if (!current.pdf) {
    if (Object.entries(sourcePages).some(([number, page]) => Number(number) !== source.pdf!.page && page.fields.length)) throw new Error("Bố cục có nhiều trang. Chọn Mở cả mẫu thiệp để giữ đầy đủ các trang.");
    return { ...current, fields: cloneFields(source, current.width) };
  }
  if (Object.entries(sourcePages).some(([number, page]) => Number(number) > current.pdf!.pageCount && page.fields.length)) throw new Error("PDF hiện tại không đủ trang cho bố cục đã chọn.");
  const pages = Object.fromEntries(Object.entries(getInvitePdfPages(current)).map(([number, page]) => [number, { ...page, fields: [] as EmailOverlayPage["fields"] }]));
  for (const [number, sourcePage] of Object.entries(sourcePages)) {
    if (Number(number) > current.pdf.pageCount) continue;
    const target = pages[number] ?? { imageUrl: "", width: sourcePage.width, height: sourcePage.height, fields: [] };
    pages[number] = { ...target, fields: cloneFields(sourcePage, target.width) };
  }
  return { ...pages[current.pdf.page], pdf: { ...current.pdf, pages } };
}
