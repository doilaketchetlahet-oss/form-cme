// node --test scripts/test-qr-export.cjs (synthetic registrations, mocked fetch).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
function load(file, mocks = {}, globals = {}) {
  const mod = { exports: {} };
  const source = ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText;
  new Function('require', 'module', 'exports', ...Object.keys(globals), source)((id) => Object.hasOwn(mocks, id) ? mocks[id] : require(id), mod, mod.exports, ...Object.values(globals));
  return mod.exports;
}
const template = load('src/lib/email-template.ts');
const style = load('src/lib/qr-style.ts');
const mocks = { './email-template': template, './qr-style': style };
const { qrExportLabel, uniqueQrFilename } = load('src/lib/qr-export.ts', mocks);
const questions = [
  { id: 'degree', text: 'Học hàm học vị', type: 'text' },
  { id: 'unit', text: 'Tên đơn vị', type: 'text' },
  { id: 'name', text: 'Họ và tên', type: 'text' },
  { id: 'email', text: 'Email', type: 'text' },
  { id: 'phone', text: 'Số điện thoại', type: 'phone' },
];
const row = (answers, email) => ({ id: 'response-id', answers, email });

test('filenames use the named full-name field even after degree/company and regardless of answer key order', () => {
  const answers = { degree: 'BS', unit: 'Đơn vị A', name: ' Nguyễn Văn An ', email: 'an@example.test', phone: '0900123456' };
  assert.equal(qrExportLabel(row(answers, 'stored@example.test'), questions), 'Nguyễn Văn An');
  for (const text of ['Họ và tên', 'Họ tên', 'Ho va ten', 'Full name', 'Họ và tên đại biểu']) {
    assert.equal(qrExportLabel(row(answers), questions.map((q) => q.id === 'name' ? { ...q, text } : q)), 'Nguyễn Văn An');
  }
});

test('missing/empty name uses full email, then phone, then another visible answer, then response ID', () => {
  const answers = { degree: 'BS', name: '', email: 'all.name@example.test', phone: '0900123456' };
  assert.equal(qrExportLabel(row(answers), questions), 'all.name@example.test');
  assert.equal(qrExportLabel(row(answers, 'stored@example.test'), questions), 'stored@example.test');
  assert.equal(qrExportLabel(row(answers), questions.filter((q) => q.id !== 'name')), 'all.name@example.test');
  assert.equal(qrExportLabel(row({ degree: 'BS', phone: '0900123456' }), questions), '0900123456');
  assert.equal(qrExportLabel(row({ degree: 'BS' }), questions), 'BS');
  assert.equal(qrExportLabel(row({}), questions), 'response-id');
  assert.equal(qrExportLabel(row({ old: 'legacy@example.test' }), []), 'legacy@example.test');
  assert.equal(qrExportLabel(row({}), []), 'response-id');
});

test('choice labels are decoded; uploads, face data, signatures and URLs do not become filenames', () => {
  assert.equal(qrExportLabel(row({ name: 0 }), [{ id: 'name', text: 'Họ tên', type: 'choice', options: ['Khách A', 'Khách B'] }]), 'Khách A');
  const fields = ['face_checkin', 'signature', 'file_upload', 'section', 'image_banner'].map((type) => ({ id: type, text: 'Họ tên', type }));
  assert.equal(qrExportLabel(row(Object.fromEntries(fields.map((q) => [q.id, 'private-data']))), fields), 'response-id');
  assert.equal(qrExportLabel(row({ upload: 'https://example.test/file' }), [{ id: 'upload', text: 'Tài liệu', type: 'text' }]), 'response-id');
});

test('safe Unicode filenames never overwrite duplicates, suffix-shaped names or case variants', () => {
  const used = new Set();
  assert.deepEqual(['An', 'An_2', 'An', 'an', 'Nguyễn An', 'Nguyễn An'].map((name) => uniqueQrFilename(name, used)), ['An.png', 'An_2.png', 'An_3.png', 'an_4.png', 'Nguyễn An.png', 'Nguyễn An_2.png']);
  assert.equal(uniqueQrFilename(' a/b:c*?"<>|. ', new Set()), 'a b c.png');
  assert.equal(uniqueQrFilename('CON', new Set()), '_CON.png');
  assert.equal(uniqueQrFilename('', new Set()), 'khach.png');
});

test('ZIP PNG fetch uses saved branding and rejects failed/invalid image responses without a logo fallback', async () => {
  const requests = [];
  let response = new Response(new Blob(['fixture-png']), { headers: { 'Content-Type': 'image/png' } });
  const exporter = load('src/lib/qr-export.ts', mocks, { fetch: async (url) => { requests.push(new URL(url, 'https://example.test')); return response; } });
  await exporter.fetchBrandedQrPng('https://example.test/checkin/test', 512, { logoEnabled: false, darkColor: '#112233', accentColor: '#445566', lightColor: '#ffffff', moduleRadius: 12 });
  assert.equal(requests[0].searchParams.get('logo'), '0');
  assert.equal(requests[0].searchParams.get('dark'), '#112233');
  assert.equal(requests[0].searchParams.get('radius'), '12');
  assert.equal(requests[0].searchParams.get('format'), 'png');
  response = new Response('Server error', { status: 500 });
  await assert.rejects(exporter.fetchBrandedQrPng('x', 512, null), /Không tạo được/);
  response = new Response('<html>Error</html>', { headers: { 'Content-Type': 'text/html' } });
  await assert.rejects(exporter.fetchBrandedQrPng('x', 512, null), /Không tạo được/);
  response = new Response(new Blob([]), { headers: { 'Content-Type': 'image/png' } });
  await assert.rejects(exporter.fetchBrandedQrPng('x', 512, null), /trống/);
  assert.equal(requests.length, 4);
});
