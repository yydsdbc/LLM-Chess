/* 象棋引擎 v1.0 — 棋盘状态 (90格一维数组, 可 clone / apply / undo) */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var Piece = XQ.Piece;

  var W = 9, H = 10, N = W * H;
  function idx(x, y) { return y * W + x; }

  function create() {
    var grid = new Array(N).fill(null);
    Piece.initialLayout().forEach(function (e) {
      grid[idx(e.x, e.y)] = e.piece;
    });
    return makeFromGrid(grid);
  }

  function makeFromGrid(grid) {
    var b = {
      W: W, H: H, grid: grid,
      inside: function (x, y) { return x >= 0 && x < W && y >= 0 && y < H; },
      get: function (x, y) { return this.inside(x, y) ? grid[idx(x, y)] : undefined; },
      set: function (x, y, p) { grid[idx(x, y)] = p; },
      idx: idx,

      /** 应用走法, 返回被吃子(可为null) */
      applyMove: function (m) {
        var cap = grid[idx(m.to.x, m.to.y)];
        grid[idx(m.to.x, m.to.y)] = m.piece;
        grid[idx(m.from.x, m.from.y)] = null;
        m.captured = cap || null;
        return m.captured;
      },
      /** 撤销走法 (按 Move 内记录的 captured 还原) */
      undoMove: function (m) {
        grid[idx(m.from.x, m.from.y)] = m.piece;
        grid[idx(m.to.x, m.to.y)] = m.captured || null;
      },
      /** 浅拷贝棋盘: 棋子为不可变值对象, 共享引用安全 */
      clone: function () { return makeFromGrid(grid.slice()); },

      kingPos: function (color) {
        for (var i = 0; i < N; i++) {
          var p = grid[i];
          if (p && p.color === color && p.type === 'king') return { x: i % W, y: (i / W) | 0 };
        }
        return null;
      },

      /** 文本棋盘 (供 LLM / 调试) */
      toText: function () {
        var rows = [];
        for (var y = 0; y < H; y++) {
          var cells = [];
          for (var x = 0; x < W; x++) cells.push(grid[idx(x, y)] ? Piece.char(grid[idx(x, y)]) : '．');
          rows.push((10 - y) + ' ' + cells.join(' '));
        }
        rows.push('  a b c d e f g h i');
        return rows.join('\n');
      },
      pieceCount: function () {
        var n = 0; for (var i = 0; i < N; i++) if (grid[i]) n++;
        return n;
      },
      /** 全量一致性比较 (测试用) */
      equals: function (other) {
        for (var i = 0; i < N; i++) {
          if (!Piece.same(grid[i], other.grid[i])) return false;
        }
        return true;
      }
    };
    return b;
  }

  XQ.Board = { create: create, makeFromGrid: makeFromGrid, W: W, H: H, idx: idx };
})(typeof window !== 'undefined' ? window : globalThis);
