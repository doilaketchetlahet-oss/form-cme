// Run with: node --test scripts/test-wish-wall.cjs
// Compile with the project's TypeScript, and replace only external route services.
// Optional React/SQL checks: install @electric-sql/pglite@0.5.8 react@19.2.4
// react-test-renderer@19.2.4 in a temporary directory, then set WISH_TEST_DEPS to it.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const ts = require("typescript");
const { NextRequest } = require("next/server");

function loadSource(file, mocks = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path.join(__dirname, "..", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
    fileName: file,
  });
  const module = { exports: {} };
  const resolve = (name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name);
  new Function("require", "module", "exports", outputText)(resolve, module, module.exports);
  return module.exports;
}

const edges = loadSource("src/lib/wish/edges.ts");
const config = loadSource("src/lib/wish/config.ts", { "./edges": edges });
const { DEFAULT_WISH_SETTINGS, normalizeWishEvent, normalizeWishRow, validateWishInput, validateWishSettingsInput } = config;

test("legacy events and wishes retain their edge, content and defaults", () => {
  const oldSettings = { edge: "right", shape: "star", shieldImageUrl: "/old-shield.png", shieldScale: 120 };
  const oldWish = { id: "old", event_id: "event", content: "Existing wish", edge: "left" };
  assert.equal(normalizeWishEvent({ settings: oldSettings }).settings.edge, "right");
  assert.equal(normalizeWishEvent({ settings: oldSettings }).settings.shape, "star");
  assert.equal(normalizeWishEvent({ settings: {} }).settings.edge, "center");
  assert.equal(normalizeWishRow(oldWish).edge, "left");
  assert.equal(normalizeWishRow(oldWish).content, "Existing wish");
  assert.equal(normalizeWishRow({ ...oldWish, edge: undefined }).edge, "center");
  assert.deepEqual(oldSettings, { edge: "right", shape: "star", shieldImageUrl: "/old-shield.png", shieldScale: 120 });
});

test("all four QR overrides win over every event default; invalid URLs use the default", () => {
  for (const defaultEdge of edges.WISH_EDGES) {
    const settings = { ...DEFAULT_WISH_SETTINGS, edge: defaultEdge };
    for (const edge of edges.WISH_EDGES) {
      const query = new URL(`https://example.test/wish/LEGACY?edge=${edge}`).searchParams;
      const selected = edges.parseWishEdge(query.get("edge")) ?? settings.edge;
      assert.equal(selected, edge);
      assert.equal(validateWishInput(settings, { edge: selected }).data.edge, edge);
      assert.equal(normalizeWishRow({ edge }).edge, edge);
      assert.equal(normalizeWishEvent({ settings: { edge } }).settings.edge, edge);
    }
    for (const query of ["", "?edge=", "?edge=top", "?edge=BOTTOM", "?edge=bogus"]) {
      assert.equal(edges.parseWishEdge(new URLSearchParams(query).get("edge")) ?? settings.edge, defaultEdge);
    }
    assert.equal(validateWishInput(settings, {}).data.edge, defaultEdge);
  }
});

test("partial settings updates retain custom values and reject explicit invalid edges", () => {
  const current = { ...DEFAULT_WISH_SETTINGS, edge: "bottom", shape: "star", maxLength: 220, theme: "romance" };
  assert.deepEqual(validateWishSettingsInput({ showNames: false }, current).settings, { ...current, showNames: false });
  assert.deepEqual(validateWishSettingsInput(undefined, current).settings, current);
  for (const edge of ["top", "", null, 0, [], {}]) {
    assert.deepEqual(validateWishInput(current, { edge }), { ok: false, error: "invalid_edge" });
    assert.deepEqual(validateWishSettingsInput({ edge }, current), { ok: false, error: "invalid_edge" });
  }
});

test("tablet departure and LED arrival follow the same direction and start outside the LED", () => {
  const directions = { left: [1, 0], right: [-1, 0], center: [0, 1], bottom: [0, -1] };
  for (const [w, h] of [[1920, 1080], [1080, 1920], [390, 844]]) {
    for (const edge of edges.WISH_EDGES) {
      const target = edges.wishFlyTarget(edge, Math.max(w, h));
      const { from, entry } = edges.wishEntryPoints(edge, w, h, { w: 220, h: 400 });
      const [dx, dy] = directions[edge];
      assert.equal(target.x, dx * Math.max(w, h));
      assert.equal(target.y, dy * Math.max(w, h));
      assert.equal(Math.sign(entry.x - from.x), dx);
      assert.equal(Math.sign(entry.y - from.y), dy);
      assert.ok(entry.x > 0 && entry.x < w && entry.y > 0 && entry.y < h);
      if (edge === "left") assert.ok(from.x + 110 < 0);
      if (edge === "right") assert.ok(from.x - 110 > w);
      if (edge === "center") assert.ok(from.y + 200 < 0);
      if (edge === "bottom") assert.ok(from.y - 200 > h);
    }
  }
});

// In-memory service boundary: actual handlers still perform validation, normalization,
// persistence mapping, status changes, and broadcast construction.
function routeHarness() {
  const tables = { wish_events: [], wishes: [] };
  const broadcasts = [];
  const service = {
    from(table) {
      const filters = [];
      let operation = "select", payload, countOnly = false, limit = Infinity;
      const execute = () => {
        const rows = tables[table].filter((row) => filters.every(([key, value]) => row[key] === value)).slice(0, limit);
        let data = rows;
        if (operation === "insert") {
          const now = new Date().toISOString();
          data = [{ id: randomUUID(), status: table === "wish_events" ? "live" : "approved", created_at: now, updated_at: now, ...payload }];
          tables[table].push(...data);
        } else if (operation === "update") {
          rows.forEach((row) => Object.assign(row, payload));
        }
        return { data: countOnly ? null : data, count: rows.length, error: null };
      };
      const query = {
        select(_columns, options) { countOnly = options?.head === true; return query; },
        eq(key, value) { filters.push([key, value]); return query; },
        order() { return query; },
        limit(value) { limit = value; return query; },
        insert(value) { operation = "insert"; payload = value; return query; },
        update(value) { operation = "update"; payload = value; return query; },
        async maybeSingle() { const result = execute(); return { ...result, data: result.data[0] ?? null }; },
        async single() { return query.maybeSingle(); },
        then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); },
      };
      return query;
    },
  };
  const route = loadSource("src/app/api/wish/[code]/route.ts", {
    "@/lib/wish/config": config,
    "@/lib/server/supabase-admin": { createSupabaseAdmin: () => service },
    "@/lib/server/admin-api": { authorizeAdminApi: async () => ({ service, email: "admin@example.test" }) },
    "@/lib/wish/broadcast": { broadcastWish: async (code, message) => { broadcasts.push({ code, message }); return true; } },
  });
  async function request(method, body, code = "LEGACY") {
    const req = new NextRequest(`https://example.test/api/wish/${code}`, {
      method,
      ...(body ? { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) } : {}),
    });
    const res = await route[method](req, { params: Promise.resolve({ code }) });
    return { status: res.status, body: await res.json() };
  }
  return { request, tables, broadcasts };
}

test("API persists QR edges through submission, moderation, snapshots and later event changes", async () => {
  const { request, tables, broadcasts } = routeHarness();
  assert.equal((await request("POST", { action: "create", moderation: true, settings: { edge: "bottom", shape: "star" } })).status, 200);
  for (const edge of edges.WISH_EDGES) {
    const submitted = await request("POST", { action: "submit", content: `Wish from ${edge}`, edge });
    assert.equal(submitted.status, 200);
    assert.equal(submitted.body.wish.edge, edge);
    assert.equal(submitted.body.wish.status, "pending");
    assert.equal(submitted.body.moderated, true);
    assert.equal(tables.wishes.at(-1).edge, edge);
    const approved = await request("PUT", { action: "moderate", wishId: submitted.body.wish.id, status: "approved" });
    assert.equal(approved.status, 200);
    assert.equal(broadcasts.at(-1).message.wish.edge, edge);
  }
  const legacy = await request("POST", { action: "submit" });
  assert.equal(legacy.body.wish.edge, "bottom");
  const settings = await request("PUT", { action: "settings", settings: { showNames: false } });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.event.settings.edge, "bottom");
  assert.equal(settings.body.event.settings.shape, "star");
  const demo = await request("PUT", { action: "demo" });
  assert.equal(demo.body.wish.edge, "bottom");
  assert.equal(tables.wishes.length, 5); // demo is broadcast-only
  await request("PUT", { action: "settings", settings: { edge: "right" } });
  const snapshot = await request("GET");
  assert.equal(snapshot.status, 200);
  assert.equal(snapshot.body.event.settings.edge, "right");
  assert.deepEqual(snapshot.body.wishes.map((wish) => wish.edge), [...edges.WISH_EDGES]);
  assert.equal(snapshot.body.counts.pending, 1);
});

test("API returns HTTP 400 for malformed explicit edges without inserting or broadcasting", async () => {
  const { request, tables, broadcasts } = routeHarness();
  for (const edge of ["top", "", null, 42, {}, []]) {
    const create = await request("POST", { action: "create", settings: { edge } });
    assert.equal(create.status, 400);
    assert.equal(create.body.error, "invalid_edge");
  }
  assert.equal(tables.wish_events.length, 0);
  await request("POST", { action: "create" });
  assert.equal(tables.wish_events[0].settings.edge, "center");
  for (const edge of ["top", "", null, 42, {}, []]) {
    for (const [method, body] of [["POST", { action: "submit", edge }], ["PUT", { action: "settings", settings: { edge } }]]) {
      const result = await request(method, body);
      assert.equal(result.status, 400);
      assert.equal(result.body.error, "invalid_edge");
    }
  }
  assert.equal(tables.wishes.length, 0);
  assert.equal(broadcasts.length, 0);
  const legacy = await request("POST", { action: "submit" });
  assert.equal(legacy.status, 200);
  assert.equal(legacy.body.wish.edge, "center");
});

const auditRequire = process.env.WISH_TEST_DEPS
  ? createRequire(path.join(process.env.WISH_TEST_DEPS, "package.json"))
  : null;

test("React page keeps QR overrides after loading and during same-event URL navigation", { skip: !auditRequire }, async () => {
  const React = auditRequire("react");
  const { act, create } = auditRequire("react-test-renderer");
  global.IS_REACT_ACT_ENVIRONMENT = true;
  let code = "LEGACY", query = new URLSearchParams("edge=left"), requests = [];
  const Composer = () => null;
  const page = loadSource("src/app/wish/[code]/page.tsx", {
    react: React,
    "react/jsx-runtime": auditRequire("react/jsx-runtime"),
    "next/navigation": { useParams: () => ({ code }), useSearchParams: () => query },
    "lucide-react": { Loader2: () => null },
    "@/components/wish/WishComposer": { WishComposer: Composer },
    "@/lib/wish/config": config,
    "@/lib/wish/edges": edges,
    "@/lib/wish/realtime": { fetchWishSnapshot: () => new Promise((resolve) => requests.push(resolve)) },
  });
  let tree;
  try {
    await act(async () => { tree = create(React.createElement(page.default)); });
    assert.equal(tree.root.findAllByType(Composer).length, 0);
    await act(async () => { requests.shift()({ event: normalizeWishEvent({ code, settings: { edge: "right" } }) }); });
    assert.equal(tree.root.findByType(Composer).props.edge, "left");
    for (const edge of edges.WISH_EDGES) {
      query = new URLSearchParams(`edge=${edge}`);
      await act(async () => { tree.update(React.createElement(page.default)); });
      assert.equal(tree.root.findByType(Composer).props.edge, edge);
    }
    for (const value of ["", "edge=top", "edge=BOTTOM"]) {
      query = new URLSearchParams(value);
      await act(async () => { tree.update(React.createElement(page.default)); });
      assert.equal(tree.root.findByType(Composer).props.edge, "right");
    }
    assert.equal(requests.length, 0); // Query changes don't refetch/reset the composer.
    code = "OLDER";
    await act(async () => { tree.update(React.createElement(page.default)); });
    assert.equal(tree.root.findAllByType(Composer).length, 0); // No stale event can submit.
    code = "NEWER";
    await act(async () => { tree.update(React.createElement(page.default)); });
    await act(async () => { requests[1]({ event: normalizeWishEvent({ code, settings: { edge: "bottom" } }) }); });
    await act(async () => { requests[0]({ event: normalizeWishEvent({ code: "OLDER", settings: { edge: "left" } }) }); });
    assert.equal(tree.root.findByType(Composer).props.code, "NEWER");
    assert.equal(tree.root.findByType(Composer).props.edge, "bottom");
  } finally {
    if (tree) await act(async () => { tree.unmount(); });
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});

test("admin renders all four edge QR URLs using saved event settings", { skip: !auditRequire }, async () => {
  const React = auditRequire("react");
  const { act, create } = auditRequire("react-test-renderer");
  const originalFetch = global.fetch, originalWindow = global.window;
  global.IS_REACT_ACT_ENVIRONMENT = true;
  global.window = { localStorage: { getItem: () => "LEGACY" } };
  const event = normalizeWishEvent({ code: "LEGACY", settings: { edge: "bottom" } });
  global.fetch = async () => ({ ok: true, json: async () => ({ event, wishes: [], counts: { total: 0, pending: 0, approved: 0 } }) });
  const QRCodeView = () => null;
  const manager = loadSource("src/components/admin/WishWallManager.tsx", {
    react: React,
    "react/jsx-runtime": auditRequire("react/jsx-runtime"),
    "lucide-react": new Proxy({}, { get: () => () => null }),
    sonner: { toast: {} },
    "@/lib/supabase": { supabase: { auth: { getSession: async () => ({ data: { session: null } }) } } },
    "@/components/ui/QRCodeView": { QRCodeView },
    "@/lib/site-url": { buildPublicUrl: (url) => new URL(url, "https://example.test").href },
    "@/lib/ui/confirm": { useConfirm: () => async () => true },
    "@/components/wish/DrawingSvg": { DrawingSvg: () => null },
    "@/lib/wish/config": config,
    "@/lib/wish/edges": edges,
  });
  let tree;
  try {
    await act(async () => { tree = create(React.createElement(manager.WishWallManager)); });
    const urls = tree.root.findAllByType(QRCodeView).map((qr) => new URL(qr.props.value));
    assert.deepEqual(urls.filter((url) => url.pathname === "/wish/LEGACY").map((url) => url.searchParams.get("edge")), [...edges.WISH_EDGES]);
    assert.ok(urls.some((url) => url.pathname === "/wish/LEGACY/wall" && !url.search));
    const preview = tree.root.findAllByType("a").find((link) => link.props.href === "https://example.test/wish/LEGACY?edge=bottom");
    assert.ok(preview);
  } finally {
    if (tree) await act(async () => { tree.unmount(); });
    global.fetch = originalFetch;
    global.window = originalWindow;
    delete global.IS_REACT_ACT_ENVIRONMENT;
  }
});

test("full SQL installs and upgrades legacy constraints repeatedly without rewriting data", { skip: !auditRequire }, async () => {
  const { PGlite } = auditRequire("@electric-sql/pglite");
  const { pgcrypto } = auditRequire("@electric-sql/pglite/contrib/pgcrypto");
  const db = new PGlite({ extensions: { pgcrypto } });
  const sql = readFileSync(path.join(__dirname, "..", "supabase/wish-wall.sql"), "utf8");
  try {
    // Supply the role/functions/storage table owned by the app's base Supabase schema.
    await db.exec(`
      create role authenticated;
      create function is_admin_member() returns boolean language sql as 'select true';
      create function can_manage_forms() returns boolean language sql as 'select true';
      create schema storage;
      create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
    `);
    await db.exec(sql); // Fresh installation.
    await db.exec(`
      alter table public.wishes drop constraint wishes_edge_check,
        add constraint wishes_edge_check check (edge in ('left', 'right', 'center'));
      insert into wish_events (code, settings) values ('LEGACY', '{"edge":"right","shieldImageUrl":"/old.png","shape":"star"}');
      insert into wishes (event_id, edge, content) select id, edge, 'Existing wish ' || edge
        from wish_events cross join unnest(array['left','right','center']) as edge;
      insert into wishes (event_id, content) select id, 'Default wish' from wish_events;
    `);
    const oldEvents = (await db.query("select * from wish_events")).rows;
    const oldWishes = (await db.query("select * from wishes order by id")).rows;
    const insertEdge = (edge) => db.query("insert into wishes (event_id, edge) select id, $1 from wish_events", [edge]);
    await assert.rejects(insertEdge("bottom"), { code: "23514" });
    await db.exec(sql); // Upgrade from the old 3-edge constraint.
    await db.exec(sql); // Idempotent upgrade.
    assert.deepEqual((await db.query("select * from wish_events")).rows, oldEvents);
    assert.deepEqual((await db.query("select * from wishes order by id")).rows, oldWishes);
    assert.equal(oldWishes.find((row) => row.content === "Default wish").edge, "center");
    await insertEdge("bottom");
    await db.exec(sql); // Re-run with bottom wishes already present.
    await assert.rejects(insertEdge("top"), { code: "23514" });
    const defaults = await db.query("select column_default from information_schema.columns where table_name = 'wishes' and column_name = 'edge'");
    assert.equal(defaults.rows[0].column_default, "'center'::text");
    assert.equal((await db.query("select count(*)::int as count from wishes")).rows[0].count, 5);
  } finally {
    await db.close();
  }
});
