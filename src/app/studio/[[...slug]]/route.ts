import { NextRequest, NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Serves the EventPlay studio bundle (which is a static export and therefore
 * cannot enforce its own auth) behind a signed-in check. Everything under
 * `/studio/` resolves to a file in `public/studio/`, falling back to
 * `index.html` for SPA routes.
 */

const STUDIO_ROOT = path.join(process.cwd(), "studio");

function isSignedIn(request: NextRequest): boolean {
  const auth = request.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) return true;
  const hasSupabaseSession = request.cookies.getAll().some(
    (cookie) =>
      (cookie.name.startsWith("sb-") && cookie.name.includes("auth-token") && cookie.value.length > 0) ||
      (cookie.name === "sb-auth-token" && cookie.value.length > 0),
  );
  const hasMarker = request.cookies.get("eventplay_session")?.value === "1";
  return hasSupabaseSession && hasMarker;
}

export async function GET(request: NextRequest, { params }: { params: Promise<{ slug?: string[] }> }) {
  if (!isSignedIn(request)) {
    const login = new URL("/login", request.url);
    login.searchParams.set("next", "/games");
    return NextResponse.redirect(login);
  }

  const slug = (await params).slug ?? [];
  const segments = [...slug];
  // /studio and /studio/index.html both load the SPA shell.
  if (segments.length === 1 && segments[0] === "index.html") segments.length = 0;

  // Reject traversal before building any path.
  if (segments.some((part) => part === ".." || part.includes("\\") || part.includes("/"))) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const root = STUDIO_ROOT.replace(/\\/g, "/");
  const filePath = path.resolve(STUDIO_ROOT, ...segments);
  const resolved = filePath.replace(/\\/g, "/");
  const insideRoot = segments.length === 0 ? resolved === root : resolved.startsWith(root + "/");
  if (!insideRoot) return new NextResponse("Forbidden", { status: 403 });

  if (segments.length === 0) {
    return serveFile(request, path.join(STUDIO_ROOT, "index.html"));
  }

  const response = await serveFile(request, filePath);
  if (response.status === 404) {
    // Static export SPA: unknown paths without a file extension render the
    // shell, which routes client-side. Missing assets keep their 404.
    const hasExtension = /\.[a-z0-9]+$/i.test(segments[segments.length - 1]);
    if (!hasExtension && request.headers.get("accept")?.includes("text/html")) {
      return serveFile(request, path.join(STUDIO_ROOT, "index.html"));
    }
  }
  return response;
}

async function serveFile(request: NextRequest, filePath: string) {
  let content: Buffer;
  try {
    content = await readFile(filePath);
  } catch {
    return new NextResponse("Not Found", { status: 404 });
  }

  const ext = path.extname(filePath).toLowerCase();
  const types: Record<string, string> = {
    ".html": "text/html; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".mjs": "application/javascript; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".png": "image/png",
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".svg": "image/svg+xml; charset=utf-8",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".glb": "model/gltf-binary",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
    ".wasm": "application/wasm",
  };

  // SPA routes must not be cached with HTML semantics; assets are immutable.
  const immutable = ext !== ".html" && ext !== "";
  const cdn = new URL(request.url);
  return new NextResponse(new Uint8Array(content), {
    headers: {
      "Content-Type": types[ext] ?? "application/octet-stream",
      "Cache-Control": immutable
        ? "public, max-age=31536000, immutable"
        : cdn.host === "localhost"
          ? "no-store"
          : "public, max-age=0, s-maxage=300, stale-while-revalidate=60",
    },
  });
}
