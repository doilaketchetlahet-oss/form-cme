// Run a production server on 3115. HOME_UI_DEPS supplies playwright-core and
// @axe-core/playwright; HOME_UI_OUTPUT optionally selects screenshot output.
// All external requests are blocked. No registration, email or database writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createRequire } = require('node:module');
const depRequire = process.env.HOME_UI_DEPS
  ? createRequire(path.join(process.env.HOME_UI_DEPS, 'package.json')) : require;
const { chromium } = depRequire('playwright-core');
const { default: AxeBuilder } = depRequire('@axe-core/playwright');
const base = process.env.HOME_UI_BASE || 'http://127.0.0.1:3115';
const out = process.env.HOME_UI_OUTPUT || path.join(os.tmpdir(), 'form-cme-home-ui');
fs.mkdirSync(out, { recursive: true });
const views = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'laptop', width: 1366, height: 768 },
  { name: 'short-laptop', width: 1280, height: 600 },
  { name: 'phone', width: 390, height: 844 },
  { name: 'compact', width: 360, height: 640 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'reduced', width: 1440, height: 900, reduced: true },
  { name: 'reduced-phone', width: 390, height: 844, reduced: true },
  { name: 'reduced-compact', width: 360, height: 640, reduced: true },
];

(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const report = [];
  try {
    for (const view of views.filter((view) => !process.env.HOME_UI_VIEWS || process.env.HOME_UI_VIEWS.split(',').includes(view.name))) {
      const context = await browser.newContext({ viewport: view, reducedMotion: view.reduced ? 'reduce' : 'no-preference' });
      try {
        await context.addInitScript(() => {
          Element.prototype.requestPointerLock = () => Promise.reject(new Error('Native pointer lock disabled in UI verification'));
          Element.prototype.setPointerCapture = () => {};
          Element.prototype.releasePointerCapture = () => {};
          Document.prototype.exitPointerLock = () => {};
        });
        const writes = [], external = [], errors = [];
        await context.route('**/*', (route) => {
          const request = route.request();
          if (new URL(request.url()).origin !== new URL(base).origin) { external.push(request.url()); return route.abort(); }
          if (!['GET', 'HEAD'].includes(request.method())) { writes.push(request.url()); return route.abort(); }
          return route.continue();
        });
        const page = await context.newPage();
        page.on('pageerror', (error) => errors.push(error.message));
        page.on('console', (message) => {
          if (message.type() === 'error' && /hydrat|server rendered|Minified React error/i.test(message.text())) errors.push(message.text());
        });
        await page.goto(base, { waitUntil: 'networkidle' });
        await page.evaluate(() => document.fonts.ready);
        await page.waitForFunction(() => Boolean(window.ScrollCraft));
        await page.screenshot({ path: path.join(out, `${view.name}-opening.png`) });
        assert.equal(await page.locator('h1').count(), 1);
        assert.equal(await page.getByRole('link', { name: 'Bắt đầu ngay', exact: true }).first().getAttribute('href'), '/signup');
        const heroButton = await page.getByRole('link', { name: 'Bắt đầu ngay', exact: true }).nth(1).boundingBox();
        assert.ok(heroButton.y + heroButton.height <= view.height, `${view.name}: hero CTA visible without scrolling`);

        if (view.width < 1000) {
          await page.getByRole('button', { name: 'Mở menu' }).click();
          assert.equal(await page.getByRole('button', { name: 'Đóng menu' }).getAttribute('aria-expanded'), 'true');
          await page.keyboard.press('Escape');
          assert.equal(await page.getByRole('button', { name: 'Mở menu' }).getAttribute('aria-expanded'), 'false');
          assert.ok(await page.getByRole('button', { name: 'Mở menu' }).evaluate((el) => el === document.activeElement));
        }

        const journey = page.locator('#how');
        await journey.scrollIntoViewIfNeeded();
        await page.getByRole('button', { name: /^Đăng ký/ }).click();
        await page.getByLabel('Tên khách minh họa').fill('Trần Ánh Dương');
        await page.getByRole('button', { name: 'Xem thư mời' }).click();
        await page.waitForTimeout(view.reduced ? 100 : 2100);
        assert.equal(await page.locator('#journey-preview').getAttribute('data-stage'), '1');
        assert.ok(await page.locator('#journey-preview').innerText().then((text) => text.includes('Trần Ánh Dương')));
        const invitationSlot = await page.locator('[data-qr-destination="invitation"]').boundingBox();
        const invitationQr = await page.locator('[data-qr-flight]').boundingBox();
        assert.ok(Math.abs(invitationSlot.x - invitationQr.x) < 2 && Math.abs(invitationSlot.y - invitationQr.y) < 2, 'QR docks inside the actual invitation slot');
        assert.ok(Math.abs(invitationSlot.width - invitationQr.width) < 2, 'QR fits the printed empty square');
        assert.ok(await page.locator('#journey-preview img[src*="conference-invitation"]').count(), 'Uses the supplied invitation');
        await page.locator('#journey-preview').screenshot({ path: path.join(out, `${view.name}-invitation.png`) });
        await page.getByRole('button', { name: 'Mở trên điện thoại' }).click();
        await page.waitForTimeout(view.reduced ? 100 : 2100);
        assert.equal(await page.locator('#journey-preview').getAttribute('data-stage'), '2');
        const phoneSlot = await page.locator('[data-qr-destination="phone-invitation"]').boundingBox();
        const phoneQr = await page.locator('[data-qr-flight]').boundingBox();
        assert.ok(Math.abs(phoneSlot.x - phoneQr.x) < 2 && Math.abs(phoneSlot.y - phoneQr.y) < 2, 'QR stays on the invitation inside the phone');
        await page.locator('#journey-preview').screenshot({ path: path.join(out, `${view.name}-phone.png`) });
        await page.getByRole('button', { name: 'Thử bước check-in' }).click();
        await page.waitForTimeout(view.reduced ? 100 : 450);
        await page.locator('#journey-preview').screenshot({ path: path.join(out, `${view.name}-scan-flight.png`) });
        await page.waitForTimeout(3300);
        assert.equal(await page.locator('#journey-preview').getAttribute('data-stage'), '3');
        assert.ok(await page.getByText('Chào Trần Ánh Dương!', { exact: true }).isVisible());
        const scannerSlot = await page.locator('[data-qr-destination="phone-scan"]').boundingBox();
        const scannerQr = await page.locator('[data-qr-flight]').boundingBox();
        assert.ok(Math.abs(scannerSlot.x - scannerQr.x) < 2 && Math.abs(scannerSlot.y - scannerQr.y) < 2, 'QR stays inside the phone during scanning');
        await page.locator('#journey-preview').screenshot({ path: path.join(out, `${view.name}-checkin.png`) });
        await page.getByRole('button', { name: 'Thử lại hành trình' }).click();
        assert.equal(await page.getByLabel('Tên khách minh họa').inputValue(), 'Trần Ánh Dương');

        {
          await page.getByLabel('Tên khách minh họa').blur();
          const bounds = await page.locator('[data-journey-track]').evaluate((el) => { const top = el.getBoundingClientRect().top + scrollY; return { top: top - innerHeight * .15, travel: el.offsetHeight - innerHeight * .85 }; });
          for (const [fraction, expected] of [[.125, '0'], [.375, '1'], [.625, '2'], [.875, '3']]) {
            const targetY = bounds.top + bounds.travel * fraction;
            await page.mouse.wheel(0, targetY - await page.evaluate(() => scrollY));
            await page.waitForTimeout(expected === '3' ? 3400 : 1500);
            assert.equal(await page.locator('#journey-preview').getAttribute('data-stage'), expected, 'Scroll advances QR journey at every screen size');
            const box = await page.locator('#journey-preview').boundingBox();
            assert.ok(box.y >= 64 && box.y + box.height <= view.height + 2, 'Entire animated preview stays inside the viewport');
            await page.screenshot({ path: path.join(out, `${view.name}-scroll-${expected}.png`) });
          }
        }

        await page.locator('#features').scrollIntoViewIfNeeded();
        await page.waitForTimeout(550);
        const axe = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa', 'wcag21aa']).analyze();
        fs.writeFileSync(path.join(out, `${view.name}-axe.json`), JSON.stringify(axe.violations, null, 2));
        await page.screenshot({ path: path.join(out, `${view.name}-tools.png`) });
        await page.locator('#games').scrollIntoViewIfNeeded();
        const rail = page.locator('[aria-label="Game nổi bật"]');
        const before = await rail.evaluate((el) => el.scrollLeft);
        await page.getByRole('button', { name: 'Xem game tiếp theo' }).click();
        await page.waitForTimeout(700);
        assert.ok(await rail.evaluate((el) => el.scrollLeft) > before, 'Gallery navigation moves');
        await rail.getByRole('link').last().focus();
        await page.keyboard.press('Tab');
        await page.screenshot({ path: path.join(out, `${view.name}-games.png`) });
        await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
        await page.screenshot({ path: path.join(out, `${view.name}-close.png`) });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > innerWidth);
        assert.equal(overflow, false, `${view.name}: no horizontal page overflow`);
        const brokenImages = await page.locator('img').evaluateAll((images) => images.filter((img) => !img.complete || !img.naturalWidth).map((img) => img.src));
        assert.deepEqual(brokenImages, []);
        assert.deepEqual(errors, []);
        assert.deepEqual(writes, []);
        assert.deepEqual(external, []);
        assert.deepEqual(axe.violations.map((violation) => ({ id: violation.id, nodes: violation.nodes.map((node) => node.target) })), [], `${view.name}: accessibility`);
        report.push({ viewport: view.name, status: 'passed', accessibility: axe.violations.length });
        console.log(`${view.name}: passed`);
      } catch (error) {
        report.push({ viewport: view.name, status: 'failed', error: error.message });
        await context.pages()[0]?.screenshot({ path: path.join(out, `${view.name}-failure.png`) }).catch(() => undefined);
        console.error(`${view.name}: ${error.stack}`);
      } finally { await context.close(); }
    }

    // Static fallback keeps reading and navigation intact when JavaScript is disabled.
    const staticContext = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const staticPage = await staticContext.newPage();
    await staticPage.goto(base);
    assert.ok(await staticPage.getByRole('heading', { level: 1 }).isVisible());
    assert.equal(await staticPage.locator('form').count(), 0);
    await staticPage.screenshot({ path: path.join(out, 'no-js.png'), fullPage: true });
    await staticContext.close();
    fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(report, null, 2));
    console.log(`Screenshots and report: ${out}`);
    assert.ok(report.every((item) => item.status === 'passed'), 'All viewport checks must pass');
  } finally { await browser.close(); }
})().catch((error) => { console.error(error); process.exitCode = 1; });
