import { createHash } from "node:crypto";

/**
 * Hash the opaque token carried by the tracking pixel before it reaches SQL.
 * The raw token is only returned once by the claim RPC and is never persisted.
 */
export function hashMailMergeOpenToken(token: string) {
  // The token itself is 256 bits from two random UUIDs. md5 is used only as a
  // compact database lookup digest (and is available in Supabase and PGlite);
  // it is never used as the source of token entropy or authentication secret.
  return createHash("md5").update(token, "utf8").digest("hex");
}

export function isMailMergeTrackingId(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}
