/* 象棋引擎 v1.0 — 合法走法生成 (为 alpha-beta / MCTS / LLM 校验服务) */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var Piece = XQ.Piece, Move = XQ.Move, Rules = XQ.Rules;

  function generateLegalMoves(b, color) {
    var out = [];
    for (var y = 0; y < b.H; y++) {
      for (var x = 0; x < b.W; x++) {
        var p = b.get(x, y);
        if (!p || p.color !== color) continue;
        var targets = Rules.pseudoMovesFrom(b, x, y);
        for (var i = 0; i < targets.length; i++) {
          var m = Move.create({ x: x, y: y }, targets[i], p);
          if (isLegalOnBoard(b, m)) out.push(m);
        }
      }
    }
    return out;
  }

  /** 在棋盘上模拟一步, 自将/照面 → 非法 */
  function isLegalOnBoard(b, m) {
    b.applyMove(m);
    var kp = b.kingPos(m.piece.color);
    var bad = !kp || Rules.isSquareAttacked(b, kp.x, kp.y, Piece.opponent(m.piece.color));
    b.undoMove(m);
    return !bad;
  }

  /** 某格棋子的合法落点 (UI 用) */
  function legalTargetsFrom(b, x, y) {
    var p = b.get(x, y);
    if (!p) return [];
    var legal = [];
    var targets = Rules.pseudoMovesFrom(b, x, y);
    for (var i = 0; i < targets.length; i++) {
      var m = Move.create({ x: x, y: y }, targets[i], p);
      if (isLegalOnBoard(b, m)) legal.push({ x: targets[i].x, y: targets[i].y, isCapture: !!b.get(targets[i].x, targets[i].y) });
    }
    return legal;
  }

  /** 危险落点: 伪合法但走完自将 (UI 打叉提示) */
  function dangerTargetsFrom(b, x, y) {
    var p = b.get(x, y);
    if (!p) return [];
    var dead = [];
    var targets = Rules.pseudoMovesFrom(b, x, y);
    for (var i = 0; i < targets.length; i++) {
      var m = Move.create({ x: x, y: y }, targets[i], p);
      b.applyMove(m);
      var kp = b.kingPos(p.color);
      var bad = !kp || Rules.isSquareAttacked(b, kp.x, kp.y, Piece.opponent(p.color));
      b.undoMove(m);
      if (bad) dead.push({ x: targets[i].x, y: targets[i].y });
    }
    return dead;
  }

  /** perft: 走法生成正确性的金标准统计 */
  function perft(b, color, depth) {
    if (depth === 0) return 1;
    var moves = generateLegalMoves(b, color);
    if (depth === 1) return moves.length;
    var nodes = 0, next = Piece.opponent(color);
    for (var i = 0; i < moves.length; i++) {
      b.applyMove(moves[i]);
      nodes += perft(b, next, depth - 1);
      b.undoMove(moves[i]);
    }
    return nodes;
  }

  XQ.Generator = {
    generateLegalMoves: generateLegalMoves,
    legalTargetsFrom: legalTargetsFrom,
    dangerTargetsFrom: dangerTargetsFrom,
    isLegalOnBoard: isLegalOnBoard,
    perft: perft
  };
})(typeof window !== 'undefined' ? window : globalThis);
