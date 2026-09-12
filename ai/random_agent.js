/* ai/random_agent.js — 均匀随机合法着法 (基准对手 / 引擎压测) */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};

  function create(opts) {
    opts = opts || {};
    var side = opts.side || 'red';
    var rng = typeof opts.rng === 'function' ? opts.rng : Math.random;   // 第28轮: 可注入随机源 (测试/对局复现)
    var lastInfo = null;
    return {
      name: opts.name || 'RandomAI',
      side: side,
      kind: 'random',
      /** @returns {{from:{x,y}, to:{x,y}}} 合法着法 */
      next: function (engine) {
        var moves = engine.generateLegalMoves(side);
        if (!moves.length) throw new Error('no legal moves for ' + side);
        var m = moves[(rng() * moves.length) | 0];
        lastInfo = { from: { x: m.from.x, y: m.from.y }, to: { x: m.to.x, y: m.to.y } };
        return lastInfo;
      },
      usage: function () { return null; }
    };
  }

  XQ.RandomAgent = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
