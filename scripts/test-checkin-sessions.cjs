// node --test scripts/test-checkin-sessions.cjs
// SQL/React checks: install @electric-sql/pglite@0.5.8 react@19.2.4
// react-test-renderer@19.2.4 in a temporary directory and set CHECKIN_TEST_DEPS to it.
const assert = require("node:assert/strict");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { createRequire } = require("node:module");
const { test } = require("node:test");
const { randomUUID } = require("node:crypto");
const ts = require("typescript");

function loadSource(file, mocks = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path.join(__dirname, "..", file), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX }, fileName: file,
  });
  const module = { exports: {} };
  new Function("require", "module", "exports", outputText)((name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
const helpers = loadSource("src/lib/checkin-sessions.ts");
const questionId = randomUUID(), surveyId = randomUUID(), responseId = randomUUID();
const question = { id: questionId, type: "choice", text: "Chương trình tham dự", required: true, show_if: null, is_hall_selector: false, options: ["Hội thảo", "Gala", "Cả hai"] };
const config = { questionId, sessions: [
  { id: "conference", name: "Hội thảo", hall: "A", opensAt: null, closesAt: null, optionIndexes: [0, 2] },
  { id: "gala", name: "Gala dinner", hall: "B", opensAt: null, closesAt: null, optionIndexes: [1, 2] },
] };

test("three attendance groups share one response/QR with independent eligibility", () => {
  for (const [answer, expected] of [[0, [true, false]], [1, [false, true]], [2, [true, true]], [[0, 1], [true, true]], ["2", [false, false]], [[], [false, false]]]) {
    assert.deepEqual(config.sessions.map((s) => helpers.canAttendSession(config, s.id, { [questionId]: answer })), expected);
  }
  assert.equal(helpers.canAttendSession(config, "unknown", { [questionId]: 2 }), false);
  assert.equal(helpers.canAttendSession(null, "legacy session", {}), true);
  assert.equal(helpers.canAttendSession({ ...config, questionId: null }, "gala", {}), true);
  const renamed = { ...config, sessions: config.sessions.map((s) => ({ ...s, name: `${s.name} mới` })) };
  assert.equal(helpers.canAttendSession(renamed, "conference", { [questionId]: 0 }), true);
  assert.equal(helpers.sessionLabel(renamed, "conference"), "Hội thảo mới");
});

test("configuration rejects malformed rights, duplicate keys, hidden questions and reversed windows", () => {
  assert.equal(helpers.validateSessionConfig(config, [question]), null);
  assert.equal(helpers.validateSessionConfig(null, [question]), null);
  const rejects = [
    {}, { ...config, questionId: 1 }, { ...config, sessions: [null] },
    { ...config, sessions: [config.sessions[0], config.sessions[0]] },
    { ...config, sessions: [{ ...config.sessions[0], optionIndexes: ["0"] }] },
    { ...config, sessions: [{ ...config.sessions[0], optionIndexes: [3] }] },
    { ...config, sessions: [{ ...config.sessions[0], opensAt: true }] },
    { ...config, sessions: [{ ...config.sessions[0], opensAt: "2026-10-06T10:00:00" }] },
    { ...config, sessions: [{ ...config.sessions[0], opensAt: "2026-10-06T10:00:00+07:00", closesAt: "2026-10-06T09:00:00+07:00" }] },
  ];
  for (const invalid of rejects) assert.ok(helpers.validateSessionConfig(invalid, [question]), JSON.stringify(invalid));
  for (const patch of [{ required: false }, { is_hall_selector: true }, { show_if: { questionId: "other", value: 0 } }, { type: "text" }]) {
    assert.ok(helpers.validateSessionConfig(config, [{ ...question, ...patch }]));
  }
  assert.equal(helpers.sessionQuestionChanged(config, [question], [{ ...question, text: "Đổi tiêu đề" }]), false);
  assert.equal(helpers.sessionQuestionChanged(config, [question], [{ ...question, options: [...question.options].reverse() }]), true);
  assert.equal(helpers.sessionQuestionChanged(config, [question], []), true);
});

test("summary metrics count each attendee once and leave the stored session ledger and legacy state intact", () => {
  const response = { checked_in: false, checked_in_at: null, session_checkins: { conference: "2026-10-06T01:00:00Z", gala: "2026-10-06T12:00:00Z" } };
  assert.deepEqual(helpers.arrivalSummary(response, config), { checked_in: true, checked_in_at: "2026-10-06T01:00:00Z" });
  assert.deepEqual(helpers.arrivalSummary(response, null), { checked_in: false, checked_in_at: null });
  assert.equal(response.checked_in, false);
  assert.equal(Object.keys(response.session_checkins).length, 2);
});

test("fresh installation SQL includes the same session migration as existing projects", () => {
  const normalize = (value) => value.replace(/\r\n/g, "\n").trim();
  const migration = normalize(readFileSync(path.join(__dirname, "../supabase/checkin-sessions.sql"), "utf8"));
  const schema = normalize(readFileSync(path.join(__dirname, "../supabase/schema.sql"), "utf8"));
  assert.ok(schema.includes(migration));
});

function apiHarness(pin = null) {
  const calls = [];
  let authorized = false, result = { ok: true, code: "checked_in", checkedInAt: "2026-10-06T03:00:00Z" }, rpcError = null;
  const service = {
    from() { const query = { select() { return query; }, eq() { return query; }, async maybeSingle() { return { data: { checkin_pin: pin }, error: null }; } }; return query; },
    async rpc(name, args) { calls.push({ name, args }); return { data: result, error: rpcError }; },
  };
  const route = loadSource("src/app/api/checkin/[surveyId]/route.ts", {
    "@supabase/supabase-js": { createClient: () => service },
    "@/lib/server/admin-api": { authorizeAdminApi: async (_req, writable) => { assert.equal(writable, true); return authorized ? { user: {} } : { error: "denied" }; } },
  });
  return {
    calls, authorize: () => { authorized = true; }, respond: (value, error = null) => { result = value; rpcError = error; },
    async post(patch = {}, sid = surveyId) {
      process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
      process.env.SUPABASE_SERVICE_ROLE_KEY = "test-only";
      return route.POST(new Request("https://example.test/api/checkin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ responseId, sessionId: "conference", action: "checkin", method: "qr", ...patch }) }), { params: Promise.resolve({ surveyId: sid }) });
    },
  };
}

test("check-in API validates before writing and requires the configured PIN or a writable admin", async () => {
  const api = apiHarness("1234");
  for (const patch of [{ responseId: "wrong" }, { responseId: [responseId] }, { sessionId: "" }, { sessionId: "x".repeat(121) }, { action: "approve" }, { method: "unknown" }]) {
    assert.equal((await api.post(patch)).status, 400);
  }
  assert.equal((await api.post({}, "wrong")).status, 400);
  assert.equal((await api.post({ pin: "wrong" })).status, 403);
  assert.equal(api.calls.length, 0);
  assert.equal((await api.post({ pin: "1234", action: "preview" })).status, 200);
  assert.deepEqual(api.calls[0], { name: "record_session_checkin", args: { p_survey_id: surveyId, p_response_id: responseId, p_session_key: "conference", p_action: "preview", p_method: "qr" } });
  api.authorize();
  assert.equal((await api.post({ action: "undo", method: "manual" })).status, 200);
  assert.equal((await apiHarness().post()).status, 200);
});

test("API translates authoritative denial/window errors and never reports success for failed persistence", async () => {
  const api = apiHarness();
  for (const [code, status] of [["denied", 403], ["not_found", 404], ["not_open", 409], ["closed", 409], ["payment_pending", 409], ["invalid_session", 409]]) {
    api.respond({ ok: false, code });
    const response = await api.post();
    assert.equal(response.status, status);
    assert.equal((await response.json()).ok, false);
  }
  api.respond(null, { message: "private database details" });
  const failed = await api.post();
  assert.equal(failed.status, 503);
  assert.ok(!(await failed.text()).includes("private database details"));
});

const extraRequire = process.env.CHECKIN_TEST_DEPS ? createRequire(path.join(process.env.CHECKIN_TEST_DEPS, "package.json")) : null;
test("form editor starter saves a required three-way question and the two independent session mappings", { skip: !extraRequire }, async () => {
  const React = extraRequire("react"), { create, act } = extraRequire("react-test-renderer");
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const wrapper = ({ children }) => React.createElement("div", null, children);
  const { SessionSettings } = loadSource("src/components/admin/SessionSettings.tsx", { "react/jsx-runtime": extraRequire("react/jsx-runtime"), "@/lib/checkin-sessions": helpers });
  const { SurveyEditor } = loadSource("src/components/admin/SurveyEditor.tsx", {
    react: React, "react/jsx-runtime": extraRequire("react/jsx-runtime"),
    "framer-motion": { motion: new Proxy({}, { get: (_target, tag) => tag }), AnimatePresence: wrapper },
    "@dnd-kit/core": { DndContext: wrapper, useSensor() {}, useSensors: () => [] },
    "@dnd-kit/sortable": { SortableContext: wrapper, useSortable: () => ({ attributes: {}, listeners: {}, setNodeRef() {} }) },
    "@dnd-kit/utilities": { CSS: { Transform: { toString: () => "" } } }, "@dnd-kit/modifiers": {},
    "lucide-react": new Proxy({}, { get: () => () => null }), "next/link": wrapper,
    "./ThemeImageUpload": { ThemeImageUpload: () => null }, "@/components/ui/QRCodeView": { QRCodeView: () => null },
    "./SessionSettings": { SessionSettings }, "@/lib/checkin-sessions": helpers,
  });
  let saved, renderer;
  const text = (node) => node.children.map((child) => typeof child === "string" ? child : text(child)).join("");
  const button = (label) => renderer.root.findAllByType("button").find((node) => text(node) === label);
  await act(async () => { renderer = create(React.createElement(SurveyEditor, { initial: { title: "Conference + Gala", form_type: "registration", checkin_theme: { sessionsEnabled: true }, questions: [question] }, onSave: (value) => { saved = value; }, onCancel() {} })); });
  await act(async () => { button("Check-in").props.onClick(); });
  await act(async () => { button("Tạo mẫu Hội thảo + Gala").props.onClick(); });
  assert.equal(button("Lưu thay đổi").props.disabled, false);
  await act(async () => { button("Lưu thay đổi").props.onClick(); });
  const created = saved.questions.find((q) => q.id === saved.checkin_theme.sessionConfig.questionId);
  assert.equal(created.required, true);
  assert.equal(created.allow_multiple, false);
  assert.equal(created.is_hall_selector, false);
  assert.equal(created.options.length, 3);
  assert.equal(saved.questions.length, 2);
  assert.deepEqual(saved.checkin_theme.sessionConfig.sessions.map((s) => s.optionIndexes), [[0, 2], [1, 2]]);
  assert.equal(helpers.validateSessionConfig(saved.checkin_theme.sessionConfig, saved.questions), null);
  await act(async () => { renderer.unmount(); });
});

test("form-save API rejects reordering attendance answers after registrations without writing anything", async () => {
  let writes = 0;
  const service = {
    auth: { getUser: async () => ({ data: { user: { email: "test@example.test" } }, error: null }) },
    from(table) {
      const query = { select() { return query; }, eq() { return query; }, ilike() { return query; }, update() { writes++; return query; },
        async single() { return { data: { quiz_id: randomUUID(), checkin_theme: { sessionConfig: config } }, error: null }; },
        async maybeSingle() { return { data: { role: "admin" }, error: null }; },
        then(resolve) { return Promise.resolve({ data: table === "survey_questions" ? [question] : [], count: 1, error: null }).then(resolve); },
      }; return query;
    },
  };
  const { POST } = loadSource("src/app/api/admin/forms/[id]/save/route.ts", { "@supabase/supabase-js": { createClient: () => service }, "@/lib/checkin-sessions": helpers });
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
  const response = await POST(new Request("https://example.test/save", { method: "POST", headers: { Authorization: "Bearer test-only", "content-type": "application/json" }, body: JSON.stringify({ title: "Event", questions: [{ ...question, options: [...question.options].reverse() }], checkin_theme: { sessionConfig: config } }) }), { params: Promise.resolve({ id: surveyId }) });
  assert.equal(response.status, 400);
  assert.equal(writes, 0);
  assert.match((await response.json()).error, /Đã có người đăng ký/);
});

test("actual session editor keeps stable keys and converts Vietnam time consistently", { skip: !extraRequire }, async () => {
  const React = extraRequire("react"), { create, act } = extraRequire("react-test-renderer");
  global.IS_REACT_ACT_ENVIRONMENT = true;
  const { SessionSettings } = loadSource("src/components/admin/SessionSettings.tsx", {
    "react/jsx-runtime": extraRequire("react/jsx-runtime"), "@/lib/checkin-sessions": helpers,
  });
  let updated, renderer;
  await act(async () => { renderer = create(React.createElement(SessionSettings, { value: config, questions: [question], onChange: (next) => { updated = next; }, onPreset() {} })); });
  const dates = renderer.root.findAllByProps({ type: "datetime-local" });
  await act(async () => { dates[0].props.onChange({ target: { value: "2026-10-06T08:30" } }); });
  assert.equal(updated.sessions[0].opensAt, "2026-10-06T01:30:00.000Z");
  assert.equal(updated.sessions[0].id, "conference");
  await act(async () => { renderer.update(React.createElement(SessionSettings, { value: updated, questions: [question], onChange() {}, onPreset() {} })); });
  assert.equal(renderer.root.findAllByProps({ type: "datetime-local" })[0].props.value, "2026-10-06T08:30");
  await act(async () => { renderer.unmount(); });
});

test("real SQL enforces three groups, time windows, idempotence and legacy compatibility", { skip: !extraRequire }, async () => {
  const { PGlite } = extraRequire("@electric-sql/pglite");
  const db = new PGlite();
  try {
    const schema = readFileSync(path.join(__dirname, "../supabase/schema.sql"), "utf8");
    const table = (name) => schema.match(new RegExp(`create table if not exists ${name} \\([\\s\\S]*?\\n\\);`))[0];
    const legacyRpc = schema.slice(schema.indexOf("create or replace function checkin_session"), schema.indexOf("-- RLS", schema.indexOf("create or replace function checkin_session")));
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create schema auth;
      create function auth.role() returns text language sql as $$select current_setting('request.jwt.claim.role', true)$$;
      set request.jwt.claim.role = 'service_role';
      create table surveys (id uuid primary key, checkin_theme jsonb, checkin_pin text);
      ${table("survey_questions")} ${table("survey_responses")} ${table("checkin_logs")}
      ${legacyRpc.slice(0, legacyRpc.indexOf("$$;", legacyRpc.indexOf("create or replace function uncheckin_session")) + 3)}`);
    const legacySurvey = randomUUID(), legacyResponse = randomUUID();
    const attendees = [randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID(), randomUUID()];
    await db.query("insert into surveys values ($1,$2,null),($3,null,null)", [surveyId, { sessionsEnabled: true, sessionConfig: config }, legacySurvey]);
    await db.query("insert into survey_questions (id,survey_id,position,type,text,required,options) values ($1,$2,0,'choice','Attendance',true,$3)", [questionId, surveyId, question.options]);
    for (const [index, answer] of [0, 1, 2, [0, 1], "2", 2].entries()) {
      await db.query("insert into survey_responses (id,survey_id,answers,hall,payment_status) values ($1,$2,$3,'Old hall',$4)", [attendees[index], surveyId, { [questionId]: answer }, index === 5 ? "pending" : "not_required"]);
    }
    await db.query("insert into survey_responses (id,survey_id,session_checkins,checked_in) values ($1,$2,$3,true)", [legacyResponse, legacySurvey, { old: "2025-01-01T00:00:00Z" }]);
    const before = (await db.query("select id,answers,checked_in,session_checkins from survey_responses order by id")).rows;
    const migration = readFileSync(path.join(__dirname, "../supabase/checkin-sessions.sql"), "utf8");
    await db.exec(migration);
    await db.exec(migration);
    assert.deepEqual((await db.query("select id,answers,checked_in,session_checkins from survey_responses order by id")).rows, before);
    const call = async (id, key, action = "checkin", sid = surveyId, method = "qr") => (await db.query("select record_session_checkin($1,$2,$3,$4,$5) result", [sid, id, key, action, method])).rows[0].result;
    const setConfig = async (next, enabled = true) => db.query("update surveys set checkin_theme=$2 where id=$1", [surveyId, { sessionsEnabled: enabled, sessionConfig: next }]);
    assert.equal((await call(attendees[0], "gala")).code, "denied");
    assert.equal((await call(attendees[1], "conference")).code, "denied");
    assert.equal((await call(attendees[4], "conference")).code, "denied");
    assert.equal((await call(attendees[5], "conference")).code, "payment_pending");
    assert.equal((await call(attendees[0], "unknown")).code, "invalid_session");
    assert.equal((await call(attendees[0], "conference", "checkin", legacySurvey)).code, "not_found");
    assert.equal((await call(attendees[0], "conference", null)).code, "bad_request");
    assert.equal((await call(attendees[0], "conference", "preview")).code, "ready");
    assert.equal((await db.query("select count(*)::int n from checkin_logs")).rows[0].n, 0);
    const first = await call(attendees[0], "conference");
    assert.equal(first.code, "checked_in");
    assert.equal(first.session.hall, "A");
    assert.equal((await call(attendees[0], "conference")).checkedInAt, first.checkedInAt);
    assert.equal((await call(attendees[1], "gala")).session.hall, "B");
    assert.equal((await call(attendees[2], "conference")).code, "checked_in");
    assert.equal((await call(attendees[2], "gala", "checkin", surveyId, "face")).code, "checked_in");
    assert.equal(Object.keys((await db.query("select session_checkins from survey_responses where id=$1", [attendees[2]])).rows[0].session_checkins).length, 2);
    const simultaneous = await Promise.all([call(attendees[3], "gala"), call(attendees[3], "gala")]);
    assert.deepEqual(simultaneous.map((r) => r.code), ["checked_in", "already"]);
    assert.equal((await db.query("select count(*)::int n from checkin_logs where response_id=$1 and session_name='gala'", [attendees[3]])).rows[0].n, 1);
    assert.equal((await db.query("select bool_or(checked_in) checked from survey_responses where survey_id=$1", [surveyId])).rows[0].checked, false);

    const closedConfig = { ...config, sessions: config.sessions.map((s) => ({ ...s, name: `${s.name} renamed`, closesAt: "2000-01-01T00:00:00Z" })) };
    await setConfig(closedConfig);
    assert.equal((await call(attendees[3], "conference")).code, "closed");
    assert.equal((await call(attendees[0], "conference")).code, "already");
    assert.equal((await call(attendees[0], "conference")).session.name, "Hội thảo renamed");
    assert.equal((await call(attendees[3], "gala", "undo")).code, "unchecked");
    await setConfig({ ...config, sessions: config.sessions.map((s) => ({ ...s, opensAt: "2100-01-01T00:00:00Z" })) });
    assert.equal((await call(attendees[3], "conference")).code, "not_open");
    await setConfig(config, false);
    assert.equal((await call(attendees[3], "conference")).code, "disabled");
    await setConfig({ ...config, sessions: [config.sessions[1]] });
    assert.equal((await call(attendees[0], "conference", "undo")).code, "unchecked");
    await setConfig(config);

    // Public legacy RPCs/row writes must not bypass configured rights/windows.
    await db.exec("set request.jwt.claim.role='anon'");
    await assert.rejects(db.query("select checkin_session($1,'gala')", [attendees[0]]), /check-in API/);
    await assert.rejects(db.query("update survey_responses set session_checkins=$2 where id=$1", [attendees[0], { gala: "2026-10-06" }]), /check-in API/);
    await assert.rejects(db.query("update survey_responses set checked_in=true where id=$1", [attendees[0]]), /check-in API/);
    await assert.rejects(db.query("update survey_responses set survey_id=$2 where id=$1", [attendees[0], legacySurvey]), /check-in API/);
    await assert.rejects(db.query("insert into survey_responses(id,survey_id,session_checkins) values($1,$2,$3)", [randomUUID(), surveyId, { gala: "2026-10-06" }]), /check-in API/);
    await db.query("update survey_responses set answers=$2 where id=$1", [attendees[0], { [questionId]: 2 }]);
    await db.query("select checkin_session($1,'new legacy')", [legacyResponse]);
    assert.equal((await db.query("select session_checkins from survey_responses where id=$1", [legacyResponse])).rows[0].session_checkins.old, "2025-01-01T00:00:00Z");
    const privileges = (await db.query("select has_function_privilege('anon','record_session_checkin(uuid,uuid,text,text,text)','execute') a, has_function_privilege('authenticated','record_session_checkin(uuid,uuid,text,text,text)','execute') u, has_function_privilege('service_role','record_session_checkin(uuid,uuid,text,text,text)','execute') s")).rows[0];
    assert.deepEqual(privileges, { a: false, u: false, s: true });
    await db.exec("set request.jwt.claim.role='service_role'");
    assert.equal((await call(legacyResponse, "Legacy API", "checkin", legacySurvey)).code, "checked_in");
  } finally { await db.close(); }
});
