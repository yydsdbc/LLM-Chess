/* test/replay_risk_check.js — v1.7.6 新增能力回归
 * 1) XQ.Replay.moveRisk 疑误着法静态检测 (吃有保护的兵被反吃 → 风险≥3; 免费吃 → 负风险不标)
 * 2) XQ.Record.save 上限裁剪 (60 局) + 配额兜底 (QuotaExceeded → 逐级降级重试)
 * 独立于 replay_smoke (31 项数量保持不变), 用 vm sandbox 加载真实模块。 */
const fs = require('fs');
const vm = require('vm');
const sandbox = { console: console, setTimeout: setTimeout, clearTimeout: clearTimeout };
sandbox.ctx = sandbox;
function loadInto(p) { vm.runInNewContext(fs.readFileSync(p, 'utf8'), sandbox, { filename: p }); }
['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js', 'core/generator.js', 'core/judge.js', 'core/engine.js', 'benchmark/record.js', 'replay/replay.js']
  .forEach(loadInto);
const XQ = sandbox.XQ;

let failed = 0;
function ok(name, cond, extra) {
  console.log((cond ? 'PASS' : 'FAIL') + ' ' + name + (extra ? '  ' + extra : ''));
  if (!cond) failed++;
}

/* ── 1) 疑误着法检测: 构造"黑砲吃有保护的兵被反吃"局面 ──
 * 1. 红兵a4-a5  2. 黑砲b8-a8  3. 红炮h3-e3  4. 黑砲a8xa5 —
 * a5 兵有红车 a1 保护 (a4 兵已离开), 砲换兵静态净丢 4.5-1=3.5 分 → 第4手应标 ⚠; 前3手不应标 */
const recRisk = {
  id: 'risk_case', date: new Date().toISOString(),
  red: { name: '红', kind: 'llm' }, black: { name: '黑', kind: 'llm' },
  moves: [
    { n: 1, side: 'red', piece: 'pawn', from: 'a4', to: 'a5' },
    { n: 2, side: 'black', piece: 'cannon', from: 'b8', to: 'a8' },
    { n: 3, side: 'red', piece: 'cannon', from: 'h3', to: 'e3' },
    { n: 4, side: 'black', piece: 'cannon', from: 'a8', to: 'a5', captured: 'pawn' }
  ]
};
const s = XQ.Replay.create(recRisk);
while (s.idx() < s.total()) s.next();
const risks = s.risks();
ok('第4手 砲吃护兵 标疑误 (risk≥3)', (risks[4] || 0) >= 3, 'risk4=' + risks[4]);
ok('第1-3手 不标注 (<3)', (risks[1] || 0) < 3 && (risks[2] || 0) < 3 && (risks[3] || 0) < 3,
  'r1=' + risks[1] + ' r2=' + risks[2] + ' r3=' + risks[3]);
s.goto(4);
ok('state().risk 字段暴露', s.state().risk >= 3, 'risk=' + s.state().risk);
/* 第28轮挂链修复: 原版两处期望错误 — ① prev() 从 idx3 回退到 idx2 却断言 3 键 (rebuild(2) 应 2 键);
   ② 免责吃检测在 prev 之后取引擎 (炮尚未走到 e3, 恒 0)。修正流程: goto(3) 先测, prev 期望 2 键 */
s.goto(3);
ok('goto(3) 后 risks 表 3 键', Object.keys(s.risks()).length === 3, 'keys=' + Object.keys(s.risks()).length);

/* 免费吃子 = 负风险 (不标): 红炮 e3xe7 吃黑无保护中卒 (1 屏: e4 兵) — 无反吃 → risk = -1
   第28轮挂链修复②: moveRisk 以 eng.turn() 为行动方 — 3 手后轮黑, 红炮着法不在合法表恒 0;
   改用 2 手独立记录 (走完轮红) 承载该场景 */
const sFree = XQ.Replay.create({
  id: 'free_case', date: new Date().toISOString(),
  red: { name: '红', kind: 'llm' }, black: { name: '黑', kind: 'llm' },
  moves: [
    { n: 1, side: 'red', piece: 'cannon', from: 'h3', to: 'e3' },
    { n: 2, side: 'black', piece: 'cannon', from: 'b8', to: 'a8' }
  ]
});
sFree.goto(2);
const rFree = XQ.Replay.moveRisk(sFree.engine(), XQ.Move.parseSq('e3'), XQ.Move.parseSq('e7'));
ok('免费吃卒 负风险', rFree < 0, 'risk=' + rFree);
ok('prev 回退后 risks 表仍可用', s.prev() === true && Object.keys(s.risks()).length === 2, 'keys=' + Object.keys(s.risks()).length);

/* 真实棋谱 (match_headless) 全程检测不崩 + 风险值非 NaN
   第29轮 CI 修复: 文件可能不存在 (logs/ 被 gitignore, 本地才有) — 缺文件时合成 4 手谱, 不再 ENOENT
   (与第12轮 replay_smoke CI 红灯同款教训) */
let recReal = null;
try { recReal = JSON.parse(fs.readFileSync('logs/match_headless.json', 'utf8')); } catch (e) {}
if (!recReal || !Array.isArray(recReal.moves) || recReal.moves.length < 2) {
  recReal = { id: 'synthetic', date: new Date().toISOString(),
    red: { name: '红', kind: 'llm' }, black: { name: '黑', kind: 'llm' },
    moves: [
      { n: 1, side: 'red', piece: 'pawn', from: 'a4', to: 'a5' },
      { n: 2, side: 'black', piece: 'cannon', from: 'b8', to: 'a8' },
      { n: 3, side: 'red', piece: 'cannon', from: 'h3', to: 'e3' },
      { n: 4, side: 'black', piece: 'cannon', from: 'a8', to: 'a5', captured: 'pawn' }
    ] };
}
const sReal = XQ.Replay.create(recReal);
while (sReal.idx() < sReal.total()) sReal.next();
const rr = sReal.risks();
let nan = 0;
for (const k in rr) if (typeof rr[k] !== 'number' || isNaN(rr[k])) nan++;
ok('真实棋谱风险检测无 NaN', nan === 0, 'hands=' + Object.keys(rr).length);

/* ── 2) Record.save: 上限 60 局裁剪 + 配额兜底 ── */
function freshLS() {
  const ls = { _d: {}, getItem(k) { return this._d[k] == null ? null : this._d[k]; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } };
  sandbox.localStorage = ls;
  return ls;
}
freshLS();
for (let i = 0; i < 65; i++) {
  const r = XQ.Record.blank({ redName: 'R' + i, blackName: 'B' });
  r.date = new Date(2026, 0, 1, 0, i).toISOString();
  XQ.Record.save(r);
}
const capped = XQ.Record.list();
ok('棋谱上限 60 (65→60)', capped.length === 60, 'len=' + capped.length);
ok('裁剪保留最新 (R64 在)', capped.some(r => r.red && r.red.name === 'R64') && !capped.some(r => r.red && r.red.name === 'R0'));

/* 配额: 存不下 (>10 局 payload 一律抛 Quota) → 逐级降级 (留 30 → 留 15 → 只存当前局) */
const lsQ = freshLS();
for (let i = 0; i < 40; i++) {
  const r = XQ.Record.blank({ redName: 'Q' + i, blackName: 'B' });
  r.date = new Date(2026, 0, 2, 0, i).toISOString();
  XQ.Record.save(r);
}
const rawSet = lsQ.setItem.bind(lsQ);
let threw = false;
lsQ.setItem = function (k, v) {
  if ((String(v).match(/"id"/g) || []).length > 10) { threw = true; const e = new Error('quota'); e.name = 'QuotaExceededError'; throw e; }
  return rawSet(k, v);
};
const recCur = XQ.Record.blank({ redName: 'CURRENT', blackName: 'B' });
XQ.Record.save(recCur);
lsQ.setItem = rawSet;
const afterQ = XQ.Record.list();
ok('配额超限触发兜底', threw === true);
ok('兜底后当前局不丢', afterQ.some(r => r.id === recCur.id), 'len=' + afterQ.length);
ok('兜底后数量受控 (≤30)', afterQ.length <= 30, 'len=' + afterQ.length);

console.log(failed ? '\n' + failed + ' FAIL' : '\nALL PASS');
process.exit(failed ? 1 : 0);
