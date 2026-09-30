/* test_record_edges.js — Elo / 棋谱存取边界回归 */
'use strict';
const assert = require('assert');
require('../benchmark/elo.js');
require('../benchmark/record.js');

const memory = Object.create(null);
globalThis.localStorage = {
  getItem(key) { return Object.prototype.hasOwnProperty.call(memory, key) ? memory[key] : null; },
  setItem(key, value) { memory[key] = String(value); },
  removeItem(key) { delete memory[key]; }
};
const E = globalThis.XQ.Elo;
const R = globalThis.XQ.Record;
let count = 0;
function test(name, fn) {
  fn();
  count++;
  console.log('  ✓ ' + name);
}
function setRaw(key, value) { memory[key] = value; }
function rec(id) { return { id, moves: [], date: new Date().toISOString() }; }

test('评分读取只接受有限数字，损坏评分回退到初始分', () => {
  const invalid = ['oops', '1500', false, {}, [], null];
  for (const value of invalid) {
    setRaw('xq_elo_v1', JSON.stringify({ A: value, Zero: 0 }));
    assert.strictEqual(E.ratingOf('A'), 1500);
    assert.strictEqual(E.ratingOf('Zero'), 0);
  }
  setRaw('xq_elo_v1', '{"A":1e309}');
  assert.strictEqual(E.ratingOf('A'), 1500);
});

test('损坏评分参与对局会恢复初始分，不污染正常对手', () => {
  const invalid = ['oops', '1500', false, {}, [], null];
  for (const value of invalid) {
    setRaw('xq_elo_v1', JSON.stringify({ A: value, B: 1500 }));
    assert.deepStrictEqual(E.applyResult('A', 'B', 'red'), { red: 1516, black: 1484 });
    const saved = JSON.parse(localStorage.getItem('xq_elo_v1'));
    assert.strictEqual(saved.A, 1516);
    assert.strictEqual(saved.B, 1484);
  }
  setRaw('xq_elo_v1', '{"A":1e309,"B":1500}');
  assert.deepStrictEqual(E.applyResult('A', 'B', 'red'), { red: 1516, black: 1484 });
});

test('损坏评分的同名自战会修复评分，且不累计战绩', () => {
  setRaw('xq_elo_v1', JSON.stringify({ A: '1500' }));
  assert.deepStrictEqual(E.applyResult('A', 'A', 'red'), { red: 1500, black: 1500 });
  const saved = JSON.parse(localStorage.getItem('xq_elo_v1'));
  assert.strictEqual(saved.A, 1500);
  assert.strictEqual(saved['stats:A'], undefined);
});

test('K=0 是合法的零变分，而不是回退到默认 K', () => {
  const next = E.update({ ra: 1500, rb: 1500, scoreA: 1, k: 0 });
  assert.strictEqual(next.ra, 1500);
  assert.strictEqual(next.rb, 1500);
});
test('Elo 根值为 null 时按空表处理', () => {
  setRaw('xq_elo_v1', 'null');
  assert.strictEqual(E.ratingOf('missing'), 1500);
  assert.deepStrictEqual(E.leaderboard(), []);
});
test('Elo 根值为数组时按空表处理', () => {
  setRaw('xq_elo_v1', '["bad"]');
  assert.strictEqual(E.ratingOf('missing'), 1500);
  assert.deepStrictEqual(E.leaderboard(), []);
});
test('排行榜过滤非数值或非有限评分', () => {
  setRaw('xq_elo_v1', JSON.stringify({ Good: 1600, Text: 'oops', Infinite: Infinity }));
  assert.deepStrictEqual(E.leaderboard().map(x => x.name), ['Good']);
});
test('损坏的战绩计数规范化为零，不泄漏字符串或 NaN', () => {
  setRaw('xq_elo_v1', JSON.stringify({ A: 1600, 'stats:A': { games: 'bad', win: NaN, draw: -1, loss: 2.5 } }));
  const a = E.leaderboard()[0];
  assert.deepStrictEqual([a.games, a.win, a.draw, a.loss], [0, 0, 0, 2]);
});
test('__proto__ 模型名按普通名字处理', () => {
  setRaw('xq_elo_v1', '{}');
  assert.strictEqual(E.ratingOf('__proto__'), 1500);
  E.applyResult('Safe', '__proto__', 'red');
  assert(Number.isFinite(E.ratingOf('__proto__')));
});

test('棋谱存储根值 null 回退为空列表', () => {
  setRaw('xq_records_v1', 'null');
  assert.deepStrictEqual(R.list(), []);
});
test('棋谱列表过滤缺 ID、moves 或非对象条目', () => {
  setRaw('xq_records_v1', JSON.stringify([null, {}, { id: 'bad-moves' }, rec('valid')]));
  assert.deepStrictEqual(R.list().map(x => x.id), ['valid']);
  assert.strictEqual(R.get('valid').id, 'valid');
});
test('调用 list 后修改返回数组不会篡改内部缓存', () => {
  setRaw('xq_records_v1', JSON.stringify([rec('safe-list')]));
  const result = R.list();
  result.push(rec('phantom'));
  assert.strictEqual(R.get('phantom'), null);
});
test('所有保存尝试失败时，不在缓存中伪造新记录', () => {
  setRaw('xq_records_v1', JSON.stringify([rec('kept')]));
  R.list();
  const realSet = localStorage.setItem;
  localStorage.setItem = function () { throw new Error('quota'); };
  try { R.save(rec('phantom-save')); } finally { localStorage.setItem = realSet; }
  assert.strictEqual(R.get('phantom-save'), null);
  assert.strictEqual(R.get('kept').id, 'kept');
});
test('删除持久化失败时，列表缓存仍与实际存储一致', () => {
  setRaw('xq_records_v1', JSON.stringify([rec('kept-remove')]));
  R.list();
  const realSet = localStorage.setItem;
  localStorage.setItem = function () { throw new Error('quota'); };
  try { R.remove('kept-remove'); } finally { localStorage.setItem = realSet; }
  assert.strictEqual(R.get('kept-remove').id, 'kept-remove');
});
test('导入棋谱保留池不挤掉 60 条真实对局', () => {
  const games = Array.from({ length: 60 }, (_, i) => rec('real-' + i));
  setRaw('xq_records_v1', JSON.stringify(games));
  assert(R.saveImported({ moves: [] }));
  const saved = R.list();
  assert.strictEqual(saved.filter(x => x.id.indexOf('import-') !== 0).length, 60);
  assert(saved.some(x => x.id === 'real-0'));
});
test('保存第 61 条真实对局时也不挤掉独立导入池', () => {
  const games = Array.from({ length: 60 }, (_, i) => rec('real-next-' + i));
  setRaw('xq_records_v1', JSON.stringify(games));
  const imported = R.saveImported({ moves: [] });
  R.save(rec('real-next-60'));
  assert(R.get(imported.id));
  assert.strictEqual(R.list().filter(x => x.id.indexOf('import-') !== 0).length, 60);
});
test('容量淘汰棋谱时同步清理其回放进度和书签', () => {
  const games = Array.from({ length: 60 }, (_, i) => rec('real-evict-' + i));
  setRaw('xq_records_v1', JSON.stringify(games));
  R.list();
  localStorage.setItem('xq_replay_pos_real-evict-0', '17');
  localStorage.setItem('xq_replay:bm:real-evict-0', '[4,17]');
  R.save(rec('real-evict-new'));
  assert.strictEqual(R.get('real-evict-0'), null);
  assert.strictEqual(localStorage.getItem('xq_replay_pos_real-evict-0'), null);
  assert.strictEqual(localStorage.getItem('xq_replay:bm:real-evict-0'), null);
});
test('导入池淘汰棋谱时也清理对应回放状态', () => {
  const first = R.saveImported({ moves: [] });
  localStorage.setItem('xq_replay_pos_' + first.id, '3');
  localStorage.setItem('xq_replay:bm:' + first.id, '[3]');
  R.saveImported({ moves: [] });
  R.saveImported({ moves: [] });
  assert.strictEqual(R.get(first.id), null);
  assert.strictEqual(localStorage.getItem('xq_replay_pos_' + first.id), null);
  assert.strictEqual(localStorage.getItem('xq_replay:bm:' + first.id), null);
});
test('finish 保留显式传入的零时长', () => {
  const r = rec('zero-duration');
  R.finish(r, { result: 'draw', winner: null }, 0);
  assert.strictEqual(r.durationMs, 0);
});
test('CSV 对逗号、双引号和换行按 RFC 规则转义', () => {
  setRaw('xq_elo_v1', JSON.stringify({ 'A,"B\nC': 1500 }));
  assert(R.exportCSV().includes('"A,""B\nC"'));
});
test('CSV 对表格公式前缀做文本化保护', () => {
  setRaw('xq_elo_v1', JSON.stringify({ '=1+1': 1500 }));
  assert(R.exportCSV().includes("'=1+1"));
});
test('CSV 保留有效的零分而不是替换成默认分', () => {
  setRaw('xq_elo_v1', JSON.stringify({ Zero: 0 }));
  assert(R.exportCSV().split('\n').some(line => line.startsWith('Zero,0,')));
});
test('导出总备份遇到损坏的 Elo 和设置 JSON 时安全降级', () => {
  setRaw('xq_elo_v1', '{broken');
  setRaw('xq_v1_settings', '{broken');
  const backup = R.exportAll();
  assert.deepStrictEqual(backup.elo, {});
  assert.strictEqual(backup.settings, null);
});
test('空记录备份以 replace 导入会清空当前记录', () => {
  setRaw('xq_records_v1', JSON.stringify([rec('replace-me')]));
  R.list();
  R.importAllBackup({ kind: 'llm-chess-backup', records: [] }, 'replace');
  assert.deepStrictEqual(R.list(), []);
});
test('备份记录写入完全失败时明确报错，不返回虚假的导入成功', () => {
  setRaw('xq_records_v1', '[]');
  R.list();
  const realSet = localStorage.setItem;
  localStorage.setItem = function () { throw new Error('quota'); };
  try {
    assert.throws(() => R.importAllBackup({ kind: 'llm-chess-backup', records: [rec('cannot-save')] }, 'merge'), /保存|存储|storage/i);
  } finally { localStorage.setItem = realSet; }
});
test('备份记录保存成功但 Elo/设置写入失败时返回部分失败清单', () => {
  setRaw('xq_records_v1', '[]');
  R.list();
  const realSet = localStorage.setItem;
  localStorage.setItem = function (key, value) {
    if (key === 'xq_elo_v1' || key === 'xq_v1_settings') throw new Error('quota');
    memory[key] = String(value);
  };
  let result;
  try {
    result = R.importAllBackup({ kind: 'llm-chess-backup', records: [rec('partial-restore')], elo: { A: 1600 }, settings: { lang: 'en' } }, 'replace');
  } finally { localStorage.setItem = realSet; }
  assert.strictEqual(R.get('partial-restore').id, 'partial-restore');
  assert.strictEqual(result.added, 1);
  assert.deepStrictEqual(result.failedParts, ['elo', 'settings']);
});

async function testFileImport() {
  const realReader = globalThis.FileReader;
  try {
    let readCalled = false;
    globalThis.FileReader = function () {
      this.readAsText = function (file) { readCalled = true; this.result = file.text; this.onload(); };
    };
    await assert.rejects(R.importFromFile({ size: 10 * 1024 * 1024 + 1, text: '{}' }), /10MB/);
    assert.strictEqual(readCalled, false);
    console.log('  ✓ 文件导入按字节上限提前拒绝大文件'); count++;

    globalThis.FileReader = function () {
      this.readAsText = function () { setImmediate(() => this.onabort()); };
    };
    const abortResult = await Promise.race([
      R.importFromFile({ size: 10, text: '' }).then(() => 'resolved', e => e.message),
      new Promise(resolve => setTimeout(() => resolve('pending'), 50))
    ]);
    assert.notStrictEqual(abortResult, 'pending');
    assert.match(abortResult, /中止|取消|abort/i);
    console.log('  ✓ 文件读取中止会结束 Promise'); count++;

    globalThis.FileReader = function () {
      this.readAsText = function () { this.result = 'null'; this.onload(); };
    };
    await assert.rejects(R.importFromFile({ size: 4, text: 'null' }), /棋谱|moves|对象/);
    console.log('  ✓ 文件导入拒绝 null 等非棋谱根类型'); count++;
  } finally { globalThis.FileReader = realReader; }
}

testFileImport().then(() => {
  console.log('test_record_edges: ' + count + ' PASS');
}).catch(error => {
  console.error('test_record_edges failed:', error);
  process.exitCode = 1;
});
