// Start the app on port 3109. CHECKIN_TEST_DEPS may point to a temporary
// package directory containing Playwright; PLAYWRIGHT_CHANNEL=msedge on Windows.
// Browser auth, database reads and saves are mocked. No real records are changed.
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { createRequire } = require('node:module');
const path = require('node:path');
const uiRequire = process.env.CHECKIN_TEST_DEPS ? createRequire(path.join(process.env.CHECKIN_TEST_DEPS, 'package.json')) : require;
const { chromium } = uiRequire('playwright');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const base = process.env.EDITOR_E2E_BASE || 'http://localhost:3109';
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host;
const user = { id: randomUUID(), email: 'editor@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} };
const expires = Math.floor(Date.now() / 1000) + 3600;
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: expires })).toString('base64url')}.test-only`;
const session = { access_token: token, refresh_token: 'test-only', token_type: 'bearer', expires_in: 3600, expires_at: expires, user };
let browser;

async function run(viewport, touch) {
  const formId = randomUUID();
  const initial = ['Họ và tên', 'Email', 'Đăng ký cấp CME'].map((text, position) => ({
    id: randomUUID(), survey_id: formId, position, text,
    type: position === 2 ? 'choice' : 'text', options: position === 2 ? ['Có', 'Không'] : null,
    required: false, allow_multiple: false, is_hall_selector: false, show_if: null,
  }));
  let questions = structuredClone(initial), saved;
  const survey = { id: formId, title: 'Kiểm tra sắp xếp trường', form_type: 'registration', is_anonymous: true, checkin_theme: null };
  const context = await browser.newContext({ viewport, hasTouch: touch });
  const errors = [];
  try {
    await context.addInitScript(({ host, session }) => {
      localStorage.setItem(`sb-${host.split('.')[0]}-auth-token`, JSON.stringify(session));
    }, { host, session });
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      let body;
      if (url.host === host) {
        if (url.pathname.endsWith('/admin_members')) body = { role: 'owner', active: true };
        else if (url.pathname.endsWith('/surveys')) body = survey;
        else if (url.pathname.endsWith('/survey_questions')) body = questions;
        else if (url.pathname.endsWith('/user')) body = user;
        else body = [];
      } else if (url.pathname === `/api/admin/forms/${formId}/save`) {
        saved = route.request().postDataJSON();
        questions = saved.questions;
        body = { ok: true };
      } else if (url.pathname.startsWith('/api/')) body = {};
      else if (url.origin === new URL(base).origin) return route.continue();
      else return route.abort();
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
    });
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    const handles = page.getByRole('button', { name: 'Kéo để sắp xếp', exact: true });
    const cards = () => handles.locator('..').locator('..');
    // The header's direct paragraph contains the field label (expanded bodies
    // may also contain help paragraphs, so inspect only the first header).
    const labels = () => cards().evaluateAll((nodes) => nodes.map((node) => node.firstElementChild.querySelector('p').textContent));
    const checkOrder = async (expected) => {
      await page.waitForFunction((expected) => {
        const nodes = [...document.querySelectorAll('button[title="Kéo để sắp xếp"]')];
        return JSON.stringify(nodes.map((node) => node.parentElement.querySelector('p').textContent)) === JSON.stringify(expected);
      }, expected);
      assert.deepEqual(await labels(), expected);
    };
    const drag = async (from, to) => {
      await handles.nth(from).scrollIntoViewIfNeeded();
      const a = await handles.nth(from).boundingBox();
      const b = await handles.nth(to).boundingBox();
      const x = a.x + a.width / 2, y = a.y + a.height / 2, endY = b.y + b.height / 2;
      if (touch) {
        const cdp = await context.newCDPSession(page);
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
        for (let step = 1; step <= 16; step++) {
          await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y + (endY - y) * step / 16 }] });
          await page.waitForTimeout(20);
        }
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await cdp.detach();
      } else {
        await page.mouse.move(x, y);
        await page.mouse.down();
        await page.mouse.move(x, y + 8, { steps: 2 });
        await page.waitForTimeout(100);
        await page.mouse.move(x, endY, { steps: 16 });
        await page.mouse.up();
      }
      // Let sortable transitions and the sensor's post-drag click guard settle.
      await page.waitForTimeout(300);
    };
    await page.goto(`${base}/admin/forms/${formId}`);
    await handles.first().waitFor();
    // Collapse the initially expanded card, then exercise both directions.
    await cards().first().locator('p').first().click();
    await page.waitForTimeout(300);
    await drag(0, 2);
    await checkOrder(['Email', 'Đăng ký cấp CME', 'Họ và tên']);
    await drag(2, 0);
    await checkOrder(initial.map((q) => q.text));

    // Existing CME navigation must still focus its textarea after removing the wrapper.
    await page.getByRole('button', { name: 'Check-in', exact: true }).click();
    await page.getByRole('button', { name: 'Mở câu hỏi đăng ký CME', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.tagName === 'TEXTAREA' && document.activeElement.value === 'Đăng ký cấp CME');
    assert.equal(await handles.count(), 3);
    await cards().last().locator('p').first().click();
    await page.waitForTimeout(300);
    await drag(2, 1);
    await checkOrder(['Họ và tên', 'Đăng ký cấp CME', 'Email']);

    // Keyboard ordering and Escape cancellation use the same sortable bounds.
    await handles.nth(1).focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowUp');
    await page.waitForTimeout(250);
    await page.keyboard.press('Space');
    await checkOrder(['Đăng ký cấp CME', 'Họ và tên', 'Email']);
    await handles.first().focus();
    await page.keyboard.press('Space');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await checkOrder(['Đăng ký cấp CME', 'Họ và tên', 'Email']);

    await page.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await page.getByRole('heading', { name: 'Đã lưu thay đổi', exact: true }).waitFor();
    assert.deepEqual(saved.questions.map((q) => [q.id, q.position]), [[initial[2].id, 0], [initial[0].id, 1], [initial[1].id, 2]]);
    assert.deepEqual(saved.questions[0].options, ['Có', 'Không']);
    await page.reload();
    await handles.first().waitFor();
    await checkOrder(['Đăng ký cấp CME', 'Họ và tên', 'Email']);
    assert.deepEqual(errors, []);
    console.log(`${touch ? 'Mobile touch' : 'Desktop mouse'}: reorder both directions, CME focus, keyboard/cancel, saved IDs/positions and reload passed.`);
  } finally {
    await context.close();
  }
}

(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  await run({ width: 1440, height: 1000 }, false);
  await run({ width: 390, height: 844 }, true);
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
