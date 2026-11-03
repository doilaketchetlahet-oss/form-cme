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
  let allowWrites = false, failNextSave = false;
  const errors = [], writes = [], emails = [];
  const savedRecords = structuredClone(records);
  const context = await browser.newContext({ viewport });
  try {
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.origin === new URL(base).origin && url.pathname === '/api/send-checkin-email') {
        emails.push(request.postDataJSON());
        return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
      }
      if (url.host === host) {
        if (request.method() !== 'GET') {
          writes.push(request.method());
          if (!allowWrites || !url.pathname.endsWith('/survey_responses')) return route.abort();
          if (failNextSave) {
            failNextSave = false;
            return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Mock save failure"}' });
          }
          const patch = request.postDataJSON();
          if (request.method() === 'PATCH') {
            const row = savedRecords.find((r) => `eq.${r.id}` === url.searchParams.get('id'));
            assert.ok(row);
            Object.assign(row, patch);
            return route.fulfill({ status: 204 });
          }
          if (request.method() === 'POST') {
            const row = { ...patch, id: randomUUID(), submitted_at: new Date().toISOString(), checked_in: false };
            savedRecords.unshift(row);
            return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(row) });
          }
          return route.abort();
        }
        let body = [];
        if (url.pathname.endsWith('/surveys')) body = { id: surveyId, title: 'Attendee display test', checkin_pin: '', checkin_theme: {} };
        if (url.pathname.endsWith('/survey_questions')) body = withHall ? [...fields, { id: 'hall', text: 'Phân hội trường', type: 'choice', options: ['A', 'B'], is_hall_selector: true, position: fields.length }] : fields;
        if (url.pathname.endsWith('/survey_responses')) body = savedRecords;
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
    allowWrites = true;
    const field = (container, label) => container.locator('label').filter({ hasText: new RegExp(`^${label}$`) }).locator('..').locator('input');
    // Adding an email to an existing guest and replacing it must only save data.
    for (const email of ['added@example.test', 'corrected@example.test']) {
      await detail.getByRole('button', { name: 'Sửa', exact: true }).click();
      await field(detail, 'Email').fill(email);
      await detail.getByRole('button', { name: 'Lưu', exact: true }).click();
      await detail.getByRole('button', { name: 'Sửa', exact: true }).waitFor();
      await page.getByText('Đã lưu email mới, chưa gửi thư. Bấm "Gửi lại QR" khi cần.', { exact: true }).first().waitFor();
      assert.equal(savedRecords.find((r) => r.id === records[0].id).email, email);
      assert.deepEqual(emails, [], 'Saving an added/changed email must never send QR');
    }
    await page.reload();
    await page.getByRole('checkbox').nth(records.length - 1).waitFor();
    await rows().first().locator('p').first().click();
    await detail.getByText('corrected@example.test', { exact: true }).waitFor();
    assert.deepEqual(emails, [], 'Reloading a saved email must not send mail');

    failNextSave = true;
    await detail.getByRole('button', { name: 'Sửa', exact: true }).click();
    await field(detail, 'Email').fill('not-saved@example.test');
    await detail.getByRole('button', { name: 'Lưu', exact: true }).click();
    await page.getByText('Chưa lưu được thông tin. Vui lòng thử lại.', { exact: true }).waitFor();
    assert.equal(await field(detail, 'Email').inputValue(), 'not-saved@example.test', 'Failed save retains edits for retry');
    assert.equal(savedRecords.find((r) => r.id === records[0].id).email, 'corrected@example.test');
    assert.deepEqual(emails, []);
    await detail.getByRole('button', { name: 'Huỷ', exact: true }).click();
    await detail.getByRole('button', { name: 'Gửi lại QR', exact: true }).click();
    await page.getByText('Đã gửi lại QR đến corrected@example.test', { exact: true }).waitFor();
    assert.deepEqual(emails, [{ responseId: records[0].id, to: 'corrected@example.test' }], 'Explicit send uses the saved new email');
    await page.keyboard.press('Escape');
    await detail.waitFor({ state: 'hidden' });

    await page.getByRole('button', { name: 'Thêm', exact: true }).click();
    const addForm = page.getByRole('heading', { name: 'Thêm người mới' }).locator('../..');
    await field(addForm, 'Họ và tên').fill('Khách mới');
    await field(addForm, 'Email').fill('new-guest@example.test');
    await addForm.getByRole('button', { name: 'Thêm vào danh sách' }).click();
    await page.getByRole('heading', { name: 'Thêm người mới' }).waitFor({ state: 'hidden' });
    assert.equal(savedRecords[0].answers.email, 'new-guest@example.test');
    assert.equal(emails.length, 1, 'Adding a guest with an email must not send mail');
    assert.deepEqual(errors, []);
    console.log(`${viewport.width}px: display, add/edit/reload without email, failed-save preservation and explicit QR send passed (all writes/mail mocked).`);
  } finally { await context.close(); }
}

(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  await run({ width: 1440, height: 1000 });
  await run({ width: 390, height: 844 });
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
