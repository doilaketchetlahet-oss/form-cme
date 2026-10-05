export const GAME_SESSION_COOKIE = "eventplay_access_token";

/** The iframe and standalone studio tab share a server-issued HttpOnly cookie. */
export function getGameAccessToken(request: Request): string | null {
  const bearer = request.headers.get("authorization")?.match(/^Bearer\s+(.+)$/i);
  if (bearer) return bearer[1].trim() || null;

  const cookie = request.headers.get("cookie")?.split(";").map((part) => part.trim())
    .find((part) => part.startsWith(`${GAME_SESSION_COOKIE}=`));
  if (!cookie) return null;
  try {
    return decodeURIComponent(cookie.slice(GAME_SESSION_COOKIE.length + 1)) || null;
  } catch {
    return null;
  }
}
