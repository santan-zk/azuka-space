// Run with:  node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('../js/store.js');
const V = require('../js/validators.js');
const { buildSteps } = require('../js/visualiser.js');

const at = (y, m, d, h = 12, mi = 0) => new Date(y, m - 1, d, h, mi, 0);

test('dates: valid and invalid date strings', () => {
  assert.ok(S.parseDateOnly('2026-02-28'));
  assert.equal(S.parseDateOnly('2026-02-30'), null);
  assert.equal(S.parseDateOnly('2026-13-01'), null);
  assert.equal(S.parseDateOnly('26-01-01'), null);
  assert.equal(S.parseDateOnly('1999-01-01'), null);
  assert.ok(S.parseDateOnly('2028-02-29')); // leap year
  assert.equal(S.parseDateOnly('2027-02-29'), null);
});

test('overdue: derived from deadline and completion, never for completed tasks', () => {
  const now = at(2026, 10, 27, 12);
  assert.equal(S.isOverdue({ status: 'todo', dueDate: '2026-10-26' }, now), true);
  assert.equal(S.isOverdue({ status: 'done', dueDate: '2026-10-26' }, now), false);
  assert.equal(S.isOverdue({ status: 'todo', dueDate: '2026-10-27' }, now), false, 'date only = due at end of that day');
  assert.equal(S.isOverdue({ status: 'todo', dueDate: '2026-10-27', dueTime: '11:00' }, now), true);
  assert.equal(S.isOverdue({ status: 'todo', dueDate: '2026-10-27', dueTime: '13:00' }, now), false);
  assert.equal(S.isOverdue({ status: 'doing', dueDate: null }, now), false, 'no date is never overdue');
});

test('deadline wording', () => {
  const now = at(2026, 10, 27, 12);
  assert.equal(S.describeDeadline({ dueDate: '2026-10-27' }, now), 'due today');
  assert.equal(S.describeDeadline({ dueDate: '2026-10-28' }, now), 'due tomorrow');
  assert.equal(S.describeDeadline({ dueDate: '2026-10-30' }, now), 'due in 3 days');
  assert.equal(S.describeDeadline({ dueDate: '2026-10-26' }, now), 'overdue since yesterday');
  assert.equal(S.describeDeadline({ dueDate: '2026-10-20' }, now), 'overdue by 7 days');
});

test('targets: 20h at 60% = 12h engineering + 8h academic, and the 50 and 70 ends', () => {
  let t = S.computeTargets({ periodHours: 20, engPct: 60 });
  assert.equal(t.engineeringMin, 720); assert.equal(t.academicMin, 480);
  t = S.computeTargets({ periodHours: 20, engPct: 50 });
  assert.equal(t.engineeringMin, 600); assert.equal(t.academicMin, 600);
  t = S.computeTargets({ periodHours: 20, engPct: 70 });
  assert.equal(t.engineeringMin, 840); assert.equal(t.academicMin, 360);
  t = S.computeTargets({ periodHours: 7.5, engPct: 65 });
  assert.equal(t.engineeringMin + t.academicMin, 450, 'the two targets always add up to the total');
});

test('default state is empty with a 60/40 target', () => {
  const d = S.defaultState();
  assert.equal(d.courses.length, 0); assert.equal(d.tasks.length, 0); assert.equal(d.log.length, 0);
  assert.equal(d.prefs.engPct, 60);
});

test('period ranges: week starts on Monday', () => {
  const r = S.periodRange('week', at(2026, 10, 28)); // Wednesday
  assert.equal(r.start.getDay(), 1);
  assert.equal(r.start.getDate(), 26);
  assert.equal(r.end.getDate(), 2);
  const sunday = S.periodRange('week', at(2026, 11, 1));
  assert.equal(sunday.start.getDate(), 26, 'Sunday belongs to the week that started the previous Monday');
});

test('logged time is counted per domain and per period from log entries only', () => {
  const st = S.defaultState();
  st.tasks = [{ id: 'a', domain: 'academic' }, { id: 'e', domain: 'engineering' }];
  st.log = [
    { id: '1', taskId: 'a', minutes: 30, at: at(2026, 10, 27).toISOString() },
    { id: '2', taskId: 'e', minutes: 90, at: at(2026, 10, 27).toISOString() },
    { id: '3', taskId: 'e', minutes: 45, at: at(2026, 10, 12).toISOString() } // earlier week
  ];
  const range = S.periodRange('week', at(2026, 10, 28));
  assert.equal(S.loggedInRange(st, range, 'engineering'), 90);
  assert.equal(S.loggedInRange(st, range, 'academic'), 30);
  assert.equal(S.taskLoggedMin(st, 'e'), 135);
});

test('sanitize: rejects non-objects and wrong schema, repairs bad records', () => {
  assert.equal(S.sanitize(null).fatal, true);
  assert.equal(S.sanitize([]).fatal, true);
  assert.equal(S.sanitize({ schema: 99 }).fatal, true);
  const bad = {
    schema: 1,
    courses: [{ id: 'c1', code: 'COS 106', title: 'Web' }, { id: 'c1', code: 'dup', title: 'dup' }, { id: 'c2', code: '', title: 'x' }],
    tasks: [
      { id: 't1', title: 'ok', domain: 'engineering', status: 'todo', priority: 'high', dueDate: '2026-02-30' },
      { id: 't2', title: '', domain: 'academic' },
      { id: 't3', title: 'x', domain: 'nonsense' },
      { id: 't4', title: 'linked', domain: 'academic', courseId: 'missing' },
      { id: 't5', title: 'rust', domain: 'engineering', estMin: -5 }
    ],
    log: [{ id: 'l1', taskId: 'nope', minutes: 5, at: new Date().toISOString() }, { id: 'l2', taskId: 't1', minutes: 0, at: new Date().toISOString() }],
    prefs: { engPct: 99, periodHours: 0, period: 'decade' }
  };
  const r = S.sanitize(bad);
  assert.equal(r.fatal, false);
  assert.equal(r.state.courses.length, 1);
  assert.deepEqual(r.state.tasks.map(t => t.id), ['t1', 't4', 't5']);
  assert.equal(r.state.tasks[0].dueDate, null);
  assert.equal(r.state.tasks[1].courseId, null, 'no broken course references survive');
  assert.equal(r.state.tasks[2].estMin, null);
  assert.equal(r.state.log.length, 0);
  assert.equal(r.state.prefs.engPct, 60, 'out-of-range allocation falls back to the default');
  assert.ok(r.problems.length >= 8);
});

test('sanitize: a good export round-trips unchanged', () => {
  const st = S.defaultState();
  st.courses.push({ id: 'c', code: 'COS 106', title: 'Intro to Web', term: 'First', notes: '' });
  st.tasks.push({ id: 't', title: 'Rust exercise', domain: 'engineering', courseId: null, category: 'Rust', type: 'Exercise', dueDate: '2026-11-01', dueTime: '09:30', priority: 'high', status: 'doing', estMin: 90, notes: 'n', createdAt: new Date().toISOString(), completedAt: null });
  st.log.push({ id: 'l', taskId: 't', minutes: 20, at: new Date().toISOString(), source: 'timer' });
  st.prefs = { engPct: 70, periodHours: 12.5, period: 'month' };
  const r = S.sanitize(JSON.parse(JSON.stringify(st)));
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.state, st);
});

test('loadState/saveState: handles missing, corrupt and unavailable storage without throwing', () => {
  const store = {};
  globalThis.localStorage = { getItem: k => (k in store ? store[k] : null), setItem: (k, v) => { store[k] = String(v); }, removeItem: k => { delete store[k]; } };
  assert.deepEqual(S.loadState().state, S.defaultState());
  store[S.STORAGE_KEY] = '{not json';
  let r = S.loadState({ backup: true });
  assert.equal(r.notices[0].kind, 'error');
  assert.equal(store[S.BACKUP_KEY], '{not json', 'unreadable data is kept, not destroyed');
  store[S.STORAGE_KEY] = JSON.stringify({ schema: 7 });
  assert.equal(S.loadState().notices[0].kind, 'error');
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); }, removeItem() { throw new Error('blocked'); } };
  r = S.loadState();
  assert.equal(r.storageOk, false);
  assert.equal(S.saveState(S.defaultState()).ok, false);
  delete globalThis.localStorage;
});

test('name validation', () => {
  const ok = ["Obi Chidera Azuka", "Mary-Jane O'Neil", "José Ñandú", "Zoë Müller", "Chidera", "Ng"];
  ok.forEach(n => assert.equal(V.validateName(n), null, n));
  ['', '   ', 'A', 'John3', 'Jo (hn)', 'Jo[hn]', 'Alex 😀', 'Bob@home', '-Bob', "Bob--Lee", 'a'.repeat(81)].forEach(n => assert.notEqual(V.validateName(n), null, JSON.stringify(n)));
  assert.equal(V.validateName('  Chidera  '), null, 'surrounding whitespace is trimmed');
});

test('email validation', () => {
  ['a@b.co', 'first.last+tag@sub.example.com'].forEach(e => assert.equal(V.validateEmail(e), null, e));
  ['', 'plain', 'a@', '@b.com', 'a@b', 'a b@c.com', 'a@@b.com', '.a@b.com', 'a.@b.com', 'a..b@c.com'].forEach(e => assert.notEqual(V.validateEmail(e), null, e));
});

test('phone validation: digits only, nothing silently cleaned', () => {
  assert.equal(V.validatePhone('08012345678'), null);
  ['', '0801 234 5678', '(0801)2345678', '0801-234-5678', '+2348012345678', '0801abc5678', '123456', '1'.repeat(16), ' 08012345678'].forEach(p => assert.notEqual(V.validatePhone(p), null, JSON.stringify(p)));
});

test('message validation', () => {
  assert.equal(V.validateMessage('Hello there, nice site.'), null);
  ['', '          ', 'short', 'x'.repeat(2001)].forEach(m => assert.notEqual(V.validateMessage(m), null));
});

test('bubble sort visualiser: sorts correctly, counts match, ends sorted', () => {
  const inputs = [[34, 12, 27, 5, 40, 19, 8, 31, 22, 15], [1], [], [2, 1], [1, 2, 3, 4], [5, 4, 3, 2, 1], [3, 3, 1, 3, 2], Array.from({ length: 30 }, (_, i) => (i * 17) % 23)];
  inputs.forEach(inp => {
    const steps = buildSteps(inp);
    const last = steps[steps.length - 1];
    assert.deepEqual(last.arr, inp.slice().sort((a, b) => a - b));
    assert.equal(last.sortedFrom, 0);
    assert.equal(last.compares, steps.filter(s => s.cmp && !s.swapped).length);
    assert.equal(last.swaps, steps.filter(s => s.swapped).length);
    steps.forEach(s => assert.deepEqual(s.arr.slice().sort((a, b) => a - b), inp.slice().sort((a, b) => a - b), 'every step is a permutation of the input'));
  });
  assert.equal(buildSteps([1, 2, 3, 4]).slice(-1)[0].compares, 3, 'sorted input: one pass, n-1 comparisons (best case O(n))');
  assert.equal(buildSteps([5, 4, 3, 2, 1]).slice(-1)[0].swaps, 10, 'reversed input of 5 needs n(n-1)/2 = 10 swaps');
  assert.deepEqual(buildSteps([5, 2, 9]).length > 0, true);
});

test('heatLevel: fixed steps, never negative or NaN', () => {
  const S = require('../js/store.js');
  assert.deepStrictEqual([0, -5, NaN, undefined, 1, 29, 30, 89, 90, 179, 180, 600].map(S.heatLevel), [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4]);
});

test('dailyMinutes: buckets by local day, honours domain, ignores orphaned entries', () => {
  const S = require('../js/store.js');
  const start = new Date(2026, 9, 26);
  const state = { tasks: [{ id: 'e', domain: 'engineering' }, { id: 'a', domain: 'academic' }],
    log: [{ taskId: 'e', minutes: 30, at: new Date(2026, 9, 26, 23, 59).toISOString() }, { taskId: 'e', minutes: 15, at: new Date(2026, 9, 27, 0, 1).toISOString() },
      { taskId: 'a', minutes: 60, at: new Date(2026, 9, 27, 9, 0).toISOString() }, { taskId: 'gone', minutes: 99, at: new Date(2026, 9, 27).toISOString() },
      { taskId: 'e', minutes: 5, at: new Date(2026, 8, 1).toISOString() }] };
  assert.deepStrictEqual(S.dailyMinutes(state, start, 3, 'all').map(d => d.minutes), [30, 75, 0]);
  assert.deepStrictEqual(S.dailyMinutes(state, start, 3, 'engineering').map(d => d.minutes), [30, 15, 0]);
  assert.deepStrictEqual(S.dailyMinutes(state, start, 3, 'academic').map(d => d.minutes), [0, 60, 0]);
});
