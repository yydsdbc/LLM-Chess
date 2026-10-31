/* test/test_byok.js — 第82轮: BYOK 直连模式回归
 * 覆盖: 预设表/存取校验/isConfigured/直连请求构造 (URL+Authorization+provider 剥离+thinking 注入口径)/
 *       默认路径不受影响 (无 direct → api/chat)/CORS 失败提示/委员会透传
 * 运行: node test/test_byok.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
for (const f of ['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js',
  'core/generator.js', 'core/judge.js', 'core/engine.js', 'evaluation/xiangqi_knowledge.js',
  'evaluation/position.js', 'ai/llm_agent.js', 'ai/byok.js', 'ai/committee_agent.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const XQ = globalThis.XQ;

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  [PASS] ' + name); }
  else { fail++; console.log('  [FAIL] ' + name); }
}

/* ── localStorage 桩 (独立命名空间, 不污染全局) ── */
const lsStore = Object.create(null);
const lsStub = {
  getItem: (k) => (Object.prototype.hasOwnProperty.call(lsStore, k) ? lsStore[k] : null),
  setItem: (k, v) => { lsStore[k] = String(v); },
  removeItem: (k) => { delete lsStore[k]; }
};
const origLS = globalThis.localStorage;
globalThis.localStorage = lsStub;

/* ── 1. 预设表与工具函数 ── */
ok(Array.isArray(XQ.BYOK.PRESETS) && XQ.BYOK.PRESETS.length >= 6, '预设表 ≥6 个服务商');
ok(XQ.BYOK.PRESETS.every(p => p.id && p.label && p.baseUrl && /^https?:\/\//.test(p.baseUrl)), '每个预设含 id/label/合法 baseUrl');
ok(XQ.BYOK.presetOf('deepseek').baseUrl.indexOf('api.deepseek.com') >= 0, 'presetOf 命中 DeepSeek');
ok(XQ.BYOK.presetOf('不存在') && XQ.BYOK.presetOf('不存在').id === 'custom', '未知预设兑底 custom');
ok(XQ.BYOK.load() === null, '空存储 load() → null');
XQ.BYOK.save({ preset: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: 'sk-test', model: 'gpt-4o-mini' });
ok(XQ.BYOK.isConfigured() === true, 'save+isConfigured 四要素齐 → true');
XQ.BYOK.save({ preset: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini' });
ok(XQ.BYOK.isConfigured() === false, '缺 key → isConfigured false');
globalThis.localStorage.setItem('xq_byok', '{broken json');
ok(XQ.BYOK.load() === null, '坏 JSON load() → null (不抛)');
XQ.BYOK.clear();
ok(XQ.BYOK.load() === null && XQ.BYOK.isConfigured() === false, 'clear 后归零');

async function main() {
/* ── 2. llm_agent 直连请求构造 ── */
let captured = null;
globalThis.fetch = async function (url, opts) {
  captured = { url, headers: opts.headers, body: JSON.parse(opts.body) };
  return {
    ok: true,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ from: 'b3', to: 'e3', summary: '直连测试', confidence: 0.8 }), reasoning_content: '直连' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    })
  };
};

const eng = XQ.Engine.create();
const engView = {
  snapshot: () => eng.snapshot(), isOver: () => eng.isOver(),
  legalTargets: (x, y) => eng.legalTargets(x, y), dangerTargets: (x, y) => eng.dangerTargets(x, y),
  inCheck: (c) => eng.inCheck(c), naturalClock: () => eng.naturalClock(),
  result: () => eng.result(), pieceAt: (x, y) => eng.pieceAt(x, y), turn: () => eng.turn()
};

function makeAgent(extra) {
  return XQ.LLMAgent.create(Object.assign({
    side: 'red', provider: 'direct', model: 'gpt-4o-mini',
    engine: engView, signal: null
  }, extra));
}

XQ.BYOK.save({ preset: 'openai', baseUrl: 'https://api.openai.com/v1/', apiKey: 'sk-abc', model: 'gpt-4o-mini' });
const a1 = makeAgent({ direct: XQ.BYOK.load() });
const mv1 = await a1.next(eng);
ok(mv1 && mv1.from && mv1.to, '直连模式出招成功 (返回 from/to 坐标)');
ok(captured.url === 'https://api.openai.com/v1/chat/completions', '直连 URL = baseUrl 去尾斜杠 + /chat/completions (实测 ' + captured.url + ')');
ok(captured.headers.Authorization === 'Bearer sk-abc', 'Authorization: Bearer 头携带访客 key');
ok(!('provider' in captured.body), '直连 body 不含 provider 字段 (中继专用)');
ok(captured.body.model === 'gpt-4o-mini' && Array.isArray(captured.body.messages) && captured.body.stream === true, '直连 body 含 model/messages/stream');
ok(!('thinking' in captured.body), '直连非 bigmodel 域名不注入 thinking 字段 (严格校验的上游会 400)');

/* bigmodel 域名注入 thinking */
XQ.BYOK.save({ preset: 'glm', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: 'glm-key', model: 'glm-4-flash' });
const a2 = makeAgent({ direct: XQ.BYOK.load(), thinking: 'enabled' });
await a2.next(eng);
ok('thinking' in captured.body && captured.body.thinking.type === 'enabled', 'bigmodel 直连仍注入 thinking (与中继同口径)');

/* ── 3. 默认路径不受影响: 无 direct → api/chat + provider 字段 ── */
const a3 = makeAgent({ provider: 'deepseek', model: 'deepseek-chat', direct: null });
await a3.next(eng);
ok(captured.url === 'api/chat', '无 direct 时仍走中继 api/chat (默认路径零变化)');
ok(captured.body.provider === 'deepseek', '中继路径保留 provider 字段');
ok(!('Authorization' in captured.headers), '中继路径不带 Authorization (密钥在服务端)');

/* ── 4. 委员会透传 direct ── */
let committeeCaptured = null;
const commAgents = [];
globalThis.fetch = async function (url, opts) {
  committeeCaptured = { url, headers: opts.headers, body: JSON.parse(opts.body) };
  return {
    ok: true,
    headers: { get: (k) => (String(k).toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => ({
      choices: [{ message: { content: JSON.stringify({ from: 'b3', to: 'e3', summary: '委员会直连', confidence: 0.8 }), reasoning_content: '直连' } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
    })
  };
};
const comm = XQ.CommitteeAgent.create({
  side: 'red', provider: 'direct', models: ['deepseek-chat'],
  mode: 'council', engine: engView, direct: { baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-comm', model: 'deepseek-chat' },
  signal: null
});
await comm.next(eng);
ok(committeeCaptured.url === 'https://api.deepseek.com/v1/chat/completions', '委员会选民走直连 URL (透传生效)');
ok(committeeCaptured.headers.Authorization === 'Bearer sk-comm', '委员会选民携带直连 Authorization');

/* ── 5. testConnection: 成功/CORS 失败提示 ── */
globalThis.fetch = async function (url, opts) {
  if (url.indexOf('cors-block') >= 0) throw new TypeError('Failed to fetch');
  return { ok: true, headers: { get: () => null }, json: async () => ({}) };
};
const tOk = await XQ.BYOK.testConnection({ baseUrl: 'https://api.openai.com/v1', apiKey: 'k', model: 'm' });
ok(tOk.ok === true && typeof tOk.ms === 'number', 'testConnection 成功返回 {ok,ms}');
const tCors = await XQ.BYOK.testConnection({ baseUrl: 'https://cors-block.example/v1', apiKey: 'k', model: 'm' });
ok(tCors.ok === false && /CORS/.test(tCors.error), 'Failed to fetch → 附 CORS 拦截提示 (直连失败最常见原因)');
}
main().then(function () {
  globalThis.localStorage = origLS;
  console.log('\n' + pass + '/' + (pass + fail) + ' PASS' + (fail ? ', ' + fail + ' FAILED' : ''));
  if (fail) process.exit(1);
}).catch(function (e) { console.error('suite crashed:', e && e.message); process.exit(1); });
