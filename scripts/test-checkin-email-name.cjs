// node --test scripts/test-checkin-email-name.cjs
// Uses synthetic registrations and a mocked provider. No network or real email.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

function load(file, mocks = {}) {
  const mod = { exports: {} };
  const source = ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX },
  }).outputText;
  new Function('require', 'module', 'exports', source)((name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), mod, mod.exports);
  return mod.exports;
}
const merge = load('src/lib/email-template.ts');
const questions = [
  { id: 'name-id', text: 'Họ và tên', type: 'text' },
  { id: 'title-id', text: 'Học hàm/học vị', type: 'text' },
  { id: 'email-id', text: 'Email', type: 'text' },
  { id: 'address-id', text: 'Địa chỉ', type: 'text' },
];
// JSONB can return title before name regardless of the form / insertion order.
const answers = { 'title-id': 'BS', 'address-id': 'Hà Nội', 'email-id': 'guest@example.test', 'name-id': 'Nguyễn Văn An' };

test('Vietnamese and English name labels select the saved full name rather than the first JSONB value', () => {
  for (const label of ['Họ và tên', 'HỌ VÀ TÊN (*)', 'Họ tên', 'Ho va ten', 'Ho ten', 'Họ & tên', 'Hovaten', 'Họ và tên đại biểu', 'Full name', 'Fullname', 'Name', 'Tên', 'Tên khách mời', 'Tên của bạn là gì?']) {
    assert.equal(merge.findAttendeeName(answers, [{ ...questions[0], text: label }, ...questions.slice(1)]), 'Nguyễn Văn An', label);
  }
});

test('missing or blank explicit name does not use academic title, email or address as the greeting', () => {
  for (const value of ['', '   ', null, undefined]) {
    const missing = { ...answers, 'name-id': value };
    assert.equal(merge.findAttendeeName(missing, questions), '');
    assert.equal(merge.buildMergeValues({ answers: missing, questions }, false).name, 'bạn');
  }
  assert.equal(merge.findAttendeeName({ custom: 'Khách cũ' }), 'Khách cũ');
});

test('full name is trimmed, escaped for HTML and kept separate from the title merge field', () => {
  const input = { answers: { ...answers, 'name-id': '  Nguyễn <An> & Bình  ' }, questions };
  const html = merge.buildMergeValues(input, true), text = merge.buildMergeValues(input, false);
  assert.equal(html.name, 'Nguyễn &lt;An&gt; &amp; Bình');
  assert.equal(text.name, 'Nguyễn <An> & Bình');
  assert.equal(merge.fillMergeTokens('Xin chào {{hoc_ham_hoc_vi}} {{name}},', text), 'Xin chào BS Nguyễn <An> & Bình,');
});

const renderer = load('src/lib/server/email-react.tsx', { '@/lib/email-template': merge });
function mailHarness({ provider = 'resend', body = '', storedAnswers = answers } = {}) {
  const deliveries = [], statuses = [];
  const db = {
    from(table) {
      const query = {
        select() { return query; }, eq() { return query; }, order() { return query; }, contains() { return query; }, limit() { return query; },
        update(patch) { statuses.push(patch.email_status); return query; },
        async maybeSingle() {
          return { data: table === 'survey_responses' ? { id: 'response', survey_id: 'survey', answers: storedAnswers, email: 'guest@example.test' }
            : table === 'surveys' ? { title: 'Hội thảo', email_body: body, email_subject: 'Thư mời {{name}}', email_provider: provider }
              : null, error: null };
        },
        then(resolve) { return Promise.resolve({ data: table === 'survey_questions' ? questions : null, error: null }).then(resolve); },
      };
      return query;
    },
  };
  const mail = load('src/lib/server/checkin-email.ts', {
    './supabase-admin': { createSupabaseAdmin: () => db },
    '@/lib/email-template': merge,
    '@/lib/qr-style': { buildQrImagePath: () => '/fixture-qr.png' },
    './email-react': renderer,
    './email-pdf': {},
    '@/lib/email-overlay': {},
    './qr-image': { QR_INLINE_CONTENT_ID: 'qr-fixture', qrStyleFromBranding: () => ({}), renderQrPng: async () => Buffer.from('qr-fixture') },
    './email-provider': { resolveProvider: (value) => value || provider, sendEmail: async (payload, channel) => {
      deliveries.push({ ...payload, channel }); return { ok: true, messageId: 'fixture-message', provider: channel };
    } },
    './smtp-accounts': {},
  });
  return { deliveries, statuses, send: (extra = {}) => mail.sendCheckinEmail({ responseId: 'response', origin: 'https://event.example.test', checkinUrl: 'https://event.example.test/checkin/response', ...extra }) };
}

test('actual check-in sender derives its default greeting and subject from saved Họ và tên for both providers', async () => {
  for (const provider of ['resend', 'smtp']) {
    const mail = mailHarness({ provider });
    assert.equal((await mail.send()).ok, true);
    assert.equal(mail.deliveries.length, 1);
    const delivery = mail.deliveries[0];
    assert.match(delivery.html, /Xin chào <strong>Nguyễn Văn An<\/strong>,/);
    assert.equal(delivery.subject, 'Thư mời Nguyễn Văn An');
    assert.match(delivery.text, /Xin chào Nguyễn Văn An/);
    assert.equal(delivery.channel, provider);
    assert.deepEqual(mail.statuses, ['pending', 'sent']);
  }
});

test('stored registration name overrides a stale caller guess; empty saved name falls back to bạn', async () => {
  const mail = mailHarness();
  await mail.send({ name: 'BS' });
  assert.match(mail.deliveries[0].html, /Xin chào <strong>Nguyễn Văn An<\/strong>,/);
  const blank = mailHarness({ storedAnswers: { ...answers, 'name-id': '' } });
  await blank.send({ name: 'BS' });
  assert.match(blank.deliveries[0].html, /Xin chào <strong>bạn<\/strong>,/);
});

test('block templates keep the title and full name distinct through the real React email renderer', async () => {
  const body = JSON.stringify({ v: 1, blocks: [{ id: 'greeting', type: 'text', text: 'Xin chào {{hoc_ham_hoc_vi}} {{name}},' }] });
  const mail = mailHarness({ body });
  await mail.send();
  assert.match(mail.deliveries[0].html, /Xin chào BS Nguyễn Văn An,/);
  assert.match(mail.deliveries[0].text, /Xin chào BS Nguyễn Văn An,/);
});
