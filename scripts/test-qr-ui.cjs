// Start app on port 3109. CHECKIN_TEST_DEPS may supply Playwright.
// PLAYWRIGHT_CHANNEL=msedge is supported. Auth, form reads and saves are mocked.
// QR images use the actual API and are decoded by qr-scanner. No emails/DB writes.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const uiRequire = process.env.CHECKIN_TEST_DEPS ? createRequire(path.join(process.env.CHECKIN_TEST_DEPS, 'package.json')) : require;
const { chromium } = uiRequire('playwright');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const base = process.env.EDITOR_E2E_BASE || 'http://localhost:3109';
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const formId = randomUUID();
const user = { id: randomUUID(), email: 'qr-editor@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} };
const expires = Math.floor(Date.now() / 1000) + 3600;
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: expires })).toString('base64url')}.test-only`;
const session = { access_token: token, refresh_token: 'test-only', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
const plain = { darkColor: '#000000', accentColor: '#000000', lightColor: '#ffffff', logoEnabled: false, logoUrl: null, logoSize: 24, moduleRadius: 0 };
let browser;

async function run(viewport) {
  const survey = { id: formId, title: 'QR reset test', form_type: 'registration', checkin_theme: { conferenceName: 'Hội nghị thử nghiệm', qr: { darkColor: '#0369a1', accentColor: '#0891b2', lightColor: '#f8fdff', logoEnabled: true, logoUrl: '/logo_qr.png', moduleRadius: 32, logoSize: 28 } } };
  const questions = [{ id: randomUUID(), survey_id: formId, text: 'Họ và tên', type: 'text', options: null, position: 0, required: true, allow_multiple: false }];
  let saved;
  const context = await browser.newContext({ viewport });
  try {
    await context.addInitScript(({ host, session }) => localStorage.setItem(`sb-${host.split('.')[0]}-auth-token`, JSON.stringify(session)), { host, session });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      let body;
      if (url.host === host) {
        if (url.pathname.endsWith('/admin_members')) body = { role: 'owner', active: true };
        else if (url.pathname.endsWith('/surveys')) body = survey;
        else if (url.pathname.endsWith('/survey_questions')) body = questions;
        else if (url.pathname.endsWith('/user')) body = user;
        else body = [];
      } else if (url.pathname.endsWith('/qr-scanner-worker.min.js')) {
        return route.fulfill({ contentType: 'text/javascript', body: readFileSync(path.join(__dirname, '../node_modules/qr-scanner/qr-scanner-worker.min.js')) });
      } else if (url.pathname === '/api/qr') return route.continue();
      else if (url.pathname === `/api/admin/forms/${formId}/save`) {
        saved = route.request().postDataJSON();
        survey.checkin_theme = saved.checkin_theme;
        body = { ok: true };
      } else if (url.pathname.startsWith('/api/')) body = {};
      else if (url.origin === new URL(base).origin) return route.continue();
      else return route.abort();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', (error) => errors.push(error.message));
    const openBranding = async () => {
      await page.getByRole('button', { name: 'Giao diện', exact: true }).click();
      await page.getByRole('button', { name: /Branding mã QR/ }).click();
    };
    const verifyPlain = async () => {
      assert.equal(await page.getByLabel('Màu chính', { exact: true }).inputValue(), '#000000');
      assert.equal(await page.getByLabel('Màu nhấn', { exact: true }).inputValue(), '#000000');
      assert.equal(await page.getByLabel('Nền QR', { exact: true }).inputValue(), '#ffffff');
      assert.equal(await page.getByLabel('Hiển thị logo ở giữa QR', { exact: true }).isChecked(), false);
      assert.equal(await page.getByLabel(/Độ bo ô QR/).inputValue(), '0');
      const src = new URL(await page.getByAltText('Mã QR check-in', { exact: true }).getAttribute('src'), base);
      assert.equal(src.searchParams.get('logo'), '0');
      assert.equal(src.searchParams.has('logoUrl'), false);
      assert.equal(src.searchParams.get('dark'), '#000000');
      assert.equal(src.searchParams.get('light'), '#ffffff');
      await page.getByAltText('Mã QR check-in', { exact: true }).evaluate((img) => img.decode());
    };
    await page.goto(`${base}/admin/forms/${formId}`);
    await openBranding();
    assert.equal(await page.getByLabel('Hiển thị logo ở giữa QR', { exact: true }).isChecked(), true);
    await page.getByRole('button', { name: 'Khôi phục QR trắng đen', exact: true }).click();
    await verifyPlain();
    await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await page.getByRole('heading', { name: 'Đã lưu thay đổi', exact: true }).waitFor();
    assert.deepEqual(saved.checkin_theme.qr, plain);
    assert.equal(saved.checkin_theme.conferenceName, 'Hội nghị thử nghiệm');
    assert.equal(saved.questions[0].id, questions[0].id);
    await page.reload();
    await openBranding();
    await verifyPlain();

    await page.addScriptTag({ path: path.join(__dirname, '../node_modules/qr-scanner/qr-scanner.umd.min.js') });
    for (const size of [160, 220, 520]) {
      const expected = `https://example.test/checkin/${randomUUID()}`;
      for (const format of ['svg', 'png']) {
        const image = `${base}/api/qr?${new URLSearchParams({ data: expected, size: String(size), format })}`;
        const decoded = await page.evaluate(async (src) => (await QrScanner.scanImage(src, { returnDetailedScanResult: true })).data, image);
        assert.equal(decoded, expected);
      }
    }
    assert.deepEqual(errors, []);
    console.log(`${viewport.width}px: reset preview, saved black/white config, reload and actual SVG/PNG decode at 160/220/520px passed.`);
  } finally { await context.close(); }
}

(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  await run({ width: 1440, height: 1000 });
  await run({ width: 390, height: 844 });
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
