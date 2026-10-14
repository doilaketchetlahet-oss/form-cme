// Guest-only browser regression for the multi-screen video flow. No account/API writes.
// Start the portal on :3001; override GAME_E2E_BASE / EVENTPLAY_SOURCE if needed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const source = process.env.EVENTPLAY_SOURCE || 'D:/Game Mới';
const { chromium } = require(path.join(source, 'node_modules/playwright'));
const ts = require(path.join(source, 'node_modules/typescript'));
const base = process.env.GAME_E2E_BASE || 'http://localhost:3001';
const shots = path.join(process.env.TEMP || '.', 'worddecode-flow-qa');
fs.mkdirSync(shots, { recursive: true });

// Exercise rapid duplicate events and invalid transitions without timing dependence.
const compiled = ts.transpileModule(fs.readFileSync(path.join(source, 'src/modules/WordDecode/flow.ts'), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
const exported = {};
new Function('exports', compiled)(exported);
const { initialFlow, reduceFlow } = exported;
let state = initialFlow();
const step = (action) => state = reduceFlow(state, action);
step({ type: 'start' });
step({ type: 'choose', index: 0, seconds: 15 });
step({ type: 'back' });
assert.equal(Object.keys(state.answers).length, 0, 'Back does not award a reveal');
step({ type: 'choose', index: 0, seconds: 15 });
const answer = { type: 'answer', selected: 'A', correct: 'A', points: 100 };
step(answer); step(answer);
assert.equal(state.score, 100, 'Repeated clicks award points once');
step({ type: 'picture' });
step({ type: 'continue' });
assert.equal(state.phase, 'picture', 'Must spend the reveal before leaving');
step({ type: 'open', index: 3, total: 4 });
step({ type: 'open', index: 2, total: 4 });
assert.deepEqual(state.opened, [3], 'One answer allows exactly one arbitrary tile');
step({ type: 'continue' });
step({ type: 'choose', index: 0, seconds: 15 });
assert.equal(state.phase, 'board', 'Cannot replay an answered question for points');
assert.deepEqual(initialFlow().opened, [], 'Replay starts fresh');
console.log('PASS atomic transitions, duplicate taps, back and reveal gating');

let browser, activePage;
async function scenario(name, viewport, { long = false, picture = true, legacy = false } = {}) {
  const context = await browser.newContext({ viewport, reducedMotion: 'reduce', hasTouch: name === 'phone' });
  const page = await context.newPage(); activePage = page;
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(base + '/games/play?module=worddecode');
  const frame = page.frameLocator('iframe');
  await frame.getByRole('heading', { name: 'Giải Mã Ô Chữ', exact: true }).waitFor({ timeout: 60000 });
  const studio = page.frames().find(f => f.url().includes('/studio/'));
  const [, id] = await Promise.all([
    studio.waitForNavigation({ waitUntil: 'load' }),
    studio.evaluate(({ long, picture, legacy }) => {
      const data = JSON.parse(localStorage.getItem('eventplay-studio'));
      const project = data.state.projects.find(p => p.moduleId === 'worddecode');
      data.state.settings.fullscreenOnPlay = false;
      data.state.settings.language = 'en';
      data.state.settings.muted = true;
      const count = legacy ? 16 : 4;
      project.config.rows = legacy ? 4 : 2;
      project.config.cols = legacy ? 4 : 2;
      project.config.hideLetters = false;
      delete project.config.background;
      project.config.revealImage = picture ? '/games/covers/decodeletters.webp' : null;
      project.config.secret = 'TỪ KHOÁ HOÀN CHỈNH KHÔNG BỊ CẮT';
      project.config.questions = Array.from({ length: count }, (_, i) => ({
        id: i + 1,
        prompt: long ? ('Câu hỏi tiếng Việt dài phải xuống dòng đầy đủ. '.repeat(14) + 'HẾT CÂU HỎI.') : `Câu hỏi số ${i + 1}: Chọn đáp án đúng để nhận điểm.`,
        choices: [
          { label: 'A', text: long ? 'Đáp án đầy đủ có dấu tiếng Việt. '.repeat(8) + 'HẾT ĐÁP ÁN.' : 'Đáp án đúng' },
          { label: 'B', text: 'Đáp án khác' }, { label: 'C', text: 'Phương án C' }, { label: 'D', text: 'Phương án D' },
        ], correct: 'A', points: 100, timeLimit: i === 2 ? 2 : 120,
      }));
      localStorage.setItem('eventplay-studio', JSON.stringify(data));
      location.reload();
      return project.id;
    }, { long, picture, legacy }),
  ]);
  await frame.getByRole('heading', { name: 'Giải Mã Ô Chữ', exact: true }).waitFor();
  await studio.evaluate(id => { location.hash = '/play/' + id; }, id);
  const screen = (phase) => frame.locator(`.wd-game[data-worddecode-screen="${phase}"]`);
  const snap = async (label) => page.screenshot({ path: path.join(shots, `${name}-${label}.png`) });
  await screen('intro').waitFor();
  assert.equal(await frame.getByRole('button', { name: /Đã hiểu|Got it/ }).count(), 0, 'No shared tutorial in front of the intro');
  await frame.getByText('Cách chơi', { exact: true }).click();
  await snap('01-start');
  await frame.getByRole('button', { name: 'Chơi ngay', exact: true }).click();
  await screen('board').waitFor();
  assert.equal(await frame.locator('.wd-letter-row').count(), legacy ? 16 : 4);
  assert.equal(await frame.locator('.wd-picture-grid').count(), 0, 'Board only; no picture panel');
  await snap('02-board');
  await frame.getByRole('button', { name: 'Câu 1', exact: true }).click();
  await screen('question').waitFor();
  assert.equal(await frame.locator('.wd-letter-row').count(), 0, 'Question replaces the board');
  await frame.getByRole('button', { name: 'Quay lại', exact: true }).click();
  await screen('board').waitFor();
  assert.equal(await frame.locator('.wd-progress strong').textContent(), `0/${legacy ? 16 : 4}`);
  await frame.getByRole('button', { name: 'Câu 1', exact: true }).click();
  if (legacy) {
    await frame.getByRole('button', { name: /^A / }).click();
    await screen('picture').waitFor();
    assert.equal(await frame.locator('.wd-piece').count(), 16, 'Legacy 16-question grids stay intact');
    await frame.getByRole('button', { name: 'Mở mảnh 16', exact: true }).click();
    await frame.getByRole('button', { name: 'Tiếp tục câu hỏi', exact: true }).click();
    await screen('board').waitFor();
    assert.equal(await frame.getByRole('button', { name: 'Câu 1 — Chính xác', exact: true }).isDisabled(), true);
    assert.deepEqual(errors, []);
    await context.close();
    console.log('PASS legacy 16-question project, missing new fields, independent reveal');
    return;
  }
  const heading = frame.locator('.wd-question-card h1');
  if (long) assert.ok((await heading.textContent()).endsWith('HẾT CÂU HỎI.'));
  for (const element of [heading, frame.locator('.wd-choice-text').first()]) {
    const metrics = await element.evaluate(el => ({ clamp: getComputedStyle(el).webkitLineClamp, h: el.clientHeight, sh: el.scrollHeight, w: el.clientWidth, sw: el.scrollWidth }));
    assert.equal(metrics.clamp, 'none');
    assert.ok(metrics.sh <= metrics.h + 2 && metrics.sw <= metrics.w + 2, 'Long content wraps without truncation: ' + JSON.stringify(metrics));
  }
  await snap('03-question');
  if (name === 'desktop') {
    await frame.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
    const time = await frame.getByRole('timer').getAttribute('aria-label');
    await page.waitForTimeout(1250);
    assert.equal(await frame.getByRole('timer').getAttribute('aria-label'), time, 'Pause freezes countdown');
    await frame.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
  }
  const tileOrder = [4, 1, 3, 2];
  for (let i = 0; i < 4; i++) {
    if (i > 0) await frame.getByRole('button', { name: `Câu ${i + 1}`, exact: true }).click();
    if (i !== 2) await frame.getByRole('button', { name: i === 1 ? /^B / : /^A / }).click();
    await screen('feedback').waitFor();
    const feedbackText = await frame.getByRole('status').textContent();
    const feedbackBox = await frame.getByRole('status').boundingBox();
    assert.ok(feedbackBox.y >= 0 && feedbackBox.y < viewport.height, 'Feedback scrolls into view even below a long question');
    assert.match(feedbackText, i === 1 ? /Chưa đúng/ : i === 2 ? /Hết giờ/ : /Chính xác/);
    if (i === 0) {
      await snap('04-feedback');
      if (name === 'desktop') {
        await frame.getByRole('button', { name: 'Tạm dừng', exact: true }).click();
        await page.waitForTimeout(2200);
        assert.equal(await screen('feedback').count(), 1, 'Pause freezes feedback-to-picture transition');
        await frame.getByRole('button', { name: 'Tiếp tục', exact: true }).click();
      }
    }
    await screen('picture').waitFor();
    assert.equal(await frame.locator('.wd-question-card').count(), 0, 'Picture replaces question');
    assert.equal(await frame.getByRole('button', { name: 'Tiếp tục câu hỏi', exact: true }).isDisabled(), true);
    await frame.getByRole('button', { name: `Mở mảnh ${tileOrder[i]}`, exact: true }).click();
    if (i < 3) {
      await frame.getByRole('heading', { name: `Đã mở ${i + 1}/4 mảnh`, exact: true }).waitFor();
      assert.equal(await frame.locator('.wd-piece:not([disabled])').count(), 0, 'Cannot open another tile with the same answer');
      if (i === 0) await snap('05-picture');
      await frame.getByRole('button', { name: 'Tiếp tục câu hỏi', exact: true }).click();
      await screen('board').waitFor();
      assert.equal(await frame.locator('.wd-letter-row[disabled]').count(), i + 1);
      if (i === 1) await snap('06-right-and-wrong');
    }
  }
  const result = frame.getByRole('dialog', { name: '🎉 Hoàn thành!', exact: true });
  await result.waitFor();
  assert.match(await result.textContent(), /200 điểm/, 'Only two correct answers earn points');
  if (picture) await result.getByRole('img', { name: 'Ảnh bí mật đã được mở hoàn chỉnh' }).evaluate(el => el.decode());
  else await result.getByText('TỪ KHOÁ HOÀN CHỈNH KHÔNG BỊ CẮT', { exact: true }).waitFor();
  await snap('07-result');
  await result.getByRole('button', { name: 'Chơi lại', exact: true }).click();
  await screen('intro').waitFor();
  await frame.getByRole('button', { name: 'Chơi ngay', exact: true }).click();
  await screen('board').waitFor();
  assert.equal(await frame.locator('.wd-letter-row[disabled]').count(), 0);
  assert.equal(await frame.locator('.wd-progress strong').textContent(), '0/4');
  const horizontalOverflow = await frame.locator('.wd-screen').evaluate(el => el.scrollWidth > el.clientWidth + 2);
  assert.equal(horizontalOverflow, false, 'No horizontal overflow');
  assert.deepEqual(errors, []);
  console.log(`PASS ${name}: separate screens, correct/wrong/timeout, one arbitrary reveal, result, replay, layout`);
  await context.close();
}

(async () => {
  browser = await chromium.launch({ headless: true });
  await scenario('desktop', { width: 1440, height: 900 });
  await scenario('phone', { width: 390, height: 844 }, { long: true });
  await scenario('landscape', { width: 844, height: 390 }, { long: true, picture: false });
  await scenario('legacy', { width: 1280, height: 720 }, { legacy: true });
})().catch(async e => {
  console.error(e);
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(shots, 'failure.png') });
  process.exitCode = 1;
}).finally(async () => { if (browser) await browser.close(); });
