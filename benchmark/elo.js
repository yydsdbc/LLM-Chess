/* benchmark/elo.js — Elo 评分 (模型对模型) */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var LS_KEY = 'xq_elo_v1';
  var DEFAULT_K = 32, BASE = 1500;

  function expected(ra, rb) {
    return 1 / (1 + Math.pow(10, (rb - ra) / 400));
  }

  /** update({ra, rb, scoreA, k}) → {ra, rb}  scoreA: 1赢/0.5和/0输 */
  function update(o) {
    var k = o.k == null ? DEFAULT_K : o.k;
    var ea = expected(o.ra, o.rb);
    return {
      ra: Math.round((o.ra + k * (o.scoreA - ea)) * 10) / 10,
      rb: Math.round((o.rb + k * ((1 - o.scoreA) - (1 - ea))) * 10) / 10
    };
  }

  /* ── 评分表存取 (按 agent 名) ── */
  var _tCache = null, _tRaw = null;   // 第37轮: 解析缓存 (raw 串校验)
  function emptyTable() { return Object.create ? Object.create(null) : {}; }
  function table() {
    var raw = null;
    try { raw = localStorage.getItem(LS_KEY) || '{}'; } catch (eR) { raw = '{}'; }
    if (_tCache && _tRaw === raw) return _tCache;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) {}
    _tCache = emptyTable();
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      Object.keys(parsed).forEach(function (key) { _tCache[key] = parsed[key]; });
    }
    _tRaw = raw;
    return _tCache;
  }
  function saveTable(t) {
    try {
      var raw = JSON.stringify(t);
      localStorage.setItem(LS_KEY, raw);
      _tCache = t; _tRaw = raw;
    } catch (e) { _tCache = null; _tRaw = null; }
  }
  function ratingOf(name) {
    var t = table();
    return t[name] != null ? t[name] : BASE;
  }
  function ensure(name) {
    var t = table();
    if (t[name] == null) { t[name] = BASE; saveTable(t); }
    return t[name];
  }
  /** 记录一场结果: winner 'red'|'black'|null(和); 第30轮: 附带战绩计数 (局/胜/和/负) */
  function bumpStats(t, name, scoreA) {
    var key = 'stats:' + name;
    var old = t[key];
    var st = old && typeof old === 'object' && !Array.isArray(old) ? {
      games: count(old.games), win: count(old.win), draw: count(old.draw), loss: count(old.loss)
    } : { games: 0, win: 0, draw: 0, loss: 0 };
    st.games++;
    if (scoreA === 1) st.win++; else if (scoreA === 0.5) st.draw++; else st.loss++;
    t[key] = st;
  }
  function applyResult(redName, blackName, winner, k) {
    ensure(redName); ensure(blackName);
    var ra = ratingOf(redName), rb = ratingOf(blackName);
    // 同一模型自战没有可比较的对手，保持评分与战绩不变。
    if (redName === blackName) return { red: ra, black: rb };
    var scoreA = winner === 'red' ? 1 : winner === 'black' ? 0 : 0.5;
    var next = update({ ra: ra, rb: rb, scoreA: scoreA, k: k });
    var t = table();
    t[redName] = next.ra; t[blackName] = next.rb;
    bumpStats(t, redName, scoreA);
    bumpStats(t, blackName, 1 - scoreA);
    saveTable(t);
    return { red: next.ra, black: next.rb };
  }
  /** 第28轮: 预览分数变动 (不落表) — 终局卡展示 ±delta 用; 纯函数 node 可测 */
  function previewDelta(ra, rb, scoreA, k) {
    var next = update({ ra: ra, rb: rb, scoreA: scoreA, k: k });
    return { dra: Math.round((next.ra - ra) * 10) / 10, drb: Math.round((next.rb - rb) * 10) / 10 };
  }
  function count(v) {
    var n = Number(v);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
  }
  function leaderboard() {
    var t = table();
    return Object.keys(t).filter(function (n) { return n.indexOf('stats:') !== 0 && typeof t[n] === 'number' && Number.isFinite(t[n]); })
      .map(function (n) {
        var e = { name: n, rating: t[n], games: 0, win: 0, draw: 0, loss: 0 };
        var st = t['stats:' + n];
        if (st && typeof st === 'object' && !Array.isArray(st)) {
          e.games = count(st.games); e.win = count(st.win); e.draw = count(st.draw); e.loss = count(st.loss);
        }
        return e;
      })
      .sort(function (a, b) {
        var ratingDelta = Number(b.rating) - Number(a.rating);
        if (ratingDelta) return ratingDelta;
        return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
      });
  }
  function resetAll() { saveTable({}); }

  XQ.Elo = {
    BASE: BASE, DEFAULT_K: DEFAULT_K,
    expected: expected, update: update,
    ratingOf: ratingOf, applyResult: applyResult, previewDelta: previewDelta,
    leaderboard: leaderboard, resetAll: resetAll
  };
})(typeof window !== 'undefined' ? window : globalThis);
