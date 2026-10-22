// node --test scripts/test-attendance-import.cjs (no network/database writes)
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const XLSX = require('xlsx');
function load(file) {
  const mod = { exports: {} };
  new Function('require', 'module', 'exports', ts.transpileModule(readFileSync(path.join(__dirname, '../src/lib', file), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
  }).outputText)((name) => name === './checkin-sessions' ? load('checkin-sessions.ts') : require(name), mod, mod.exports);
  return mod.exports;
}
const { parseSurveyImportRows, parseSpreadsheetFile, validateImportRows, buildImportPayload } = load('csv-import.ts');
const { attendanceDetails } = load('attendance-display.ts');
const config = { questionId: 'program', sessions: [
  { id: 'conference', name: 'Hội thảo', hall: 'Venue', optionIndexes: [0, 2], checkHall: true },
  { id: 'gala', name: 'Gala dinner', hall: 'Dinner venue', optionIndexes: [1, 2] }
] };
const questionLabels = { name: 'Họ tên', program: 'Bạn tham dự chương trình nào?', cme: 'Đăng ký cấp CME' };
const questionMeta = { name: { type: 'text', isHall: false }, program: { type: 'choice', isHall: false, required: true, options: ['Chỉ hội thảo', 'Chỉ Gala dinner', 'Cả hội thảo và Gala dinner'] }, cme: { type: 'choice', isHall: false, options: ['Có', 'Không'] } };
const base = { questionOrder: Object.keys(questionLabels), questionLabels, questionMeta, existingEmails: new Set(), sessionConfig: config };
const mappings = { conference: { column: 3, fallback: 'unknown' }, gala: { column: 4, fallback: 'unknown' } };
const headers = ['Họ tên', 'Email', 'Hội trường', 'Hội thảo', 'Gala', 'CME'];
const parse = (rows, extra = {}) => parseSurveyImportRows({ ...base, rows: [headers, ...rows], attendanceColumns: mappings, cmeQuestionId: 'cme', cmeColumn: 5, ...extra });

test('real Excel preserves hall, independent Gala/CME and all three groups in one registration per person', async () => {
  const input = [headers, ['Khách A', 'a@example.test', 'A', 'x', '✓', '1'], ['Khách B', 'b@example.test', 'B', 'Yes', 'No', 'Có'], ['Khách C', 'c@example.test', '', '0', 'true', 'Không']];
  const book = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(book, XLSX.utils.aoa_to_sheet(input), 'Guests');
  const buffer = XLSX.write(book, { type: 'buffer', bookType: 'xlsx' });
  const rows = await parseSpreadsheetFile(new File([buffer], 'guests.xlsx'));
  const preview = parse(rows.slice(1));
  assert.deepEqual(preview.rows.map((r) => r.status), ['ready', 'ready', 'ready']);
  const payload = buildImportPayload('survey', preview.rows);
  assert.equal(payload.length, 3);
  assert.deepEqual(payload.map((r) => r.answers.program), [2, 0, 1]);
  assert.deepEqual(payload.map((r) => r.answers.cme), [0, 0, 1]);
  assert.deepEqual(payload.map((r) => r.hall), ['A', 'B', undefined]);
  assert.ok(payload.every((r) => !r.session_checkins && !r.checked_in));
});

test('blank flags, typos, contradictory columns and unrepresentable attendance cannot silently grant rights', () => {
  for (const [conference, gala] of [['x', ''], ['x', 'maybe'], ['0', '0'], ['', '1']]) {
    const p = parse([['A', '', 'A', conference, gala, 'Có']]);
    assert.equal(p.rows[0].status, 'invalid');
    assert.equal(buildImportPayload('survey', p.rows).length, 0);
  }
  const p = parseSurveyImportRows({ ...base, rows: [[...headers, questionLabels.program], ['A', '', 'A', '1', '0', 'Có', 'Chỉ Gala dinner']], attendanceColumns: mappings });
  assert.equal(p.rows[0].status, 'invalid');
  assert.match(p.rows[0].issues.join(), /mâu thuẫn/);
});

test('explicit per-batch defaults allow a Gala-only spreadsheet without assuming conference entitlement', () => {
  const p = parse([['A', '', 'A', '', '1', '0']], { attendanceColumns: { ...mappings, conference: { column: null, fallback: 'yes' } } });
  assert.equal(p.rows[0].answers.program, 2);
  assert.equal(p.rows[0].status, 'ready');
  assert.equal(parse([['A', '', 'A', '', '1', '0']], { attendanceColumns: { gala: mappings.gala } }).rows[0].status, 'invalid');
});

test('normal named choice columns remain supported; bad choices and missing attendance are rejected', () => {
  const p = parseSurveyImportRows({ ...base, rows: [[questionLabels.name, questionLabels.program, questionLabels.cme, 'Hội trường'], ['A', 'Cả hội thảo và Gala dinner', 'Yes', 'A'], ['B', 'Sai chính tả', 'Không', 'B'], ['C', '', 'Có', 'A']] });
  assert.deepEqual(p.rows.map((r) => r.status), ['ready', 'invalid', 'invalid']);
  assert.equal(p.rows[0].answers.cme, 0);
});

test('editing a choice or deleting a duplicate revalidates the entire preview', () => {
  const p = parse([['A', 'same@example.test', 'A', '1', 'maybe', '1'], ['B', 'same@example.test', 'A', '1', '0', '0']]);
  assert.deepEqual(p.rows.map((r) => r.status), ['invalid', 'ready']);
  p.rows[0].answers.program = 2;
  const rows = validateImportRows(p.rows, questionMeta, questionLabels, new Set(), config);
  assert.deepEqual(rows.map((r) => r.status), ['ready', 'duplicate']);
  assert.equal(validateImportRows(rows.slice(1), questionMeta, questionLabels, new Set(), config)[0].status, 'ready');
  assert.equal(validateImportRows(rows.slice(1), questionMeta, questionLabels, new Set(['same@example.test']), config)[0].status, 'duplicate');
});

test('multi-choice attendance uses option indexes and round trips into readable scan details', () => {
  const multiConfig = { ...config, sessions: config.sessions.map((s, i) => ({ ...s, optionIndexes: [i] })) };
  const meta = { ...questionMeta, program: { ...questionMeta.program, allowMultiple: true, options: ['Hội thảo', 'Gala'] } };
  const p = parse([['A', '', 'A', '1', '1', '1']], { sessionConfig: multiConfig, questionMeta: meta });
  assert.deepEqual(p.rows[0].answers.program, [0, 1]);
  assert.equal(p.rows[0].status, 'ready');
  const questions = Object.entries(meta).map(([id, q]) => ({ ...q, id, text: questionLabels[id] }));
  const details = attendanceDetails(questions, { ...p.rows[0], session_checkins: { conference: '2026-10-22T01:00:00Z' } }, multiConfig);
  assert.equal(details.find((d) => d.label === 'Đăng ký cấp CME').value, 'Có');
  assert.equal(details.find((d) => d.label === 'Hội trường được phân').value, 'A');
  assert.equal(details.find((d) => d.label === 'Hội thảo').value, 'Có đăng ký · Đã check-in');
  assert.equal(details.find((d) => d.label === 'Gala dinner').value, 'Có đăng ký · Chưa check-in');
  assert.equal(details.find((d) => d.label === questionLabels.program).value, 'Hội thảo, Gala');
});

test('missing assigned halls and conflicting CME columns remain invalid; unrelated columns are disclosed', () => {
  assert.equal(parse([['A', '', '', '1', '0', 'Có']]).rows[0].status, 'invalid');
  assert.equal(parse([['A', '', '', '0', '1', 'Có']]).rows[0].status, 'ready');
  const p = parseSurveyImportRows({ ...base, rows: [[...headers, questionLabels.cme, 'Ghi chú riêng'], ['A', '', 'A', '1', '0', '1', 'Không', 'note']], attendanceColumns: mappings, cmeQuestionId: 'cme', cmeColumn: 5 });
  assert.equal(p.rows[0].status, 'invalid');
  assert.match(p.rows[0].issues.join(), /CME mâu thuẫn/);
  assert.deepEqual(p.unmappedHeaders, ['Ghi chú riêng']);
});

test('standard Hall column populates a differently named hall selector without losing its answer', () => {
  const p = parse([['A', '', 'A', '1', '1', 'Có']], {
    questionOrder: [...base.questionOrder, 'venue'], questionLabels: { ...questionLabels, venue: 'Bạn chọn phòng nào?' },
    questionMeta: { ...questionMeta, venue: { type: 'choice', options: ['A', 'B'], isHall: true, required: true } },
  });
  assert.equal(p.rows[0].status, 'ready'); assert.equal(p.rows[0].answers.venue, 0); assert.equal(p.rows[0].hall, 'A');
});
