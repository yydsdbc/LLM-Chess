// test/_committee_agent.js — 同方多 LLM 委员会守护 (第29轮: 轮换/会诊投票/平票决胜/全灭/用量聚合)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
for (const f of ['core/piece.js','core/move.js','core/board.js','core/rules.js','core/generator.js','core/judge.js','core/engine.js',
  'evaluation/xiangqi_knowledge.js','evaluation/position.js','ai/llm_agent.js','ai/committee_agent.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const XQ = globalThis.XQ;

let failed = 0;
function ok(cond, name) {
  console.log((cond ? '  [PASS] ' : '  [FAIL] ') + name);
  if (!cond) failed++;
}

let callN = 0;
let scripted = [{ f: 'h3', t: 'e3', c: 0.5 }];
let failAll = false;
globalThis.fetch = function (url, opts) {
  if (failAll) return Promise.reject(new Error('stub down'));
  callN++;
  const mv = scripted[Math.min(callN - 1, scripted.length - 1)];
  const content = JSON.stringify({ from: mv.f, to: mv.t, summary: 'stub' + callN, confidence: mv.c });
  return Promise.resolve({
    ok: true, status: 200,
    headers: { get: function () { return 'application/json'; } },
    json: async () => ({ choices: [{ message: { content: content } }] })
  });
};
function resetStub(script) { callN = 0; scripted = script; }

(async function main() {
  const eng = XQ.Engine.create();

  // C1 会诊: 2/3 投 e3 → 胜出 e3, 候选含全体 (*=胜出), 摘要带 [会诊 2/3]
  resetStub([{ f: 'h3', t: 'e3', c: 0.9 }, { f: 'h3', t: 'e3', c: 0.8 }, { f: 'h3', t: 'g3', c: 0.7 }]);
  const c3 = XQ.CommitteeAgent.create({ side: 'red', provider: 'stub', models: ['m1', 'm2', 'm3'], mode: 'council' });
  const mv1 = await c3.next(eng);
  ok(XQ.Move.sqName(mv1.to) === 'e3', 'C1 会诊 2/3 胜出落点 e3 (得 ' + XQ.Move.sqName(mv1.to) + ')');
  ok(mv1.meta && mv1.meta.candidates && mv1.meta.candidates.length === 3, 'C1 候选含全体选民 (3)');
  ok(mv1.meta.candidates.some(function (c) { return c.move.indexOf('*') >= 0; }), 'C1 胜出选民带 * 标记');
  ok((mv1.meta.summary || '').indexOf('[会诊 2/3]') >= 0, 'C1 摘要带 [会诊 2/3] 标记');
  ok((mv1.meta.reasoning || '').indexOf('同侪会诊') === 0, 'C1 reasoning 记录投票明细');

  // C2 平票决胜: 1/1/1 各一票 → 比信心和 (g3 0.95 最高)
  resetStub([{ f: 'h3', t: 'e3', c: 0.6 }, { f: 'h3', t: 'g3', c: 0.95 }, { f: 'h3', t: 'c3', c: 0.5 }]);
  const mv2 = await c3.next(eng);
  ok(XQ.Move.sqName(mv2.to) === 'g3', 'C2 平票按信心决胜 g3 (得 ' + XQ.Move.sqName(mv2.to) + ')');

  // C3 轮换: 每手换模型, reasoning 带轮换标记
  resetStub([{ f: 'h3', t: 'e3', c: 0.5 }, { f: 'h3', t: 'g3', c: 0.5 }]);
  const r2 = XQ.CommitteeAgent.create({ side: 'red', provider: 'stub', models: ['m1', 'm2'], mode: 'rotate' });
  const mv3 = await r2.next(eng);
  const mv4 = await r2.next(eng);
  ok((mv3.meta.reasoning || '').indexOf('[轮换 stub:m1]') === 0, 'C3 轮换第一手 m1');
  ok((mv4.meta.reasoning || '').indexOf('[轮换 stub:m2]') === 0, 'C3 轮换第二手 m2');

  // C4 全灭 → 抛错 (走 app 层随机兑底路径)
  resetStub([{ f: 'h3', t: 'e3', c: 0.5 }]);
  failAll = true;
  const c4 = XQ.CommitteeAgent.create({ side: 'red', provider: 'stub', models: ['m1', 'm2'], mode: 'council' });
  let threw = false;
  try { await c4.next(eng); } catch (e) { threw = true; }
  ok(threw, 'C4 全体选民失败 → 抛错交给兑底');
  failAll = false;

  // C5 用量聚合: 委员会 usage 为全体选民之和
  const u = c3.usage();
  ok(u.attempts >= 3, 'C5 usage.attempts 为选民之和 (得 ' + u.attempts + ')');

  // C7 选民预算超时 → 按弃权 (挂起选民不阻塞出招)   第30轮
  resetStub([{ f: 'h3', t: 'e3', c: 0.5 }]);
  var cB = XQ.CommitteeAgent.create({ side: 'red', provider: 'stub', models: ['slow', 'fast'], mode: 'council', voterBudgetMs: 50 });
  var origFetch = globalThis.fetch;
  var callIdx = 0;
  globalThis.fetch = function (url, opts) {
    callIdx++;
    if (callIdx === 1) return new Promise(function () {});   // slow 选民挂起
    return origFetch(url, opts);
  };
  const mvB = await cB.next(eng);
  ok(XQ.Move.sqName(mvB.to) === 'e3', 'C7 预算超时选民弃权, 快选民出招 (得 ' + XQ.Move.sqName(mvB.to) + ')');
  globalThis.fetch = origFetch;

  // C8 轮换回绕: 3 模型第 4 手回到 m1   第30轮
  resetStub([{ f: 'h3', t: 'e3', c: 0.5 }, { f: 'h3', t: 'g3', c: 0.5 }, { f: 'h3', t: 'c3', c: 0.5 }, { f: 'h3', t: 'e3', c: 0.5 }]);
  const r3 = XQ.CommitteeAgent.create({ side: 'red', provider: 'stub', models: ['a', 'b', 'c'], mode: 'rotate' });
  const seq = [await r3.next(eng), await r3.next(eng), await r3.next(eng), await r3.next(eng)];
  ok((seq[0].meta.reasoning || '').indexOf('[轮换 stub:a]') === 0 && (seq[3].meta.reasoning || '').indexOf('[轮换 stub:a]') === 0, 'C8 轮换 4 手回绕到 a');

  // C6 单模型会诊退化为普通路径
  resetStub([{ f: 'h3', t: 'e3', c: 0.5 }]);
  const c1 = XQ.CommitteeAgent.create({ side: 'red', provider: 'stub', models: ['m1'], mode: 'council' });
  const mv5 = await c1.next(eng);
  ok(XQ.Move.sqName(mv5.to) === 'e3', 'C6 单模型会诊退化为普通单模型');

  console.log(failed ? '_committee_agent: ' + failed + ' FAIL' : '_committee_agent: ALL PASS');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error('suite crashed:', e); process.exit(1); });
