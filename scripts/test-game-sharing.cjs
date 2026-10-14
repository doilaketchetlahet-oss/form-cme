// Real API + browser regression. Creates two confirmed throwaway accounts,
// sends no email, and deletes their saves/shares/assets/accounts in finally.
// Run against npm run dev -- --port 3001; GAME_E2E_BASE can target production.
const assert = require("node:assert/strict");
const path = require("node:path");
const fs = require("node:fs");
const { randomUUID } = require("node:crypto");
const { createClient } = require("@supabase/supabase-js");
const { chromium } = require(path.join(process.env.EVENTPLAY_SOURCE || "D:/Game Mới", "node_modules/playwright"));
require("@next/env").loadEnvConfig(path.resolve(__dirname, ".."));
const base = process.env.GAME_E2E_BASE || "http://localhost:3001";
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const admin = createClient(supabaseUrl, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const created = [];
let browser;
let activePage;
const shots = path.join(process.env.TEMP || ".", "game-sharing-qa");
fs.mkdirSync(shots, { recursive: true });

async function account() {
  const email = `game-share-${randomUUID()}@example.test`;
  const password = randomUUID() + "!Aa3";
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (error) throw new Error("Could not create regression account");
  created.push(data.user.id);
  const client = createClient(supabaseUrl, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
  const { data: login, error: loginError } = await client.auth.signInWithPassword({ email, password });
  if (loginError) throw new Error("Could not sign in regression account");
  return login.session;
}

function bodyFor(snapshot, editEnabled = false, revision) {
  return { projectId: snapshot.project.id, snapshot, editEnabled, expectedRev: revision };
}
function apiFor(link) {
  const url = new URL(link, base);
  return base + url.pathname.replace("/games/shared/", "/api/game/shared/");
}
const jsonHeaders = { "Content-Type": "application/json", Origin: new URL(base).origin };

(async () => {
  const ownerSession = await account();
  const otherSession = await account();
  browser = await chromium.launch({ headless: true });
  const ownerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const key = "sb-" + new URL(supabaseUrl).hostname.split(".")[0] + "-auth-token";
  await ownerContext.addInitScript(({ key, session }) => localStorage.setItem(key, JSON.stringify(session)), { key, session: ownerSession });
  const owner = await ownerContext.newPage(); activePage = owner;
  const errors = [];
  owner.on("pageerror", (e) => errors.push(e.message));
  await owner.goto(base + "/games/play?module=quiz");
  const frame = owner.frameLocator("iframe");
  await frame.getByRole("heading", { name: "Quiz Board", exact: true }).waitFor({ timeout: 60000 });
  await owner.waitForTimeout(2300);
  await frame.getByRole("button", { name: "New project", exact: true }).click();
  await frame.getByRole("dialog").getByRole("textbox").fill("Game shared regression");
  await frame.getByRole("button", { name: "Create project", exact: true }).click();
  await frame.getByRole("textbox", { name: "Tên dự án", exact: true }).waitFor();
  await frame.getByRole("button", { name: "Chia sẻ", exact: true }).click();
  await frame.getByRole("button", { name: "Tạo link chia sẻ", exact: true }).click();
  const playLink = await frame.getByRole("textbox", { name: "Link chơi", exact: true }).inputValue();
  const playApi = apiFor(playLink);
  let response = await ownerContext.request.get(playApi);
  assert.equal(response.status(), 200);
  let published = await response.json();
  assert.equal(published.permission, "play");
  assert.equal(published.snapshot.project.name, "Game shared regression");
  const publishedText = JSON.stringify(published);
  assert.equal(publishedText.includes("edit_token"), false);
  assert.equal(publishedText.includes("user_id"), false);
  assert.equal(publishedText.includes("workspaces"), false);
  assert.equal(publishedText.includes("projects"), false);
  assert.equal(publishedText.includes(ownerSession.user.id), false);
  assert.equal(published.snapshot.project.save, undefined);
  const projectId = published.snapshot.project.id;
  const otherHeaders = { ...jsonHeaders, Authorization: "Bearer " + otherSession.access_token };
  assert.equal((await ownerContext.request.get(base + "/api/game/shares?projectId=" + projectId, { headers: otherHeaders })).status(), 200);
  const unrelated = await ownerContext.request.get(base + "/api/game/shares?projectId=" + projectId, { headers: otherHeaders });
  assert.equal((await unrelated.json()).share, null);
  assert.equal((await ownerContext.request.delete(base + "/api/game/shares", { headers: otherHeaders, data: { projectId } })).status(), 200);
  assert.equal((await ownerContext.request.get(playApi)).status(), 200, "Other account cannot revoke owner's share");
  assert.equal((await ownerContext.request.put(playApi, { headers: otherHeaders, data: { snapshot: published.snapshot, expectedRev: published.revision } })).status(), 403);
  assert.equal((await ownerContext.request.post(playApi + "/assets", { headers: jsonHeaders })).status(), 403);
  assert.equal((await ownerContext.request.post(base + "/api/game/shares", { headers: { ...jsonHeaders, Authorization: "Bearer " + ownerSession.access_token, Origin: "https://foreign.test" }, data: bodyFor(published.snapshot) })).status(), 403);
  const rawGuest = await browser.newContext();
  assert.equal((await rawGuest.request.post(base + "/api/game/shares", { headers: jsonHeaders, data: bodyFor(published.snapshot) })).status(), 401);
  await rawGuest.close();
  await owner.screenshot({ path: path.join(shots, "owner-share-play.png") });
  console.log("PASS: authenticated creator publishes only the selected project; guests cannot publish; play links and other accounts cannot edit/revoke or reveal owner data.");

  await frame.getByRole("switch", { name: "Cho phép chỉnh sửa", exact: true }).click();
  const editInput = frame.getByRole("textbox", { name: "Link chỉnh sửa", exact: true });
  await editInput.waitFor();
  const editLink = await editInput.inputValue();
  const editApi = apiFor(editLink);
  assert.notEqual(editLink, playLink);
  await owner.setViewportSize({ width: 390, height: 844 });
  await frame.getByRole("textbox", { name: "Link chỉnh sửa", exact: true }).scrollIntoViewIfNeeded();
  const dialogBounds = await frame.getByRole("dialog").boundingBox();
  assert.ok(dialogBounds.x >= 0 && dialogBounds.x + dialogBounds.width <= 390, "Share dialog fits a phone");
  await owner.screenshot({ path: path.join(shots, "owner-share-mobile.png") });
  await owner.setViewportSize({ width: 1440, height: 1000 });
  const recipientContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const sentinel = JSON.stringify({ version: 1, state: { privateSentinel: "untouched", projects: [] } });
  await recipientContext.addInitScript((value) => localStorage.setItem("eventplay-studio", value), sentinel);
  const accountWrites = [];
  recipientContext.on("request", (req) => { if (/\/api\/game\/(save|session|shares)(?:\?|$)/.test(req.url())) accountWrites.push(req.url()); });
  const editor = await recipientContext.newPage(); activePage = editor;
  editor.on("pageerror", (e) => errors.push(e.message));
  await editor.goto(editLink);
  const editFrame = editor.frameLocator("iframe");
  await editFrame.getByRole("textbox", { name: "Tên dự án", exact: true }).waitFor({ timeout: 60000 });
  assert.equal(await editFrame.getByRole("textbox", { name: "Tên dự án", exact: true }).inputValue(), "Game shared regression");
  await editFrame.getByRole("textbox", { name: "Tên dự án", exact: true }).fill("Edited using shared link");
  await editFrame.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await editFrame.getByRole("status").filter({ hasText: "Đã lưu thay đổi" }).waitFor();
  published = await (await recipientContext.request.get(playApi)).json();
  assert.equal(published.snapshot.project.name, "Edited using shared link");
  assert.equal(await editor.locator("iframe").evaluate((el) => el.contentWindow.localStorage.getItem("eventplay-studio")), sentinel);
  assert.deepEqual(accountWrites, []);
  await editor.screenshot({ path: path.join(shots, "recipient-edit.png") });
  const viewer = await recipientContext.newPage(); activePage = viewer;
  viewer.on("pageerror", (e) => errors.push(e.message));
  await viewer.goto(playLink);
  const viewFrame = viewer.frameLocator("iframe");
  await viewFrame.getByRole("button", { name: /Đã hiểu|Got it/ }).click();
  assert.equal(await viewFrame.getByRole("button", { name: "Lưu thay đổi", exact: true }).count(), 0);
  assert.equal(await viewFrame.getByRole("textbox", { name: "Tên dự án", exact: true }).count(), 0);
  await viewer.waitForTimeout(1000);
  assert.equal(await viewer.locator("iframe").evaluate((el) => el.contentWindow.localStorage.getItem("eventplay-studio")), sentinel);
  assert.deepEqual(accountWrites, []);
  await viewer.screenshot({ path: path.join(shots, "recipient-play.png") });
  console.log("PASS: anonymous edit recipient saves changes; fresh play recipient runs updated game; private local/cloud workspace stays untouched.");

  // Media uploads use the edit capability, remain public for players, and
  // preserve the owning account's existing quota. The test media is removed.
  const png = await require("sharp")({ create: { width: 240, height: 180, channels: 3, background: "#55bbdd" } }).png().toBuffer();
  const upload = await recipientContext.request.post(editApi + "/assets", { timeout: 90000, headers: { Origin: new URL(base).origin }, multipart: { file: { name: "regression.png", mimeType: "image/png", buffer: png } } });
  assert.equal(upload.status(), 200);
  const asset = await upload.json();
  assert.equal((await recipientContext.request.get(asset.url)).status(), 200);
  const snapshot = structuredClone(published.snapshot);
  snapshot.assets = [{ id: "asset_shared_test", name: "Test image", kind: "image", mime: "image/png", src: asset.url, size: png.length }];
  snapshot.project.config.sharedTestImage = "asset_shared_test";
  const first = await recipientContext.request.put(editApi, { headers: jsonHeaders, data: { snapshot, expectedRev: published.revision } });
  assert.equal(first.status(), 200);
  const stale = await recipientContext.request.put(editApi, { headers: jsonHeaders, data: { snapshot: published.snapshot, expectedRev: published.revision } });
  assert.equal(stale.status(), 409);
  const latest = await (await recipientContext.request.get(editApi)).json();
  const concurrent = await Promise.all([1, 2].map((n) => recipientContext.request.put(editApi, { headers: jsonHeaders, data: { snapshot: { ...latest.snapshot, project: { ...latest.snapshot.project, name: "Concurrent " + n } }, expectedRev: latest.revision } })));
  assert.deepEqual(concurrent.map((r) => r.status()).sort(), [200, 409]);
  await editFrame.getByRole("textbox", { name: "Tên dự án", exact: true }).fill("Stale browser draft");
  await editFrame.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await editFrame.getByRole("alert").filter({ hasText: "người khác cập nhật" }).waitFor();
  assert.equal(await editFrame.getByRole("button", { name: "Lưu thay đổi", exact: true }).isDisabled(), true);
  editor.once("dialog", (dialog) => dialog.accept());
  await editFrame.getByRole("button", { name: "Tải bản mới", exact: true }).click();
  await editFrame.getByRole("alert").waitFor({ state: "hidden" });
  await editFrame.locator('input[aria-label="Tên dự án"][value^="Concurrent "]').waitFor();
  assert.match(await editFrame.getByRole("textbox", { name: "Tên dự án", exact: true }).inputValue(), /^Concurrent /);
  console.log("PASS: editable links upload playable media; stale and simultaneous saves cannot overwrite each other.");

  await frame.getByRole("button", { name: "Close", exact: true }).click();
  await frame.getByRole("button", { name: "Chia sẻ", exact: true }).click();
  await frame.getByRole("textbox", { name: "Link chỉnh sửa", exact: true }).waitFor();
  await frame.getByRole("switch", { name: "Cho phép chỉnh sửa", exact: true }).click();
  await frame.getByRole("textbox", { name: "Link chỉnh sửa", exact: true }).waitFor({ state: "hidden" });
  assert.equal((await recipientContext.request.get(editApi)).status(), 404);
  assert.equal((await recipientContext.request.put(editApi, { headers: jsonHeaders, data: { snapshot, expectedRev: latest.revision } })).status(), 404);
  assert.equal((await recipientContext.request.get(playApi)).status(), 200);
  await frame.getByRole("switch", { name: "Cho phép chỉnh sửa", exact: true }).click();
  const newEdit = frame.getByRole("textbox", { name: "Link chỉnh sửa", exact: true });
  await newEdit.waitFor();
  assert.notEqual(await newEdit.inputValue(), editLink, "Re-enabling edit must issue a different link");
  await frame.getByRole("button", { name: "Thu hồi tất cả link", exact: true }).click();
  await frame.getByRole("button", { name: "Tạo link chia sẻ", exact: true }).waitFor();
  assert.equal((await recipientContext.request.get(playApi)).status(), 404);
  await viewer.reload();
  await viewFrame.getByRole("alert").filter({ hasText: "đã bị thu hồi" }).waitFor();
  assert.deepEqual(errors, []);
  console.log("PASS: owner can revoke editing, rotate it on re-enable, and revoke all links; revoked recipients see a clear message; no runtime errors.");

  // A picture game must carry its selected image/theme/music across browsers.
  const imageProject = await owner.locator("iframe").evaluate((el) => JSON.parse(el.contentWindow.localStorage.getItem("eventplay-studio")).state.projects.find((p) => p.moduleId === "jigsaw"));
  await frame.getByRole("button", { name: "Close", exact: true }).click();
  await owner.locator("iframe").evaluate((el, p) => { el.contentWindow.location.hash = `/games/jigsaw/${p.id}`; }, imageProject);
  await frame.getByRole("combobox").nth(1).selectOption("music-calm");
  await frame.getByRole("button", { name: "Chia sẻ", exact: true }).click();
  await frame.getByRole("button", { name: "Tạo link chia sẻ", exact: true }).click();
  const imageLink = await frame.getByRole("textbox", { name: "Link chơi", exact: true }).inputValue();
  const imageShare = await (await recipientContext.request.get(apiFor(imageLink))).json();
  assert.equal(imageShare.snapshot.project.moduleId, "jigsaw");
  assert.equal(imageShare.snapshot.themes[0].id, imageProject.themeId);
  assert.equal(imageShare.snapshot.audio.find((a) => a.id === "music-calm").src, "synth:music-calm");
  imageShare.snapshot.project.config.image = asset.url;
  const pictureUpdate = await ownerContext.request.post(base + "/api/game/shares", {
    headers: { ...jsonHeaders, Authorization: "Bearer " + ownerSession.access_token },
    data: bodyFor(imageShare.snapshot, false, imageShare.revision),
  });
  assert.equal(pictureUpdate.status(), 200);
  await viewer.goto(imageLink);
  await viewFrame.getByRole("button", { name: /Đã hiểu|Got it/ }).click();
  await viewFrame.getByRole("button", { name: /Đã hiểu|Got it/ }).waitFor({ state: "hidden" });
  await viewFrame.locator('img[src^="data:image/png;base64,"]').first().waitFor();
  await viewer.screenshot({ path: path.join(shots, "shared-picture-game.png") });
  assert.deepEqual(accountWrites, []);
  assert.deepEqual(errors, []);
  console.log("PASS: a picture game opens with a Supabase-hosted image, theme and synth music; mobile share controls fit the viewport; no account sync.");
})().catch(async (error) => {
  // Never print URLs, tokens, passwords, response bodies or account records.
  console.error("Game sharing regression failed:", error.name, String(error.message).replace(/https?:\/\/[^\s]+/g, "[url]"));
  if (activePage && !activePage.isClosed()) await activePage.screenshot({ path: path.join(shots, "failure.png") });
  process.exitCode = 1;
}).finally(async () => {
  if (browser) await browser.close();
  for (const id of created) {
    const { data: files } = await admin.storage.from("game-assets").list(id);
    if (files?.length) await admin.storage.from("game-assets").remove(files.map((f) => id + "/" + f.name));
    await admin.auth.admin.deleteUser(id);
  }
});
