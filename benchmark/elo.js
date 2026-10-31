/* benchmark/elo.js — Elo 评分 (模型对模型) */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var LS_KEY = 'xq_elo_v1';
  var DEFAULT_K = 32, BASE = 1500;

  function expected(ra, rb) {
    ra = validRating(ra) ? ra : BASE;
    rb = validRating(rb) ? rb : BASE;
    return 1 / (1 + Math.pow(10, (rb - ra) / 400));
  }

  function normalizeName(name) {
    try { name = String(name == null ? '' : name).trim(); } catch (e) { name = ''; }
    return name.slice(0, 160) || '?';
  }
  function normalizeScore(score) {
    var n = Number(score);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.5;
  }
  function normalizeK(k) {
    var n = k == null ? DEFAULT_K : Number(k);
    return Number.isFinite(n) && n >= 0 ? Math.min(1000, n) : DEFAULT_K;
  }

  /** update({ra, rb, scoreA, k}) → {ra, rb}  scoreA: 1赢/0.5和/0输 */
  function update(o) {
    o = o || {};
    var ra = validRating(o.ra) ? o.ra : BASE;
    var rb = validRating(o.rb) ? o.rb : BASE;
    var k = normalizeK(o.k);
    var scoreA = normalizeScore(o.scoreA);
    var ea = expected(ra, rb);
    return {
      ra: Math.round((ra + k * (scoreA - ea)) * 10) / 10,
      rb: Math.round((rb + k * ((1 - scoreA) - (1 - ea))) * 10) / 10
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
    name = normalizeName(name);
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
    redName = normalizeName(redName); blackName = normalizeName(blackName);
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

  /* 第80轮研究查询：不暴露内部表引用，并支持最小样本过滤和稳定分页。 */
  function statsOf(name) {
    name = normalizeName(name);
    var st = table().stats[name];
    return isObject(st) ? copyStats(st) : { games: 0, win: 0, draw: 0, loss: 0 };
  }
  function buildLeaderboard(opts) {
    opts = opts || {};
    var minGames = Number.isFinite(Number(opts.minGames)) ? Math.max(0, Math.floor(Number(opts.minGames))) : 0;
    var prefix = opts.prefix == null ? null : String(opts.prefix).slice(0, 160);
    var rows = Object.keys(table().ratings).map(function (n) {
      var e = { name: n, rating: table().ratings[n], games: 0, win: 0, draw: 0, loss: 0 }, st = table().stats[n];
      if (isObject(st)) { e.games = count(st.games); e.win = count(st.win); e.draw = count(st.draw); e.loss = count(st.loss); }
      return e;
    }).filter(function (e) { return e.games >= minGames && (prefix == null || e.name.indexOf(prefix) === 0); });
    rows.sort(function (a, b) { return (b.rating - a.rating) || (b.games - a.games) || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); });
    var offset = Number.isFinite(Number(opts.offset)) ? Math.max(0, Math.floor(Number(opts.offset))) : 0;
    var limit = Number.isFinite(Number(opts.limit)) ? Math.max(0, Math.floor(Number(opts.limit))) : rows.length;
    return rows.slice(offset, offset + limit).map(function (row) { return { name: row.name, rating: row.rating, games: row.games, win: row.win, draw: row.draw, loss: row.loss }; });
  }
  function leaderboardPage(opts) { return buildLeaderboard(opts); }
  function rankOf(name, opts) {
    name = normalizeName(name);
    var rows = buildLeaderboard(opts), at = rows.findIndex(function (row) { return row.name === name; });
    return at < 0 ? null : (Number(opts && opts.offset) || 0) + at + 1;
  }
  function compare(a, b) {
    var ra = ratingOf(a), rb = ratingOf(b);
    return { a: normalizeName(a), b: normalizeName(b), ratingA: ra, ratingB: rb, delta: Math.round((ra - rb) * 10) / 10, expectedA: expected(ra, rb) };
  }
  var settled = Object.create ? Object.create(null) : {};
  function applyResultOnce(gameId, redName, blackName, winner, k) {
    var key = String(gameId == null ? '' : gameId).trim().slice(0, 160);
    if (!key) return { applied: true, duplicate: false, ratings: applyResult(redName, blackName, winner, k) };
    if (settled['$' + key]) return { applied: false, duplicate: true, ratings: { red: ratingOf(redName), black: ratingOf(blackName) } };
    var ratings = applyResult(redName, blackName, winner, k);
    settled['$' + key] = true;
    return { applied: true, duplicate: false, ratings: ratings };
  }
  function forgetResult(gameId) { delete settled['$' + String(gameId == null ? '' : gameId).trim().slice(0, 160)]; }
  function ratingRange() {
    var rows = buildLeaderboard(), values = rows.map(function (r) { return r.rating; });
    return values.length ? { min: Math.min.apply(Math, values), max: Math.max.apply(Math, values), count: values.length } : { min: null, max: null, count: 0 };
  }

  /* ── 第92轮: 从本地棋谱重放评分轨迹 (纯函数, 不触碰评分表) ──
   * 口径与终局结算一致: 双方 kind 均非 human 才记账 (app.js 终局 Elo 分支同条件), result 缺失跳过;
   * 按棋谱 date 时序重放 update(), 输出每个名字在每局后的评分序列。
   * 诚实边界: 棋谱池有容量裁剪 — 序列终值未必等于当前 ratingOf (只有历史完整时一致), UI 需注明「重放」。 */
  function trendFromRecords(records) {
    var series = {};   // 普通对象: 序列会被 JSON 序列化/跨环境传递
    var games = 0;
    var list = Array.isArray(records) ? records.slice() : [];
    list.sort(function (a, b) {
      var ta = a && typeof a.date === 'string' ? a.date : '';
      var tb = b && typeof b.date === 'string' ? b.date : '';
      return ta < tb ? -1 : ta > tb ? 1 : 0;
    });
    list.forEach(function (rec) {
      if (!rec || !rec.red || !rec.black) return;
      /* 已终局判据 = result 为字符串 (Record.finish 落 'checkmate'|... ); 未完局 result/winner 均为 null —
         和局也是 winner null, 只能靠 result 区分 (测试当场抓到的口径错误) */
      if (typeof rec.result !== 'string') return;
      if (rec.red.kind === 'human' || rec.black.kind === 'human') return;             // 人类参与局不入 Elo 表 (结算同口径)
      var nameR = normalizeName(rec.red.name), nameB = normalizeName(rec.black.name);
      if (!nameR || !nameB) return;
      var scoreR = rec.winner === 'red' ? 1 : rec.winner === 'black' ? 0 : 0.5;      // winner null = 和局
      var sR = series[nameR] || (series[nameR] = []);
      var sB = series[nameB] || (series[nameB] = []);
      var ra = sR.length ? sR[sR.length - 1] : BASE;
      var rb = sB.length ? sB[sB.length - 1] : BASE;
      var out = update({ ra: ra, rb: rb, scoreA: scoreR });
      sR.push(out.ra);
      sB.push(out.rb);
      games++;
    });
    return { series: series, games: games };
  }

  XQ.Elo = {
    BASE: BASE, DEFAULT_K: DEFAULT_K,
    expected: expected, update: update,
    ratingOf: ratingOf, applyResult: applyResult, previewDelta: previewDelta,
    leaderboard: leaderboard, leaderboardPage: leaderboardPage, rankOf: rankOf, compare: compare,
    statsOf: statsOf, ratingRange: ratingRange, applyResultOnce: applyResultOnce, forgetResult: forgetResult,
    resetAll: resetAll, normalizeName: normalizeName, normalizeScore: normalizeScore, normalizeK: normalizeK,
    exportTable: exportTable, importTable: importTable, trendFromRecords: trendFromRecords
  };
})(typeof window !== 'undefined' ? window : globalThis);
