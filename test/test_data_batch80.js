/* test_data_batch80.js — 第80轮回放/研究数据边界与确定性回归 */
'use strict';
const assert = require('assert');
const fs = require('fs');
const vm = require('vm');

const storage = Object.create(null);
const sandbox = {
  console,
  setTimeout,
  clearTimeout,
  localStorage: {
    getItem(key) { return Object.prototype.hasOwnProperty.call(storage, key) ? storage[key] : null; },
    setItem(key, value) { storage[key] = String(value); },
    removeItem(key) { delete storage[key]; }
  }
};
sandbox.globalThis = sandbox;
function load(file) { vm.runInNewContext(fs.readFileSync(file, 'utf8'), sandbox, { filename: file }); }
['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js', 'core/generator.js', 'core/judge.js', 'core/engine.js',
  'benchmark/elo.js', 'benchmark/record.js', 'replay/replay.js', 'replay/replay_controller.js'].forEach(load);
const XQ = sandbox.XQ;
const R = XQ.Record;
const E = XQ.Elo;
const P = XQ.Replay;
let count = 0;
function test(name, fn) { fn(); count++; console.log('  ✓ ' + name); }
function rec(id, date, moves) { return { id, date, red: { name: '红', kind: 'llm' }, black: { name: '黑', kind: 'random' }, moves: moves || [], result: 'draw', winner: null, durationMs: 1000, illegal: 0 }; }

test('normalize rejects non-object roots without throwing', () => assert.strictEqual(R.normalize(null), null));
test('normalize replaces unsafe IDs and canonicalizes dates', () => {
  const out = R.normalize({ id: 'bad id', date: '2026-10-03T01:02:03+08:00', moves: [] });
  assert(/^normalized-/.test(out.id));
  assert.strictEqual(out.date, new Date('2026-10-02T17:02:03Z').toISOString());
});
test('player strings and models are bounded', () => {
  const out = R.normalize({ moves: [], red: { name: 'x'.repeat(400), kind: 'k', models: Array(30).fill('m') } });
  assert.strictEqual(out.red.name.length, 120); assert.strictEqual(out.red.models.length, 16);
});
test('move coordinates are lower-case and metadata is bounded', () => {
  const out = R.normalize({ moves: [{ from: 'E3', to: 'H10', side: 'red', piece: 'rook', summary: 's'.repeat(500) }] });
  assert.deepStrictEqual([out.moves[0].from, out.moves[0].to], ['e3', 'h10']); assert.strictEqual(out.moves[0].summary.length, 240);
});
test('move time and confidence are bounded', () => {
  const out = R.normalize({ moves: [{ from: 'e3', to: 'e4', timeMs: -1, confidence: 4 }] });
  assert.deepStrictEqual([out.moves[0].timeMs, out.moves[0].confidence], [0, 1]);
});
test('unknown result and winner are normalized safely', () => {
  const out = R.normalize({ moves: [], result: 'made-up', winner: 'green' });
  assert.deepStrictEqual([out.result, out.winner], ['error', null]);
});
test('validation reports malformed coordinates', () => {
  const check = R.validate({ id: 'ok', moves: [{ from: 'z9', to: 'e3' }] });
  assert.strictEqual(check.ok, false); assert(check.errors[0].includes('coordinates'));
});
test('validation accepts a bounded valid record', () => {
  const check = R.validate(rec('valid', '2026-10-03T00:00:00Z', [{ from: 'e3', to: 'e4', side: 'red' }]));
  assert.strictEqual(check.ok, true); assert.strictEqual(check.record.moves.length, 1);
});
test('canonical JSON is key-order independent', () => {
  assert.strictEqual(R.canonicalJSON({ b: 2, a: 1 }), R.canonicalJSON({ a: 1, b: 2 }));
});
test('fingerprint is deterministic and changes with content', () => {
  assert.strictEqual(R.fingerprint({ a: 1, b: 2 }), R.fingerprint({ b: 2, a: 1 }));
  assert.notStrictEqual(R.fingerprint({ a: 1 }), R.fingerprint({ a: 2 }));
});
test('stats count captures, quiet moves and average time', () => {
  const s = R.stats(rec('s', null, [{ captured: 'pawn', timeMs: 100 }, { captured: null, timeMs: 300 }]));
  assert.deepStrictEqual([s.plies, s.captures, s.quiet, s.averageTimeMs], [2, 1, 1, 200]);
});
test('estimateBytes is finite for normal data', () => assert.strictEqual(R.estimateBytes({ a: 1 }), R.canonicalJSON({ a: 1 }).length * 2));
test('compact removes analysis payload while retaining move identity', () => {
  const c = R.compact({ id: 'c', moves: [{ from: 'e3', to: 'e4', summary: 'analysis', confidence: 0.8 }] });
  assert.strictEqual(c.moves[0].summary, undefined); assert.deepStrictEqual([c.moves[0].from, c.moves[0].to], ['e3', 'e4']);
});
test('parseJSON returns normalized records', () => {
  const out = R.parseJSON(JSON.stringify({ id: 'j', moves: [{ from: 'E3', to: 'E4' }] }));
  assert.strictEqual(out.moves[0].from, 'e3');
});
test('parseJSON rejects oversized input before parsing', () => assert.throws(() => R.parseJSON('x'.repeat(10 * 1024 * 1024 + 1)), /10MB/));
test('sortRecords defaults newest first and does not mutate input', () => {
  const input = [rec('old', '2026-01-01T00:00:00Z'), rec('new', '2026-02-01T00:00:00Z')];
  assert.strictEqual(R.sortRecords(input).map(x => x.id).join(','), 'new,old'); assert.strictEqual(input[0].id, 'old');
});
test('sortRecords supports oldest first', () => assert.strictEqual(R.sortRecords([rec('b', '2026-02-01'), rec('a', '2026-01-01')], false).map(x => x.id).join(','), 'a,b'));
test('dedupeRecords keeps the newest copy of an ID', () => {
  const out = R.dedupeRecords([rec('x', '2026-01-01'), rec('x', '2026-02-01'), rec('y', '2026-01-01')]);
  assert.strictEqual(out.map(x => x.id).join(','), 'x,y'); assert.strictEqual(out[0].date, '2026-02-01');
});
test('mergeRecords deduplicates both inputs', () => assert.strictEqual(R.mergeRecords([rec('x')], [rec('x'), rec('y')]).length, 2));
test('moveAt handles one-based and invalid plies', () => {
  const r = rec('m', null, [{ from: 'e3', to: 'e4' }]); assert.strictEqual(R.moveAt(r, 1).from, 'e3'); assert.strictEqual(R.moveAt(r, 0), null); assert.strictEqual(R.moveAt(r, 9), null);
});
test('resultLabel maps known and preserves bounded unknown values', () => { assert.strictEqual(R.resultLabel('draw'), '协议和'); assert.strictEqual(R.resultLabel('odd'), 'odd'); });
test('clone ignores prototype pollution keys and isolates nested values', () => {
  const copy = R.clone({ safe: { n: 1 }, constructor: 'bad' }); copy.safe.n = 2; assert.strictEqual(Object.prototype.hasOwnProperty.call(copy, 'constructor'), false);
});
test('candidate and vote arrays are bounded', () => {
  const m = R.normalize({ moves: [{ from: 'e3', to: 'e4', candidates: Array(20).fill({ move: 'e3-e4' }), votes: Array(20).fill({ model: 'm' }) }] }).moves[0];
  assert.deepStrictEqual([m.candidates.length, m.votes.length], [8, 16]);
});

test('expected and update recover from non-finite ratings', () => { const u = E.update({ ra: NaN, rb: Infinity, scoreA: 1, k: 0 }); assert(Number.isFinite(E.expected(NaN, Infinity))); assert.deepStrictEqual([u.ra, u.rb], [1500, 1500]); });
test('score and K normalizers clamp hostile values', () => { assert.deepStrictEqual([E.normalizeScore(-3), E.normalizeScore(3), E.normalizeK(-1), E.normalizeK(99999)], [0, 1, 32, 1000]); });
test('normalizeName bounds blank and huge names', () => { assert.strictEqual(E.normalizeName(''), '?'); assert.strictEqual(E.normalizeName('x'.repeat(300)).length, 160); });
test('statsOf returns a detached zero-safe object', () => { E.resetAll(); const s = E.statsOf('missing'); s.games = 99; assert.strictEqual(E.statsOf('missing').games, 0); });
test('leaderboardPage filters by minimum games', () => { E.resetAll(); E.applyResult('A', 'B', 'red'); assert.strictEqual(E.leaderboardPage({ minGames: 2 }).length, 0); assert.strictEqual(E.leaderboardPage({ minGames: 1 }).length, 2); });
test('leaderboardPage supports name prefixes', () => assert.strictEqual(E.leaderboardPage({ prefix: 'A' }).map(x => x.name).join(','), 'A'));
test('leaderboardPage supports stable offset and limit', () => { E.applyResult('C', 'D', 'black'); assert.strictEqual(E.leaderboardPage({ offset: 1, limit: 1 }).length, 1); });
test('rankOf returns one-based rank and null for absent names', () => { assert.strictEqual(E.rankOf('A'), 1); assert.strictEqual(E.rankOf('missing'), null); });
test('compare exposes rating delta and expected score', () => { const c = E.compare('A', 'B'); assert.strictEqual(c.delta, 32); assert(c.expectedA > 0.5); });
test('ratingRange reports min/max/count', () => { const range = E.ratingRange(); assert.deepStrictEqual([range.min, range.max, range.count], [1484, 1516, 4]); });
test('applyResultOnce suppresses duplicate game IDs', () => { E.resetAll(); const first = E.applyResultOnce('game-1', 'A', 'B', 'red'); const second = E.applyResultOnce('game-1', 'A', 'B', 'red'); const stats = E.statsOf('A'); assert.strictEqual(first.applied, true); assert.strictEqual(second.duplicate, true); assert.deepStrictEqual([stats.games, stats.win, stats.draw, stats.loss], [1, 1, 0, 0]); });
test('forgetResult permits explicit reprocessing', () => { E.forgetResult('game-1'); assert.strictEqual(E.applyResultOnce('game-1', 'A', 'B', 'red').applied, true); });
test('invalid Elo model values remain finite and bounded', () => { E.applyResult(null, undefined, 'red', Infinity); assert(E.leaderboard().every(x => Number.isFinite(x.rating))); });

test('full-width evaluation signs and digits are parsed', () => assert.strictEqual(P.parseEval('黑优 ２'), -2));
test('normalizePly clamps and rejects non-finite values', () => { assert.deepStrictEqual([P.normalizePly(-2, 5), P.normalizePly(99, 5), P.normalizePly('x', 5, 3)], [0, 5, 3]); });
test('moveAt and captureIndex are deterministic', () => { const r = rec('p', null, [{ from: 'e3', to: 'e4' }, { from: 'e7', to: 'e6', captured: 'pawn' }]); assert.strictEqual(P.moveAt(r, 2).captured, 'pawn'); assert.strictEqual(P.captureIndex(r).join(','), '2'); });
test('normalizeBookmarks removes duplicates and out-of-range values', () => assert.strictEqual(P.normalizeBookmarks([3, 1, 3, 0, 8, 'x'], 5).join(','), '1,3'));
test('toggleBookmark is idempotent and sorted', () => { assert.strictEqual(P.toggleBookmark([3, 1, 3], 3).join(','), '1'); assert.strictEqual(P.toggleBookmark([3, 1], 2).join(','), '1,2,3'); });
test('bookmark keys are safe and bounded', () => { const key = P.bookmarkKey('a/b <script>'); assert(!/[<>/]/.test(key)); assert(key.length <= 174); });
test('empty replay progress and diagnostics are safe', () => { const s = P.create({ id: 'empty', moves: [] }), p = s.progress(); assert.deepStrictEqual([p.idx, p.total, p.ratio, p.percent], [0, 0, 0, 0]); assert.strictEqual(s.diagnostics().skippedCount, 0); });
test('replay exposes move lookup, capture index and skipped hands', () => { const s = P.create({ moves: [{ from: 'bad', to: 'bad' }, { from: 'b1', to: 'c3', captured: 'pawn' }] }); assert.strictEqual(s.moveAt(2).captured, 'pawn'); assert.strictEqual(s.capturePlies().join(','), '2'); s.goto(2); assert.strictEqual(s.skippedHands().join(','), '1'); });
test('replay copies the move array boundary', () => { const moves = [{ from: 'e3', to: 'e4' }], s = P.create({ moves }); moves.push({ from: 'e7', to: 'e6' }); assert.strictEqual(s.total(), 1); });

test('controller accepts bounded initial speed and base delay', () => { const s = P.create({ moves: [] }); const c = XQ.ReplayController.create(s, { speed: 5, baseMs: 2000 }); assert.deepStrictEqual([c.speed(), c.baseMs(), c.delay()], [5, 2000, 400]); c.dispose(); });
test('controller rejects invalid speed and accepts numeric strings', () => { const c = XQ.ReplayController.create(P.create({ moves: [] })); assert.strictEqual(c.setSpeed('5'), true); assert.strictEqual(c.setSpeed(3), false); assert.strictEqual(c.speed(), 5); c.dispose(); });
test('controller base delay is capped and rescheduled safely', () => { const c = XQ.ReplayController.create(P.create({ moves: [] })); assert.strictEqual(c.setBaseMs(999999999), true); assert.strictEqual(c.baseMs(), 86400000); assert.strictEqual(c.setBaseMs(-1), false); c.dispose(); });
test('controller exposes stable loop state and tick counter', () => { const c = XQ.ReplayController.create(P.create({ moves: [] }), { loop: true }); assert.strictEqual(c.isLooping(), true); c.setLoop(false); assert.strictEqual(c.isLooping(), false); assert.strictEqual(c.ticks(), 0); c.dispose(); });
test('controller isolates callback exceptions and reports phase', () => { let errors = 0; const c = XQ.ReplayController.create(P.create({ moves: [{ from: 'b1', to: 'c3' }] }), { onState() { throw new Error('observer'); }, onError(err, phase) { if (err && phase === 'state') errors++; } }); c.stepNext(); assert.strictEqual(errors, 1); c.dispose(); });

console.log('test_data_batch80: ' + count + ' PASS');
