// Data normalization helpers for survey answers.

/** Normalize Vietnamese phone: strip spaces/dashes, convert +84/84 prefix to leading 0. */
export function normalizePhone(raw: string): string {
  let s = raw.replace(/[\s.\-()]/g, "");
  if (s.startsWith("+84")) s = "0" + s.slice(3);
  else if (s.startsWith("84") && s.length >= 11) s = "0" + s.slice(2);
  return s;
}

/** Trim + collapse multiple internal spaces. */
export function cleanSpaces(s: string): string {
  return s.trim().replace(/\s+/g, " ");
}

/** Title-case each word (keeps Vietnamese diacritics). */
export function titleCase(s: string): string {
  return cleanSpaces(s)
    .toLowerCase()
    .replace(/(^|\s)(\S)/g, (_, sp, ch) => sp + ch.toUpperCase());
}

/** Looks like a person name: only letters (incl. Vietnamese) + spaces, reasonable length. */
function looksLikeName(s: string): boolean {
  return /^[\p{L}\s]{2,50}$/u.test(s) && /\s/.test(s.trim());
}

/**
 * Normalize a single answer based on question type.
 * - phone: VN phone format
 * - text: trim/collapse spaces; title-case if it looks like a full name
 */
export function normalizeAnswer(
  value: string | number | number[],
  type: string
): string | number | number[] {
  if (typeof value !== "string") return value;
  if (type === "phone") return normalizePhone(value);
  if (type === "text") {
    const cleaned = cleanSpaces(value);
    return looksLikeName(cleaned) ? titleCase(cleaned) : cleaned;
  }
  if (type === "paragraph") return value.trim();
  return value;
}
