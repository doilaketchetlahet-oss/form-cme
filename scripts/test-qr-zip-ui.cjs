// Start app on port 3109. CHECKIN_TEST_DEPS supplies Playwright if needed.
// PLAYWRIGHT_CHANNEL=msedge is supported. Database APIs are mocked, QR API is real.
// Downloads synthetic ZIPs, checks names/branding, and decodes their actual PNGs.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const JSZip = require('jszip');
const sharp = require('sharp');
const uiRequire = process.env.CHECKIN_TEST_DEPS ? createRequire(path.join(process.env.CHECKIN_TEST_DEPS, 'package.json')) : require;
const { chromium } = uiRequire('playwright');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const base = process.env.EDITOR_E2E_BASE || 'http://localhost:3109';
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const surveyId = randomUUID();
const questions = [
  { id: 'degree', text: 'Học hàm học vị', type: 'text' },
  { id: 'name', text: 'Họ và tên', type: 'text' },
  { id: 'email', text: 'Email', type: 'text' },
  { id: 'phone', text: 'Số điện thoại', type: 'phone' },
].map((q, position) => ({ ...q, options: null, position, is_hall_selector: false }));
const records = [
  { answers: { degree: 'BS', name: 'Nguyễn An' } },
  { answers: { degree: 'BS', name: 'Nguyễn An' } },
  { answers: { degree: 'BS', email: 'full.address@example.test' } },
  { answers: { degree: 'BS', phone: '0900123456' } },
  { answers: { degree: 'BS' } },
  { answers: {} },
].map((row, index) => ({ ...row, id: randomUUID(), survey_id: surveyId, submitted_at: new Date(Date.UTC(2026, 9, 23, 0, 0, 10 - index)).toISOString(), checked_in: false, payment_status: 'not_required' }));
const plain = { darkColor: '#000000', accentColor: '#000000', lightColor: '#ffffff', logoEnabled: false, moduleRadius: 0 };
const branded = { darkColor: '#0369a1', accentColor: '#0891b2', lightColor: '#f8fdff', logoEnabled: true, logoUrl: '/logo_qr.png', logoSize: 16, moduleRadius: 32 };
let browser;

async function run(viewport) {
  let savedBranding = branded, failRead = false, downloadCount = 0;
  const qrRequests = [], errors = [];
  const context = await browser.newContext({ viewport, acceptDownloads: true });
  try {
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.host === host) {
        let body = [];
        if (url.pathname.endsWith('/surveys')) {
          if (failRead) return route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ message: 'fixture read failed' }) });
          body = { id: surveyId, title: 'QR ZIP test', checkin_pin: '', checkin_theme: { qr: savedBranding } };
        }
        if (url.pathname.endsWith('/survey_questions')) body = questions;
        if (url.pathname.endsWith('/survey_responses')) body = records;
        assert.equal(request.method(), 'GET', 'No database writes allowed in this test');
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
      }
      if (url.pathname.endsWith('/qr-scanner-worker.min.js')) return route.fulfill({ contentType: 'text/javascript', body: readFileSync(path.join(__dirname, '../node_modules/qr-scanner/qr-scanner-worker.min.js')) });
      if (url.pathname === '/api/qr') { qrRequests.push(url); return route.continue(); }
      if (url.origin === new URL(base).origin && !url.pathname.startsWith('/api/')) return route.continue();
      return route.abort();
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('download', () => downloadCount++);
    await page.goto(`${base}/attendees/${surveyId}`);
    await page.getByRole('heading', { name: 'QR ZIP test' }).waitFor();
    await page.getByRole('checkbox').nth(records.length - 1).waitFor();
    await page.addScriptTag({ path: path.join(__dirname, '../node_modules/qr-scanner/qr-scanner.umd.min.js') });
    const exportZip = async (branding) => {
      savedBranding = branding; // The dashboard retains its initial stale style.
      const firstRequest = qrRequests.length;
      const waitDownload = page.waitForEvent('download');
      await page.getByRole('button', { name: /^QR ZIP/ }).click();
      const download = await waitDownload;
      const zip = await JSZip.loadAsync(readFileSync(await download.path()));
      const files = Object.keys(zip.files).filter((name) => !zip.files[name].dir);
      return { zip, files, requests: qrRequests.slice(firstRequest) };
    };
    const expectedNames = ['Nguyễn An.png', 'Nguyễn An_2.png', 'full.address@example.test.png', '0900123456.png', 'BS.png', `${records[5].id}.png`];
    const verify = async (result, branding, expectedRows = records, expectedFiles = expectedNames) => {
      assert.deepEqual(result.files, expectedFiles);
      assert.equal(result.requests.length, expectedRows.length);
      for (let index = 0; index < expectedRows.length; index++) {
        const url = result.requests[index];
        assert.equal(url.searchParams.get('format'), 'png');
        assert.equal(url.searchParams.get('logo'), branding.logoEnabled ? '1' : '0');
        assert.equal(url.searchParams.get('dark'), branding.darkColor);
        assert.equal(url.searchParams.get('radius'), String(branding.moduleRadius));
        const expected = url.searchParams.get('data');
        assert.equal(new URL(expected).pathname, `/checkin/${expectedRows[index].id}`);
        const png = await result.zip.file(expectedFiles[index]).async('nodebuffer');
        const direct = await page.request.get(url.href);
        assert.ok(direct.ok());
        assert.deepEqual(png, await direct.body(), 'ZIP must contain the shared renderer output without a hardcoded logo overlay');
        if (!branding.logoEnabled && branding.darkColor === '#000000') {
          const pixels = await sharp(png).removeAlpha().raw().toBuffer();
          for (let pixel = 0; pixel < pixels.length; pixel += 3) {
            assert.equal(pixels[pixel], pixels[pixel + 1]); assert.equal(pixels[pixel], pixels[pixel + 2]);
          }
        }
        // Match the app camera's 400px scan region when decoding a retina PNG.
        const decoded = await page.evaluate(async (src) => {
          const image = new Image(); image.src = src; await image.decode();
          return (await QrScanner.scanImage(image, { returnDetailedScanResult: true, scanRegion: {
            x: 0, y: 0, width: image.naturalWidth, height: image.naturalHeight, downScaledWidth: 400, downScaledHeight: 400,
          } })).data;
        }, `data:image/png;base64,${png.toString('base64')}`);
        assert.equal(decoded, expected);
      }
    };
    await verify(await exportZip(plain), plain);
    // Custom colors and enabled logo use the same pipeline too.
    await verify(await exportZip(branded), branded);
    await page.getByRole('checkbox').first().check();
    await verify(await exportZip(plain), plain, [records[0]], ['Nguyễn An.png']);
    const beforeFailure = qrRequests.length;
    failRead = true;
    await page.getByRole('button', { name: /^QR ZIP/ }).click();
    await page.getByText('Không đọc được branding hoặc các trường của form. Vui lòng thử lại.', { exact: true }).waitFor();
    assert.equal(downloadCount, 3);
    assert.equal(qrRequests.length, beforeFailure);
    assert.deepEqual(errors, []);
    console.log(`${viewport.width}px: ZIP follows latest branding/logo, uses name/email/phone fallbacks without overwrites, selected-only export, exact PNG/decode and read-error handling passed.`);
  } finally { await context.close(); }
}

(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  await run({ width: 1440, height: 1000 });
  await run({ width: 390, height: 844 });
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
