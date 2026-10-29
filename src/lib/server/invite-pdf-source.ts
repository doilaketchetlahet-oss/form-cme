import { MAX_INVITE_PDF_BYTES } from "@/lib/invite-pdf";

/** Original PDFs must be immutable uploads in this project's storage, never an
 * arbitrary fetch target. Redirects, oversized responses and hangs fail closed. */
export async function fetchInvitePdf(url: string): Promise<Buffer> {
  const parsed = new URL(url);
  const storage = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
  if (parsed.protocol !== "https:" || parsed.origin !== storage.origin || parsed.username || parsed.password
    || !parsed.pathname.startsWith("/storage/v1/object/public/survey-uploads/")) throw new Error("PDF gốc phải nằm trong kho lưu trữ của dự án.");
  const response = await fetch(parsed, { redirect: "error", signal: AbortSignal.timeout(12_000) });
  if (!response.ok || !response.body) throw new Error("Không tải được PDF gốc. Vui lòng tải lại mẫu.");
  if (Number(response.headers.get("content-length")) > MAX_INVITE_PDF_BYTES) {
    await response.body.cancel();
    throw new Error("PDF gốc vượt quá 10MB.");
  }
  const reader = response.body.getReader(), chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > MAX_INVITE_PDF_BYTES) throw new Error("PDF gốc vượt quá 10MB.");
      chunks.push(part.value);
    }
  } finally { await reader.cancel().catch(() => {}); }
  return Buffer.concat(chunks, size);
}
