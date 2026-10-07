import { createSupabaseAdmin } from "@/lib/server/supabase-admin";
import { hashMailMergeOpenToken, isMailMergeTrackingId } from "@/lib/server/mail-merge-tracking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A constant response prevents the public pixel from revealing whether an id
// or token belongs to a campaign. No request metadata is stored.
const PIXEL = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");

function pixel() {
  return new Response(PIXEL, {
    status: 200,
    headers: {
      "Content-Type": "image/gif",
      "Content-Length": String(PIXEL.length),
      "Cache-Control": "no-store, private, max-age=0",
      Pragma: "no-cache",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
      "Referrer-Policy": "no-referrer",
    },
  });
}

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const token = new URL(request.url).searchParams.get("token") ?? "";
    // Keep invalid probes indistinguishable from valid opens.
    if (!isMailMergeTrackingId(id) || !/^[a-f0-9]{64}$/i.test(token)) return pixel();
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) return pixel();
    const service = createSupabaseAdmin();
    if (service) await service.rpc("record_mail_merge_open", { p_recipient: id, p_token_hash: hashMailMergeOpenToken(token) });
  } catch {
    // Tracking must never turn into a visible broken image or expose database errors.
  }
  return pixel();
}
