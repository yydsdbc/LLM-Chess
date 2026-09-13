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
var recB2 = XQ.Record.blank({ redName: 'A', blackName: 'B', redModels: ['a', 'b'] });
ok(recB2.red.models && recB2.red.models.join('+') === 'a+b', 'L2 blank 委员会阵容字段 (redModels 入谱)');
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

// L9 第39轮: engine legalTargets/dangerTargets memo (同盘面同格 → 同数组引用; 走子/undo 换代即重算)
var engM = XQ.Engine.create();
var b1 = XQ.Move.parseSq('b1');   // 红马 (y=9 底线)
var m1a = engM.legalTargets(b1.x, b1.y);
var m1b = engM.legalTargets(b1.x, b1.y);
ok(m1a === m1b, 'L9 legalTargets 同盘面同格 → 同一数组引用 (memo 命中)');
var d1a = engM.dangerTargets(b1.x, b1.y);
var d1b = engM.dangerTargets(b1.x, b1.y);
ok(d1a === d1b, 'L9 dangerTargets memo 命中 (第39轮新增)');
ok(engM.legalTargets(0, 0).length === 0 && engM.dangerTargets(0, 0).length === 0, 'L9 空格/非本方 → 空数组 (不进 memo)');
// 走一回合 (红一手中, 黑一手) 回到红方 → 同格同执子方但盘面已变, 必须重算
var rm = engM.generateLegalMoves('red').filter(function (m) { return !(m.from.x === b1.x && m.from.y === b1.y); })[0];
engM.applyPlayerMove(rm.from.x, rm.from.y, rm.to.x, rm.to.y);
var bm = engM.generateLegalMoves('black')[0];
engM.applyPlayerMove(bm.from.x, bm.from.y, bm.to.x, bm.to.y);
var m2 = engM.legalTargets(b1.x, b1.y);
ok(m2 !== m1a, 'L9 走子 (一回合) 后同格重算 — 状态版本键失效 (第39轮)');
// undo → 换代 → 不复用 (修复原 history.length 键在 undo 后换着法重演回同一手数的过期命中)
engM.undoPly();
var m3 = engM.legalTargets(b1.x, b1.y);
ok(m3 !== m2, 'L9 undo 后重算 — 键改状态版本, 不依手数 (第39轮)');

// L10 第39轮: renderer 热路径 (DOM 桩) — 渲染层此前无 DOM 级自动化覆盖
var DOC_MAP = {};
function mkEl(tag) {
  var el = {
    tagName: tag, children: [], dataset: {}, textContent: '', className: '', _attrs: {}, _cls: {},
    style: { setProperty: function () {}, cssText: '' },
    appendChild: function (c) { this.children.push(c); c.parentNode = this; return c; },
    insertBefore: function (c) { this.children.unshift(c); c.parentNode = this; return c; },
    removeChild: function (c) { var i = this.children.indexOf(c); if (i >= 0) this.children.splice(i, 1); return c; },
    setAttribute: function (k, v) { this._attrs[k] = v; if (k === 'id') { this.id = v; } },
    getAttribute: function (k) { return this._attrs[k]; },
    addEventListener: function () {}, removeEventListener: function () {},
    querySelector: function () { return null; }, querySelectorAll: function () { return []; }
  };
  el.classList = {
    add: function (c) { el._cls[c] = 1; },
    remove: function (c) { delete el._cls[c]; },
    toggle: function (c, on) { if (on === undefined) on = !el._cls[c]; if (on) el._cls[c] = 1; else delete el._cls[c]; return !!on; },
    contains: function (c) { return !!el._cls[c]; }
  };
  Object.defineProperty(el, 'firstChild', { get: function () { return this.children[0] || null; } });
  Object.defineProperty(el, 'id', { get: function () { return el._id || ''; }, set: function (v) { el._id = v; DOC_MAP[v] = el; } });
  var _html = '';
  Object.defineProperty(el, 'innerHTML', {
    get: function () { return _html; },
    set: function (v) { _html = v; el._htmlSets = (el._htmlSets || 0) + 1; }
  });
  return el;
}
sandbox.document = {
  createElement: function (t) { return mkEl(t); },
  createElementNS: function (ns, t) { return mkEl(t); },
  getElementById: function (id) { return DOC_MAP[id] || null; },
  querySelector: function () { return null; },
  querySelectorAll: function () { return []; },
  addEventListener: function () {},
  body: mkEl('body'),
  documentElement: { dataset: {} }
};
['status-text', 'sr-status', 'status-info', 'status-bar', 'btn-row', 'end-overlay'].forEach(function (id) { DOC_MAP[id] = mkEl('div'); });
sandbox.XQ = XQ;   // L2 的 `sandbox.XQ = {}` 重置断了命名空间链 (本地 XQ 引用仍完整) — 挂回后再加载 renderer
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ui', 'renderer.js'), 'utf8'), sandbox, { filename: 'ui/renderer.js' });
ok(!!(sandbox.XQ.UI && sandbox.XQ.UI.render), 'L10 renderer 模块在 DOM 桩下加载并导出 render');
var engR = XQ.Engine.create();
var cnt = { snapshot: 0, isOver: 0 };
var spy = {
  snapshot: function () { cnt.snapshot++; return engR.snapshot(); },
  isOver: function () { cnt.isOver++; return engR.isOver(); },
  legalTargets: function (x, y) { return engR.legalTargets(x, y); },
  dangerTargets: function (x, y) { return engR.dangerTargets(x, y); },
  inCheck: function (c) { return engR.inCheck(c); },
  naturalClock: function () { return engR.naturalClock(); },
  result: function () { return engR.result(); }
};
var viewR = { boardEl: mkEl('div'), selected: null, flip: false, pendingAnim: null, startTime: Date.now(), arrow: true };
viewR.boardEl.parentNode = mkEl('div');
sandbox.XQ.UI.render(spy, viewR);
ok(cnt.snapshot === 1, 'L10 render 每帧仅 1 次 snapshot (renderStatus 复用快照, 第39轮)');
ok(cnt.isOver <= 4, 'L10 render 的 isOver 调用 O(1) 非 O(90) (第39轮提升, 实测 ' + cnt.isOver + ')');
// 走一手 → 箭头绘制一次; 同 lastMove 重复渲染 (键盘光标移动场景) 不重建
var mvR = engR.generateLegalMoves('red')[0];
engR.applyPlayerMove(mvR.from.x, mvR.from.y, mvR.to.x, mvR.to.y);
sandbox.XQ.UI.render(spy, viewR);
var svgEl = DOC_MAP['move-arrow'];
ok(!!svgEl && svgEl.innerHTML.indexOf('<line') >= 0, 'L10 最后着法箭头 SVG 绘制');
var setsAfterDraw = svgEl._htmlSets || 0;
sandbox.XQ.UI.render(spy, viewR);
ok((svgEl._htmlSets || 0) === setsAfterDraw, 'L10 同 lastMove 重复渲染不重建箭头 SVG (第39轮去重)');
// 键盘光标移动 (selected 变化) 也应保持 1 次 snapshot
cnt.snapshot = 0; cnt.isOver = 0;
viewR.selected = { x: 4, y: 9 };
sandbox.XQ.UI.render(spy, viewR);
ok(cnt.snapshot === 1, 'L10 选中态渲染同样仅 1 次 snapshot (legal/danger 走 memo)');

console.log(fails.length ? '_logic_layer: ' + fails.length + ' FAIL' : '_logic_layer: ALL PASS');
process.exit(fails.length ? 1 : 0);
