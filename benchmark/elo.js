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
    var k = o.k || DEFAULT_K;
    var ea = expected(o.ra, o.rb);
    return {
      ra: Math.round((o.ra + k * (o.scoreA - ea)) * 10) / 10,
      rb: Math.round((o.rb + k * ((1 - o.scoreA) - (1 - ea))) * 10) / 10
    };
  }

  /* ── 评分表存取 (按 agent 名) ── */
  function table() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '{}'); } catch (e) { return {}; }
  }
  function saveTable(t) {
    try { localStorage.setItem(LS_KEY, JSON.stringify(t)); } catch (e) {}
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
  /** 记录一场结果: winner 'red'|'black'|null(和) */
  function applyResult(redName, blackName, winner, k) {
    ensure(redName); ensure(blackName);
    var ra = ratingOf(redName), rb = ratingOf(blackName);
    var scoreA = winner === 'red' ? 1 : winner === 'black' ? 0 : 0.5;
    var next = update({ ra: ra, rb: rb, scoreA: scoreA, k: k });
    var t = table();
    t[redName] = next.ra; t[blackName] = next.rb;
    saveTable(t);
    return { red: next.ra, black: next.rb };
  }
  function leaderboard() {
    var t = table();
    return Object.keys(t).map(function (n) { return { name: n, rating: t[n] }; })
      .sort(function (a, b) { return b.rating - a.rating; });
  }
  function resetAll() { saveTable({}); }

  XQ.Elo = {
    BASE: BASE, DEFAULT_K: DEFAULT_K,
    expected: expected, update: update,
    ratingOf: ratingOf, applyResult: applyResult,
    leaderboard: leaderboard, resetAll: resetAll
  };
})(typeof window !== 'undefined' ? window : globalThis);
