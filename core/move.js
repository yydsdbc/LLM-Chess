/* 象棋引擎 v1.0 — 走法对象 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};

  /** move = { from:{x,y}, to:{x,y}, piece, captured, n(手数,可空) } */
  function create(from, to, piece, captured) {
    return {
      from: { x: from.x, y: from.y },
      to: { x: to.x, y: to.y },
      piece: piece,
      captured: captured || null
    };
  }

  function clone(m) {
    return create(m.from, m.to, m.piece, m.captured);
  }

  function same(a, b) {
    return !!a && !!b &&
      a.from.x === b.from.x && a.from.y === b.from.y &&
      a.to.x === b.to.x && a.to.y === b.to.y;
  }

  /** 与 from/to 匹配 (用于把用户输入映射到生成器产出的完整 Move) */
  function matchesCoord(m, fx, fy, tx, ty) {
    return m.from.x === fx && m.from.y === fy && m.to.x === tx && m.to.y === ty;
  }

  /** ICCS 风格坐标: 列 a-i, 行 10-1 (黑底=10, 红底=1) */
  function sqName(p) { return String.fromCharCode(97 + p.x) + (10 - p.y); }
  function parseSq(s) {
    if (typeof s !== 'string') return null;
    var m = s.trim().match(/^([a-i])[\s,.-]?([0-9]|10)$/i);
    if (!m) return null;
    return { x: m[1].toLowerCase().charCodeAt(0) - 97, y: 10 - parseInt(m[2], 10) };
  }

  XQ.Move = {
    create: create, clone: clone, same: same, matchesCoord: matchesCoord,
    sqName: sqName, parseSq: parseSq,
    name: function (m) { return sqName(m.from) + '-' + sqName(m.to); }
  };
})(typeof window !== 'undefined' ? window : globalThis);
