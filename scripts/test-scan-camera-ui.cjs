// Start on port 3107; CHECKIN_TEST_DEPS supplies Playwright (optional PLAYWRIGHT_CHANNEL=msedge).
// Real qr-scanner + real QR decoding through synthetic camera streams. All APIs mocked.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const { mkdtempSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const uiRequire = process.env.CHECKIN_TEST_DEPS ? createRequire(path.join(process.env.CHECKIN_TEST_DEPS, 'package.json')) : require;
const { chromium } = uiRequire('playwright');
const QRCode = require('qrcode');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const base = process.env.ATTENDANCE_E2E_BASE || 'http://localhost:3107';
const screenshots = mkdtempSync(path.join(tmpdir(), 'scan-camera-ui-'));
let browser;

async function run(viewport, count = 2, denied = false, fullscreenMode = 'native') {
  const surveyId = randomUUID(), responseId = randomUUID();
  const errors = [], writes = [];
  const context = await browser.newContext({ viewport });
  try {
    await context.routeWebSocket('**/*', (socket) => socket.close());
    await context.route('**/*', async (route) => {
      const request = route.request(), url = new URL(request.url());
      if (url.host === host) {
        if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.method()); return route.abort(); }
        let body = [];
        if (url.pathname.endsWith('/surveys')) body = { id: surveyId, title: 'Kiểm tra đổi camera', checkin_pin: '', checkin_theme: {} };
        if (url.pathname.endsWith('/survey_questions')) body = [{ id: 'name', text: 'Họ và tên', type: 'text', position: 0 }];
        if (url.pathname.endsWith('/survey_responses') && url.searchParams.has('id')) body = {
          id: responseId, survey_id: surveyId, answers: { name: 'Nguyễn Kiểm Thử' }, checked_in: false,
        };
        return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '0-0/0' }, body: JSON.stringify(body) });
      }
      if (url.origin === new URL(base).origin && !url.pathname.startsWith('/api/')) return route.continue();
      return route.abort();
    });
    await context.addInitScript(({ count, denied, fullscreenMode }) => {
      if (fullscreenMode !== 'native') {
        Object.defineProperty(HTMLElement.prototype, 'requestFullscreen', { configurable: true,
          value: fullscreenMode === 'missing' ? undefined : async () => { throw new DOMException('Mock fullscreen rejection', 'NotAllowedError'); } });
        Object.defineProperty(HTMLElement.prototype, 'webkitRequestFullscreen', { configurable: true, value: undefined });
      }
      const devices = [
        { deviceId: 'back-camera', kind: 'videoinput', label: 'Back Camera', facing: 'environment' },
        { deviceId: 'front-camera', kind: 'videoinput', label: 'Front Camera', facing: 'user' },
        { deviceId: 'usb-camera', kind: 'videoinput', label: 'USB Camera', facing: '' },
      ].slice(0, count);
      const test = window.cameraTest = { calls: [], streams: [], maxLive: 0, denied, fail: '', delay: 0, qr: {}, devices };
      window.setCameraQr = (id, src) => new Promise((resolve) => {
        if (!src) { delete test.qr[id]; resolve(); return; }
        const image = new Image(); image.onload = () => { test.qr[id] = image; resolve(); }; image.src = src;
      });
      Object.defineProperty(navigator.mediaDevices, 'enumerateDevices', { value: async () => devices });
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', { value: async (constraints) => {
        const requested = constraints.video?.deviceId?.exact;
        // Deliberately ignore facingMode to reproduce phones that keep the old camera.
        const id = requested || devices[0].deviceId;
        test.calls.push({ requested, id });
        if (test.denied) throw new DOMException('Mock permission denial', 'NotAllowedError');
        if (test.delay) await new Promise((resolve) => setTimeout(resolve, test.delay));
        if (id === test.fail || !devices.some((device) => device.deviceId === id)) throw new DOMException('Mock busy camera', 'NotReadableError');
        const device = devices.find((item) => item.deviceId === id);
        const canvas = document.createElement('canvas'); canvas.width = 800; canvas.height = 600;
        const ctx = canvas.getContext('2d');
        const paint = () => {
          ctx.fillStyle = id === 'front-camera' ? '#dbeafe' : '#dcfce7'; ctx.fillRect(0, 0, 800, 600);
          ctx.fillStyle = '#0f172a'; ctx.font = '32px sans-serif'; ctx.fillText(device.label, 24, 50);
          if (test.qr[id]) ctx.drawImage(test.qr[id], 230, 130, 340, 340);
        };
        paint();
        const timer = setInterval(paint, 60), stream = canvas.captureStream(15), track = stream.getVideoTracks()[0];
        const stop = track.stop.bind(track), settings = track.getSettings.bind(track);
        Object.defineProperty(track, 'label', { value: device.label });
        track.getSettings = () => ({ ...settings(), deviceId: id, facingMode: device.facing });
        track.stop = () => { clearInterval(timer); stop(); };
        test.streams.push({ id, track });
        test.maxLive = Math.max(test.maxLive, test.streams.filter((item) => item.track.readyState === 'live').length);
        return stream;
      } });
    }, { count, denied, fullscreenMode });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(`${base}/attendees/${surveyId}`);
    const scanLink = page.getByRole('link', { name: 'Scan', exact: true });
    // Exercise a client navigation so Back can verify the hook's unmount cleanup
    // in the same document, rather than relying on the browser closing a page.
    await scanLink.evaluate((link) => link.removeAttribute('target'));
    await scanLink.click();
    await page.waitForURL(`**/scan/${surveyId}`);
    const selector = page.getByLabel('Camera đang dùng', { exact: true });
    const switcher = page.getByRole('button', { name: 'Đổi trước/sau', exact: true });
    const cameraAlert = page.getByRole('alert').filter({ has: page.getByRole('button', { name: 'Thử lại camera', exact: true }) });
    const waitCamera = async (id) => {
      await page.waitForFunction((value) => {
        const video = document.querySelector('video');
        return video?.srcObject?.getVideoTracks()[0]?.getSettings().deviceId === value && video.readyState >= 2;
      }, id);
      await page.waitForFunction(() => !document.querySelector('select[disabled]'));
      assert.equal(await selector.inputValue(), id);
      assert.ok(await page.evaluate(() => window.cameraTest.streams.filter((item) => item.track.readyState === 'live').length <= 1), 'Release the old camera before opening the next');
      assert.ok(await page.evaluate(() => window.cameraTest.maxLive <= 1), 'Never hold two camera devices at once');
    };
    if (denied) {
      await cameraAlert.waitFor();
      await page.evaluate(() => { window.cameraTest.denied = false; });
      await page.getByRole('button', { name: 'Thử lại camera', exact: true }).click();
      await waitCamera('back-camera');
      await cameraAlert.waitFor({ state: 'hidden' });
    } else await waitCamera('back-camera');

    const scanRoot = page.locator('[data-scan-root]');
    const enterFullscreen = () => page.getByRole('button', { name: 'Toàn màn hình', exact: true });
    const exitFullscreen = () => page.getByRole('button', { name: 'Thoát toàn màn hình', exact: true });
    const originalWidth = (await page.locator('.scan-camera-preview').boundingBox()).width;
    const callsBeforeFullscreen = await page.evaluate(() => window.cameraTest.calls.length);
    await enterFullscreen().click();
    await page.waitForFunction(() => document.querySelector('[data-scan-root]')?.dataset.scanExpanded === 'true');
    if (fullscreenMode === 'native') assert.equal(await page.evaluate(() => document.fullscreenElement?.hasAttribute('data-scan-root')), true);
    assert.equal(await page.locator('header').isVisible(), false, 'Fullscreen gives the scanner the header space');
    assert.equal(await exitFullscreen().getAttribute('aria-pressed'), 'true');
    assert.equal(await page.evaluate(() => window.cameraTest.calls.length), callsBeforeFullscreen, 'Fullscreen preserves the camera stream');
    if (viewport.width > 1000) assert.ok((await page.locator('.scan-camera-preview').boundingBox()).width > originalWidth, 'Fullscreen enlarges the camera preview');
    await page.keyboard.press('Escape');
    await page.waitForFunction(() => document.querySelector('[data-scan-root]')?.dataset.scanExpanded === 'false');
    await enterFullscreen().click();
    await page.waitForFunction(() => document.querySelector('[data-scan-root]')?.dataset.scanExpanded === 'true');

    if (count === 1) {
      assert.equal(await switcher.isDisabled(), true);
      await page.getByText('Thiết bị chỉ có một camera.', { exact: true }).waitFor();
    } else {
      const mirror = page.getByRole('button', { name: 'Lật hình', exact: true });
      const calls = await page.evaluate(() => window.cameraTest.calls.length);
      await mirror.click();
      assert.equal(await mirror.getAttribute('aria-pressed'), 'true');
      assert.equal(await page.locator('video').evaluate((video) => video.style.transform), 'scaleX(-1)');
      assert.equal(await page.evaluate(() => window.cameraTest.calls.length), calls, 'Mirroring never changes the physical camera');
      await page.evaluate(() => { window.cameraTest.delay = 200; });
      await switcher.click();
      await page.getByRole('button', { name: 'Đang mở…', exact: true }).waitFor();
      assert.equal(await selector.isDisabled(), true, 'Block overlapping changes');
      await waitCamera('front-camera');
      assert.equal(await page.locator('video').evaluate((video) => video.style.transform), 'scaleX(-1)', 'Mirror choice survives camera changes');
      await page.evaluate(() => { window.cameraTest.delay = 0; });
      await mirror.click();
      await switcher.click();
      await waitCamera('back-camera');
      await selector.selectOption('front-camera');
      await waitCamera('front-camera');
      if (count > 2) {
        await selector.selectOption('usb-camera');
        await waitCamera('usb-camera');
      }
      await selector.selectOption('back-camera');
      await waitCamera('back-camera');
      await page.evaluate(() => { window.cameraTest.fail = 'front-camera'; });
      await switcher.click();
      await cameraAlert.getByText(/Đã giữ camera đang dùng/).waitFor();
      await waitCamera('back-camera');
      await page.evaluate(() => { window.cameraTest.fail = ''; });
      await page.getByRole('button', { name: 'Thử lại camera', exact: true }).click();
      await waitCamera('front-camera');
      await cameraAlert.waitFor({ state: 'hidden' });
    }
    // Decode actual QR pixels after switching, then close without checking anyone in.
    const selectedId = await selector.inputValue();
    const qr = await QRCode.toDataURL(`${base}/checkin/${responseId}`, { width: 340, margin: 3 });
    await page.evaluate(([id, src]) => window.setCameraQr(id, src), [selectedId, qr]);
    await page.getByRole('heading', { name: 'Xác nhận check-in', exact: true }).waitFor();
    await page.getByText('Nguyễn Kiểm Thử', { exact: true }).first().waitFor();
    await page.evaluate((id) => window.setCameraQr(id, ''), selectedId);
    await page.getByRole('button', { name: 'Đóng', exact: true }).click();
    await page.getByRole('heading', { name: 'Xác nhận check-in', exact: true }).waitFor({ state: 'hidden' });
    await waitCamera(selectedId);
    assert.equal(await page.locator('video').evaluate((video) => video.style.transform), 'none', 'Mirror remains independent when scanning resumes');
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    await page.locator('main > div').first().evaluate((card) => { card.scrollTop = 0; });
    if (viewport.height < 500) {
      const bounds = await page.locator('.scan-camera-preview').boundingBox();
      await page.screenshot({ path: path.join(screenshots, 'landscape-bounds.png'), fullPage: true });
      assert.ok(bounds.y >= 0 && bounds.y + bounds.height <= viewport.height, `Landscape keeps the entire camera preview visible beside the controls: ${JSON.stringify(bounds)}, ${await page.evaluate(() => innerHeight)}px. ${screenshots}`);
    }
    await page.screenshot({ path: path.join(screenshots, `fullscreen-${viewport.width}-${viewport.height}-${fullscreenMode}.png`), fullPage: true });
    await exitFullscreen().click();
    await page.waitForFunction(() => document.querySelector('[data-scan-root]')?.dataset.scanExpanded === 'false');
    assert.equal(await page.evaluate(() => document.fullscreenElement), null);
    await page.screenshot({ path: path.join(screenshots, `${viewport.width}-${viewport.height}-${count}-${denied}.png`), fullPage: true });
    await enterFullscreen().click();
    await page.waitForFunction(() => document.querySelector('[data-scan-root]')?.dataset.scanExpanded === 'true');
    const streams = await page.evaluate(() => window.cameraTest.streams.length);
    await page.goBack();
    await page.getByRole('heading', { name: 'Kiểm tra đổi camera', exact: true }).waitFor();
    await page.waitForFunction(() => window.cameraTest.streams.every((item) => item.track.readyState === 'ended'));
    assert.equal(await page.evaluate(() => window.cameraTest.streams.length), streams, 'Cleanup is checked in the original document');
    assert.equal(await page.evaluate(() => document.fullscreenElement), null, 'Leaving Scan exits fullscreen');
    assert.equal(await scanRoot.count(), 0);
    assert.deepEqual(writes, []);
    assert.deepEqual(errors, []);
    console.log(`${viewport.width}x${viewport.height}, ${count} camera(s), permission retry=${denied}, fullscreen=${fullscreenMode}: camera controls, fullscreen/Escape, QR decoding and cleanup passed. ${screenshots}`);
  } finally { await context.close(); }
}

(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  await run({ width: 390, height: 844 });
  await run({ width: 844, height: 390 });
  await run({ width: 1440, height: 1000 }, 3);
  await run({ width: 390, height: 844 }, 1);
  await run({ width: 390, height: 844 }, 2, true);
  await run({ width: 390, height: 844 }, 2, false, 'missing');
  await run({ width: 1440, height: 1000 }, 2, false, 'rejected');
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
