import { NextResponse } from "next/server";
import { authorizeGame } from "@/lib/game/auth";
import { GAME_SESSION_COOKIE, getGameAccessToken } from "@/lib/game/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function sameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  return !origin || origin === new URL(request.url).origin;
}

function sessionCookie(request: Request) {
  return {
    httpOnly: true,
    secure: new URL(request.url).protocol === "https:",
    sameSite: "lax" as const,
    path: "/",
  };
}

/** Establish a verified browser session before navigating the studio iframe. */
export async function POST(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  if (!request.headers.get("authorization")?.match(/^Bearer\s+\S+$/i)) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  const auth = await authorizeGame(request);
  if ("error" in auth) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(GAME_SESSION_COOKIE, getGameAccessToken(request)!, {
    ...sessionCookie(request), maxAge: 3600,
  });
  return response;
}

export async function DELETE(request: Request) {
  if (!sameOrigin(request)) return NextResponse.json({ error: "forbidden" }, { status: 403 });
  const response = NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
  response.cookies.set(GAME_SESSION_COOKIE, "", { ...sessionCookie(request), maxAge: 0 });
  return response;
}
