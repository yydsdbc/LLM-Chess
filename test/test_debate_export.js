/* test/test_debate_export.js — 第85轮: 辩论实录导出回归
 * 覆盖: 人类手跳过 / 委员手块完整 (终选/全票/计划/摘要/信心) / 投票表 (改票与被拒着法标记) /
 *       候选行 / 纯人局 → empty 兜底 / 标签插值 ({n}{side}{mv}{p}{v}) / 头部对阵行
 * 运行: node test/test_debate_export.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'ui/debate_export.js'), 'utf8'), { filename: 'ui/debate_export.js' });
const XQ = globalThis.XQ;

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name); }
}
const L = {
  title: '辩论实录', red: '红方', black: '黑方',
  move: '第 {n} 手 · {side} · {mv}', captured: '(吃 {p})', finalPick: '终选: {v}',
  unanim: '全票', plan: '计划', summary: '决策摘要', evaln: '局面评价', conf: '信心',
  vModel: '模型', vProp: '提议', vConf: '信心', vChg: '改票',
  cands: '候选', empty: '(本局无 LLM 决策元数据)', footer: '由 LLM-Chess 生成'
};

const record = {
  red: { name: 'glm-5.3-flash(红)' }, black: { name: 'deepseek-chat(黑)' },
  date: '2026-10-31T12:00:00Z', result: 'checkmate', moves: [
    { kind: 'human', name: '炮二平五' },   // 人类手 → 不出现
    { side: 'red', name: '马8进7', captured: '卒', meta: {
        voterName: 'council:glm-5.3-flash', unanimity: true, committeeMode: 'council',
        plan: '跳马护中兵', summary: '会诊 3/3 同侪同选', evaluation: '+1.2 红优',
        confidence: 0.82,
        votes: [
          { model: 'glm-5.3-flash', from: 'b', to: '3', conf: 0.9, weight: 1, changed: false, ok: true },
          { model: 'deepseek-chat', from: 'x', to: '9', conf: 0.4, weight: 1, changed: true, ok: false }
        ],
        candidates: [{ move: '马8进7', score: '+1.2' }, { move: '炮8平9', score: '+0.8' }]
      } },
    { side: 'black', name: '卒3进1', meta: {} }   // 裸手 (无 meta) → 只出标题行
  ]
};

const md = XQ.Debate.buildMarkdown(record, L);
ok(md.indexOf('# 辩论实录') === 0, '标题行开头');
ok(md.indexOf('glm-5.3-flash(红) vs deepseek-chat(黑)') > 0 && md.indexOf('checkmate') > 0, '头部含对阵与结果');
ok(md.indexOf('炮二平五') < 0, '人类手不出现在实录');
ok(md.indexOf('### 第 2 手 · 红方 · 马8进7 (吃 卒)') > 0, '委员会手标题行 + 吃子标注 (插值 {n}/{side}/{mv}/{p})');
ok(md.indexOf('终选: council:glm-5.3-flash (全票)') > 0, '终选 + 全票标记');
ok(md.indexOf('计划: 跳马护中兵') > 0 && md.indexOf('决策摘要: 会诊 3/3 同侪同选') > 0 && md.indexOf('局面评价: +1.2 红优') > 0, '计划/摘要/评价逐行');
ok(md.indexOf('信心: 82%') > 0, '信心百分比化');
ok(md.indexOf('| 模型 | 提议 | 信心 | 改票 |') > 0, '投票表头');
ok(md.indexOf('| glm-5.3-flash | b3 | 90% |  |') > 0, '投票行: 正常提议');
ok(md.indexOf('~~x9~~') > 0 && md.indexOf('| deepseek-chat |') > 0, '被拒提议 ~~删除线~~ + 改票行');
ok(md.indexOf('候选: 马8进7(+1.2) / 炮8平9(+0.8)') > 0, '候选行');
ok(md.indexOf('第 3 手') > 0, '裸手 (无 meta) 仍有标题行');
ok(XQ.Debate.buildMarkdown({ red: { name: 'A' }, black: { name: 'B' }, moves: [] }, L).indexOf('(本局无 LLM 决策元数据)') > 0, '空局 → empty 兜底');
ok(XQ.Debate.buildMarkdown(null, L).indexOf('? vs ?') > 0, 'null record 不抛 (兜底 ?)');

console.log('\n' + pass + '/' + (pass + fail) + ' PASS' + (fail ? ', ' + fail + ' FAILED' : ''));
if (fail) process.exit(1);
