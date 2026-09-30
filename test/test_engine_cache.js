/* test_engine_cache.js — 引擎状态索引与合法着法缓存回归 */
'use strict';
const assert = require('assert');
for (const file of ['piece.js', 'move.js', 'board.js', 'rules.js', 'generator.js', 'judge.js', 'engine.js']) {
  require('../core/' + file);
}
const XQ = globalThis.XQ;
let passed = 0;
function test(name, fn) { fn(); passed++; console.log('  ✓ ' + name); }

test('将帅位置索引跟随 set、apply、undo、clone 更新且不暴露内部坐标', () => {
  const b = XQ.Board.makeFromGrid(new Array(90).fill(null));
  b.set(4, 9, XQ.Piece.create('red', 'king', 'rk'));
  b.set(4, 0, XQ.Piece.create('black', 'king', 'bk'));
  const pos = b.kingPos('red');
  pos.x = 0;
  assert.deepStrictEqual(b.kingPos('red'), { x: 4, y: 9 });
  const move = XQ.Move.create({ x: 4, y: 9 }, { x: 4, y: 8 }, b.get(4, 9));
  b.applyMove(move);
  assert.deepStrictEqual(b.kingPos('red'), { x: 4, y: 8 });
  assert.deepStrictEqual(b.clone().kingPos('red'), { x: 4, y: 8 });
  b.undoMove(move);
  assert.deepStrictEqual(b.kingPos('red'), { x: 4, y: 9 });
  b.set(4, 9, null);
  assert.strictEqual(b.kingPos('red'), null);
});

test('捕获与撤销将帅时索引同步', () => {
  const b = XQ.Board.makeFromGrid(new Array(90).fill(null));
  b.set(4, 9, XQ.Piece.create('red', 'king', 'rk'));
  b.set(4, 5, XQ.Piece.create('black', 'king', 'bk'));
  b.set(4, 4, XQ.Piece.create('red', 'rook', 'rr'));
  const move = XQ.Move.create({ x: 4, y: 4 }, { x: 4, y: 5 }, b.get(4, 4));
  b.applyMove(move);
  assert.strictEqual(b.kingPos('black'), null);
  b.undoMove(move);
  assert.deepStrictEqual(b.kingPos('black'), { x: 4, y: 5 });
});

test('合法着法按盘面版本和颜色只生成一次，并在走子/悔棋后失效', () => {
  const original = XQ.Generator.generateLegalMoves;
  let calls = 0;
  XQ.Generator.generateLegalMoves = function (board, color) { calls++; return original(board, color); };
  try {
    const engine = XQ.Engine.create();
    const first = engine.generateLegalMoves('red');
    const red = first[0];
    const coords = [red.from.x, red.from.y, red.to.x, red.to.y];
    const second = engine.generateLegalMoves('red');
    assert.strictEqual(first.length, 44);
    assert.strictEqual(second.length, 44);
    assert.strictEqual(calls, 1);
    assert.notStrictEqual(first, second);
    assert.notStrictEqual(first[0], second[0]);
    assert.notStrictEqual(first[0].piece, engine.pieceAt(coords[0], coords[1]));

    first.splice(0, first.length);
    red.from.x = 100;
    red.piece.type = 'king';
    const third = engine.generateLegalMoves('red');
    assert.strictEqual(third.length, 44);
    assert.strictEqual(calls, 1);
    assert.strictEqual(engine.pieceAt(coords[0], coords[1]).type, 'pawn');

    const played = engine.applyPlayerMove(coords[0], coords[1], coords[2], coords[3]);
    assert.strictEqual(played.ok, true);
    assert.strictEqual(calls, 2, '走后终局检查只生成新状态的黑方走法一次');
    engine.generateLegalMoves('black');
    assert.strictEqual(calls, 2, '终局检查生成的走法供下一次黑方查询复用');
    engine.undoPly();
    engine.generateLegalMoves('red');
    assert.strictEqual(calls, 3, '悔棋换回新状态版本后重新生成');
  } finally { XQ.Generator.generateLegalMoves = original; }
});

test('pieceAt 和搜索棋盘的棋子修改不会污染引擎或合法着法缓存', () => {
  for (const getPiece of [e => e.pieceAt(0, 6), e => e.cloneBoard().get(0, 6)]) {
    const engine = XQ.Engine.create();
    const before = engine.boardText();
    const legal = engine.legalMoveStrings();
    const piece = getPiece(engine);
    piece.type = 'king';
    piece.color = 'black';
    assert.strictEqual(engine.boardText(), before);
    assert.strictEqual(engine.pieceAt(0, 6).type, 'pawn');
    assert.strictEqual(engine.legalMoveStrings(), legal);
    assert.strictEqual(engine.applyPlayerMove(0, 6, 0, 5).ok, true);
  }
});

test('自定义初始棋盘与引擎内棋子引用隔离', () => {
  const start = XQ.Board.create();
  const engine = XQ.Engine.create({ startBoard: start });
  start.get(4, 9).type = 'pawn';
  assert.strictEqual(engine.pieceAt(4, 9).type, 'king');
  assert.deepStrictEqual(engine.kingPos('red'), { x: 4, y: 9 });
});

test('newGame 恢复自定义初始棋盘与起始行棋方', () => {
  const start = XQ.Board.makeFromGrid(new Array(90).fill(null));
  start.set(4, 9, XQ.Piece.create('red', 'king', 'rk'));
  start.set(3, 0, XQ.Piece.create('black', 'king', 'bk'));
  const expected = start.toText();
  const engine = XQ.Engine.create({ startBoard: start, turn: 'black' });
  assert.strictEqual(engine.applyPlayerMove(3, 0, 3, 1).ok, true);
  engine.newGame();
  assert.strictEqual(engine.boardText(), expected);
  assert.strictEqual(engine.turn(), 'black');
  assert.strictEqual(engine.ply(), 0);
  assert.deepStrictEqual(engine.kingPos('black'), { x: 3, y: 0 });
});

test('目标缓存保持引用复用且目标数组与坐标只读', () => {
  const engine = XQ.Engine.create();
  const legal = engine.legalTargets(0, 6);
  assert.deepStrictEqual(legal, [{ x: 0, y: 5, isCapture: false }]);
  assert.strictEqual(engine.legalTargets(0, 6), legal, '同一盘面仍复用目标数组');
  assert.throws(() => { legal[0].x = 8; }, TypeError);
  assert.throws(() => { legal.push({ x: 4, y: 4 }); }, TypeError);

  const danger = engine.dangerTargets(0, 6);
  assert.strictEqual(engine.dangerTargets(0, 6), danger, '危险目标缓存也保持引用复用');
  assert.throws(() => { danger.push({ x: 8, y: 8 }); }, TypeError);
  assert.strictEqual(engine.applyPlayerMove(0, 6, 0, 5).ok, true);
});

test('snapshot 的记忆化快照保持深层只读', () => {
  const engine = XQ.Engine.create();
  const first = engine.snapshot();
  assert.throws(() => { first.cells[6][0].type = 'king'; }, TypeError);
  assert.throws(() => { first.cells[6].splice(0, 1); }, TypeError);
  assert.throws(() => { first.turn = 'black'; }, TypeError);
  assert.strictEqual(engine.snapshot(), first, '同状态仍复用快照');
  assert.strictEqual(engine.snapshot().cells[6][0].type, 'pawn');
  assert.strictEqual(engine.turn(), 'red');
});

test('历史、末着、落子返回值与事件中的棋子修改不改变盘面或悔棋结果', () => {
  for (const exposure of ['history', 'lastMove', 'result', 'event']) {
    const b = XQ.Board.makeFromGrid(new Array(90).fill(null));
    b.set(4, 9, XQ.Piece.create('red', 'king', 'rk'));
    b.set(3, 0, XQ.Piece.create('black', 'king', 'bk'));
    b.set(0, 5, XQ.Piece.create('red', 'rook', 'rr'));
    b.set(0, 4, XQ.Piece.create('black', 'knight', 'bn'));
    const engine = XQ.Engine.create({ startBoard: b });
    let eventMove;
    engine.onChange((type, data) => { if (type === 'move') eventMove = data.move; });
    const played = engine.applyPlayerMove(0, 5, 0, 4);
    assert.strictEqual(played.ok, true);
    const m = exposure === 'history' ? engine.history()[0]
      : exposure === 'lastMove' ? engine.lastMove() : exposure === 'result' ? played.move : eventMove;
    m.piece.type = 'pawn';
    m.piece.color = 'black';
    m.captured.type = 'cannon';
    assert.strictEqual(engine.pieceAt(0, 4).type, 'rook', exposure);
    assert.strictEqual(engine.lastMove().captured.type, 'knight', exposure);
    assert.strictEqual(engine.undoPly(), true);
    assert.strictEqual(engine.turn(), 'red', exposure);
    assert.strictEqual(engine.pieceAt(0, 5).type, 'rook', exposure);
    assert.strictEqual(engine.pieceAt(0, 4).type, 'knight', exposure);
  }
});

test('棋盘相等比较正确处理空格、同盘面与不同棋子', () => {
  const empty = XQ.Board.makeFromGrid(new Array(90).fill(null));
  assert.strictEqual(empty.equals(empty.clone()), true);
  const b = XQ.Board.create();
  const copy = b.clone();
  assert.strictEqual(b.equals(copy), true);
  copy.set(0, 6, null);
  assert.strictEqual(b.equals(copy), false);
  copy.set(0, 6, XQ.Piece.create('red', 'pawn', 'different-id'));
  assert.strictEqual(b.equals(copy), false);
});

console.log('test_engine_cache: ' + passed + ' PASS');
