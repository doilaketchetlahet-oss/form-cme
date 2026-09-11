import { NextRequest, NextResponse } from "next/server";
import crypto from "node:crypto";
import { createSupabaseAdmin } from "@/lib/server/supabase-admin";

export const runtime = "nodejs";

type ResendEvent = {
  type: string;
  data?: {
    email_id?: string;
    to?: string[] | string;
    [key: string]: unknown;
  };
};

function verifySvix(secret: string, headers: Headers, rawBody: string): boolean {
  const id = headers.get("svix-id");
  const timestamp = headers.get("svix-timestamp");
  const signature = headers.get("svix-signature");
  if (!id || !timestamp || !signature) return false;

  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ""), "base64");
  const signedContent = `${id}.${timestamp}.${rawBody}`;
  const expected = crypto.createHmac("sha256", secretBytes).update(signedContent).digest("base64");
  const expectedBuffer = Buffer.from(expected);

  return signature.split(" ").some((part) => {
    const value = part.split(",")[1];
    if (!value) return false;
    const provided = Buffer.from(value);
    return provided.length === expectedBuffer.length && crypto.timingSafeEqual(provided, expectedBuffer);
  });
}

const EVENT_COLUMNS: Record<string, string> = {
  "email.delivered": "email_delivered_at",
  "email.opened": "email_opened_at",
  "email.bounced": "email_bounced_at",
};

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const secret = process.env.RESEND_WEBHOOK_SECRET;

  if (secret && !verifySvix(secret, request.headers, rawBody)) {
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 401 });
  }

  const event = JSON.parse(rawBody) as ResendEvent;
  const messageId = event.data?.email_id;

  const supabase = createSupabaseAdmin();
  if (!supabase) {
    return NextResponse.json({ ok: true });
  }

  let responseId: string | null = null;
  if (messageId) {
    const { data } = await supabase
      .from("survey_responses")
      .select("id")
      .eq("resend_email_id", messageId)
      .maybeSingle();
    responseId = data?.id ?? null;
  }

  const shortType = event.type?.replace(/^email\./, "") || event.type || "unknown";

  const patch: Record<string, string | null> = { email_last_event: shortType };
  const column = EVENT_COLUMNS[event.type];
  if (column) patch[column] = new Date().toISOString();
  if (event.type === "email.bounced") patch.email_status = "failed";

  if (responseId) {
    await supabase.from("survey_responses").update(patch).eq("id", responseId);
  }

  await supabase.from("email_events").insert({
    response_id: responseId,
    provider_message_id: messageId ?? null,
    event_type: event.type ?? "unknown",
    payload: event as unknown as Record<string, unknown>,
  });

  return NextResponse.json({ ok: true });
}

export async function GET() {
  return NextResponse.json({ ok: true, endpoint: "resend-webhook" });
}
