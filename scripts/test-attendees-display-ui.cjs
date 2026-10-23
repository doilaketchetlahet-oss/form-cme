// Start app on port 3107. CHECKIN_TEST_DEPS supplies Playwright if needed.
// Optional PLAYWRIGHT_CHANNEL=msedge. Synthetic records only; no database writes or emails.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const uiRequire = process.env.CHECKIN_TEST_DEPS ? createRequire(path.join(process.env.CHECKIN_TEST_DEPS, 'package.json')) : require;
const { chromium } = uiRequire('playwright');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const base = process.env.ATTENDEES_E2E_BASE || 'http://localhost:3107';
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const surveyId = randomUUID();
const fields = [
  { id: 'unit', text: 'Đơn vị công tác', type: 'text' },
  { id: 'job', text: 'Chức danh', type: 'text' },
  { id: 'role', text: 'Vai trò', type: 'choice', options: ['Báo cáo viên', 'Đại biểu'] },
  { id: 'degree', text: 'Học hàm học vị', type: 'choice', options: ['PGS', 'TS'], allow_multiple: true },
  { id: 'email', text: 'Email', type: 'text' },
  { id: 'phone', text: 'Số điện thoại', type: 'phone' },
  { id: 'name', text: 'Họ và tên', type: 'text' },
].map((q, position) => ({ options: null, is_hall_selector: false, ...q, position }));
const records = [
  { answers: { unit: 'Đơn vị Z', job: 'Trưởng khoa', role: 0, degree: [0, 1], name: 'Nguyễn An' }, hall: 'A' },
  { answers: { unit: 'Đơn vị A', name: 'Bùi Bình' } },
  { answers: { unit: 'Đơn vị B' }, email: 'guest@example.test' },
  { answers: { unit: 'Đơn vị C', phone: '0900123456' } },
  { answers: {} },
].map((row, index) => ({ ...row, id: randomUUID(), survey_id: surveyId, submitted_at: new Date(Date.UTC(2026, 9, 23, 0, 0, 10 - index)).toISOString(), checked_in: false, payment_status: 'not_required' }));
const names = ['Nguyễn An', 'Bùi Bình', 'guest@example.test', '0900123456', records[4].id.slice(0, 8).toUpperCase()];
let browser;

async function run(viewport) {
  let withHall = false;
  const errors = [], writes = [];
  const context = await browser.newContext({ viewport });
  try {
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.host === host) {
        if (request.method() !== 'GET') { writes.push(request.method()); return route.abort(); }
        let body = [];
        if (url.pathname.endsWith('/surveys')) body = { id: surveyId, title: 'Attendee display test', checkin_pin: '', checkin_theme: {} };
        if (url.pathname.endsWith('/survey_questions')) body = withHall ? [...fields, { id: 'hall', text: 'Phân hội trường', type: 'choice', options: ['A', 'B'], is_hall_selector: true, position: fields.length }] : fields;
        if (url.pathname.endsWith('/survey_responses')) body = records;
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      if (url.origin === new URL(base).origin && !url.pathname.startsWith('/api/')) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/attendees/${surveyId}`);
    await page.getByRole('heading', { name: 'Attendee display test' }).waitFor();
    await page.getByRole('checkbox').nth(records.length - 1).waitFor();
    const rows = () => page.getByRole('checkbox').locator('..');
    const titles = () => rows().evaluateAll((items) => items.map((row) => row.querySelector('p').textContent));
    assert.deepEqual(await titles(), names, 'Name must win over earlier organization/title answers; missing names use contact/ID');
    assert.deepEqual(await rows().first().locator('dl dd').allTextContents(), ['PGS, TS', 'Báo cáo viên', 'Trưởng khoa']);
    assert.equal(await rows().nth(1).locator('dl').count(), 0, 'Blank identity fields should not add an empty line');
    assert.equal(await page.getByRole('option', { name: 'Theo hội trường', exact: true }).count(), 0);
    assert.equal(await page.getByRole('option', { name: 'Tất cả hội trường được phân' }).count(), 0);

    await rows().first().locator('p').first().click();
    const detail = page.getByRole('dialog', { name: 'Chi tiết người tham dự' });
    await detail.waitFor();
    assert.equal(await detail.getByRole('heading').textContent(), 'Nguyễn An');
    assert.equal(await detail.getByText('PGS, TS', { exact: true }).count(), 1, 'Detail decodes every selected qualification');
    const expectedLabels = ['Họ và tên', 'Học hàm học vị', 'Vai trò', 'Chức danh', 'Đơn vị công tác', 'Email', 'Số điện thoại'];
    assert.deepEqual(await detail.locator('label').allTextContents(), expectedLabels);
    assert.equal(await detail.getByText('Hội trường:', { exact: true }).count(), 0, 'Ignore stale hall data if the form has no hall field');
    await detail.getByRole('button', { name: 'Sửa', exact: true }).click();
    assert.deepEqual(await detail.locator('label').allTextContents(), expectedLabels, 'Editing preserves the same identity priority');
    await page.keyboard.press('Escape');
    await detail.waitFor({ state: 'hidden' });

    await page.locator('select').filter({ has: page.getByRole('option', { name: 'Tên A-Z', exact: true }) }).selectOption('name');
    assert.deepEqual(await titles(), [...names].sort((a, b) => a.localeCompare(b, 'vi')), 'Name sorting must use the displayed identity');

    withHall = true;
    await page.reload();
    await page.getByRole('checkbox').nth(records.length - 1).waitFor();
    assert.equal(await rows().first().locator('p').first().textContent(), 'Nguyễn An🏛 A');
    assert.equal(await page.getByRole('option', { name: 'Tất cả hội trường được phân' }).count(), 1);
    await rows().first().locator('p').first().click();
    await detail.waitFor();
    await detail.getByText('Hội trường:', { exact: true }).waitFor();
    assert.deepEqual((await detail.locator('label').allTextContents()).slice(0, 4), expectedLabels.slice(0, 4));
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log(`${viewport.width}px: attendee names, contact fallbacks, identity order, sorting and conditional halls passed without writes.`);
  } finally { await context.close(); }
}

(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  await run({ width: 1440, height: 1000 });
  await run({ width: 390, height: 844 });
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
