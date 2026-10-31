#!/usr/bin/env node
/* test/test_elo_trend.js — Elo 趋势重放纯函数守护 (第92轮)
 * 断言:
 *  T1 空输入 → games 0 / series 空
 *  T2 非数组输入不炸
 *  T3 A 胜 B: A 升 B 降, 且数值与 Elo.update 逐位一致 (重放 = 结算同口径)
 *  T4 和局 (winner null): 对称起点下评分不动
 *  T5 人类参与局跳过 (结算同口径: 人类成绩不入表)
 *  T6 未完局 (winner null 且 kind llm 时是和局 — 用 result 存在但 winner 为 null 的合法和局与「未完局」区分:
 *     未完局由 Record.finish 保证 winner 字段存在 — 这里用 winner 缺失 (undefined) 模拟未写完的记录)
 *  T7 同名镜像局: 同名序列每局推进两点, games 计 1
 *  T8 时序: 第二局基于第一局后的评分续算 (与手工 fold 一致)
 *  T9 输入数组不被变异 (纯函数)
 *  T10 坏记录 (缺 red/black/winner 非字符串) 跳过不炸
 * 用法: node test/test_elo_trend.js
 */
'use strict';
var path = require('path');
var ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'benchmark', 'elo.js'));
var ELO = globalThis.XQ.Elo;

var fails = [];
function ok(cond, msg) {
  if (cond) { console.log('  [PASS] ' + msg); }
  else { console.log('  [FAIL] ' + msg); fails.push(msg); }
}
function rec(nameR, nameB, winner, kindR, kindB, date, result) {
  return {
    date: date || '2026-10-31T00:00:0' + (rec._i = (rec._i || 0) + 1) + 'Z',
    red: { name: nameR, kind: kindR || 'llm' },
    black: { name: nameB, kind: kindB || 'llm' },
    result: result == null ? 'checkmate' : result,   // 已终局记录 result 为字符串; 和局 = result 存在 + winner null
    winner: winner
  };
}

// T1 空输入
var t1 = ELO.trendFromRecords([]);
ok(t1.games === 0 && Object.keys(t1.series).length === 0, 'T1 空输入 → games 0 / series 空');

// T2 非数组输入不炸
var t2 = ELO.trendFromRecords(undefined);
ok(t2 && t2.games === 0, 'T2 非数组输入不炸 (undefined → games 0)');

// T3 A 胜 B 与 Elo.update 逐位一致
var t3 = ELO.trendFromRecords([rec('Alpha', 'Beta', 'red')]);
var expect = ELO.update({ ra: 1500, rb: 1500, scoreA: 1 });
ok(t3.series.Alpha && t3.series.Alpha.length === 1 && t3.series.Alpha[0] === expect.ra,
  'T3a A 序列终值 = update().ra (' + t3.series.Alpha[0] + ' vs ' + expect.ra + ')');
ok(t3.series.Beta && t3.series.Beta[0] === expect.rb, 'T3b B 序列终值 = update().rb');
ok(t3.games === 1, 'T3c games = 1');
ok(expect.ra > 1500 && expect.rb < 1500, 'T3d 胜方升 / 负方降 (方向正确)');

// T4 和局不动 (对称起点)
var t4 = ELO.trendFromRecords([rec('Alpha', 'Beta', null)]);
ok(t4.series.Alpha[0] === 1500 && t4.series.Beta[0] === 1500, 'T4 对称起点和局评分不动');

// T5 人类参与局跳过
var t5 = ELO.trendFromRecords([rec('Alpha', 'Human', 'red', 'llm', 'human')]);
ok(!t5.series.Alpha && !t5.series.Human && t5.games === 0, 'T5 人类参与局不入序列 (结算同口径)');

// T6 未完局 (result null — Record.blank 初态) 跳过; 已终局和局 (result 存在 + winner null) 计入
var draw = rec('Alpha', 'Beta', null);   // 已终局和局: result 字符串 + winner null
var unfinished = rec('Alpha', 'Beta', null);
unfinished.result = null;                // Record.blank 初态: result/winner 均 null (helper 的默认值需显式抹掉)
var t6 = ELO.trendFromRecords([unfinished, draw]);
ok(t6.games === 1 && t6.series.Alpha.length === 1 && t6.series.Alpha[0] === 1500, 'T6 未完局跳过 / 和局计入且对称不动');

// T7 同名镜像局
var t7 = ELO.trendFromRecords([rec('Mirror', 'Mirror', 'red')]);
ok(t7.games === 1 && t7.series.Mirror.length === 2, 'T7 镜像局: games 1, 同名序列推进两点');

// T8 时序续算 = 手工 fold
var t8 = ELO.trendFromRecords([
  rec('A', 'B', 'red', 'llm', 'llm', '2026-10-30T00:00:00Z'),
  rec('A', 'B', 'black', 'llm', 'llm', '2026-10-31T00:00:00Z')
]);
var after1 = ELO.update({ ra: 1500, rb: 1500, scoreA: 1 });
var after2 = ELO.update({ ra: after1.ra, rb: after1.rb, scoreA: 0 });
ok(t8.series.A.length === 2 && t8.series.A[1] === after2.ra, 'T8a A 第二局基于第一局后的评分续算');
ok(t8.series.B[1] === after2.rb, 'T8b B 同口径');
// 时序颠倒 (旧局后给) 仍按 date 排序 — 构造乱序输入
var t8b = ELO.trendFromRecords([
  rec('A', 'B', 'black', 'llm', 'llm', '2026-10-31T00:00:00Z'),
  rec('A', 'B', 'red', 'llm', 'llm', '2026-10-30T00:00:00Z')
]);
ok(t8b.series.A[1] === after2.ra && t8b.series.B[1] === after2.rb, 'T8c 输入乱序时按 date 重排, 结果一致');

// T9 纯函数: 输入数组不被变异
var input = [rec('A', 'B', 'red')];
var snapshot = JSON.stringify(input);
ELO.trendFromRecords(input);
ok(JSON.stringify(input) === snapshot, 'T9 输入数组不被变异');

// T10 坏记录不炸; 空名经 normalizeName 落 '?' — 与结算 applyResult 对空名的行为一致 (非跳过)
var t10 = ELO.trendFromRecords([null, {}, rec('A', null, 'red'), rec('A', 'B', 'red')]);
ok(t10.games === 2 && t10.series['?'] && t10.series['?'].length === 1,
  'T10 null/空对象跳过, 合法局计 2; 空名按结算同口径落 ?');

console.log(fails.length ? 'elo trend: ' + fails.length + ' FAIL' : 'elo trend: ALL PASS');
process.exit(fails.length ? 1 : 0);
