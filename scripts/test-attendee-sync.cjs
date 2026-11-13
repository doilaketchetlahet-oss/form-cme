// node --test scripts/test-attendee-sync.cjs
// Virtual time + mocked Supabase/browser lifecycle. No network, writes or mail.
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { test } = require('node:test');
const ts = require('typescript');
const source = ts.transpileModule(readFileSync(require('node:path').join(__dirname, '../src/lib/attendee-sync.ts'), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const row = (id, patch = {}) => ({
  id, survey_id: 'form', answers: { name: `Guest ${id}` }, submitted_at: '2026-11-13T01:00:00Z',
  checked_in: false, session_checkins: {}, ...patch,
});
const settle = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };

function harness(initial = [row('a'), row('b')]) {
  let now = 0, timerId = 0, data = structuredClone(initial), commits = 0;
  let rows = [], nextFailure = false, holdNext = false;
  const timers = new Map(), reads = [], channels = [], removed = [], held = [];
  const window = new EventTarget(), document = new EventTarget(), navigator = { onLine: true };
  document.visibilityState = 'visible';
  window.setTimeout = (callback, delay) => { const id = ++timerId; timers.set(id, { at: now + delay, callback }); return id; };
  window.clearTimeout = (id) => timers.delete(id);
  const client = {
    from(table) {
      assert.equal(table, 'survey_responses');
      let after, limit, signal;
      const query = {
        select() { return query; }, eq(key, value) { assert.equal(key, 'survey_id'); assert.equal(value, 'form'); return query; },
        order(key) { assert.equal(key, 'id'); return query; }, limit(value) { limit = value; return query; },
        gt(key, value) { assert.equal(key, 'id'); after = value; return query; },
        abortSignal(value) { signal = value; return query; },
        then(resolve, reject) {
          reads.push({ at: now, after, signal });
          const snapshot = structuredClone(data.filter((r) => !after || r.id > after).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit));
          const result = nextFailure ? { data: null, error: new Error('Mock read failure') } : { data: snapshot, error: null };
          nextFailure = false;
          if (holdNext) {
            holdNext = false;
            return new Promise((release) => held.push(() => release(result))).then(resolve, reject);
          }
          return Promise.resolve(result).then(resolve, reject);
        },
      };
      return query;
    },
    channel() {
      const channel = {
        on(type, filter, callback) {
          assert.equal(type, 'postgres_changes');
          assert.equal(filter.filter, 'survey_id=eq.form');
          channel.change = callback;
          return channel;
        },
        subscribe(callback) { channel.status = callback; callback('SUBSCRIBED'); return channel; },
      };
      channels.push(channel);
      return channel;
    },
    async removeChannel(channel) { removed.push(channel); },
  };
  const mod = { exports: {} };
  new Function('module', 'exports', 'window', 'document', 'navigator', 'crypto', 'Date', source)(
    mod, mod.exports, window, document, navigator, { randomUUID: () => `channel-${channels.length}` }, { now: () => now },
  );
  const stop = mod.exports.startAttendeeSync(client, 'form', (update) => { rows = update(rows); commits++; });
  return {
    reads, channels, removed, stop,
    get rows() { return rows; }, get commits() { return commits; },
    set data(value) { data = structuredClone(value); },
    failNext() { nextFailure = true; }, holdNext() { holdNext = true; },
    async release() { assert.ok(held.length); held.shift()(); await settle(); },
    event(eventType, value, extra = {}) {
      channels.at(-1).change({ eventType, new: eventType === 'DELETE' ? {} : value, old: eventType === 'DELETE' ? value : {}, ...extra });
    },
    status(value) { channels.at(-1).status(value); },
    visibility(value) { document.visibilityState = value; document.dispatchEvent(new Event('visibilitychange')); },
    online(value) { navigator.onLine = value; window.dispatchEvent(new Event(value ? 'online' : 'offline')); },
    async advance(ms) {
      const end = now + ms;
      while (true) {
        await settle();
        const next = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
      }
      now = end;
      await settle();
    },
  };
}

test('healthy idle list reads once per minute instead of every five seconds', async () => {
  const h = harness();
  await h.advance(0);
  assert.equal(h.reads.length, 1);
  await h.advance(59_999);
  assert.equal(h.reads.length, 1, 'No five-second polling');
  await h.advance(1);
  assert.equal(h.reads.length, 2, 'Keep periodic reconciliation for missed events/deletes');
  h.stop();
});

test('bursts update check-ins, answers, email, halls and sessions in one render without any full-list read', async () => {
  const h = harness();
  await h.advance(0);
  const commits = h.commits;
  for (let i = 0; i < 100; i++) h.event('UPDATE', row('a', { checked_in: true, answers: { name: `Edited ${i}` },
    hall: 'B', email_status: 'sent', session_checkins: { gala: '2026-11-13T02:00:00Z' } }));
  h.event('INSERT', row('c'));
  h.event('INSERT', row('c')); // Delivery retries must not duplicate a registration.
  h.event('DELETE', { id: 'b' }); // RLS may return only the primary key.
  h.event('UPDATE', row('z', { survey_id: 'another-form' }));
  await h.advance(99);
  assert.equal(h.commits, commits);
  await h.advance(1);
  assert.equal(h.commits, commits + 1);
  assert.equal(h.reads.length, 1);
  assert.deepEqual(h.rows.map((r) => r.id), ['c', 'a']);
  const updated = h.rows.find((r) => r.id === 'a');
  assert.equal(updated.answers.name, 'Edited 99');
  assert.equal(updated.checked_in, true);
  assert.equal(updated.hall, 'B');
  assert.equal(updated.email_status, 'sent');
  assert.ok(updated.session_checkins.gala);
  h.event('UPDATE', row('a', { checked_in: false, session_checkins: {} }));
  await h.advance(100);
  assert.equal(h.rows.find((r) => r.id === 'a').checked_in, false, 'Undo remains live');
  h.stop();
});

test('slow snapshots replay newer insert/update/delete events instead of undoing check-in', async () => {
  const h = harness();
  h.holdNext();
  await h.advance(0);
  h.event('UPDATE', row('a', { checked_in: true }));
  h.event('INSERT', row('c'));
  h.event('DELETE', { id: 'b' });
  await h.advance(100);
  await h.release();
  assert.deepEqual(h.rows.map((r) => r.id), ['c', 'a']);
  assert.equal(h.rows.find((r) => r.id === 'a').checked_in, true);
  await h.advance(100);
  assert.equal(h.rows.find((r) => r.id === 'a').checked_in, true);
  h.stop();
});

test('hidden and offline tabs stop reads/subscriptions; returning synchronizes missed changes', async () => {
  const h = harness();
  await h.advance(0);
  const previous = h.channels.at(-1);
  h.visibility('hidden');
  h.data = [row('a', { checked_in: true }), row('c')];
  await h.advance(3_600_000);
  assert.equal(h.reads.length, 1);
  assert.equal(h.removed.length, 1);
  previous.change({ eventType: 'DELETE', old: { id: 'a' } });
  h.visibility('visible');
  await h.advance(0);
  assert.equal(h.reads.length, 2);
  assert.deepEqual(h.rows.map((r) => r.id), ['c', 'a']);
  assert.equal(h.rows.find((r) => r.id === 'a').checked_in, true);
  h.online(false);
  await h.advance(3_600_000);
  assert.equal(h.reads.length, 2);
  h.online(true);
  await h.advance(0);
  assert.equal(h.reads.length, 3);
  h.stop();
  const count = h.commits;
  await h.advance(3_600_000);
  assert.equal(h.reads.length, 3);
  assert.equal(h.commits, count);
});

test('Realtime errors use thirty-second fallback and rejoining repairs the gap immediately', async () => {
  const h = harness();
  await h.advance(0);
  h.status('CHANNEL_ERROR');
  h.status('TIMED_OUT');
  h.data = [row('a', { checked_in: true })];
  await h.advance(29_999);
  assert.equal(h.reads.length, 1);
  await h.advance(1);
  assert.equal(h.reads.length, 2);
  assert.equal(h.rows.length, 1, 'Missed deletions are repaired');
  h.status('SUBSCRIBED');
  await h.advance(0);
  assert.equal(h.reads.length, 3);
  h.stop();
});

test('large events page completely and a failed later page retains the previous complete list', async () => {
  const initial = Array.from({ length: 1201 }, (_, i) => row(String(i).padStart(5, '0')));
  const h = harness(initial);
  await h.advance(0);
  assert.equal(h.reads.length, 3);
  assert.equal(h.rows.length, 1201);
  h.holdNext();
  h.data = initial.map((r) => ({ ...r, checked_in: true }));
  await h.advance(60_000);
  h.failNext();
  await h.release();
  assert.equal(h.rows.length, 1201);
  assert.ok(h.rows.every((r) => !r.checked_in), 'Do not publish partial snapshots');
  await h.advance(30_000);
  assert.ok(h.rows.every((r) => r.checked_in));
  h.stop();
});

test('truncated payloads trigger one repair read and never corrupt the existing row', async () => {
  const h = harness();
  await h.advance(0);
  for (let i = 0; i < 10; i++) h.event('UPDATE', { id: 'a', survey_id: 'form', submitted_at: row('a').submitted_at });
  await h.advance(99);
  assert.equal(h.reads.length, 1);
  assert.equal(h.rows.find((r) => r.id === 'a').answers.name, 'Guest a');
  await h.advance(1);
  assert.equal(h.reads.length, 2);
  h.stop();
});

test('cleanup aborts in-flight reads and ignores late snapshots and subscription callbacks', async () => {
  const h = harness();
  h.holdNext();
  await h.advance(0);
  h.stop();
  assert.equal(h.reads[0].signal.aborted, true);
  h.status('SUBSCRIBED');
  await h.release();
  await h.advance(60_000);
  assert.deepEqual(h.rows, []);
  assert.equal(h.reads.length, 1);
});
