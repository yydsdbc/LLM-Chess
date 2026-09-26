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

console.log('test_engine_cache: ' + passed + ' PASS');
