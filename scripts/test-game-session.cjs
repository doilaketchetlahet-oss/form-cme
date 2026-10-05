// Run: node --test scripts/test-game-session.cjs
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const ts = require("typescript");
const { NextRequest } = require("next/server");

function load(file, mocks = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path.join(__dirname, "..", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  });
  const mod = { exports: {} };
  new Function("require", "module", "exports", outputText)(
    (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), mod, mod.exports
  );
  return mod.exports;
}

process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-key";
const session = load("src/lib/game/session.ts");
const cookie = `${session.GAME_SESSION_COOKIE}=valid-token`;
const user = { id: "test-user", email: "test@example.test" };
// Mock only Supabase's verification boundary. Real handlers parse and verify
// credentials, issue cookies, gate assets, resolve paths, and apply cache rules.
const auth = load("src/lib/game/auth.ts", {
  "./session": session,
  "@supabase/supabase-js": {
    createClient: () => ({ auth: {
      getUser: async (token) => token === "valid-token"
        ? { data: { user }, error: null } : { data: { user: null }, error: { message: "invalid or expired" } },
      getClaims: async (token) => token === "valid-token"
        ? { data: { claims: { sub: user.id, role: "authenticated" } }, error: null }
        : { data: null, error: { message: "invalid or expired" } },
    } }),
  },
});
const sessionRoute = load("src/app/api/game/session/route.ts", {
  "@/lib/game/auth": auth, "@/lib/game/session": session,
});
const studio = load("src/app/studio/[[...slug]]/route.ts", { "@/lib/game/auth": auth });
const request = (url, headers = {}, method = "GET") => new NextRequest(`https://example.test${url}`, { headers, method });
const studioRequest = (slug, headers = {}) => studio.GET(request(`/studio/${slug.join("/")}`, headers), { params: Promise.resolve({ slug }) });

test("verified browser cookie bridges localStorage auth to iframe and standalone APIs", async () => {
  const response = await sessionRoute.POST(request("/api/game/session", { Authorization: "Bearer valid-token", Origin: "https://example.test" }, "POST"));
  assert.equal(response.status, 200);
  const setCookie = response.headers.get("set-cookie");
  assert.match(setCookie, /eventplay_access_token=valid-token/);
  for (const attribute of [/HttpOnly/i, /Secure/i, /SameSite=lax/i, /Path=\//i, /Max-Age=3600/i]) assert.match(setCookie, attribute);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { ok: true });
  assert.deepEqual(await auth.authorizeGame(request("/api/game/entitlements", { Cookie: cookie })), { user });
  assert.equal((await studioRequest(["index.html"], { Cookie: cookie })).status, 200);
});

test("missing, forged, and expired credentials cannot open studio or issue cookies", async () => {
  for (const headers of [{}, { Authorization: "Bearer expired-token" }, { Cookie: "eventplay_session=1; sb-auth-token=forged" }, { Cookie: "eventplay_access_token=forged" }]) {
    const denied = await studioRequest(["index.html"], headers);
    assert.equal(denied.status, 307);
    assert.equal(denied.headers.get("cache-control"), "no-store");
    const response = await sessionRoute.POST(request("/api/game/session", headers, "POST"));
    assert.equal(response.status, 401);
    assert.equal(response.headers.has("set-cookie"), false);
  }
  // A valid cookie alone cannot establish a fresh session without a Bearer token.
  assert.equal((await sessionRoute.POST(request("/api/game/session", { Cookie: cookie }, "POST"))).status, 401);
});

test("foreign origins cannot replace or delete a studio session", async () => {
  const headers = { Authorization: "Bearer valid-token", Origin: "https://foreign.test" };
  for (const [method, handler] of [["POST", sessionRoute.POST], ["DELETE", sessionRoute.DELETE]]) {
    const response = await handler(request("/api/game/session", headers, method));
    assert.equal(response.status, 403);
    assert.equal(response.headers.has("set-cookie"), false);
  }
});

test("logout removes the same HttpOnly cookie", async () => {
  const response = await sessionRoute.DELETE(request("/api/game/session", { Origin: "https://example.test" }, "DELETE"));
  assert.equal(response.status, 200);
  assert.match(response.headers.get("set-cookie"), /eventplay_access_token=;/);
  assert.match(response.headers.get("set-cookie"), /Max-Age=0/i);
  assert.match(response.headers.get("set-cookie"), /Path=\//i);
});

test("studio serves real assets after auth, rejects traversal, and avoids shared auth caching", async () => {
  const headers = { Cookie: cookie };
  const html = await studioRequest(["index.html"], headers);
  assert.match(await html.text(), /EventPlay Studio/);
  assert.equal(html.headers.get("cache-control"), "no-store");
  const asset = await studioRequest(["logo.svg"], headers);
  assert.equal(asset.status, 200);
  assert.equal(asset.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.match(asset.headers.get("cache-control"), /^private,/);
  assert.equal((await studioRequest(["..", ".env.local"], headers)).status, 403);
  assert.equal((await studioRequest(["missing.js"], headers)).status, 404);
});

test("malformed cookie encoding is rejected and explicit Bearer credentials take precedence", () => {
  assert.equal(session.getGameAccessToken(request("/", { Cookie: "eventplay_access_token=%broken" })), null);
  assert.equal(session.getGameAccessToken(request("/", { Cookie: cookie, Authorization: "Bearer other-token" })), "other-token");
});
