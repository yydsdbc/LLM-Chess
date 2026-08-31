/* 象棋引擎 v1.0 — 胜负判断 (将杀 / 困毙, 中国象棋规则: 困毙判负) */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var Piece = XQ.Piece, Rules = XQ.Rules, Generator = XQ.Generator;

  /** 规则缺口备注 (A2 v3.9): 「长捉」未实现 — 亚洲棋规中长捉 (连续捉同一子/循环捉而不变招) 与长将同属禁着,
   *  判负需逐手追踪每手前后的捉子威胁差 (静态攻击关系变化), 引擎层现仅覆盖长将 (engine.checkStreaksFrom)。
   *  扩展点: 在 engine 重放架构 (XQ.Engine.replayStats) 上加 per-move 捉子标记; 落地时须遵守 ruleEnforce 开关与回放不重判约定。
   *
   * status(b, colorToMove) →
   *   { over:false, result:'normal'|'check', winner:null }
   *   { over:true,  result:'checkmate'|'stalemate', winner:'red'|'black' }
   */
  function status(b, colorToMove) {
    var moves = Generator.generateLegalMoves(b, colorToMove);
    var check = Rules.inCheck(b, colorToMove);
    if (moves.length === 0) {
      return {
        over: true,
        result: check ? 'checkmate' : 'stalemate',
        winner: Piece.opponent(colorToMove) // 将杀与困毙均由对方获胜
      };
    }
    return { over: false, result: check ? 'check' : 'normal', winner: null };
  }

  /** v1.7.9 一步效果标注 (LLM 合法列表 / 回放走法列表共用):
   *  对 opColor 而言, 在盘面 b (已应用该着法) 上:
   *  返回 '杀' (将军且无解=绝杀) | '将' (将军有解) | '困' (未将军但无子可动=困毙判负) | null (普通)
   *  movesPre: 已算好的 opColor 合法着法 (replay.moveRisk 复用, 免二次生成)
   */
  function moveTag(b, opColor, movesPre) {
    var moves = movesPre || Generator.generateLegalMoves(b, opColor);
    var check = Rules.inCheck(b, opColor);
    if (check) return moves.length ? '将' : '杀';
    return moves.length ? null : '困';
  }

  XQ.Judge = { status: status, moveTag: moveTag };
})(typeof window !== 'undefined' ? window : globalThis);
