// Isolated guest browser and mocked share persistence; no Supabase writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = process.env.EVENTPLAY_SOURCE || 'D:/Game Mới';
const { chromium } = require(path.join(source, 'node_modules/playwright'));
const ts = require(path.join(source, 'node_modules/typescript'));
const compiled = ts.transpileModule(fs.readFileSync(path.join(source, 'src/modules/WordDecode/flow.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exported = {};
new Function('exports', compiled)(exported);
const { initialFlow, reduceFlow, revealCount } = exported;
for (const enabled of [undefined, true, false]) {
  let state = initialFlow(enabled);
  const step = action => state = reduceFlow(state, action);
  step({ type: 'start' });
  for (const selected of ['B', null]) {
    step({ type: 'choose', index: 0, seconds: 2 });
    step({ type: 'answer', selected, correct: 'A', points: 100 });
    step({ type: 'picture' });
    assert.equal(state.phase, enabled === false ? 'board' : 'picture');
    assert.equal(state.score, 0);
    assert.equal(revealCount(state), enabled === false ? 0 : 1);
    step({ type: 'open', index: 1, total: 2 });
    assert.deepEqual(state.opened, enabled === false ? [] : [1]);
    if (enabled !== false) { state = initialFlow(enabled); step({ type: 'start' }); }
  }
  step({ type: 'choose', index: 0, seconds: 2 });
  step({ type: 'back' });
  assert.equal(revealCount(state), 0);
  step({ type: 'choose', index: 0, seconds: 2 });
  const answer = { type: 'answer', selected: 'A', correct: 'A', points: 100 };
  step(answer); step(answer);
  assert.equal(state.score, 100);
  step({ type: 'picture' });
  step({ type: 'open', index: 1, total: 2 });
  step({ type: 'open', index: 0, total: 2 });
  assert.deepEqual(state.opened, [1]);
  step({ type: 'continue' });
  step({ type: 'choose', index: 0, seconds: 2 });
  assert.equal(state.phase, 'board');
}
console.log('PASS default/enabled/disabled policy, timeout, retries, duplicate scoring and reveal limit');

const base = process.env.GAME_E2E_BASE || 'http://localhost:3001';
let browser;
(async () => {
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ reducedMotion: 'reduce' });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/games/play?module=worddecode');
  const frame = page.frameLocator('iframe');
  await frame.getByRole('heading', { name: 'Giải Mã Ô Chữ', exact: true }).waitFor({ timeout: 60000 });
  const studio = page.frames().find(f => f.url().includes('/studio/'));
  let snapshot = await studio.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('eventplay-studio')).state;
    const project = state.projects.find(p => p.moduleId === 'worddecode');
    delete project.config.allowOpenOnWrong; // Old projects must default to enabled.
    project.config.rows = 1; project.config.cols = 2;
    project.config.revealImage = null;
    project.config.questions = [0, 1].map(i => ({ id: i + 1, prompt: `Câu hỏi ${i + 1}`, choices: [{ label: 'A', text: 'Đúng' }, { label: 'B', text: 'Sai' }], correct: 'A', points: 100, timeLimit: i === 1 ? 4 : 0 }));
    return { project, themes: state.themes.filter(t => t.id === project.themeId), assets: [], audio: [] };
  });
  let revision = 1, writes = 0;
  const editToken = 'e'.repeat(32), playToken = 'p'.repeat(32);
  await page.route('**/api/game/shared/*', async route => {
    const permission = route.request().url().endsWith(editToken) ? 'edit' : 'play';
    if (route.request().method() === 'PUT') {
      assert.equal(permission, 'edit');
      const body = route.request().postDataJSON();
      assert.equal(body.expectedRev, revision);
      snapshot = body.snapshot; revision++; writes++;
    }
    await route.fulfill({ json: { snapshot, permission, revision } });
  });
  await page.goto(base + '/games/shared/' + editToken);
  const toggle = frame.getByRole('switch', { name: /Cho mở mảnh ảnh khi trả lời sai/ });
  await toggle.waitFor();
  assert.equal(await toggle.isChecked(), true);
  for (const enabled of [false, true, false]) {
    await toggle.setChecked(enabled);
    await frame.getByRole('button', { name: 'Lưu thay đổi', exact: true }).click();
    await frame.getByText('Đã lưu thay đổi lên game chia sẻ.', { exact: true }).waitFor();
    assert.equal(snapshot.project.config.allowOpenOnWrong, enabled);
    await page.reload();
    await toggle.waitFor();
    assert.equal(await toggle.isChecked(), enabled);
  }
  assert.equal(writes, 3);
  await page.goto(base + '/games/shared/' + playToken);
  const screen = phase => frame.locator(`[data-worddecode-screen="${phase}"]`);
  await frame.getByRole('button', { name: 'Chơi ngay', exact: true }).click();
  await frame.getByRole('button', { name: 'Câu 1', exact: true }).click();
  await frame.getByRole('button', { name: /^B / }).click();
  await screen('board').waitFor();
  assert.equal(await frame.locator('.wd-progress strong').textContent(), '0/2');
  assert.equal(await frame.locator('.wd-picture-grid').count(), 0);
  await frame.getByRole('button', { name: 'Câu 1 — Chưa đúng', exact: true }).click();
  await frame.getByRole('button', { name: /^A / }).click();
  await frame.getByRole('button', { name: 'Mở mảnh 2', exact: true }).click();
  assert.equal(await frame.getByRole('button', { name: 'Mở mảnh 1', exact: true }).isDisabled(), true);
  await frame.getByRole('button', { name: 'Tiếp tục câu hỏi', exact: true }).click();
  assert.equal(await frame.getByRole('button', { name: 'Câu 1 — Chính xác', exact: true }).isDisabled(), true);
  await frame.getByRole('button', { name: 'Câu 2', exact: true }).click();
  await screen('board').waitFor({ timeout: 15000 }); // Timeout grants no tile.
  assert.equal(await frame.locator('.wd-progress strong').textContent(), '1/2');
  await frame.getByRole('button', { name: 'Câu 2 — Chưa đúng', exact: true }).click();
  await frame.getByRole('button', { name: /^A / }).click();
  await frame.getByRole('button', { name: 'Mở mảnh 1', exact: true }).click();
  const result = frame.getByRole('dialog', { name: '🎉 Hoàn thành!', exact: true });
  await result.waitFor();
  assert.equal(await result.getByRole('button', { name: 'Về thư viện', exact: true }).count(), 0);
  await result.getByRole('button', { name: 'Chơi lại', exact: true }).click();
  await frame.getByRole('button', { name: 'Chơi ngay', exact: true }).click();
  assert.equal(await frame.locator('.wd-progress strong').textContent(), '0/2');
  await frame.getByRole('button', { name: 'Câu 1', exact: true }).click();
  await frame.getByRole('button', { name: /^B / }).click();
  await screen('board').waitFor();
  assert.equal(await frame.locator('.wd-progress strong').textContent(), '0/2');
  assert.deepEqual(errors, []);
  console.log('PASS editor toggles saved/reloaded, shared play strict wrong/timeout, retry, finish and replay');
  await context.close();
})().catch(e => { console.error(e); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
