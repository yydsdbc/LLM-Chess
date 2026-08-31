/* 象棋引擎 v1.0 — 规则层: 各兵种着法 / 将军 / 照面 (纯函数, 不改状态) */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var Piece = XQ.Piece;

  function inPalace(color, x, y) {
    if (x < 3 || x > 5) return false;
    return color === 'red' ? (y >= 7 && y <= 9) : (y >= 0 && y <= 2);
  }
  function ownHalf(color, y) { return color === 'red' ? y >= 5 : y <= 4; }
  function crossedRiver(color, y) { return color === 'red' ? y <= 4 : y >= 5; }

  function clearPathCount(b, x1, y1, x2, y2) {
    var n = 0, i, step;
    if (x1 === x2) {
      step = y2 > y1 ? 1 : -1;
      for (i = y1 + step; i !== y2; i += step) if (b.get(x1, i)) n++;
    } else if (y1 === y2) {
      step = x2 > x1 ? 1 : -1;
      for (i = x1 + step; i !== x2; i += step) if (b.get(i, y1)) n++;
    }
    return n;
  }

  /** 两王照面 (同列无遮挡) */
  function kingsFacing(b) {
    var rk = b.kingPos('red'), bk = b.kingPos('black');
    if (!rk || !bk || rk.x !== bk.x) return false;
    var y, minY = Math.min(rk.y, bk.y) + 1, maxY = Math.max(rk.y, bk.y) - 1;
    for (y = minY; y <= maxY; y++) if (b.get(rk.x, y)) return false;
    return true;
  }

  /** 单个棋子的伪合法目标 (几何+规则遮挡, 不考虑送将)
   *  forAttack=true: 供攻击检测用, 不排除"吃王"目标 (王所在格也算被攻击) */
  function pseudoMovesFrom(b, x, y, forAttack) {
    var p = b.get(x, y);
    if (!p) return [];
    var out = [], tx, ty, dx, dy, c, i, step, eye, legX, legY;

    function push(txx, tyy) {
      if (!b.inside(txx, tyy)) return;
      var t = b.get(txx, tyy);
      if (t && t.color === p.color) return;
      if (t && t.type === 'king' && p.type !== 'king' && !forAttack) return; // 非王不可吃王 (攻击图模式除外)
      out.push({ x: txx, y: tyy });
    }

    switch (p.type) {
      case 'rook':
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          tx = x + d[0]; ty = y + d[1];
          while (b.inside(tx, ty)) {
            var t = b.get(tx, ty);
            if (!t) { out.push({ x: tx, y: ty }); }
            else { if (t.color !== p.color) out.push({ x: tx, y: ty }); break; }
            tx += d[0]; ty += d[1];
          }
        });
        break;

      case 'knight':
        [[1, 2], [2, 1], [2, -1], [1, -2], [-1, -2], [-2, -1], [-2, 1], [-1, 2]].forEach(function (d) {
          tx = x + d[0]; ty = y + d[1];
          if (!b.inside(tx, ty)) return;
          // 蹩马腿: 沿长轴先走一格
          legX = x + (Math.abs(d[0]) === 2 ? d[0] / 2 : 0);
          legY = y + (Math.abs(d[1]) === 2 ? d[1] / 2 : 0);
          if (b.get(legX, legY)) return;
          push(tx, ty);
        });
        break;

      case 'bishop':
        [[2, 2], [2, -2], [-2, -2], [-2, 2]].forEach(function (d) {
          tx = x + d[0]; ty = y + d[1];
          if (!b.inside(tx, ty)) return;
          if (!ownHalf(p.color, ty)) return;           // 不过河
          eye = b.get(x + d[0] / 2, y + d[1] / 2);
          if (eye) return;                              // 塞象眼
          push(tx, ty);
        });
        break;

      case 'advisor':
        [[1, 1], [1, -1], [-1, -1], [-1, 1]].forEach(function (d) {
          tx = x + d[0]; ty = y + d[1];
          if (!inPalace(p.color, tx, ty)) return;
          push(tx, ty);
        });
        break;

      case 'king':
        // 一步直行 (九宫内)
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          tx = x + d[0]; ty = y + d[1];
          if (!inPalace(p.color, tx, ty)) return;
          push(tx, ty);
        });
        // 飞将: 同列直望对方王且无遮挡 → 可直飞吃王
        tx = x;
        step = p.color === 'red' ? -1 : 1;
        for (ty = y + step; b.inside(tx, ty); ty += step) {
          c = b.get(tx, ty);
          if (c) {
            if (c.color !== p.color && c.type === 'king') out.push({ x: tx, y: ty });
            break;
          }
        }
        break;

      case 'cannon':
        [[1, 0], [-1, 0], [0, 1], [0, -1]].forEach(function (d) {
          tx = x + d[0]; ty = y + d[1];
          var jumped = false;
          while (b.inside(tx, ty)) {
            c = b.get(tx, ty);
            if (!jumped) {
              if (!c) out.push({ x: tx, y: ty });
              else jumped = true;                       // 找到炮架
            } else if (c) {
              if (c.color !== p.color) out.push({ x: tx, y: ty }); // 隔一子吃
              break;
            }
            tx += d[0]; ty += d[1];
          }
        });
        break;

      case 'pawn':
        var fy = p.color === 'red' ? y - 1 : y + 1;
        if (b.inside(x, fy)) push(x, fy);
        if (crossedRiver(p.color, y)) {
          if (b.inside(x - 1, y)) push(x - 1, y);
          if (b.inside(x + 1, y)) push(x + 1, y);
        }
        break;
    }
    return out;
  }

  /** 指定一步是否伪合法 (生成器/校验用) */
  function isPseudoLegal(b, from, to) {
    var targets = pseudoMovesFrom(b, from.x, from.y);
    for (var i = 0; i < targets.length; i++) {
      if (targets[i].x === to.x && targets[i].y === to.y) return true;
    }
    return false;
  }

  /** (x,y) 是否被 byColor 方攻击 (攻击图模式: 王所在格也可为攻击目标) */
  function isSquareAttacked(b, x, y, byColor) {
    for (var yy = 0; yy < b.H; yy++) {
      for (var xx = 0; xx < b.W; xx++) {
        var p = b.get(xx, yy);
        if (!p || p.color !== byColor) continue;
        var ts = pseudoMovesFrom(b, xx, yy, true);
        for (var i = 0; i < ts.length; i++) {
          if (ts[i].x === x && ts[i].y === y) return true;
        }
      }
    }
    return false;
  }

  /** 某方是否被将军 (含照面=飞将攻击) */
  function inCheck(b, color) {
    var kp = b.kingPos(color);
    if (!kp) return true;
    return isSquareAttacked(b, kp.x, kp.y, Piece.opponent(color));
  }

  XQ.Rules = {
    inPalace: inPalace, ownHalf: ownHalf, crossedRiver: crossedRiver,
    clearPathCount: clearPathCount, kingsFacing: kingsFacing,
    pseudoMovesFrom: pseudoMovesFrom, isPseudoLegal: isPseudoLegal,
    isSquareAttacked: isSquareAttacked, inCheck: inCheck
  };
})(typeof window !== 'undefined' ? window : globalThis);
