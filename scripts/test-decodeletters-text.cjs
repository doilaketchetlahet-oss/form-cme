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

async function scenario(name, viewport, extended) {
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
    studio.evaluate(({ text, answer }) => {
      const data = JSON.parse(localStorage.getItem("eventplay-studio"));
      const project = data.state.projects.find((p) => p.moduleId === "decodeletters");
      data.state.settings.fullscreenOnPlay = false;
      data.state.settings.language = "vi";
      project.config.shuffleOptions = false;
      project.config.pieces[0] = { ...project.config.pieces[0], question: text, timeLimit: 300, correct: "C", choices: [
        { label: "A", text: "Tăng tác dụng phụ" }, { label: "B", text: "Không khác biệt so với đơn trị" },
        { label: "C", text: answer }, { label: "D", text: "Chỉ có lợi ở người lớn" },
      ] };
      localStorage.setItem("eventplay-studio", JSON.stringify(data));
      location.reload();
      return project.id;
    }, { text: extended ? longQuestion : question, answer: extended ? longAnswer : "Giảm thất bại điều trị (trẻ trên 5 tuổi)" }),
  ]);
  await frame.getByRole("heading", { name: "Giải mã chữ cái", exact: true }).waitFor();
  await studio.evaluate((id) => { location.hash = "/play/" + id; }, projectId);
  const tutorial = frame.getByRole("button", { name: /Đã hiểu|Got it/ });
  await tutorial.click();
  await tutorial.waitFor({ state: "hidden" });
  await frame.getByRole("button", { name: "1", exact: true }).click();
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
  const answerMetrics = await answer.locator("span").last().evaluate((el) => ({ clamp: getComputedStyle(el).webkitLineClamp, h: el.clientHeight, sh: el.scrollHeight, w: el.clientWidth, sw: el.scrollWidth }));
  assert.equal(answerMetrics.clamp, "none");
  assert.ok(answerMetrics.sh <= answerMetrics.h + 1 && answerMetrics.sw <= answerMetrics.w + 1, "Answer wraps without hidden text");
  await answer.click();
  assert.equal(await confirm.isEnabled(), true);
  await page.screenshot({ path: path.join(shots, name + "-answer.png") });
  await confirm.click();
  await region.getByText("✓ Chính xác — chạm CHẠM trên ô ảnh để mở!", { exact: true }).waitFor();
  assert.deepEqual(errors, []);
  console.log(`PASS: ${name}: full question/answer text, reachable controls and correct answer flow.`);
  await context.close();
}

(async () => {
  browser = await chromium.launch({ headless: true });
  await scenario("desktop", { width: 1440, height: 900 }, false);
  await scenario("long-desktop", { width: 1366, height: 768 }, true);
  await scenario("phone", { width: 390, height: 844 }, true);
  await scenario("landscape", { width: 844, height: 390 }, true);
})().catch(async (e) => {
  console.error(e);
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(shots, "failure.png") });
  process.exitCode = 1;
}).finally(async () => { if (browser) await browser.close(); });
