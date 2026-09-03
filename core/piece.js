/* 象棋引擎 v1.0 — 棋子对象 (纯值对象, 不可变) */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};

  var COLORS = { RED: 'red', BLACK: 'black' };
  var TYPES = {
    KING: 'king', ADVISOR: 'advisor', BISHOP: 'bishop',
    KNIGHT: 'knight', ROOK: 'rook', CANNON: 'cannon', PAWN: 'pawn'
  };
  var CHARS = {
    red:   { king: '帅', advisor: '仕', bishop: '相', knight: '马', rook: '车', cannon: '炮', pawn: '兵' },
    black: { king: '将', advisor: '士', bishop: '象', knight: '马', rook: '车', cannon: '砲', pawn: '卒' }
  };
  // v1.0.daily 西文字母记谱 (国际用户): 红大写/黑小写, 纯显示层 — 中文记谱/HUD/评估不受影响
  var LETTERS = {
    red:   { king: 'K', advisor: 'A', bishop: 'B', knight: 'N', rook: 'R', cannon: 'C', pawn: 'P' },
    black: { king: 'k', advisor: 'a', bishop: 'b', knight: 'n', rook: 'r', cannon: 'c', pawn: 'p' }
  };

  function create(color, type, id) {
    if (color !== COLORS.RED && color !== COLORS.BLACK) throw new Error('Piece: bad color ' + color);
    if (!CHARS[color][type]) throw new Error('Piece: bad type ' + type);
    return { color: color, type: type, id: id || (color + '-' + type) };
  }

  function char(piece) { return CHARS[piece.color][piece.type]; }
  function opponent(color) { return color === COLORS.RED ? COLORS.BLACK : COLORS.RED; }
  function isKing(piece) { return !!piece && piece.type === TYPES.KING; }
  function same(a, b) { return !!a && !!b && a.color === b.color && a.type === b.type && a.id === b.id; }

  XQ.Piece = {
    COLORS: COLORS, TYPES: TYPES, CHARS: CHARS, LETTERS: LETTERS,
    create: create, char: char, opponent: opponent, isKing: isKing, same: same,
    initialLayout: function () {
      // 32子标准开局, id 稳定唯一 (同色同类型按序号)
      var layout = [];
      var back = ['rook', 'knight', 'bishop', 'advisor', 'king', 'advisor', 'bishop', 'knight', 'rook'];
      var counters = {};
      function add(color, type, x, y) {
        var k = color + '-' + type;
        counters[k] = (counters[k] || 0) + 1;
        layout.push({ piece: create(color, type, k + '-' + counters[k]), x: x, y: y });
      }
      var i;
      for (i = 0; i < 9; i++) { add('black', back[i], i, 0); add('red', back[i], i, 9); }
      [1, 7].forEach(function (x) { add('black', 'cannon', x, 2); add('red', 'cannon', x, 7); });
      [0, 2, 4, 6, 8].forEach(function (x) { add('black', 'pawn', x, 3); add('red', 'pawn', x, 6); });
      return layout;
    }
  };
})(typeof window !== 'undefined' ? window : globalThis);
