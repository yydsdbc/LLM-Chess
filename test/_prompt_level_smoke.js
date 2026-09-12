// test/_prompt_level_smoke.js — promptLevel 分级注入验证 (第28轮: 修复迁移前陈旧绝对路径 + 退出码纪律, 挂链 run_all)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
for (const f of ['core/piece.js','core/move.js','core/board.js','core/rules.js','core/generator.js','core/judge.js','core/engine.js','evaluation/xiangqi_knowledge.js','evaluation/position.js','ai/llm_agent.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const XQ = globalThis.XQ;
const JSON_OK = '{"from":"h3","to":"e3","summary":"x","confidence":0.5}';
let failed = 0;
function ok(cond, name) {
  console.log((cond ? '  [PASS] ' : '  [FAIL] ') + name);
  if (!cond) failed++;
}
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
ok(sysHigh.includes('## 风格:') && sysHigh.includes('战术补充'), 'high 注入风格节 + 战术补充');
ok(!sysNone.includes('## 风格:'), 'none 无风格节');
ok(sysMid.includes('风格: 主动制造威胁') && !sysMid.includes('战术补充'), 'mid 标准风格 (无战术补充)');
ok(sysLow.includes('主动但不冒进') && !sysLow.includes('战术补充'), 'low 一句话风格');
ok(sysLegacy.includes('风格: 主动制造威胁'), 'legacy style=defensive 兼容 (映射 mid)');
ok(!sysHigh.includes('你的棋风') && !sysHigh.includes('均势按棋风'), '旧棋风措辞零残留');
const again = captureSystem({ promptLevel: 'high' });
ok(again === sysHigh, 'system 恒定 (同等级两调用逐字一致, 前缀缓存前提)');
ok(sysHigh.length === again.length && new Set([sysHigh.length, sysMid.length, sysLow.length, sysNone.length]).size === 4, '四级 system 长度互异且同级恒定');
console.log(failed ? '_prompt_level_smoke: ' + failed + ' FAIL' : '_prompt_level_smoke: ALL PASS');
process.exit(failed ? 1 : 0);
