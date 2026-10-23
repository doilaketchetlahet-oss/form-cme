// Start app on port 3107. CHECKIN_TEST_DEPS supplies Playwright if needed.
// PLAYWRIGHT_CHANNEL=msedge is supported. Synthetic workbook and mocked APIs only.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const XLSX = require('xlsx');
const uiRequire = process.env.CHECKIN_TEST_DEPS ? createRequire(path.join(process.env.CHECKIN_TEST_DEPS, 'package.json')) : require;
const { chromium } = uiRequire('playwright');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const base = process.env.ATTENDANCE_E2E_BASE || 'http://localhost:3107';
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const surveyId = randomUUID(), name = randomUUID(), email = randomUUID(), report = randomUUID();
const questions = [{ id: name, text: 'Họ và tên' }, { id: email, text: 'Email' }, { id: report, text: 'Tên báo cáo' }]
  .map((q, position) => ({ ...q, type: 'text', options: null, position, required: q.id === name, is_hall_selector: false, show_if: null }));
const header = Array(14).fill('');
header[1] = 'TÊN BÁO CÁO'; header[5] = header[8] = 'Họ và tên'; header[6] = header[12] = 'Email';
const row = (title, speaker, address) => { const r = Array(14).fill(''); r[1] = title; r[5] = 'Người liên hệ'; r[6] = 'contact@example.test'; r[8] = speaker; r[12] = address; return r; };
const book = XLSX.utils.book_new();
const archive = XLSX.utils.aoa_to_sheet([[], ['ARCHIVE'], ['Họ và tên', 'Email'], ['Khách cũ', 'old@example.test']]);
archive['!merges'] = [{ s: { r: 1, c: 0 }, e: { r: 1, c: 1 } }];
XLSX.utils.book_append_sheet(book, archive, 'Archive');
XLSX.utils.book_append_sheet(book, {}, 'Empty');
const speakers = XLSX.utils.aoa_to_sheet([header, row('Bài A', 'Báo cáo viên A', 'a@example.test'), [], row('Bài B', 'Báo cáo viên B', '')]);
speakers['!ref'] = 'A1:AB977';
XLSX.utils.book_append_sheet(book, speakers, 'Báo cáo viên');
book.Workbook = { Sheets: [{ name: 'Archive', Hidden: 1 }, { name: 'Empty', Hidden: 1 }, { name: 'Báo cáo viên', Hidden: 0 }] };
const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
let browser;

async function run(viewport) {
  const context = await browser.newContext({ viewport });
  const records = [], errors = [];
  let writes = 0;
  try {
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.host !== host) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      let body = [];
      if (url.pathname.endsWith('/surveys')) body = { id: surveyId, title: 'Sheet import test', checkin_pin: '', checkin_theme: null };
      if (url.pathname.endsWith('/survey_questions')) body = questions;
      if (url.pathname.endsWith('/survey_responses')) {
        if (request.method() === 'POST') { writes++; records.push(...request.postDataJSON().map((r) => ({ ...r, id: randomUUID() }))); }
        body = records;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/attendees/${surveyId}/import`);
    await page.getByRole('heading', { name: 'Sheet import test' }).waitFor();
    const upload = () => page.locator('input[type=file]').setInputFiles({ name: 'speakers.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer });
    await upload();
    const sheetSelect = page.getByLabel('Sheet để import', { exact: true });
    await sheetSelect.waitFor();
    assert.equal(await sheetSelect.inputValue(), '2');
    assert.equal(await sheetSelect.locator('option').count(), 3);
    assert.equal(await page.getByRole('button', { name: /^Import \d+ người$/ }).isEnabled(), false);
    assert.equal(await page.locator('tbody tr').count(), 2);
    assert.equal(await page.locator('main').getByRole('alert').isVisible(), true);
    assert.equal(writes, 0);

    await sheetSelect.selectOption('0');
    assert.equal(await page.getByLabel('Dòng chứa tên cột').inputValue(), '3');
    assert.equal(await page.locator('tbody tr').count(), 1);
    assert.equal(await page.locator('tbody').getByText('#4', { exact: true }).count(), 1);
    await page.getByLabel('Dòng chứa tên cột').fill('2');
    assert.equal(await page.getByLabel('Dòng chứa tên cột').inputValue(), '2');
    await sheetSelect.selectOption('1');
    assert.equal(await page.locator('tbody').getByText('Không có dòng nào khớp bộ lọc.', { exact: true }).count(), 1);
    assert.equal(await page.getByRole('button', { name: 'Import 0 người', exact: true }).isEnabled(), false);
    await sheetSelect.selectOption('2');

    await page.getByLabel('Ghép trường Họ và tên', { exact: true }).selectOption('8');
    await page.getByLabel('Cột Email nhận QR', { exact: true }).selectOption('12');
    assert.equal(await page.getByLabel('Ghép trường Email', { exact: true }).inputValue(), '12');
    await page.getByRole('button', { name: 'Áp dụng ghép cột / đọc lại file' }).click();
    assert.equal(await page.locator('main').getByRole('alert').count(), 0);
    assert.equal(await page.locator('tbody tr').count(), 2);
    assert.equal(await page.locator('tbody').getByText('#4', { exact: true }).count(), 1);
    assert.equal(await page.locator('tbody').getByText('Người liên hệ', { exact: true }).count(), 0);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);

    // Switching sources discards old column mappings; repeated upload works too.
    await sheetSelect.selectOption('0');
    await sheetSelect.selectOption('2');
    assert.equal(await page.getByLabel('Ghép trường Họ và tên', { exact: true }).inputValue(), 'auto');
    await upload();
    await page.getByLabel('Ghép trường Họ và tên', { exact: true }).selectOption('8');
    await page.getByLabel('Ghép trường Email', { exact: true }).selectOption('12');
    await page.getByRole('button', { name: 'Áp dụng ghép cột / đọc lại file' }).click();
    await page.getByRole('button', { name: 'Import 2 người', exact: true }).click();
    await page.getByText('Đã import 2 người vào danh sách.', { exact: true }).waitFor();
    assert.equal(writes, 1); assert.equal(records.length, 2);
    assert.deepEqual(records.map((r) => [r.answers[name], r.email || '', r.answers[report]]), [['Báo cáo viên A', 'a@example.test', 'Bài A'], ['Báo cáo viên B', '', 'Bài B']]);
    assert.deepEqual(errors, []);
    console.log(`${viewport.width}px: visible-sheet default, hidden/empty sheets, header row, duplicate mapping, reset and exact import payload passed.`);
  } finally { await context.close(); }
}

async function runEditedPreview(viewport) {
  const context = await browser.newContext({ viewport });
  const records = [], errors = [];
  let writes = 0;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Họ và tên', 'Email', 'Email', 'Tên báo cáo'],
    ...Array.from({ length: 119 }, (_, index) => [`Khách ${index + 1}`, 'contact@example.test', 'speaker@example.test', `Bài ${index + 1}`]),
    ['', '', '', 'Dòng thiếu tên'],
  ]), 'Guests');
  try {
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.host !== host) return url.origin === new URL(base).origin ? route.continue() : route.abort();
      let body = [];
      if (url.pathname.endsWith('/surveys')) body = { id: surveyId, title: 'Edited preview test', checkin_pin: '', checkin_theme: null };
      if (url.pathname.endsWith('/survey_questions')) body = questions;
      if (url.pathname.endsWith('/survey_responses')) {
        if (request.method() === 'POST') { writes++; records.push(...request.postDataJSON().map((r) => ({ ...r, id: randomUUID() }))); }
        body = records;
      }
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/attendees/${surveyId}/import`);
    await page.getByRole('heading', { name: 'Edited preview test' }).waitFor();
    await page.locator('input[type=file]').setInputFiles({ name: '119-guests.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) });
    const importButton = page.getByRole('button', { name: 'Import 119 người', exact: true });
    await importButton.waitFor();
    assert.equal(await importButton.isEnabled(), true);
    assert.equal(await page.locator('#import-mapping-warning').isVisible(), true);
    // Row-level readiness can coexist with unresolved optional duplicate columns.
    // Cancelling the review must never write or rebuild the preview.
    await importButton.click();
    const dialog = page.getByRole('alertdialog');
    await dialog.waitFor();
    await dialog.getByRole('button', { name: 'Kiểm tra ghép cột' }).click();
    assert.equal(writes, 0);
    const firstRow = page.locator('tbody tr').first();
    await firstRow.getByRole('button').first().click();
    await firstRow.locator('input').nth(0).fill('edited@example.test');
    await firstRow.locator('input').nth(2).fill('Tên đã sửa thủ công');
    await firstRow.getByRole('button', { name: 'Xong', exact: true }).click();

    // Changing a mapping must not force an XLSX reread that loses manual edits.
    await page.getByLabel('Ghép trường Họ và tên', { exact: true }).selectOption('1');
    assert.equal(await importButton.isEnabled(), true);
    await importButton.click();
    await dialog.waitFor();
    assert.match(await dialog.textContent(), /ghép cột chưa áp dụng sẽ không được dùng/);
    await dialog.getByRole('button', { name: 'Import 119 người từ bảng', exact: true }).click();
    await page.getByText('Đã import 119 người vào danh sách.', { exact: true }).waitFor();
    assert.equal(writes, 1); assert.equal(records.length, 119);
    assert.deepEqual([records[0].answers[name], records[0].email], ['Tên đã sửa thủ công', 'edited@example.test']);
    assert.equal(records[1].answers[name], 'Khách 2');
    assert.equal(records[1].email, undefined); // No guess from either unresolved email column.
    assert.ok(records.every((record) => record.answers[report] !== 'Dòng thiếu tên'));
    assert.equal(await page.getByRole('button', { name: 'Import 0 người', exact: true }).isEnabled(), false);
    assert.equal(await page.locator('#import-mapping-warning').count(), 0);
    assert.deepEqual(errors, []);
    console.log(`${viewport.width}px: 119 valid rows remain importable with mapping warnings, cancel writes nothing, pending mappings preserve manual edits, invalid rows stay out.`);
  } finally { await context.close(); }
}

(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  await run({ width: 1366, height: 900 });
  await run({ width: 390, height: 844 });
  await runEditedPreview({ width: 1366, height: 900 });
  await runEditedPreview({ width: 390, height: 844 });
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
