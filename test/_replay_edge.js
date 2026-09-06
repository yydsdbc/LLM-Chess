'use strict';
/* test/_replay_edge.js — 回放边界 + 书签纯逻辑守护 (v1.0.daily 第18轮)
 * 断言:
 *  E1 空棋谱 (0 手) 可创建/导航不炸
 *  E2 脏棋谱 (缺坐标/非法着法) rebuild 容错, skipped 计数正确
 *  E3 toggleBookmark 添加/去重/移除/排序/非法 ply 忽略 (纯函数不变式)
 *  E4 bookmarkKey 按棋谱 id 隔离
 * 用法: node test/_replay_edge.js
 */
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var sandbox = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout };
sandbox.globalThis = sandbox;
['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js', 'core/generator.js', 'core/judge.js', 'core/engine.js', 'benchmark/record.js', 'replay/replay.js', 'replay/replay_controller.js']
  .forEach(function (f) { vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f }); });
var XQ = sandbox.XQ;
var fails = [];
function ok(cond, msg) {
  if (cond) console.log('  [PASS] ' + msg);
  else { console.log('  [FAIL] ' + msg); fails.push(msg); }
}

// E1 空棋谱
var empty = XQ.Replay.create({ id: 'edge-empty', red: { name: '红' }, black: { name: '黑' }, moves: [] });
ok(empty && empty.total() === 0, 'E1 空棋谱 total=0');
ok(empty.idx() === 0, 'E1 空棋谱 idx=0');
empty.next(); empty.goto(5); empty.prev();   // 不应抛
ok(empty.idx() === 0, 'E1 空棋谱 越界导航安全回落 idx=0');
var stE = empty.state();
ok(stE && stE.total === 0, 'E1 空棋谱 state 可读');

// E2 脏棋谱: 缺坐标 + 非法着法混入
var dirty = XQ.Replay.create({
  id: 'edge-dirty',
  moves: [
    { n: 1, side: 'red', piece: 'cannon', from: 'b3', to: 'e3' },      // 合法 (当头炮)
    { n: 2, side: 'black' },                                            // 缺坐标
    { n: 3, side: 'red', piece: 'pawn', from: 'e4', to: 'e9' },        // 兵越河到 e9 非法
    null                                                                // 空条目
  ]
});
ok(dirty.total() === 4, 'E2 脏棋谱 total 保留原手数=4');
dirty.goto(2);
ok(dirty.state().skippedCount === 1, 'E2 goto(2) 后 skipped=1 (缺坐标手)');
dirty.goto(4);
ok(dirty.state().skippedCount === 3, 'E2 goto(4) 后 skipped=3 (+非法着法 + 空条目)');
ok(dirty.idx() === 4, 'E2 脏棋谱 goto 末尾不炸');

// E3 toggleBookmark 纯逻辑
var tb = XQ.Replay.toggleBookmark;
var l = [];
l = tb(l, 3); ok(l.join(',') === '3', 'E3 添加 {3}');
l = tb(l, 1); ok(l.join(',') === '1,3', 'E3 升序插入 {1,3}');
l = tb(l, 2); ok(l.join(',') === '1,2,3', 'E3 升序插入 {1,2,3}');
l = tb(l, 2); ok(l.join(',') === '1,3', 'E3 去重移除 {1,3}');
var before = l.slice();
tb(l, 0); tb(l, -1); tb(l, NaN); tb(l, 2.4);
ok(l.join(',') === '1,3', 'E3 非法 ply (0/-1/NaN/小数) 忽略不改原数组');
ok(before.join(',') === '1,3', 'E3 入参数组不被原地修改 (纯函数)');

// E4 bookmarkKey
ok(XQ.Replay.bookmarkKey('r123') === 'xq_replay:bm:r123', 'E4 键含棋谱 id');
ok(XQ.Replay.bookmarkKey() === 'xq_replay:bm:unknown', 'E4 缺 id 回落 unknown (不与真实谱撞键)');

// E5 控制器: 空棋谱上 play/step 不炸 (回调型)
var ctrl = XQ.ReplayController.create(empty, { onState: function () {}, onPlayState: function () {} });
ctrl.play(); ctrl.stepNext(); ctrl.stepPrevCapture(); ctrl.toEnd(); ctrl.pause(); ctrl.dispose();
ok(true, 'E5 空棋谱控制器全操作不炸');

console.log(fails.length ? 'replay_edge: ' + fails.length + ' FAIL' : 'replay_edge: ALL PASS');
process.exit(fails.length ? 1 : 0);
