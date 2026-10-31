// Real wheel input on a fresh page, OS motion settings, a focused name field,
// an explicit motion override, persistence and mid-transition pixels.
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const { createRequire } = require('node:module');
const req = process.env.HOME_UI_DEPS ? createRequire(path.join(process.env.HOME_UI_DEPS, 'package.json')) : require;
const { chromium } = req('playwright-core');
const base = process.env.HOME_UI_BASE || 'http://127.0.0.1:3115';
const out = process.env.HOME_UI_OUTPUT || path.join(require('node:os').tmpdir(), 'home-motion-check');
fs.mkdirSync(out, { recursive: true });
(async () => {
  const browser = await chromium.launch({ channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome', headless: true });
  try {
    for (const preference of ['no-preference', 'reduce']) {
      const ctx = await browser.newContext({ viewport: { width: 1366, height: 768 }, reducedMotion: preference });
      const errors = [], forbidden = [];
      await ctx.addInitScript(() => {
        Element.prototype.requestPointerLock = () => Promise.reject(new Error('Disabled during verification'));
        Element.prototype.setPointerCapture = () => {};
        Element.prototype.releasePointerCapture = () => {};
      });
      await ctx.route('**/*', r => {
        const q = r.request();
        if (new URL(q.url()).origin !== new URL(base).origin || !['GET','HEAD'].includes(q.method())) { forbidden.push(q.url()); return r.abort(); }
        return r.continue();
      });
      const page = await ctx.newPage();
      page.on('pageerror', e => errors.push(e.message));
      page.on('console', m => { if(m.type()==='error' && /hydrat|server rendered|Minified React/i.test(m.text())) errors.push(m.text()); });
      await page.goto(base, { waitUntil: 'networkidle' });
      await page.waitForFunction(() => document.querySelector('#how').dataset.motion === (matchMedia('(prefers-reduced-motion: reduce)').matches ? 'reduced' : 'full'));
      const bounds = () => page.locator('[data-journey-track]').evaluate(el => ({ start: el.getBoundingClientRect().top + scrollY - innerHeight*.15, travel: el.offsetHeight - innerHeight*.85 }));
      async function wheelStage(stage) {
        const b = await bounds();
        await page.mouse.move(900, 400);
        await page.mouse.wheel(0, b.start + b.travel * ((stage+.5)/4) - await page.evaluate(() => scrollY));
        await page.waitForFunction(s => document.querySelector('#journey-preview').dataset.stage === String(s), stage);
        await page.waitForTimeout(1500);
        const box = await page.locator('#journey-preview').boundingBox();
        assert.ok(box.y >= 64 && box.y + box.height <= 770, 'Preview stays visible');
      }
      // No step button has been clicked: this is the original user journey.
      for (const stage of [0,1,2,3,2,1,0]) await wheelStage(stage);
      await page.getByLabel('Tên khách minh họa').fill('Khách kiểm tra');
      assert.ok(await page.getByLabel('Tên khách minh họa').evaluate(el => el === document.activeElement));
      await wheelStage(2);
      assert.equal(await page.getByLabel('Tên khách minh họa').inputValue(), 'Khách kiểm tra');
      await page.screenshot({ path:path.join(out, `${preference}-focused-scroll.png`) });
      if (preference === 'reduce') {
        assert.ok(await page.getByText('Hiệu ứng đang giảm theo thiết lập thiết bị.', { exact:false }).isVisible());
        await page.getByRole('button', {name:'Bật chuyển động',exact:true}).click();
        assert.equal(await page.locator('#how').getAttribute('data-motion'), 'full');
        // Verify real transformed frames, not only the stage data attribute.
        await wheelStage(1);
        const b = await bounds();
        await page.mouse.wheel(0, b.start + b.travel*.625 - await page.evaluate(() => scrollY));
        await page.waitForFunction(() => document.querySelector('#journey-preview').dataset.stage === '2');
        await page.waitForTimeout(160);
        const early = await page.locator('[data-phone-layer]').evaluate(el => ({ transform:getComputedStyle(el).transform, opacity:getComputedStyle(el).opacity }));
        await page.locator('#journey-preview').screenshot({path:path.join(out,'override-transition.png')});
        await page.waitForTimeout(1300);
        const late = await page.locator('[data-phone-layer]').evaluate(el => ({ transform:getComputedStyle(el).transform, opacity:getComputedStyle(el).opacity }));
        assert.notDeepEqual(early,late,'Opt-in actually animates despite the OS reduced-motion preference');
        await page.reload({waitUntil:'networkidle'});
        await page.waitForFunction(() => document.querySelector('#how').dataset.motion === 'full');
        assert.equal(await page.getByRole('button',{name:'Tắt chuyển động',exact:true}).getAttribute('aria-pressed'),'true');
        await page.getByRole('button',{name:'Tắt chuyển động',exact:true}).click();
        await wheelStage(3);
        await page.waitForFunction(() => document.querySelector('#journey-preview').dataset.scanned === 'true');
      } else {
        // React to a preference change without requiring a browser reload.
        await page.emulateMedia({reducedMotion:'reduce'});
        await page.waitForFunction(() => document.querySelector('#how').dataset.motion === 'reduced');
        await wheelStage(3);
        await page.emulateMedia({reducedMotion:'no-preference'});
        await page.waitForFunction(() => document.querySelector('#how').dataset.motion === 'full');
      }
      assert.deepEqual(errors, []);
      assert.deepEqual(forbidden, []);
      console.log(`${preference}: fresh-page wheel, reverse scroll, focused input, preference handling passed`);
      await ctx.close();
    }
  } finally { await browser.close(); }
})().catch(e=>{ console.error(e); process.exitCode=1; });
