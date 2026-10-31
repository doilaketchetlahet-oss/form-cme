// Start app on port 3001 (MAIL_MERGE_E2E_BASE override). Uses the same Playwright
// setup as test-mail-merge-ui.cjs. All auth/data APIs are mocked; no real mail/writes.
const assert = require('node:assert/strict');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { mkdirSync, readFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const ts = require('typescript');
const XLSX = require('xlsx');
const uiRequire = process.env.MAIL_MERGE_UI_DEPS ? createRequire(path.join(process.env.MAIL_MERGE_UI_DEPS, 'package.json')) : require;
const { chromium } = uiRequire('playwright');
const mod = { exports: {} };
new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path.join(__dirname, '../src/lib/mail-merge.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText)(require, mod, mod.exports);
const merge = mod.exports;
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const base = process.env.MAIL_MERGE_E2E_BASE || 'http://localhost:3001';
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host, ref = host.split('.')[0];
const user = { id: randomUUID(), email: 'admin@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {}, created_at: new Date().toISOString() };
const token = `${Buffer.from('{"alg":"HS256","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now() / 1000) + 3600, role: 'authenticated' })).toString('base64url')}.test-only`;
const session = { access_token: token, refresh_token: 'test-only', token_type: 'bearer', expires_in: 3600, expires_at: Math.floor(Date.now() / 1000) + 3600, user };
const book = XLSX.utils.book_new();
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Email', 'Họ tên'], ['old@example.test', 'Khách cũ']]), 'Lưu trữ');
const sheetA = XLSX.utils.aoa_to_sheet([['Email', 'Họ tên', 'Mã'], ['an@example.test', 'Nguyễn An', 12], ['binh@example.test', 'Trần Bình', 13]]);
sheetA.C2.z = sheetA.C3.z = '0000';
XLSX.utils.book_append_sheet(book, sheetA, 'Trường A');
const sheetB = XLSX.utils.aoa_to_sheet([]);
XLSX.utils.sheet_add_aoa(sheetB, [['Họ tên', 'Đơn vị', 'Email', 'Mã'], ['Lê Chi', 'Đại học B', 'chi@example.test', '0099']], { origin: 'B3' });
sheetB['!ref'] = 'B3:E4';
XLSX.utils.book_append_sheet(book, sheetB, 'Trường B');
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([]), 'Rỗng');
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([['Email', 'Họ tên']]), 'Chỉ tiêu đề');
XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet([Array.from({ length: 61 }, (_, i) => `Cột ${i}`), Array(61).fill('x')]), 'Quá nhiều cột');
book.Workbook = { Sheets: book.SheetNames.map((name, index) => ({ name, Hidden: index === 0 ? 1 : 0 })) };
const upload = (bookType = 'xlsx', source = book) => ({ name: `truong.${bookType === 'biff8' ? 'xls' : bookType}`, mimeType: 'application/octet-stream', buffer: XLSX.write(source, { type: 'buffer', bookType }) });
const shots = path.join(tmpdir(), 'form-cme-mail-merge-sheets-ui'); mkdirSync(shots, { recursive: true });
let browser;

async function run(viewport) {
  let saved = null;
  const actions = [], errors = [], unexpected = [];
  const context = await browser.newContext({ viewport });
  await context.addInitScript(({ ref, session }) => { if (window.top === window) localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)); }, { ref, session });
  await context.route('**/*', async (route) => {
    const request = route.request(), url = new URL(request.url());
    if (url.host === host) return route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.pathname.endsWith('/admin_members') ? { role: 'owner', active: true } : url.pathname.startsWith('/auth/') ? user : []) });
    if (url.pathname === '/api/admin/mail-merge') {
      if (request.method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify(url.searchParams.has('id') ? { ok: true, campaign: saved } : { ok: true, campaigns: saved ? [saved] : [] }) });
      const data = request.postDataJSON(); actions.push(data.action);
      assert.equal(data.action, 'save', 'Import/switching must never start sending');
      saved = { id: data.id, name: data.name, template: data.template, status: 'draft', created_at: new Date().toISOString(), smtp_public: { provider: 'resend', ...data.resend }, recipients: merge.prepareMergeRecipients(data.template, data.rows).map(({ source_row, ...row }) => ({ ...row, sourceRow: source_row, id: randomUUID() })) };
      return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, id: data.id }) });
    }
    if (url.pathname === '/api/admin/fonts' && request.method() === 'GET') return route.fulfill({ contentType: 'application/json', body: JSON.stringify({ ok: true, fonts: [] }) });
    if (url.origin === new URL(base).origin && !url.pathname.startsWith('/api/')) return route.continue();
    unexpected.push(`${request.method()} ${url.origin}${url.pathname}`); return route.abort();
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(base + '/admin/tools/mail-merge');
    await page.getByRole('heading', { name: 'Gửi mail theo trường', exact: true }).waitFor();
    const file = page.locator('input[type=file]').first(), selector = page.getByLabel('Sheet Excel', { exact: true });
    const subject = page.getByLabel('Tiêu đề thư', { exact: true }), body = page.getByLabel('Nội dung khối 1');
    const changeSheet = async (name, accept = true) => {
      await selector.selectOption(name);
      const dialog = page.getByRole('alertdialog'); await dialog.waitFor();
      await dialog.getByRole('button', { name: accept ? 'Đổi sheet' : 'Huỷ', exact: true }).click();
      await dialog.waitFor({ state: 'hidden' });
    };
    await file.setInputFiles(upload());
    await page.getByText('Chờ gửi: 2', { exact: true }).waitFor();
    assert.equal(await selector.inputValue(), 'Trường A', 'Default skips hidden archive');
    assert.deepEqual(await selector.locator('option').allTextContents(), ['Lưu trữ (ẩn)', 'Trường A', 'Trường B', 'Rỗng', 'Chỉ tiêu đề', 'Quá nhiều cột']);
    await page.getByText('Sửa dữ liệu đã nhập', { exact: true }).click();
    assert.equal(await page.getByLabel('Dữ liệu Mã', { exact: true }).inputValue(), '0012');
    await page.getByLabel('Dữ liệu Họ tên', { exact: true }).fill('Tên đã sửa');
    await subject.fill('Mời {{ho_ten}}'); await body.fill('Kính gửi {{ho_ten}} · {{email}}');
    await page.getByLabel('CC mail (tùy chọn)', { exact: true }).fill('review@example.test');
    await changeSheet('Trường B', false);
    assert.equal(await selector.inputValue(), 'Trường A');
    assert.equal(await page.getByLabel('Dữ liệu Họ tên', { exact: true }).inputValue(), 'Tên đã sửa');
    assert.equal(actions.length, 0);
    await page.getByLabel('Người nhận xem trước').selectOption('1');
    await changeSheet('Trường B');
    await page.getByText('Chờ gửi: 1', { exact: true }).waitFor();
    assert.equal(await selector.inputValue(), 'Trường B');
    assert.equal(await page.getByLabel('Người nhận xem trước').inputValue(), '0');
    assert.equal(await page.getByLabel(/^Cột Email/).inputValue(), 'email');
    assert.equal(await page.getByLabel('Dữ liệu Họ tên', { exact: true }).inputValue(), 'Lê Chi');
    assert.equal(await page.getByLabel('Dữ liệu Đơn vị', { exact: true }).inputValue(), 'Đại học B');
    assert.equal(await subject.inputValue(), 'Mời {{ho_ten}}');
    assert.equal(await body.inputValue(), 'Kính gửi {{ho_ten}} · {{email}}');
    assert.equal(await page.getByLabel('CC mail (tùy chọn)', { exact: true }).inputValue(), 'review@example.test');
    await page.frameLocator('iframe[title="Xem trước thư cá nhân hóa"]').getByText('Kính gửi Lê Chi · chi@example.test', { exact: true }).waitFor();
    for (const name of ['Rỗng', 'Chỉ tiêu đề', 'Quá nhiều cột']) {
      await selector.selectOption(name);
      await page.getByRole('alert').filter({ hasText: `Không nhập được sheet “${name}”` }).waitFor();
      assert.equal(await selector.inputValue(), 'Trường B');
      assert.equal(await page.getByLabel('Dữ liệu Họ tên', { exact: true }).inputValue(), 'Lê Chi');
    }
    await page.getByRole('button', { name: 'Lưu chiến dịch', exact: true }).click();
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'Gửi / tiếp tục' && !b.disabled));
    assert.equal(saved.recipients.length, 1); assert.equal(saved.recipients[0].email, 'chi@example.test');
    assert.deepEqual(saved.template.columns.map((c) => c.label), ['Họ tên', 'Đơn vị', 'Email', 'Mã']);
    assert.equal(saved.template.subject, 'Mời {{ho_ten}}'); assert.equal(saved.smtp_public.cc, 'review@example.test');
    await changeSheet('Lưu trữ');
    assert.equal(await page.getByLabel('Dữ liệu Họ tên', { exact: true }).inputValue(), 'Khách cũ');
    assert.equal(await page.getByRole('button', { name: 'Gửi / tiếp tục', exact: true }).isEnabled(), false, 'Switch requires saving');
    assert.equal(saved.recipients[0].email, 'chi@example.test', 'Local switching never updates the saved batch implicitly');
    await selector.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(shots, `${viewport.width}.png`) });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true);

    // Restoring a saved batch does not retain a previous local workbook.
    await page.reload(); await page.getByLabel('Chiến dịch đã lưu').selectOption(saved.id);
    await page.getByText('Chờ gửi: 1', { exact: true }).waitFor();
    assert.equal(await selector.count(), 0);
    assert.equal(await subject.inputValue(), 'Mời {{ho_ten}}');
    saved.status = 'paused';
    await page.getByRole('button', { name: 'Cập nhật trạng thái', exact: true }).click();
    await page.getByRole('button', { name: 'Chỉnh sửa / tạo đợt mới', exact: true }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Import Excel / CSV', exact: true }).count(), 0);
    await page.getByRole('button', { name: 'Chiến dịch mới', exact: true }).click();
    await file.setInputFiles(upload('biff8'));
    await selector.waitFor();
    assert.equal(await selector.inputValue(), 'Trường A');
    await changeSheet('Trường B');
    await page.getByText('truong.xls · Trường B · 1 dòng · 4 cột', { exact: true }).waitFor();
    await file.setInputFiles({ name: 'contacts.csv', mimeType: 'text/csv', buffer: Buffer.from('Email,Họ tên\ncsv@example.test,Khách CSV') });
    await page.getByText('contacts.csv · 1 dòng · 2 cột', { exact: true }).waitFor();
    assert.equal(await selector.count(), 0, 'CSV clears old workbook choices');
    await file.setInputFiles(upload()); await selector.waitFor();
    await page.getByText('Hoặc dán danh sách từ Excel / CSV', { exact: true }).click();
    await page.getByPlaceholder('Email\tHọ tên\tTrường\nkhach@example.com\tNguyễn Văn A\tĐại học A', { exact: true }).fill('Email\tHọ tên\npaste@example.test\tKhách dán');
    await page.getByRole('button', { name: 'Đọc danh sách', exact: true }).click();
    assert.equal(await selector.count(), 0, 'Pasting clears old workbook choices');
    const recovery = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(recovery, XLSX.utils.aoa_to_sheet([]), 'Trống');
    XLSX.utils.book_append_sheet(recovery, XLSX.utils.aoa_to_sheet([['Email', 'Họ tên'], ['recovered@example.test', 'Khách khác']]), 'Dữ liệu');
    await file.setInputFiles(upload('xlsx', recovery));
    await page.getByRole('alert').filter({ hasText: 'Không nhập được sheet “Trống”' }).waitFor();
    assert.equal(await selector.inputValue(), 'Trống');
    await page.getByText('Danh sách đã dán · 1 dòng · 2 cột', { exact: true }).waitFor();
    await changeSheet('Dữ liệu');
    await page.getByText('truong.xlsx · Dữ liệu · 1 dòng · 2 cột', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Chiến dịch mới', exact: true }).click();
    await page.getByRole('alertdialog').getByRole('button', { name: 'Tạo mới', exact: true }).click();
    assert.equal(await selector.count(), 0, 'New campaigns clear old workbook choices');
  } finally { await context.close(); }
  assert.deepEqual(errors, []); assert.deepEqual(unexpected, []);
  console.log(`${viewport.width}px: sheet selection, formatting, replacement/cancel/errors, save/preview/locking and responsive layout passed (no real sending).`);
}

(async () => {
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  await run({ width: 1440, height: 1100 });
  await run({ width: 390, height: 844 });
})().catch((error) => { console.error(error); process.exitCode = 1; }).finally(async () => { await browser?.close(); });
