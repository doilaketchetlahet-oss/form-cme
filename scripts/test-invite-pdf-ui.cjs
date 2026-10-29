// Start app on 3001. MAIL_MERGE_UI_DEPS may point to external Playwright.
// Synthetic PDF/auth/storage/registrations only; no real writes or email.
const assert = require('node:assert/strict');
const { readFileSync, mkdirSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { PDFDocument, degrees, rgb } = require('pdf-lib');
const JSZip = require('jszip');
const ts = require('typescript');
const sharp = require('sharp');
const extra = process.env.MAIL_MERGE_UI_DEPS ? createRequire(path.join(process.env.MAIL_MERGE_UI_DEPS, 'package.json')) : require;
const { chromium } = extra('playwright');
require('@next/env').loadEnvConfig(process.cwd(), false, { info() {}, error() {} });
const base = process.env.INVITE_PDF_E2E_BASE || 'http://localhost:3001';
const host = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).host, ref = host.split('.')[0];
const shots = path.join(tmpdir(), 'form-cme-invite-pdf-ui'); mkdirSync(shots, { recursive: true });
const user = { id: randomUUID(), email: 'pdf-test@example.test', aud: 'authenticated', role: 'authenticated', user_metadata: {}, app_metadata: {} };
const token = `${Buffer.from('{"alg":"HS256"}').toString('base64url')}.${Buffer.from(JSON.stringify({ sub: user.id, exp: Math.floor(Date.now()/1000)+3600, role: 'authenticated' })).toString('base64url')}.test-only`;
const session = { access_token: token, refresh_token: 'test-only', expires_at: Math.floor(Date.now()/1000)+3600, expires_in: 3600, token_type: 'bearer', user };
const surveyId = randomUUID(), responseId = randomUUID();
let browser;
(async () => {
  const doc = await PDFDocument.create();
  for (const [width, height] of [[400,500], [500,300], [300,600]]) {
    const page = doc.addPage([width,height]);
    page.drawText(`ORIGINAL PAGE ${doc.getPageCount()}`, { x: 20, y: height - 40, size: 18 });
    page.drawRectangle({ x: 15, y: 15, width: 30, height: 30, color: rgb(0,0.5,0.8) });
  }
  doc.getPage(1).setRotation(degrees(90));
  doc.getPage(1).setCropBox(10,10,480,280);
  const source = Buffer.from(await doc.save());
  let saved = null, uploads = 0, failSource = false;
  const assets = new Map();
  browser = await chromium.launch({ headless: true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {}) });
  const context = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
  await context.addInitScript(({ ref, session }) => localStorage.setItem(`sb-${ref}-auth-token`, JSON.stringify(session)), { ref, session });
  await context.route(`https://${host}/**`, async route => {
    const req = route.request(), url = new URL(req.url());
    let data = [];
    if (url.pathname.startsWith('/storage/')) {
      if (req.method() === 'POST') {
        uploads++;
        const form = await new Response(req.postDataBuffer(), { headers: { 'content-type': req.headers()['content-type'] } }).formData();
        const file = [...form.values()].find(value => typeof value !== 'string');
        assert.ok(file);
        const key = url.pathname.replace('/storage/v1/object/', '/storage/v1/object/public/');
        assets.set(key, { content: Buffer.from(await file.arrayBuffer()), type: file.type });
        return route.fulfill({ json: { Key: key } });
      }
      const asset = assets.get(url.pathname);
      return route.fulfill(asset && !(failSource && asset.type === 'application/pdf') ? { body: asset.content, contentType: asset.type } : { status: 404, body: 'missing' });
    }
    if (url.pathname.includes('/auth/')) data = user;
    if (url.pathname.includes('/admin_members')) data = { role: 'owner', active: true };
    if (url.pathname.endsWith('/surveys')) data = { id: surveyId, title: 'PDF multi-page test', pdf_template: saved, pdf_attach_email: true };
    if (url.pathname.endsWith('/survey_questions')) data = [{ id: 'name', text: 'Họ và tên', type: 'text', position: 0 }];
    if (url.pathname.endsWith('/survey_responses')) data = [{ id: responseId, email: 'guest@example.test', answers: { name: 'Nguyễn Văn An' } }];
    return route.fulfill({ json: data });
  });
  await context.route('**/api/admin/fonts**', route => route.fulfill({ json: { ok: true, fonts: [] } }));
  await context.route(`**/api/admin/forms/${surveyId}/pdf`, async route => { saved = route.request().postDataJSON().pdf_template; return route.fulfill({ json: { ok: true } }); });
  await context.route('**/__fixture_pdf.mjs', route => route.fulfill({ contentType: 'text/javascript', body: readFileSync(require.resolve('pdfjs-dist/build/pdf.mjs')) }));
  await context.route('**/qr-scanner-worker.min.js', route => route.fulfill({ contentType: 'text/javascript', body: readFileSync('node_modules/qr-scanner/qr-scanner-worker.min.js') }));
  const page = await context.newPage(), errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(`${base}/admin/forms/${surveyId}/pdf`);
  await page.getByText('Tải PDF gốc', { exact: true }).waitFor();
  await page.locator('input[accept="application/pdf"]').setInputFiles({ name: 'three-pages.pdf', mimeType: 'application/pdf', buffer: source });
  const select = page.getByLabel('Trang đang chỉnh sửa', { exact: true });
  await select.waitFor().catch(async error => { console.error(await page.locator('body').innerText()); throw error; });
  assert.equal(await select.locator('option').count(), 3);
  assert.equal(uploads, 2);
  const original = [...assets.values()].find(asset => asset.type === 'application/pdf');
  assert.deepEqual(original.content, source);
  await page.getByRole('button', { name: 'QR', exact: true }).click();
  await select.selectOption('2');
  await page.waitForFunction(() => document.querySelector('select')?.value === '2');
  await page.getByText('Đang sửa trang 2.', { exact: false }).waitFor();
  await page.getByRole('button', { name: 'Tên', exact: true }).click();
  await select.selectOption('1');
  await page.getByText('Đang sửa trang 1.', { exact: false }).waitFor();
  assert.match(await select.locator('option[value="1"]').innerText(), /1 trường/);
  assert.match(await select.locator('option[value="2"]').innerText(), /1 trường/);
  await select.selectOption('2');
  await page.getByRole('button', { name: 'Lưu mẫu', exact: true }).click();
  await page.getByText('Đã lưu mẫu PDF thư mời.', { exact: true }).waitFor();
  assert.equal(saved.pdf.page, 2); assert.equal(saved.pdf.pageCount, 3); assert.equal(saved.fields.length, 1);
  assert.equal(saved.fields[0].kind, 'text'); assert.equal(saved.pdf.pages['1'].fields[0].kind, 'qr');
  await page.reload(); await select.waitFor(); assert.equal(await select.inputValue(), '2');
  await page.screenshot({ path: path.join(shots, 'desktop.png'), fullPage: true });
  await page.setViewportSize({ width: 375, height: 812 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: path.join(shots, 'mobile.png'), fullPage: true });
  const downloading = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Xuất PDF (ZIP)', exact: true }).click();
  const download = await downloading, zip = await JSZip.loadAsync(readFileSync(await download.path()));
  const output = await Object.values(zip.files)[0].async('nodebuffer');
  assert.equal((await PDFDocument.load(output)).getPageCount(), 3);
  // Render real PDF output, compare every untouched page pixel-for-pixel.
  const render = async (bytes, scale = 1) => page.evaluate(async ({ bytes, base, scale }) => {
    const pdfjs = await import(`${base}/__fixture_pdf.mjs`); pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
    const task = pdfjs.getDocument({ data: Uint8Array.from(bytes) }); const doc = await task.promise; const images = [];
    for (let n = 1; n <= doc.numPages; n++) {
      const p = await doc.getPage(n), viewport = p.getViewport({ scale });
      const canvas = document.createElement('canvas'); canvas.width = viewport.width; canvas.height = viewport.height;
      await p.render({ canvas, canvasContext: canvas.getContext('2d'), viewport }).promise;
      images.push(canvas.toDataURL('image/png'));
    }
    await task.destroy(); return images;
  }, { bytes: [...bytes], base, scale });
  const before = await render(source), after = await render(output);
  assert.notEqual(after[0], before[0]); assert.equal(after[2], before[2]); assert.notEqual(after[1], before[1]);
  writeFileSync(path.join(shots, 'export-page-1.png'), Buffer.from(after[0].split(',')[1], 'base64'));
  writeFileSync(path.join(shots, 'export-page-2.png'), Buffer.from(after[1].split(',')[1], 'base64'));
  const extract = async bytes => page.evaluate(async ({ bytes, base }) => {
    const pdfjs = await import(`${base}/__fixture_pdf.mjs`);
    const task = pdfjs.getDocument({ data: Uint8Array.from(bytes) }); const doc = await task.promise, result = [];
    for (let n = 1; n <= doc.numPages; n++) result.push((await (await doc.getPage(n)).getTextContent()).items.map(item => item.str).join(' '));
    await task.destroy(); return result;
  }, { bytes: [...bytes], base });
  assert.match((await extract(output))[1], /Nguyễn Văn An/, 'Vietnamese is selectable PDF text, not pixels');
  const zoomed = (await render(output, 4))[1];
  writeFileSync(path.join(shots, 'vector-name-400pct.png'), Buffer.from(zoomed.split(',')[1], 'base64'));
  await page.addScriptTag({ path: path.join(__dirname, '../node_modules/qr-scanner/qr-scanner.umd.min.js') });
  const decode = image => page.evaluate(async src => (await QrScanner.scanImage(src, { returnDetailedScanResult: true })).data, image);
  assert.equal(new URL(await decode(after[0])).pathname, `/checkin/${responseId}`);
  // Shared stamp geometry: transparent red marker should remain top-left for every rotation.
  const mod = { exports: {} };
  new Function('require','module','exports', ts.transpileModule(readFileSync('src/lib/invite-pdf.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(require,mod,mod.exports);
  for (const angle of [0,90,180,270]) {
    const rotated = await PDFDocument.load(source); rotated.getPage(1).setRotation(degrees(angle));
    const w = angle % 180 ? 280 : 480, h = angle % 180 ? 480 : 280;
    const layer = await sharp({create:{width:w,height:h,channels:4,background:{r:0,g:0,b:0,alpha:0}}}).composite([{input:await sharp({create:{width:20,height:20,channels:4,background:'red'}}).png().toBuffer(),left:0,top:0}]).png().toBuffer();
    const stamped = await mod.exports.stampInvitePdf(await rotated.save(),layer,saved.pdf);
    const image = (await render(stamped))[1];
    const pixel = await sharp(Buffer.from(image.split(',')[1],'base64')).extract({left:5,top:5,width:1,height:1}).removeAlpha().raw().toBuffer();
    assert.deepEqual([...pixel], [255,0,0], `rotation ${angle}`);
  }
  // Exercise the real vector renderer's crop/rotation mapping and font shaping.
  const vectorModule = { exports: {} };
  new Function('require','module','exports', ts.transpileModule(readFileSync('src/lib/invite-pdf-vector.ts','utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText)(name => name === './invite-pdf' ? mod.exports : require(name),vectorModule,vectorModule.exports);
  for (const [index, angle] of [0,90,180,270].entries()) {
    const rotated = await PDFDocument.load(source); rotated.getPage(1).setRotation(degrees(angle));
    const width = angle % 180 ? 560 : 960, height = angle % 180 ? 960 : 560;
    const name = 'Đặng Nguyễn Thị Mỹ Hằng';
    const layout = { imageUrl: '', width, height, pdf: { ...saved.pdf, pages: {} }, fields: [
      { id: 'name', kind: 'text', token: '{{name}}', x: 10, y: 15, w: 80, h: 20, fontSize: 40, bold: !!(index % 2), align: ['left','center','right','center'][index] },
      { id: 'qr', kind: 'qr', token: '{{qr_image}}', x: 30, y: 50, w: 35, h: 40, align: 'center' },
    ] };
    const file = ['NotoSans','NotoSerif','PlayfairDisplay','BeVietnamPro'][index];
    const bytes = await vectorModule.exports.renderVectorInvitePdf(layout, { name }, 'https://example.test/checkin/vector', async (_,bold) => readFileSync(`public/fonts/${file}-${bold ? 'Bold' : 'Regular'}.ttf`), { original: await rotated.save() });
    assert.ok((await extract(bytes))[1].includes(name), `rotation ${angle}: correct Vietnamese text`);
    const images = await render(bytes, 2);
    assert.equal(await decode(images[1]), 'https://example.test/checkin/vector', `rotation ${angle}: readable QR`);
    writeFileSync(path.join(shots, `vector-rotation-${angle}.png`), Buffer.from(images[1].split(',')[1], 'base64'));
  }
  failSource = true;
  await select.selectOption('3'); await page.getByRole('alert').filter({ hasText: 'Không tải được PDF gốc' }).waitFor();
  assert.equal(await select.inputValue(), '2'); assert.equal(saved.pdf.page, 2);
  failSource = false;
  // Deleting the last field on one page must not resurrect a cached snapshot.
  await select.selectOption('1');
  const card = page.locator('fieldset');
  await card.locator('[style*="left:"]').first().click();
  await card.locator('button').filter({ has: page.locator('svg.lucide-trash2') }).click();
  await select.selectOption('2'); await select.selectOption('1');
  assert.match(await select.locator('option[value="1"]').innerText(), /0 trường/);
  assert.match(await select.locator('option[value="2"]').innerText(), /1 trường/);
  await select.selectOption('2');
  await page.locator('input[accept="application/pdf"]').setInputFiles({ name: 'broken.pdf', mimeType: 'application/pdf', buffer: Buffer.from('not-a-pdf') });
  await page.getByRole('alert').waitFor();
  assert.equal(await select.inputValue(), '2'); assert.equal(saved.pdf.pageCount, 3);
  await page.setViewportSize({ width: 812, height: 375 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  assert.deepEqual(errors, []);
  console.log(`PASS: original upload, select page, fields, save/reload, ZIP all pages, selectable Vietnamese vector text, 400% render, vector QR decode, unchanged rendered pages, rotated/cropped placement, mobile, failed switch preserves state. Screenshots: ${shots}`);
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(async () => browser?.close());
