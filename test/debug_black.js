/* test/debug_black.js — 抓黑方 agent 的原始返回, 定位 meta 缺失原因 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
for (const f of ['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js',
  'core/generator.js', 'core/judge.js', 'core/engine.js', 'ai/llm_agent.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const XQ = globalThis.XQ;

const realFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  return realFetch(new URL(url, 'http://localhost:8788/').href, opts);
};

const raws = [];
const agent = XQ.LLMAgent.create({
  side: 'black', provider: process.argv[2] || 'tokenrhythm', model: process.argv[3] || 'glm-5.3-flash',
  onRawResponse: function (side, txt) { raws.push(txt); }
});

(async function main() {
  const engine = XQ.Engine.create();
  const t0 = Date.now();
  const mv = await agent.next(engine, null);
  const secs = ((Date.now() - t0) / 1000).toFixed(1);
  console.log('耗时:', secs + 's');
  console.log('解析结果:', JSON.stringify({ from: mv.from, to: mv.to, meta: mv.meta }));
  console.log('--- 原始返回 (最后1次) ---');
  const last = raws[raws.length - 1] || '';
  console.log('长度:', last.length, '| 含JSON:', /\{[^{}]*\}/.test(last), '| 前500字:');
  console.log(last.slice(0, 500));
  console.log('...(后200字)...');
  console.log(last.slice(-200));
  process.exit(0);
})().catch(e => { console.error('ERR:', e.message); process.exit(1); });