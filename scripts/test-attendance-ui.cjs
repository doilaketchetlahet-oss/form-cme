// npm run start -- --port 3107, then CHECKIN_TEST_DEPS=<temporary npm dir> node scripts/test-attendance-ui.cjs
// All Supabase/API calls are mocked. QR is decoded from a synthetic camera stream.
const assert = require('node:assert/strict');
const path = require('node:path');
const { tmpdir } = require('node:os');
const { mkdtempSync, readFileSync } = require('node:fs');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const uiRequire = process.env.CHECKIN_TEST_DEPS ? createRequire(path.join(process.env.CHECKIN_TEST_DEPS, 'package.json')) : require;
const { chromium } = uiRequire('playwright');
const XLSX = require('xlsx');
const QRCode = require('qrcode');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const base = process.env.ATTENDANCE_E2E_BASE || 'http://localhost:3107';
const surveyId = randomUUID(), program = randomUUID(), cme = randomUUID(), name = randomUUID();
const degree = randomUUID(), role = randomUUID(), job = randomUUID();
const config = { questionId: program, sessions: [
  { id: 'conference', name: 'Hội thảo', hall: 'Trung tâm hội nghị', checkHall: true, optionIndexes: [0, 2] },
  { id: 'gala', name: 'Gala dinner', hall: 'Nhà hàng', optionIndexes: [1, 2] }
] };
const survey = { id: surveyId, title: 'Kiểm tra tham dự', checkin_pin: '', checkin_theme: { sessionsEnabled: true, sessionConfig: config } };
const questions = [
  { id: job, text: 'Chức danh', type: 'text', options: null },
  { id: degree, text: 'Học hàm học vị', type: 'text', options: null },
  { id: program, text: 'Bạn tham dự chương trình nào?', type: 'choice', required: true, options: ['Chỉ hội thảo', 'Chỉ Gala dinner', 'Cả hội thảo và Gala dinner'] },
  { id: cme, text: 'Đăng ký cấp CME', type: 'choice', options: ['Có', 'Không'] },
  { id: role, text: 'Vai trò', type: 'choice', options: ['Báo cáo viên', 'Đại biểu'] },
  { id: name, text: 'Họ và tên', type: 'text', options: null },
].map((q, position) => ({ required: false, allow_multiple: false, is_hall_selector: false, show_if: null, ...q, position }));
let records = [], writes = 0, confirmations = 0;
const dir = mkdtempSync(path.join(tmpdir(), 'attendance-ui-'));
const errors = [];
let browser;
(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 } });
  await context.route(`https://${host}/**`, async (route) => {
    const request = route.request(), url = new URL(request.url());
    let body = [];
    if (url.pathname.endsWith('/surveys')) body = survey;
    if (url.pathname.endsWith('/survey_questions')) body = questions;
    if (url.pathname.endsWith('/survey_responses')) {
      if (request.method() === 'POST') {
        writes++;
        const payload = request.postDataJSON();
        records.push(...payload.map((r) => ({ ...r, id: randomUUID(), submitted_at: new Date().toISOString(), payment_status: 'not_required', checked_in: false, session_checkins: {} })));
      }
      const id = url.searchParams.get('id')?.replace(/^eq\./, '');
      body = id ? records.find((r) => r.id === id) : records;
    }
    await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': `0-${Math.max(0, records.length - 1)}/${records.length}` }, body: JSON.stringify(body) });
  });
  await context.route('**/api/checkin/**', async (route) => {
    const body = route.request().postDataJSON();
    const record = records.find((r) => r.id === body.responseId);
    const session = config.sessions.find((s) => s.id === body.sessionId);
    let result;
    if (!session.optionIndexes.includes(record.answers[program])) result = { ok: false, error: 'Người này không đăng ký tham dự buổi này.' };
    else if (session.checkHall && body.hall !== record.hall) result = { ok: false, error: 'Khách được phân hội trường khác.' };
    else if (record.session_checkins[body.sessionId]) result = { ok: true, code: 'already', checkedInAt: record.session_checkins[body.sessionId] };
    else if (body.action === 'preview') result = { ok: true, code: 'ready' };
    else { confirmations++; const at = new Date().toISOString(); record.session_checkins[body.sessionId] = at; result = { ok: true, code: 'checked_in', checkedInAt: at }; }
    await route.fulfill({ status: result.ok ? 200 : 409, contentType: 'application/json', body: JSON.stringify(result) });
  });
  await context.addInitScript(() => {
    // Keep an actual video stream so qr-scanner exercises its real decoder.
    const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
    const ctx = canvas.getContext('2d'); let qr = null;
    window.setAttendanceQr = (src) => { qr = null; if (src) { const image = new Image(); image.onload = () => { qr = image; }; image.src = src; } };
    setInterval(() => { ctx.fillStyle = 'white'; ctx.fillRect(0, 0, 800, 600); if (qr) ctx.drawImage(qr, 230, 130, 340, 340); }, 60);
    Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async () => canvas.captureStream(15) });
    Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => [{ kind: 'videoinput', deviceId: 'test-camera', label: 'Test camera' }] });
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`${base}/attendees/${surveyId}/import`);
  await page.getByRole('heading', { name: survey.title }).waitFor();
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([
    ['Họ tên', 'Email', 'Hội trường', 'Gala', 'CME', 'Học hàm học vị', 'Vai trò', 'Chức danh'],
    ['Nguyễn An', 'an@example.test', 'A', 'x', '1', 'BS', 'Báo cáo viên', 'Trưởng khoa'],
    ['Trần Bình', 'binh@example.test', 'B', 'Không', 'Có', 'ThS', 'Đại biểu', 'Bác sĩ'],
    ['Khách lỗi', 'loi@example.test', 'A', '', 'Không', '', '', ''],
  ]), 'Guests');
  await page.locator('input[type=file]').setInputFiles({ name: 'guests.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) });
  await page.getByText('Ghép cột tham dự và CME', { exact: true }).waitFor();
  await page.getByRole('checkbox', { name: 'File có cột Có/Không riêng cho từng buổi' }).check();
  await page.getByLabel('Cột Hội thảo', { exact: true }).selectOption('yes');
  await page.getByLabel('Cột Gala dinner', { exact: true }).selectOption('3');
  await page.getByLabel('Câu hỏi đăng ký CME').selectOption(cme);
  await page.getByLabel('Cột CME trong file').selectOption('4');
  assert.equal(await page.getByRole('button', { name: /^Import \d+ người$/ }).isEnabled(), false);
  await page.getByRole('button', { name: 'Áp dụng ghép cột / đọc lại file' }).click();
  await page.getByRole('button', { name: 'Import 2 người', exact: true }).waitFor();
  assert.equal(await page.getByText('Cả hội thảo và Gala dinner', { exact: true }).isVisible(), true);
  await page.screenshot({ path: path.join(dir, 'import-desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(dir, 'import-mobile.png'), fullPage: true });
  await page.getByRole('button', { name: 'Import 2 người', exact: true }).click();
  await page.getByText('Đã import 2 người vào danh sách.', { exact: true }).waitFor();
  assert.equal(writes, 1); assert.equal(records.length, 2);
  assert.deepEqual(records.map((r) => [r.answers[program], r.answers[cme], r.hall]), [[2, 0, 'A'], [0, 0, 'B']]);

  await page.goto(`${base}/attendees/${surveyId}`);
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Excel', exact: true }).click();
  const download = await downloadPromise;
  const exported = XLSX.read(readFileSync(await download.path()));
  const rows = XLSX.utils.sheet_to_json(exported.Sheets[exported.SheetNames[0]]);
  assert.equal(rows[0]['Hội trường được phân'], 'A');
  assert.equal(rows[0]['Đăng ký cấp CME'], 'Có');
  assert.equal(rows[0]['Quyền tham dự: Gala dinner'], 'Có');
  assert.equal(rows[1]['Quyền tham dự: Gala dinner'], 'Không');

  const scan = async (id, session, hall) => {
    await page.goto(`${base}/scan/${surveyId}?session=${session}&hall=${hall}`);
    await page.getByText('Vui lòng đưa mã QR vào khung').waitFor();
    const qr = await QRCode.toDataURL(`${base}/checkin/${id}`, { width: 340, margin: 3 });
    await page.evaluate((src) => window.setAttendanceQr(src), qr);
  };
  await scan(records[0].id, 'conference', 'B');
  await page.getByRole('heading', { name: 'Chưa thể check-in', exact: true }).waitFor();
  assert.equal(await page.getByText('Đăng ký cấp CME:', { exact: true }).isVisible(), true);
  assert.equal(await page.getByRole('button', { name: '✓ Check-in', exact: true }).count(), 0);
  assert.equal(confirmations, 0);
  await page.screenshot({ path: path.join(dir, 'wrong-hall-mobile.png'), fullPage: true });
  await scan(records[0].id, 'conference', 'A');
  const pending = page.getByRole('heading', { name: 'Xác nhận check-in', exact: true }).locator('..');
  await pending.waitFor();
  assert.deepEqual((await pending.locator('span.text-slate-500').allTextContents()).slice(0, 4), ['Họ và tên:', 'Học hàm học vị:', 'Vai trò:', 'Chức danh:']);
  assert.equal(await pending.getByText('Hội trường được phân:', { exact: true }).count(), 0);
  await page.getByRole('button', { name: '✓ Check-in', exact: true }).click();
  const welcome = page.getByRole('status', { name: 'Check-in thành công', exact: true });
  await welcome.waitFor();
  assert.equal(await welcome.getByRole('heading').textContent(), 'Nguyễn An');
  assert.deepEqual(await welcome.locator('dt').allTextContents(), ['Học hàm học vị: ', 'Vai trò: ', 'Chức danh: ']);
  assert.equal((await welcome.textContent()).includes('🏛'), false);
  assert.equal(confirmations, 1);
  await scan(records[0].id, 'gala', 'B');
  await page.getByRole('button', { name: '✓ Check-in', exact: true }).click();
  await page.waitForTimeout(300);
  assert.equal(confirmations, 2);
  assert.deepEqual(Object.keys(records[0].session_checkins).sort(), ['conference', 'gala']);
  await scan(records[1].id, 'gala', 'B');
  await page.getByRole('heading', { name: 'Chưa thể check-in', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '✓ Check-in', exact: true }).count(), 0);
  assert.equal(confirmations, 2);
  // A real hall-selector field enables the assigned hall, independently of
  // the session's shared venue or the operator's selected hall.
  const hallQuestion = randomUUID();
  questions.push({ id: hallQuestion, text: 'Hội trường đăng ký', type: 'choice', options: ['A', 'B'], is_hall_selector: true, required: false, position: questions.length });
  const extra = { ...records[0], id: randomUUID(), session_checkins: {}, answers: { ...records[0].answers, [hallQuestion]: 0 } };
  records.push(extra);
  await page.setViewportSize({ width: 1366, height: 900 });
  await scan(extra.id, 'gala', 'B');
  await page.getByRole('heading', { name: 'Xác nhận check-in', exact: true }).waitFor();
  assert.equal(await page.getByText('Hội trường được phân:', { exact: true }).count(), 1);
  await page.getByRole('button', { name: '✓ Check-in', exact: true }).click();
  await welcome.waitFor();
  assert.equal(await welcome.getByRole('heading').textContent(), 'Nguyễn An');
  assert.ok((await welcome.textContent()).includes('🏛 A'));
  assert.equal(confirmations, 3);
  assert.deepEqual(errors, []);
  console.log(`Attendance UI passed: XLSX import/export, desktop/mobile, QR rights, wrong hall, independent check-ins. Screenshots: ${dir}`);
})().catch(async (e) => {
  console.error(e); console.error('Browser errors:', errors);
  for (const context of browser?.contexts() ?? []) for (const page of context.pages()) console.error((await page.locator('body').innerText()).slice(-2500));
  process.exitCode = 1;
}).finally(async () => { await browser?.close(); });
