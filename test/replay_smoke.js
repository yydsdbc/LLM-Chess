/* test/replay_smoke.js — node 冒烟测试 XQ.Replay + XQ.ReplayController */
const fs = require('fs');
const ctx = {};   // 模拟 window: 把所有文件作为 window=ctx 加载, XQ 挂在 ctx 上
function load(p) {
  const code = fs.readFileSync(p, 'utf8');
  // 替换 IIFE 入口: 把 globalThis 分支换成 ctx
  const wrapped = '(function(window){var globalThis=window;' + code + '})(Object.assign(function(){return ctx},{},ctx));';
  // 上面那行太怪; 改用更直白的方法: 直接运行 + 临时替换函数
  // 简单做法: 用 vm.runInNewContext
}
const vm = require('vm');
const sandbox = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout };
sandbox.ctx = sandbox;
function loadInto(p) {
  const code = fs.readFileSync(p, 'utf8');
  // 文件里写的是: (function(root){...})(typeof window !== 'undefined' ? window : globalThis)
  // 我们让它把 root 指向 sandbox.globalThis 的替身 — 直接运行, IIFE 走 globalThis 分支
  // 但 globalThis 是 node 的, 挂到 node.XQ. 简单: 直接运行, 然后从 globalThis.XQ 读
  vm.runInNewContext(code, sandbox, { filename: p });
}
loadInto('core/piece.js');
loadInto('core/move.js');
loadInto('core/board.js');
loadInto('core/rules.js');
loadInto('core/generator.js');
loadInto('core/judge.js');
loadInto('core/engine.js');
loadInto('benchmark/record.js');
loadInto('replay/replay.js');
loadInto('replay/replay_controller.js');
const XQ = sandbox.XQ;
if (!XQ) { console.error('XQ not on sandbox.globalThis'); process.exit(1); }

/* v2.5 残局保谱配套: match_headless 故障时 json 可能是 0~N 手残谱, 短谱会让派生断言 (moves[2]/goto(4)/脏数据注入) 崩溃
 * → 谱长 <8 手时合成确定性 12 手测试谱 (纯引擎走子无 LLM, 序列已逐手验证合法), 谱够长仍用真实对局数据 */
function synthesizeRecord() {
  const eng = XQ.Engine.create();
  const recS = XQ.Record.blank({ redName: '合成谱', blackName: '合成谱' });
  const seq = [
    ['b1', 'c3'], ['b10', 'c8'], ['h1', 'g3'], ['h10', 'g8'],
    ['c1', 'e3'], ['c8', 'e9'], ['g4', 'g5'], ['e9', 'f7'],
    ['g3', 'f5'], ['f7', 'g5'], ['e3', 'g5'], ['e7', 'e6']
  ];
  let i = 0;
  for (const [f, t] of seq) {
    const F = XQ.Move.parseSq(f), T = XQ.Move.parseSq(t);
    const r = eng.applyPlayerMove(F.x, F.y, T.x, T.y);
    if (!r.ok) continue;   // 个别不合规则跳过 (结构测试不依赖具体着法)
    i++;
    XQ.Record.addMove(recS, eng, r.move, 1000 + i * 137, {
      summary: '合成谱着法' + i, evaluation: i % 2 ? '+0.3 红略优' : '均势', confidence: 0.6 + (i % 4) * 0.1
    });
  }
  XQ.Record.finish(recS, eng.result(), 12000);
  recS.tokens = { red: { total: 1000, requests: 12 }, black: { total: 900, requests: 12 } };
  return recS;
}
let rec = JSON.parse(fs.readFileSync('logs/match_headless.json', 'utf8'));
if (!rec || !Array.isArray(rec.moves) || rec.moves.length < 8) {
  console.log('(短谱保护: json ' + (rec && rec.moves ? rec.moves.length : '无') + ' 手 < 8 → 合成 12 手确定性测试谱)');
  rec = synthesizeRecord();
}

const list = XQ.Replay.listLocal();
console.log('listLocal:', list.length, 'ok:', Array.isArray(list));

const s = XQ.Replay.create(rec);
console.log('total:', s.total(), 'idx0:', s.idx(), 'engine:', !!s.engine());

let failed = 0;
function ok(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : ''));
  if (!cond) failed++;
}

/* v1.6.4 修复: 期望值改为从加载棋谱派生 — 原硬编码 "6手/#6 e8/#3 e3-e7" 与 logs/match_headless.json
 * 内容耦合, 该文件被每次新的验证对局覆盖后 (23:20 起为 16 手) 6 项断言永久失败; 测试应验机制而非验某一局的内容 */
const TOTAL = rec.moves.length;
const lastTo = XQ.Move.parseSq(rec.moves[TOTAL - 1].to);
const third = rec.moves[2];
const thirdTo = XQ.Move.parseSq(third.to);

let st = s.state();
ok('idx0 entry null', st.entry === null, 'idx=' + st.idx);
ok('idx0 32 pieces', countPieces(st.cells) === 32, 'pieces=' + countPieces(st.cells));
ok('idx0 turn red', st.turn === 'red');

while (s.idx() < s.total()) s.next();
st = s.state();
ok('full idx=total', s.idx() === TOTAL, 'idx=' + s.idx() + '/' + TOTAL);
ok('full entry n=total', st.entry && st.entry.n === TOTAL, 'n=' + (st.entry && st.entry.n));
ok('full lastMove=last entry', !!lastTo && !!st.lastMove && st.lastMove.to.x === lastTo.x && st.lastMove.to.y === lastTo.y, 'to=' + (st.lastMove ? XQ.Move.sqName(st.lastMove.to) : 'none'));

s.goto(3);
st = s.state();
ok('goto(3) idx=3', s.idx() === 3);
ok('goto(3) entry=rec#3', st.entry && st.entry.from === third.from && st.entry.to === third.to, st.entry ? st.entry.from + '-' + st.entry.to : 'none');
ok('goto(3) lastMove=rec#3.to', !!thirdTo && !!st.lastMove && st.lastMove.to.x === thirdTo.x && st.lastMove.to.y === thirdTo.y, 'to=' + (st.lastMove ? XQ.Move.sqName(st.lastMove.to) : 'none'));

s.prev();
ok('prev idx=2', s.idx() === 2);

s.goto(0);
ok('goto(0)', s.idx() === 0);

/* v1.7.9 将/杀/困标注: state.mark 暴露 + moveRisk markBag 集成 (构造绝杀局) */
st = s.state();
ok('state.mark 字段暴露 (无标记=null)', st.mark === null);
(function () {
  var grid = new Array(90).fill(null);
  function put(x, y, c, t) { grid[y * 9 + x] = XQ.Piece.create(c, t); }
  put(4, 0, 'black', 'king');    // 将 e10
  put(3, 1, 'red', 'rook');      // 车 d9 封 d 线/歕道
  put(5, 1, 'red', 'rook');      // 车 f9 封 f 线
  put(4, 5, 'red', 'pawn');      // 兵 e5 = 炮架
  put(3, 8, 'red', 'cannon');    // 炮 d2 → e2 成杀
  put(4, 9, 'red', 'king');      // 帅 e1 (隔兵不照面)
  put(0, 3, 'black', 'pawn');    // 卒 a7: 黑方保留自由度 (静着后非困毙, 验证无标注路径)
  var b = XQ.Board.makeFromGrid(grid);
  var fake = { turn: function () { return 'red'; }, pieceAt: function (x, y) { return b.get(x, y); }, cloneBoard: function () { return b.clone(); } };
  var bag = {};
  XQ.Replay.moveRisk(fake, { x: 3, y: 8 }, { x: 4, y: 8 }, bag, 1);
  ok('moveRisk markBag: 炮 d2-e2 绝杀标注 杀', bag[1] === '杀', 'bag=' + JSON.stringify(bag));
  var bag2 = {};
  XQ.Replay.moveRisk(fake, { x: 5, y: 1 }, { x: 5, y: 0 }, bag2, 1);   // 车 f9-f10: 将军但黑车可吃/可解 → 将非杀
  ok('moveRisk markBag: 车 f9-f10 标注 将 (非杀)', bag2[1] === '将', 'bag=' + JSON.stringify(bag2));
  var bag3 = {};
  XQ.Replay.moveRisk(fake, { x: 3, y: 8 }, { x: 2, y: 8 }, bag3, 1);   // 炮 d2-c2: 非将非杀静着 → 无标注
  ok('moveRisk markBag: 普通着法无标注', bag3[1] === undefined, 'bag=' + JSON.stringify(bag3));
})();

// 脏数据: 第3手 from==to 非法
const bad = JSON.parse(JSON.stringify(rec));
bad.moves[2] = { n: 3, side: 'red', piece: 'horse', from: 'b3', to: 'b3', name: 'b3-b3' };
bad.moves[3] = { n: 4, side: 'black', piece: 'cannon', from: 'e8', to: 'f8', name: 'e8-f8', timeMs: 1 };
const s2 = XQ.Replay.create(bad);
s2.goto(4);
st = s2.state();
ok('tolerant skip', st.skippedCount >= 1, 'skipped=' + st.skippedCount);   // 脏手可能毒化后续 (turn 不对), skippedCount≥1 即可

// v3.9 parseEval 方向判定 (rpParseEval 迁移至 replay.js): 只在胜负词齐备时定方向, 子力词/孤立数字不动方向
const pe = XQ.Replay.parseEval;
ok('parseEval 带符号直取', pe('+0.5 红略优') === 0.5 && pe('黑优 -1.5') === -1.5);
ok('parseEval 红优取正', pe('红优 2') === 2);
ok('parseEval 黑优反号', pe('黑优 2') === -2);
ok('parseEval 子力词不动方向 (旧版会因丢/被吃反号)', pe('红丢一炮 3') === 3 && pe('黑车被吃 2') === 2);
ok('parseEval 和势归零', pe('双方和棋 1') === 0);
ok('parseEval 纯文字兜底表', pe('红大优') === 3 && pe('黑优') === -1.5 && pe('均势') === 0 && isNaN(pe('红丢一炮')));

// Controller 延迟
const ctrl = XQ.ReplayController.create(s, { onState: function () {}, onPlayState: function () {} });
ok('delay 1x', ctrl.delay() === 10000);
ctrl.setSpeed(5); ok('delay 5x', ctrl.delay() === 2000);
ctrl.setSpeed(0.5); ok('delay 0.5x', ctrl.delay() === 20000);
ctrl.setSpeed(2); ok('delay 2x', ctrl.delay() === 5000);
ctrl.setSpeed(0.25); ok('delay 0.25x', ctrl.delay() === 40000);   // 慢动作 40s/步
ctrl.setSpeed(10); ok('delay 10x', ctrl.delay() === 1000);        // 1s/步
ctrl.setSpeed(20); ok('delay 20x', ctrl.delay() === 500);         // 0.5s/步
ok('SPEEDS 7 presets', XQ.ReplayController.SPEEDS.length === 7 && XQ.ReplayController.SPEEDS[0] === 0.25 && XQ.ReplayController.SPEEDS[6] === 20);
ctrl.setSpeed(3); ok('clamp 3 ignored', ctrl.speed() === 20);
ctrl.setSpeed(1);

// 循环: 末尾自动 reset
ok('loop default off', ctrl.isLooping() === false);
ctrl.setLoop(true); ok('loop on', ctrl.isLooping() === true);
ctrl.dispose();
const ctrl2 = XQ.ReplayController.create(s, { onState: function () {}, onPlayState: function () {}, loop: true });
ok('loop via opt', ctrl2.isLooping() === true);
ctrl2.dispose();
// 复用原 ctrl (已是 setSpeed(1) 状态)

// 自动播放 (5x = 2s/步)
s.goto(0);
ctrl.setSpeed(5);   // 2s/步
ctrl.play();
const startIdx = s.idx();
setTimeout(function () {
  const midIdx = s.idx();
  ctrl.pause();
  ok('autoplay advanced', midIdx > startIdx, startIdx + '→' + midIdx);
  ok('pause stops', ctrl.isPlaying() === false);

  ctrl.play(); ctrl.pause(); ctrl.stepNext();
  ok('stepNext after play', s.idx() >= 1);

  ctrl.gotoPly(4);
  ok('gotoPly 4', s.idx() === 4);

  // v1.6.2 skip helpers (+5/+10 等同 gotoPly(n+5/+10), 走 controller.gotoPly 路径)
  ctrl.gotoPly(0);
  ctrl.gotoPly(s.idx() + 5); ok('skip +5 via gotoPly', s.idx() === Math.min(5, TOTAL));
  ctrl.gotoPly(TOTAL - 1); ctrl.gotoPly(s.idx() + 10); ok('skip +10 clamps', s.idx() === TOTAL);   // 末尾前一手 +10 越界 → clamp 到末尾 (与总手数无关)

  ctrl.dispose();
  ok('dispose', ctrl.isPlaying() === false);

  // v3.9.2 跳到下一手吃子 / 上一手吃子 (long replay 场景)
  ctrl.gotoPly(0);
  ctrl.stepNextCapture();
  const after1 = s.idx();
  const move1 = rec.moves[after1 - 1];
  ok('stepNextCapture 跳到第一手吃子', after1 > 0 && move1 && !!move1.captured, 'ply=' + after1 + ' captured=' + (move1 && move1.captured));
  // 试找第二手吃子 (合成 12 手谱可能只 1 个吃子, 无则跳末尾; 边缘情况也算通过)
  ctrl.stepNextCapture();
  const after2 = s.idx();
  const move2 = rec.moves[after2 - 1];
  ok('stepNextCapture 单吃子局=末尾 (无更多吃子)', after2 === rec.moves.length || (move2 && !!move2.captured), 'ply=' + after2);
  // 上一手吃子
  ctrl.stepPrevCapture();
  const afterP = s.idx();
  const moveP = rec.moves[afterP - 1];
  ok('stepPrevCapture 回到上一手吃子', afterP > 0 && moveP && !!moveP.captured, 'ply=' + afterP);
  // 边界: 从 0 往后退应跳 0 (无更早吃子) / 末尾往后应跳末尾
  ctrl.gotoPly(0);
  ctrl.stepPrevCapture();
  ok('stepPrevCapture 边界=起点', s.idx() === 0);
  ctrl.gotoPly(rec.moves.length);
  ctrl.stepNextCapture();
  ok('stepNextCapture 边界=末尾', s.idx() === rec.moves.length);
  // 零吃子场景: 合成的无吃子棋谱应平跳 (与 auto-skip 行为对齐)
  const noCap = { moves: rec.moves.map(function (m) { return Object.assign({}, m, { captured: null }); }) };
  const s3 = XQ.Replay.create(noCap);
  const ctrl3 = XQ.ReplayController.create(s3, { onState: function () {}, onPlayState: function () {} });
  s3.goto(0);
  ctrl3.stepNextCapture();
  ok('stepNextCapture 零吃子跳末尾', s3.idx() === noCap.moves.length);
  ctrl3.gotoPly(0);
  ctrl3.stepPrevCapture();
  ok('stepPrevCapture 零吃子回起点', s3.idx() === 0);

  // listLocal 在有 localStorage 替代时 (注入)
  sandbox.localStorage = { _d: {}, getItem(k) { return this._d[k]; }, setItem(k, v) { this._d[k] = v; } };
  // Record 初始化时读 LS_KEY=null. 直接调用 record.save(rec): list() 取 LS_KEY=xq_records
  // 简单测试: 注入并 save
  const rec2 = XQ.Record.blank({ redName: 'T', blackName: 'B' });
  XQ.Record.addMove(rec2, s.engine(), { piece: { color: 'red', type: 'cannon' }, from: { x: 1, y: 2 }, to: { x: 1, y: 5 }, captured: null }, 100, { summary: 'x' });
  XQ.Record.save(rec2);
  // 重新跑 listLocal: 用同一个 XQ 模块实例 (sandbox 共享)
  const list2 = XQ.Replay.listLocal();
  ok('listLocal after save', list2.length === 1 && list2[0].red === 'T', 'count=' + list2.length);

  // v3.9 导入落库: saveImported 写 import-* 记录且只保留最近 2 条, 与真实记录分池
  XQ.Record.saveImported(JSON.parse(JSON.stringify(rec2)));
  XQ.Record.saveImported(JSON.parse(JSON.stringify(rec2)));
  XQ.Record.saveImported(JSON.parse(JSON.stringify(rec2)));
  const allLs = XQ.Record.list();
  const imps = allLs.filter(r => typeof r.id === 'string' && r.id.indexOf('import-') === 0);
  ok('saveImported 只留最近2条', imps.length === 2, 'imports=' + imps.length);
  ok('导入与真实记录分池', allLs.some(r => r.id === rec2.id), 'total=' + allLs.length);
  const sumLine = XQ.Record.summarize(rec2);
  ok('Record.summarize 一行战绩', /红胜|黑胜|和棋|未分胜负/.test(sumLine) && /手/.test(sumLine) && /吃子/.test(sumLine), sumLine);

  console.log(failed ? '\n' + failed + ' FAIL' : '\nALL PASS');
  process.exit(failed ? 1 : 0);
}, 2300);

function countPieces(cells) {
  let n = 0;
  for (let y = 0; y < cells.length; y++) for (let x = 0; x < cells[y].length; x++) if (cells[y][x]) n++;
  return n;
}