// Guest-only layout regression. Requires the portal on port 3001 and upstream
// Playwright. GAME_E2E_BASE can target the deployed portal. No database writes.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { chromium } = require(path.join(process.env.EVENTPLAY_SOURCE || "D:/Game Mới", "node_modules/playwright"));
const base = process.env.GAME_E2E_BASE || "http://localhost:3001";
const shots = path.join(process.env.TEMP || ".", "decodeletters-text-qa");
fs.mkdirSync(shots, { recursive: true });
const question = "Theo nghiên cứu Ambroggio (2016), trong điều trị viêm phổi mắc phải cộng đồng (VPCĐ) nhi, phối hợp “Clarithromycin + β lactam” mang lại lợi ích gì so với đơn trị liệu?";
const longQuestion = question + "\n" + "Đọc đầy đủ nội dung câu hỏi và chọn một đáp án phù hợp trước khi xác nhận. ".repeat(8) + "HẾT CÂU HỎI.";
const longAnswer = "Nội dung đáp án rất dài cần hiển thị đầy đủ, tự xuống dòng và không bị cắt mất ký tự. ".repeat(4) + "HẾT ĐÁP ÁN.";
let browser;
let activePage;

async function scenario(name, viewport, extended, pictureMode = "reveal") {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage(); activePage = page;
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(base + "/games/play?module=decodeletters");
  const frame = page.frameLocator("iframe");
  await frame.getByRole("heading", { name: "Giải mã chữ cái", exact: true }).waitFor({ timeout: 60000 });
  const studio = page.frames().find((f) => f.url().includes("/studio/"));
  const [, projectId] = await Promise.all([
    studio.waitForNavigation({ waitUntil: "load" }),
    studio.evaluate(({ text, answer, pictureMode }) => {
      const data = JSON.parse(localStorage.getItem("eventplay-studio"));
      const project = data.state.projects.find((p) => p.moduleId === "decodeletters");
      data.state.settings.fullscreenOnPlay = false;
      data.state.settings.language = "en";
      project.config.revealImage = pictureMode === "reveal" ? "/games/covers/decodeletters.webp" : null;
      project.config.finalImage = pictureMode === "fallback" ? "/games/covers/decodeletters.webp" : null;
      project.config.shuffleOptions = false;
      project.config.pieces[0] = { ...project.config.pieces[0], question: text, timeLimit: 300, correct: "C", choices: [
        { label: "A", text: "Tăng tác dụng phụ" }, { label: "B", text: "Không khác biệt so với đơn trị" },
        { label: "C", text: answer }, { label: "D", text: "Chỉ có lợi ở người lớn" },
      ] };
      localStorage.setItem("eventplay-studio", JSON.stringify(data));
      location.reload();
      return project.id;
    }, { text: extended ? longQuestion : question, answer: extended ? longAnswer : "Giảm thất bại điều trị (trẻ trên 5 tuổi)", pictureMode }),
  ]);
  await frame.getByRole("heading", { name: "Giải mã chữ cái", exact: true }).waitFor();
  await studio.evaluate((id) => { location.hash = "/play/" + id; }, projectId);
  const tutorial = frame.getByRole("button", { name: /Đã hiểu|Got it/ });
  await tutorial.click();
  await tutorial.waitFor({ state: "hidden" });
  await frame.getByRole("button", { name: "Câu 1", exact: true }).click();
  const region = frame.getByRole("region", { name: "Câu hỏi và đáp án", exact: true });
  await region.waitFor();
  const heading = region.getByRole("heading");
  assert.equal(await heading.textContent(), extended ? longQuestion : question);
  const textMetrics = await heading.evaluate((el) => ({ clamp: getComputedStyle(el).webkitLineClamp, h: el.clientHeight, sh: el.scrollHeight, w: el.clientWidth, sw: el.scrollWidth }));
  assert.equal(textMetrics.clamp, "none");
  assert.ok(textMetrics.sh <= textMetrics.h + 1 && textMetrics.sw <= textMetrics.w + 1, "Question wraps without hidden text");
  const confirm = frame.getByRole("button", { name: "Xác nhận", exact: true });
  const regionBox = await region.boundingBox();
  const confirmBox = await confirm.boundingBox();
  assert.ok(confirmBox.y >= regionBox.y + regionBox.height, "Confirm never overlaps question/answers");
  assert.ok(confirmBox.y + confirmBox.height <= viewport.height, "Confirm stays inside the screen");
  await page.screenshot({ path: path.join(shots, name + "-question.png") });
  const answer = region.getByRole("button", { name: /^C / });
  await answer.scrollIntoViewIfNeeded();
  const answerMetrics = await answer.locator("span").nth(1).evaluate((el) => ({ clamp: getComputedStyle(el).webkitLineClamp, h: el.clientHeight, sh: el.scrollHeight, w: el.clientWidth, sw: el.scrollWidth }));
  assert.equal(answerMetrics.clamp, "none");
  assert.ok(answerMetrics.sh <= answerMetrics.h + 1 && answerMetrics.sw <= answerMetrics.w + 1, "Answer wraps without hidden text");
  if (name === "desktop") {
    // Wrong answers must not grant unlocks; pause must freeze the question timer.
    await region.getByRole("button", { name: /^A / }).click();
    await confirm.click();
    await region.getByText("✗ Chưa đúng — đáp án: C", { exact: true }).waitFor();
    await region.getByText("✗ Chưa đúng — đáp án: C", { exact: true }).waitFor({ state: "hidden" });
    assert.equal(await frame.getByRole("button", { name: "Mở mảnh 1", exact: true }).isEnabled(), false);
    await frame.getByRole("button", { name: "Tạm dừng", exact: true }).click();
    await frame.getByRole("button", { name: "Tiếp tục", exact: true }).waitFor();
    const timer = frame.locator('[title^="Còn "]');
    const pausedTime = await timer.getAttribute("title");
    await page.waitForTimeout(1200);
    assert.equal(await timer.getAttribute("title"), pausedTime);
    await frame.getByRole("button", { name: "Tiếp tục", exact: true }).click();
  }
  await answer.click();
  assert.equal(await confirm.isEnabled(), true);
  await page.screenshot({ path: path.join(shots, name + "-answer.png") });
  await confirm.click();
  await region.getByText("✓ Chính xác! Bạn nhận được 1 lượt mở ảnh.", { exact: true }).waitFor();

  await region.waitFor({ state: "hidden" });
  const imagePanel = frame.getByRole("complementary", { name: "Ảnh bí mật", exact: true });
  await imagePanel.waitFor({ state: "visible" });
  const cell = imagePanel.getByRole("button", { name: "Mở mảnh 1", exact: true });
  assert.equal(await cell.isEnabled(), true, "A correct answer enables the secret picture on every viewport");
  await cell.click();
  await imagePanel.getByRole("button", { name: "Mảnh 1 đã mở", exact: true }).waitFor();
  await page.screenshot({ path: path.join(shots, name + "-opened.png") });
  for (let i = 2; i <= 4; i++) {
    await frame.getByRole("button", { name: `Câu ${i}`, exact: true }).click();
    await region.getByRole("button", { name: /^B / }).click();
    await confirm.click();
    await region.waitFor({ state: "hidden" });
    await imagePanel.getByRole("button", { name: `Mở mảnh ${i}`, exact: true }).click();
  }
  const result = frame.getByRole("dialog", { name: "Hoàn thành!", exact: true });
  await result.waitFor();
  await result.getByRole("button", { name: "Chơi lại", exact: true }).waitFor();
  assert.equal(await result.getByRole("img", { name: "Ảnh bí mật đã được mở hoàn chỉnh" }).count(), pictureMode === "none" ? 0 : 1);
  const finalImage = result.getByRole("img", { name: "Ảnh bí mật đã được mở hoàn chỉnh" });
  if (pictureMode !== "none") assert.equal(await finalImage.evaluate(el => el.complete && el.naturalWidth > 0), true);
  await page.screenshot({ path: path.join(shots, name + "-win.png") });
  await result.getByRole("button", { name: "Chơi lại", exact: true }).click();
  await result.waitFor({ state: "hidden" });
  await frame.getByRole("button", { name: "Câu 1", exact: true }).waitFor();
  assert.equal(await imagePanel.getByRole("button", { name: "Mở mảnh 1", exact: true }).isEnabled(), false, "Replay resets unlocks");
  assert.deepEqual(errors, []);
  console.log(`PASS: ${name}: full question/answer text, reachable controls, image unlocks, Vietnamese results and replay.`);
  await context.close();
}

(async () => {
  browser = await chromium.launch({ headless: true });
  await scenario("desktop", { width: 1440, height: 900 }, false);
  await scenario("long-desktop", { width: 1366, height: 768 }, true);
  await scenario("phone", { width: 390, height: 844 }, true);
  await scenario("landscape", { width: 844, height: 390 }, true);
  await scenario("no-picture", { width: 390, height: 844 }, false, "none");
  await scenario("final-picture", { width: 1440, height: 900 }, false, "fallback");
})().catch(async (e) => {
  console.error(e);
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(shots, "failure.png") });
  process.exitCode = 1;
}).finally(async () => { if (browser) await browser.close(); });
