/* replay/replay.js — 回放数据层 (v1.6)
   读取已保存棋谱 (localStorage XQ.Record / 导入 JSON / logs/*.json), 纯历史数据重驱动棋盘, 不调用 LLM。
   浏览器与 node 通用 (match_headless 冒烟测试用)。 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};

  /* 棋谱摘要 (列表选择用) */
  function summarize(rec) {
    var d = rec.date ? new Date(rec.date) : new Date();
    var pad = function (n) { return ('0' + n).slice(-2); };
    return {
      id: rec.id || ('r' + d.getTime()),
      stamp: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()),
      red: (rec.red && rec.red.name) || '红方',
      black: (rec.black && rec.black.name) || '黑方',
      redModel: (rec.red && rec.red.model) || null,
      blackModel: (rec.black && rec.black.model) || null,
      plies: (rec.moves && rec.moves.length) || 0,
      result: rec.result || null,
      winner: rec.winner || null,
      durationMs: rec.durationMs || 0
    };
  }

  /* localStorage 已存棋谱 (新→旧) */
  function listLocal() {
    var all;
    try { all = (XQ.Record && XQ.Record.list()) || []; } catch (e) { all = []; }
    return all.slice().sort(function (a, b) {
      return new Date(b.date).getTime() - new Date(a.date).getTime();
    }).map(summarize);
  }

/* 疑误着法静态检测 (v1.7.6): 一层静态交换 — 风险 = 最坏反吃净损 - 吃子价值; ≥3 (马级) 标注 ⚠
   兜住实战复现过的两类瞎走: 大子走进火力圈 / 炮吃有保护的兵卒被反吃。纯静态, 不影响回放驱动 */
var RISK_VALS = { rook: 9, cannon: 4.5, knight: 4, advisor: 2, bishop: 2, king: 100, pawn: 1 };
var RISK_MARK = 3;
function moveRisk(eng, f, t, markBag, ply) {
  try {
    var side = eng.turn();
    var tgt = eng.pieceAt(t.x, t.y);
    var capturedVal = (tgt && tgt.color !== side) ? (RISK_VALS[tgt.type] || 0) : 0;
    var b2 = eng.cloneBoard();
    var legal = XQ.Generator.generateLegalMoves(b2, side);
    var picked = null;
    for (var i = 0; i < legal.length; i++) {
      var q = legal[i];
      if (q.from.x === f.x && q.from.y === f.y && q.to.x === t.x && q.to.y === t.y) { picked = q; break; }
    }
    if (!picked) return 0;   // 非法/被跳过的手不标注
    b2.applyMove(picked);
    var op = side === 'red' ? 'black' : 'red';
    var recaps = XQ.Generator.generateLegalMoves(b2, side);   // 我方吃回对方进攻子的选项 (与 reply 同盘面)
    var replies = XQ.Generator.generateLegalMoves(b2, op);
    // v1.7.9 将/杀/困标注: 复用本函数已算好的 replies (Judge.moveTag 免二次生成)
    if (markBag && ply) {
      var tg = XQ.Judge.moveTag(b2, op, replies);
      if (tg) markBag[ply] = tg;
    }
    var worst = 0;
    for (var k = 0; k < replies.length; k++) {
      var rp = replies[k];
      if (!(rp.captured && rp.to.x === t.x && rp.to.y === t.y)) continue;
      var loss = RISK_VALS[rp.captured.type] || 0;   // 我方刚落到 t 的子被吃
      var gain = 0;
      for (var q3 = 0; q3 < recaps.length; q3++) {
        if (recaps[q3].captured && recaps[q3].to.x === rp.to.x && recaps[q3].to.y === rp.to.y) {
          gain = Math.max(gain, RISK_VALS[recaps[q3].captured.type] || 0);
        }
      }
      worst = Math.max(worst, loss - gain);
    }
    return worst - capturedVal;   // >0 = 这手静态净丢子
  } catch (e) { return 0; }
}

/* v3.9 评值文本解析 (原 ui/app.js rpParseEval 内联逻辑迁移至此 — node 可测 + 方向判定修复):
   带符号数字直接采用; 无符号数字只在文案含明确胜负词 (优/胜/劣/败) 且恰指明一方时定方向 —
   只含子力词 (红丢一炮/黑车被吃/黑多兵) 无胜负词时不动方向 (丢/被吃/弃语境反号曾误判);
   和势文案的数字无方向意义归 0; 纯文字兜底走 胜负词/和势 表 (v1.6.4 行为不变) */
function parseEval(s) {
  if (!s) return NaN;
  var m = /([+-]?\d+(?:\.\d+)?)/.exec(s);
  if (m) {
    var v = parseFloat(m[1]);
    if (v !== 0 && !/^[+-]/.test(m[1])) {
      var sideWord = /红/.test(s) !== /黑/.test(s);   // 恰指明一方
      var goodW = /优|胜/.test(s), badW = /劣|败/.test(s);
      if (sideWord && (goodW !== badW)) {
        var redGood = goodW;   // 优/胜 = 点名方占优; 劣/败 = 点名方处劣势
        if (/红/.test(s) ? redGood : !redGood) v = Math.abs(v);
        else v = -Math.abs(v);
      } else if (!goodW && !badW && /和棋|和势|和局|均势|平衡/.test(s)) {
        return 0;
      }
    }
    return v;
  }
  if (/红.*(大优|胜势)/.test(s)) return 3;
  if (/黑.*(大优|胜势)/.test(s)) return -3;
  if (/红/.test(s) && /优/.test(s)) return 1.5;
  if (/黑/.test(s) && /优/.test(s)) return -1.5;
  if (/均势|和势|平衡|和棋/.test(s)) return 0;
  return NaN;
}

/* 会话: record → 可导航的引擎重建器
     idx = 当前指针 (0=初始局面, n=已走 n 手); entry = moves[idx-1] 即刚走那手的 meta */
  function create(record) {
    var moves = (record && record.moves) || [];
    var eng = XQ.Engine.create({ ruleEnforce: false });   // v2.2: 回放忠实重放旧谱 (旧谱可能含 3 次重复/6 连将未终局, 规则开启会提前误终局)
    var idx = 0;
    var skipped = {};   // {手号: 拒绝原因} — 脏数据容错 (尽力重放, 与"载入棋谱"行为一致)
    var risks = {};     // {手号: 静态风险分} — v1.7.6 疑误着法标注
    var marks = {};     // {手号: '将'|'杀'|'困'} — v1.7.9 一步效果标注

    function rebuild(n) {
      eng = XQ.Engine.create({ ruleEnforce: false });   // v2.2: 同上, 重建也关规则强制
      skipped = {};
      risks = {};
      marks = {};
      for (var i = 0; i < n; i++) {
        var m = moves[i];
        if (!m || !m.from || !m.to) { skipped[i + 1] = 'missing_coord'; continue; }
        var f = XQ.Move.parseSq(m.from), t = XQ.Move.parseSq(m.to);
        risks[i + 1] = moveRisk(eng, f, t, marks, i + 1);
        var res = eng.applyPlayerMove(f.x, f.y, t.x, t.y);
        if (!res.ok) skipped[i + 1] = res.reason || 'illegal';
      }
    }

    function next() {
      if (idx >= moves.length) return false;
      var m = moves[idx];
      var res = { ok: false, reason: 'missing_coord' };
      if (m && m.from && m.to) {
        var f = XQ.Move.parseSq(m.from), t = XQ.Move.parseSq(m.to);
        risks[idx + 1] = moveRisk(eng, f, t, marks, idx + 1);
        res = eng.applyPlayerMove(f.x, f.y, t.x, t.y);
      }
      idx++;
      if (!res.ok) skipped[idx] = res.reason || 'illegal';
      return true;
    }

    function state() {
      var snap = eng.snapshot();
      return {
        idx: idx,
        total: moves.length,
        entry: idx > 0 ? moves[idx - 1] : null,
        cells: snap.cells,
        turn: snap.turn,
        over: snap.over,
        result: snap.result,
        winner: snap.winner,
        lastMove: snap.lastMove,
        risk: risks[idx] || 0,   // v1.7.6: 当前手静态风险分 (≥3 疑似失着)
        mark: marks[idx] || null,   // v1.7.9: 当前手效果标注 ('将'|'杀'|'困'|null)
        check: !snap.over && eng.inCheck(snap.turn),
        skippedCount: Object.keys(skipped).length
      };
    }

    return {
      record: record,
      summary: summarize(record),
      total: function () { return moves.length; },
      idx: function () { return idx; },
      engine: function () { return eng; },
      entry: function () { return idx > 0 ? moves[idx - 1] : null; },
      skipped: function () { return skipped; },
      risks: function () { return risks; },   // v1.7.6: {手号: 风险分} 供走法列表标注
      marks: function () { return marks; },   // v1.7.9: {手号: '将'|'杀'|'困'} 供走法列表标注
      RISK_MARK: function () { return RISK_MARK; },
      next: next,
      prev: function () { if (idx <= 0) return false; idx--; rebuild(idx); return true; },
      goto: function (n) {
        n = Math.max(0, Math.min(moves.length, n | 0));
        if (n === idx + 1) { next(); return true; }   // 相邻快路径
        if (n === idx) return false;
        idx = n;
        rebuild(idx);
        return true;
      },
      state: state
    };
  }

  XQ.Replay = { listLocal: listLocal, summarize: summarize, parseEval: parseEval, create: create, moveRisk: moveRisk, RISK_VALS: RISK_VALS, RISK_MARK: RISK_MARK };
})(typeof window !== 'undefined' ? window : globalThis);
