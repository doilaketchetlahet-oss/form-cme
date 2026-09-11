import { NextRequest, NextResponse } from "next/server";
import { getRequestSiteUrl } from "@/lib/site-url";
import { sendCheckinEmail } from "@/lib/server/checkin-email";

export const maxDuration = 30;

export async function POST(req: NextRequest) {
  const body = await req.json();
  const { to, checkinUrl } = body ?? {};

  if (!to || !checkinUrl) {
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });
  }

  const origin = getRequestSiteUrl(req.nextUrl.origin);
  const result = await sendCheckinEmail({ ...body, origin });

  if (!result.ok) {
    return NextResponse.json(
      { error: "Send failed", detail: result.error, provider: result.provider },
      { status: 500 },
    );
  }

  return NextResponse.json({ ok: true, resendId: result.messageId, provider: result.provider });
}
