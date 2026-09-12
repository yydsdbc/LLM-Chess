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
          /* 第32轮: 每选民流式思考写入各自缓冲, 合并带选民标签后推面板 (council 多路并行可见; rotate 单路直通) */
          onThinking: mode === 'council'
            ? function (s2, text) {
                streams[idx] = text || '';
                if (opts.onThinking) {
                  opts.onThinking(side, agents.map(function (a2, j2) {
                    return '【' + a2.name + '】' + (streams[j2] != null && streams[j2] !== '' ? streams[j2] : '…');
                  }).join('\n\n'));
                }
              }
            : (idx === 0 ? opts.onThinking : null),
          onRetry: opts.onRetry, signal: opts.signal
        })
      };
    });
    var rotation = 0;
    var streams = [];     // 第32轮: 会诊并行流式思考缓冲 (每次 next() 重置)
    var errStreak = {};   // 第31轮: 连续失败计数 (rotate 模式连续 2 失败的选民本轮跳过, 成功即清零)

    function usage() {
      var u = { total: 0, prompt: 0, cacheHit: 0, blocked: 0, attempts: 0, perVoter: [] };
      agents.forEach(function (a) {
        var x = a.agent.usage && a.agent.usage();
        var tot = x ? (x.total || 0) : 0;
        u.total += tot; u.prompt += x ? (x.prompt || 0) : 0; u.cacheHit += x ? (x.cacheHit || 0) : 0;
        u.blocked += x ? (x.blocked || 0) : 0; u.attempts += x ? (x.attempts || 0) : 0;
        u.perVoter.push({ name: a.name.split(':').pop(), total: tot });   // 第32轮: 逐选民 token 分解 (模型卡展示)
      });
      return u;
    }

    function confOf(mv) { return (mv.meta && typeof mv.meta.confidence === 'number') ? mv.meta.confidence : 0.5; }

    function next(engine, history) {
      streams = [];   // 第32轮: 每手重置流缓冲
      if (mode === 'rotate') {
        var pick = null;
        for (var tries = 0; tries < agents.length; tries++) {
          var cand = agents[rotation % agents.length];
          rotation++;
          if ((errStreak[cand.name] || 0) < 2) { pick = cand; break; }   // 第31轮: 连续 2 失败的选民跳过 (全体跳过则回退原轮换)
        }
        if (!pick) pick = agents[rotation % agents.length];
        return pick.agent.next(engine, history).then(function (mv) {
          errStreak[pick.name] = 0;
          mv.meta = mv.meta || {};
          mv.meta.voterName = pick.name;   // 第32轮: 轮换选民 (决策卡 ✦ 标)
          mv.meta.reasoning = '[轮换 ' + pick.name + '] ' + (mv.meta.reasoning || '');
          return mv;
        }).catch(function (e) {
          errStreak[pick.name] = (errStreak[pick.name] || 0) + 1;
          throw e;
        });
      }
      // council: 并行作答 (错峰发车) → 落点投票; 选民预算超时按弃权 (第30轮, opts.voterBudgetMs 默认 60s)
      var budget = typeof opts.voterBudgetMs === 'number' ? opts.voterBudgetMs : 60000;
      var answered = 0;
      var votes = [];   // 第31轮: 结构化投票明细 [{model, from, to, conf, ms, ok|fail}]
      var t0 = Date.now();
      var vstate = agents.map(function () { return 'pending'; });   // 第32轮: 每选民实时状态
      function liveTally() {   // 第32轮: 已应答选民的实时票型
        var t = {};
        votes.forEach(function (v) { if (v.ok) t[v.to] = (t[v.to] || 0) + 1; });
        return t;
      }
      var calls = agents.map(function (a, idx) {
        return new Promise(function (res) {
          var settled = false;
          var done = function (v) {
            if (settled) return;
            settled = true;
            answered++;
            vstate[idx] = v.mv ? 'ok' : 'fail';
            votes.push(v.mv   // 第32轮修正: 即时收集 (原在 Promise.all 后统一收, 进度回调时 tally 恒空)
              ? { model: a.name, from: XQ.Move.sqName(v.mv.from), to: XQ.Move.sqName(v.mv.to), conf: confOf(v.mv), ms: Date.now() - t0, ok: true }
              : { model: a.name, fail: String((v.err && v.err.message) || v.err || 'failed').slice(0, 60), ok: false });
            if (opts.onProgress) {
              try {
                opts.onProgress({
                  answered: answered, total: agents.length, voter: a.name, ok: !!v.mv,
                  voters: agents.map(function (a2, j2) { return { name: a2.name, state: vstate[j2] }; }),
                  tally: liveTally()
                });
              } catch (eP) {}
            }
            res(v);
          };
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
        var winName = best.first.name;
        var winMv = best.first.mv;
        var vetoNote = '';
        // 第31轮: minVotes — 赢家票数不足时回落到信心最高的单一应答
        var minVotes = typeof opts.minVotes === 'number' ? opts.minVotes : 1;
        if (best.votes < minVotes) {
          var top = good[0];
          good.forEach(function (r) { if (confOf(r.mv) > confOf(top.mv)) top = r; });
          if (top.name !== winName) {
            winName = top.name; winMv = top.mv; best = tally[XQ.Move.sqName(winMv.to)];
            vetoNote = ' [minVotes ' + minVotes + ' 未达 → 改最高信心 ' + winName + ']';
          }
        }
        // 第31轮: 安全否决 — 多数票落点静态净损 ≥3 分时改采静态最优选民 (防多数暴走送大子)
        if (opts.safetyCheck !== 'off' && XQ.LLMAgent && XQ.LLMAgent.evalMove2Static) {
          var uniq = {}, order = [];
          good.forEach(function (r) {
            var k2 = XQ.Move.sqName(r.mv.from) + XQ.Move.sqName(r.mv.to);
            if (!uniq[k2]) { uniq[k2] = true; order.push(r); }
          });
          var bestS = null, winS = null, alt = null;
          order.forEach(function (r) {
            var sc = XQ.LLMAgent.evalMove2Static(engine, side, r.mv.from, r.mv.to);
            if (bestS === null || sc > bestS) { bestS = sc; alt = r; }
            if (r.name === winName) winS = sc;
          });
          if (winS != null && bestS != null && bestS - winS >= 3 && alt && alt.name !== winName) {
            winName = alt.name; winMv = alt.mv; best = tally[XQ.Move.sqName(winMv.to)];
            vetoNote = ' [安全否决: 多数落点静态净损 ' + (bestS - winS).toFixed(1) + ' → 改静态最优 ' + winName + ']';
          }
        }
        var mv = winMv;
        mv.meta = mv.meta || {};
        mv.meta.voterName = winName;   // 第32轮: 胜出选民 (决策卡 ✦ 标)
        mv.meta.votes = votes;   // 第31轮: 结构化投票明细 (回放/排障可读)
        mv.meta.candidates = good.map(function (r) {   // 复用决策卡候选位: 全体选民一览 (*=胜出)
          return {
            move: XQ.Move.sqName(r.mv.from) + '-' + XQ.Move.sqName(r.mv.to) + (r.name === winName ? '*' : ''),
            score: confOf(r.mv).toFixed(2)
          };
        });
        var unanimity = good.length > 1 && Object.keys(tally).length === 1;
        var tag = unanimity ? ' [会诊 全票 ' + good.length + ']' : ' [会诊 ' + best.votes + '/' + good.length + ']';
        if (mv.meta.summary) mv.meta.summary = mv.meta.summary + tag;
        else mv.meta.summary = '会诊 ' + best.votes + '/' + good.length + ' 同侪同选 ' + best.sq + tag;
        mv.meta.reasoning = '同侪会诊 ' + good.length + '/' + agents.length + ' 应答: '
          + votes.map(function (v) { return v.ok ? (v.model + '→' + v.to) : (v.model + ' 失败'); }).join(', ')
          + ' (胜出: ' + winName + ')' + vetoNote;
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
