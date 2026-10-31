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
    if (!Array.isArray(grid) || grid.length !== N) throw new RangeError('Board: grid must contain exactly 90 cells');
    // 拥有自己的单元格数组和棋子值, 防止调用方改原数组而绕过将帅索引。
    grid = grid.map(Piece.clone);
    var kingCells = { red: [], black: [] };
    function addKing(piece, x, y) {
      if (piece && piece.type === 'king' && (piece.color === 'red' || piece.color === 'black')
        && x >= 0 && x < W && y >= 0 && y < H) kingCells[piece.color].push({ x: x, y: y });
    }
    function removeKing(color, x, y) {
      var cells = kingCells[color];
      if (!cells) return;
      for (var i = 0; i < cells.length; i++) {
        if (cells[i].x === x && cells[i].y === y) { cells.splice(i, 1); return; }
      }
    }
    function addKingAt(piece, at) {
      if (at >= 0 && at < N) addKing(piece, at % W, (at / W) | 0);
    }
    function removeKingAt(color, at) {
      if (at >= 0 && at < N) removeKing(color, at % W, (at / W) | 0);
    }
    for (var k = 0; k < N; k++) addKing(grid[k], k % W, (k / W) | 0);
    var b = {
      W: W, H: H, grid: grid,
      inside: function (x, y) { return x >= 0 && x < W && y >= 0 && y < H; },
      get: function (x, y) { return this.inside(x, y) ? grid[idx(x, y)] : undefined; },
      set: function (x, y, p) {
        if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || x >= W || y < 0 || y >= H) {
          throw new RangeError('Board: coordinate outside board');
        }
        var at = idx(x, y), old = grid[at];
        if (old && old.type === 'king') removeKingAt(old.color, at);
        grid[at] = p;
        addKingAt(p, at);
      },
      idx: idx,

      /** 应用走法, 返回被吃子(可为null) */
      applyMove: function (m) {
        if (!m || !m.from || !m.to || !Number.isInteger(m.from.x) || !Number.isInteger(m.from.y)
          || !Number.isInteger(m.to.x) || !Number.isInteger(m.to.y)
          || !this.inside(m.from.x, m.from.y) || !this.inside(m.to.x, m.to.y)
          || (m.from.x === m.to.x && m.from.y === m.to.y)) throw new TypeError('Board: invalid move coordinates');
        var from = idx(m.from.x, m.from.y), to = idx(m.to.x, m.to.y);
        var cap = grid[to], moving = m.piece, actual = grid[from];
        if (!moving || !actual || !Piece.same(actual, moving)) throw new Error('Board: move source mismatch');
        if (moving && moving.type === 'king') removeKingAt(moving.color, from);
        if (cap && cap.type === 'king') removeKingAt(cap.color, to);
        grid[to] = moving;
        grid[from] = null;
        addKingAt(moving, to);
        m.captured = cap || null;
        return m.captured;
      },
      /** 撤销走法 (按 Move 内记录的 captured 还原) */
      undoMove: function (m) {
        if (!m || !m.from || !m.to || !Number.isInteger(m.from.x) || !Number.isInteger(m.from.y)
          || !Number.isInteger(m.to.x) || !Number.isInteger(m.to.y)
          || !this.inside(m.from.x, m.from.y) || !this.inside(m.to.x, m.to.y)
          || (m.from.x === m.to.x && m.from.y === m.to.y)) throw new TypeError('Board: invalid move coordinates');
        var from = idx(m.from.x, m.from.y), to = idx(m.to.x, m.to.y);
        if (!m.piece || !grid[to] || !Piece.same(grid[to], m.piece)) throw new Error('Board: undo target mismatch');
        if (m.piece && m.piece.type === 'king') removeKingAt(m.piece.color, to);
        grid[from] = m.piece;
        grid[to] = m.captured || null;
        addKingAt(m.piece, from);
        addKingAt(m.captured, to);
      },
      /** 独立复制棋盘及棋子, 搜索盘面的修改不会影响原盘面 */
      clone: function () { return makeFromGrid(grid.map(Piece.clone)); },

      kingPos: function (color) {
        var cells = kingCells[color];
        if (!cells || !cells.length) return null;
        var first = cells[0], firstIdx = idx(first.x, first.y);
        for (var i = 1; i < cells.length; i++) {
          var at = idx(cells[i].x, cells[i].y);
          if (at < firstIdx) { first = cells[i]; firstIdx = at; }
        }
        return { x: first.x, y: first.y };
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
          var a = grid[i], b = other.grid[i];
          if (!a && !b) continue;
          if (!Piece.same(a, b)) return false;
        }
        return true;
      }
    };
    return b;
  }

  XQ.Board = { create: create, makeFromGrid: makeFromGrid, W: W, H: H, idx: idx };
})(typeof window !== 'undefined' ? window : globalThis);
