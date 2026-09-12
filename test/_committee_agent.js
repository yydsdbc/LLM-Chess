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

  // C9 安全否决: 多数票投挂车吃卒 (黑马 c6 保护, 静态净损 9), 静态最优选民是上马 → 否决改选   第31轮
  {
    const bd = XQ.Engine.create().cloneBoard();   // startBoard 需要 Board 实例 (有 clone 方法)
    bd.set(4, 5, { color: 'red', type: 'rook', id: 'red-rook-x' });   // 红车 e5 (Board 是 90 格一维, set(x,y,p))
    bd.set(2, 4, { color: 'black', type: 'knight', id: 'bk-c6' });   // 黑马 c6 保护 e7 卒 (吃卒被马反吃, 净损 9)
    const engV = XQ.Engine.create({ startBoard: bd });
    resetStub([{ f: 'e5', t: 'e7', c: 0.9 }, { f: 'e5', t: 'e7', c: 0.9 }, { f: 'b1', t: 'c3', c: 0.5 }]);
    const cV = XQ.CommitteeAgent.create({ side: 'red', provider: 'stub', models: ['v1', 'v2', 'v3'], mode: 'council' });
    const mvV = await cV.next(engV);
    ok(XQ.Move.sqName(mvV.to) === 'c3', 'C9 安全否决: 多数送车改静态最优 c3 (得 ' + XQ.Move.sqName(mvV.to) + ')');
    ok((mvV.meta.reasoning || '').indexOf('安全否决') >= 0, 'C9 reasoning 记录否决原因');
  }

  // C10 全票标记: 两选民同落点 → [会诊 全票 2]   第31轮
  resetStub([{ f: 'h3', t: 'e3', c: 0.8 }, { f: 'h3', t: 'e3', c: 0.7 }]);
  const cU = XQ.CommitteeAgent.create({ side: 'red', provider: 'stub', models: ['u1', 'u2'], mode: 'council' });
  const mvU = await cU.next(eng);
  ok((mvU.meta.summary || '').indexOf('[会诊 全票 2]') >= 0, 'C10 全票标记 (得 ' + (mvU.meta.summary || '').slice(-12) + ')');

  // C11 进度回调: answered 1→2→3   第31轮
  resetStub([{ f: 'h3', t: 'e3', c: 0.5 }, { f: 'h3', t: 'g3', c: 0.5 }, { f: 'h3', t: 'c3', c: 0.5 }]);
  const prog = [];
  const cP = XQ.CommitteeAgent.create({ side: 'red', provider: 'stub', models: ['p1', 'p2', 'p3'], mode: 'council', onProgress: function (p) { prog.push(p.answered); } });
  await cP.next(eng);
  ok(JSON.stringify(prog) === '[1,2,3]', 'C11 onProgress answered 序列 1,2,3 (得 ' + JSON.stringify(prog) + ')');

  // C12 minVotes: 两选民互不相同 → 回落最高信心   第31轮
  resetStub([{ f: 'h3', t: 'e3', c: 0.5 }, { f: 'h3', t: 'g3', c: 0.92 }]);
  const cM = XQ.CommitteeAgent.create({ side: 'red', provider: 'stub', models: ['q1', 'q2'], mode: 'council', minVotes: 2 });
  const mvM = await cM.next(eng);
  ok(XQ.Move.sqName(mvM.to) === 'g3', 'C12 minVotes=2 未达 → 最高信心 g3 (得 ' + XQ.Move.sqName(mvM.to) + ')');

  // C13 votes 明细结构   第31轮
  resetStub([{ f: 'h3', t: 'e3', c: 0.5 }, { f: 'h3', t: 'g3', c: 0.5 }]);
  const cD = XQ.CommitteeAgent.create({ side: 'red', provider: 'stub', models: ['d1', 'd2'], mode: 'council' });
  const mvD = await cD.next(eng);
  ok(Array.isArray(mvD.meta.votes) && mvD.meta.votes.length === 2 && mvD.meta.votes[0].model === 'stub:d1' && mvD.meta.votes[0].ok === true, 'C13 meta.votes 结构化明细');
  ok(mvD.meta.votes[0].to === 'e3' && typeof mvD.meta.votes[0].conf === 'number', 'C13 votes 含落点/信心');

  console.log(failed ? '_committee_agent: ' + failed + ' FAIL' : '_committee_agent: ALL PASS');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error('suite crashed:', e); process.exit(1); });
