/* evaluation/xiangqi_knowledge.js — 中国象棋阶段性知识库
 * 职责: 棋局阶段判断 (开局/中局/残局) + 动态子力价值 + 评价原则文案
 * 依据: 回合数 / 棋盘剩余棋子数 / 大子交换情况
 * 纯函数 + 无状态, 浏览器与 node 双端可用 (挂 XQ.XiangqiKnowledge)
 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};

  // ── 基础子力价值 (用户规格) ──
  var BASE = { rook: 900, knight: 400, cannon: 450, bishop: 200, advisor: 200, pawn: 100, king: 0 };

  // ── 阶段乘数 (专家知识: 子力价值随阶段动态变化) ──
  // 开局: 车最高优先(快速出动/开放线), 炮中路控制, 马需好位置, 相仕防守不轻动
  // 中局: 车保持最高攻击价值, 马评价提高(中心/跳跃/配合), 炮看炮架
  // 残局: 马价值提升(机动性/攻兵), 炮价值下降(缺炮架), 相仕提升(护帅), 过河兵增值
  var MULT = {
    opening:    { rook: 1.10, knight: 0.90, cannon: 1.00, bishop: 0.90, advisor: 0.90, pawn: 1.00 },
    middlegame: { rook: 1.10, knight: 1.05, cannon: 1.00, bishop: 0.90, advisor: 0.90, pawn: 1.00 },
    endgame:    { rook: 1.00, knight: 1.25, cannon: 0.85, bishop: 1.20, advisor: 1.20, pawn: 1.30 }
  };

  var PHASE_CN = { opening: '开局', middlegame: '中局', endgame: '残局' };

  // ── 棋局阶段判断 ──
  // 三信号: 已走回合数 / 剩余棋子数 / 大子交换 (大子=车马炮, 双方初始共12)
  function detectPhase(engine) {
    var ply = engine.ply();
    var round = Math.ceil(ply / 2);
    var snap = engine.snapshot();
    var big = 0, pieces = 0;
    for (var y = 0; y < 10; y++) {
      for (var x = 0; x < 9; x++) {
        var p = snap.cells[y][x];
        if (!p || p.type === 'king') continue;
        pieces++;
        if (p.type === 'rook' || p.type === 'knight' || p.type === 'cannon') big++;
      }
    }
    if (round <= 8 && big >= 10) return 'opening';        // 早期且大子基本未交换
    if (big <= 4 || pieces <= 14) return 'endgame';       // 大子枯竭或子力大减
    return 'middlegame';
  }

  // ── 动态子力价值 ──
  // opts.crossedRiver: 兵过河增值 (残局兵线优势的核心)
  // opts.lastRank: 兵/卒到底线贬值 (v2.3 — 底线兵只剩横移, "老兵"攻击力大减)
  // opts.deepPalace: 兵/卒已逼入对方九宫区域且非底线 (v3.8 — 威胁九宫, 配合大子可成杀, 兵线冲击最强点)
  function pieceValue(type, phase, opts) {
    var b = BASE[type] || 0;
    if (!b) return 0;
    var ph = MULT[phase] ? phase : 'middlegame';
    var v = b * (MULT[ph][type] !== undefined ? MULT[ph][type] : 1);
    if (type === 'pawn' && opts && opts.crossedRiver) v *= 1.5;
    if (type === 'pawn' && opts && opts.lastRank) v *= 0.7;   // v2.3 底线老兵贬值
    if (type === 'pawn' && opts && opts.deepPalace) v *= 1.2;   // v3.8 兵临九宫增值 (与老兵贬值互斥: 调用方只在非底线时传)
    return Math.round(v);
  }

  // ── 评价原则 (注入 LLM system prompt, 非角色扮演 — 专家知识层) ──
  var PRINCIPLES_TEXT = [
    '## 中国象棋评价原则:',
    '棋子价值不是固定的, 需要根据棋局阶段动态判断 (引擎会告诉你当前阶段与局面评分, 直接采用)。',
    '- 开局: 重视快速出子、车炮主动权、阵型安全。',
    '- 中局: 重视攻击机会、子力协调、开放线路。',
    '- 残局: 重视马的机动性、炮的实际作用、士象防守能力。'
  ].join('\n');

  XQ.XiangqiKnowledge = {
    BASE: BASE,
    MULT: MULT,
    PHASE_CN: PHASE_CN,
    detectPhase: detectPhase,
    pieceValue: pieceValue,
    PRINCIPLES_TEXT: PRINCIPLES_TEXT
  };
})(typeof window !== 'undefined' ? window : globalThis);
