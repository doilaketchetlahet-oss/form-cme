// node --test scripts/test-booth-draw.cjs
// API-level checks for /api/admin/booth-draw with an in-memory Supabase mock.
// The SQL behaviour (vacated booths return to the draw, reserved booths cannot
// be taken by "chuyển gian") lives in supabase/booth-draw-reuse-booths.sql.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const ts = require("typescript");

function loadSource(file, mocks = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path.join(__dirname, "..", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }, fileName: file,
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}

const sessionId = randomUUID(), poolId = randomUUID(), companyId = randomUUID(), otherCompanyId = randomUUID();
const vacatedBoothId = randomUUID(), occupiedBoothId = randomUUID();

function harness() {
  const db = {
    booth_draw_sessions: [{ id: sessionId, status: "active", starts_at: null, ends_at: null, access_mode: "public" }],
    booth_companies: [{ id: companyId, session_id: sessionId, pool_id: poolId, preferred_booth_id: null }, { id: otherCompanyId, session_id: sessionId, pool_id: poolId, preferred_booth_id: null }],
    booth_zones: [{ id: vacatedBoothId, session_id: sessionId, pool_id: poolId, active: true }, { id: occupiedBoothId, session_id: sessionId, pool_id: poolId, active: true }],
    // The booth's first company moved away: history mentions it, nobody occupies it.
    booth_draw_results: [{ id: randomUUID(), session_id: sessionId, booth_id: vacatedBoothId, company_id: otherCompanyId }],
    booth_assignments: [{ id: randomUUID(), session_id: sessionId, booth_id: occupiedBoothId, company_id: otherCompanyId }],
    events: [{ id: randomUUID() }],
  };
  const calls = { inserts: [], rpcs: [], updates: [] };
  const service = {
    from(table) {
      const q = { filters: [], op: "select", patch: null };
      const run = async () => {
        const rows = (db[table] ?? []).filter((row) => q.filters.every((filter) => filter(row)));
        if (q.op === "insert") { calls.inserts.push({ table, rows: q.rows }); return { data: { id: randomUUID() }, error: null }; }
        if (q.op === "update") { calls.updates.push({ table, patch: q.patch }); rows.forEach((row) => Object.assign(row, q.patch)); return { data: rows, error: null }; }
        return { data: rows, error: null };
      };
      const api = {
        select() { return api; }, order() { return api; },
        eq(column, value) { q.filters.push((row) => row[column] === value); return api; },
        insert(rows) { q.op = "insert"; q.rows = rows; return api; },
        update(patch) { q.op = "update"; q.patch = patch; return api; },
        async single() { const result = await run(); return { data: Array.isArray(result.data) ? result.data[0] ?? null : result.data, error: result.error }; },
        async maybeSingle() { return api.single(); },
        then(resolve, reject) { return run().then(resolve, reject); },
      };
      return api;
    },
    async rpc(name, args) { calls.rpcs.push({ name, args }); return { data: [{ booth_code: "A1" }], error: null }; },
  };
  const route = loadSource("src/app/api/admin/booth-draw/route.ts", {
    "next/server": { NextResponse: { json: (body, init) => Response.json(body, init) } },
    "@/lib/server/admin-api": { authorizeAdminApi: async () => ({ error: "not an admin" }) },
    "@/lib/server/booth-public-access": {
      authorizePublicBoothWrite: async (_request, _service, id, passcode) => id === sessionId && passcode === "secret-123" ? { session: { id } } : { error: "Passcode không đúng.", status: 403 },
      createBoothServiceClient: () => service,
      checkPublicBoothRateLimit: () => true,
      boothPasscodeLookup: () => "lookup", hashBoothPasscode: () => "hash", verifyBoothPasscode: () => false,
    },
  });
  return {
    db, calls,
    async post(body) {
      const response = await route.POST(new Request("https://example.test/api/admin/booth-draw", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
      return { status: response.status, body: await response.json() };
    },
  };
}

test("a free-session passcode cannot create admin sessions attached to real events", async () => {
  const api = harness();
  const result = await api.post({ action: "create_session", sessionId, passcode: "secret-123", eventId: api.db.events[0].id, name: "Spam", poolNames: ["A"] });
  assert.equal(result.status, 403);
  assert.equal(api.calls.inserts.length, 0, "Nothing is written");
});

test("draw validates the company and idempotency key before calling the RPC", async () => {
  const api = harness();
  for (const patch of [{ companyId: "x", requestKey: randomUUID() }, { companyId, requestKey: "not-a-uuid" }, { requestKey: randomUUID() }]) {
    assert.equal((await api.post({ action: "draw", sessionId, passcode: "secret-123", ...patch })).status, 400);
  }
  assert.equal(api.calls.rpcs.length, 0);
  const ok = await api.post({ action: "draw", sessionId, passcode: "secret-123", companyId, requestKey: randomUUID() });
  assert.equal(ok.status, 200);
  assert.equal(api.calls.rpcs[0].name, "draw_booth_for_company");
});

test("a booth vacated by a move can be reserved again; an occupied booth cannot", async () => {
  const api = harness();
  const vacated = await api.post({ action: "set_company_booth_preference", sessionId, passcode: "secret-123", companyId, boothId: vacatedBoothId });
  assert.equal(vacated.status, 200, JSON.stringify(vacated.body));
  assert.equal(api.db.booth_companies[0].preferred_booth_id, vacatedBoothId);
  const occupied = await api.post({ action: "set_company_booth_preference", sessionId, passcode: "secret-123", companyId, boothId: occupiedBoothId });
  assert.equal(occupied.status, 409);
});

test("fresh install and migration SQL share the draw/move functions and drop the per-booth history constraint", () => {
  const read = (file) => readFileSync(path.join(__dirname, "..", file), "utf8");
  const fn = (text, name) => text.slice(text.indexOf(`create or replace function ${name}(`), text.indexOf("\n$$;", text.indexOf(`create or replace function ${name}(`)));
  const migration = read("supabase/booth-draw-reuse-booths.sql");
  for (const file of ["supabase/booth-draw.sql", "supabase/schema.sql"]) {
    const text = read(file);
    assert.equal(fn(text, "draw_booth_for_company"), fn(migration, "draw_booth_for_company"), file);
    assert.equal(fn(text, "move_booth_assignment"), fn(migration, "move_booth_assignment"), file);
    assert.match(text, /drop constraint if exists booth_draw_results_session_id_booth_id_key/);
  }
  assert.equal(fn(read("supabase/booth-draw-auto-final.sql"), "draw_booth_for_company"), fn(migration, "draw_booth_for_company"));
  assert.doesNotMatch(fn(migration, "draw_booth_for_company"), /booth_draw_results r\s+where r\.session_id = p_session_id and r\.booth_id/);
  assert.match(fn(migration, "move_booth_assignment"), /BOOTH_RESERVED/);
});
