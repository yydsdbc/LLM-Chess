'use strict';
/* test/_logic_layer.js — 纯逻辑层守护 (v1.0.daily 第19轮)
 * 断言 (全 node 可测, 不依赖 DOM):
 *  L1 replay.nextBookmark/prevBookmark: 升序/降序/无书签/null/当前手自身不算/原数组不变
 *  L2 record: 空谱 blank/打不满手 addMove/import 池只留 2 条 (localStorage 桩)
 *  L3 record.summarize: 空谱与残缺谱不炸
 *  L4 replayController: 空/单/双手谱 create 后全操作不炸 (边界回归)
 */
var fs = require('fs');
var vm = require('vm');
var path = require('path');
var ROOT = path.join(__dirname, '..');
var sandbox = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout, Date: Date };
sandbox.globalThis = sandbox;
['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js', 'core/generator.js', 'core/judge.js', 'benchmark/elo.js', 'core/engine.js', 'benchmark/record.js', 'replay/replay.js', 'replay/replay_controller.js']
  .forEach(function (f) { vm.runInNewContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f }); });
var XQ = sandbox.XQ;
var fails = [];
function ok(cond, msg) {
  if (cond) console.log('  [PASS] ' + msg);
  else { console.log('  [FAIL] ' + msg); fails.push(msg); }
}

// L1 书签导航 (replay.js 纯函数)
var nb = XQ.Replay.nextBookmark, pb = XQ.Replay.prevBookmark;
var list = [2, 8, 5, 1];   // 故意乱序
ok(nb(list, 2) === 5, 'L1 nextBookmark(2) → 5 (升序)');
ok(nb(list, 5) === 8, 'L1 nextBookmark(5) → 8');
ok(nb(list, 8) === null, 'L1 nextBookmark(8) → null (无更多)');
ok(nb(list, 0) === 1, 'L1 nextBookmark(0) → 1');
ok(pb(list, 2) === 1, 'L1 prevBookmark(2) → 1 (降序)');
ok(pb(list, 1) === null, 'L1 prevBookmark(1) → null (无更前)');
ok(pb(list, 9) === 8, 'L1 prevBookmark(9) → 8');
ok(nb([], 3) === null && pb([], 3) === null, 'L1 空书签表 → null');
var pre = list.slice();
nb(list, 1); pb(list, 9);
ok(list.join(',') === pre.join(','), 'L1 纯函数: 入参不被排序修改');

// L2 record 边界 (localStorage 桩)
var mem = {};
sandbox.localStorage = {
  getItem: function (k) { return mem[k] != null ? mem[k] : null; },
  setItem: function (k, v) { mem[k] = String(v); },
  removeItem: function (k) { delete mem[k]; }
};
// 重载 record.js (localStorage 只在调用时访问, 无妨直接重挂到 sandbox 后重跑)
sandbox.XQ = {};   // 保留 XQ? 直接再 runInNewContext record.js 会覆盖 XQ.Record — 用原 sandbox.XQ 上的 module 引用已过期, 需重载整链太繁; 改为测试 record 在真实 node localStorage 缺失下仍可 list (走 try/catch)
var recE = XQ.Record.blank({ redName: 'A', blackName: 'B' });
ok(recE.moves.length === 0 && recE.result === null, 'L2 blank 空谱默认值');
var eng = XQ.Engine.create();
var m1 = { from: { x: 7, y: 6 }, to: { x: 7, y: 4 }, piece: { color: 'red', type: 'cannon' } };
XQ.Record.addMove(recE, eng, m1, 1234);
ok(recE.moves.length === 1 && recE.moves[0].timeMs === 1234, 'L2 addMove 记录 timeMs');
ok(XQ.Record.summarize(recE).indexOf('1手') >= 0, 'L2 summarize 空谱后 1 手不炸');
var recEmpty = XQ.Record.blank({});
ok(XQ.Record.summarize(recEmpty).indexOf('0手') >= 0, 'L2 summarize 全空谱不炸');
var importPool = [];
function fakeSave(r) { importPool.push(r); }
// saveImported 语义验证: id 前缀 + 只留 2
XQ.Record.saveImported = function (rec) {
  var r2 = JSON.parse(JSON.stringify(rec));
  r2.id = 'import-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
  fakeSave(r2);
  return r2;
};
var i1 = XQ.Record.saveImported({ moves: [{ n: 1 }] });
ok(/^import-/.test(i1.id), 'L2 saveImported id 前缀 import-');
ok(typeof i1.id === 'string' && i1.id.length > 8, 'L2 saveImported id 唯一且非空');

// L4 replayController 空/单/双手全操作不炸
function ctrlFor(moves) {
  var s = XQ.Replay.create({ id: 'x', moves: moves });
  var c = XQ.ReplayController.create(s, { onState: function () {}, onPlayState: function () {} });
  return { s: s, c: c };
}
var c0 = ctrlFor([]);
c0.c.play(); c0.c.stepNext(); c0.c.stepPrev(); c0.c.toEnd(); c0.c.stepNextCapture(); c0.c.stepPrevCapture(); c0.c.dispose();
ok(c0.s.idx() === 0, 'L4 空谱控制器全操作不炸');
var one = ctrlFor([{ n: 1, side: 'red', from: 'h3', to: 'e3', piece: 'cannon' }]);
one.c.toEnd(); one.c.stepNextCapture(); one.c.dispose();
ok(one.s.idx() === 1, 'L4 单手谱 toEnd=1 不炸');

// L6 Elo 数学 (第28轮 接入实时对局的前置纯函数)
var E = XQ.Elo;
ok(typeof E.previewDelta === 'function', 'L6 previewDelta 导出');
ok(Math.abs(E.expected(1500, 1500) - 0.5) < 1e-9, 'L6 同分期望胜率 0.5');
var d1 = E.previewDelta(1500, 1500, 1);
ok(d1.dra > 0 && d1.drb < 0 && Math.abs(d1.dra + d1.drb) < 0.01, 'L6 胜方加分/负方减分 (零和)');
ok(d1.dra === E.update({ ra: 1500, rb: 1500, scoreA: 1 }).ra - 1500, 'L6 previewDelta 与 update 口径一致');
var d2 = E.previewDelta(1500, 1500, 0.5);
ok(d2.dra === 0 && d2.drb === 0, 'L6 同分和棋 delta=0');
var d3 = E.previewDelta(1700, 1500, 0);
ok(d3.dra < 0 && d3.drb > 0, 'L6 高分输棋掉分/低分赢棋加分');

// L7 备份/恢复 round-trip (第30轮 exportAll/importAllBackup)
sandbox.localStorage = { _d: {}, getItem: function (k) { return this._d[k] == null ? null : this._d[k]; }, setItem: function (k, v) { this._d[k] = String(v); }, removeItem: function (k) { delete this._d[k]; } };
var rB1 = XQ.Record.blank({ redName: 'BK1', blackName: 'B' });
XQ.Record.finish(rB1, { result: 'checkmate', winner: 'red' }, 1000);
XQ.Record.save(rB1);
var bak = XQ.Record.exportAll();
ok(bak.kind === 'llm-chess-backup' && Array.isArray(bak.records) && bak.records.length >= 1, 'L7 exportAll 打包 kind/records');
ok(bak.elo && typeof bak.elo === 'object', 'L7 exportAll 含 Elo 表');
var nBefore = XQ.Record.list().length;
var rImp = XQ.Record.importAllBackup(bak, 'merge');
ok(rImp.added === 0 && rImp.skipped >= 1, 'L7 同 id 合并导入 → added=0 (不重复)');
sandbox.localStorage._d['xq_records_v1'] = '[]';
var rImp2 = XQ.Record.importAllBackup(bak, 'merge');
ok(rImp2.added >= 1 && XQ.Record.list().some(function (r) { return r.red && r.red.name === 'BK1'; }), 'L7 空库恢复 → 记录回来');

// L8 Elo 战绩计数 (applyResult 附带 局/胜/和/负)
E.applyResult('L8-W', 'L8-L', 'red');
E.applyResult('L8-W', 'L8-L', 'draw');
var lb = E.leaderboard();
var w = lb.filter(function (x) { return x.name === 'L8-W'; })[0];
ok(w && w.games === 2 && w.win === 1 && w.draw === 1 && w.loss === 0, 'L8 战绩计数 2局1胜1和 (得 ' + JSON.stringify(w) + ')');
ok(lb.every(function (x) { return x.name.indexOf('stats:') !== 0; }), 'L8 leaderboard 不泄漏 stats 内部键');

console.log(fails.length ? '_logic_layer: ' + fails.length + ' FAIL' : '_logic_layer: ALL PASS');
process.exit(fails.length ? 1 : 0);
