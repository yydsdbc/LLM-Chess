/* test_spectator.js — 观战估计契约、真实局面及缓存生命周期回归 */
'use strict';
const assert = require('assert');
for (const file of ['piece.js', 'move.js', 'board.js', 'rules.js', 'generator.js', 'judge.js', 'engine.js']) require('../core/' + file);
require('../evaluation/xiangqi_knowledge.js');
require('../evaluation/position.js');
require('../ui/spectator.js');
const XQ = globalThis.XQ;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }
function withEvaluator(evaluator, fn) {
  const original = XQ.PositionEvaluator;
  XQ.PositionEvaluator = evaluator;
  try { return fn(); } finally { XQ.PositionEvaluator = original; }
}
function stubEngine(score, snap = Object.freeze({})) {
  return { score, snapshot: () => snap, result: () => ({ over: false, winner: null }) };
}
function emptyBoard() { return XQ.Board.makeFromGrid(new Array(90).fill(null)); }
function reverseColors(board) {
  const mirror = emptyBoard();
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const piece = board.get(x, y);
    if (piece) mirror.set(8 - x, 9 - y, XQ.Piece.create(XQ.Piece.opponent(piece.color), piece.type));
  }
  return mirror;
}
function assertUnavailable(out) { assert.deepStrictEqual(out, { red: null, black: null, score: null, status: 'unavailable' }); }

test('真实初始局面是50/50，显示的是固定红方静态评分', () => {
  const engine = XQ.Engine.create();
  const out = XQ.Spectator.estimate(engine);
  assert.strictEqual(out.status, 'estimate');
  assert.strictEqual(out.score, XQ.PositionEvaluator.evaluate(engine, 'red').score);
  assert.strictEqual(out.red, 50);
  assert.strictEqual(out.black, 50);
});

test('真实自定义车兵优势局面红方领先，旋转换色后的估计严格镜像', () => {
  const board = emptyBoard();
  board.set(4, 9, XQ.Piece.create('red', 'king'));
  board.set(3, 0, XQ.Piece.create('black', 'king'));
  board.set(1, 5, XQ.Piece.create('red', 'rook'));
  board.set(2, 4, XQ.Piece.create('red', 'pawn'));
  const redEngine = XQ.Engine.create({ startBoard: board });
  const blackEngine = XQ.Engine.create({ startBoard: reverseColors(board), turn: 'black' });
  const red = XQ.Spectator.estimate(redEngine);
  const black = XQ.Spectator.estimate(blackEngine);
  assert.strictEqual(red.status, 'estimate');
  assert.strictEqual(black.status, 'estimate');
  assert(red.score > 0 && red.red > 50);
  assert.strictEqual(black.score, -red.score);
  assert.strictEqual(black.red, red.black);
});

test('相同盘面轮到哪一方都不改变固定红方视角', () => {
  const board = emptyBoard();
  board.set(4, 9, XQ.Piece.create('red', 'king'));
  board.set(3, 0, XQ.Piece.create('black', 'king'));
  board.set(1, 5, XQ.Piece.create('red', 'rook'));
  const redTurn = XQ.Spectator.estimate(XQ.Engine.create({ startBoard: board, turn: 'red' }));
  const blackTurn = XQ.Spectator.estimate(XQ.Engine.create({ startBoard: board, turn: 'black' }));
  assert.deepStrictEqual(redTurn, blackTurn);
});

test('分数映射对称、单调、总和100，非终局极端分也不宣告获胜', () => {
  withEvaluator({ evaluate: engine => ({ score: engine.score }) }, () => {
    const scores = [-Number.MAX_VALUE, -100, -30, -8, -4, -2, -1, -0.1, 0, 0.1, 1, 2, 4, 8, 30, 100, Number.MAX_VALUE];
    let previous = 0;
    for (const score of scores) {
      const out = XQ.Spectator.estimate(stubEngine(score));
      assert.strictEqual(out.status, 'estimate');
      assert(Number.isInteger(out.red) && Number.isInteger(out.black));
      assert(out.red >= 1 && out.red <= 99 && out.black >= 1 && out.black <= 99);
      assert.strictEqual(out.red + out.black, 100);
      assert(out.red >= previous);
      previous = out.red;
      const mirror = XQ.Spectator.estimate(stubEngine(-score));
      assert.strictEqual(mirror.red, out.black);
    }
    assert.strictEqual(XQ.Spectator.estimate(stubEngine(-Number.MAX_VALUE)).red, 1);
    assert.strictEqual(XQ.Spectator.estimate(stubEngine(Number.MAX_VALUE)).red, 99);
  });
});

test('只请求红方评价，模型confidence与其它字段不参与百分比', () => {
  const sides = [];
  withEvaluator({ evaluate: (engine, side) => { sides.push(side); return { score: 0, confidence: engine.confidence }; } }, () => {
    for (const confidence of [0, 0.5, 1]) {
      const engine = stubEngine(0);
      engine.confidence = confidence;
      assert.strictEqual(XQ.Spectator.estimate(engine).red, 50);
    }
  });
  assert.deepStrictEqual(sides, ['red', 'red', 'red']);
});

test('NaN、无穷及非数值评分安全返回unavailable', () => {
  withEvaluator({ evaluate: engine => ({ score: engine.score }) }, () => {
    for (const score of [NaN, Infinity, -Infinity, null, undefined, '1', {}]) assertUnavailable(XQ.Spectator.estimate(stubEngine(score)));
  });
});

test('缺少评价模块、评价函数或评价结果安全返回unavailable', () => {
  for (const evaluator of [null, {}, { evaluate: () => null }, { evaluate: () => ({}) }]) {
    withEvaluator(evaluator, () => assertUnavailable(XQ.Spectator.estimate(stubEngine(0))));
  }
});

test('评价、结果、快照抛异常均被隔离', () => {
  withEvaluator({ evaluate: () => { throw new Error('evaluation failed'); } }, () => assertUnavailable(XQ.Spectator.estimate(stubEngine(0))));
  assertUnavailable(XQ.Spectator.estimate({ result: () => { throw new Error('result failed'); } }));
  assertUnavailable(XQ.Spectator.estimate({ result: () => ({ over: false }), snapshot: () => { throw new Error('snapshot failed'); } }));
});

test('缺少引擎、结果或无效快照不产生伪百分比', () => {
  for (const engine of [null, {}, { result: () => null }, { result: () => ({}) }]) assertUnavailable(XQ.Spectator.estimate(engine));
  assertUnavailable(XQ.Spectator.estimate(stubEngine(0), null));
});

test('真实将杀终局只展示确定赛果，换色后黑胜', () => {
  const board = emptyBoard();
  board.set(4, 9, XQ.Piece.create('red', 'king'));
  board.set(4, 0, XQ.Piece.create('black', 'king'));
  board.set(3, 1, XQ.Piece.create('red', 'rook'));
  board.set(5, 1, XQ.Piece.create('red', 'rook'));
  board.set(4, 5, XQ.Piece.create('red', 'pawn'));
  board.set(4, 8, XQ.Piece.create('red', 'cannon'));
  const redWin = XQ.Engine.create({ startBoard: board, turn: 'black' });
  const blackWin = XQ.Engine.create({ startBoard: reverseColors(board), turn: 'red' });
  assert.strictEqual(redWin.result().result, 'checkmate');
  assert.deepStrictEqual(XQ.Spectator.estimate(redWin), { red: 100, black: 0, score: null, status: 'red-win' });
  assert.deepStrictEqual(XQ.Spectator.estimate(blackWin), { red: 0, black: 100, score: null, status: 'black-win' });
});

test('真实自然限着和棋带draw状态，与普通50/50明确区分', () => {
  const engine = XQ.Engine.create({ naturalCap: 1 });
  assert(engine.applyPlayerMove(0, 9, 0, 8).ok);
  assert.strictEqual(engine.result().result, 'natural');
  assert.deepStrictEqual(XQ.Spectator.estimate(engine), { red: 50, black: 50, score: null, status: 'draw' });
});

test('终局优先于冲突评分、缺失评价及快照读取', () => {
  let calls = 0;
  withEvaluator({ evaluate: () => { calls++; throw new Error('must not evaluate terminal'); } }, () => {
    for (const winner of ['red', 'black', null]) {
      const engine = { score: winner === 'red' ? -100 : 100, result: () => ({ over: true, winner }), snapshot: () => { throw new Error('must not snapshot terminal'); } };
      const out = XQ.Spectator.estimate(engine);
      assert.strictEqual(out.status, winner ? winner + '-win' : 'draw');
    }
    assert.strictEqual(calls, 0);
  });
  withEvaluator(null, () => assert.strictEqual(XQ.Spectator.estimate({ result: () => ({ over: true, winner: 'red' }) }).red, 100));
  assertUnavailable(XQ.Spectator.estimate({ result: () => ({ over: true, winner: 'unknown' }) }));
});

test('缓存的未终局估计不能覆盖引擎新赛果', () => {
  const engine = stubEngine(-100);
  let result = { over: false, winner: null };
  engine.result = () => result;
  withEvaluator({ evaluate: value => ({ score: value.score }) }, () => {
    const snap = engine.snapshot();
    assert.strictEqual(XQ.Spectator.estimate(engine, snap).red, 1);
    result = { over: true, winner: 'red' };
    assert.strictEqual(XQ.Spectator.estimate(engine, snap).red, 100);
  });
});

test('传已有快照不额外读取快照，同版本只评价一次且结果不可被调用方污染', () => {
  const snapshot = Object.freeze({});
  let calls = 0;
  const engine = { result: () => ({ over: false }), snapshot: () => { throw new Error('unneeded snapshot'); } };
  withEvaluator({ evaluate: () => { calls++; return { score: 2 }; } }, () => {
    const first = XQ.Spectator.estimate(engine, snapshot);
    assert.strictEqual(first.status, 'estimate');
    assert.strictEqual(XQ.Spectator.estimate(engine, snapshot), first);
    assert.strictEqual(calls, 1);
    assert(Object.isFrozen(first));
    assert.throws(() => { first.red = 0; }, TypeError);
  });
});

test('真实评价复用传入快照，首次显示、走子和悔棋均不额外读取', () => {
  const engine = XQ.Engine.create();
  const snapshotMethod = engine.snapshot;
  let reads = 0;
  const spyEngine = Object.create(engine, { snapshot: { value: () => { reads++; return engine.snapshot(); } } });
  const held = engine.snapshot();
  const heldText = JSON.stringify(held);
  const initialScore = XQ.PositionEvaluator.evaluate(engine, 'red').score;
  const first = XQ.Spectator.estimate(spyEngine, held);
  assert.strictEqual(first.status, 'estimate');
  assert.strictEqual(first.score, initialScore);
  assert.strictEqual(reads, 0, '真实评价必须复用 renderer 已取得的快照');
  assert.strictEqual(XQ.Spectator.estimate(spyEngine, held), first);
  assert.strictEqual(reads, 0);
  assert(engine.applyPlayerMove(1, 7, 4, 7).ok);
  const moved = engine.snapshot();
  assert.strictEqual(XQ.Spectator.estimate(spyEngine, moved).score, XQ.PositionEvaluator.evaluate(engine, 'red').score);
  assert.strictEqual(reads, 0);
  assert(engine.undoPly());
  assert.deepStrictEqual(XQ.Spectator.estimate(spyEngine, engine.snapshot()), first);
  assert.strictEqual(reads, 0);
  assert.strictEqual(engine.snapshot, snapshotMethod);
  assert.strictEqual(JSON.stringify(held), heldText);
});

test('真实评价未传快照时整个展示估计只读取一次', () => {
  const engine = XQ.Engine.create();
  let reads = 0;
  const spyEngine = Object.create(engine, { snapshot: { value: () => { reads++; return engine.snapshot(); } } });
  const out = XQ.Spectator.estimate(spyEngine);
  assert.strictEqual(out.status, 'estimate');
  assert.strictEqual(out.score, XQ.PositionEvaluator.evaluate(engine, 'red').score);
  assert.strictEqual(reads, 1, '内部阶段识别和评价不能重复读取快照');
});

test('不同引擎共享同一个快照对象时仍隔离缓存', () => {
  const snapshot = Object.freeze({});
  let calls = 0;
  withEvaluator({ evaluate: engine => { calls++; return { score: engine.score }; } }, () => {
    const red = XQ.Spectator.estimate(stubEngine(4, snapshot), snapshot);
    const black = XQ.Spectator.estimate(stubEngine(-4, snapshot), snapshot);
    assert.strictEqual(red.red, black.black);
    assert.strictEqual(calls, 2);
  });
});

test('真实走子、悔棋与重开快照变化会刷新缓存，保留旧快照不可变', () => {
  const engine = XQ.Engine.create();
  const evaluate = XQ.PositionEvaluator.evaluate;
  let calls = 0;
  withEvaluator({ evaluate: (value, side) => { calls++; return evaluate(value, side); } }, () => {
    const held = engine.snapshot();
    const text = JSON.stringify(held);
    const first = XQ.Spectator.estimate(engine, held);
    assert.strictEqual(XQ.Spectator.estimate(engine, held), first);
    assert.strictEqual(calls, 1);
    assert(engine.applyPlayerMove(1, 7, 4, 7).ok);
    const moved = engine.snapshot();
    assert.notStrictEqual(moved, held);
    XQ.Spectator.estimate(engine, moved);
    assert.strictEqual(calls, 2);
    assert(engine.undoPly());
    assert.deepStrictEqual(XQ.Spectator.estimate(engine, engine.snapshot()), first);
    assert.strictEqual(calls, 3);
    engine.newGame();
    assert.deepStrictEqual(XQ.Spectator.estimate(engine, engine.snapshot()), first);
    assert.strictEqual(calls, 4);
    assert.strictEqual(JSON.stringify(held), text);
    assert(Object.isFrozen(held) && Object.isFrozen(held.cells));
  });
});

test('反复展示估计不改变真实引擎棋盘、回合、历史或赛果', () => {
  const engine = XQ.Engine.create();
  const before = { snapshot: JSON.stringify(engine.snapshot()), text: engine.boardText(), history: engine.history(), turn: engine.turn(), result: engine.result() };
  for (let i = 0; i < 10; i++) XQ.Spectator.estimate(engine, engine.snapshot());
  assert.strictEqual(JSON.stringify(engine.snapshot()), before.snapshot);
  assert.strictEqual(engine.boardText(), before.text);
  assert.deepStrictEqual(engine.history(), before.history);
  assert.strictEqual(engine.turn(), before.turn);
  assert.deepStrictEqual(engine.result(), before.result);
});

console.log('\ntest_spectator: ' + passed + ' PASS');
