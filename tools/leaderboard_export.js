#!/usr/bin/env node
/* tools/leaderboard_export.js — 第84轮: 无头对局日志 → 公开天梯数据 leaderboard.json
 * 用法: node tools/leaderboard_export.js [日志文件...] (缺省聚合 logs/match_*.json)
 * 口径: 模型名去掉 (红)/(黑) 后缀聚合; 胜=1 和=0.5 负=0; 得分率 = points/games。
 * 纯函数 aggregate/parseSide 导出供 test_leaderboard.js 直测; CLI 只是薄封装。
 */
'use strict';
const fs = require('fs');
const path = require('path');

/* 解析对局侧名: 'deepseek-v4(红)' → 'deepseek-v4'; 其余原样 (导入局名自定义) */
function parseSide(name) {
  return String(name || '').replace(/\((红|黑)\)\s*$/, '').trim();
}
/* 记录侧字段兼容两种形态: 'A(红)' 字符串 或 {name:'A(红)'} 对象; name 为空时必须**不**回退到对象
   (否则 String(obj) = '[object Object]' 入表 — test_leaderboard 抓过) */
function sideName(v) {
  if (typeof v === 'string') return parseSide(v);
  if (v && typeof v === 'object') return parseSide(v.name);
  return '';
}
/* 单条记录 → 两行的贡献: {model: {games,win,draw,loss,points,illegal,ms}} */
function applyMatch(acc, m) {
  if (!m || typeof m !== 'object') return acc;
  var red = sideName(m.red);
  var black = sideName(m.black);
  if (!red || !black || red === '(红)' || black === '(黑)') return acc;
  var winner = m.winner;
  var ms = (typeof m.durationMs === 'number' && isFinite(m.durationMs) && m.durationMs >= 0) ? m.durationMs : 0;
  var plies = (Array.isArray(m.moves) ? m.moves.length : 0) || 1;
  var illegal = (m.illegal && (m.illegal.red + m.illegal.black) || 0) | 0;
  function bump(name, outcome) {
    if (!acc[name]) acc[name] = { model: name, games: 0, win: 0, draw: 0, loss: 0, points: 0, illegal: 0, ms: 0, plies: 0 };
    var e = acc[name];
    e.games++;
    if (outcome === 'win') { e.win++; e.points += 1; }
    else if (outcome === 'draw') { e.draw++; e.points += 0.5; }
    else e.loss++;
    e.illegal += illegal;
    e.ms += ms;
    e.plies += plies;
  }
  if (winner === 'red') { bump(red, 'win'); bump(black, 'loss'); }
  else if (winner === 'black') { bump(black, 'win'); bump(red, 'loss'); }
  else { bump(red, 'draw'); bump(black, 'draw'); }   // winner null/其他 → 按和局口径 (进行中/异常局不计胜负)
  return acc;
}
/* 文件数组 → 排序后的 leaderboard.json 内容; 坏文件跳过并在 skipped 里报告 */
function aggregate(files) {
  var acc = {}, skipped = [], used = [];
  (files || []).forEach(function (f) {
    try {
      var raw = fs.readFileSync(f, 'utf8');
      var j = JSON.parse(raw);
      var arr = Array.isArray(j) ? j : [j];
      arr.forEach(function (m) { applyMatch(acc, m); });
      used.push(path.basename(f));
    } catch (e) { skipped.push(path.basename(f) + ' (' + (e.message || 'parse error') + ')'); }
  });
  var entries = Object.keys(acc).map(function (k) {
    var e = acc[k];
    return {
      model: e.model, games: e.games, win: e.win, draw: e.draw, loss: e.loss,
      points: Math.round(e.points * 10) / 10,
      scoreRate: e.games ? Math.round(e.points / e.games * 1000) / 1000 : 0,
      illegal: e.illegal,
      avgMsPerMove: e.plies ? Math.round(e.ms / e.plies) : 0
    };
  });
  entries.sort(function (a, b) {
    return (b.points - a.points) || (b.win - a.win) || (a.model < b.model ? -1 : 1);
  });
  return { schema: 1, generatedAt: new Date().toISOString(), source: used, skipped: skipped, entries: entries };
}
function main() {
  var ROOT = path.join(__dirname, '..');
  var files = process.argv.slice(2);
  if (!files.length) {
    try {
      files = fs.readdirSync(path.join(ROOT, 'logs'))
        .filter(function (f) { return /^match_.*\.json$/.test(f); })
        .map(function (f) { return path.join(ROOT, 'logs', f); });
    } catch (e) { files = []; }
  }
  var out = aggregate(files);
  var dest = path.join(ROOT, 'leaderboard.json');
  fs.writeFileSync(dest, JSON.stringify(out, null, 2) + '\n');
  console.log('leaderboard.json ← ' + out.source.length + ' 文件 (' + out.skipped.length + ' 跳过), ' + out.entries.length + ' 个模型');
  out.entries.forEach(function (e, i) {
    console.log('  #' + (i + 1) + ' ' + e.model + '  ' + e.points + '分/' + e.games + '局 (胜' + e.win + ' 和' + e.draw + ' 负' + e.loss + ') 非法' + e.illegal);
  });
}
if (require.main === module) main();
module.exports = { parseSide: parseSide, applyMatch: applyMatch, aggregate: aggregate };
