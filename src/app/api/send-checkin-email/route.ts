import { NextRequest, NextResponse } from "next/server";
import { getRequestSiteUrl } from "@/lib/site-url";
import { sendCheckinEmail } from "@/lib/server/checkin-email";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const { to, checkinUrl } = (body ?? {}) as { to?: string; checkinUrl?: string };

  if (!to || !checkinUrl) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const origin = getRequestSiteUrl(req.nextUrl.origin);
  let result: Awaited<ReturnType<typeof sendCheckinEmail>>;
  try {
    result = await sendCheckinEmail({ ...body, origin });
  } catch (error) {
    // Always answer with JSON so the UI can show (and store) the real reason.
    const detail = error instanceof Error ? error.message : "Send crashed";
    return NextResponse.json(
      { error: "Send failed", detail, provider: "unknown" },
      { status: 500 },
    );
  }

  if (!result.ok) {
    return NextResponse.json(
      { error: "Send failed", detail: result.error, provider: result.provider },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, resendId: result.messageId, provider: result.provider });
}
