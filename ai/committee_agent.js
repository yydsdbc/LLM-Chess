/* ai/committee_agent.js — 同方多 LLM 委员会 (第29轮)
 * 模式:
 *   rotate  每手轮换同方的一个 LLM (各自独立会话/前缀缓存)
 *   council 同方所有 LLM 并行作答, 按落点投票决胜; 票数同则比信心和; 并附全体应答清单
 * 选民模型串支持 provider:model (跨厂商混编), 逗号/分号分隔由 app.js 解析后传入 models。
 * 并行选民错峰 300ms 发车 (避 /api/chat 每秒限流窗)。零依赖, 浏览器/Node 双端。
 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};

  function create(opts) {
    opts = opts || {};
    var side = opts.side || 'red';
    var mode = opts.mode === 'rotate' ? 'rotate' : 'council';
    var agents = (opts.models || []).map(function (m, idx) {
      var spec = { provider: opts.provider, model: m };
      var ci = m.indexOf(':');
      if (ci > 0) { spec.provider = m.slice(0, ci); spec.model = m.slice(ci + 1); }
      return {
        name: spec.provider + ':' + spec.model,
        agent: XQ.LLMAgent.create({
          side: side, provider: spec.provider, model: spec.model,
          promptLevel: opts.promptLevel, thinking: opts.thinking,
          onThinking: idx === 0 ? opts.onThinking : null,   // 只转发首选民的流式思考 (多路混流会互相踩)
          onRetry: opts.onRetry, signal: opts.signal
        })
      };
    });
    var rotation = 0;

    function usage() {
      var u = { total: 0, prompt: 0, cacheHit: 0, blocked: 0, attempts: 0 };
      agents.forEach(function (a) {
        var x = a.agent.usage && a.agent.usage();
        if (x) { u.total += x.total || 0; u.prompt += x.prompt || 0; u.cacheHit += x.cacheHit || 0; u.blocked += x.blocked || 0; u.attempts += x.attempts || 0; }
      });
      return u;
    }

    function confOf(mv) { return (mv.meta && typeof mv.meta.confidence === 'number') ? mv.meta.confidence : 0.5; }

    function next(engine, history) {
      if (mode === 'rotate') {
        var pick = agents[rotation % agents.length];
        rotation++;
        return pick.agent.next(engine, history).then(function (mv) {
          mv.meta = mv.meta || {};
          mv.meta.reasoning = '[轮换 ' + pick.name + '] ' + (mv.meta.reasoning || '');
          return mv;
        });
      }
      // council: 并行作答 (错峰发车) → 落点投票; 选民预算超时按弃权 (第30轮, opts.voterBudgetMs 默认 60s)
      var budget = typeof opts.voterBudgetMs === 'number' ? opts.voterBudgetMs : 60000;
      var calls = agents.map(function (a, idx) {
        return new Promise(function (res) {
          var settled = false;
          var done = function (v) { if (!settled) { settled = true; res(v); } };
          setTimeout(function () {
            // 第30轮修正: 预算从选民开始作答起算 (错峰等待不计入)
            if (budget > 0) setTimeout(function () { done({ err: new Error('voter budget ' + budget + 'ms exceeded'), name: a.name, timeout: true }); }, budget);
            a.agent.next(engine, history)
              .then(function (mv) { done({ mv: mv, name: a.name }); })
              .catch(function (err) { done({ err: err, name: a.name }); });
          }, idx * 300);
        });
      });
      return Promise.all(calls).then(function (rs) {
        var good = rs.filter(function (r) { return r.mv; });
        if (!good.length) throw (rs[0] && rs[0].err) || new Error('committee: all voters failed');
        var tally = {};
        good.forEach(function (r) {
          var sq = XQ.Move.sqName(r.mv.to);
          if (!tally[sq]) tally[sq] = { sq: sq, votes: 0, conf: 0, first: r };
          tally[sq].votes++;
          tally[sq].conf += confOf(r.mv);
        });
        var best = null;
        Object.keys(tally).forEach(function (k) {
          var t = tally[k];
          if (!best || t.votes > best.votes || (t.votes === best.votes && t.conf > best.conf)) best = t;
        });
        var win = best.first;
        var mv = win.mv;
        mv.meta = mv.meta || {};
        mv.meta.candidates = good.map(function (r) {   // 复用决策卡候选位: 全体选民一览 (*=胜出)
          return {
            move: XQ.Move.sqName(r.mv.from) + '-' + XQ.Move.sqName(r.mv.to) + (r.name === win.name ? '*' : ''),
            score: confOf(r.mv).toFixed(2)
          };
        });
        if (mv.meta.summary) mv.meta.summary = mv.meta.summary + ' [会诊 ' + best.votes + '/' + good.length + ']';
        else mv.meta.summary = '会诊 ' + best.votes + '/' + good.length + ' 同侪同选 ' + best.sq;
        mv.meta.reasoning = '同侪会诊 ' + good.length + '/' + agents.length + ' 应答: '
          + good.map(function (r) { return r.name + '→' + XQ.Move.sqName(r.mv.to); }).join(', ')
          + ' (胜出: ' + win.name + ')';
        mv.meta.confidence = Math.max(0, Math.min(1, good.reduce(function (s2, r) { return s2 + confOf(r.mv); }, 0) / good.length));
        return mv;
      });
    }

    return {
      name: 'Committee(' + agents.map(function (a) { return a.name; }).join('+') + ')',
      side: side,
      kind: 'llm',
      next: next,
      usage: usage,
      reset: function () { agents.forEach(function (a) { if (a.agent.reset) a.agent.reset(); }); },
      guardCheck: agents.length && agents[0].agent.guardCheck ? agents[0].agent.guardCheck : null
    };
  }

  XQ.CommitteeAgent = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
