// Requires npm run start -- --port 3001 and Playwright. Set MAIL_MERGE_UI_DEPS
// to a temporary package directory with playwright if it is not installed locally.
// Tests actual UI with fake auth/API boundaries; never sends a real email.
const assert = require('node:assert/strict');
const { mkdtempSync, mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const uiRequire = process.env.MAIL_MERGE_UI_DEPS ? createRequire(path.join(process.env.MAIL_MERGE_UI_DEPS, 'package.json')) : require;
const { chromium } = uiRequire('playwright');
const XLSX = require('xlsx');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const base = process.env.MAIL_MERGE_E2E_BASE || 'http://localhost:3001';
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const ref = host.split('.')[0];
const user = { id: randomUUID(), email: 'admin@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {}, created_at: new Date().toISOString() };
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600, role: 'authenticated' })).toString('base64url')}.test-only`;
const session = { access_token: token, refresh_token: 'test-only', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now()/1000)+3600, user };
const shots = path.join(tmpdir(), 'form-cme-mail-merge-ui'); mkdirSync(shots, { recursive: true });
const fixtureDirectory = mkdtempSync(path.join(tmpdir(), 'form-cme-merge-input-'));
const spreadsheet = path.join(fixtureDirectory, 'test-list.xlsx');
const workbook = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Email','Họ tên','Trường','Mã'], ['an@example.test','Nguyễn An','Đại học A','0012'], ['binh@example.test','Trần Bình','Đại học B','0013'], ['an@example.test','Trùng','C','0014'], ['invalid','Sai','D','0015']]), 'Danh sách');
XLSX.writeFile(workbook, spreadsheet);
let browser;
(async () => {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.addInitScript(({ ref, session }) => { if (window.top === window) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)); }, { ref, session });
  await context.route(`https://${host}/**`, async (route) => {
    const url = route.request().url();
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(url.includes('/admin_members') ? { role: 'owner', active: true } : url.includes('/auth/') ? user : []) });
  });
  let saved = null, outgoingTests = 0, outgoingCampaign = 0;
  await context.route('**/api/admin/mail-merge**', async (route) => {
    const request = route.request();
    let result;
    if (request.method() === 'GET') result = new URL(request.url()).searchParams.has('id') ? { ok: true, campaign: saved } : { ok: true, campaigns: saved ? [saved] : [] };
    else {
      const body = request.postDataJSON();
      if (body.action === 'test') outgoingTests++;
      if (body.action === 'save') {
        const { password, ...smtp_public } = body.smtp;
        assert.equal(password, 'fake-app-password');
        saved = { id: body.id, name: body.name, template: body.template, smtp_public, status: 'draft', hasPassword: true, created_at: new Date().toISOString(), recipients: body.rows.map((row, index) => ({ ...row, id: randomUUID(), email: row.fields[body.template.emailColumn], status: index > 1 ? 'skipped' : 'pending', last_error: index > 1 ? 'Dòng cần kiểm tra' : null })) };
      }
      result = { ok: true, id: saved?.id };
      if (body.action === 'start') saved.status = 'running';
      if (body.action === 'pause') saved.status = 'paused';
      if (body.action === 'process') {
        const row = saved.recipients.find((row) => row.status === 'pending');
        if (saved.status === 'running' && row) {
          outgoingCampaign++;
          row.status = 'sent';
          result = { ok: true, processed: true, recipientId: row.id, status: 'sent' };
        } else {
          if (saved.status === 'running' && !row) saved.status = 'completed';
          result = { ok: true, processed: false };
        }
      }
    }
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(result) });
  });
  const page = await context.newPage(), errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(base + '/admin/tools/mail-merge');
  await page.getByRole('heading', { name: 'Gửi mail theo trường', exact: true }).waitFor();
  await page.locator('input[type=file]').setInputFiles(spreadsheet);
  await page.getByRole('button', { name: 'Họ tên {{ho_ten}}', exact: true }).waitFor();
  assert.ok(await page.getByText('Chờ gửi: 2', { exact: true }).isVisible());
  assert.ok(await page.getByText('Bỏ qua: 2', { exact: true }).isVisible());
  const subject = page.getByLabel('Tiêu đề thư', { exact: true });
  await subject.fill('Xin chào '); await subject.press('End');
  await page.getByRole('button', { name: 'Họ tên {{ho_ten}}', exact: true }).click();
  assert.equal(await subject.inputValue(), 'Xin chào {{ho_ten}}');
  const body = page.getByLabel('Nội dung khối 1');
  await body.fill('Trường: '); await body.press('End');
  assert.equal(await body.inputValue(), 'Trường: ');
  await page.getByRole('button', { name: 'Trường {{truong}}', exact: true }).click();
  assert.equal(await body.inputValue(), 'Trường: {{truong}}');
  await page.getByLabel('Người nhận xem trước').selectOption('1');
  await page.frameLocator('iframe[title="Xem trước thư cá nhân hóa"]').getByText('Trường: Đại học B', { exact: true }).waitFor();
  assert.ok(await page.getByText('Xin chào Trần Bình', { exact: true }).isVisible());
  await page.getByLabel('Máy chủ SMTP').fill('smtp.example.test');
  await page.getByLabel('Tài khoản đăng nhập').fill('admin@example.test');
  await page.getByLabel('Mật khẩu / mật khẩu ứng dụng', { exact: true }).fill('fake-app-password');
  await page.getByLabel('Địa chỉ Email gửi').fill('sender@example.test');
  await page.getByRole('button', { name: 'Kiểm tra SMTP', exact: true }).click();
  await page.getByLabel('Email nhận thư thử', { exact: true }).fill('qa@example.test');
  await page.getByRole('button', { name: 'Gửi thử dòng đang xem', exact: true }).click();
  await page.getByRole('button', { name: 'Lưu chiến dịch', exact: true }).click();
  await page.getByRole('button', { name: 'Gửi / tiếp tục', exact: true }).waitFor();
  assert.equal(saved.template.subject, 'Xin chào {{ho_ten}}');
  assert.equal(saved.template.blocks[0].text, 'Trường: {{truong}}');
  assert.equal(saved.recipients[0].fields.ma, '0012');
  assert.equal(outgoingTests, 1);
  assert.equal(await page.locator('input[type=password]').inputValue(), '');
  await page.getByRole('button', { name: 'Gửi / tiếp tục', exact: true }).click();
  await page.getByRole('button', { name: 'Bắt đầu gửi', exact: true }).click();
  await page.getByText('SMTP đã nhận: 1', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
  await page.getByRole('button', { name: 'Gửi / tiếp tục', exact: true }).waitFor();
  assert.equal(saved.status, 'paused');
  await page.getByRole('button', { name: 'Gửi / tiếp tục', exact: true }).click();
  await page.getByRole('button', { name: 'Bắt đầu gửi', exact: true }).click();
  await page.getByText('SMTP đã nhận: 2', { exact: true }).waitFor();
  await page.getByRole('button', { name: 'Gửi / tiếp tục', exact: true }).waitFor();
  assert.equal(saved.status, 'completed');
  assert.equal(outgoingCampaign, 2);
  await page.screenshot({ path: path.join(shots, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByLabel('Người nhận xem trước').selectOption('0');
  await page.screenshot({ path: path.join(shots, 'mobile.png'), fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);
  assert.deepEqual(errors, []);
  console.log('PASS: real XLSX import, duplicate/invalid rows, cursor insertion, personalized preview, SMTP form, test/save/pause/resume flow and mobile layout (all sending mocked).');
})().catch((error) => { console.error(error); process.exitCode=1; }).finally(async () => { await browser?.close(); });
