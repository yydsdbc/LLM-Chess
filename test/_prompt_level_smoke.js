// smoke: promptLevel 分级注入验证
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = 'C:/Users/dukai/.openclaw/workspace/LLM-chess';
for (const f of ['core/piece.js','core/move.js','core/board.js','core/rules.js','core/generator.js','core/judge.js','core/engine.js','evaluation/xiangqi_knowledge.js','evaluation/position.js','ai/llm_agent.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const XQ = globalThis.XQ;
const JSON_OK = '{"from":"h3","to":"e3","summary":"x","confidence":0.5}';
function captureSystem(levelOrStyle) {
  const agent = XQ.LLMAgent.create(Object.assign({ side: 'red', provider: 'tokenrhythm', model: 'glm-5.3-flash' }, levelOrStyle));
  let captured = null;
  globalThis.fetch = function (url, opts) { captured = JSON.parse(opts.body); return Promise.resolve({ ok: true, status: 200, headers: { get: function () { return 'application/json'; } }, json: async () => ({ choices: [{ message: { content: JSON_OK } }] }) }); };
  const e = XQ.Engine.create();
  agent.next(e);
  return captured.messages[0].content;
}
const sysHigh = captureSystem({ promptLevel: 'high' });
const sysNone = captureSystem({ promptLevel: 'none' });
const sysMid = captureSystem({ promptLevel: 'mid' });
const sysLow = captureSystem({ promptLevel: 'low' });
const sysLegacy = captureSystem({ style: 'defensive' });   // legacy 兼容
console.log('len high:', sysHigh.length, '| low:', sysLow.length, '| mid:', sysMid.length, '| none:', sysNone.length);
console.log('PASS high has 风格节:', sysHigh.includes('## 风格:'));
console.log('PASS high has 战术补充:', sysHigh.includes('战术补充'));
console.log('PASS low 一句话:', sysLow.includes('主动但不冒进') && !sysLow.includes('战术补充'));
console.log('PASS mid 标准:', sysMid.includes('风格: 主动制造威胁') && !sysMid.includes('战术补充'));
console.log('PASS none 无风格节:', !sysNone.includes('## 风格:'));
console.log('PASS legacy style=defensive 兼容 (mid 级):', sysLegacy.includes('风格: 主动制造威胁'));
console.log('PASS 无 你的棋风 残留:', !sysHigh.includes('你的棋风'));
console.log('PASS 无 均势按棋风 残留:', !sysHigh.includes('均势按棋风'));
// system 恒定性 (前缀缓存前提): 同等级两次调用 system 逐字节一致
const again = captureSystem({ promptLevel: 'high' });
console.log('PASS system 恒定 (high 两调用逐字一致):', again === sysHigh);
