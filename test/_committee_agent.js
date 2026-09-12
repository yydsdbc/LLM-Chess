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
let sseMode = false;            // 第32轮: SSE 流式桩 (按调用序给各选民不同 reasoning)
let sseSets = [];
let thinkTexts = [];            // onThinking 捕获
let progPayloads = [];          // onProgress 捕获
const TE = new TextEncoder();
function mkSSE(reason, moveObj) {   // 单选民 SSE 帧: reasoning → content(内嵌 JSON 字符串) → DONE; moveObj 为普通对象
  var nl = String.fromCharCode(10);
  var f1 = JSON.stringify({ choices: [{ delta: { reasoning_content: reason } }] });
  var f2 = JSON.stringify({ choices: [{ delta: { content: JSON.stringify(moveObj) } }] });
  var fU = JSON.stringify({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8 } });
  return [
    'data: ' + f1 + nl + nl,
    'data: ' + f2 + nl + nl,
    'data: ' + fU + nl + nl,
    'data: [DONE]' + nl + nl
  ];
}
globalThis.fetch = function (url, opts) {
  if (failAll) return Promise.reject(new Error('stub down'));
  callN++;
  if (sseMode) {
    const frames = sseSets[Math.min(callN - 1, sseSets.length - 1)];
    let i = 0;
    return Promise.resolve({
      ok: true, status: 200,
      headers: { get: function () { return 'text/event-stream'; } },
      body: { getReader: function () { return { read: function () { return Promise.resolve(i < frames.length ? { done: false, value: TE.encode(frames[i++]) } : { done: true }); } }; } }
    });
  }
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

  // C14 合并流式思考: 两选民不同 reasoning, onThinking 最后一次合并含双方标签与片段   第32轮
  {
    sseMode = true;
    callN = 0;   // 第32轮: 共享调用计数归零 (否则两选民都取 v2 帧)
    const eng14 = XQ.Engine.create();   // 第32轮: 独立新引擎 (共享 eng 已走到中盘, h3-e3 不再合法 → 选民全灭)
    sseSets = [mkSSE('红车占肋控制中路', { from: 'h3', to: 'e3', summary: 's1', confidence: 0.7 }), mkSSE('上马保住中兵', { from: 'h3', to: 'e3', summary: 's2', confidence: 0.6 })];
    thinkTexts = [];
    const cS = XQ.CommitteeAgent.create({
      side: 'red', provider: 'stub', models: ['s1', 's2'], mode: 'council',
      onThinking: function (side2, text) { thinkTexts.push(text); }
    });
    await cS.next(eng14);
    const last = thinkTexts[thinkTexts.length - 1] || '';
    ok(last.indexOf('【stub:s1】') >= 0 && last.indexOf('【stub:s2】') >= 0, 'C14 合并流含双选民标签');
    ok(last.indexOf('红车占肋控制中路') >= 0 && last.indexOf('上马保住中兵') >= 0, 'C14 合并流含双选民思考片段');
    sseMode = false;
  }

  // C15 进度 payload: voters 状态数组 + 实时票型   第32轮
  {
    resetStub([{ f: 'h3', t: 'e3', c: 0.5 }, { f: 'h3', t: 'e3', c: 0.5 }, { f: 'h3', t: 'g3', c: 0.5 }]);
    progPayloads = [];
    const cP2 = XQ.CommitteeAgent.create({ side: 'red', provider: 'stub', models: ['w1', 'w2', 'w3'], mode: 'council', onProgress: function (p) { progPayloads.push(p); } });
    await cP2.next(eng);
    const lastP = progPayloads[progPayloads.length - 1];
    ok(lastP && lastP.voters && lastP.voters.length === 3 && lastP.voters.every(function (v) { return v.state === 'ok'; }), 'C15 进度 payload 含全体选民 ok 态');
    ok(lastP && lastP.tally && lastP.tally.e3 === 2 && lastP.tally.g3 === 1, 'C15 实时票型 e3×2/g3×1');
  }

  // C16 usage perVoter: 逐选民 token 分解   第32轮
  resetStub([{ f: 'h3', t: 'e3', c: 0.5 }, { f: 'h3', t: 'g3', c: 0.5 }]);
  const cV2 = XQ.CommitteeAgent.create({ side: 'red', provider: 'stub', models: ['t1', 't2'], mode: 'council' });
  await cV2.next(eng);
  const uv = cV2.usage();
  ok(uv.perVoter && uv.perVoter.length === 2 && uv.perVoter[0].name === 't1' && uv.perVoter[1].name === 't2', 'C16 perVoter 逐选民分解');

  // C17 meta.voterName: 会诊胜出 / 轮换当前   第32轮
  resetStub([{ f: 'h3', t: 'e3', c: 0.9 }, { f: 'h3', t: 'g3', c: 0.5 }]);
  const cN = XQ.CommitteeAgent.create({ side: 'red', provider: 'stub', models: ['n1', 'n2'], mode: 'council' });
  const mvN = await cN.next(eng);
  ok(mvN.meta.voterName === 'stub:n1', 'C17 会诊 meta.voterName = 胜出选民');
  resetStub([{ f: 'h3', t: 'e3', c: 0.5 }]);
  const mvN2 = await r2.next(eng);   // r2 = C3 的轮换委员会 (m1/m2, 已走到 m2)
  ok(mvN2.meta.voterName === 'stub:m1', 'C17 轮换 meta.voterName = 当前选民 (回绕)');

  console.log(failed ? '_committee_agent: ' + failed + ' FAIL' : '_committee_agent: ALL PASS');
  process.exit(failed ? 1 : 0);
})().catch(function (e) { console.error('suite crashed:', e); process.exit(1); });
