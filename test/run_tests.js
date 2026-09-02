#!/usr/bin/env node
/* test/run_tests.js — v1.0 引擎测试套件
 * 亮点: 用象棋界公认的 perft 金标准数字验证走法生成器:
 *   perft(1)=44, perft(2)=1920, perft(3)=79666
 */
'use strict';
require('../core/piece.js');
require('../core/move.js');
require('../core/board.js');
require('../core/rules.js');
require('../core/generator.js');
require('../core/judge.js');
require('../core/engine.js');
require('../ai/llm_agent.js');   // v2.2: 送吃守卫 guardCheck 单测需要
require('../ai/random_agent.js');
require('../benchmark/match.js');
require('../benchmark/record.js');
require('../benchmark/elo.js');

if (typeof localStorage === 'undefined') {
  var mem = {};
  globalThis.localStorage = {
    getItem: k => (mem[k] != null ? mem[k] : null),
    setItem: (k, v) => { mem[k] = String(v); },
    removeItem: k => { delete mem[k]; }
  };
}

var XQ = globalThis.XQ;
var PASS = [], FAIL = [];
function check(name, cond, detail) {
  (cond ? PASS : FAIL).push(name + (detail !== undefined ? ' [' + JSON.stringify(detail) + ']' : ''));
}

/* ── 布局工具: 从中文棋盘文本建盘 (便于构造测试局面) ── */
var CHAR_MAP = {};
(function () {
  var P = XQ.Piece;
  ['king','advisor','bishop','knight','rook','cannon','pawn'].forEach(function (t) {
    CHAR_MAP[P.CHARS.red[t]] = { color: 'red', type: t };
  });
  // 黑方独有字形直接映射; 车/马简体归红方, 繁体歸黑方 (测试约定)
  CHAR_MAP['将'] = { color: 'black', type: 'king' };
  CHAR_MAP['士'] = { color: 'black', type: 'advisor' };
  CHAR_MAP['象'] = { color: 'black', type: 'bishop' };
  CHAR_MAP['馬'] = { color: 'black', type: 'knight' };
  CHAR_MAP['車'] = { color: 'black', type: 'rook' };
  CHAR_MAP['砲'] = { color: 'black', type: 'cannon' };
  CHAR_MAP['卒'] = { color: 'black', type: 'pawn' };
})();
function boardFromText(text) {
  var grid = new Array(90).fill(null);
  var lines = text.trim().split('\n');
  lines.forEach(function (line, rowIdx) {
    var y = rowIdx; // 第一行 = y0 (黑底)
    var colCount = 0;
    for (var i = 0; i < line.length; i++) {
      var ch = line[i];
      if (ch === ' ') continue;
      if (/[0-9]/.test(ch)) continue;      // 行号
      if (/[a-i]/.test(ch)) break;          // 列标
      if (ch === '．' || ch === '.') { colCount++; continue; }
      var def = CHAR_MAP[ch];
      if (def) {
        var k = def.color + '-' + def.type + '-t' + rowIdx + '-' + colCount;
        grid[y * 9 + colCount] = XQ.Piece.create(def.color, def.type, k);
      }
      colCount++;
    }
  });
  return XQ.Board.makeFromGrid(grid);
}

/* ═════════ A. 基础 ═════════ */
var board0 = XQ.Board.create();
check('A1 初始32子', board0.pieceCount() === 32);
check('A2 棋子结构{color,type,id}', (function () {
  var p = board0.get(0, 0);
  return p.color === 'black' && p.type === 'rook' && !!p.id && Object.keys(p).length === 3;
})());
check('A3 clone独立性', (function () {
  var c = board0.clone();
  c.applyMove({ from: { x: 0, y: 9 }, to: { x: 0, y: 8 }, piece: c.get(0, 9), captured: null });
  return board0.get(0, 9) !== null && c.get(0, 9) === null && c.get(0, 8) !== null && board0.get(0, 8) === null;
})());

/* ═════════ B. 走法生成 ═════════ */
var legal0 = XQ.Generator.generateLegalMoves(board0, 'red');
check('B1 perft(1)=44 (开局红44种走法)', legal0.length === 44, legal0.length);
check('B2 perft(2)=1920 (金标准)', XQ.Generator.perft(board0, 'red', 2) === 1920, XQ.Generator.perft(board0, 'red', 2));
check('B3 perft(3)=79666 (金标准)', XQ.Generator.perft(board0, 'red', 3) === 79666, XQ.Generator.perft(board0, 'red', 3));

/* 兵/马/飞将细节 */
check('B4 开局兵只可前进', (function () {
  var s = legal0.filter(m => m.piece.type === 'pawn').map(m => XQ.Move.name(m)).sort();
  return JSON.stringify(s) === JSON.stringify(['a4-a5','c4-c5','e4-e5','g4-g5','i4-i5']);
})());
check('B5 开局马只可两处(蹩腿)', (function () {
  var s = legal0.filter(m => m.piece.type === 'knight').map(m => XQ.Move.name(m)).sort();
  return JSON.stringify(s) === JSON.stringify(['b1-a3','b1-c3','h1-g3','h1-i3']);
})());
check('B6 炮隔子吃马+平移', (function () {
  var s = legal0.filter(m => m.piece.type === 'cannon').map(m => XQ.Move.name(m));
  return s.indexOf('b3-b10') >= 0 && s.indexOf('b3-e3') >= 0 && s.indexOf('h3-e3') >= 0 && s.indexOf('b3-a3') >= 0;
})());
check('B7 相不出河/仕不出宫', (function () {
  var bishopOK = legal0.filter(m => m.piece.type === 'bishop').every(m => m.to.y >= 5);
  var s = legal0.map(m => XQ.Move.name(m));
  return bishopOK && s.indexOf('d1-e2') >= 0 && s.indexOf('d1-f2') < 0 && s.indexOf('c1-e3') >= 0;
})());

/* ═════════ C. apply/undo 幂等 ═════════ */
check('C1 apply→undo 完全还原', (function () {
  var b = XQ.Board.create();
  var before = b.toText();
  var moves = XQ.Generator.generateLegalMoves(b, 'red');
  var ok = true;
  moves.forEach(function (m) {
    b.applyMove(m);
    b.undoMove(m);
    if (b.toText() !== before) ok = false;
  });
  return ok;
})());
check('C2 引擎走两步→undo两步还原', (function () {
  var e = XQ.Engine.create();
  var t0 = e.snapshot();
  e.applyPlayerMove(1, 7, 1, 6);
  e.applyPlayerMove(1, 2, 1, 3);
  e.undoPly(); e.undoPly();
  return e.boardText() === XQ.Board.create().toText() && e.turn() === 'red' && e.ply() === 0;
})());

/* ═════════ D. 将军/绝杀/困毙/照面 ═════════ */
check('D1 将军检测(有炮架的炮)', (function () {
  var b = boardFromText(
    '．．．．将．．．．\n' +
    '．．．．士．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．炮．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．帅．．．．');   // v1.7.7 修复: 原第2行末尾多余 '+' 把两行合成 NaN 垃圾行, 盘面只有 9 行且炮/帅各上移一行 (测试碼巧通过: 士恰为炮架)
  return XQ.Rules.inCheck(b, 'black') === true;
})());
check('D1b 无炮架的空头炮不构成将军', (function () {
  var b = boardFromText(
    '．．．．将．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．炮．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．帅．．．．');
  return XQ.Rules.inCheck(b, 'black') === false;
})());
check('D2 双车闷杀=checkmate', (function () {
  var b = boardFromText(
    '．．．将．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．车．．．．\n' +
    '．．．车．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．帅．．．．．');
  var st = XQ.Judge.status(b, 'black');
  return st.over && st.result === 'checkmate' && st.winner === 'red';
})());
check('D3 困毙=stalemate且困毙方胜(双马盘将)', (function () {
  var b = boardFromText(
    '．．．．将．．．．\n' +
    '．．．．．．．．．\n' +
    '．．马．．．马．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．帅．．．．．');
  var st = XQ.Judge.status(b, 'black');
  return st.over && st.result === 'stalemate' && st.winner === 'red';
})());
check('D4 照面=飞将攻击(被将军)', (function () {
  var b = boardFromText(
    '．．．．将．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．帅．．．．');
  return XQ.Rules.inCheck(b, 'black') === true && XQ.Rules.kingsFacing(b) === true;
})());
check('D5 飞将吃王合法', (function () {
  var b = boardFromText(
    '．．．．将．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．帅．．．．');
  var moves = XQ.Generator.generateLegalMoves(b, 'red');
  return moves.some(m => m.to.x === 4 && m.to.y === 0 && m.piece.type === 'king');
})());
check('D6 中间隔子→移开者被拒(照面保护)', (function () {
  var b = boardFromText(
    '．．．．将．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．兵．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．帅．．．．');
  var moves = XQ.Generator.generateLegalMoves(b, 'red');
  return !moves.some(m => m.piece.type === 'pawn' && m.to.y === 3 && m.from.y === 5);
})());

/* ═════════ D7-D9b. moveTag 一步效果标注 (v1.7.9: LLM合法列表/回放共用) ═════════ */
check('D7 moveTag: 炮d2-e2后双车封线+兵屏 = 杀 (绝杀无解)', (function () {
  var b = boardFromText(
    '．．．．将．．．．\n' +   // y0: 将 e10 (无士象, 纯净杀局)
    '．．．车．车．．．\n' +   // y1: 车 d9/f9 封 d/f 线及肋道
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．兵．．．．\n' +   // y5: 兵 e5 = 炮架
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．炮．．．．．\n' +   // y8: 炮 d2 → e2 成杀
    '．．．．帅．．．．');    // y9: 帅 e1 (与将隔兵, 不照面)
  var b2 = b.clone();
  b2.applyMove({ from: { x: 3, y: 8 }, to: { x: 4, y: 8 }, piece: b2.get(3, 8), captured: null });
  var st = XQ.Judge.status(b2, 'black');
  return XQ.Judge.moveTag(b2, 'black') === '杀' && st.over && st.result === 'checkmate' && st.winner === 'red';
})());
check('D8 moveTag: 双马盘将无子可动非将军 = 困 (困毙判负)', (function () {
  var b = boardFromText(
    '．．．．将．．．．\n' +
    '．．．．．．．．．\n' +
    '．．马．．．马．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．帅．．．．．');
  return XQ.Judge.moveTag(b, 'black') === '困' && XQ.Judge.status(b, 'black').result === 'stalemate';
})());
check('D9 moveTag: 有炮架将军且可应 = 将 (非杀)', (function () {
  var b = boardFromText(
    '．．．．将．．．．\n' +
    '．．．．士．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．炮．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．帅．．．．');
  return XQ.Rules.inCheck(b, 'black') === true && XQ.Judge.moveTag(b, 'black') === '将';
})());
check('D9b moveTag: 初始局面普通着法环境 = null (零噪音)', (function () {
  return XQ.Judge.moveTag(XQ.Board.create(), 'red') === null;
})());

/* ═════════ E. 引擎 API 完整性 ═════════ */
check('E1 引擎拒绝非法走法 (车被己方兵挡不能跨跳)', (function () {
  var e = XQ.Engine.create();
  return e.applyPlayerMove(0, 9, 0, 5).ok === false;   // A2 v3.9 修复: 原测车a1-a3实为合法+`||true`永远通过 (空转), 改为真非法: a1→a6 路径有己方兵
})());
check('E1b 帅斜走被拒', (function () {
  var e = XQ.Engine.create();
  return e.applyPlayerMove(4, 9, 3, 8).ok === false && e.applyPlayerMove(4, 9, 4, 7).ok === false;
})());
check('E2 轮次外走子被拒', (function () {
  var e = XQ.Engine.create();
  return e.applyPlayerMove(1, 2, 1, 3).ok === false && e.reason_text !== 'x'; // 黑先走被拒
})());
check('E3 送将着法不在合法列表(空头炮前车不能进?)', (function () {
  var e = XQ.Engine.create();
  // 红车(0,9)沿a线前进到(0,6)吃兵? 兵不可吃(己方)! 红兵在(0,6), 己方 → 车最多到(0,7)止于兵前
  var names = e.generateLegalMoves('red').map(m => XQ.Move.name(m));
  return names.indexOf('a1>a4') < 0 && names.indexOf('a1>a6') < 0 && names.indexOf('a1>a7') < 0;
})());
check('E4 legalTargets与dangerTargets互斥且覆盖伪合法', (function () {
  var e = XQ.Engine.create();
  e.loadSerialized({ moves: [[1,7,1,6],[1,2,1,3],[4,7,4,6],[4,2,4,3]] }); // 中炮对屏风马雏形
  var t = e.legalTargets(4, 9);   // 帅
  var d = e.dangerTargets(4, 9);
  var inter = t.filter(a => d.some(b => b.x === a.x && b.y === a.y));
  return inter.length === 0;
})());
check('E5 serialize→load 往返', (function () {
  var e = XQ.Engine.create();
  e.applyPlayerMove(1, 7, 1, 6);
  e.applyPlayerMove(1, 2, 1, 3);
  var s = e.serialize();
  var e2 = XQ.Engine.create();
  var ok = e2.loadSerialized(s);
  return ok && e2.ply() === 2 && e2.turn() === 'red' && e2.boardText() === e.boardText();
})());
check('E6 loadSerialized拒绝坏棋谱', (function () {
  var e = XQ.Engine.create();
  return e.loadSerialized({ moves: [[4, 9, 9, 0]] }) === false && e.ply() === 0;
})());

/* ═════════ E7/E8. 重复局面计数 (v1.7.7: 三次重复判和检测基础) ═════════ */
check('E7 重复局面计数: 马进退一回合 → 当前局面出现1次, undo同步回退', (function () {
  var e = XQ.Engine.create();
  e.applyPlayerMove(1, 9, 2, 7);   // 红马 b1-c3
  e.applyPlayerMove(1, 0, 2, 2);   // 黑马 b10-c8 (v1.7.7 修正: b10=(1,0), 原 (1,2) 是 b8 炮 → 走法被拒后测试碼巧通过)
  e.applyPlayerMove(2, 7, 1, 9);   // 红马 c3-b1 (回)
  e.applyPlayerMove(2, 2, 1, 0);   // 黑马 c8-b10 (回) — 盘面回到开局
  if (e.repetitionCount() !== 1) return false;
  e.undoPly(); e.undoPly();
  if (e.repetitionCount() !== 0) return false;   // 撤两步回到 c3/c8 局面 (未重复)
  e.undoPly(); e.undoPly();
  return e.repetitionCount() === 0 && e.ply() === 0;   // 全部撤销: 开局位置计数为0 (未再入)
})());
check('E8 两回合来回 → 重复计数2; newGame 清零', (function () {
  var e = XQ.Engine.create();
  var seq = [[1,9,2,7],[1,0,2,2],[2,7,1,9],[2,2,1,0],[1,9,2,7],[1,0,2,2],[2,7,1,9],[2,2,1,0]];
  for (var i = 0; i < seq.length; i++) {
    var r = e.applyPlayerMove(seq[i][0], seq[i][1], seq[i][2], seq[i][3]);
    if (!r.ok) return false;
  }
  if (e.repetitionCount() !== 2) return false;   // 同一开局局面已两度再入
  if (e.isOver()) return false;                  // 仅计数, 不改终局判定 (判和留人工/后续规则层)
  e.newGame();
  return e.repetitionCount() === 0 && e.ply() === 0;
})());

/* ═════════ E9/E10. 长将追踪 (v1.7.8: 连续将军计数, 长将判负识别基础) ═════════ */
check('E9 连续将军计数: 红车三连将=3, 黑方应将=0; 停将后清零 (checkStreaksFrom)', (function () {
  var b = boardFromText(
    '．．．．将．．．．\n' +   // y0: 黑将 e10
    '．．．．．．．．．\n' +
    '．．．．卒．．．．\n' +   // y2: 黑卒 e8 — 挡双王照面
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．车．．．．\n' +   // y5: 红车 e5
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．帅．．．．');    // y9: 红帅 e1
  var sim = b.clone();
  function mk(fx, fy, tx, ty) {
    var p = sim.get(fx, fy);
    if (!p) throw new Error('重放位置无子: ' + fx + ',' + fy);
    var m = XQ.Move.create({ x: fx, y: fy }, { x: tx, y: ty }, p);
    sim.applyMove(m);
    return m;
  }
  var hist = [
    mk(4, 5, 4, 1),   // 车 e5→e9 (将)
    mk(4, 0, 3, 0),   // 将 e10→d10 (应将, 不将)
    mk(4, 1, 3, 1),   // 车 e9→d9 (将)
    mk(3, 0, 4, 0),   // 将 d10→e10
    mk(3, 1, 4, 1)    // 车 d9→e9 (将) — 连续第3将
  ];
  var s1 = XQ.Engine.checkStreaksFrom(b, hist);
  if (s1.red !== 3 || s1.black !== 0) return false;
  var hist2 = hist.concat([mk(4, 1, 0, 1)]);   // 车 e9→a9: 离开肋道, 不再将军
  var s2 = XQ.Engine.checkStreaksFrom(b, hist2);
  return s2.red === 0 && s2.black === 0;   // 非将军手 → 己方计数清零
})());
check('E10 engine.checkStreak: 初始0, 普通走法后仍0, undo 同步无残留', (function () {
  var e = XQ.Engine.create();
  if (e.checkStreak('red') !== 0 || e.checkStreak('black') !== 0) return false;
  e.applyPlayerMove(1, 9, 2, 7);   // 红马 b1-c3 (不将军)
  e.applyPlayerMove(1, 0, 2, 2);   // 黑马 b10-c8
  if (e.checkStreak('red') !== 0 || e.checkStreak('black') !== 0) return false;
  e.undoPly(); e.undoPly();
  return e.checkStreak('red') === 0 && e.checkStreak('black') === 0;
})());

/* ═════════ E11~E13. 一步效果三态 + 长将判负规则闭环 (v2.0) ═════════ */
check('E11 moveTag 三态: 杀(双车闷杀)/将(单将可解)/困(困毙无子动)', (function () {
  // 杀: 红车 a10 控制底线 + 红车 b9 控制宫顶 → 黑将 e10 无处可逃
  var mateB = boardFromText(
    '车．．．将．．．．\n' +   // y0: 红车 a10, 黑将 e10
    '．车．．．．．．．\n' +   // y1: 红车 b9
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．帅．．．．．');    // y9: 红帅 d1 (不照面)
  if (XQ.Judge.moveTag(mateB, 'black') !== '杀') return '杀';
  // 将: 红车 e2 沿肋道将军, 黑将可平 d10/f10 解
  var chkB = boardFromText(
    '．．．．将．．．．\n' +   // y0: 黑将 e10
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．车．．．．\n' +   // y8: 红车 e2
    '．．．帅．．．．．');    // y9: 红帅 d1
  if (XQ.Judge.moveTag(chkB, 'black') !== '将') return '将';
  // 困: 红双车封 d/f 线, 黑士自堵宫心 → 黑无子可动且未被将军
  var stagB = boardFromText(
    '．．．．将．．．．\n' +   // y0: 黑将 e10
    '．．．车士车．．．\n' +   // y1: 红车 d9, 黑士 e9, 红车 f9
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．帅．．．．．');    // y9: 红帅 d1
  return XQ.Judge.moveTag(stagB, 'black') === '困' ? true : '困';
})());
check('E12 长将判负: 红车跟将 6 连将 → 第 6 手自动终局 perpetual, 长将方红判负 (v2.0 规则闭环)', (function () {
  var b0 = boardFromText(
    '．．．．将．．．．\n' +   // y0: 黑将 e10
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．车．．．．．\n' +   // y5: 红车 d5 (x3,y5)
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．帅．．．．．');    // y9: 红帅 d1 — 封 d10 (照面), 黑将只能在 e10/f10 间闪避
  var e = XQ.Engine.create({ startBoard: b0, turn: 'red' });
  var seq = [
    [3, 5, 4, 5], [4, 0, 5, 0],   // 车d5-e5 将; 将 e10-f10
    [4, 5, 5, 5], [5, 0, 4, 0],   // 车e5-f5 将; 将 f10-e10
    [5, 5, 4, 5], [4, 0, 5, 0],   // 第3将; 回 f10
    [4, 5, 5, 5], [5, 0, 4, 0],   // 第4将; 回 e10
    [5, 5, 4, 5], [4, 0, 5, 0]    // 第5将; 回 f10 (5 连将: 尚不判)
  ];
  for (var i = 0; i < seq.length; i++) {
    var r = e.applyPlayerMove(seq[i][0], seq[i][1], seq[i][2], seq[i][3]);
    if (!r.ok) return false;
  }
  if (e.isOver() || e.checkStreak('red') !== 5) return false;   // 5 连将: 未达阈值
  var r6 = e.applyPlayerMove(4, 5, 5, 5);   // 第 6 连将 → 规则强制终局, 长将方红判负
  return r6.ok && r6.status.over && e.isOver()
    && e.result().result === 'perpetual' && e.result().winner === 'black';
})());
check('E13 ruleEnforce:false 时同局面不判负 (分析器/回放重建不重判, v2.0 开关)', (function () {
  var b0 = boardFromText(
    '．．．．将．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．车．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．帅．．．．．');
  var e = XQ.Engine.create({ startBoard: b0, turn: 'red', ruleEnforce: false });
  var seq = [
    [3, 5, 4, 5], [4, 0, 5, 0],
    [4, 5, 5, 5], [5, 0, 4, 0],
    [5, 5, 4, 5], [4, 0, 5, 0],
    [4, 5, 5, 5], [5, 0, 4, 0],
    [5, 5, 4, 5], [4, 0, 5, 0]
  ];
  for (var i = 0; i < seq.length; i++) {
    var r = e.applyPlayerMove(seq[i][0], seq[i][1], seq[i][2], seq[i][3]);
    if (!r.ok) return false;
  }
  var r6 = e.applyPlayerMove(4, 5, 5, 5);
  return r6.ok && !e.isOver() && e.result().result === 'check' && e.result().winner == null && e.checkStreak('red') === 6;
})());

/* ═════════ E14~E15. 自然限着判和规则闭环 (v3.8) ═════════ */
check('E14 自然限着: naturalCap=12 连续 12 半回合无吃子 → 自动判和 natural; ruleEnforce:false 不判 (v3.8 规则闭环)', (function () {
  var b0 = boardFromText(
    '．．．．将．．．．\n' +   // y0: 黑将 e10
    '．．．．．．．馬．\n' +   // y1: 黑马 i9
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．帅．．．马');    // y9: 红帅 d1, 红马 i1
  function quietPly(e) {   // 贪心找一手非吃子非将军且不触发重复判和的着法 (选代自验证, 免手写长序列)
    var legal = e.generateLegalMoves(e.turn());
    var i, m, r;
    for (i = 0; i < legal.length; i++) {
      m = legal[i];
      if (m.captured) continue;
      r = e.applyPlayerMove(m.from.x, m.from.y, m.to.x, m.to.y);
      if (!r.ok) continue;
      if (!r.status.over && r.status.result !== 'check' && e.repetitionCount() < 3) return true;
      e.undoPly();
    }
    for (i = 0; i < legal.length; i++) {   // 兑底: 允许将军 (将军不计时钟, 不影响判和验证)
      m = legal[i];
      if (m.captured) continue;
      r = e.applyPlayerMove(m.from.x, m.from.y, m.to.x, m.to.y);
      if (!r.ok) continue;
      if (!r.status.over && e.repetitionCount() < 3) return true;
      e.undoPly();
    }
    return false;
  }
  var e = XQ.Engine.create({ startBoard: b0, turn: 'red', naturalCap: 12 });
  var i2;
  for (i2 = 0; i2 < 11; i2++) if (!quietPly(e)) return 'quiet walk 不足 ply ' + i2;
  if (e.isOver() || e.naturalClock() !== 11) return false;   // 11 半回合未达阈, 不判
  var legal12 = e.generateLegalMoves(e.turn()), done12 = false;
  for (var j = 0; j < legal12.length && !done12; j++) {
    var m12 = legal12[j];
    if (m12.captured) continue;
    var r12 = e.applyPlayerMove(m12.from.x, m12.from.y, m12.to.x, m12.to.y);
    if (r12.ok && r12.status.over && r12.status.result === 'natural') done12 = true;
    else if (r12.ok) e.undoPly();
  }
  if (!(done12 && e.isOver() && e.result().result === 'natural' && e.result().winner === null && e.naturalClock() >= 12)) return false;
  var e2 = XQ.Engine.create({ startBoard: b0, turn: 'red', naturalCap: 12, ruleEnforce: false });   // 开关关: 不判和 (分析器/回放不重判)
  for (i2 = 0; i2 < 12; i2++) if (!quietPly(e2)) return 'enforce-off walk 不足';
  return !e2.isOver() && e2.naturalClock() === 12;
})());
check('E15 自然限着时钟: 吃子重置 (capture → naturalClock 归零), 重置后重新累计 (v3.8 时钟语义)', (function () {
  var b0 = boardFromText(
    '車．．．将．．．．\n' +   // y0: 黑車 a10, 黑将 e10
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '車．．．帅．．．马');    // y9: 红車 a1, 红帅 d1, 红马 i1
  var e = XQ.Engine.create({ startBoard: b0, turn: 'red', naturalCap: 4 });
  var seq = [
    [8, 9, 6, 8],   // p1 红马 i1-g2 (无吃子, 时钟 1)
    [4, 0, 4, 1],   // p2 黑将 e10-e9 (时钟 2)
    [0, 9, 0, 0],   // p3 红車 a1xa10 吃子! (时钟清零, 非将军: 黑将 e9 不在 y0 横线)
    [4, 1, 5, 1],   // p4 黑将 e9-f9 (时钟 1)
    [3, 9, 3, 8],   // p5 红帅 d1-d2 (时钟 2)
    [5, 1, 4, 1]    // p6 黑将 f9-e9 (时钟 3, 未达阈)
  ];
  for (var i = 0; i < seq.length; i++) {
    var r = e.applyPlayerMove(seq[i][0], seq[i][1], seq[i][2], seq[i][3]);
    if (!r.ok) return 'ply ' + (i + 1) + ' 被拒';
    if (i === 2 && (e.naturalClock() !== 0 || e.isOver())) return false;   // 吃子后时钟必须归零且不判和
    if (i === 5 && (e.naturalClock() !== 3 || e.isOver())) return false;
  }
  var r7 = e.applyPlayerMove(6, 8, 8, 9);   // p7 红马 g2-i1 → 时钟 4 = cap → 判和
  return r7.ok && e.isOver() && e.result().result === 'natural' && e.result().winner === null;
})());

/* ═════════ F. 随机AI对弈 (v1.0 目标) ═════════ */
check('F1 随机vs随机10局零非法且多数正常终局', (function () {
  // v1.0.daily: Math.random → 种子化 LCG (CI 三平台同结果, 消除 finished>=1 的随机抖动; node20 曾抽到 0 局终局致 CI 红)
  var seed = 0x2F6E2B1;
  function rnd() { seed = (seed * 1664525 + 1013904223) >>> 0; return seed / 4294967296; }
  // 同步跑若干短局 (直接用引擎+随机选择, 不走match的异步)
  var games = 10, bad = 0, finished = 0, totalPlies = 0;
  for (var g = 0; g < games; g++) {
    var e = XQ.Engine.create();
    var plies = 0;
    while (!e.isOver() && plies < 250) {
      var moves = e.generateLegalMoves(e.turn());
      if (!moves.length) break;
      var m = moves[(rnd() * moves.length) | 0];
      var r = e.applyPlayerMove(m.from.x, m.from.y, m.to.x, m.to.y);
      if (!r.ok) { bad++; break; }
      plies++;
    }
    totalPlies += plies;
    if (e.isOver()) finished++;
  }
  return bad === 0 && finished >= 1 && totalPlies > 1500;
})(), { note: '250步上限; 零非法; 随机局多数打满(正常)' });

/* ═════════ G. 记录与 Elo ═════════ */
check('G1 Record往返', (function () {
  var r = XQ.Record.blank({ redName: 'A', blackName: 'B' });
  r.moves.push({ n: 1, side: 'red', from: 'b3', to: 'e3', name: 'b3-e3', piece: 'cannon', captured: null, timeMs: 5 });
  XQ.Record.finish(r, { result: 'checkmate', winner: 'red' }, 1234);
  XQ.Record.save(r);
  var got = XQ.Record.get(r.id);
  return got && got.moves.length === 1 && got.result === 'checkmate' && got.winner === 'red' && got.durationMs === 1234;
})());
check('G2 Elo对称更新', (function () {
  var before = { a: XQ.Elo.ratingOf('EA'), b: XQ.Elo.ratingOf('EB') };
  var r = XQ.Elo.applyResult('EA', 'EB', 'red');
  var deltaA = r.red - before.a, deltaB = r.black - before.b;
  return deltaA > 0 && deltaB < 0 && Math.abs(deltaA + deltaB) < 0.01;
})());

/* ═════════ E16/E17. v2.2 规则闭环: 三次重复判和 + 送吃守卫 (A2 重编号: 原 E14/E15 与 v3.8 自然限着块撞号) ═════════ */
check('E16 三次重复自动判和: 马来回3回合 → 第12手 repetition 和棋(winner=null); ruleEnforce:false 不判', (function () {
  var seq = [[1,9,2,7],[1,0,2,2],[2,7,1,9],[2,2,1,0],[1,9,2,7],[1,0,2,2],[2,7,1,9],[2,2,1,0],[1,9,2,7],[1,0,2,2],[2,7,1,9],[2,2,1,0]];
  var e = XQ.Engine.create();
  var ended = -1;
  for (var i = 0; i < seq.length; i++) {
    var r = e.applyPlayerMove(seq[i][0], seq[i][1], seq[i][2], seq[i][3]);
    if (!r.ok) return false;
    if (e.isOver()) { ended = i; break; }
  }
  if (ended !== 8) return false;   // 恰在第9手判和: 马往返使两个 parity 都在重复, 最早第3次出现 = 第1/5/9手的 parity
  var res = e.result();
  if (res.result !== 'repetition' || res.winner !== null) return false;
  if (e.repetitionCount() !== 3) return false;
  var e2 = XQ.Engine.create({ ruleEnforce: false });   // 分析器/回放容错: 同局面不自动判和
  for (var j = 0; j < seq.length; j++) {
    if (!e2.applyPlayerMove(seq[j][0], seq[j][1], seq[j][2], seq[j][3]).ok) return false;
  }
  return !e2.isOver() && e2.repetitionCount() === 3;
})());
check('E17 送吃守卫 guardCheck: 车落黑卒口无保护=拦截, 安全区=null (v2.2)', (function () {
  if (!XQ.LLMAgent) return false;
  var b = boardFromText(
    '．．．．将．．．．\n' +   // y0: 黑将 e10
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．卒．．．．\n' +   // y3: 黑卒 e7 — 前进方向攻击 (4,4)
    '车．．．．．．．．\n' +   // y4: 红车 a6 (被测子) — 落点行
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．帅．．．．');    // y9: 红帅 e1
  var e = XQ.Engine.create({ startBoard: b, turn: 'red' });
  var ag = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'guard-m' });
  var hit = ag.guardCheck(e, { x: 0, y: 4 }, { x: 4, y: 4 });   // 车 a6-e6 落卒口无根 → 净损9
  if (!(typeof hit === 'string' && hit.indexOf('送吃守卫') >= 0 && hit.indexOf('卒') >= 0)) return false;
  var safe = ag.guardCheck(e, { x: 0, y: 4 }, { x: 0, y: 3 });  // 车 a6-a7 安全区 → null
  return safe === null;
})());

/* ═════════ E18~E22. A2 v3.9: 自然限着时钟将军口径 / undo 边界 / make-unmake 对账 / genesis 回归 / snapshot 增量 ═════════ */
check('E18 自然限着时钟: 将军着法不计入 (v3.8 注释口径落地), undo 后与重放一致 (A2 修复)', (function () {
  var b0 = boardFromText(
    '．．．．将．．．．\n' +   // y0: 黑将 e10
    '．．．车．．．．．\n' +   // y1: 红车 d9
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．帅．．．．．');    // y9: 红帅 d1 (与黑将不同列, 不照面)
  var e = XQ.Engine.create({ startBoard: b0, turn: 'red' });
  var seq = [
    [3, 1, 3, 2], [4, 0, 5, 0],   // 车 d9-d8 (静) 时钟1; 将 e10-f10 (静) 时钟2
    [3, 2, 3, 1], [5, 0, 4, 0]    // 车 d8-d9 (静) 时钟3; 将 f10-e10 (静) 时钟4
  ];
  for (var i = 0; i < seq.length; i++) {
    var r = e.applyPlayerMove(seq[i][0], seq[i][1], seq[i][2], seq[i][3]);
    if (!r.ok) return 'ply' + (i + 1) + '被拒';
  }
  if (e.naturalClock() !== 4) return '静走时钟=' + e.naturalClock();
  var rc = e.applyPlayerMove(3, 1, 3, 0);   // 车 d9-d10 将军 (非吃子) — 时钟不得累加
  if (!rc.ok || rc.status.result !== 'check') return '将军着法异常';
  if (e.naturalClock() !== 4) return '将军着法被计入时钟=' + e.naturalClock();
  e.undoPly();
  if (e.naturalClock() !== 4 || e.checkStreak('red') !== 0) return 'undo后不一致 时钟=' + e.naturalClock() + ' 连将=' + e.checkStreak('red');
  if (!e.applyPlayerMove(3, 1, 3, 2).ok) return '静走续计被拒';   // 车 d9-d8 → 时钟5
  if (!e.applyPlayerMove(4, 0, 5, 0).ok) return '黑静走被拒';     // 将 e10-f10 → 时钟6
  return e.naturalClock() === 6;
})());
check('E19 自然限着/重复计数 undo 边界: 静-静-吃-静-静 混合序列逐手撤销无残留 (A2)', (function () {
  var b0 = boardFromText(
    '車．．．将．．．．\n' +   // y0: 黑車 a10, 黑将 e10
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '車．．．帅．．．马');    // y9: 红車 a1, 红帅 d1, 红马 i1
  var e = XQ.Engine.create({ startBoard: b0, turn: 'red' });
  var seq = [
    [8, 9, 6, 8],   // 马i1-g2 静 时钟1
    [4, 0, 4, 1],   // 将e10-e9 静 时钟2
    [0, 9, 0, 0],   // 車a1xa10 吃 时钟清零
    [4, 1, 5, 1],   // 将e9-f9 静 时钟1
    [3, 9, 3, 8]    // 帅d1-d2 静 时钟2
  ];
  for (var i = 0; i < seq.length; i++) {
    var r = e.applyPlayerMove(seq[i][0], seq[i][1], seq[i][2], seq[i][3]);
    if (!r.ok) return 'ply' + (i + 1) + '被拒';
    if (e.repetitionCount() !== 0) return 'ply' + (i + 1) + '重复计数非0';
  }
  if (e.naturalClock() !== 2) return '吃后续计=' + e.naturalClock();
  var clocks = [1, 0, 2, 1, 0];   // 逐手撤销后期望: 2→1→0(撤到吃子后)→2→1→0
  for (var u = 0; u < 5; u++) {
    e.undoPly();
    if (e.naturalClock() !== clocks[u]) return 'undo' + (u + 1) + ' 时钟=' + e.naturalClock() + ' 期望=' + clocks[u];
  }
  return e.ply() === 0 && e.repetitionCount() === 0 && e.checkStreak('red') === 0 && e.checkStreak('black') === 0
    && e.naturalClock() === 0 && e.boardText() === b0.toText();
})());
check('E20 make/unmake 对账: 生成→应用→撤销→再生成完全一致 (开局全量+中局抽样, A2)', (function () {
  function audit(b, color) {
    var before = b.toText();
    var moves = XQ.Generator.generateLegalMoves(b, color);
    var names = moves.map(function (m) { return XQ.Move.name(m); }).sort();
    for (var i = 0; i < moves.length; i++) {
      var m = moves[i];
      b.applyMove(m);
      b.undoMove(m);
      if (b.toText() !== before) return 'undo还原失败@' + XQ.Move.name(m);
      var after = XQ.Generator.generateLegalMoves(b, color).map(function (mm) { return XQ.Move.name(mm); }).sort();
      if (JSON.stringify(after) !== JSON.stringify(names)) return '再生成不一致@' + XQ.Move.name(m);
    }
    return true;
  }
  var r0 = audit(XQ.Board.create(), 'red');
  if (r0 !== true) return r0;
  var e = XQ.Engine.create();
  for (var p = 0; p < 10 && !e.isOver(); p++) {   // 确定性走 10 手到中局
    var ms = e.generateLegalMoves(e.turn());
    var mv = ms[(p * 3) % ms.length];
    if (!e.applyPlayerMove(mv.from.x, mv.from.y, mv.to.x, mv.to.y).ok) return 'walk ply' + p;
  }
  return audit(e.cloneBoard(), e.turn());
})());
check('E21 自定义起始盘面 undoPly: 长将计数从 genesis 重算, 不落回标准开局板 (A2 修复)', (function () {
  var b0 = boardFromText(
    '．．．．将．．．．\n' +   // y0: 黑将 e10 (E12 同款长将场景)
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．车．．．．．\n' +   // y5: 红车 d5
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．．．．．．．\n' +
    '．．．帅．．．．．');    // y9: 红帅 d1
  var e = XQ.Engine.create({ startBoard: b0, turn: 'red' });
  if (!e.applyPlayerMove(3, 5, 4, 5).ok) return 'ply1';   // 车 d5-e5 将
  if (e.checkStreak('red') !== 1) return '连将=' + e.checkStreak('red');
  if (!e.applyPlayerMove(4, 0, 5, 0).ok) return 'ply2';   // 将 e10-f10 应将
  e.undoPly();   // 撤黑应将 — 重放基点是自定义起始盘: 车 e5 仍在将军 → red 连将应为 1
  if (e.checkStreak('red') !== 1) return 'undo应将后连将=' + e.checkStreak('red') + ' (genesis 错位?)';
  e.undoPly();   // 撤红将军
  return e.checkStreak('red') === 0 && e.checkStreak('black') === 0 && e.ply() === 0
    && e.naturalClock() === 0 && e.repetitionCount() === 0 && e.boardText() === b0.toText();
})());
check('E22 snapshot 增量字段: ply/naturalClock/repetitionCount 进出快照 (replay 重建依赖, A2)', (function () {
  var e = XQ.Engine.create();
  var s0 = e.snapshot();
  if (s0.ply !== 0 || s0.naturalClock !== 0 || s0.repetitionCount !== 0) return '初始字段';
  e.applyPlayerMove(1, 9, 2, 7);   // 马b1-c3
  e.applyPlayerMove(1, 0, 2, 2);   // 马b10-c8
  e.applyPlayerMove(2, 7, 1, 9);   // 马c3-b1
  e.applyPlayerMove(2, 2, 1, 0);   // 马c8-b10 → 回开局局面
  var s1 = e.snapshot();
  return s1.ply === 4 && s1.naturalClock === 4 && s1.repetitionCount === 1
    && Array.isArray(s1.cells) && s1.cells.length === 10 && s1.turn === 'red';
})());

/* ═════════ 输出 ═════════ */
console.log('\n===== PASS (' + PASS.length + ') =====');
PASS.forEach(p => console.log('  ✓ ' + p));
if (FAIL.length) {
  console.log('\n===== FAIL (' + FAIL.length + ') =====');
  FAIL.forEach(f => console.log('  ✗ ' + f));
  process.exit(1);
} else {
  console.log('\n全部通过 ✔  (含 perft 44/1920/79666 金标准)');
}
