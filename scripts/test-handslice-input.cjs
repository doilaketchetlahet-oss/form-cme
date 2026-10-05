// Requires a running portal and Playwright from the upstream EventPlay project.
// GAME_E2E_BASE defaults to http://localhost:3001; EVENTPLAY_SOURCE to D:/Game Mới.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { chromium } = require(path.join(process.env.EVENTPLAY_SOURCE || "D:/Game Mới", "node_modules/playwright"));
const base = process.env.GAME_E2E_BASE || "http://localhost:3001";
const shots = path.join(process.env.TEMP || ".", "handslice-input-qa");
fs.mkdirSync(shots, { recursive: true });
let browser;
let activeGame;

async function launchGame(context) {
  await context.addInitScript(() => {
    Math.random = () => 0.5;
    window.__cameraRequests = 0;
    navigator.mediaDevices.getUserMedia = async () => {
      window.__cameraRequests++;
      throw new DOMException("Camera disabled for pointer regression", "NotAllowedError");
    };
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base + "/games/play?module=handslice");
  const frame = page.frameLocator("iframe");
  await frame.getByRole("heading", { name: "Chém Hoa Quả", exact: true }).waitFor({ timeout: 60000 });
  const studio = page.frames().find((f) => f.url().includes("/studio/"));
  const [, projectId] = await Promise.all([
    studio.waitForNavigation({ waitUntil: "load" }),
    page.locator("iframe").evaluate((el) => {
    const win = el.contentWindow;
    const data = JSON.parse(win.localStorage.getItem("eventplay-studio"));
    const project = data.state.projects.find((p) => p.moduleId === "handslice");
    Object.assign(project.config, {
      duration: 9, bombs: false, goldenObjects: false, spawnInterval: 180,
      maxOnScreen: 16, objectSkin: "custom", customEmojis: ["🍉"], slowMotion: false, screenShake: false,
    });
    data.state.settings.fullscreenOnPlay = false;
    data.state.settings.victoryPhoto = true; // Pointer wins must still skip webcam photos.
    win.localStorage.setItem("eventplay-studio", JSON.stringify(data));
    win.location.reload();
    return project.id;
    }),
  ]);
  // Reload immediately after writing the fixture, then wait for the new
  // document before navigating. Otherwise the old store can persist over it.
  await frame.getByRole("heading", { name: "Chém Hoa Quả", exact: true }).waitFor();
  await studio.evaluate((id) => { location.hash = "/play/" + id; }, projectId);
  await frame.getByRole("button", { name: /Chuột \/ Cảm ứng/ }).waitFor();
  assert.equal(await studio.evaluate((id) => JSON.parse(localStorage.getItem("eventplay-studio")).state.projects.find((p) => p.id === id).config.duration, projectId), 9);
  const cameraCalls = () => page.locator("iframe").evaluate((el) => el.contentWindow.__cameraRequests);
  assert.equal(await cameraCalls(), 0, "No camera request before selecting a mode");
  activeGame = { page, frame, errors, cameraCalls };
  return activeGame;
}

async function choosePointer(game) {
  await game.frame.getByRole("button", { name: /Chuột \/ Cảm ứng/ }).click();
  await game.frame.getByRole("button", { name: /Got it|Hiểu rồi/ }).click();
  const canvas = game.frame.getByLabel("Chém hoa quả bằng chuột hoặc cảm ứng");
  await canvas.waitFor();
  const box = await canvas.boundingBox();
  const score = async () => Number(await game.frame.locator("span.font-card.text-base").first().innerText());
  return { canvas, box, score };
}

(async () => {
  browser = await chromium.launch({ headless: true });
  const mouseContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const mouse = await launchGame(mouseContext);
  await mouse.page.screenshot({ path: path.join(shots, "choose-mode.png") });
  const { box, score } = await choosePointer(mouse);
  const left = box.x + box.width * 0.3;
  const right = box.x + box.width * 0.7;
  const y = box.y + box.height * 0.5;
  await mouse.page.waitForTimeout(900);
  for (let i = 0; i < 5; i++) await mouse.page.mouse.move(i % 2 ? left : right, y, { steps: 5 });
  assert.equal(await score(), 0, "Hover alone must not slice");
  await mouse.page.mouse.down();
  for (let i = 0; i < 18; i++) {
    await mouse.page.mouse.move(i % 2 ? right : left, y, { steps: 5 });
    await mouse.page.waitForTimeout(45);
  }
  await mouse.page.mouse.up();
  const sliced = await score();
  assert.ok(sliced > 0, "Mouse drag must earn points");
  for (let i = 0; i < 6; i++) await mouse.page.mouse.move(i % 2 ? left : right, y, { steps: 5 });
  await mouse.page.waitForTimeout(300);
  assert.equal(await score(), sliced, "Releasing the button must end slicing");
  await mouse.frame.getByRole("button", { name: "Pause", exact: true }).click();
  await mouse.page.mouse.move(left, y);
  await mouse.page.mouse.down();
  await mouse.page.mouse.move(right, y, { steps: 8 });
  await mouse.page.mouse.up();
  assert.equal(await score(), sliced, "Paused game must not score");
  await mouse.frame.getByRole("button", { name: "Resume", exact: true }).click();
  await mouse.frame.getByRole("heading", { name: "Paused", exact: true }).waitFor({ state: "hidden" });
  await mouse.page.screenshot({ path: path.join(shots, "mouse-play.png") });
  await mouse.frame.getByRole("button", { name: "Play again", exact: true }).waitFor({ timeout: 15000 });
  assert.equal(await mouse.cameraCalls(), 0, "Pointer mode must never request camera, including victory");
  await mouse.frame.getByRole("button", { name: "Play again", exact: true }).click();
  assert.equal(await score(), 0, "Restart clears the score");
  await mouse.frame.getByRole("button", { name: "Đổi cách chơi", exact: true }).click();
  await mouse.frame.getByRole("button", { name: /^Camera/ }).click();
  await mouse.frame.getByRole("button", { name: /Got it|Hiểu rồi/ }).click();
  await mouse.frame.getByRole("heading", { name: "Không mở được camera", exact: true }).waitFor();
  assert.equal(await mouse.cameraCalls(), 1, "Camera mode requests camera only after selection");
  await mouse.frame.getByRole("button", { name: "Đổi cách chơi", exact: true }).click();
  await choosePointer(mouse);
  assert.equal(await mouse.cameraCalls(), 1, "Switching back to pointer does not request camera");
  assert.deepEqual(mouse.errors, []);
  console.log("PASS: guest choice, mouse scoring, hover/release, pause, restart, camera-free victory and camera fallback.");
  await mouseContext.close();

  const touchContext = await browser.newContext({ viewport: { width: 1920, height: 1080 }, hasTouch: true });
  const touch = await launchGame(touchContext);
  const input = await choosePointer(touch);
  const cdp = await touchContext.newCDPSession(touch.page);
  const b = input.box;
  const points = (flip) => [
    { id: 1, x: b.x + b.width * (flip ? 0.7 : 0.3), y: b.y + b.height * 0.5 },
    { id: 2, x: b.x + b.width * (flip ? 0.3 : 0.7), y: b.y + b.height * 0.7 },
  ];
  await touch.page.waitForTimeout(900);
  await cdp.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: points(false) });
  for (let i = 0; i < 18; i++) {
    await cdp.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: points(i % 2 === 0) });
    await touch.page.waitForTimeout(65);
  }
  await cdp.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await touch.page.waitForTimeout(100);
  const touched = await input.score();
  assert.ok(touched > 0, "Two-finger TV touch swipe must earn points");
  await touch.page.waitForTimeout(300);
  assert.equal(await input.score(), touched, "Lifted fingers must stop slicing");
  assert.equal(await input.canvas.evaluate((el) => getComputedStyle(el).touchAction), "none");
  assert.equal(await touch.cameraCalls(), 0);
  assert.deepEqual(touch.errors, []);
  await touch.page.screenshot({ path: path.join(shots, "tv-touch-play.png") });
  console.log("PASS: real two-pointer touch events score on TV-sized canvas; touch release ends blades; no scrolling or camera.");
  await touchContext.close();
  const mobileContext = await browser.newContext({ viewport: { width: 360, height: 640 }, hasTouch: true });
  const mobile = await launchGame(mobileContext);
  const heading = await mobile.frame.getByRole("heading", { name: "Chém Hoa Quả", exact: true }).boundingBox();
  assert.ok(heading.y >= 0, "Short-screen picker must keep its top reachable");
  await choosePointer(mobile); // Scrolls the choice into view if necessary.
  assert.equal(await mobile.cameraCalls(), 0);
  assert.deepEqual(mobile.errors, []);
  await mobile.page.screenshot({ path: path.join(shots, "mobile-touch-play.png") });
  console.log("PASS: small touch-screen picker remains reachable and launches without camera.");
  await mobileContext.close();
})().catch(async (error) => {
  console.error(error.stack);
  if (activeGame && !activeGame.page.isClosed()) {
    console.error(await activeGame.frame.locator("body").innerText());
    await activeGame.page.screenshot({ path: path.join(shots, "failure.png") });
  }
  process.exitCode = 1;
})
  .finally(async () => { if (browser) await browser.close(); });
