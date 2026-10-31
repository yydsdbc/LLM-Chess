/* test/test_leaderboard.js — 第84轮: 天梯导出回归
 * 覆盖: parseSide 侧名清洗 / applyMatch 计分口径 (胜1和0.5负0, 双方同记) / 聚合排序 tiebreak /
 *       得分率与均速 / 坏文件跳过报告 / 输出 schema 完整性
 * 运行: node test/test_leaderboard.js
 */
'use strict';
const fs = require('fs');
const path = require('path');
const os = require('os');
const { parseSide, applyMatch, aggregate } = require('./../tools/leaderboard_export.js');

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name); }
}
function match(red, black, winner, extra) {
  return Object.assign({ red: { name: red }, black: { name: black }, winner: winner, moves: new Array(40).fill({}), durationMs: 4000, illegal: { red: 0, black: 0 } }, extra || {});
}

/* ── parseSide ── */
ok(parseSide('glm-5.3-flash(红)') === 'glm-5.3-flash', '(红) 后缀剥离');
ok(parseSide('deepseek-v4(黑) ') === 'deepseek-v4', '(黑) 后缀+尾空白剥离');
ok(parseSide('import-abc') === 'import-abc', '无后缀局名原样');
ok(parseSide('模型(红)(黑)') === '模型(红)', '只剥最末一组后缀 (防御)');

/* ── applyMatch 计分 ── */
var acc = {};
applyMatch(acc, match('A', 'B', 'red'));
applyMatch(acc, match('A', 'B', 'black'));
applyMatch(acc, match('A', 'B', null));
var a = acc['A'], b = acc['B'];
ok(a && b && a.games === 3 && b.games === 3, '三方对局双方各计一场 (共 3 局)');
ok(a.win === 1 && a.draw === 1 && a.loss === 1 && a.points === 1.5, 'A: 1胜1和1负 = 1.5分');
ok(b.points === 1.5, 'B 对称口径同 1.5 分 (胜1和0.5负0)');
ok(a.plies === 120 && a.ms === 12000, '累计手数 120 / 总时长 12000ms (均速在 aggregate 里算)');
applyMatch(acc, match('C', 'D', 'red', { illegal: { red: 2, black: 1 } }));
ok(acc['C'].illegal === 3 && acc['D'].illegal === 3, '非法着法按局双侧同记 (整局口径)');
applyMatch(acc, null); applyMatch(acc, match('', '', 'red'));
ok(Object.keys(acc).length === 4, '空名/畸形记录不计入');

/* ── aggregate: 排序 tiebreak + 坏文件跳过 + schema ── */
var tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lb-'));
fs.writeFileSync(path.join(tmp, 'g1.json'), JSON.stringify([
  match('A', 'B', 'red'),
  match('B', 'A', 'red'),
  match('B', 'A', null)
]));
fs.writeFileSync(path.join(tmp, 'g2.json'), JSON.stringify(match('C', 'A', 'draw')));
fs.writeFileSync(path.join(tmp, 'bad.json'), '{oops');
var out = aggregate([path.join(tmp, 'g1.json'), path.join(tmp, 'g2.json'), path.join(tmp, 'bad.json')]);
ok(out.schema === 1 && Array.isArray(out.entries), '输出 schema: {schema:1, entries[]}');
ok(out.source.length === 2 && out.skipped.length === 1 && /bad\.json/.test(out.skipped[0]), '坏文件跳过且在 skipped 报告');
ok(out.entries.length === 3, '3 个模型聚合');
/* 实际计分: A = 1胜+1负+1和+1和 = 2.0 (4局); B = 1胜+1负+1和 = 1.5 (3局); C = 1和 = 0.5 (1局) */
ok(out.entries[0].model === 'A' && out.entries[0].points === 2 && out.entries[1].model === 'B', '排序: A 2.0分居首, B 1.5 次之 (points desc)');
ok(out.entries[0].scoreRate === 0.5 && out.entries[0].games === 4, '得分率 = points/games (2/4 = 0.5)');
ok(out.entries[1].win === 1 && out.entries[1].draw === 1 && out.entries[1].loss === 1 && out.entries[1].games === 3, 'B: 对A 1负1胜1和 (C 只与 A 对局, 不涉 B)');
fs.rmSync(tmp, { recursive: true, force: true });

console.log('\n' + pass + '/' + (pass + fail) + ' PASS' + (fail ? ', ' + fail + ' FAILED' : ''));
if (fail) process.exit(1);
