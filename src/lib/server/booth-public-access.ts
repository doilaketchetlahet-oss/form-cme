import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

export type PublicBoothSessionRow = {
  id: string;
  access_mode: "admin" | "public";
  passcode_hash: string | null;
  passcode_lookup: string | null;
  expires_at: string | null;
};

type AccessFailure = { error: string; status: number };

const attempts = new Map<string, { count: number; resetAt: number }>();

function clientKey(request: Request, scope: string) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || request.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`${scope}:${ip}`).digest("hex");
}

export function checkPublicBoothRateLimit(request: Request, scope: string, maximum: number, windowMs: number) {
  const key = clientKey(request, scope);
  const now = Date.now();
  const current = attempts.get(key);
  if (!current || current.resetAt <= now) {
    attempts.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (current.count >= maximum) return false;
  current.count += 1;
  return true;
}

export function createBoothServiceClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) return null;
  return createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });
}

export function hashBoothPasscode(passcode: string) {
  const salt = randomBytes(16);
  const hash = scryptSync(passcode, salt, 64);
  return `scrypt$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function boothPasscodeLookup(passcode: string) {
  const serverSecret = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!serverSecret) throw new Error("Thiếu cấu hình Supabase server.");
  return createHmac("sha256", serverSecret).update(passcode).digest("hex");
}

export function verifyBoothPasscode(passcode: string, stored: string | null) {
  if (!stored) return false;
  const [algorithm, saltText, hashText] = stored.split("$");
  if (algorithm !== "scrypt" || !saltText || !hashText) return false;
  try {
    const expected = Buffer.from(hashText, "base64url");
    const actual = scryptSync(passcode, Buffer.from(saltText, "base64url"), expected.length);
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export async function authorizePublicBoothWrite(
  request: Request,
  service: SupabaseClient,
  sessionId: string,
  passcode: string,
): Promise<{ session: PublicBoothSessionRow } | AccessFailure> {
  const failureKey = clientKey(request, `passcode:${sessionId}`);
  const now = Date.now();
  const failures = attempts.get(failureKey);
  if (failures && failures.resetAt > now && failures.count >= 10) {
    return { error: "Thử passcode quá nhiều lần. Vui lòng đợi 15 phút.", status: 429 };
  }

  const { data, error } = await service
    .from("booth_draw_sessions")
    .select("id, access_mode, passcode_hash, passcode_lookup, expires_at")
    .eq("id", sessionId)
    .maybeSingle();
  if (error) return { error: error.message, status: 500 };
  const session = data as PublicBoothSessionRow | null;
  if (!session || session.access_mode !== "public") return { error: "Không tìm thấy phiên công khai.", status: 404 };
  if (!session.expires_at || new Date(session.expires_at).getTime() <= Date.now()) {
    return { error: "Phiên miễn phí đã hết hạn và đang chờ xoá.", status: 410 };
  }
  if (!verifyBoothPasscode(passcode, session.passcode_hash)) {
    if (!failures || failures.resetAt <= now) attempts.set(failureKey, { count: 1, resetAt: now + 15 * 60 * 1000 });
    else failures.count += 1;
    return { error: "Passcode không đúng.", status: 403 };
  }
  attempts.delete(failureKey);
  if (!session.passcode_lookup) {
    await service
      .from("booth_draw_sessions")
      .update({ passcode_lookup: boothPasscodeLookup(passcode) })
      .eq("id", session.id)
      .is("passcode_lookup", null);
  }
  return { session };
}
