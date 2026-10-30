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
  { name: 'phone', width: 390, height: 844 },
  { name: 'compact', width: 360, height: 640 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'landscape', width: 844, height: 390 },
  { name: 'reduced', width: 1440, height: 900, reduced: true },
];

(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  const report = [];
  try {
    for (const view of views) {
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
        await page.waitForTimeout(750);
        assert.equal(await page.locator('#journey-preview').getAttribute('data-stage'), '1');
        assert.ok(await page.locator('#journey-preview').innerText().then((text) => text.includes('Trần Ánh Dương')));
        const invitationQr = await page.locator('#journey-preview img').evaluate((el) => el.parentElement.style.transform);
        assert.ok(view.reduced || /translateX\(34px\)/.test(invitationQr), 'QR enters invitation');
        await page.locator('#journey-preview').screenshot({ path: path.join(out, `${view.name}-invitation.png`) });
        await page.getByRole('button', { name: 'Thử bước check-in' }).click();
        await page.waitForTimeout(750);
        assert.equal(await page.locator('#journey-preview').getAttribute('data-stage'), '2');
        assert.ok(await page.getByText('Chào Trần Ánh Dương!', { exact: true }).isVisible());
        await page.locator('#journey-preview').screenshot({ path: path.join(out, `${view.name}-checkin.png`) });
        await page.getByRole('button', { name: 'Thử lại hành trình' }).click();
        assert.equal(await page.getByLabel('Tên khách minh họa').inputValue(), 'Trần Ánh Dương');

        if (view.width >= 1000 && view.height >= 760 && !view.reduced) {
          const bounds = await journey.evaluate((el) => ({ top: el.offsetTop, travel: el.offsetHeight - innerHeight }));
          for (const [fraction, expected] of [[.15, '0'], [.5, '1'], [.9, '2']]) {
            await page.evaluate((y) => scrollTo(0, y), bounds.top + bounds.travel * fraction);
            await page.waitForTimeout(800);
            assert.equal(await page.locator('#journey-preview').getAttribute('data-stage'), expected, 'Scroll advances QR journey');
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
        console.error(`${view.name}: ${error.message}`);
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
