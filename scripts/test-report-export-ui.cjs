// Start app on port 3107. CHECKIN_TEST_DEPS supplies Playwright; optional PLAYWRIGHT_CHANNEL=msedge.
// Auth/REST/WebSockets are mocked. Downloaded XLSX/CSV are decoded with a separate reader.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { mkdtempSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const uiRequire = process.env.CHECKIN_TEST_DEPS ? createRequire(path.join(process.env.CHECKIN_TEST_DEPS, 'package.json')) : require;
const { chromium } = uiRequire('playwright');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const base = process.env.REPORT_E2E_BASE || 'http://localhost:3107';
const screenshots = mkdtempSync(path.join(tmpdir(), 'report-export-ui-'));
const user = { id: randomUUID(), email: 'report@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} };
const expires = Math.floor(Date.now() / 1000) + 3600;
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: expires })).toString('base64url')}.test-only`;
const session = { access_token: token, refresh_token: 'test-only', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
let browser;

async function run(viewport) {
  const formId = randomUUID();
  const survey = { id: formId, title: 'Báo cáo đăng ký kiểm thử', form_type: 'registration', is_anonymous: true, checkin_theme: null, payment_config: null };
  let fields = [
    { id: 'name', text: 'Họ và tên', type: 'text' }, { id: 'phone', text: 'Số điện thoại', type: 'phone' },
    { id: 'unit', text: 'Đơn vị', type: 'paragraph' },
    { id: 'program', text: 'Chương trình', type: 'choice', options: ['Hội thảo', 'Gala', 'Cả hai'] },
    { id: 'cme', text: 'Đăng ký cấp CME', type: 'choice', options: ['Có', 'Không'] },
  ].map((q, position) => ({ options: null, position, survey_id: formId, ...q }));
  const record = (id, name, patch = {}) => ({ id, survey_id: formId, submitted_at: '2026-11-16T01:00:00Z', checked_in: false,
    answers: { name, phone: '0900123456', unit: 'Bệnh viện Đa khoa, "Đơn vị A"\nĐịa chỉ dòng 2', program: 2, cme: 0 },
    email: 'not-a-form-field@example.test', hall: 'A', payment_status: 'paid', payment_amount: 100000, session_checkins: {}, ...patch });
  let records = [record('a', 'Nguyễn An'), record('b', 'Trần Bình'), record('c', 'Lê Chưa Đến')];
  let failAfter = false, delay = 0;
  const errors = [], writes = [], reads = [], downloads = [];
  const context = await browser.newContext({ viewport });
  try {
    await context.addInitScript(({ host, session }) => localStorage.setItem(`sb-${host.split('.')[0]}-auth-token`, JSON.stringify(session)), { host, session });
    await context.routeWebSocket('**/*', (socket) => socket.close());
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.host === host) {
        if (request.method() !== 'GET') { writes.push(request.method()); return route.abort(); }
        let body = [];
        if (url.pathname.endsWith('/admin_members')) body = { role: 'owner', active: true };
        if (url.pathname.endsWith('/user')) body = user;
        if (url.pathname.endsWith('/surveys')) body = survey;
        if (url.pathname.endsWith('/survey_questions')) body = fields;
        if (url.pathname.endsWith('/survey_responses')) {
          reads.push(url.search);
          if (delay) await new Promise((resolve) => setTimeout(resolve, delay));
          const after = url.searchParams.get('id')?.replace(/^gt\./, '') || '';
          if (failAfter && after) return route.fulfill({ status: 500, contentType: 'application/json', body: '{"message":"Mock later-page read failure"}' });
          body = records.filter((r) => r.id > after).sort((a, b) => a.id.localeCompare(b.id)).slice(0, Number(url.searchParams.get('limit') || 500));
        }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      if (url.origin === new URL(base).origin && url.pathname.startsWith('/api/')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
      if (url.origin === new URL(base).origin) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('download', (download) => downloads.push(download));
    await page.goto(`${base}/admin/forms/${formId}/report`);
    const exporter = page.getByRole('region', { name: 'Xuất danh sách đăng ký', exact: true });
    await exporter.waitFor();
    const scope = page.getByLabel('Danh sách cần xuất', { exact: true });
    const status = page.getByLabel('Trạng thái check-in', { exact: true });
    const search = page.getByLabel('Tìm người đăng ký', { exact: true });
    const excel = () => exporter.getByRole('button', { name: 'Xuất Excel', exact: true });
    assert.equal(await scope.inputValue(), 'checked');
    assert.equal(await page.getByLabel('Hội trường được phân', { exact: true }).count(), 0);
    assert.equal(await page.getByText('Đã thanh toán', { exact: true }).count(), 0, 'No payment UI for a non-payment form, even with stale paid records');
    await exporter.getByRole('status').getByText(/^0 người/).waitFor();
    const download = async (format) => {
      const event = page.waitForEvent('download');
      await exporter.getByRole('button', { name: format === 'xlsx' ? 'Xuất Excel' : 'Xuất CSV', exact: true }).click();
      const file = await event;
      const bytes = readFileSync(await file.path());
      const book = XLSX.read(bytes, { type: 'buffer', raw: format === 'csv' });
      const matrix = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { header: 1, raw: true });
      const rows = XLSX.utils.sheet_to_json(book.Sheets[book.SheetNames[0]], { raw: true });
      await excel().waitFor();
      return { file, bytes, matrix, rows };
    };
    // The report opened with zero check-ins. Export must reread and include new arrivals.
    records[0].checked_in = true; records[0].checked_in_at = '2026-11-16T02:00:00Z';
    records[1].checked_in = true; records[1].checked_in_at = '2026-11-16T03:00:00Z';
    delay = 200;
    const start = page.waitForEvent('download');
    await excel().click();
    await exporter.getByRole('button', { name: 'Đang xuất Excel…', exact: true }).waitFor();
    assert.equal(await scope.isDisabled(), true);
    const firstFile = await start;
    delay = 0;
    const firstBytes = readFileSync(await firstFile.path());
    const firstBook = XLSX.read(firstBytes, { type: 'buffer' });
    const firstSheet = firstBook.Sheets['Danh sách'];
    const firstRows = XLSX.utils.sheet_to_json(firstSheet);
    assert.deepEqual(firstRows.map((r) => r['Họ và tên']), ['Nguyễn An', 'Trần Bình']);
    const headers = XLSX.utils.sheet_to_json(firstSheet, { header: 1 })[0];
    assert.deepEqual(headers, ['STT', ...fields.map((q) => q.text), 'Thời gian đăng ký', 'Check-in', 'Thời gian check-in']);
    assert.equal(firstRows[0]['Số điện thoại'], '0900123456');
    assert.equal(firstRows[0]['Chương trình'], 'Cả hai');
    assert.ok(firstFile.suggestedFilename().includes('da-check-in'));
    const styled = new ExcelJS.Workbook(); await styled.xlsx.load(firstBytes);
    assert.equal(styled.worksheets[0].views[0].ySplit, 1);
    assert.equal(styled.worksheets[0].getCell('A1').font.bold, true);
    await excel().waitFor();
    await exporter.screenshot({ path: path.join(screenshots, `export-${viewport.width}.png`) });

    await scope.selectOption('filtered');
    assert.equal((await download('csv')).rows.length, 3, 'Explicit full filtered scope includes pending registrations');
    await scope.selectOption('checked');
    await search.fill('benh vien da khoa');
    records[1].answers.unit = 'Đơn vị B'; records[2].answers.unit = 'Đơn vị C';
    assert.equal((await download('xlsx')).rows.length, 1, 'Fresh accent-insensitive search filters exported rows');
    await search.fill('');
    await status.selectOption('pending');
    const beforeEmpty = downloads.length;
    await excel().click();
    await page.getByText('Không có người đã check-in trong bộ lọc hiện tại.', { exact: true }).first().waitFor();
    assert.equal(downloads.length, beforeEmpty, 'Empty scope never falls back to all registrations');
    await scope.selectOption('filtered');
    const pending = await download('xlsx');
    assert.deepEqual(pending.rows.map((r) => r['Họ và tên']), ['Lê Chưa Đến']);
    await status.selectOption('all');
    await scope.selectOption('checked');

    // Current saved form metadata enables only the configured hall/payment/session columns.
    survey.payment_config = { enabled: true };
    survey.checkin_theme = { sessionConfig: { questionId: 'program', sessions: [
      { id: 'conference', name: 'Hội thảo', hall: 'Trung tâm', optionIndexes: [0, 2] },
      { id: 'gala', name: 'Gala', hall: 'Nhà hàng', optionIndexes: [1, 2] },
    ] } };
    fields = [...fields, { id: 'hall', position: fields.length, survey_id: formId, text: 'Hội trường đăng ký', type: 'choice', is_hall_selector: true, options: ['A', 'B'] }];
    records[0].checked_in = false; records[0].checked_in_at = null; records[0].session_checkins = { conference: '2026-11-16T04:00:00Z' };
    records[1].checked_in = false; records[1].checked_in_at = null; records[1].session_checkins = { gala: '2026-11-16T05:00:00Z' }; records[1].hall = 'B';
    const managed = await download('xlsx');
    assert.equal(managed.rows.length, 2, 'Session-only arrivals count as checked in');
    assert.ok(managed.matrix[0].includes('Thanh toán'));
    assert.equal(managed.rows[0]['Check-in: Hội thảo'], 'Đã check-in');
    assert.equal(managed.rows[1]['Check-in: Gala'], 'Đã check-in');
    await page.getByLabel('Hội trường được phân', { exact: true }).selectOption('B');
    assert.deepEqual((await download('xlsx')).rows.map((r) => r['Họ và tên']), ['Trần Bình']);

    if (viewport.width > 1000) {
      await page.getByLabel('Hội trường được phân', { exact: true }).selectOption('');
      await scope.selectOption('filtered');
      records = Array.from({ length: 1201 }, (_, index) => record(String(index).padStart(5, '0'), `Guest ${index}`));
      failAfter = true;
      const beforeFailure = downloads.length;
      await excel().click();
      await page.getByText('Không tải được đầy đủ dữ liệu mới nhất. Vui lòng thử lại; chưa có file nào được xuất.', { exact: true }).first().waitFor();
      assert.equal(downloads.length, beforeFailure, 'Failed later pages never download partial data');
      failAfter = false;
      const large = await download('xlsx');
      assert.equal(large.rows.length, 1201);
      assert.equal(large.rows.at(-1)['Họ và tên'], 'Guest 1200');
    }
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    console.log(`${viewport.width}px: actual Excel/CSV, checked/default/full scope, latest records/settings, search/hall, session arrivals, empty/error exports and formatting passed. ${screenshots}`);
  } finally { await context.close(); }
}

(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  await run({ width: 1440, height: 1000 });
  await run({ width: 390, height: 844 });
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
