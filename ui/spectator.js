/* ui/spectator.js — 观战局面估计, 只用于展示, 不参与落子、提示或棋谱。
 * 百分比是静态评分的未校准启发式映射, 不是模型 confidence 或真实统计胜率。
 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var cache = typeof WeakMap === 'function' ? new WeakMap() : null;

  function value(red, black, score, status) {
    var result = { red: red, black: black, score: score, status: status };
    return typeof Object.freeze === 'function' ? Object.freeze(result) : result;
  }
  var unavailable = value(null, null, null, 'unavailable');

  // snapshot 必须是该 engine 当前快照; renderer 可传已取得的快照避免额外读取。
  function estimate(engine, snapshot) {
    try {
      if (!engine || typeof engine.result !== 'function') return unavailable;
      var result = engine.result();
      if (!result || typeof result.over !== 'boolean') return unavailable;
      // 真实终局优先于评分与缓存, 和棋单独标记, 不能呈现为双方各有一半胜率。
      if (result.over) {
        if (result.winner === 'red') return value(100, 0, null, 'red-win');
        if (result.winner === 'black') return value(0, 100, null, 'black-win');
        if (result.winner == null) return value(50, 50, null, 'draw');
        return unavailable;
      }
      var snap = snapshot === undefined ? engine.snapshot() : snapshot;
      if (!snap || typeof snap !== 'object') return unavailable;
      if (!XQ.PositionEvaluator || typeof XQ.PositionEvaluator.evaluate !== 'function') return unavailable;
      var bySnapshot = cache && cache.get(engine);
      if (bySnapshot && bySnapshot.has(snap)) return bySnapshot.get(snap);
      // 阶段识别和评价内部也会读取 snapshot, 只读视图让它们复用同一份。
      // 引擎查询方法闭包仍读取原状态, 缓存也始终以原 engine 为键。
      var view = Object.create(engine, { snapshot: { value: function () { return snap; } } });
      var evaluation = XQ.PositionEvaluator.evaluate(view, 'red');
      var score = evaluation && evaluation.score;
      if (typeof score !== 'number' || !isFinite(score)) return unavailable;
      // 用绝对值后镜像取整, 保证正负同分严格对称且双方总和为100。
      // 分母8仅是展示平滑尺度, 未经对局数据拟合或概率校准。
      var delta = Math.round(49 * Math.tanh(Math.abs(score) / 8));
      var red = 50 + (score < 0 ? -delta : delta);
      var out = value(red, 100 - red, score, 'estimate');
      if (cache) {
        if (!bySnapshot) { bySnapshot = new WeakMap(); cache.set(engine, bySnapshot); }
        bySnapshot.set(snap, out);
      }
      return out;
    } catch (err) { return unavailable; }
  }

  XQ.Spectator = { estimate: estimate };
})(typeof window !== 'undefined' ? window : globalThis);
