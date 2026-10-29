// node --test scripts/test-invite-pdf.cjs — synthetic PDFs, no storage writes/mail.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { PDFDocument, PDFName, degrees } = require('pdf-lib');
const sharp = require('sharp');
function load(file, mocks = {}) {
  const mod = { exports: {} };
  const source = ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true } }).outputText;
  new Function('require', 'module', 'exports', source)(name => Object.hasOwn(mocks, name) ? mocks[name] : require(name), mod, mod.exports);
  return mod.exports;
}
const core = load('src/lib/invite-pdf.ts');
const template = load('src/lib/email-template.ts');
const vector = load('src/lib/invite-pdf-vector.ts', { './invite-pdf': core });
const fontCatalog = load('src/lib/overlay-fonts.ts');
const loadFont = async (id, bold) => readFileSync(fontCatalog.overlayFontFile(id, bold, 'public/fonts'));
function serverRenderer(source) {
  return load('src/lib/server/email-pdf.ts', {
    '@/lib/invite-pdf-vector': vector,
    './invite-fonts': { loadInviteFont: loadFont },
    './invite-pdf-source': { fetchInvitePdf: async () => source },
  });
}
const pdf = { url: 'https://storage.example.test/storage/v1/object/public/survey-uploads/original.pdf', page: 2, pageCount: 3, name: 'invite.pdf' };
async function fixture(rotation = 0) {
  const doc = await PDFDocument.create();
  for (const [w, h] of [[300, 400], [500, 300], [250, 600]]) {
    const page = doc.addPage([w, h]); page.drawText(`Original page ${doc.getPageCount()}`, { x: 20, y: 100 });
  }
  doc.getPage(1).setRotation(degrees(rotation));
  doc.getPage(1).setCropBox(10, 20, 470, 260);
  return doc.save();
}
function streams(doc, page) {
  const contents = page.node.Contents();
  return (contents?.asArray?.() || [contents]).filter(Boolean).map(ref => Buffer.from(doc.context.lookup(ref).getContents()).toString('base64'));
}
async function layer() { return sharp({ create: { width: 470, height: 260, channels: 4, background: { r: 255, g: 0, b: 0, alpha: 0.3 } } }).png().toBuffer(); }

test('all pages, original content streams, dimensions, crop and rotation survive; only selected page receives a layer', async () => {
  for (const rotation of [0, 90, 180, 270]) {
    const source = await fixture(rotation), snapshot = source.slice(), before = await PDFDocument.load(source);
    const bytes = await core.stampInvitePdf(source, await layer(), pdf), after = await PDFDocument.load(bytes);
    assert.equal(after.getPageCount(), 3);
    for (let i = 0; i < 3; i++) {
      const a = before.getPage(i), b = after.getPage(i);
      assert.deepEqual(b.getSize(), a.getSize()); assert.deepEqual(b.getCropBox(), a.getCropBox()); assert.deepEqual(b.getRotation(), a.getRotation());
      const previous = streams(before, a), current = streams(after, b);
      if (i !== 1) assert.deepEqual(current, previous);
      else { for (const stream of previous) assert.ok(current.includes(stream)); assert.ok(current.length > previous.length); assert.ok(b.node.Resources().lookup(PDFName.of('XObject')).keys().length); }
    }
    assert.deepEqual(source, snapshot, 'source fixture remains unmodified');
  }
});

test('template roundtrip keeps PDF metadata and old images remain legacy', () => {
  const overlay = { imageUrl: 'https://storage.example.test/preview.jpg', width: 940, height: 520, fields: [], pdf };
  const serialized = template.serializeEmailTemplate({ v: 1, blocks: [], overlay, mode: 'overlay' });
  assert.deepEqual(template.parseEmailTemplate(serialized).overlay.pdf, pdf);
  const { pdf: ignored, ...legacy } = overlay;
  assert.equal(template.normalizeOverlay(legacy).pdf, undefined);
  for (const patch of [{ page: 0 }, { page: 4 }, { page: 1.5 }, { pageCount: 101 }, { url: 'http://example.test/x' }]) assert.throws(() => core.validateInvitePdf({ ...pdf, ...patch }));
});

test('missing pages and invalid PDF never silently become one-page exports', async () => {
  await assert.rejects(core.stampInvitePdf(await fixture(), await layer(), { ...pdf, pageCount: 4 }), /Số trang/);
  await assert.rejects(core.stampInvitePdf(Buffer.from('not pdf'), await layer(), pdf));
});

test('real server renderer produces transparent name/QR layer without fetching a flattened background', async () => {
  const fonts = load('src/lib/overlay-fonts.ts');
  const renderer = load('src/lib/email-overlay.ts', {
    '@/lib/overlay-fonts': fonts,
    '@/lib/server/supabase-admin': { createSupabaseAdmin: () => null },
    '@/lib/server/custom-fonts': {},
  });
  const overlay = { imageUrl: 'https://never-fetch.example.test/image', width: 940, height: 520, fields: [
    { id: 'name', kind: 'text', token: '{{name}}', x: 10, y: 10, w: 60, h: 15, fontSize: 30 },
    { id: 'qr', kind: 'qr', token: '{{qr_image}}', x: 70, y: 60, w: 20, h: 20 },
  ] };
  const bytes = await renderer.composeInviteImage(overlay, { name: 'Nguyễn Văn An' }, 'https://example.test/checkin/test', true);
  const image = sharp(bytes), meta = await image.metadata();
  assert.equal(meta.format, 'png'); assert.equal(meta.hasAlpha, true);
  assert.equal((await sharp(bytes).extract({ left: 0, top: 0, width: 1, height: 1 }).raw().toBuffer())[3], 0);
  assert.ok((await image.stats()).channels[3].max > 0);
  const blank = await renderer.composeInviteImage({ ...overlay, fields: [] }, {}, '', true);
  assert.equal((await sharp(blank).stats()).channels[3].max, 0);
});

test('server email PDF preserves empty pages; legacy image background gains embedded vector text', async () => {
  const source = await fixture(), server = serverRenderer(source);
  const overlay = { imageUrl: 'https://storage.example.test/preview.jpg', width: 470, height: 260, fields: [], pdf };
  const output = await PDFDocument.load(await server.composeInvitePdf(overlay, {}, ''));
  assert.equal(output.getPageCount(), 3);
  const before = await PDFDocument.load(source);
  for (let i = 0; i < 3; i++) assert.deepEqual(streams(before, before.getPage(i)), streams(output, output.getPage(i)));
  const oldFetch = global.fetch;
  global.fetch = async () => new Response(await layer());
  try {
    const legacy = { ...overlay, pdf: undefined, fields: [{ id: 'name', kind: 'text', token: '{{name}}', x: 10, y: 10, w: 80, h: 15 }] };
    const result = await PDFDocument.load(await server.composeInvitePdf(legacy, { name: 'Nguyễn Văn An' }, ''));
    assert.equal(result.getPageCount(), 1);
    assert.ok(result.getPage(0).node.Resources().lookup(PDFName.of('Font')).keys().length);
  } finally { global.fetch = oldFetch; }
});

test('legacy page stays on its original page; active edits/deletion override cached fields', () => {
  const field = { id: 'name', kind: 'text', token: '{{name}}', x: 10, y: 10, w: 50, h: 10 };
  const current = { imageUrl: 'https://example.test/page2.jpg', width: 940, height: 520, fields: [field], pdf };
  assert.deepEqual(Object.keys(core.getInvitePdfPages(current)), ['2']);
  const other = { imageUrl: 'https://example.test/page1.jpg', width: 600, height: 800, fields: [{ ...field, id: 'qr', kind: 'qr', token: '{{qr_image}}' }] };
  const edited = { ...current, fields: [], pdf: { ...pdf, pages: { 1: other, 2: { ...other, fields: [field] } } } };
  const pages = core.getInvitePdfPages(edited);
  assert.equal(pages[1].fields[0].kind, 'qr'); assert.deepEqual(pages[2].fields, []);
  core.validateInvitePdfOverlay(edited);
  for (const bad of [{ ...edited, pdf: { ...pdf, pages: { 4: other } } }, { ...edited, pdf: { ...pdf, pages: [] } }, { ...edited, pdf: { ...pdf, pages: { 1: { ...other, width: 0 } } } }]) assert.throws(() => core.validateInvitePdfOverlay(bad));
});

test('server and browser share vector output on independent pages, with embedded subset fonts and no raster layers', async () => {
  const source = await fixture();
  const qr = { id: 'qr', kind: 'qr', token: '{{qr_image}}', x: 70, y: 60, w: 20, h: 20 };
  const name = { id: 'name', kind: 'text', token: '{{name}}', x: 10, y: 10, w: 50, h: 10 };
  const first = { imageUrl: 'https://example.test/1.jpg', width: 600, height: 800, fields: [qr] };
  const second = { imageUrl: 'https://example.test/2.jpg', width: 940, height: 520, fields: [name] };
  const overlay = { ...second, pdf: { ...pdf, pages: { 1: first } } };
  const before = await PDFDocument.load(source), after = await PDFDocument.load(await serverRenderer(source).composeInvitePdf(overlay, { name: 'Nguyễn An' }, 'https://example.test/checkin/1'));
  assert.equal(after.getPageCount(), 3);
  assert.deepEqual(streams(before, before.getPage(2)), streams(after, after.getPage(2)));
  for (const i of [0,1]) {
    assert.ok(streams(after, after.getPage(i)).length > streams(before, before.getPage(i)).length);
    assert.equal(after.getPage(i).node.Resources().lookup(PDFName.of('XObject'))?.keys().length || 0, 0, 'no bitmap overlay');
  }
  const fonts = after.getPage(1).node.Resources().lookup(PDFName.of('Font'));
  const embedded = fonts.keys().map(key => fonts.lookup(key)).find(font => font.get(PDFName.of('Subtype')).toString() === '/Type0');
  assert.ok(embedded);
  const descendant = after.context.lookup(embedded.lookup(PDFName.of('DescendantFonts')).get(0));
  const descriptor = descendant.lookup(PDFName.of('FontDescriptor'));
  assert.ok(descriptor.get(PDFName.of('FontFile2')) || descriptor.get(PDFName.of('FontFile3')), 'font program is embedded');
});

test('all bundled font weights and custom fonts embed; missing glyphs and failed font reads fail closed', async () => {
  const source = await fixture();
  const field = { id: 'name', kind: 'text', token: '{{name}}', x: 5, y: 20, w: 90, h: 15, fontSize: 36 };
  const overlay = { imageUrl: '', width: 940, height: 520, fields: [field], pdf };
  for (const family of fontCatalog.OVERLAY_FONTS) for (const bold of [false,true]) {
    const bytes = await vector.renderVectorInvitePdf({ ...overlay, fields: [{ ...field, fontFamily: family.id, bold }] }, { name: 'Đặng Nguyễn Thị Mỹ Hằng – ễ ứ ạ ỹ ộ ă ơ ư đ' }, '', loadFont, { original: source });
    assert.equal((await PDFDocument.load(bytes)).getPageCount(), 3);
    assert.ok(bytes.length < 150000, 'font subsets stay compact');
  }
  await vector.renderVectorInvitePdf({ ...overlay, fields: [{ ...field, fontFamily: 'custom:test', bold: true }] }, { name: 'Nguyễn An' }, '', loadFont, { original: source });
  await assert.rejects(vector.renderVectorInvitePdf(overlay, { name: 'Nguyễn An' }, '', async () => { throw new Error('missing font'); }, { original: source }), /missing font/);
  await assert.rejects(vector.renderVectorInvitePdf(overlay, { name: '😀' }, '', loadFont, { original: source }), /thiếu ký tự/);
});

test('browser and server font loaders retain uploaded font bytes and fail when unavailable', async () => {
  const regular = readFileSync('public/fonts/NotoSans-Regular.ttf');
  const oldFetch = global.fetch, requests = [];
  global.fetch = async url => { requests.push(url); return new Response(regular); };
  try {
    const client = load('src/lib/invite-fonts-client.ts', {
      './custom-fonts-client': { fetchCustomFonts: async () => [{ id: 'test', url: '/signed-font-test' }] },
      './overlay-fonts': fontCatalog,
    });
    const loader = client.createInviteFontLoader();
    assert.deepEqual(Buffer.from(await loader('custom:test', false)), regular);
    await loader('custom:test', false);
    await loader('noto-serif', true);
    assert.deepEqual(requests, ['/signed-font-test', '/fonts/NotoSerif-Bold.ttf']);
    await assert.rejects(loader('custom:missing', false), /font tùy chỉnh/);
    const server = load('src/lib/server/invite-fonts.ts', {
      '../overlay-fonts': fontCatalog,
      './supabase-admin': { createSupabaseAdmin: () => ({}) },
      './custom-fonts': { resolveCustomFontFile: async (_, id) => id === 'test' ? { file: 'public/fonts/NotoSans-Regular.ttf' } : null },
    });
    assert.deepEqual(await server.loadInviteFont('custom:test', false), regular);
    await assert.rejects(server.loadInviteFont('custom:missing', false), /font tùy chỉnh/);
  } finally { global.fetch = oldFetch; }
});

test('original PDF fetch is storage-scoped, bounded and fails closed', async () => {
  const oldFetch = global.fetch, oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage.example.test';
  const source = load('src/lib/server/invite-pdf-source.ts', { '@/lib/invite-pdf': core });
  let calls = 0;
  global.fetch = async (url, options) => { calls++; assert.equal(options.redirect, 'error'); return new Response('fixture'); };
  try {
    for (const url of ['https://evil.test/x.pdf', 'http://storage.example.test/x', 'https://storage.example.test/not-storage', 'https://user:pass@storage.example.test/storage/v1/object/public/survey-uploads/x']) await assert.rejects(source.fetchInvitePdf(url));
    assert.equal(calls, 0);
    assert.equal((await source.fetchInvitePdf(pdf.url)).toString(), 'fixture');
    global.fetch = async () => new Response('oversized', { headers: { 'content-length': String(core.MAX_INVITE_PDF_BYTES + 1) } });
    await assert.rejects(source.fetchInvitePdf(pdf.url), /10MB/);
    global.fetch = async () => new Response('', { status: 404 });
    await assert.rejects(source.fetchInvitePdf(pdf.url), /Không tải/);
  } finally { global.fetch = oldFetch; if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl; }
});

test('save API checks auth, keeps original metadata and rejects invalid page/storage before writing', async () => {
  const oldUrl = process.env.NEXT_PUBLIC_SUPABASE_URL, oldKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://storage.example.test'; process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'test-only';
  let role = 'owner', written = null;
  const client = { auth: { getUser: async () => ({ data: { user: { email: 'owner@example.test' } } }) }, from(table) {
    const q = { select: () => q, ilike: () => q, eq: () => q, maybeSingle: async () => ({ data: { role, active: true } }), update: patch => { written = patch; return q; }, then: done => Promise.resolve({ error: null }).then(done) }; return q;
  } };
  const route = load('src/app/api/admin/forms/[id]/pdf/route.ts', { 'next/server': { NextResponse: { json: (value, options) => Response.json(value, options) } }, '@supabase/supabase-js': { createClient: () => client }, '@/lib/invite-pdf': core });
  const overlay = { imageUrl: 'https://storage.example.test/preview.jpg', width: 470, height: 260, fields: [], pdf };
  const post = (value, auth = true) => route.POST(new Request('https://example.test/api', { method: 'POST', headers: { 'content-type': 'application/json', ...(auth ? { authorization: 'Bearer test-only' } : {}) }, body: JSON.stringify({ pdf_template: value, pdf_attach_email: true }) }), { params: Promise.resolve({ id: 'survey' }) });
  try {
    assert.equal((await post(overlay, false)).status, 401);
    role = 'viewer'; assert.equal((await post(overlay)).status, 403); role = 'owner';
    for (const patch of [{ page: 0 }, { page: 4 }, { url: 'https://other.test/x.pdf' }]) assert.equal((await post({ ...overlay, pdf: { ...pdf, ...patch } })).status, 400);
    assert.equal(written, null);
    assert.equal((await post(overlay)).status, 200); assert.deepEqual(written.pdf_template, overlay);
    assert.equal((await post({ ...overlay, pdf: undefined })).status, 200);
  } finally { if (oldUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL; else process.env.NEXT_PUBLIC_SUPABASE_URL = oldUrl; if (oldKey === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY; else process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = oldKey; }
});
