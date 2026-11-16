// node --test scripts/test-report-export.cjs
// Synthetic registrations only; no network, writes, email or source workbooks.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');
const XLSX = require('xlsx');
const ExcelJS = require('exceljs');

function load(file, mocks = {}) {
  const module = { exports: {} };
  const source = ts.transpileModule(readFileSync(path.join(__dirname, '..', file), 'utf8'), {
    fileName: file, compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, esModuleInterop: true },
  }).outputText;
  new Function('require', 'module', 'exports', source)((name) => Object.hasOwn(mocks, name) ? mocks[name] : require(name), module, module.exports);
  return module.exports;
}
const sessions = load('src/lib/checkin-sessions.ts');
const { buildReportExport, buildReportCSV, filterReportResponses, reportDate } = load('src/lib/report-export.ts', { './checkin-sessions': sessions });
const { createReportXlsx } = load('src/lib/report-xlsx.ts');
const config = { questionId: 'program', sessions: [
  { id: 'conference', name: 'Hội thảo', hall: 'Trung tâm', optionIndexes: [0, 2] },
  { id: 'gala', name: 'Gala', hall: 'Nhà hàng', optionIndexes: [1, 2] },
] };
const questions = [
  { id: 'name', text: 'Họ và tên', type: 'text' },
  { id: 'phone', text: 'Số điện thoại', type: 'phone' },
  { id: 'note', text: 'Ghi chú', type: 'paragraph' },
  { id: 'program', text: 'Chương trình tham dự', type: 'choice', options: ['Hội thảo', 'Gala', 'Cả hai'] },
  { id: 'cme', text: 'Đăng ký cấp CME', type: 'choice', options: ['Có', 'Không'] },
  { id: 'section', text: 'Tiêu đề phần', type: 'section' },
  { id: 'banner', text: 'Banner', type: 'image_banner' },
].map((q, position) => ({ options: null, position, ...q }));
const response = (id, patch = {}) => ({ id, survey_id: 'form', answers: { name: `Khách ${id}`, phone: '0900123456', note: 'Đơn vị, "Bệnh viện"\nDòng 2', program: 2, cme: 0 },
  submitted_at: '2026-11-16T01:00:00Z', checked_in: false, checked_in_at: null, session_checkins: {},
  email: 'unconfigured@example.test', hall: 'A', payment_status: 'paid', payment_amount: 100000, payment_payer_bank: 'Hidden bank', ...patch });
const analytics = (patch = {}) => ({ survey: { id: 'form', title: 'Báo cáo kiểm thử', checkin_theme: { sessionConfig: config }, payment_config: null }, questions, responses: [
  response('a', { checked_in: true, checked_in_at: '2026-11-16T02:00:00Z' }),
  response('b', { session_checkins: { gala: '2026-11-16T03:00:00Z' } }), response('c'),
], ...patch });
const all = { search: '', checkin: 'all', hall: '' };

test('checked export includes general/session arrivals once, preserves ledgers and respects filters', () => {
  const data = analytics(), before = structuredClone(data);
  const checked = filterReportResponses(data, all, 'checked');
  assert.deepEqual(checked.map((r) => r.id), ['a', 'b']);
  assert.equal(checked[1].checked_in_at, '2026-11-16T03:00:00Z');
  assert.deepEqual(filterReportResponses(data, { ...all, checkin: 'pending' }, 'checked'), []);
  assert.deepEqual(filterReportResponses(data, { ...all, search: 'khach b' }, 'checked').map((r) => r.id), ['b']);
  assert.deepEqual(filterReportResponses(data, all, 'filtered').map((r) => r.id), ['a', 'b', 'c']);
  assert.deepEqual(data, before, 'Reporting does not rewrite registrations or timestamps');
  const legacy = analytics({ survey: { ...data.survey, checkin_theme: null } });
  assert.deepEqual(filterReportResponses(legacy, all, 'checked').map((r) => r.id), ['a'], 'Unmanaged forms preserve legacy check-in semantics');
});

test('only configured question fields and report metadata appear; stale email/hall/payment data add no columns', () => {
  const data = analytics(), table = buildReportExport(data, data.responses);
  assert.deepEqual(table.headers.slice(0, 9), ['STT', ...questions.slice(0, 5).map((q) => q.text), 'Thời gian đăng ký', 'Check-in', 'Thời gian check-in']);
  for (const label of ['Email', 'Hội trường', 'Thanh toán', 'Số tiền', 'Tên tài khoản chuyển', 'Ngân hàng chuyển', 'Mã đơn PayOS', 'Tiêu đề phần', 'Banner']) assert.ok(!table.headers.includes(label), label);
  assert.ok(table.rows.every((row) => row.length === table.headers.length));
  assert.equal(table.rows[0][table.headers.indexOf('Chương trình tham dự')], 'Cả hai');
  assert.equal(table.rows[0][table.headers.indexOf('Đăng ký cấp CME')], 'Có');
  assert.equal(table.rows[1][table.headers.indexOf('Check-in: Gala')], 'Đã check-in');
  assert.equal(table.rows[1][table.headers.indexOf('Check-in: Hội thảo')], 'Chưa check-in');
  assert.equal(table.rows[1][table.headers.indexOf('Thời gian check-in')], '10:00 16/11/2026');
  assert.equal(table.rows[0][table.headers.indexOf('Số điện thoại')], '0900123456');
});

test('hall and payment export only when configured; hall is not duplicated or confused with the session venue', () => {
  const data = analytics();
  data.questions = [...questions, { id: 'hall', position: 9, text: 'Hội trường đăng ký', type: 'choice', is_hall_selector: true, options: ['A', 'B'] }];
  data.survey.payment_config = { enabled: true };
  const checked = filterReportResponses(data, { ...all, hall: 'A' }, 'checked');
  const table = buildReportExport(data, checked);
  assert.equal(table.headers.filter((label) => label.includes('Hội trường')).length, 1);
  assert.equal(table.rows[0][table.headers.indexOf('Hội trường đăng ký')], 'A');
  assert.equal(table.rows[0][table.headers.indexOf('Thanh toán')], 'Đã thanh toán');
  assert.equal(table.rows[0][table.headers.indexOf('Số tiền')], 100000);
  data.responses[0].payment_amount = 0;
  assert.equal(buildReportExport(data, data.responses).rows[0][table.headers.indexOf('Số tiền')], 0);
  assert.deepEqual(filterReportResponses(data, { ...all, hall: 'B' }, 'checked'), []);
  data.survey.payment_config.enabled = false;
  assert.ok(!buildReportExport(data, data.responses).headers.includes('Thanh toán'));
});

test('duplicate labels remain separate, choices decode, blank answers stay blank and signature/face payloads stay private', () => {
  const data = analytics({ questions: [...questions,
    { id: 'email1', type: 'text', text: 'Email', position: 10 },
    { id: 'email2', type: 'text', text: 'email', position: 11 },
    { id: 'email3', type: 'text', text: 'Email (2)', position: 12 },
    { id: 'rating', type: 'rating', text: 'Điểm', position: 13 },
    { id: 'face', type: 'face_checkin', text: 'Khuôn mặt', position: 14 },
    { id: 'sign', type: 'signature', text: 'Chữ ký', position: 15 },
  ] });
  data.responses[0].answers = { ...data.responses[0].answers, email1: 'a@example.test', email2: 'b@example.test', email3: 'c@example.test', rating: 0, face: 'private-face-vector', sign: 'data:image/png;base64,private', cme: '0' };
  const table = buildReportExport(data, data.responses);
  assert.equal(new Set(table.headers.map((s) => s.toLowerCase())).size, table.headers.length);
  assert.equal(table.rows[0][table.headers.indexOf('Email')], 'a@example.test');
  assert.equal(table.rows[0][table.headers.indexOf('Điểm')], 0);
  assert.equal(table.rows[1][table.headers.indexOf('Điểm')], '');
  assert.equal(table.rows[0][table.headers.indexOf('Đăng ký cấp CME')], 'Có');
  assert.ok(!JSON.stringify(table).includes('private'));
});

test('CSV keeps Vietnamese, commas/quotes/newlines and prevents formula execution in text/header cells', () => {
  const table = { headers: ['Tên', '=Header'], kinds: ['text', 'text'], rows: [['Tên, "Một"\nDòng hai', '=HYPERLINK("https://example.test")'], ['+84900123456', '@SUM(1)']] };
  const csv = buildReportCSV(table);
  assert.ok(csv.startsWith('\uFEFF'));
  const parsed = XLSX.utils.sheet_to_json(XLSX.read(csv, { type: 'string', raw: true }).Sheets.Sheet1, { header: 1, raw: true });
  assert.deepEqual(parsed[1], [table.rows[0][0], `'${table.rows[0][1]}`]);
  assert.equal(parsed[2][0], "'+84900123456");
  assert.equal(parsed[0][1], "'=Header");
});

test('XLSX has real separate columns, readable styles, frozen headings, filters and text phone numbers', async () => {
  const data = analytics(), table = buildReportExport(data, filterReportResponses(data, all, 'checked'));
  const buffer = await createReportXlsx(table, data.survey.title);
  const book = XLSX.read(buffer, { type: 'array', cellStyles: true });
  const sheet = book.Sheets['Danh sách'];
  const actual = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true });
  assert.deepEqual(actual, [table.headers, ...table.rows]);
  assert.equal(sheet.C2.t, 's');
  assert.equal(sheet.C2.v, '0900123456');
  assert.equal(sheet['!cols'][0].wch > 5, true);
  assert.ok(sheet['!cols'].slice(1).every((column) => column.wch >= 15 && column.wch < 50));
  const styled = new ExcelJS.Workbook();
  await styled.xlsx.load(buffer);
  const view = styled.worksheets[0];
  assert.equal(view.views[0].state, 'frozen');
  assert.equal(view.views[0].ySplit, 1);
  assert.equal(view.views[0].xSplit, 1);
  assert.equal(view.getRow(1).getCell(1).font.bold, true);
  assert.equal(view.getRow(1).getCell(1).fill.fgColor.argb, 'FF075985');
  assert.equal(view.getRow(2).getCell(2).alignment.wrapText, true);
  assert.ok(view.getRow(1).height >= 36);
  assert.equal(view.pageSetup.orientation, 'landscape');
  assert.ok(view.autoFilter);
});

test('Vietnam timestamps are deterministic and invalid timestamps never become Invalid Date', () => {
  assert.equal(reportDate('2026-11-15T23:05:00Z'), '06:05 16/11/2026');
  assert.equal(reportDate('bad'), '');
  assert.equal(reportDate(null), '');
});

test('analytics reads every page and rejects partial reads or failed form metadata', async () => {
  const records = Array.from({ length: 1201 }, (_, i) => response(String(i).padStart(5, '0')));
  let pages = 0, failPage = 0, failSurvey = false;
  const db = { from(table) {
    let after = '';
    const query = {
      select() { return query; }, eq() { return query; }, order() { return query; }, limit(value) { assert.equal(value, 500); return query; },
      gt(key, value) { assert.equal(key, 'id'); after = value; return query; }, single() { return query; },
      then(resolve) {
        if (table === 'surveys') return Promise.resolve({ data: analytics().survey, error: failSurvey ? new Error('metadata failed') : null }).then(resolve);
        if (table === 'survey_questions') return Promise.resolve({ data: questions, error: null }).then(resolve);
        pages++;
        return Promise.resolve(pages === failPage ? { data: null, error: new Error('read failed') } : { data: records.filter((r) => r.id > after).slice(0, 500), error: null }).then(resolve);
      },
    };
    return query;
  } };
  const surveys = load('src/lib/surveys.ts', { './supabase': { supabase: db }, './checkin-sessions': sessions });
  assert.equal((await surveys.getSurveyAnalytics('form')).responses.length, 1201);
  assert.equal(pages, 3);
  pages = 0; failPage = 2;
  assert.equal(await surveys.getSurveyAnalytics('form'), null);
  pages = 0; failSurvey = true;
  assert.equal(await surveys.getSurveyAnalytics('form'), null);
  assert.equal(pages, 0);
});
