// Uses mocked share snapshots, isolated guest tabs and real browser audio nodes.
// No account creation, publishing or Supabase writes.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require(path.join(process.env.EVENTPLAY_SOURCE || 'D:/Game Mới', 'node_modules/playwright'));
const base = process.env.GAME_E2E_BASE || 'http://localhost:3001';
const shots = path.join(process.env.TEMP || '.', 'worddecode-polish-qa');
fs.mkdirSync(shots, { recursive: true });
let browser, activePage;

async function scenario(permission, snapshot, reducedMotion = false) {
  const context = await browser.newContext({ viewport: { width: 1366, height: 900 }, reducedMotion: reducedMotion ? 'reduce' : 'no-preference' });
  await context.addInitScript(() => {
    window.__musicEvents = [];
    window.__audioContexts = [];
    const Native = window.AudioContext;
    window.AudioContext = new Proxy(Native, { construct(target, args) { const ctx = new target(...args); window.__audioContexts.push(ctx); return ctx; } });
    const start = AudioBufferSourceNode.prototype.start;
    const stop = AudioBufferSourceNode.prototype.stop;
    AudioBufferSourceNode.prototype.start = function(...args) { if (this.loop) window.__musicEvents.push('start'); return start.apply(this, args); };
    AudioBufferSourceNode.prototype.stop = function(...args) { if (this.loop) window.__musicEvents.push('stop'); return stop.apply(this, args); };
  });
  const page = await context.newPage(); activePage = page;
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.route('**/api/game/shared/*', route => route.fulfill({ json: { permission, revision: 1, snapshot } }));
  await page.goto(base + '/games/shared/' + 'w'.repeat(32));
  const frame = page.frameLocator('iframe');
  if (permission === 'edit') await frame.getByRole('button', { name: 'Chơi thử', exact: true }).click();
  await frame.locator('[data-worddecode-screen="intro"]').waitFor();
  const studio = page.frames().find(f => f.url().includes('/studio/'));
  // First gesture on the main screen unlocks audio even before entering the board.
  await frame.getByText('Cách chơi', { exact: true }).click();
  await studio.waitForFunction(() => window.__musicEvents.includes('start') && window.__audioContexts.some(ctx => ctx.state === 'running'));
  const eventsAtStart = await studio.evaluate(() => [...window.__musicEvents]);
  assert.equal(eventsAtStart.filter(e => e === 'start').length, 1);
  await frame.getByRole('button', { name: 'Chơi ngay', exact: true }).click();
  await frame.getByRole('button', { name: 'Tắt tiếng', exact: true }).click();
  await frame.getByRole('button', { name: 'Bật tiếng', exact: true }).click();
  await frame.getByRole('button', { name: 'Câu 1', exact: true }).click();
  await frame.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
  await frame.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  await frame.getByRole('button', { name: /^A / }).click();
  await frame.getByRole('button', { name: 'Mở mảnh 1', exact: true }).click();
  const celebration = frame.getByTestId('worddecode-celebration');
  if (!reducedMotion) await celebration.waitFor();
  const result = frame.getByRole('dialog', { name: '🎉 Hoàn thành!', exact: true });
  await result.waitFor();
  assert.equal(await result.getByRole('button', { name: 'Về thư viện', exact: true }).count(), permission === 'edit' ? 1 : 0);
  assert.equal(await celebration.count(), reducedMotion ? 0 : 1);
  if (!reducedMotion) {
    assert.equal(await celebration.locator('.wd-confetti').count(), 100);
    assert.equal(await celebration.evaluate(el => getComputedStyle(el).pointerEvents), 'none');
    await page.waitForTimeout(700);
    await page.screenshot({ path: path.join(shots, permission + '-celebration.png') });
  }
  assert.deepEqual(await studio.evaluate(() => window.__musicEvents), eventsAtStart, 'Music continues through quiz, pause, image and result without stop/restart');
  await result.getByRole('button', { name: 'Chơi lại', exact: true }).click();
  await frame.locator('[data-worddecode-screen="intro"]').waitFor();
  assert.equal(await celebration.count(), 0, 'Replay clears the celebration');
  assert.deepEqual(await studio.evaluate(() => window.__musicEvents), eventsAtStart, 'Replay preserves the current music timeline');
  await frame.getByRole('button', { name: 'Thoát game', exact: true }).click();
  await frame.locator('[data-worddecode-screen="intro"]').waitFor({ state: 'hidden' });
  assert.ok((await studio.evaluate(() => window.__musicEvents)).includes('stop'), 'Leaving the game stops music');
  assert.equal(await frame.getByRole('link', { name: 'Về thư viện game', exact: true }).count(), permission === 'edit' ? 1 : 0);
  assert.deepEqual(errors, []);
  console.log(`PASS ${permission}${reducedMotion ? ' reduced-motion' : ''}: correct share actions, continuous real audio, celebration, replay and exit`);
  await context.close();
}

(async () => {
  browser = await chromium.launch({ headless: true, args: ['--autoplay-policy=document-user-activation-required'] });
  const seedContext = await browser.newContext();
  const page = await seedContext.newPage(); activePage = page;
  await page.goto(base + '/games/play?module=worddecode');
  await page.frameLocator('iframe').getByRole('heading', { name: 'Giải Mã Ô Chữ', exact: true }).waitFor({ timeout: 60000 });
  const studio = page.frames().find(f => f.url().includes('/studio/'));
  const snapshot = await studio.evaluate(() => {
    const state = JSON.parse(localStorage.getItem('eventplay-studio')).state;
    const project = state.projects.find(p => p.moduleId === 'worddecode');
    project.config.questions = [{ id: 1, prompt: 'Bạn đã sẵn sàng khám phá bức tranh bí mật?', choices: [{ label: 'A', text: 'Sẵn sàng!' }, { label: 'B', text: 'Chưa sẵn sàng' }], correct: 'A', points: 100, timeLimit: 0 }];
    project.config.rows = project.config.cols = 1;
    project.config.revealImage = null;
    project.config.secret = 'CHÚC MỪNG BẠN!';
    const music = state.audio.find(a => a.category === 'music' && !a.src.startsWith('synth:'));
    if (!music) throw new Error('Missing bundled music fixture');
    project.musicId = music.id;
    return { project, themes: state.themes.filter(t => t.id === project.themeId), assets: [], audio: [music] };
  });
  await seedContext.close();
  await scenario('play', snapshot);
  await scenario('edit', snapshot);
  await scenario('play', snapshot, true);
})().catch(async e => {
  console.error(e);
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(shots, 'failure.png') });
  process.exitCode = 1;
}).finally(async () => { if (browser) await browser.close(); });
