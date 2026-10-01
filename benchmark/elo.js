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
  function emptyMap() { return Object.create ? Object.create(null) : {}; }
  function emptyTable() { return { kind: 'llm-chess-elo', version: 2, ratings: emptyMap(), stats: emptyMap() }; }
  function isObject(value) { return !!(value && typeof value === 'object' && !Array.isArray(value)); }
  function validRating(value) { return typeof value === 'number' && Number.isFinite(value); }
  function copyStats(value) {
    return { games: count(value.games), win: count(value.win), draw: count(value.draw), loss: count(value.loss) };
  }
  function normalizeTable(value) {
    var t = emptyTable();
    if (!isObject(value)) return t;
    if (value.kind === 'llm-chess-elo' && value.version === 2) {
      if (isObject(value.ratings)) Object.keys(value.ratings).forEach(function (name) {
        if (validRating(value.ratings[name])) t.ratings[name] = value.ratings[name];
      });
      if (isObject(value.stats)) Object.keys(value.stats).forEach(function (name) {
        if (isObject(value.stats[name])) t.stats[name] = copyStats(value.stats[name]);
      });
    } else {
      // 兼容旧扁平表；数值 stats: 键是模型评分，对象 stats: 键才是战绩。
      Object.keys(value).forEach(function (key) {
        if (validRating(value[key])) t.ratings[key] = value[key];
        else if (key.indexOf('stats:') === 0 && isObject(value[key])) t.stats[key.slice(6)] = copyStats(value[key]);
      });
    }
    return t;
  }
  function table() {
    var raw = null;
    try { raw = localStorage.getItem(LS_KEY) || '{}'; } catch (eR) { raw = '{}'; }
    if (_tCache && _tRaw === raw) return _tCache;
    var parsed = null;
    try { parsed = JSON.parse(raw); } catch (e) {}
    _tCache = normalizeTable(parsed);
    _tRaw = raw;
    return _tCache;
  }
  function saveTable(t) {
    try {
      var raw = JSON.stringify(t);
      localStorage.setItem(LS_KEY, raw);
      _tCache = t; _tRaw = raw;
      return true;
    } catch (e) { _tCache = null; _tRaw = null; return false; }
  }
  function ratingOf(name) {
    var t = table();
    return validRating(t.ratings[name]) ? t.ratings[name] : BASE;
  }
  /** 记录一场结果: winner 'red'|'black'|null(和); 第30轮: 附带战绩计数 (局/胜/和/负) */
  function bumpStats(t, name, scoreA) {
    var old = t.stats[name];
    var st = isObject(old) ? copyStats(old) : { games: 0, win: 0, draw: 0, loss: 0 };
    st.games++;
    if (scoreA === 1) st.win++; else if (scoreA === 0.5) st.draw++; else st.loss++;
    t.stats[name] = st;
  }
  function applyResult(redName, blackName, winner, k) {
    var ra = ratingOf(redName), rb = ratingOf(blackName);
    var t = normalizeTable(table());
    // 同一模型自战没有可比较的对手，保持评分与战绩不变。
    if (redName === blackName) {
      t.ratings[redName] = ra;
      saveTable(t);
      return { red: ra, black: rb };
    }
    var scoreA = winner === 'red' ? 1 : winner === 'black' ? 0 : 0.5;
    var next = update({ ra: ra, rb: rb, scoreA: scoreA, k: k });
    t.ratings[redName] = next.ra; t.ratings[blackName] = next.rb;
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
    return Object.keys(t.ratings)
      .map(function (n) {
        var e = { name: n, rating: t.ratings[n], games: 0, win: 0, draw: 0, loss: 0 };
        var st = t.stats[n];
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
  function exportTable() { return normalizeTable(table()); }
  function importTable(value, mode) {
    if (!isObject(value)) throw new Error('Invalid Elo table');
    if (mode != null && mode !== 'merge' && mode !== 'replace') throw new Error('Invalid Elo import mode');
    var incoming = normalizeTable(value);
    var t = mode === 'replace' ? emptyTable() : normalizeTable(table());
    Object.keys(incoming.ratings).forEach(function (name) { t.ratings[name] = incoming.ratings[name]; });
    Object.keys(incoming.stats).forEach(function (name) { t.stats[name] = incoming.stats[name]; });
    if (!saveTable(t)) throw new Error('Elo storage failed');
  }
  function resetAll() { saveTable(emptyTable()); }

  XQ.Elo = {
    BASE: BASE, DEFAULT_K: DEFAULT_K,
    expected: expected, update: update,
    ratingOf: ratingOf, applyResult: applyResult, previewDelta: previewDelta,
    leaderboard: leaderboard, resetAll: resetAll,
    exportTable: exportTable, importTable: importTable
  };
})(typeof window !== 'undefined' ? window : globalThis);
