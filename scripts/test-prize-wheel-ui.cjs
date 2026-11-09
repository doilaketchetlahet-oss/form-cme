// Start the app on port 3111. PRIZE_TEST_DEPS supplies Playwright.
// All snapshots/draws are mocked. No registrations, inventory or emails are changed.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { mkdirSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const deps = process.env.PRIZE_TEST_DEPS ? createRequire(path.join(process.env.PRIZE_TEST_DEPS, 'package.json')) : require;
const { chromium } = deps('playwright');
const base = process.env.PRIZE_E2E_BASE || 'http://localhost:3111';
const shots = path.join(tmpdir(), 'form-cme-prize-wheel-ui');
mkdirSync(shots, { recursive: true });

async function run(browser, { count, width, height = 900, motion = 'reduce', images = true, longNames = false, registered = true, paused = false }) {
  const id = `wheel-${count}-${width}-${motion}${longNames ? '-long' : ''}${paused ? '-paused' : ''}${registered ? '' : '-unregistered'}`;
  const campaign = { id, name: 'Vòng quay may mắn', status: paused ? 'paused' : 'active', is_demo: true, accent_color: '#0284c7', banner_url: '', form_fields: [], instructions: 'Đưa mã nhận quà cho nhân viên tại booth.', track_redemption: true };
  const names = ['Bình nước', 'Túi vải', 'Ô cầm tay', 'Bộ quà đặc biệt'];
  const items = Array.from({ length: count }, (_, i) => ({
    id: `gift-${i}`, name: longNames ? `Phần quà dành tặng khách mời tham gia chương trình ${i + 1}` : names[i % 4],
    color: ['#0284c7', '#7c3aed', '#db2777', '#d97706'][i % 4], total: 10, remaining: i === count - 1 && count > 1 ? 0 : 10,
    image_url: images ? `/prize-draw/gifts/${['bottle', 'bag', 'umbrella', 'gift'][i % 4]}.svg` : i % 2 ? '' : 'https://images.example.test/missing.png',
  }));
  const winnerIndex = Math.min(1, count - 1);
  // For 2 prizes the second is sold out; award the first instead.
  const awardedIndex = items[winnerIndex].remaining ? winnerIndex : 0;
  const award = items[awardedIndex];
  let entry = registered ? { id: 'entry', prize_id: null, claim_code: '', redeemed_at: null } : null;
  let spins = 0;
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: motion, hasTouch: width < 600 });
  const errors = [], blockedWrites = [];
  await context.route('**/*', route => {
    const request = route.request(), url = new URL(request.url());
    if (url.pathname === `/api/prize-draw/${id}`) {
      if (request.method() === 'POST') {
        assert.equal(registered, true); assert.equal(paused, false);
        assert.equal(request.postDataJSON().action, 'spin');
        spins++;
        entry = { ...entry, prize_id: award.id, prize_name: award.name, prize_image_url: award.image_url, claim_code: 'SYNTHETIC-CLAIM-CODE', drawn_at: new Date().toISOString() };
      }
      return route.fulfill({ json: request.method() === 'POST' ? { ok: true, entry } : { ok: true, campaign, items, entry } });
    }
    if (!['GET', 'HEAD'].includes(request.method())) { blockedWrites.push(url.pathname); return route.abort(); }
    return url.origin === new URL(base).origin ? route.continue() : route.abort();
  });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  try {
    await page.goto(`${base}/prize-draw/${id}`);
    const wheel = page.getByLabel('Vòng quay quà tặng', { exact: true });
    await wheel.waitFor();
    await page.evaluate(() => Promise.all([...document.images].map(image => image.decode().catch(() => {}))));
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
    if (count <= 6) {
      // Every visible name must clear the center medallion, including at 320px.
      const overlaps = await wheel.evaluate(root => {
        const hub = root.firstElementChild.lastElementChild;
        const bounds = hub.getBoundingClientRect();
        return [...root.querySelectorAll('[data-sold-out]')].flatMap(prize => {
          const label = [...prize.children].find(el => el.textContent && el.tagName === 'SPAN' && !el.querySelector('img,svg') && el.textContent !== 'Hết quà');
          if (!label) return [];
          const box = label.getBoundingClientRect();
          const x = Math.max(box.left - (bounds.x + bounds.width / 2), 0, bounds.x + bounds.width / 2 - box.right);
          const y = Math.max(box.top - (bounds.y + bounds.height / 2), 0, bounds.y + bounds.height / 2 - box.bottom);
          return Math.hypot(x, y) < bounds.width / 2 ? [label.textContent] : [];
        });
      });
      assert.deepEqual(overlaps, [], 'gift names overlap the center');
    }
    const hub = page.getByRole('button', { name: 'Chạm vòng quay để nhận quà' });
    if (!registered) {
      assert.equal(await hub.count(), 0);
      await page.getByRole('link', { name: 'Điền form để nhận lượt quay', exact: true }).waitFor();
    } else if (paused) {
      assert.equal(await hub.isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Quay nhận quà', exact: true }).isDisabled(), true);
    }
    await page.screenshot({ path: path.join(shots, `${id}-${registered ? 'ready' : 'register'}.png`), fullPage: true });
    if (width === 1440) await wheel.screenshot({ path: path.join(shots, `${id}-wheel.png`) });
    if (!registered || paused) {
      assert.equal(spins, 0);
      console.log(`PASS ${id}: layout and ${paused ? 'paused controls' : 'registration required'}`);
      return;
    }
    if (!images) assert.equal(await wheel.locator('img').count(), 0, 'broken images must show the gift fallback');
    await hub.focus();
    await page.keyboard.press('Enter');
    if (motion === 'no-preference') {
      await page.waitForFunction(() => document.querySelector('[aria-label="Vòng quay quà tặng"]').dataset.spinning === 'true');
      assert.equal(await hub.isDisabled(), true);
      assert.equal(await page.getByRole('button', { name: 'Đang quay…', exact: true }).isDisabled(), true);
      await page.waitForFunction(() => document.querySelector('[aria-label="Vòng quay quà tặng"]')?.dataset.landed === 'true');
      assert.equal(await page.getByRole('heading', { name: `Bạn đã trúng ${award.name}!`, exact: true }).count(), 0, 'hold the landed segment before revealing the result');
      const alignment = await wheel.evaluate(root => {
        const disc = root.querySelector('div[aria-hidden="true"]');
        const label = root.querySelector('[data-winner="true"]');
        const angle = el => { const matrix = new DOMMatrixReadOnly(getComputedStyle(el).transform); return Math.atan2(matrix.b, matrix.a) * 180 / Math.PI; };
        return { disc: angle(disc), text: angle(disc) + angle(label) };
      });
      const normalize = value => ((value % 360) + 360) % 360;
      const distance = value => Math.min(normalize(value), 360 - normalize(value));
      assert.ok(distance(alignment.disc + (awardedIndex + .5) * 360 / count) < .1, 'the server-selected segment must align with the pointer');
      assert.ok(distance(alignment.text) < .1, 'labels must remain upright');
      await page.screenshot({ path: path.join(shots, `${id}-landed.png`), fullPage: true });
    }
    await page.getByRole('heading', { name: `Bạn đã trúng ${award.name}!`, exact: true }).waitFor();
    assert.equal(spins, 1);
    await page.screenshot({ path: path.join(shots, `${id}-result.png`), fullPage: true });
    await page.reload();
    await page.getByRole('heading', { name: `Bạn đã trúng ${award.name}!`, exact: true }).waitFor();
    assert.equal(spins, 1, 'reload must restore the award without another draw');
    assert.equal(await page.locator('i[style*="--confetti-x"]').count(), 0, 'restored awards must not replay confetti');
  } finally {
    assert.deepEqual(errors, []); assert.deepEqual(blockedWrites, []);
    await context.close();
  }
  console.log(`PASS ${id}: layout, images, keyboard spin, server award, reload${motion === 'no-preference' ? ', real animation/alignment/reveal' : ', reduced motion'}`);
}

(async () => {
  const browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  try {
    for (const scenario of [
      { count: 4, width: 375, motion: 'no-preference' },
      { count: 4, width: 1440, motion: 'no-preference' },
      { count: 1, width: 320, images: false },
      { count: 2, width: 844, height: 390, longNames: true, images: false },
      { count: 6, width: 375, images: false },
      { count: 4, width: 375, longNames: true },
      { count: 12, width: 375 },
      { count: 4, width: 375, registered: false },
      { count: 4, width: 375, paused: true },
    ]) await run(browser, scenario);
    console.log('Screenshots:', shots);
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
