import { readFile } from "node:fs/promises";
import path from "node:path";
import { overlayFontFile } from "../overlay-fonts";
import { createSupabaseAdmin } from "./supabase-admin";
import { resolveCustomFontFile } from "./custom-fonts";
import type { InviteFontLoader } from "../invite-pdf-vector";

export const loadInviteFont: InviteFontLoader = async (id, bold) => {
  if (id?.startsWith("custom:")) {
    const admin = createSupabaseAdmin();
    const font = admin ? await resolveCustomFontFile(admin, id.slice(7)) : null;
    if (!font) throw new Error("Không tải được font tùy chỉnh. Vui lòng chọn lại font trước khi xuất PDF.");
    return readFile(font.file);
  }
  return readFile(overlayFontFile(id, bold, path.join(process.cwd(), "public", "fonts")));
};
