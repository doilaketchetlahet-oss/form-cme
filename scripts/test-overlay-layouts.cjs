// Real layout transforms; synthetic invitations only, no API/storage writes.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const { readFileSync } = require('node:fs');
const ts = require('typescript');
function load(file, mocks = {}) {
  const mod = { exports: {} };
  new Function('require','module','exports',ts.transpileModule(readFileSync(file,'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText)(name => Object.hasOwn(mocks,name) ? mocks[name] : require(name),mod,mod.exports);
  return mod.exports;
}
const template = load('src/lib/email-template.ts');
const pdf = load('src/lib/invite-pdf.ts');
const layouts = load('src/lib/overlay-layouts.ts', { './email-template': template, './invite-pdf': pdf });
const field = { id: 'name', kind: 'text', token: '{{name}}', x: 15, y: 22, w: 60, h: 12, fontSize: 36, fontFamily: 'noto-serif', bold: true, align: 'center', color: '#012345' };
const page = { imageUrl: 'https://example.test/source.jpg', width: 800, height: 1000, fields: [field] };
const original = { url: 'https://example.test/source.pdf', name: 'source.pdf', page: 2, pageCount: 3, pages: { 1: { ...page, fields: [{ ...field, id: 'qr', token: '{{qr_image}}', kind: 'qr' }] } } };

test('reuse position/font over another background, scaled to its saved preview width, without changing source', () => {
  const current = { ...page, imageUrl: 'https://example.test/current.jpg', width: 1600, fields: [] };
  const snapshot = structuredClone(page), result = layouts.applyOverlayLayout(current, page, 'positions');
  assert.equal(result.imageUrl, current.imageUrl); assert.equal(result.width, current.width);
  for (const key of ['x','y','w','h','align','bold','fontFamily','color','token']) assert.equal(result.fields[0][key], field[key]);
  assert.equal(result.fields[0].fontSize, 72); assert.notEqual(result.fields[0].id, field.id);
  assert.deepEqual(page, snapshot);
});

test('multi-page reuse preserves current PDF/assets, resets old fields and keeps saved page layouts', () => {
  const source = { ...page, pdf: original }, snapshot = structuredClone(source);
  const target = { ...page, imageUrl: 'https://example.test/current2.jpg', pdf: { ...original, url: 'https://example.test/current.pdf', pages: { 1: { ...page, imageUrl: 'https://example.test/current1.jpg' }, 3: page } } };
  const result = layouts.applyOverlayLayout(target, source, 'positions');
  assert.equal(result.pdf.url, target.pdf.url); assert.equal(result.imageUrl, target.imageUrl);
  assert.equal(result.pdf.pages[1].imageUrl, target.pdf.pages[1].imageUrl);
  assert.equal(result.pdf.pages[1].fields[0].kind, 'qr'); assert.equal(result.fields[0].token, '{{name}}');
  assert.deepEqual(result.pdf.pages[3].fields, []);
  assert.deepEqual(source, snapshot);
});

test('full mode can open saved image/PDF into empty editor as an independent copy', () => {
  const source = { ...page, pdf: original };
  const result = layouts.applyOverlayLayout(null, source, 'full');
  assert.equal(result.pdf.url, source.pdf.url); assert.equal(result.pdf.pageCount, 3);
  assert.notEqual(result.fields[0].id, source.fields[0].id);
  result.fields[0].x = 50;
  assert.equal(source.fields[0].x, 15);
  assert.equal(layouts.applyOverlayLayout(null, page, 'full').imageUrl, page.imageUrl);
});

test('incompatible or malformed layouts fail before changing the target', () => {
  const source = { ...page, pdf: original };
  const current = { ...page, pdf: { ...original, page: 1, pageCount: 1, pages: {} } };
  const before = structuredClone(current);
  assert.throws(() => layouts.applyOverlayLayout(current, source, 'positions'), /không đủ trang/);
  assert.throws(() => layouts.applyOverlayLayout(page, source, 'positions'), /nhiều trang/);
  assert.throws(() => layouts.applyOverlayLayout(null, page, 'positions'), /Tải nền/);
  assert.throws(() => layouts.applyOverlayLayout(page, { ...page, fields: [{ ...field, x: 101 }] }, 'full'), /không hợp lệ/);
  assert.deepEqual(current, before);
});
