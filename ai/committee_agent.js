/* ai/committee_agent.js — 同方多 LLM 委员会 (第50轮整文件重构: 轮换/会诊/圆桌三模式统一管线) */
/* 模式: rotate 轮换 (每手换模型) | council 会诊 (并行盲投) | roundtable 圆桌 (先提案→互看→终判再投票)。 */
/* 通用: Elo 加权票 (weightByElo) / minVotes / 安全否决 / 选民预算与分批并发 / 进度回调 / */
/*       合并流式思考 / 连败跳过 / 全票标记 / meta.votes 明细。零依赖, 浏览器/Node 双端。 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};

  function create(opts) {
    opts = opts || {};
    var side = opts.side || 'red';
    var mode = ['rotate', 'council', 'roundtable'].indexOf(opts.mode) >= 0 ? opts.mode : 'council';
    var agents = (opts.models || []).map(function (m, idx) {
      var spec = { provider: opts.provider, model: m };
      var ci = m.indexOf(':');
      if (ci > 0) { spec.provider = m.slice(0, ci); spec.model = m.slice(ci + 1); }
      return {
        name: spec.provider + ':' + spec.model,
        agent: XQ.LLMAgent.create({
          side: side, provider: spec.provider, model: spec.model,
          promptLevel: opts.promptLevel, thinking: opts.thinking,
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
          onRetry: opts.onRetry, signal: opts.signal,   // 第61轮修复: 传递原始 getter (llm_agent 内每请求重新求值; 委员会不提前执行 — 换局后子代理拿旧已中止信号 → 全拒退化随机)
          jitter: opts.jitter, timeoutMs: opts.timeoutMs, maxTokens: opts.maxTokens, temperature: opts.temperature
        })
      };
    });
    var rotation = 0;
    var errStreak = {};
    var streams = [];

    function weightOf(name) {
      if (!opts.weightByElo || !XQ.Elo || !XQ.Elo.ratingOf) return 1;
      var w = XQ.Elo.ratingOf(name.replace(/^[^:]*:/, '')) / 1500;
      return Math.max(0.6, Math.min(1.4, w));
    }
    function confOf(mv) { return (mv.meta && typeof mv.meta.confidence === 'number') ? mv.meta.confidence : 0.5; }
    function moveKey(mv) { return XQ.Move.sqName(mv.from) + '-' + XQ.Move.sqName(mv.to); }

    function usage() {
      var u = { total: 0, prompt: 0, cacheHit: 0, blocked: 0, attempts: 0, httpCalls: 0, perVoter: [] };
      agents.forEach(function (a) {
        var x = a.agent.usage && a.agent.usage();
        var tot = x ? (x.total || 0) : 0;
        u.total += tot; u.prompt += x ? (x.prompt || 0) : 0; u.cacheHit += x ? (x.cacheHit || 0) : 0;
        u.blocked += x ? (x.blocked || 0) : 0; u.attempts += x ? (x.attempts || 0) : 0; u.httpCalls += x ? (x.httpCalls || 0) : 0;
        u.perVoter.push({ name: a.name.split(':').pop(), total: tot });
      });
      return u;
    }

    /* 统一投票决胜 (council 一轮 / roundtable 终判共用): 权重票 + 信心平票 + minVotes + 安全否决 */
    function finalize(rs, engine) {   // engine: 安全否决的静态评估盘面
      var good = rs.filter(function (r) { return r.mv; });
      var votes = rs.map(function (r) {
        return r.mv
          ? { model: r.name, from: XQ.Move.sqName(r.mv.from), to: XQ.Move.sqName(r.mv.to), conf: confOf(r.mv), ms: r.ms || 0, ok: true, weight: weightOf(r.name), changed: !!r.mv.meta.changed }
          : { model: r.name, fail: String((r.err && r.err.message) || r.err || 'failed').slice(0, 60), ok: false };
      });
      if (!good.length) throw (rs[0] && rs[0].err) || new Error('committee: all voters failed');
      var tally = {};
      good.forEach(function (r) {
        var sq = moveKey(r.mv);   // 第61轮修复: 完整 from-to 作为 key (防同落点不同起点合票)
        if (!tally[sq]) tally[sq] = { sq: sq, votes: 0, weight: 0, conf: 0, first: r };
        tally[sq].votes++;
        tally[sq].weight += weightOf(r.name);
        tally[sq].conf += confOf(r.mv);
      });
      var best = null;
      Object.keys(tally).forEach(function (k) {
        var t = tally[k];
        if (!best || t.weight > best.weight || (t.weight === best.weight && t.conf > best.conf)) best = t;
      });
      var winName = best.first.name;
      var winMv = best.first.mv;
      var vetoNote = '';
      var minVotes = typeof opts.minVotes === 'number' ? opts.minVotes : 1;
      if (best.votes < minVotes) {
        var top = good[0];
        good.forEach(function (r) { if (confOf(r.mv) > confOf(top.mv)) top = r; });
        if (top.name !== winName) { winName = top.name; winMv = top.mv; best = tally[moveKey(winMv)]; vetoNote = ' [minVotes ' + minVotes + ' 未达 → 改最高信心 ' + winName + ']'; }
      }
      if (opts.safetyCheck !== 'off' && XQ.LLMAgent && XQ.LLMAgent.evalMove2Static) {
        var uniq = {}, order = [];
        good.forEach(function (r) {
          var k2 = moveKey(r.mv);
          if (!uniq[k2]) { uniq[k2] = true; order.push(r); }
        });
        var bestS = null, winS = null, alt = null;
        order.forEach(function (r) {
          var sc = XQ.LLMAgent.evalMove2Static(engine, side, r.mv.from, r.mv.to);
          if (bestS === null || sc > bestS) { bestS = sc; alt = r; }
          if (r.name === winName) winS = sc;
        });
        if (winS != null && bestS != null && bestS - winS >= 3 && alt && alt.name !== winName) {
          winName = alt.name; winMv = alt.mv; best = tally[moveKey(winMv)];
          vetoNote = ' [安全否决: 多数落点静态净损 ' + (bestS - winS).toFixed(1) + ' → 改静态最优 ' + winName + ']';
        }
      }
      var unanimity = good.length > 1 && Object.keys(tally).length === 1;
      var mv = winMv;
      mv.meta = mv.meta || {};
      mv.meta.voterName = winName;
      mv.meta.votes = votes;
      mv.meta.unanimity = unanimity;
      mv.meta.committeeMode = mode;
      mv.meta.roundtable = mode === 'roundtable';
      mv.meta.candidates = good.map(function (r) {
        return { move: XQ.Move.sqName(r.mv.from) + '-' + XQ.Move.sqName(r.mv.to) + (r.name === winName ? '*' : ''), score: confOf(r.mv).toFixed(2) };
      });
      var emoji = unanimity ? '🤝' : (best.votes > good.length / 2 ? '✌' : '💥');
      var tag = ' [' + emoji + (mode === 'roundtable' ? ' 圆桌' : ' 会诊') + ' ' + best.votes + '/' + good.length + ']';
      if (mv.meta.summary) mv.meta.summary = mv.meta.summary + tag;
      else mv.meta.summary = '会诊 ' + best.votes + '/' + good.length + ' 同侪同选 ' + best.sq + tag;
      mv.meta.reasoning = '同侪会诊 ' + good.length + '/' + agents.length + ' 应答: '
        + votes.map(function (v) { return v.ok ? (v.model + '→' + v.to) : (v.model + ' 失败'); }).join(', ')
        + ' (胜出: ' + winName + ')' + vetoNote;
      mv.meta.confidence = Math.max(0, Math.min(1, good.reduce(function (s2, r) { return s2 + confOf(r.mv); }, 0) / good.length));
      return mv;
    }

    /* 并行问询 (有界 worker), 每选民预算/进度/流缓冲; note 为圆桌注记 (第二轮传入) */
    function askAll(engine, history, note, phase, eligibleIndexes) {
      var budget = typeof opts.voterBudgetMs === 'number' ? opts.voterBudgetMs : 60000;
      var maxP = typeof opts.maxParallel === 'number' && opts.maxParallel > 0 ? Math.max(1, Math.floor(opts.maxParallel)) : agents.length;
      var eligible = agents.map(function (_, idx) { return !eligibleIndexes || eligibleIndexes.indexOf(idx) >= 0; });
      var activeCount = eligible.filter(Boolean).length;
      var answered = 0;
      var votes = [];
      var t0 = Date.now();
      var vstate = eligible.map(function (isActive) { return isActive ? 'pending' : 'fail'; });
      function liveTally() {
        var t = {};
        votes.forEach(function (v) { if (v.ok) { var k = v.from + '-' + v.to; t[k] = Math.round(((t[k] || 0) + weightOf(v.model)) * 100) / 100; } });
        return t;
      }
      function rawWeightTally() {
        var t = {};
        votes.forEach(function (v) { if (v.ok) { var k = v.from + '-' + v.to; t[k] = (t[k] || 0) + weightOf(v.model); } });
        return t;
      }
      var settleFns = [];
      var fastMajorityFired = false;
      var stopped = false;
      var queue = [];
      var queueAt = 0;
      var active = {};
      var callResolvers = [];
      var settledCalls = [];
      var budgetTimers = [];
      function abortAgent(a) { try { if (a.agent.abort) a.agent.abort(); } catch (eA) {} }
      function pendingWeight() {
        var sum = 0;
        agents.forEach(function (a, idx) { if (vstate[idx] === 'pending') sum += weightOf(a.name); });
        return sum;
      }
      function maybeFastMajority() {
        if (!opts.fastMajority || fastMajorityFired) return;
        var tally = rawWeightTally();
        var keys = Object.keys(tally);
        if (!keys.length) return;
        /* The current leader must stay strictly ahead even if every pending voter backs its strongest rival.
           Strict inequality preserves finalize's confidence tie-break whenever vote weights can tie. */
        var leaderKey = null;
        keys.forEach(function (key) {
          if (leaderKey === null || tally[key] > tally[leaderKey]) leaderKey = key;
        });
        var rivalW = 0;
        keys.forEach(function (key) { if (key !== leaderKey && tally[key] > rivalW) rivalW = tally[key]; });
        if (tally[leaderKey] <= rivalW + pendingWeight() + 1e-9) return;
        fastMajorityFired = true;
        stopped = true;
        agents.forEach(function (a, idx) {
          if (vstate[idx] !== 'pending') return;
          if (active[idx]) abortAgent(a);
          if (settleFns[idx]) settleFns[idx]({ err: new Error('fastMajority'), name: a.name });
        });
      }
      function pump() {
        while (!stopped && Object.keys(active).length < maxP && queueAt < queue.length) {
          var idx = queue[queueAt++];
          active[idx] = true;
          startVoter(idx);
        }
      }
      function settleVoter(idx, v) {
        if (settledCalls[idx]) return;
        settledCalls[idx] = true;
        if (budgetTimers[idx]) clearTimeout(budgetTimers[idx]);
        delete active[idx];
        var a = agents[idx];
        answered++;
        vstate[idx] = v.mv ? 'ok' : 'fail';
        votes.push(v.mv
          ? { model: a.name, from: XQ.Move.sqName(v.mv.from), to: XQ.Move.sqName(v.mv.to), conf: confOf(v.mv), ms: Date.now() - t0, ok: true, weight: weightOf(a.name) }
          : { model: a.name, fail: String((v.err && v.err.message) || v.err || 'failed').slice(0, 60), ok: false });
        if (opts.onProgress) {
          try {
            opts.onProgress({ side: side, answered: answered, total: activeCount, voter: a.name, ok: !!v.mv, phase: phase || null,
              voters: agents.map(function (a2, j2) { return { name: a2.name, state: vstate[j2] }; }), tally: liveTally() });
          } catch (eP) {}
        }
        maybeFastMajority();
        callResolvers[idx]({ mv: v.mv, err: v.err, name: v.name || a.name, index: idx, timeout: !!v.timeout, ms: Date.now() - t0 });
        pump();
      }
      function startVoter(idx) {
        var a = agents[idx];
        if (budget > 0) budgetTimers[idx] = setTimeout(function () {
          abortAgent(a);
          settleFns[idx]({ err: new Error('voter budget ' + budget + 'ms exceeded'), name: a.name, timeout: true });
        }, budget);
        var voterNote;
        try {
          voterNote = typeof note === 'function' ? note(a, idx) : note;
          Promise.resolve(a.agent.next(engine, history, voterNote))
            .then(function (mv) { settleFns[idx]({ mv: mv, name: a.name }); })
            .catch(function (err) { settleFns[idx]({ err: err, name: a.name }); });
        } catch (err) { settleFns[idx]({ err: err, name: a.name }); }
      }
      var calls = agents.map(function (_, idx) {
        if (eligible[idx]) queue.push(idx);
        return new Promise(function (resolve) {
          callResolvers[idx] = resolve;
          settleFns[idx] = function (v) { settleVoter(idx, v); };
          if (!eligible[idx]) { settledCalls[idx] = true; resolve({ err: new Error('round1 failed'), name: agents[idx].name, index: idx }); }
        });
      });
      pump();
      return Promise.all(calls);
    }

    function next(engine, history) {
      streams = [];
      if (mode === 'rotate') {
        var pick = null;
        for (var tries = 0; tries < agents.length; tries++) {
          var cand = agents[rotation % agents.length];
          rotation++;
          if ((errStreak[cand.name] || 0) < 2) { pick = cand; break; }   // 连续 2 失败的选民跳过
        }
        if (!pick) pick = agents[rotation % agents.length];
        return pick.agent.next(engine, history).then(function (mv) {
          errStreak[pick.name] = 0;
          mv.meta = mv.meta || {};
          mv.meta.voterName = pick.name;
          mv.meta.reasoning = '[轮换 ' + pick.name + '] ' + (mv.meta.reasoning || '');
          return mv;
        }).catch(function (e) {
          errStreak[pick.name] = (errStreak[pick.name] || 0) + 1;
          throw e;
        });
      }
      /* council / roundtable 共用问询; roundtable 两阶段 (提案→互看→终判) */
      var master = askAll(engine, history, null, mode === 'roundtable' ? 'proposal' : null);
      if (mode === 'roundtable') {
        master = master.then(function (rs1) {
          var good1 = rs1.filter(function (r) { return r.mv; });
          if (!good1.length) throw (rs1[0] && rs1[0].err) || new Error('committee: all voters failed (round 1)');
          var round1Map = {};   // 第63轮: 记录一轮提案 (改选检测用)
          good1.forEach(function (r) { round1Map[r.index] = moveKey(r.mv); });
          var eligible2 = good1.map(function (r) { return r.index; });
          var calls2 = askAll(engine, history, function (a, idx) {
            if (eligible2.indexOf(idx) < 0) return null;
            var peers = good1.filter(function (r) { return r.name !== a.name; }).map(function (r) {
              return r.name + ' 建议 ' + XQ.Move.sqName(r.mv.from) + '-' + XQ.Move.sqName(r.mv.to) + ((r.mv.meta && r.mv.meta.summary) ? ' (' + r.mv.meta.summary + ')' : '');
            });
            return '## 圆桌讨论: 同侪建议 — ' + (peers.length ? peers.join('; ') : '(无)') + ' — 互看后独立终判: 可坚持原选或改选, 勿盲从多数, 以局面与合法列表为准, 仍需给出完整 JSON。';
          }, 'final', eligible2).then(function (rs2) {
            rs2.forEach(function (r) {
              if (!r.mv) return;
              r.mv.meta = r.mv.meta || {};
              r.mv.meta.voterName = r.name;
              r.mv.meta.reasoning = '[圆桌 ' + r.name + '] ' + (r.mv.meta.reasoning || '');
              r.mv.meta.changed = round1Map[r.index] !== moveKey(r.mv);   // 第63轮: 改选标记 (娱乐性: 看到同侪建议后改变主意)
            });
            return rs2;
          });
          return calls2;
        });
      }
      return master.then(function (rs) { return finalize(rs, engine); });
    }

    return {
      name: 'Committee(' + agents.map(function (a) { return a.name; }).join('+') + ')',
      _mode: mode,   // 第56轮: 暴露模式 (app entry 读)
      side: side, kind: 'llm', next: next, usage: usage,
      reset: function () { rotation = 0; errStreak = {}; streams = []; agents.forEach(function (a) { if (a.agent.reset) a.agent.reset(); }); },
      abort: function () { agents.forEach(function (a) { if (a.agent.abort) a.agent.abort(); }); },
      guardCheck: agents.length && agents[0].agent.guardCheck ? agents[0].agent.guardCheck : null
    };
  }

  XQ.CommitteeAgent = { create: create };
})(typeof window !== 'undefined' ? window : globalThis);
