#!/usr/bin/env node
/* benchmark/cli.js — 命令行跑随机对局 (引擎正确性冒烟 + Elo 演示)
 * 用法:
 *   node benchmark/cli.js [局数] [每局最大回合]
 * 示例: node benchmark/cli.js 10 200
 */
'use strict';
require('../core/piece.js');
require('../core/move.js');
require('../core/board.js');
require('../core/rules.js');
require('../core/generator.js');
require('../core/judge.js');
require('../core/engine.js');
require('../ai/random_agent.js');   // 第36轮关键修复: 首发版起漏 require, XQ.RandomAgent 恒 undefined (真实中继/压测全挂)
require('../benchmark/match.js');
require('../benchmark/record.js');
require('../benchmark/elo.js');

var XQ = globalThis.XQ;

var games = parseInt(process.argv[2] || '5', 10);
var maxPlies = parseInt(process.argv[3] || '200', 10);
var seedM = new RegExp('--seed[= ](\\d+)').exec(process.argv.join(' '));
var seedBase = seedM ? parseInt(seedM[1], 10) : 0;   // 第36轮: --seed=N 可复现随机源
function seedRng(base) {
  if (!base) return Math.random;
  var st = base >>> 0;
  return function () { st = (st * 1664525 + 1013904223) >>> 0; return st / 4294967296; };
}

// Node 下没有 localStorage, 给 record/elo 一个内存垫片
if (typeof localStorage === 'undefined') {
  var mem = {};
  globalThis.localStorage = {
    getItem: function (k) { return mem[k] != null ? mem[k] : null; },
    setItem: function (k, v) { mem[k] = String(v); },
    removeItem: function (k) { delete mem[k]; }
  };
}

var stats = { red: 0, black: 0, draw: 0, errors: 0, totalMoves: 0, illegal: 0 };
var chain = Promise.resolve();
var done = 0;

function oneGame(i) {
  if (process.env.DBG) { var dbgR = seedRng(seedBase + i * 2); console.log('game' + i + ' red-rng:', dbgR(), dbgR(), dbgR()); }
  return XQ.Match.play({
    red: XQ.RandomAgent.create({ side: 'red', name: 'RandomAI#' + (i + 1) + 'R', rng: seedRng(seedBase + i * 2) }),
    black: XQ.RandomAgent.create({ side: 'black', name: 'RandomAI#' + (i + 1) + 'B', rng: seedRng(seedBase + i * 2 + 1) }),
    maxPlies: maxPlies,
    onEvent: function (type, data) {
      if (type === 'illegal') stats.illegal++;
    }
  }).then(function (rec) {
    done++;
    stats.totalMoves += rec.moves.length;
    if (rec.illegal) stats.illegal += 0; // 已计
    if (rec.result === 'error') stats.errors++;
    if (rec.winner === 'red') stats.red++;
    else if (rec.winner === 'black') stats.black++;
    else stats.draw++;
    XQ.Elo.applyResult(rec.red.name, rec.black.name, rec.winner);
    console.log('[' + done + '/' + games + '] ' + XQ.Record.summarize(rec) + '  #' + rec.id);   // v3.9: 一行战绩统一口径 (Record.summarize)
  });
}

console.log('对局 ' + games + ' 场 (RandomAI vs RandomAI, maxPlies=' + maxPlies + ')...');
for (var i = 0; i < games; i++) {
  (function (i) { chain = chain.then(function () { return oneGame(i); }); })(i);
}
chain.then(function () {
  console.log('\n===== 汇总 =====');
  console.log('红胜 ' + stats.red + ' / 黑胜 ' + stats.black + ' / 未分胜负 ' + stats.draw);
  console.log('总手数 ' + stats.totalMoves + ', 非法走法 ' + stats.illegal + ', 异常局 ' + stats.errors);
  console.log('\nElo 榜:');
  XQ.Elo.leaderboard().forEach(function (e) {
    console.log('  ' + e.name + '  ' + e.rating);
  });
  process.exit(stats.illegal > 0 ? 1 : 0);
}).catch(function (e) {
  console.error('FATAL:', e);
  process.exit(1);
});
