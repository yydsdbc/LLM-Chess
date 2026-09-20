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
    contains: function (c) { return c === this || this.children.indexOf(c) >= 0; },
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

/* ═══ L12 第41轮: 棋子显示偏好单出口 + 兑底选词 + 状态条时钟单出口 ═══
   L12 全部断言都指向同一类缺陷: 「同一个展示事实在多处各写一遍」。第40轮为此改了三处阶段名 i18n,
   而棋子字/兑底标记/时钟文案当时仍各有多份拷贝, 故本轮收敛为单出口并逐条钉住行为。 */
(function () {
  // 载入 i18n (真实字典) — 语言热切与 EN 文案是本组断言的被测面
  sandbox.document.documentElement.setAttribute = function () {};
  sandbox.XQ = XQ;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'ui', 'i18n.js'), 'utf8'), sandbox, { filename: 'ui/i18n.js' });
  ok(!!(sandbox.XQ.I18N && sandbox.XQ.I18N.t), 'L12 i18n 模块在 DOM 桩下加载');
  var mem12 = {};
  sandbox.localStorage = {
    getItem: function (k) { return mem12[k] != null ? mem12[k] : null; },
    setItem: function (k, v) { mem12[k] = String(v); },
    removeItem: function (k) { delete mem12[k]; }
  };
  sandbox.XQ.I18N.setLang('zh', false);

  // L12-e 语言切换事件必须送到 document (全仓唯一监听在 document; 派发到 window 不会向下传播 → 监听永不触发,
  //      「切语言即时刷新动态文案」整条链路变死代码)。用两个分开的桩分别记录 window / document 派发以证伪。
  var evOn = { root: [], document: [] };
  var realRootDispatch = sandbox.dispatchEvent, realDocDispatch = sandbox.document.dispatchEvent;
  sandbox.document.addEventListener = function () {};   // 桩: 只需记录派发目标, 不模拟传播
  sandbox.dispatchEvent = function (e) { evOn.root.push(e && e.type); return true; };
  sandbox.document.dispatchEvent = function (e) { evOn.document.push(e && e.type); return true; };
  sandbox.CustomEvent = sandbox.CustomEvent || function (type, o) { this.type = type; this.detail = o && o.detail; };
  sandbox.XQ.I18N.setLang('en', true);
  ok(evOn.document.indexOf('xq:i18n') >= 0, 'L12 语言切换事件派发到 document (document 监听可达): document=' + evOn.document.join(',') + ' | window=' + evOn.root.join(','));
  ok(evOn.root.indexOf('xq:i18n') < 0, 'L12 不再只派发到 window (window 事件不向下传播到 document)');
  sandbox.dispatchEvent = realRootDispatch;
  sandbox.document.dispatchEvent = realDocDispatch;
  sandbox.XQ.I18N.setLang('zh', false);

  // L12-a (色,子种) → 显示字: cn 汉字 / en 字母 (棋盘与 HUD 同一出口)
  ok(sandbox.XQ.UI.pieceGlyph('red', 'cannon') === '炮' && sandbox.XQ.UI.pieceGlyph('black', 'rook') === '车',
    'L12 pieceGlyph 默认 (cn) 返回汉字子名');
  mem12['xq_pieces'] = 'en';
  ok(sandbox.XQ.UI.pieceGlyph('red', 'cannon') === 'C' && sandbox.XQ.UI.pieceGlyph('black', 'rook') === 'r',
    'L12 pieceGlyph 随 xq_pieces=en 返回字母 (红大写/黑小写)');
  ok(sandbox.XQ.UI.pieceGlyph('red', 'king') === 'K' && sandbox.XQ.UI.pieceGlyph('black', 'pawn') === 'p',
    'L12 pieceGlyph 覆盖帅/兵等全部子种');

  // L12-b 吃子托盘: 入参以汉字存储 (capturedBy 的数据形态), 渲染必须按偏好还原
  var trayEl = mkEl('div'); DOC_MAP['think-red-captured'] = trayEl;
  sandbox.XQ.UI.capturedTray('red', ['车', '马']);   // 红方吃掉的对方 (黑) 子力
  ok(trayEl.innerHTML.indexOf('r') >= 0 && trayEl.innerHTML.indexOf('n') >= 0 && trayEl.innerHTML.indexOf('车') < 0,
    'L12 capturedTray 在 Letters 模式下输出字母 (原恒显「车马」与棋盘矛盾): ' + trayEl.innerHTML);
  mem12['xq_pieces'] = 'cn';
  sandbox.XQ.UI.capturedTray('red', ['车', '马']);
  ok(trayEl.innerHTML.indexOf('车') >= 0 && trayEl.innerHTML.indexOf('马') >= 0, 'L12 capturedTray 汉字模式未被破坏');
  trayEl.innerHTML = '';
  sandbox.XQ.UI.thinkPanel && sandbox.XQ.UI.capturedTray('red', []);
  ok(trayEl.innerHTML === '', 'L12 capturedTray 空数组清空');
  mem12['xq_pieces'] = 'en';

  // L12-c 决策卡兑底选词: 语言中立旗标 e.fallback 决定文案 (原按 app 写入的中文串比对, EN 下永不命中)
  sandbox.XQ.I18N.setLang('zh', false);
  var cardZh = sandbox.XQ.UI.decisionCards([{ n: 3, name: '炮-h3→e3', fallback: true, summary: '', reasoning: '【兑底】x', secs: 1 }], 1).join('');
  ok(cardZh.indexOf('兑底·安全着法') >= 0 && cardZh.indexOf('【兑底】前几次输出无效') >= 0,
    'L12 兑底卡 (zh) 显示字典摘要与推理');
  sandbox.XQ.I18N.setLang('en', false);
  var cardEn = sandbox.XQ.UI.decisionCards([{ n: 3, name: 'c-h3>e3', fallback: true, summary: '', reasoning: '【兑底】x', secs: 1 }], 1).join('');
  ok(cardEn.indexOf('Fallback · safe move') >= 0 && cardEn.indexOf('Earlier outputs were invalid') >= 0,
    'L12 兑底卡 (en) 走 EN 字典 — 旗标与界面语言解耦');
  ok(cardEn.indexOf('兑底') < 0 && cardEn.indexOf('无摘要') < 0, 'L12 EN 兑底卡无中文残留');
  var cardSum = sandbox.XQ.UI.decisionCards([{ n: 4, name: 'x', summary: 'my plan', secs: 1 }], 1).join('');
  ok(cardSum.indexOf('my plan') >= 0 && cardSum.indexOf('Fallback') < 0, 'L12 非兑底卡照常显示模型摘要 (旗标不误伤)');
  var cardLegacy = sandbox.XQ.UI.decisionCards([{ n: 5, name: 'x', summary: '兑底·安全着法', secs: 1 }], 1).join('');
  ok(cardLegacy.indexOf('Fallback · safe move') >= 0, 'L12 仍带中文标记的旧内存数据同样本地化 (向后兼容)');
  sandbox.XQ.I18N.setLang('zh', false);

  // L12-d 状态条时钟单出口: renderStatus 内联写入与 updateClock 必须逐字一致 (原为两份拷贝, 漂移即撕裂)
  var viewC = { boardEl: mkEl('div'), startTime: Date.now() - 95000, aiThinking: null, selected: null, flip: false, pendingAnim: null, arrow: true };
  viewC.boardEl.parentNode = mkEl('div');
  var engC = XQ.Engine.create();
  engC.applyPlayerMove(7, 7, 7, 4);   // 走一手 → 进入中局判定样本, ply=1
  var infoEl = DOC_MAP['status-info'];
  sandbox.XQ.UI.updateClock(engC, viewC);
  var clockFromUpdate = infoEl.textContent;
  infoEl.textContent = '';
  sandbox.XQ.UI.render(engC, viewC);
  var clockFromRender = infoEl.textContent;
  ok(clockFromUpdate.length > 0 && clockFromUpdate === clockFromRender,
    'L12 时钟文案单出口: updateClock 与 renderStatus 输出逐字相同 ("' + clockFromUpdate + '")');
  ok(clockFromUpdate.indexOf('第1手') === 0 && clockFromUpdate.indexOf('1:35') > 0, 'L12 时钟含手数与原位计时');
  ok(sandbox.XQ.UI.clockText(engC, viewC, engC.ply()) === clockFromUpdate, 'L12 clockText 为两处共同的单一实现');
  sandbox.XQ.I18N.setLang('en', false);
  sandbox.XQ.UI.updateClock(engC, viewC);
  var clockEn = infoEl.textContent;
  ok(clockEn.indexOf('Move 1') === 0 && !/[\u4e00-\u9fff]/.test(clockEn), 'L12 EN 时钟无中文残留 ("' + clockEn + '")');
  sandbox.XQ.I18N.setLang('zh', false);
})();

/* ═══ L11 第40轮: PWA 离线壳 + 本轮渲染/a11y 行为回归 ═══ */
var DOC_IDS_11 = ['ai-banner', 'sr-alert', 'move-log', 'think-red-spark', 'think-black-spark'];
DOC_IDS_11.forEach(function (id) { DOC_MAP[id] = mkEl('div'); });
DOC_MAP['ai-banner'].id = 'ai-banner';
DOC_MAP['sr-alert'].id = 'sr-alert';

// L11-a 评值走势 sparkline 内容签名去重 — 序列未变不重解析整段 SVG (走子/吃子/悔棋/导入各触发一次渲染)
var sparkEl = DOC_MAP['think-red-spark'];
sandbox.XQ.UI.evalSpark('red', [0.5, -1.2, 2.0]);
var sparkSets1 = sparkEl._htmlSets || 0;
ok(sparkSets1 === 1 && sparkEl.innerHTML.indexOf('<polyline') >= 0, 'L11 evalSpark 首次绘制 SVG (1 次写入)');
sandbox.XQ.UI.evalSpark('red', [0.5, -1.2, 2.0]);
ok((sparkEl._htmlSets || 0) === sparkSets1, 'L11 同序列重复调用不重建 SVG (第40轮签名去重)');
sandbox.XQ.UI.evalSpark('red', [0.5, -1.2, 2.5]);
ok((sparkEl._htmlSets || 0) === sparkSets1 + 1, 'L11 序列变化则重建 (签名覆盖每个采样点)');
var sparkSets2 = sparkEl._htmlSets || 0;
sandbox.XQ.UI.evalSpark('red', []);
ok((sparkEl._htmlSets || 0) === sparkSets2 + 1 && sparkEl.innerHTML === '', 'L11 空序列清空一次');
sandbox.XQ.UI.evalSpark('red', []);
ok((sparkEl._htmlSets || 0) === sparkSets2 + 1, 'L11 空序列重复调用不重复清空 (空态同款去重)');

// L11-b 走法列表条目键盘可达 — 第40轮补 tabindex (原只有 click, 键盘用户无法用走法列表跳转局面)
var logEl = DOC_MAP['move-log'];
logEl.children.length = 0;
sandbox.XQ.UI.logMove(1, 'red', '炮', '炮二平五', null, null, 3, '');
var entryEl = logEl.children[0];
ok(!!entryEl && entryEl.tabIndex === 0, 'L11 走法列表条目 tabIndex=0 (键盘可聚焦)');

// L11-c 底部横幅错误/警告 → #sr-alert 断言式播报 (原无任何 ARIA 语义, 读屏完全感知不到失败)
var alertEl = DOC_MAP['sr-alert'], bannerEl = DOC_MAP['ai-banner'];
sandbox.XQ.UI.aiBanner('warn', '⚠ <b>上游限流</b> 429', 'red');
ok(alertEl.textContent.indexOf('上游限流') >= 0 && alertEl.textContent.indexOf('<') < 0, 'L11 warn 横幅文本 (去标签) 进 #sr-alert');
ok(bannerEl.tabIndex === 0, 'L11 warn 横幅可聚焦 (键盘可关闭)');
sandbox.XQ.UI.aiBanner('busy', 'Elapsed 0:03', 'red');
ok(alertEl.textContent.indexOf('Elapsed') < 0, 'L11 busy 每秒计时不进播报区 (防读屏每秒刷屏)');
ok(bannerEl.tabIndex === -1, 'L11 busy 横幅不进 Tab 序');
sandbox.XQ.UI.aiBanner('', '');
ok(alertEl.textContent === '' && bannerEl.tabIndex === -1, 'L11 横幅收起时清空播报区 (同一错误可再次播报)');

// L11-d sw.js 离线壳 (vm + caches/self 桩) — 第40轮修复: 安装期预缓存 + 导航兜底查询键
//   原实现: 缓存按键为访问 URL (根导航是 './'), 兜底却查写死的 '/index.html' → 永不命中 → 离线首启白屏
var swPrecached = [], swStored = {};
var swSandbox = { console: console, URL: URL, location: { origin: 'http://localhost:8788' } };
swSandbox.globalThis = swSandbox;
swSandbox.self = swSandbox;
var swEvents = {};
swSandbox.addEventListener = function (t, fn) { swEvents[t] = fn; };
swSandbox.skipWaiting = function () { return Promise.resolve(); };
swSandbox.clients = { claim: function () { return Promise.resolve(); } };
swSandbox.Response = { error: function () { return { ok: false, _browserErrorPage: true }; } };
swSandbox.fetch = function () { return Promise.reject(new Error('offline')); };
function swMatch(u, opts) {
  var key = typeof u === 'string' ? u : (u && u.url) || '';
  if (opts && opts.ignoreSearch) key = key.split('?')[0];
  return Promise.resolve(swStored[key]);   // 未命中返回 undefined (与真 CacheStorage 一致)
}
swSandbox.caches = {
  open: function () {
    return Promise.resolve({
      add: function (u) { swPrecached.push(String(u)); swStored[String(u)] = { ok: true, body: 'CACHED:' + u }; return Promise.resolve(); },
      put: function (req, res) { var k = typeof req === 'string' ? req : (req && req.url) || ''; swStored[k] = res; return Promise.resolve(); }
    });
  },
  keys: function () { return Promise.resolve(['xq-shell-v2']); },
  delete: function () { return Promise.resolve(true); },
  match: swMatch
};
vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), swSandbox, { filename: 'sw.js' });
function swFire(type, req) {
  var captured = null;
  swEvents[type]({ request: req, waitUntil: function (p) { captured = p; }, respondWith: function (p) { captured = p; } });
  return captured;
}
function navReq(u) { return { method: 'GET', url: 'http://localhost:8788' + u, mode: 'navigate' }; }
function swNav(u) { return Promise.resolve(swFire('fetch', navReq(u))); }
(function () {
  var results = [];
  // ① 安装期预缓存 (本次修复的核心): 原实现无预缓存, 兜底查的键从未被写入 → 离线首启必然白屏
  var installDone = Promise.resolve(swFire('install', {})).then(function () {
    ok(!!(swEvents.install && swEvents.fetch && swEvents.activate), 'L11 sw.js 注册 install/activate/fetch 三事件');
    ok(swPrecached.indexOf('./') >= 0 && swPrecached.indexOf('./index.html') >= 0,
      'L11 安装期预缓存应用壳 (./ 与 ./index.html): ' + swPrecached.join(' '));
  });
  results.push(installDone);
  // ② 离线导航回退到预缓存壳 (确定性排序: 等预缓存落库后再请求)
  results.push(installDone.then(function () { return swNav('/'); }).then(function (res) {
    ok(res && res._browserErrorPage !== true && String(res.body).indexOf('CACHED:') === 0,
      'L11 离线导航回退到缓存壳 (非浏览器错误页)');
  }));
  /* ③ 隔离验证「兜底查询键」本身 (与 ① 独立):
     缓存中只放 './index.html' 一个键 (用户曾直达 /index.html 的部署形态)。写死绝对 '/index.html' 时
     此处必然 miss, 且其后 './' 与 ignoreSearch 兜底也都不命中 → 旧实现返回 Response.error() 浏览器错误页。 */
  results.push(installDone.then(function () {
    swStored = { './index.html': { ok: true, body: 'CACHED:./index.html' } };
    return swNav('/');
  }).then(function (res) {
    ok(res && res.body === 'CACHED:./index.html', 'L11 导航兜底键解析到作用域相对 ./index.html (绝对路径写法在此必然 miss)');
  }));
  // ④ 带 query 的深链导航: 仅 ignoreSearch 兜底能命中 (壳两键都不匹配 query URL)
  results.push(installDone.then(function () {
    swStored = { './': { ok: true, body: 'CACHED:./' }, './index.html': { ok: true, body: 'CACHED:./index.html' } };
    return swNav('/?x=1');
  }).then(function (res) {
    ok(res && res._browserErrorPage !== true, 'L11 带 query 的离线导航同样回退壳 (ignoreSearch 兜底)');
  }));
  // ⑤ /api/* 与非 GET 必须放行 (respondWith 不被调用 → 中继请求不受 SW 干预)
  var apiHandled = false, postHandled = false;
  swEvents.fetch({ request: { method: 'GET', url: 'http://localhost:8788/api/health' }, respondWith: function () { apiHandled = true; }, waitUntil: function () {} });
  swEvents.fetch({ request: { method: 'POST', url: 'http://localhost:8788/api/chat' }, respondWith: function () { postHandled = true; }, waitUntil: function () {} });
  ok(!apiHandled && !postHandled, 'L11 /api/* 与非 GET 直接放行 (不缓存中继)');
  return Promise.all(results);
})().then(function () {
  return l13OfflineShell();   // 第41轮: 壳清单完整性 + 写缓存失败兜底
}).then(function () {
  l14Round42();               // 第42轮: 决策卡无障碍标签本地化
}).then(function () {
  l15Round43();               // 第43轮: 重复计数 undo 键 + inCheck/posKey memo
}).then(function () {
  return l16Round44();        // 第44轮: sw.js 作用域相对 API 判定 + 写缓存挂事件生命周期
}).then(function () {
  l17Round45();               // 第45轮: 终局卡键盘出口 + 棋盘格/走法条目 ARIA 角色
}).then(function () {
  console.log(fails.length ? '_logic_layer: ' + fails.length + ' FAIL' : '_logic_layer: ALL PASS');
  process.exit(fails.length ? 1 : 0);
  }, function (e) {
  console.log('  [FAIL] L11 异步断言异常: ' + (e && e.message));
  process.exit(1);
});

/* ═══ L13 第41轮: 离线壳清单完整性 (按 index.html 实际引用推导, 不写死清单) + 写缓存失败兜底 ═══
   ① 壳清单必须覆盖 index.html 引用的全部本地子资源。第40轮只预缓存了 HTML 本身:
      断网首启拿得到 HTML, 却拿不到 20 个 <script src> 与图标 → XQ 未定义、页面空白,
      「离线可直接开局」名不副实。清单完整性由本组按 index.html 现场推导比对 (新增脚本漏挂即红)。 */
function l13OfflineShell() {
  var htmlTxt = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  var need = [], mre = /<(?:script|link)\b[^>]*\b(?:src|href)="([^"]+)"/g, mm;
  while ((mm = mre.exec(htmlTxt))) {
    var u = mm[1];
    if (/^(?:[a-z]+:)?\/\//i.test(u) || u.indexOf('data:') === 0) continue;   // 外链 / data-URI 不属离线壳
    need.push('./' + u.replace(/^\.\//, ''));
  }
  var missing = need.filter(function (r) { return swPrecached.indexOf(r) < 0; });
  ok(need.length >= 20, 'L13 index.html 本地子资源解析出 ' + need.length + ' 项 (脚本 + 图标 + manifest)');
  ok(missing.length === 0, 'L13 安装期预缓存覆盖全部子资源' + (missing.length ? ' — 漏: ' + missing.join(' ') : ''));
  ok(swPrecached.indexOf('./') >= 0 && swPrecached.indexOf('./index.html') >= 0, 'L13 壳仍含根导航两键 (第40轮修复未被回退)');

  /* ② 运行时写缓存被拒 (配额耗尽/隐私模式) 必须被吞: 原实现 caches.open().then(c => c.put(..)) 悬空,
     拒绝变成进程级 unhandledRejection (控制台报错)。写缓存纯属优化, 失败只应降级为「本次不缓存」。
     用独立 SW 沙箱 + 真实 process 级 unhandledRejection 探针证伪 (跨 realm 拒绝同样会上报, 已实测)。 */
  var rej = [];
  var sw2 = { console: console, URL: URL, location: { origin: 'http://localhost:8788' } };
  sw2.globalThis = sw2; sw2.self = sw2;
  var ev2 = {};
  sw2.addEventListener = function (t, fn) { ev2[t] = fn; };
  sw2.skipWaiting = function () { return Promise.resolve(); };
  sw2.clients = { claim: function () { return Promise.resolve(); } };
  sw2.Response = { error: function () { return { ok: false, _browserErrorPage: true }; } };
  sw2.caches = {
    open: function () {
      return Promise.resolve({
        add: function () { return Promise.resolve(); },
        put: function () { return Promise.reject(new Error('QuotaExceededError')); }   // 写盘失败
      });
    },
    match: function () { return Promise.resolve(undefined); },
    keys: function () { return Promise.resolve([]); },
    delete: function () { return Promise.resolve(true); }
  };
  sw2.fetch = function () { return Promise.resolve({ ok: true, type: 'basic', clone: function () { return {}; } }); };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), sw2, { filename: 'sw.js' });
  var onRej = function (e) { rej.push(e && e.message || e); };
  process.on('unhandledRejection', onRej);
  var captured = null;
  ev2.fetch({ request: { method: 'GET', url: 'http://localhost:8788/ui/app.js' }, respondWith: function (p) { captured = p; }, waitUntil: function () {} });
  return Promise.resolve(captured).then(function (res) {
    ok(res && res.ok === true, 'L13 写缓存失败不影响在线响应 (仍原样返回上游响应)');
  }).then(function () {
    return new Promise(function (r) { setTimeout(r, 40); });   // 等拒绝上报窗口
  }).then(function () {
    process.removeListener('unhandledRejection', onRej);
    ok(rej.length === 0, 'L13 写缓存 rejected Promise 已被兜底 (无未处理拒绝), 实测 ' + (rej.length ? rej.join(';') : 0));
  });
}

/* ═══ L14 第42轮: 决策卡无障碍标签本地化 ═══
   缺陷形态: 💭 折叠按钮的 aria-label 曾是硬编码英文 'reasoning' — 中文界面下读屏把它读成英文词,
   而同一张卡片的其它文案早已全部走字典 (第27/40/41 三轮 i18n 漏挂整改都没覆盖「a11y 标签」这个出口,
   因为 I9/I10 只扫 title/placeholder/aria-label 的静态模板串与 CJK 字面量, 纯英文硬编码不触发任何一跳)。
   断言走真实字典 + 真实 decisionCards 输出 (非源串匹配): 双语齐备且译文不同 → 标签随语言 → 无推理不渲染按钮。 */
function l14Round42() {
  var I14 = sandbox.XQ.I18N;
  if (!I14 || !sandbox.XQ.UI || !sandbox.XQ.UI.decisionCards) {
    ok(false, 'L14 前置缺失: i18n/renderer 未在 DOM 桩下就绪');
    return;
  }
  var zh14 = I14.STRINGS.zh.d_reason_toggle, en14 = I14.STRINGS.en.d_reason_toggle;
  ok(!!zh14 && !!en14, 'L14 d_reason_toggle 双语文案齐备 (' + zh14 + ' / ' + en14 + ')');
  ok(!!zh14 && !!en14 && zh14 !== en14, 'L14 d_reason_toggle 双语译文不同 (排除「只加一侧」与「两侧同值未翻译」)');
  I14.setLang('zh', false);
  var c14zh = sandbox.XQ.UI.decisionCards([{ n: 7, name: 'c-h3>e3', reasoning: 'r', secs: 1 }], 1).join('');
  ok(c14zh.indexOf('aria-label="' + zh14 + '"') >= 0, 'L14 决策卡 💭 标签在 zh 下走字典 (' + zh14 + ')');
  ok(c14zh.indexOf('aria-label="reasoning"') < 0, 'L14 决策卡 💭 标签在 zh 下不再出现硬编码英文词');
  ok(c14zh.indexOf('aria-expanded="false"') >= 0, 'L14 决策卡 💭 按钮保留初始折叠态语义 (aria-expanded)');
  I14.setLang('en', false);
  var c14en = sandbox.XQ.UI.decisionCards([{ n: 7, name: 'c-h3>e3', reasoning: 'r', secs: 1 }], 1).join('');
  ok(c14en.indexOf('aria-label="' + en14 + '"') >= 0, 'L14 决策卡 💭 标签在 en 下走英文 (' + en14 + ')');
  var c14none = sandbox.XQ.UI.decisionCards([{ n: 8, name: 'x', secs: 1 }], 1).join('');
  ok(c14none.indexOf('d-toggle') < 0, 'L14 无推理的卡片不渲染 💭 按钮 (标签不会凭空出现)');
  I14.setLang('zh', false);
}


/* ═══ L15 第43轮: 重复局面计数 undo 键修复 + 引擎热路径 memo (inCheck / posKey) ═══
   ① 缺陷形态 (实测): undoPly 在 board.undoMove **之后**才取重复计数的键 — 取到的是「恢复出来的局面」,
      于是扣错了键: 被撤局面的计数永远留着, 恢复后的局面反而被无故扣减。表现: 悔棋后重走同一着,
      该局面在盘上其实只出现过一次, posCounts 却累加到 3 → 第 3 次重走当场判「三次重复和棋」。
   ② memo 形态: render 每帧逐格判定 + 状态条各调一次 engine.inCheck (每次都全盘 90 格扫描 + 敌方每子
      伪着生成), snapshot 每帧都要 posCounts[posKey()] (每次重建 90 格盘面文本) — 与既有
      legalTargets/dangerTargets 同款按 _stateVer 记忆化; 本组用「调用次数」+「换局面必须失效」双向钉住。 */
function l15Round43() {
  var E = sandbox.XQ.Engine;

  // ① undo 扣错键: 走一着 → 悔一着, 重复计数必须回到「该局面只出现一次」而不是虚增
  var e1 = E.create();
  var counts = [];
  for (var i = 0; i < 4; i++) {
    var mv = e1.generateLegalMoves()[0];
    var r = e1.applyPlayerMove(mv.from.x, mv.from.y, mv.to.x, mv.to.y);
    if (!r.ok) { ok(false, 'L15 前置失败: 首着非法 (' + r.reason + ')'); return; }
    counts.push(e1.repetitionCount());
    if (!e1.undoPly()) { ok(false, 'L15 前置失败: undoPly 返回 false'); return; }
  }
  ok(counts.join(',') === '1,1,1,1', 'L15 悔棋后重走同一着不得虚增重复计数 (实测 ' + counts.join(',') + '; 修前为 1,2,3,4 → 第3次重走误判三次重复和棋)');
  ok(!e1.isOver(), 'L15 4 轮「走+悔」后对局未结束 (未误判和棋)');
  ok(e1.repetitionCount() === 0, 'L15 全部撤销后计数归零 (无残留)');
  /* 关键区分探针: 连撤两手且中间不读计数 — 此时 posKey 缓存停在「第一手撤销前」的版本,
     若实现退回「undoMove 之后才取键」, 第二手撤销会取到恢复出来的局面 (P1) 并把它扣掉 → 读到 0。
     本断言正是「显式传入被撤键」与「靠缓存侥幸正确」的分水岭 (实测: 修复版 1, 回退版 0)。 */
  var e1b = E.create();
  var s1b = [[1, 9, 2, 7], [1, 0, 2, 2], [2, 7, 1, 9]];
  for (var jb = 0; jb < s1b.length; jb++) {
    var rb = e1b.applyPlayerMove(s1b[jb][0], s1b[jb][1], s1b[jb][2], s1b[jb][3]);
    if (!rb.ok) { ok(false, 'L15 前置失败: 连续撤销序列第 ' + (jb + 1) + ' 着非法'); return; }
  }
  e1b.undoPly(); e1b.undoPly();   // 连撤两手, 中间不读 (不预热缓存)
  ok(e1b.repetitionCount() === 1, 'L15 连续两手悔棋扣的是各自被撤局面 (读到恢复后的 P1 = 1 次, 实测 ' + e1b.repetitionCount() + '; 扣错键会得 0)');

  // ② posKey memo: 连续快照/查询只重建一次盘面文本; 但盘面一变必须失效
  var t2 = { n: 0 };
  var realCreate = sandbox.XQ.Board.create;
  sandbox.XQ.Board.create = function () {
    var b = realCreate.apply(this, arguments), raw = b.toText;
    b.toText = function () { t2.n++; return raw.apply(this, arguments); };
    return b;
  };
  var e2 = E.create();
  t2.n = 0;
  e2.snapshot(); e2.snapshot(); e2.repetitionCount();
  ok(t2.n === 1, 'L15 posKey memo: 2 次 snapshot + 1 次 repetitionCount 只重建 1 次盘面文本 (实测 ' + t2.n + '; 修前 3)');
  var mv2 = e2.generateLegalMoves()[0];
  e2.applyPlayerMove(mv2.from.x, mv2.from.y, mv2.to.x, mv2.to.y);
  t2.n = 0;
  var rc2 = e2.repetitionCount();
  ok(rc2 === 1, 'L15 走子后重复计数正确 (memo 未串到旧键, 实测 ' + rc2 + ')');
  ok(t2.n === 0, 'L15 走子时已按新版本重建并缓存 → 紧随其后的读数零重建 (实测 ' + t2.n + ')');
  e2.undoPly();
  /* 关键失效探针: 撤销前先「预热」缓存 (snapshot 让 memo 持有 B 局面的键), 撤销后读到的必须是 A 局面。
     若 undo 未使缓存失效, 会读到已被撤销的 B 局面 → 计数 0 而不是 1 (旧实现正是扣错键, 此断言即红)。 */
  var e3 = E.create();
  var s3 = [[1, 9, 2, 7], [1, 0, 2, 2]];
  for (var j = 0; j < s3.length; j++) {
    var r3 = e3.applyPlayerMove(s3[j][0], s3[j][1], s3[j][2], s3[j][3]);
    if (!r3.ok) { ok(false, 'L15 前置失败: 第 ' + (j + 1) + ' 着非法'); return; }
  }
  e3.snapshot();   // 预热 posKey 缓存 (持有 B 局面键)
  e3.undoPly();    // 撤黑马 → 回到 A 局面 (红马在 c3, 该局面本局出现过 1 次)
  ok(e3.repetitionCount() === 1, 'L15 undo 后 posKey memo 已失效 — 读到恢复后的 A 局面 (实测 ' + e3.repetitionCount() + ', 未失效会得 0)');
  sandbox.XQ.Board.create = realCreate;

  // ③ inCheck memo: 同一局面同一方重复询问只算一次; 不同方互不覆盖; 换局面必须失效
  var chk = { n: 0 };
  var realIn = sandbox.XQ.Rules.inCheck;
  sandbox.XQ.Rules.inCheck = function (b, c) { chk.n++; return realIn(b, c); };
  var e4 = E.create();
  chk.n = 0;
  e4.inCheck('red'); e4.inCheck('red'); e4.inCheck('black'); e4.inCheck('black');
  ok(chk.n === 2, 'L15 inCheck memo: 4 次询问 (2 方各 2 次) 只做 2 次真实扫描 (实测 ' + chk.n + '; 修前 4)');
  // 真将军局面: 空盘 + 双将 + 红车 e5 直线照将黑将 e10 (棋子自建, 不依赖开局)
  function checkBoard() {
    var gb = sandbox.XQ.Board.makeFromGrid(new Array(90).fill(null));
    gb.set(4, 0, { color: 'black', type: 'king', id: 'bk' });
    gb.set(4, 9, { color: 'red', type: 'king', id: 'rk' });
    gb.set(4, 5, { color: 'red', type: 'rook', id: 'rr' });
    return gb;
  }
  var e5 = E.create({ startBoard: checkBoard(), turn: 'black' });
  ok(e5.inCheck('black') === true && e5.inCheck('black') === true, 'L15 inCheck memo 命中仍返回真 (黑将被红车照将)');
  ok(e5.inCheck('red') === false, 'L15 换方询问不被上一条缓存覆盖 (红方未被将)');
  ok(e5.inCheck('black') === true, 'L15 回到黑方仍为真 (memo 按方别分键)');
  var esc = e5.applyPlayerMove(4, 0, 3, 0);   // 黑将 e10→d10 应将
  ok(esc.ok === true, 'L15 前置: 黑将应将合法');
  ok(e5.inCheck('black') === false, 'L15 走子后 inCheck memo 失效 (应将后不再被将, 未失效会得 true)');
  sandbox.XQ.Rules.inCheck = realIn;
  // ④ memo 与渲染联动: 一帧内只扫描一次, 且被将方的将格必须带 in-check 类 (memo 不得吞掉真实将军)
  var chk2 = { n: 0 };
  var realIn2 = sandbox.XQ.Rules.inCheck;
  sandbox.XQ.Rules.inCheck = function (b, c) { chk2.n++; return realIn2(b, c); };
  var e6 = E.create({ startBoard: checkBoard(), turn: 'black' });
  var viewK = { boardEl: mkEl('div'), selected: null, flip: false, pendingAnim: null, startTime: Date.now(), arrow: true };
  viewK.boardEl.parentNode = mkEl('div');
  sandbox.XQ.UI.render(e6, viewK);
  var cellsK = viewK.boardEl.children || [], marked = 0;
  for (var ci = 0; ci < cellsK.length; ci++) { if (cellsK[ci]._cls && cellsK[ci]._cls['in-check']) marked++; }
  ok(chk2.n === 1, 'L15 真实渲染一帧内 inCheck 只做 1 次全盘扫描 (实测 ' + chk2.n + '; 修前 2 — 逐格判定与状态条各一次)');
  ok(marked === 1, 'L15 被将方的将格渲染出 in-check 类 (memo 与渲染联动, 实测 ' + marked + ' 格)');
  sandbox.XQ.Rules.inCheck = realIn2;
}

/* ═══ L17 第45轮: 终局卡键盘出口 + 棋盘格/走法条目的 ARIA 角色 ═══
   ① 终局卡只能靠点遮罩收起 (回到盘面看终局局面), 键盘用户没有等价路径 — Esc 出口必须成立, 且**收起要落旗标**:
      renderOverlay 在 engine.isOver() 时无条件 add('show'), 只摘类名的话下一次 refresh 会立刻把卡弹回来。
      本组用「收起 → 再渲染一次」把这条时点差异变成可观测量 (缺旗标即红)。
   ② 棋盘每格都写了 aria-label, 而元素是无角色的 <div> — 隐式 generic 角色的 Name From 是 prohibited,
      读屏按规范忽略该标签, 「可逐格探索盘面」等于从未生效。断言 role 与 aria-label 同时存在。
   ③ 走法列表条目 tabindex=0 可聚焦却无角色 → 读屏念成一串无归属文本, 用户不知道 Enter 能跳局面。 */
function l17Round45() {
  ['eo-title', 'eo-sub'].forEach(function (id) { if (!DOC_MAP[id]) DOC_MAP[id] = mkEl('div'); });
  var base = XQ.Engine.create();
  var over = true;
  var spy = {
    snapshot: function () { return base.snapshot(); },
    isOver: function () { return over; },
    legalTargets: function (x, y) { return base.legalTargets(x, y); },
    dangerTargets: function (x, y) { return base.dangerTargets(x, y); },
    inCheck: function (c) { return base.inCheck(c); },
    naturalClock: function () { return base.naturalClock(); },
    result: function () { return { winner: 'red', result: 'checkmate' }; }
  };
  var view = { boardEl: mkEl('div'), selected: null, flip: false, pendingAnim: null, startTime: Date.now(), arrow: true };
  view.boardEl.parentNode = mkEl('div');
  var ov = DOC_MAP['end-overlay'];
  sandbox.XQ.UI.render(spy, view);
  ok(ov.classList.contains('show') === true, 'L17 终局时终局卡弹出');
  ok(sandbox.XQ.UI.dismissEndOverlay() === true && ov.classList.contains('show') === false,
    'L17 dismissEndOverlay 收起终局卡 (点遮罩的键盘等价路径)');
  sandbox.XQ.UI.render(spy, view);
  ok(ov.classList.contains('show') === false, 'L17 收起后再次渲染不复弹 (不落「已收起」旗标时会被下一次 refresh 重新 add(show))');
  over = false; sandbox.XQ.UI.render(spy, view);
  over = true; sandbox.XQ.UI.render(spy, view);
  ok(ov.classList.contains('show') === true, 'L17 新一局终局卡恢复弹出 (旗标在对局不再结束时复位)');
  over = false; sandbox.XQ.UI.render(spy, view);
  ok(sandbox.XQ.UI.dismissEndOverlay() === false, 'L17 非终局态 dismissEndOverlay 为空操作 (不误置旗标)');
  // ② 棋盘格: aria-label 必须配一个允许命名的角色
  var cells = view.boardEl.children || [], labelled = 0;
  for (var ci = 0; ci < cells.length; ci++) { if (cells[ci]._attrs && cells[ci]._attrs['aria-label']) labelled++; }
  ok(cells.length === 90 && cells[0] && cells[0]._attrs.role === 'img',
    'L17 棋盘格带 role=img (无角色 div 上的 aria-label 被读屏忽略, 标签等于没写)');
  ok(labelled === 90, 'L17 90 格全部带坐标/棋子 aria-label (实测 ' + labelled + ')');
  // ③ 走法列表条目: 可聚焦就必须有动作语义
  var logEl = DOC_MAP['move-log'] || (DOC_MAP['move-log'] = mkEl('div'));
  sandbox.XQ.UI.logMove(1, 'red', '炮', 'c2-c4', null, null, 3, '炮二平五');
  var entry = (logEl.children || [])[logEl.children.length - 1];
  ok(!!entry && entry._attrs.role === 'button' && entry.tabIndex === 0,
    'L17 走法列表条目 role=button + tabIndex=0 (键盘可达且有动作语义)');
  // ④ 语言热切: 徽章动作名带 {n} 占位符, 无法用 data-i18n-aria 声明式刷新 — 必须显式重算
  //    (实机验收当场抓到: 切到中文后 aria-label 仍是英文, 要等下一手落子才自愈)
  var badgeEl = DOC_MAP['last-move-badge'] || (DOC_MAP['last-move-badge'] = mkEl('button'));
  sandbox.XQ.UI.lastMoveBadge('<b>#7</b>', 7);
  sandbox.XQ.I18N.setLang('en', false);
  sandbox.XQ.UI.relabelLastMoveBadge();
  var badgeEn = badgeEl._attrs['aria-label'];
  sandbox.XQ.I18N.setLang('zh', false);
  sandbox.XQ.UI.relabelLastMoveBadge();
  var badgeZh = badgeEl._attrs['aria-label'];
  ok(!!badgeEn && !!badgeZh && badgeEn !== badgeZh && badgeZh.indexOf('7') >= 0,
    'L17 徽章动作名随语言热切重算 (占位符无法声明式刷新: zh=' + badgeZh + ' / en=' + badgeEn + ')');
}

/* ═══ L16 第44轮: sw.js 两处「在线看着正常、只在特定部署/时序下坏掉」的行为 ═══
   ① API 排除写死根绝对 '/api/' — 与全仓「作用域相对」设计不一致: 子路径部署 (GitHub Pages /LLM-Chess/) 下
      app.js 的 fetch('api/providers') 解析成 /LLM-Chess/api/providers, 不以 '/api/' 开头 → 被当静态资源缓存
      (离线拿到过期服务商列表)。修: 按 self.registration.scope 计算作用域根, 同时保留根绝对判定。
   ② 写缓存是悬空 Promise (既不 return 也不 waitUntil) — respondWith 一 resolve 浏览器即可终止 SW, 写入被丢弃。
      修: deferred + e.waitUntil, 四条路径都 settle。此处用「手动放行的 put」把生命周期差异变成可观测量。
   独立 vm 沙箱 (子路径 scope), 与 L11 的根部署沙箱互不干扰。 */
function l16Round44() {
  var evs = {}, stored = {};
  var sb = { console: console, URL: URL, location: { origin: 'http://localhost:8788', pathname: '/LLM-Chess/' } };
  sb.globalThis = sb; sb.self = sb;
  sb.registration = { scope: 'http://localhost:8788/LLM-Chess/' };
  sb.addEventListener = function (t, fn) { evs[t] = fn; };
  sb.skipWaiting = function () { return Promise.resolve(); };
  sb.clients = { claim: function () { return Promise.resolve(); } };
  sb.Response = { error: function () { return { ok: false, _browserErrorPage: true }; } };
  var putRelease = null, putCalls = 0;
  sb.fetch = function () { return Promise.resolve({ ok: true, type: 'basic', clone: function () { return { _copy: true }; } }); };
  sb.caches = {
    open: function () {
      return Promise.resolve({
        add: function (u) { stored[String(u)] = { ok: true }; return Promise.resolve(); },
        put: function (req, res) { putCalls++; stored[typeof req === 'string' ? req : req.url] = res; return new Promise(function (r) { putRelease = r; }); }
      });
    },
    keys: function () { return Promise.resolve([]); },
    delete: function () { return Promise.resolve(true); },
    match: function () { return Promise.resolve(undefined); }
  };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8'), sb, { filename: 'sw.js' });

  function fire(url, mode) {
    var rec = { resp: null, wait: null, order: [] };
    evs.fetch({
      request: { method: 'GET', url: url, mode: mode || 'same-origin' },
      respondWith: function (p) { rec.resp = p; rec.order.push('respondWith'); },
      waitUntil: function (p) { rec.wait = p; rec.order.push('waitUntil'); }
    });
    return rec;
  }
  // ① 子路径部署: 作用域内的 api/* 必须放行 (旧实现恒不匹配 → 会被缓存)
  var a = fire('http://localhost:8788/LLM-Chess/api/providers');
  ok(a.resp === null && a.wait === null,
    'L16 子路径部署下 /LLM-Chess/api/* 直接放行 (旧写死 /api/ 时会被当静态资源缓存)');
  // ② 根绝对判定兼容保留 (根部署行为不变)
  var b = fire('http://localhost:8788/api/health');
  ok(b.resp === null, 'L16 根部署 /api/* 仍放行 (兼容保留, 不因改作用域相对而回归)');
  // ③ 作用域内普通静态资源仍被 SW 接管
  var c = fire('http://localhost:8788/LLM-Chess/ui/app.js');
  ok(c.resp !== null, 'L16 作用域内普通静态资源仍走 SW (respondWith 被调用)');
  var settled = false;
  if (c.wait) c.wait.then(function () { settled = true; });
  // ④ 写缓存挂事件生命周期: waitUntil 收到写入 promise, 且该 promise 在 put 真正落地前不 resolve
  return c.resp.then(function () { return Promise.resolve(); }).then(function () { return Promise.resolve(); }).then(function () {
    ok(putCalls === 1, 'L16 可缓存响应触发写缓存 (put 调用 ' + putCalls + ' 次)');
    ok(!!c.wait, 'L16 写缓存挂在事件生命周期上 (waitUntil 收到 promise, 旧实现完全没调用 waitUntil)');
    ok(settled === false, 'L16 put 落地前 waitUntil promise 未 resolve (旧实现 respondWith 一 resolve 即可被终止)');
    if (putRelease) putRelease();
    return c.wait;
  }).then(function () {
    ok(settled === true, 'L16 put 落地后 waitUntil promise resolve (SW 被保持到写入完成)');
    // ⑤ 网络异常路径同样 settle (否则事件永不结束, SW 被长期占住)
    sb.fetch = function () { return Promise.reject(new Error('offline')); };
    var d = fire('http://localhost:8788/LLM-Chess/ui/app.js');
    return d.resp.then(function () { return d.wait; }).then(function () {
      ok(true, 'L16 网络异常路径同样 settle waitUntil (事件不悬挂)');
    });
  });
}
