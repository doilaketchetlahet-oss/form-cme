// Start app on port 3107; CHECKIN_TEST_DEPS supplies Playwright.
// Real Supabase client, mocked REST + WebSocket. No real data, writes or mail.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const uiRequire = process.env.CHECKIN_TEST_DEPS ? createRequire(path.join(process.env.CHECKIN_TEST_DEPS, 'package.json')) : require;
const { chromium } = uiRequire('playwright');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const base = process.env.ATTENDEES_E2E_BASE || 'http://localhost:3107';
const screenshots = mkdtempSync(path.join(tmpdir(), 'attendee-sync-ui-'));
let browser;

async function run(viewport) {
  const surveyId = randomUUID();
  const fields = [{ id: 'name', text: 'Họ và tên', type: 'text', position: 0 }];
  let records = ['Nguyễn An', 'Trần Bình'].map((name, index) => ({ id: randomUUID(), survey_id: surveyId,
    answers: { name }, submitted_at: `2026-11-13T01:00:0${index}Z`, checked_in: false, session_checkins: {} }));
  let reads = 0, writes = 0, activeSocket, activeTopic, activeJoin;
  const joins = [], errors = [], socketMessages = [];
  const context = await browser.newContext({ viewport });
  try {
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.host === host) {
        if (request.method() !== 'GET') { writes++; return route.abort(); }
        let body = [];
        if (url.pathname.endsWith('/surveys')) body = { id: surveyId, title: 'Kiểm tra đồng bộ khách', checkin_pin: '', checkin_theme: {} };
        if (url.pathname.endsWith('/survey_questions')) body = fields;
        if (url.pathname.endsWith('/survey_responses')) { reads++; body = records; }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      if (url.origin === new URL(base).origin && !url.pathname.startsWith('/api/')) return route.continue();
      return route.abort();
    });
    await context.routeWebSocket('**/*', (socket) => {
      socket.onMessage((raw) => {
        const [join, ref, topic, event, payload] = JSON.parse(String(raw));
        socketMessages.push(event);
        if (event === 'phx_join') {
          activeSocket = socket; activeTopic = topic; activeJoin = join;
          joins.push(topic);
          socket.send(JSON.stringify([join, ref, topic, 'phx_reply', { status: 'ok', response: {
            postgres_changes: payload.config.postgres_changes.map((filter) => ({ ...filter, id: 1 })),
          } }]));
        } else if (event === 'heartbeat' || event === 'phx_leave') {
          socket.send(JSON.stringify([join, ref, topic, 'phx_reply', { status: 'ok', response: {} }]));
        }
      });
    });
    await context.addInitScript(() => {
      let visibility = 'visible';
      Object.defineProperty(document, 'visibilityState', { get: () => visibility });
      window.setTestVisibility = (value) => { visibility = value; document.dispatchEvent(new Event('visibilitychange')); };
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.clock.install();
    await page.goto(`${base}/attendees/${surveyId}`);
    await page.getByRole('heading', { name: 'Kiểm tra đồng bộ khách' }).waitFor();
    await page.getByRole('button', { name: 'Tất cả (2)', exact: true }).waitFor();
    await page.waitForFunction(() => true);
    assert.ok(joins.length > 0, 'Real client joins mocked Realtime');
    // Allow initial join/snapshot reconciliation to finish before measuring.
    await page.clock.fastForward(1000);
    await page.getByRole('checkbox').nth(1).waitFor();
    const startupReads = reads;
    await page.clock.fastForward(50_000);
    assert.equal(reads, startupReads, 'No five-second reads during an idle minute');

    const emit = async (type, record, old = {}) => {
      activeSocket.send(JSON.stringify([activeJoin, null, activeTopic, 'postgres_changes', { ids: [1], data: {
        schema: 'public', table: 'survey_responses', type, commit_timestamp: new Date().toISOString(),
        columns: [], record, old_record: old, errors: null,
      } }]));
      // Wait until the real client has received the socket message before ticking its batch timer.
      await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => resolve())));
      await page.clock.fastForward(150);
    };
    records[0] = { ...records[0], checked_in: true, checked_in_at: new Date().toISOString() };
    await emit('UPDATE', records[0]);
    await page.getByRole('button', { name: 'Đã check-in (1)', exact: true }).waitFor();
    assert.equal(reads, startupReads, 'Check-in does not reread the list');
    const added = { ...records[1], id: randomUUID(), answers: { name: 'Khách vừa đăng ký' } };
    records.push(added);
    await emit('INSERT', added);
    await page.getByRole('button', { name: 'Tất cả (3)', exact: true }).waitFor();
    await emit('INSERT', added);
    assert.equal(await page.getByRole('checkbox').count(), 3, 'Duplicate event keeps one row');
    records = records.filter((r) => r.id !== added.id);
    await emit('DELETE', {}, { id: added.id });
    await page.getByRole('button', { name: 'Tất cả (2)', exact: true }).waitFor();
    assert.equal(reads, startupReads, 'Insert/delete also apply locally');

    await page.evaluate(() => window.setTestVisibility('hidden'));
    await page.waitForTimeout(100); // Let the mocked leave acknowledgment arrive.
    const hiddenReads = reads;
    records = [records[1]]; // Simulate missed deletion while suspended.
    await page.clock.fastForward(180_000);
    await page.waitForTimeout(100); // Complete the real client's socket teardown.
    assert.equal(reads, hiddenReads, 'Hidden tab does not fetch');
    await page.evaluate(() => window.setTestVisibility('visible'));
    await page.clock.fastForward(1);
    await page.getByRole('button', { name: 'Tất cả (1)', exact: true }).waitFor();
    assert.ok(reads > hiddenReads, 'Returning tab repairs missed changes');
    await page.clock.fastForward(1000);
    await page.waitForTimeout(100);
    assert.ok(joins.length >= 2, `Returning tab reconnects: ${JSON.stringify(socketMessages)}`);
    assert.equal(writes, 0);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.screenshot({ path: path.join(screenshots, `${viewport.width}.png`), fullPage: true });
    console.log(`${viewport.width}px: Realtime insert/update/delete, idle reads, hidden tab and return passed. Screenshot: ${screenshots}`);
  } finally { await context.close(); }
}

(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  await run({ width: 1440, height: 1000 });
  await run({ width: 390, height: 844 });
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
