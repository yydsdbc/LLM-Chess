/* test/test_share_card.js — 第83轮: 分享卡回归
 * 覆盖: 几何常量/gridPoint 映射/buildData 纯装配 (截断/清洗/时长格式/默认值)/collectPieces 全盘枚举
 * 运行: node test/test_share_card.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
for (const f of ['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js',
  'core/generator.js', 'core/judge.js', 'core/engine.js', 'ui/share_card.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const XQ = globalThis.XQ;
let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name); }
}

/* ── 几何: 卡面内棋盘 90 交点全部落在画布内 ── */
const G = XQ.ShareCard.GEO;
ok(G.W === 1000 && G.H === 1500 && G.CELL === 100, '几何常量: 1000x1500, cell=100');
let allInside = true, riverGap = true;
for (let y = 0; y < 10; y++) {
  for (let x = 0; x < 9; x++) {
    const pt = XQ.ShareCard.gridPoint(x, y);
    if (pt.px < 0 || pt.px > G.W || pt.py < 0 || pt.py > G.H) allInside = false;
  }
}
const midL = XQ.ShareCard.gridPoint(0, 4), midR = XQ.ShareCard.gridPoint(0, 5);
if (midR.py - midL.py !== G.CELL) riverGap = false;
ok(allInside, '90 交点全部在画布内');
ok(riverGap, '楚河汉界两侧横线间距 = cell (y=4/y=5 各自成线)');
ok(XQ.ShareCard.gridPoint(9, 0).px === XQ.ShareCard.gridPoint(0, 0).px && XQ.ShareCard.gridPoint(0, 10).py === XQ.ShareCard.gridPoint(0, 0).py, '越界坐标取模回绕 (防御性, 不画到界外)');

/* ── buildData: 截断/清洗/格式 ── */
const d1 = XQ.ShareCard.buildData({
  record: { red: 'gpt-4o (一条特别特别长的模型名字会被截断到24字)', black: 'deepseek-chat', stamp: '2026-10-31 12:00:00' },
  winner: 'red', resultText: '红方胜'.repeat(30), metaText: 'm'.repeat(120), eloText: '<b>Elo</b> 1200 → 1216 (+16)',
  moves: 87, elapsedSec: 65, titleText: 'LLM 象棋对战'
});
ok(d1.redName.length <= 24 && d1.blackName.length <= 24, '双方名称截断 ≤24');
ok(d1.resultText.length <= 60 && d1.metaText.length <= 90, '赛果/统计行截断');
ok(d1.eloText === 'Elo 1200 → 1216 (+16)', 'eloText 由调用方去标签后传入 (原样保留)');
ok(d1.durText === '1m 5s', '时长 65s → 1m 5s');
ok(d1.stamp === '2026-10-31120000', 'stamp 去掉非 \\w 字符 (文件名安全)');
ok(d1.winner === 'red' && d1.moves === 87, 'winner/moves 透传');
const d2 = XQ.ShareCard.buildData({ record: {}, elapsedSec: 8 });
ok(d2.durText === '8s' && d2.moves === 0 && d2.title === 'LLM Xiangqi Battle', '缺省: 8s/0手/默认标题');
const d3 = XQ.ShareCard.buildData({ record: {}, elapsedSec: -5 });
ok(d3.durText === '', '非法时长 (负数) → 空串不渲染');

/* ── collectPieces: 起始局面 32 子, 字符表命中 ── */
const eng = XQ.Engine.create();
const pieces = XQ.ShareCard.collectPieces(eng);
ok(pieces.length === 32, '起始局面枚举 32 子 (实测 ' + pieces.length + ')');
ok(pieces.every(p => (p.color === 'red' || p.color === 'black') && p.char && p.char !== '?'), '每子含合法 color + CHARS 字符');
const kings = pieces.filter(p => p.char === '帅' || p.char === '将');
ok(kings.length === 2 && kings[0].y !== kings[1].y, '帅/将各一且分处两侧 (红下黑上朝向)');
ok(XQ.ShareCard.collectPieces(null).length === 0, '无引擎 → 空数组不抛');

console.log('\n' + pass + '/' + (pass + fail) + ' PASS' + (fail ? ', ' + fail + ' FAILED' : ''));
if (fail) process.exit(1);
