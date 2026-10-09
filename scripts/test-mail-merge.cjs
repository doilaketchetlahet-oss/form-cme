// node --test scripts/test-mail-merge.cjs
// Optional PostgreSQL tests: set MAIL_MERGE_TEST_DEPS to a temporary package
// directory containing @electric-sql/pglite@0.5.8.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomUUID } = require('node:crypto');
const { test } = require('node:test');
const ts = require('typescript');
function loadSource(file, mocks = {}, globals = {}) {
  const { outputText } = ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true }, fileName: file,
  });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', ...Object.keys(globals), outputText)((name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports, ...Object.values(globals));
  return module.exports;
}
const merge = loadSource('src/lib/mail-merge.ts');
const tracking = loadSource('src/lib/server/mail-merge-tracking.ts');
const table = merge.mergeTable(merge.parseMergeText('Email\tHọ tên\tTrường\r\nan@example.test\tNguyễn An\tĐại học A\r\nbinh@example.test\tTrần Bình\tĐại học B'));
const template = { columns: table.columns, emailColumn: table.emailColumn, subject: 'Gửi {{ho_ten}} tại {{truong}}', blocks: [{ id: 'body', type: 'text', text: 'Kính gửi {{ho_ten}}\n{{truong}}', url: '' }] };
const account = { host: 'smtp.example.test', port: 587, secure: false, user: 'user', password: 'test-only-secret', fromEmail: 'sender@example.test', fromName: 'Ban tổ chức', replyTo: '' };
const owner = 'owner@example.test';
const reports = merge.mergeTable([
  ['Email', 'Họ tên', 'Bài báo cáo'],
  ['an@example.test', 'Nguyễn An', 'Nghiên cứu tim mạch'],
  [' AN@EXAMPLE.TEST ', 'Nguyễn An', 'Nghiên cứu hô hấp'],
  ['invalid', 'Nguyễn An', 'Không có Email hợp lệ'],
]);
const reportsTemplate = { columns: reports.columns, emailColumn: reports.emailColumn, subject: 'Báo cáo {{bai_bao_cao}}', blocks: [{ id: 'body', type: 'text', text: 'Kính gửi {{ho_ten}}\n{{bai_bao_cao}}', url: '' }] };

test('CSV/TSV/semicolon and Excel matrices preserve formatted values and generate unique Vietnamese fields', () => {
  assert.deepEqual(table.columns.map((c) => c.key), ['email', 'ho_ten', 'truong']);
  assert.equal(table.rows[1].sourceRow, 3);
  const commas = merge.parseMergeText('\uFEFFEmail,Họ tên,Ghi chú\n"a@example.test","A, B","Hai\ndòng"');
  assert.equal(commas[1][1], 'A, B'); assert.equal(commas[1][2], 'Hai\ndòng');
  assert.deepEqual(merge.parseMergeText('Email;Tên\na@example.test;A'), [['Email', 'Tên'], ['a@example.test', 'A']]);
  const duplicates = merge.mergeTable([['Email', 'Họ tên', 'Họ-tên', '1A', ''], ['a@example.test', 'A', 'B', '0012', 'tail']]);
  assert.deepEqual(duplicates.columns.map((c) => c.key), ['email', 'ho_ten', 'ho_ten_2', 'cot_1a', 'cot_5']);
  assert.equal(duplicates.rows[0].fields.cot_1a, '0012');
  assert.throws(() => merge.parseMergeText('Email,Name\n"unclosed'), /ngoặc kép/);
  assert.throws(() => merge.mergeTable([['Email']]), /ít nhất/);
});

test('merge render personalizes each row, escapes spreadsheet HTML and does not recursively expand user data', () => {
  assert.equal(merge.renderMergeMail(template, table.rows[0].fields).subject, 'Gửi Nguyễn An tại Đại học A');
  assert.equal(merge.renderMergeMail(template, table.rows[1].fields).subject, 'Gửi Trần Bình tại Đại học B');
  const rendered = merge.renderMergeMail(template, { email: 'a@example.test', ho_ten: '<img src=x onerror=alert(1)>', truong: '{{ho_ten}}' });
  assert.ok(rendered.html.includes('&lt;img')); assert.ok(!rendered.html.includes('<img src=x'));
  assert.ok(rendered.text.includes('{{ho_ten}}'));
  assert.equal(merge.renderMergeMail(template, { ...table.rows[0].fields, ho_ten: 'A\r\nB' }).subject, 'Gửi A B tại Đại học A');
  assert.throws(() => merge.renderMergeMail({ ...template, blocks: [{ id: 'link', type: 'button', text: 'Mở', url: '{{truong}}' }] }, { ...table.rows[0].fields, truong: 'javascript:alert(1)' }), /HTTP/);
  assert.throws(() => merge.renderMergeMail({ ...template, blocks: [{ id: 'img', type: 'image', text: 'Ảnh', url: 'file:///etc/passwd' }] }, table.rows[0].fields), /HTTP/);
});

test('open tracking uses an opaque token, embeds no recipient data, and renders a 1px pixel only when enabled', () => {
  const token = 'a'.repeat(64);
  const hash = tracking.hashMailMergeOpenToken(token);
  assert.match(hash, /^[a-f0-9]{32}$/);
  assert.notEqual(hash, tracking.hashMailMergeOpenToken('b'.repeat(64)));
  const pixelUrl = 'https://mail.example.test/api/mail-merge/open/00000000-0000-4000-8000-000000000000?token=' + token;
  const rendered = merge.renderMergeMail(template, table.rows[0].fields, { trackingPixelUrl: pixelUrl });
  assert.ok(rendered.html.includes('width="1" height="1"'));
  assert.ok(rendered.html.includes('mail.example.test'));
  assert.ok(!rendered.text.includes('mail.example.test'));
  assert.ok(!merge.renderMergeMail(template, table.rows[0].fields).html.includes('mail-merge/open'));
  assert.ok(readFileSync(path.join(__dirname, '../supabase/mail-merge.sql'), 'utf8').includes('record_mail_merge_open'));
  assert.ok(readFileSync(path.join(__dirname, '../supabase/mail-merge.sql'), 'utf8').includes('open_token_hash'));
});

test('open tracking route always returns a cache-free pixel and records only a token digest', async () => {
  const calls = [];
  const previousServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'test-only-service-key';
  const openRoute = loadSource('src/app/api/mail-merge/open/[id]/route.ts', {
    '@/lib/server/supabase-admin': { createSupabaseAdmin: () => ({ rpc: async (name, args) => { calls.push({ name, args }); return { data: true, error: null }; } }) },
    '@/lib/server/mail-merge-tracking': tracking,
  });
  const token = 'a'.repeat(64);
  const valid = await openRoute.GET(new Request(`https://example.test/api/mail-merge/open/00000000-0000-4000-8000-000000000000?token=${token}`), { params: Promise.resolve({ id: '00000000-0000-4000-8000-000000000000' }) });
  assert.equal(valid.status, 200);
  assert.equal(valid.headers.get('content-type'), 'image/gif');
  assert.match(valid.headers.get('cache-control') || '', /no-store/);
  assert.equal(calls[0].name, 'record_mail_merge_open');
  assert.equal(calls[0].args.p_token_hash, tracking.hashMailMergeOpenToken(token));
  const invalid = await openRoute.GET(new Request('https://example.test/api/mail-merge/open/nope?token=x'), { params: Promise.resolve({ id: 'nope' }) });
  assert.equal(invalid.status, 200); assert.equal(calls.length, 1);
  if (previousServiceKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceKey;
});

test('validation catches unknown fields, malformed templates and skips invalid/duplicate recipients', () => {
  assert.equal(merge.validateMergeTemplate(template), null);
  assert.match(merge.validateMergeTemplate({ ...template, subject: '{{missing}}' }), /không có/);
  assert.match(merge.validateMergeTemplate({ ...template, columns: [table.columns[0], table.columns[0]] }), /trùng/);
  assert.match(merge.validateMergeTemplate({ ...template, subject: 'bad\nheader' }), /một dòng/);
  const rows = [...table.rows, { sourceRow: 4, fields: { ...table.rows[0].fields, email: 'AN@EXAMPLE.TEST' } }, { sourceRow: 5, fields: { ...table.rows[0].fields, email: 'not-an-email' } }];
  assert.deepEqual(merge.prepareMergeRecipients(template, rows).map((r) => r.status), ['pending', 'pending', 'skipped', 'skipped']);
  assert.equal(merge.isMergeEmail('one@example.test,two@example.test'), false);
  assert.equal(merge.isMergeEmail('Name <one@example.test>'), false);
  assert.throws(() => merge.prepareMergeRecipients(template, [{ sourceRow: 2, fields: { email: ['x'] } }]), /văn bản/);
  assert.throws(() => merge.prepareMergeRecipients(template, [table.rows[0], table.rows[0]]), /số dòng bị trùng/);
  assert.throws(() => merge.prepareMergeRecipients(template, [{ ...table.rows[0], sourceRow: -1 }]), /không hợp lệ/);
});

test('duplicate Email policy preserves the legacy default and allows independent reports per row', () => {
  for (const value of [reportsTemplate, { ...reportsTemplate, duplicateEmailPolicy: 'skip' }]) {
    assert.equal(merge.validateMergeTemplate(value), null);
    const prepared = merge.prepareMergeRecipients(value, reports.rows);
    assert.deepEqual(prepared.map((row) => row.status), ['pending', 'skipped', 'skipped']);
    assert.equal(prepared[1].email, 'an@example.test');
    assert.match(prepared[1].last_error, /trùng/i);
  }
  const allow = { ...reportsTemplate, duplicateEmailPolicy: 'allow' };
  assert.equal(merge.validateMergeTemplate(allow), null);
  const prepared = merge.prepareMergeRecipients(allow, reports.rows);
  assert.deepEqual(prepared.map((row) => row.status), ['pending', 'pending', 'skipped']);
  assert.deepEqual(prepared.slice(0, 2).map((row) => row.email), ['an@example.test', 'an@example.test']);
  assert.equal(prepared[0].fields.ho_ten, prepared[1].fields.ho_ten);
  assert.notEqual(prepared[0].fields.bai_bao_cao, prepared[1].fields.bai_bao_cao);
  assert.equal(merge.renderMergeMail(allow, prepared[0].fields).subject, 'Báo cáo Nghiên cứu tim mạch');
  assert.equal(merge.renderMergeMail(allow, prepared[1].fields).subject, 'Báo cáo Nghiên cứu hô hấp');
  assert.throws(() => merge.prepareMergeRecipients(allow, [reports.rows[0], reports.rows[0]]), /số dòng bị trùng/);
  for (const duplicateEmailPolicy of ['merge', '', null, true, 1, {}]) {
    assert.match(merge.validateMergeTemplate({ ...reportsTemplate, duplicateEmailPolicy }), /không hợp lệ/);
  }
});

test('bold formatting preserves old plain templates and styles merged values without interpreting recipient data', () => {
  const plain = { ...template, blocks: [{ id: 'body', type: 'text', text: 'Kính gửi **{{ho_ten}}**\n{{truong}}', url: '' }] };
  const legacy = merge.renderMergeMail(plain, table.rows[0].fields);
  assert.ok(legacy.html.includes('**Nguyễn An**'));
  assert.ok(!legacy.html.includes('<strong'));
  const formatted = { ...plain, blocks: [{ ...plain.blocks[0], format: 'markdown' }] };
  assert.equal(merge.validateMergeTemplate(formatted), null);
  const rendered = merge.renderMergeMail(formatted, { ...table.rows[0].fields, ho_ten: '<img src=x> **khách**', truong: '**Dữ liệu nguyên văn**' });
  assert.ok(rendered.html.includes('<strong style="font-weight:700">&lt;img src=x&gt; **khách**</strong>'));
  assert.ok(rendered.html.includes('<br />**Dữ liệu nguyên văn**'));
  assert.equal(rendered.text, 'Kính gửi <img src=x> **khách**\n**Dữ liệu nguyên văn**');
  assert.ok(!rendered.html.includes('<img src=x>'));
  assert.match(merge.validateMergeTemplate({ ...plain, blocks: [{ ...plain.blocks[0], format: 'html' }] }), /không hợp lệ/);
  assert.equal(merge.toggleMergeBold('Nội dung', 0, 0), null);
  const source = 'Kính gửi {{ho_ten}}, hẹn gặp.';
  const bold = merge.toggleMergeBold(source, source.indexOf('ho_ten'), source.indexOf('ho_ten') + 3);
  assert.equal(bold.text, 'Kính gửi **{{ho_ten}}**, hẹn gặp.');
  assert.equal(merge.toggleMergeBold(bold.text, bold.start, bold.end, true).text, source);
  assert.equal(merge.toggleMergeBold('**Đoạn văn**', 0, '**Đoạn văn**'.length, true).text, 'Đoạn văn');
  assert.equal(merge.toggleMergeBold('**A** B', 0, '**A** B'.length, true).text, '**A B**');
  assert.equal(merge.toggleMergeBold('**abcde**', 3, 5, true).text, '**a**bc**de**');
});

test('fresh schema includes the same independent mail merge migration', () => {
  const normalize = (value) => value.replace(/\r\n/g, '\n').trim();
  assert.ok(normalize(readFileSync(path.join(__dirname, '../supabase/schema.sql'), 'utf8')).includes(normalize(readFileSync(path.join(__dirname, '../supabase/mail-merge.sql'), 'utf8'))));
});

test('inline hyperlinks preserve legacy text, personalize author links and escape imported markup', () => {
  const block = { id: 'body', type: 'text', format: 'markdown', text: 'Xem [**{{ho_ten}}**](<https://example.test/?school={{truong}}>) và [Email](mailto:reply@example.test).', url: '' };
  const legacy = merge.renderMergeMail({ ...template, blocks: [block] }, table.rows[0].fields);
  assert.ok(!legacy.html.includes('<a ')); assert.ok(legacy.text.includes('[Nguyễn An]'));
  const linked = { ...template, blocks: [{ ...block, inlineLinks: true }] };
  assert.equal(merge.validateMergeTemplate(linked), null);
  const rendered = merge.renderMergeMail(linked, { ...table.rows[0].fields, ho_ten: '<img src=x> [fake](javascript:x)', truong: 'A&x=" onmouseover="x' });
  assert.equal((rendered.html.match(/<a /g) || []).length, 2);
  assert.ok(rendered.html.includes('<strong style="font-weight:700">&lt;img src=x&gt; [fake](javascript:x)</strong>'));
  assert.ok(rendered.html.includes('school=A&amp;x=&quot; onmouseover=&quot;x'));
  assert.ok(rendered.html.includes('href="mailto:reply@example.test"'));
  assert.ok(rendered.text.includes('Email (mailto:reply@example.test)'));
  assert.ok(!rendered.text.includes('**'));
  const outer = merge.renderMergeMail({ ...template, blocks: [{ ...block, inlineLinks: true, text: '**Trước [Chữ đậm](https://example.test/path_(x)) sau**' }] }, table.rows[0].fields);
  // Parentheses in URLs are represented by the editor with angle delimiters.
  assert.ok(!outer.html.includes('<a '));
  const parenthesized = merge.editMergeLink('', 0, 0, 'Chữ [đậm]', 'https://example.test/path_(x)');
  const output = merge.renderMergeMail({ ...template, blocks: [{ ...block, inlineLinks: true, text: '**' + parenthesized.text + '**' }] }, table.rows[0].fields);
  assert.ok(output.html.includes('href="https://example.test/path_(x)"')); assert.ok(output.text.includes('Chữ [đậm] (https://example.test/path_(x))'));
});

test('hyperlink validation rejects unsafe schemes and values before either mail provider can send', () => {
  const make = (url) => ({ ...template, blocks: [{ id: 'body', type: 'text', text: `[Xem](<${url}>)`, url: '', inlineLinks: true }] });
  for (const url of ['javascript:alert(1)', 'data:text/html,test', 'file:///secret', '/relative']) assert.match(merge.validateMergeTemplate(make(url)), /liên kết|Liên kết/);
  assert.throws(() => merge.editMergeLink('Text', 0, 4, 'Text', 'https://example.test/\nattack'), /hợp lệ/);
  const personalized = make('{{truong}}'); assert.equal(merge.validateMergeTemplate(personalized), null);
  const rows = [{ ...table.rows[0], fields: { ...table.rows[0].fields, truong: 'javascript:alert(1)' } }];
  assert.throws(() => merge.renderMergeMail(personalized, rows[0].fields), /HTTP/);
  assert.equal(merge.prepareMergeRecipients(personalized, rows)[0].status, 'skipped');
  assert.match(merge.validateMergeTemplate(make('{{missing}}')), /không có/);
  assert.match(merge.validateMergeTemplate({ ...template, blocks: [{ ...make('https://example.test').blocks[0], type: 'button', url: 'https://example.test' }] }), /đoạn văn/);
  assert.match(merge.validateMergeTemplate({ ...template, blocks: [{ ...make('https://example.test').blocks[0], inlineLinks: 'true' }] }), /không hợp lệ/);
});

test('hyperlink editing and bold preserve merge tokens, URLs, escaped labels and independent links', () => {
  const source = 'Kính gửi {{ho_ten}}, xem thông tin.';
  const selection = merge.selectMergeLink(source, source.indexOf('ho_ten'), source.indexOf('ho_ten') + 3);
  assert.equal(selection.label, '{{ho_ten}}');
  const added = merge.editMergeLink(source, selection.start, selection.end, selection.label, 'https://example.test/info');
  const existing = merge.selectMergeLink(added.text, added.start + 3, added.start + 3, true);
  assert.equal(existing.existing, true); assert.equal(existing.label, '{{ho_ten}}');
  const updated = merge.editMergeLink(added.text, existing.start, existing.end, existing.label, 'mailto:reply@example.test', true);
  assert.ok(updated.text.includes('mailto:reply@example.test'));
  assert.equal(merge.editMergeLink(updated.text, updated.start, updated.end, existing.label, null, true).text, source);
  const bold = merge.toggleMergeBold(added.text, added.start + 3, added.start + 6, true, true);
  assert.ok(bold.text.includes('[**{{ho_ten}}**](<https://example.test/info>)'));
  assert.equal(merge.toggleMergeBold(bold.text, bold.start, bold.end, true, true).text, added.text);
  assert.equal(merge.toggleMergeBold(added.text, added.text.indexOf('https'), added.text.indexOf('https') + 5, true, true), null);
  const all = merge.toggleMergeBold(added.text, 0, added.text.length, true, true);
  assert.equal(merge.getMergeLinks(all.text)[0].url, 'https://example.test/info');
  const escaped = merge.editMergeLink('', 0, 0, 'A [B]', 'https://example.test');
  const bracket = escaped.text.indexOf('B') - 1;
  const escapedBold = merge.toggleMergeBold(escaped.text, bracket, bracket + 1, true, true);
  assert.equal(merge.getMergeLinks(escapedBold.text).length, 1);
  const two = added.text + ' [Hai](https://example.test/two)';
  assert.throws(() => merge.selectMergeLink(two, 0, two.length, true), /Chọn một/);
  const boundary = merge.selectMergeLink('**foo** bar', 3, 9, false, true);
  assert.equal(boundary.label, '**foo** b');
  const crossing = merge.editMergeLink('**foo** bar', boundary.start, boundary.end, boundary.label, 'https://example.test', false, true);
  const output = merge.renderMergeMail({ ...template, blocks: [{ id: 'body', type: 'text', text: crossing.text, url: '', inlineLinks: true, format: 'markdown' }] }, table.rows[0].fields);
  assert.ok(output.html.includes('<strong style="font-weight:700">foo</strong> b</a>ar'));
});

function smtpHarness() {
  let options, sent, closes = 0, error = null, closeError = false, addresses = [{ address: '8.8.8.8', family: 4 }];
  const smtp = loadSource('src/lib/server/mail-merge-smtp.ts', {
    '@/lib/mail-merge': merge,
    'node:dns/promises': { lookup: async () => addresses },
    nodemailer: { createTransport: (input) => { options = input; return { verify: async () => true, close() { closes++; if (closeError) throw new Error('test cleanup error'); }, async sendMail(mail) { sent = mail; if (error) throw error; return { accepted: [mail.to], messageId: 'test-message' }; } }; } },
  });
  return { smtp, info: () => ({ options, sent, closes }), fail: (e) => { error = e; }, failClose: () => { closeError = true; }, addresses: (items) => { addresses = items; } };
}

test('SMTP credentials are encrypted with owner binding and never require changes to the check-in provider', () => {
  const { smtp } = smtpHarness();
  process.env.MAIL_MERGE_ENCRYPTION_KEY = 'test-only-key';
  const encrypted = smtp.encryptSmtpPassword(account.password, owner);
  assert.ok(!encrypted.includes(account.password));
  assert.equal(smtp.decryptSmtpPassword(encrypted, owner), account.password);
  assert.throws(() => smtp.decryptSmtpPassword(encrypted, 'other@example.test'), /Nhập lại/);
  assert.notEqual(smtp.encryptSmtpPassword(account.password, owner), encrypted);
  assert.throws(() => smtp.validateSmtpAccount({ ...account, fromEmail: 'a@example.test\r\nBcc: other@example.test' }), /không hợp lệ/);
  assert.throws(() => smtp.validateSmtpAccount({ ...account, port: 0 }), /Kiểm tra/);
});

test('SMTP resolves only public addresses, requires TLS and treats an uncertain acceptance as needing review', async () => {
  const h = smtpHarness();
  for (const addr of ['127.0.0.1','10.0.0.1','172.16.1.1','192.168.0.2','169.254.169.254','::1','::ffff:127.0.0.1','fc00::1','fe80::1']) assert.equal(h.smtp.isPublicSmtpAddress(addr), false, addr);
  assert.equal(h.smtp.isPublicSmtpAddress('8.8.8.8'), true);
  const mail = { to: 'a@example.test', subject: 'A', html: '<p>A</p>', text: 'A' };
  assert.equal((await h.smtp.sendMergeSmtp(account, mail)).status, 'sent');
  const { options, sent, closes } = h.info();
  assert.equal(options.host, '8.8.8.8'); assert.equal(options.tls.servername, account.host); assert.equal(options.requireTLS, true);
  assert.equal(sent.disableFileAccess, true); assert.equal(sent.disableUrlAccess, true); assert.equal(closes, 1);
  const attachmentMail = { ...mail, attachments: [{ filename: 'invite.pdf', content: Buffer.from('test-pdf'), contentType: 'application/pdf' }] };
  assert.equal((await h.smtp.sendMergeSmtp(account, attachmentMail)).status, 'sent');
  assert.equal(h.info().sent.attachments[0].filename, 'invite.pdf');
  h.failClose();
  assert.equal((await h.smtp.sendMergeSmtp(account, mail)).status, 'sent');
  h.fail({ code: 'ETIMEDOUT', command: 'DATA' });
  assert.equal((await h.smtp.sendMergeSmtp(account, mail)).status, 'uncertain');
  h.fail({ code: 'ESOCKET', command: '.' });
  assert.equal((await h.smtp.sendMergeSmtp(account, mail)).status, 'uncertain');
  assert.equal(h.smtp.smtpErrorOutcome({ code: 'EAUTH', command: 'AUTH' }).status, 'failed');
  assert.equal(h.smtp.smtpErrorOutcome({ responseCode: 550, command: 'DATA' }).status, 'failed');
  h.addresses([{ address: '127.0.0.1', family: 4 }]);
  assert.equal((await h.smtp.sendMergeSmtp(account, mail)).status, 'failed');
});

const resendAccount = { keySource: 'server', apiKey: '', fromEmail: 'bantochuc@vsot.com.vn', fromName: 'Ban tổ chức', replyTo: '' };
function deliveryHarness(fetchResponse = async () => new Response(JSON.stringify({ id: 'resend-test-message' }), { status: 200 }), smtpOverrides = {}) {
  const { smtp } = smtpHarness(), requests = [];
  const delivery = loadSource('src/lib/server/mail-merge-delivery.ts', {
    '@/lib/mail-merge': merge, './mail-merge-smtp': { ...smtp, ...smtpOverrides },
  }, { process: { env: { RESEND_API_KEY: 're_test_server_key' } }, fetch: async (url, input) => { requests.push({ url, input }); return fetchResponse(url, input); } });
  return { delivery, smtp, requests, sender: delivery.prepareMergeSender({ provider: 'resend', resend: resendAccount }, null, owner).sender };
}

test('sender config preserves legacy SMTP and keeps private Resend keys encrypted and owner-bound', () => {
  const { delivery, smtp } = deliveryHarness();
  const legacy = delivery.prepareMergeSender({ smtp: account }, null, owner);
  assert.equal(legacy.publicAccount.provider, 'smtp');
  assert.equal(smtp.decryptSmtpPassword(legacy.secret, owner), account.password);
  const oldPublic = { ...legacy.publicAccount }; delete oldPublic.provider;
  assert.equal(delivery.restoreMergeSender({ smtp_public: oldPublic, smtp_secret: legacy.secret }, owner).account.password, account.password);
  const server = delivery.prepareMergeSender({ provider: 'resend', resend: { ...resendAccount, apiKey: 're_browser_key_is_ignored' } }, null, owner);
  assert.equal(server.sender.account.apiKey, 're_test_server_key'); assert.equal(server.secret, '');
  assert.equal(Object.hasOwn(server.publicAccount, 'apiKey'), false);
  const privateConfig = { ...resendAccount, keySource: 'private', apiKey: 're_test_private_key' };
  const saved = delivery.prepareMergeSender({ provider: 'resend', resend: privateConfig }, null, owner);
  assert.ok(!JSON.stringify({ public: saved.publicAccount, secret: saved.secret }).includes(privateConfig.apiKey));
  const stored = { smtp_public: saved.publicAccount, smtp_secret: saved.secret };
  assert.equal(delivery.restoreMergeSender(stored, owner).account.apiKey, privateConfig.apiKey);
  assert.throws(() => delivery.restoreMergeSender(stored, 'other@example.test'), /Nhập lại/);
  assert.throws(() => delivery.prepareMergeSender({ smtp: { ...account, password: '' } }, stored, owner), /mật khẩu SMTP/);
  assert.throws(() => delivery.prepareMergeSender({ provider: 'resend', resend: { ...privateConfig, apiKey: '' } }, { smtp_public: legacy.publicAccount, smtp_secret: legacy.secret }, owner), /API key Resend hợp lệ/);
  assert.throws(() => delivery.prepareMergeSender({ provider: 'other', resend: privateConfig }, null, owner), /Kênh/);
  for (const patch of [{ fromEmail: 'x@vsot.com.vn\r\nBcc:x@example.test' }, { fromName: '<x>' }, { replyTo: 'two@example.test,one@example.test' }, { keySource: 'other' }, { apiKey: 're_secret\n' }]) {
    assert.throws(() => delivery.prepareMergeSender({ provider: 'resend', resend: { ...privateConfig, ...patch } }, null, owner));
  }
});

test('Resend sends one personalized message with buffers, tracking, reply-to and an idempotency key', async () => {
  const h = deliveryHarness();
  h.sender.account.fromName = 'Ban "tổ chức"'; h.sender.account.replyTo = 'reply@vsot.com.vn';
  const linkedTemplate = { ...template, blocks: [{ ...template.blocks[0], inlineLinks: true, text: '[{{ho_ten}}](<https://example.test/info>)' }] };
  const mail = { ...merge.renderMergeMail(linkedTemplate, table.rows[0].fields, { trackingPixelUrl: 'https://example.test/api/mail-merge/open/id?token=opaque' }), to: 'an@example.test', attachments: [{ filename: 'invite.pdf', content: Buffer.from('personalized-pdf'), contentType: 'application/pdf' }, { filename: 'slides.pptx', content: Buffer.from('slides') }] };
  assert.deepEqual(await h.delivery.sendMergeMessage(h.sender, mail, 'row/attempt'), { status: 'sent', messageId: 'resend-test-message' });
  assert.equal(h.requests.length, 1);
  const { url, input } = h.requests[0], body = JSON.parse(input.body);
  assert.equal(url, 'https://api.resend.com/emails'); assert.equal(input.method, 'POST');
  assert.equal(input.headers['Idempotency-Key'], 'mail-merge/row/attempt');
  assert.equal(input.headers.Authorization, 'Bearer re_test_server_key');
  assert.equal(body.from, '"Ban \\"tổ chức\\"" <bantochuc@vsot.com.vn>');
  assert.deepEqual(body.to, ['an@example.test']); assert.equal(body.reply_to, 'reply@vsot.com.vn');
  assert.equal(body.subject, 'Gửi Nguyễn An tại Đại học A'); assert.ok(body.html.includes('/api/mail-merge/open/'));
  assert.ok(body.html.includes('href="https://example.test/info"')); assert.equal(body.text, 'Nguyễn An (https://example.test/info)');
  assert.equal(body.attachments[0].content_type, 'application/pdf');
  assert.equal(Buffer.from(body.attachments[0].content, 'base64').toString(), 'personalized-pdf');
  assert.equal(body.attachments[1].filename, 'slides.pptx');
  assert.ok(body.attachments.every((file) => !Object.hasOwn(file, 'path')));
});

test('Resend failures are safe, ambiguous outcomes need review and no request is automatically retried', async () => {
  const mail = { to: 'an@example.test', subject: 'Test', html: '<p>Test</p>', text: 'Test' };
  for (const [status, expected] of [[400,'failed'],[401,'failed'],[403,'failed'],[429,'failed'],[408,'uncertain'],[409,'uncertain'],[500,'uncertain'],[503,'uncertain']]) {
    const h = deliveryHarness(async () => new Response(JSON.stringify({ name: 'daily_quota_exceeded', message: 'provider-secret-data' }), { status }));
    const outcome = await h.delivery.sendMergeMessage(h.sender, mail, 'row/attempt');
    assert.equal(outcome.status, expected, String(status)); assert.ok(!outcome.error.includes('provider-secret-data'));
    assert.equal(h.requests.length, 1);
  }
  for (const response of [async () => { throw new Error('network-secret'); }, async () => new Response('not-json'), async () => new Response(JSON.stringify({ accepted: true }))]) {
    const h = deliveryHarness(response);
    assert.equal((await h.delivery.sendMergeMessage(h.sender, mail, 'row/attempt')).status, 'uncertain'); assert.equal(h.requests.length, 1);
  }
  const h = deliveryHarness();
  assert.equal((await h.delivery.sendMergeMessage(h.sender, { ...mail, attachments: [{ filename: 'x', content: 'https://example.test/file' }] }, 'row/attempt')).status, 'failed');
  assert.equal(h.requests.length, 0);
});

test('Resend checks sending-only keys honestly and verifies full-key domain status without sending mail', async () => {
  const restricted = deliveryHarness(async () => new Response(JSON.stringify({ name: 'restricted_api_key', message: 'This API key is restricted to only send emails' }), { status: 401 }));
  assert.equal((await restricted.delivery.verifyMergeSender(restricted.sender)).limited, true);
  assert.ok(restricted.requests.every((call) => call.url.startsWith('https://api.resend.com/domains')));
  const verified = deliveryHarness(async (url) => new Response(JSON.stringify(url.includes('&after=') ? { data: [{ name: 'VSOT.COM.VN', status: 'verified', capabilities: { sending: 'enabled' } }] } : { data: [{ id: 'domain1', name: 'other.test' }], has_more: true })));
  assert.match((await verified.delivery.verifyMergeSender(verified.sender)).message, /vsot.com.vn/); assert.equal(verified.requests.length, 2);
  for (const body of [{ data: [{ name: 'vsot.com.vn', status: 'pending' }] }, { data: [{ name: 'vsot.com.vn', status: 'verified', capabilities: { sending: 'disabled' } }] }, { data: [{ name: 123 }] }, { invalid: true }]) {
    const h = deliveryHarness(async () => new Response(JSON.stringify(body)));
    await assert.rejects(h.delivery.verifyMergeSender(h.sender));
  }
  const invalid = deliveryHarness(async () => new Response(JSON.stringify({ name: 'restricted_api_key', message: 'inactive' }), { status: 403 }));
  await assert.rejects(invalid.delivery.verifyMergeSender(invalid.sender), /từ chối quyền gửi/);
});

function apiHarness() {
  const id = randomUUID(), recipient = randomUUID(), attempt = randomUUID();
  const stored = { id, owner_email: owner, name: 'Mail merge', template, smtp_public: { ...account, password: undefined }, smtp_secret: 'encrypted-test', status: 'running' };
  let authError = null, sends = [], calls = [], attachmentCalls = [], reject = null, sendError = false;
  let jobs = [{ id: recipient, attempt_id: attempt, email: 'an@example.test', fields: table.rows[0].fields, open_token: 'a'.repeat(64) }];
  const service = {
    from(tableName) {
      const query = { update(value) { calls.push({ name: 'update_account', args: value }); return query; }, select(columns) { query.columns = columns; return query; }, eq(key, value) { if (key === 'owner_email') assert.equal(value, owner); return query; }, order() { return query; }, limit() { return query; }, range() { return query; },
        async maybeSingle() { const publicResult = query.columns === '*' ? stored : Object.fromEntries(query.columns.split(',').map((key) => [key, stored[key]])); return { data: publicResult, error: null }; },
        then(resolve) { return Promise.resolve({ data: tableName === 'mail_merge_recipients' ? [{ id: recipient, source_row: 2, fields: table.rows[0].fields, status: 'sent' }] : [], error: null }).then(resolve); },
      }; return query;
    },
    async rpc(name, args) {
      calls.push({ name, args });
      if (reject) return { data: null, error: reject };
      if (name === 'claim_mail_merge') { const job = jobs.shift(); if (!job) return { data: null, error: null }; const { open_token, ...claimed } = job; return { data: { recipient: claimed, open_token, template: stored.template, smtp_public: stored.smtp_public, smtp_secret: stored.smtp_secret }, error: null }; }
      if (name === 'control_mail_merge') return { data: stored.status, error: null };
      return { data: name === 'revise_mail_merge' ? args.p_id : name === 'save_mail_merge' ? id : true, error: null };
    },
  };
  const transport = deliveryHarness(async (_url, input) => { sends.push({ provider: 'resend', mail: JSON.parse(input.body), headers: input.headers }); if (sendError) throw new Error('test unexpected transport failure'); return new Response(JSON.stringify({ id: 'test-id' })); }, {
    decryptSmtpPassword: () => account.password, encryptSmtpPassword: () => 'ciphertext-test', verifyMergeSmtp: async () => true,
    sendMergeSmtp: async (smtp, mail) => { sends.push({ smtp, mail }); if (sendError) throw new Error('test unexpected transport failure'); return { status: 'sent', messageId: 'test-id' }; },
  });
  const route = loadSource('src/app/api/admin/mail-merge/route.ts', {
    '@/lib/mail-merge': merge,
    '@/lib/server/admin-api': { authorizeAdminApi: async (_request, writable) => { assert.equal(writable, true); return authError || { email: owner, service }; } },
    '@/lib/server/mail-merge-delivery': transport.delivery,
    '@/lib/server/mail-merge-attachments': { resolveMailMergeTemplateAttachments: async (value, fields) => { attachmentCalls.push({ value, fields }); return [{ filename: 'invite.pdf', content: Buffer.from(fields.bai_bao_cao || 'pdf'), contentType: 'application/pdf' }]; } },
  });
  return { id, calls, sends, attachmentCalls, stored, deny: () => { authError = { error: 'Denied', status: 403 }; }, reject: (e) => { reject = e; }, failSend: () => { sendError = true; },
    queue: (rows) => { jobs = rows.map((row, index) => ({ id: randomUUID(), attempt_id: randomUUID(), email: row.email, fields: row.fields, open_token: (index + 1).toString(16).repeat(64) })); },
    post: (data) => route.POST(new Request('https://example.test/api/admin/mail-merge', { method: 'POST', body: JSON.stringify({ id, ...data }) })),
    get: () => route.GET(new Request(`https://example.test/api/admin/mail-merge?id=${id}`)),
  };
}

test('mail API requires writable admins, omits stored passwords and validates before SMTP', async () => {
  const api = apiHarness();
  const view = await (await api.get()).json();
  assert.ok(!JSON.stringify(view).includes('encrypted-test'));
  assert.equal(view.campaign.recipients[0].sourceRow, 2);
  assert.equal(api.calls[0].args.p_action, 'refresh');
  api.calls.length = 0;
  assert.equal((await api.post({ action: 'save', name: 'Test', smtp: account, template: { ...template, subject: '{{missing}}' }, rows: table.rows })).status, 400);
  assert.equal(api.sends.length, 0);
  assert.equal(api.calls.length, 0);
  api.deny();
  assert.equal((await api.post({ action: 'process' })).status, 403);
  assert.equal((await api.get()).status, 403);
});

test('save API retains every report row and rejects unsupported duplicate Email policies', async () => {
  const api = apiHarness();
  const allow = { ...reportsTemplate, duplicateEmailPolicy: 'allow' };
  assert.equal((await api.post({ action: 'save', name: 'Hai bài báo cáo', smtp: account, template: allow, rows: reports.rows })).status, 200);
  const saved = api.calls.find((call) => call.name === 'save_mail_merge').args;
  assert.equal(saved.p_template.duplicateEmailPolicy, 'allow');
  assert.deepEqual(saved.p_rows.map((row) => row.status), ['pending', 'pending', 'skipped']);
  assert.deepEqual(saved.p_rows.map((row) => row.source_row), [2, 3, 4]);
  assert.notEqual(saved.p_rows[0].fields.bai_bao_cao, saved.p_rows[1].fields.bai_bao_cao);
  api.calls.length = 0;
  assert.equal((await api.post({ action: 'save', name: 'Cấu hình cũ', smtp: account, template: reportsTemplate, rows: reports.rows })).status, 200);
  assert.deepEqual(api.calls.find((call) => call.name === 'save_mail_merge').args.p_rows.map((row) => row.status), ['pending', 'skipped', 'skipped']);
  api.calls.length = 0;
  assert.equal((await api.post({ action: 'save', name: 'Sai cấu hình', smtp: account, template: { ...allow, duplicateEmailPolicy: 'merge' }, rows: reports.rows })).status, 400);
  assert.equal(api.calls.length, 0);
});

test('Resend API saves secret-free public config and sends tests and claimed rows through the saved provider', async () => {
  const api = apiHarness(); api.stored.status = 'draft';
  const input = { provider: 'resend', resend: resendAccount };
  assert.equal((await api.post({ action: 'save', name: 'Resend', template, rows: table.rows, ...input })).status, 200);
  const saved = api.calls.find((call) => call.name === 'save_mail_merge').args;
  assert.deepEqual(saved.p_smtp, { provider: 'resend', keySource: 'server', fromEmail: 'bantochuc@vsot.com.vn', fromName: 'Ban tổ chức', replyTo: '' });
  assert.equal(saved.p_secret, ''); assert.equal(api.sends.length, 0);
  api.stored.smtp_public = saved.p_smtp; api.stored.smtp_secret = saved.p_secret;
  const view = await (await api.get()).json(); assert.equal(view.campaign.hasPassword, false);
  assert.ok(!JSON.stringify(view).includes('re_test_server_key'));
  assert.equal((await api.post({ action: 'test', template, row: table.rows[0], to: 'qa@example.test', ...input })).status, 200);
  assert.equal(api.sends.length, 1); assert.deepEqual(api.sends[0].mail.to, ['qa@example.test']);
  assert.equal(api.sends[0].mail.subject, '[Gửi thử] Gửi Nguyễn An tại Đại học A');
  assert.ok(!api.sends[0].mail.html.includes('/api/mail-merge/open/'));
  assert.match(api.sends[0].headers['Idempotency-Key'], /^mail-merge\/test\//);
  api.stored.status = 'running';
  assert.equal((await api.post({ action: 'process', provider: 'smtp' })).status, 200); // Claimed config wins over client input.
  assert.equal(api.sends[1].provider, 'resend'); assert.ok(api.sends[1].mail.html.includes('/api/mail-merge/open/'));
  assert.equal(Buffer.from(api.sends[1].mail.attachments[0].content, 'base64').toString(), 'pdf');
  assert.equal(api.calls.find((call) => call.name === 'finish_mail_merge').args.p_status, 'sent');
  assert.equal((await api.post({ action: 'account', smtp: account })).status, 400); // Cannot change providers on an active batch.
  api.stored.status = 'paused';
  assert.equal((await api.post({ action: 'account', smtp: account })).status, 400);
  assert.equal((await api.post({ action: 'account', ...input })).status, 200);
  const privateInput = { provider: 'resend', resend: { ...resendAccount, keySource: 'private', apiKey: 're_test_private_key' } };
  api.calls.length = 0; api.stored.status = 'draft';
  const response = await api.post({ action: 'save', name: 'Private Resend', template, rows: table.rows, ...privateInput });
  assert.equal(response.status, 200); assert.ok(!(await response.text()).includes(privateInput.resend.apiKey));
  const privateSaved = api.calls.find((call) => call.name === 'save_mail_merge').args;
  assert.equal(privateSaved.p_secret, 'ciphertext-test'); assert.equal(Object.hasOwn(privateSaved.p_smtp, 'apiKey'), false);
  api.stored.smtp_public = privateSaved.p_smtp; api.stored.smtp_secret = privateSaved.p_secret;
  const privateView = await (await api.get()).json(); assert.equal(privateView.campaign.hasPassword, true);
  assert.ok(!JSON.stringify(privateView).includes('ciphertext-test')); assert.ok(!JSON.stringify(privateView).includes(privateInput.resend.apiKey));
  assert.equal((await api.post({ action: 'verify', provider: 'resend', resend: { ...resendAccount, fromEmail: 'bad-address' } })).status, 400);
});

test('an ambiguous Resend response is persisted as uncertain using the existing review flow', async () => {
  const api = apiHarness();
  api.stored.smtp_public = { ...resendAccount, apiKey: undefined, provider: 'resend' }; api.stored.smtp_secret = '';
  api.failSend();
  const result = await (await api.post({ action: 'process' })).json();
  assert.equal(result.status, 'uncertain'); assert.equal(api.sends.length, 1);
  assert.equal(api.calls.find((call) => call.name === 'finish_mail_merge').args.p_status, 'uncertain');
});

test('revision API uses an owner-scoped atomic copy without sending or exposing SMTP credentials', async () => {
  const api = apiHarness(), newId = randomUUID();
  const response = await api.post({ action: 'revise', newId });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, id: newId });
  assert.deepEqual(api.calls, [{ name: 'revise_mail_merge', args: { p_source: api.id, p_owner: owner, p_id: newId } }]);
  assert.equal(api.sends.length, 0);
  api.calls.length = 0;
  for (const invalid of [null, 'invalid', api.id]) assert.equal((await api.post({ action: 'revise', newId: invalid })).status, 400);
  assert.equal(api.calls.length, 0);
  api.reject({ message: 'ACTIVE_DELIVERY' });
  assert.match((await (await api.post({ action: 'revise', newId })).json()).error, /Tạm dừng/);
  api.deny();
  assert.equal((await api.post({ action: 'revise', newId })).status, 403);
});

test('same Email reports send separate personalized messages, cards and tracking URLs', async () => {
  const api = apiHarness();
  const allow = { ...reportsTemplate, duplicateEmailPolicy: 'allow' };
  api.stored.template = allow;
  api.queue(merge.prepareMergeRecipients(allow, reports.rows).filter((row) => row.status === 'pending'));
  assert.equal((await api.post({ action: 'process' })).status, 200);
  assert.equal((await api.post({ action: 'process' })).status, 200);
  assert.equal((await api.post({ action: 'process' })).status, 200);
  assert.equal(api.sends.length, 2);
  assert.deepEqual(api.sends.map((send) => send.mail.to), ['an@example.test', 'an@example.test']);
  assert.deepEqual(api.sends.map((send) => send.mail.subject), ['Báo cáo Nghiên cứu tim mạch', 'Báo cáo Nghiên cứu hô hấp']);
  assert.deepEqual(api.attachmentCalls.map((call) => call.fields.bai_bao_cao), ['Nghiên cứu tim mạch', 'Nghiên cứu hô hấp']);
  assert.notEqual(api.sends[0].mail.attachments[0].content.toString(), api.sends[1].mail.attachments[0].content.toString());
  const pixels = api.sends.map((send) => send.mail.html.match(/src="([^"]*\/api\/mail-merge\/open\/[^\"]+)"/)[1]);
  assert.notEqual(pixels[0], pixels[1]);
  assert.equal(api.calls.filter((call) => call.name === 'finish_mail_merge').length, 2);
});

test('sending API claims atomically, uses a single recipient and records acceptance with the claim token', async () => {
  const api = apiHarness();
  api.stored.template = { ...template, blocks: [{ ...template.blocks[0], format: 'markdown', inlineLinks: true, text: 'Kính gửi **{{ho_ten}}**\n[{{truong}}](<https://example.test/info>)' }] };
  assert.equal((await api.post({ action: 'process' })).status, 200);
  assert.equal((await api.post({ action: 'process' })).status, 200);
  assert.equal(api.sends.length, 1);
  assert.equal(api.sends[0].mail.to, 'an@example.test');
  assert.equal(api.sends[0].mail.subject, 'Gửi Nguyễn An tại Đại học A');
  assert.equal(api.sends[0].mail.attachments[0].filename, 'invite.pdf');
  assert.equal(api.attachmentCalls.length, 1);
  assert.ok(api.sends[0].mail.html.includes('<strong style="font-weight:700">Nguyễn An</strong>'));
  assert.ok(api.sends[0].mail.html.includes('/api/mail-merge/open/'));
  assert.ok(api.sends[0].mail.html.includes('href="https://example.test/info"'));
  assert.equal(api.sends[0].mail.text, 'Kính gửi Nguyễn An\nĐại học A (https://example.test/info)');
  assert.ok(!api.sends[0].mail.html.includes('/checkin/'));
  const finish = api.calls.find((call) => call.name === 'finish_mail_merge');
  assert.equal(finish.args.p_owner, owner); assert.equal(finish.args.p_status, 'sent'); assert.ok(finish.args.p_attempt);
});

test('an unexpected error after SMTP starts cannot become an automatically retryable failure', async () => {
  const api = apiHarness();
  api.failSend();
  const response = await (await api.post({ action: 'process' })).json();
  assert.equal(response.status, 'uncertain');
  assert.equal(api.calls.find((call) => call.name === 'finish_mail_merge').args.p_status, 'uncertain');
});

const extra = process.env.MAIL_MERGE_TEST_DEPS ? createRequire(path.join(process.env.MAIL_MERGE_TEST_DEPS, 'package.json')) : null;
test('existing PostgreSQL schema stores, claims and copies Resend configs without changing historical SMTP records', { skip: !extra }, async () => {
  const { PGlite } = extra('@electric-sql/pglite'), db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(readFileSync(path.join(__dirname, '../supabase/mail-merge.sql'), 'utf8'));
    const oldId = randomUUID();
    await db.query('select save_mail_merge($1,$2,$3,$4,$5,$6,$7)', [oldId, owner, 'Legacy', template, account, 'old-ciphertext', merge.prepareMergeRecipients(template, table.rows)]);
    const before = (await db.query('select * from mail_merge_campaigns where id=$1', [oldId])).rows[0];
    for (const keySource of ['server', 'private']) {
      const id = randomUUID(), next = randomUUID();
      const config = { provider: 'resend', keySource, fromEmail: resendAccount.fromEmail, fromName: resendAccount.fromName, replyTo: '' }, secret = keySource === 'server' ? '' : 'resend-encrypted-key';
      await db.query('select save_mail_merge($1,$2,$3,$4,$5,$6,$7)', [id, owner, 'Resend', template, config, secret, merge.prepareMergeRecipients(template, table.rows)]);
      await db.query('select control_mail_merge($1,$2,$3)', [id, owner, 'start']);
      const claim = (await db.query('select claim_mail_merge($1,$2) result', [id, owner])).rows[0].result;
      assert.deepEqual(claim.smtp_public, config); assert.equal(claim.smtp_secret, secret);
      await db.query('select finish_mail_merge($1,$2,$3,$4,$5,$6)', [claim.recipient.id, owner, claim.recipient.attempt_id, 'sent', 'resend-test', null]);
      await db.query('select control_mail_merge($1,$2,$3)', [id, owner, 'pause']);
      await db.query('select revise_mail_merge($1,$2,$3)', [id, owner, next]);
      const copied = (await db.query('select * from mail_merge_campaigns where id=$1', [next])).rows[0];
      assert.deepEqual(copied.smtp_public, config); assert.equal(copied.smtp_secret, secret); assert.equal(copied.previous_campaign_id, id);
      const hash = tracking.hashMailMergeOpenToken(claim.open_token);
      assert.equal((await db.query('select record_mail_merge_open($1,$2) result', [claim.recipient.id, hash])).rows[0].result, true);
    }
    assert.deepEqual((await db.query('select * from mail_merge_campaigns where id=$1', [oldId])).rows[0], before);
  } finally { await db.close(); }
});

test('PostgreSQL revisions preserve old tracking, credentials and rows while making independently editable drafts', { skip: !extra }, async () => {
  const { PGlite } = extra('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    const sql = readFileSync(path.join(__dirname, '../supabase/mail-merge.sql'), 'utf8');
    await db.exec(sql);
    const source = randomUUID(), next = randomUUID(), allow = { ...reportsTemplate, duplicateEmailPolicy: 'allow', attachments: [{ id: 'file', name: 'slides.pptx', url: 'https://example.test/slides.pptx' }], cardAttachment: 'both' };
    const rows = merge.prepareMergeRecipients(allow, reports.rows);
    await db.query('select save_mail_merge($1,$2,$3,$4,$5,$6,$7)', [source, owner, 'Hai bài', allow, account, 'ciphertext-only', rows]);
    const revise = async (id = next, who = owner) => (await db.query('select revise_mail_merge($1,$2,$3) result', [source, who, id])).rows[0].result;
    await assert.rejects(revise(next, 'other@example.test'), /NOT_FOUND/);
    await assert.rejects(revise(source), /INVALID_ID/);
    await db.query('select control_mail_merge($1,$2,$3)', [source, owner, 'start']);
    await assert.rejects(revise(), /ACTIVE_DELIVERY/);
    const job = (await db.query('select claim_mail_merge($1,$2) result', [source, owner])).rows[0].result;
    await db.query('select control_mail_merge($1,$2,$3)', [source, owner, 'pause']);
    await assert.rejects(revise(), /ACTIVE_DELIVERY/); // A paused campaign can still have SMTP in flight.
    await db.query('select finish_mail_merge($1,$2,$3,$4,$5,$6)', [job.recipient.id, owner, job.recipient.attempt_id, 'sent', 'old-message', null]);
    const hash = tracking.hashMailMergeOpenToken(job.open_token);
    await db.query('select record_mail_merge_open($1,$2)', [job.recipient.id, hash]);
    const before = (await db.query('select * from mail_merge_recipients where campaign_id=$1 order by source_row', [source])).rows;
    assert.equal(await revise(), next);
    const copied = (await db.query('select * from mail_merge_campaigns where id=$1', [next])).rows[0];
    assert.equal(copied.status, 'draft'); assert.equal(copied.previous_campaign_id, source);
    assert.equal(copied.smtp_secret, 'ciphertext-only'); assert.deepEqual(copied.template, allow);
    const newRows = (await db.query('select * from mail_merge_recipients where campaign_id=$1 order by source_row', [next])).rows;
    assert.deepEqual(newRows.map((row) => row.status), ['pending', 'pending', 'skipped']);
    assert.equal(newRows[0].email, newRows[1].email);
    for (let index = 0; index < newRows.length; index++) {
      assert.notEqual(newRows[index].id, before[index].id);
      assert.deepEqual(newRows[index].fields, before[index].fields);
      assert.equal(newRows[index].open_token_hash, null); assert.equal(newRows[index].sent_at, null);
      assert.equal(newRows[index].opened_at, null); assert.equal(newRows[index].open_count, 0);
    }
    assert.deepEqual((await db.query('select * from mail_merge_recipients where campaign_id=$1 order by source_row', [source])).rows, before);
    const replacement = merge.prepareMergeRecipients(allow, [reports.rows[1]]);
    await db.query('select save_mail_merge($1,$2,$3,$4,$5,$6,$7)', [next, owner, 'Đợt đã sửa', allow, account, 'ciphertext-only', replacement]);
    assert.equal(await revise(), next); // Same request id is idempotent even after editing.
    assert.equal((await db.query('select count(*)::int n from mail_merge_recipients where campaign_id=$1', [next])).rows[0].n, 1);
    assert.equal((await db.query('select previous_campaign_id from mail_merge_campaigns where id=$1', [next])).rows[0].previous_campaign_id, source);
    assert.deepEqual((await db.query('select * from mail_merge_recipients where campaign_id=$1 order by source_row', [source])).rows, before);
    await db.query('update mail_merge_recipients set opened_at=null,open_count=0 where id=$1', [job.recipient.id]);
    assert.equal((await db.query('select record_mail_merge_open($1,$2) result', [job.recipient.id, hash])).rows[0].result, true); // Old pixel still works after the new draft is saved.
    await db.query('select control_mail_merge($1,$2,$3)', [next, owner, 'start']);
    const newJob = (await db.query('select claim_mail_merge($1,$2) result', [next, owner])).rows[0].result;
    assert.notEqual(newJob.open_token, job.open_token);
    assert.equal((await db.query('select record_mail_merge_open($1,$2) result', [newJob.recipient.id, hash])).rows[0].result, false);
    await db.query('select finish_mail_merge($1,$2,$3,$4,$5,$6)', [newJob.recipient.id, owner, newJob.recipient.attempt_id, 'sent', 'new-message', null]);
    await db.query('select claim_mail_merge($1,$2)', [next, owner]);
    const third = randomUUID();
    await db.query('select revise_mail_merge($1,$2,$3)', [next, owner, third]);
    assert.equal((await db.query('select previous_campaign_id from mail_merge_campaigns where id=$1', [third])).rows[0].previous_campaign_id, next);
    await assert.rejects(revise(third), /NOT_FOUND/); // Cannot reuse a revision ID belonging to another source.
    await db.exec(sql); // Re-running the migration keeps both tracking histories and links.
    assert.equal((await db.query('select count(*)::int n from mail_merge_campaigns')).rows[0].n, 3);
    assert.equal((await db.query('select open_count from mail_merge_recipients where id=$1', [job.recipient.id])).rows[0].open_count, 1);
    assert.equal((await db.query("select has_function_privilege('authenticated','revise_mail_merge(uuid,text,uuid)','execute') a,has_function_privilege('service_role','revise_mail_merge(uuid,text,uuid)','execute') s")).rows[0].a, false);
  } finally { await db.close(); }
});

test('PostgreSQL keeps same Email reports as separate queue entries and open tracking records', { skip: !extra }, async () => {
  const { PGlite } = extra('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec('create role anon; create role authenticated; create role service_role;');
    await db.exec(readFileSync(path.join(__dirname, '../supabase/mail-merge.sql'), 'utf8'));
    const id = randomUUID(), allow = { ...reportsTemplate, duplicateEmailPolicy: 'allow' };
    await db.query('select save_mail_merge($1,$2,$3,$4,$5,$6,$7)', [id, owner, 'Hai bài báo cáo', allow, account, 'ciphertext-only', merge.prepareMergeRecipients(allow, reports.rows)]);
    const rows = (await db.query('select id,source_row,email,status,fields from mail_merge_recipients where campaign_id=$1 order by source_row', [id])).rows;
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => row.status), ['pending', 'pending', 'skipped']);
    assert.equal(rows[0].email, rows[1].email);
    assert.notEqual(rows[0].id, rows[1].id);
    assert.notEqual(rows[0].fields.bai_bao_cao, rows[1].fields.bai_bao_cao);
    await db.query('select control_mail_merge($1,$2,$3)', [id, owner, 'start']);
    const sent = [];
    for (let index = 0; index < 2; index++) {
      const job = (await db.query('select claim_mail_merge($1,$2) result', [id, owner])).rows[0].result;
      assert.equal(job.recipient.id, rows[index].id);
      assert.equal(job.recipient.email, 'an@example.test');
      sent.push(job);
      assert.equal((await db.query('select finish_mail_merge($1,$2,$3,$4,$5,$6) result', [job.recipient.id, owner, job.recipient.attempt_id, 'sent', 'test-' + index, null])).rows[0].result, true);
    }
    assert.notEqual(sent[0].open_token, sent[1].open_token);
    const firstHash = tracking.hashMailMergeOpenToken(sent[0].open_token);
    assert.equal((await db.query('select record_mail_merge_open($1,$2) result', [rows[1].id, firstHash])).rows[0].result, false);
    assert.equal((await db.query('select record_mail_merge_open($1,$2) result', [rows[0].id, firstHash])).rows[0].result, true);
    const beforeSecond = (await db.query('select open_count,opened_at is not null opened from mail_merge_recipients where campaign_id=$1 order by source_row', [id])).rows;
    assert.deepEqual(beforeSecond, [{ open_count: 1, opened: true }, { open_count: 0, opened: false }, { open_count: 0, opened: false }]);
    assert.equal((await db.query('select record_mail_merge_open($1,$2) result', [rows[1].id, tracking.hashMailMergeOpenToken(sent[1].open_token)])).rows[0].result, true);
    assert.equal((await db.query('select claim_mail_merge($1,$2) result', [id, owner])).rows[0].result, null);
    assert.deepEqual((await db.query('select status,open_count from mail_merge_recipients where campaign_id=$1 order by source_row', [id])).rows, [{ status: 'sent', open_count: 1 }, { status: 'sent', open_count: 1 }, { status: 'skipped', open_count: 0 }]);
  } finally { await db.close(); }
});

test('PostgreSQL queue is repeatable, owner isolated, atomic across tabs and never auto-retries ambiguous SMTP', { skip: !extra }, async () => {
  const { PGlite } = extra('@electric-sql/pglite');
  const db = new PGlite();
  try {
    await db.exec("create role anon; create role authenticated; create role service_role; create table survey_responses(id int, answers jsonb); insert into survey_responses values(1,'{\"old\":true}');");
    const sql = readFileSync(path.join(__dirname, '../supabase/mail-merge.sql'), 'utf8');
    await db.exec(sql); await db.exec(sql);
    assert.deepEqual((await db.query('select * from survey_responses')).rows, [{ id: 1, answers: { old: true } }]);
    const id = randomUUID(), queueRows = [...table.rows, { sourceRow: 4, fields: { email: 'c@example.test', ho_ten: 'C', truong: 'C' } }];
    const save = async (who = owner) => db.query('select save_mail_merge($1,$2,$3,$4,$5,$6,$7)', [id, who, 'Test', template, account, 'ciphertext-only', merge.prepareMergeRecipients(template, queueRows)]);
    const control = async (action, row = null, who = owner) => db.query('select control_mail_merge($1,$2,$3,$4) result', [id, who, action, row]);
    const claim = async () => (await db.query('select claim_mail_merge($1,$2) result', [id, owner])).rows[0].result;
    const finish = async (job, status = 'sent', token = job.recipient.attempt_id) => (await db.query('select finish_mail_merge($1,$2,$3,$4,$5,$6) result', [job.recipient.id, owner, token, status, status === 'sent' ? 'test-message' : null, status === 'sent' ? null : 'test-error'])).rows[0].result;
    await save(); await save(); // Updating drafts replaces the queue atomically, no duplicate rows.
    assert.equal((await db.query('select count(*)::int n from mail_merge_recipients')).rows[0].n, 3);
    assert.equal(await claim(), null);
    await assert.rejects(save('other@example.test'), /NOT_FOUND/);
    await assert.rejects(control('start', null, 'other@example.test'), /NOT_FOUND/);
    await control('start');
    const simultaneous = await Promise.all([claim(), claim()]);
    assert.ok(simultaneous[0]); assert.equal(simultaneous[1], null);
    assert.equal(simultaneous[0].smtp_secret, 'ciphertext-only');
    assert.equal(await finish(simultaneous[0], 'sent', randomUUID()), false);
    assert.equal(await finish(simultaneous[0]), true);
    assert.match(simultaneous[0].open_token, /^[a-f0-9]{64}$/);
    const openHash = tracking.hashMailMergeOpenToken(simultaneous[0].open_token);
    assert.equal((await db.query('select record_mail_merge_open($1,$2) result', [simultaneous[0].recipient.id, openHash])).rows[0].result, true);
    assert.equal((await db.query('select record_mail_merge_open($1,$2) result', [simultaneous[0].recipient.id, openHash])).rows[0].result, true);
    assert.deepEqual((await db.query('select open_count,opened_at is not null opened from mail_merge_recipients where id=$1', [simultaneous[0].recipient.id])).rows[0], { open_count: 1, opened: true });
    assert.equal(await finish(simultaneous[0]), false);
    await assert.rejects(save(), /LOCKED_CAMPAIGN/);
    const second = await claim();
    await control('pause'); assert.equal(await claim(), null);
    assert.equal(await finish(second, 'failed'), true);
    await control('retry_failed');
    await control('start');
    const retried = await claim();
    assert.equal(retried.recipient.id, second.recipient.id);
    assert.notEqual(retried.recipient.attempt_id, second.recipient.attempt_id);
    assert.equal(await finish(second), false);
    await control('pause');
    await db.query("update mail_merge_recipients set claimed_at=now()-interval '4 minutes' where id=$1", [retried.recipient.id]);
    await control('refresh'); // Reopening a paused tab must expose a stale claim for review.
    assert.equal((await db.query('select status from mail_merge_recipients where id=$1', [retried.recipient.id])).rows[0].status, 'uncertain');
    assert.equal(await claim(), null);
    assert.equal((await db.query('select status from mail_merge_campaigns where id=$1', [id])).rows[0].status, 'paused');
    assert.equal((await db.query('select status from mail_merge_recipients where id=$1', [retried.recipient.id])).rows[0].status, 'uncertain');
    await assert.rejects(control('start'), /UNCERTAIN_DELIVERY/);
    await control('resolve_sent', retried.recipient.id);
    await control('start');
    const third = await claim();
    assert.notEqual(third.recipient.id, retried.recipient.id);
    await finish(third); assert.equal(await claim(), null);
    assert.equal((await db.query('select status from mail_merge_campaigns where id=$1', [id])).rows[0].status, 'completed');
    assert.equal((await db.query("select count(*)::int n from mail_merge_recipients where status='sent'")).rows[0].n, 3);
    const permissions = (await db.query("select has_table_privilege('anon','mail_merge_campaigns','select') a,has_table_privilege('authenticated','mail_merge_campaigns','select') b,has_function_privilege('anon','claim_mail_merge(uuid,text)','execute') c,has_function_privilege('service_role','claim_mail_merge(uuid,text)','execute') s")).rows[0];
    assert.deepEqual(permissions, { a: false, b: false, c: false, s: true });
  } finally { await db.close(); }
});
