#!/usr/bin/env node
/* test/_server_http.js — server.js HTTP 行为测试 (第23轮新增, npm test 第12套件)
 * 真实 spawn server.js (随机高位端口), 断言此前零自动化覆盖的服务端行为:
 *   健康检查 / 静态托管+ETag/304 / 404 / 路径穿越 403 / 畸形百分号 400 /
 *   OPTIONS 预检 / bad json 400 / 未知服务商 400 / 限流 429 (8次/秒窗)
 *   第24轮二期: providers 形状+无 apiKey 泄漏 / HEAD+ETag / manifest.json+icon.svg MIME / GET /api/chat 方法守卫
 *   第26轮三期: sw.js 托管 / POST providers 守卫 / 空体 400 / health 形状 / 2MB 上限
 *   第27轮四期: 前缀穿越 (兄弟同名前缀目录) 403 / 错误 ETag 200 / sw.js 304 / OPTIONS 静态路径 204
 *   第29轮五期: 真实中继穿越 (LLMCHESS_KEYS 注入 + 本地 stub 上游; 回归 req 脱作用域崩进程) / 415 / 404 no-store
 * 零依赖 (http + child_process); 不打上游 — 全部走本地可判定路径。
 * 用法: node test/_server_http.js
 */
'use strict';
const { spawn } = require('child_process');
const http = require('http');
const path = require('path');

const PORT = 18000 + Math.floor(Math.random() * 20000);   // 随机端口防并行/占用冲突
const BASE = 'http://127.0.0.1:' + PORT;
const ROOT = path.join(__dirname, '..');

let server = null;
const results = [];
let failed = 0;
function ok(cond, name) {
  results.push((cond ? '  [PASS] ' : '  [FAIL] ') + name);
  if (!cond) failed++;
}

function req(method, urlPath, body, headers) {
  return new Promise(function (resolve) {
    const r = http.request(BASE + urlPath, { method: method, headers: headers || {} }, function (res) {
      const chunks = [];
      res.on('data', function (c) { chunks.push(c); });
      res.on('end', function () { resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks).toString('utf8') }); });
    });
    r.on('error', function (e) { resolve({ status: 0, headers: {}, body: String(e) }); });
    r.setTimeout(5000, function () { r.destroy(new Error('client timeout')); });
    if (body) r.write(body);
    r.end();
  });
}

function waitHealth(tries) {
  if (!tries) return Promise.resolve(false);
  return req('GET', '/api/health').then(function (res) {
    if (res.status === 200) return true;
    return new Promise(function (r2) { setTimeout(function () { waitHealth(tries - 1).then(r2); }, 150); });
  });
}

function postChat(payload) {
  return req('POST', '/api/chat', JSON.stringify(payload), { 'Content-Type': 'application/json' });
}

async function main() {
  // 第29轮: 中继穿越测试基建 — 本地 stub 上游 + 独立密钥文件 (LLMCHESS_KEYS, 不触用户真实 keys.json)
  const upstream = http.createServer(function (uReq, uRes) {
    let ubody = '';
    uReq.on('data', function (c) { ubody += c; });
    uReq.on('end', function () {
      var echo = 0;
      try { echo = JSON.parse(ubody).max_tokens || 0; } catch (eP) {}
      uRes.writeHead(200, { 'Content-Type': 'application/json' });
      uRes.end(JSON.stringify({ echo_max_tokens: echo, choices: [{ message: { content: '{"from":"h3","to":"e3","summary":"upstream-ok","confidence":0.8}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    });
  });
  await new Promise(function (r) { upstream.listen(0, '127.0.0.1', r); });
  const upPort = upstream.address().port;
  const fS = require('fs');   // 第29轮: 文件级 const fs 在 133 行 (TDZ), main 顶部先取独立引用
  const keysFile = path.join(ROOT, 'temp', 'guard-keys-' + process.pid + '.json');
  fS.mkdirSync(path.dirname(keysFile), { recursive: true });
  fS.writeFileSync(keysFile, JSON.stringify({ providers: { stubprov: { name: 'Stub', baseUrl: 'http://127.0.0.1:' + upPort + '/v1', apiKey: 'test-key' } } }));

  server = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT)], { cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, { LLMCHESS_KEYS: keysFile }) });
  const up = await waitHealth(40);   // ~6s 上限
  ok(up, '服务启动 + GET /api/health → 200');

  // 静态托管 + ETag/304
  const home = await req('GET', '/');
  ok(home.status === 200 && /<!DOCTYPE html>/i.test(home.body), 'GET / → 200 index.html');
  const etag = home.headers.etag;
  ok(!!etag, '静态响应带 ETag');
  const cached = await req('GET', '/', null, { 'If-None-Match': etag });
  ok(cached.status === 304, 'If-None-Match 命中 → 304');

  // 404 / 路径穿越 403 / 畸形编码 400
  const nf = await req('GET', '/no/such/file.js');
  ok(nf.status === 404, 'GET /no/such/file.js → 404');
  const trav = await req('GET', '/' + encodeURIComponent('../') + 'server.js');
  ok(trav.status === 403, '路径穿越 (../server.js) → 403');
  const bad = await req('GET', '/%zz');
  ok(bad.status === 400, '畸形百分号编码 (/%zz) → 400 (不崩连接)');

  // CORS 预检
  const opt = await req('OPTIONS', '/api/chat');
  ok(opt.status === 204 && !!opt.headers['access-control-allow-origin'], 'OPTIONS /api/chat → 204 + ACAO');

  // /api/chat 参数校验 (不触上游: 均在 relay 之前被 400 拦下)
  const badJson = await req('POST', '/api/chat', '{not json', { 'Content-Type': 'application/json' });
  ok(badJson.status === 400, 'POST /api/chat 非法 JSON → 400');
  const noProv = await postChat({ model: 'x', messages: [] });
  ok(noProv.status === 400, '未知服务商 → 400');

  // 第24轮 二期: providers 形状+无密钥泄漏 / HEAD / 静态 MIME (manifest+icon) / GET 方法守卫
  const prov = await req('GET', '/api/providers');
  let provList = null;
  try { provList = (JSON.parse(prov.body) || {}).providers; } catch (eP) {}
  ok(prov.status === 200 && Array.isArray(provList) && provList.length > 0, 'GET /api/providers → 200 + 非空 providers 数组');
  ok(Array.isArray(provList) && provList.every(function (p) { return !('apiKey' in p); }) && !/"apiKey"/.test(prov.body),
    'providers 响应体无 apiKey 字段泄漏 (仅 hasKey 布尔)');
  const head = await req('HEAD', '/');
  ok(head.status === 200 && !!head.headers.etag && head.body === '', 'HEAD / → 200 + ETag + 空 body (Node HEAD 抑制)');
  const man = await req('GET', '/manifest.json');
  ok(man.status === 200 && /application\/json/.test(man.headers['content-type'] || ''), 'GET /manifest.json → 200 application/json (PWA)');
  const icon = await req('GET', '/ui/icon.svg');
  ok(icon.status === 200 && /image\/svg\+xml/.test(icon.headers['content-type'] || ''), 'GET /ui/icon.svg → 200 image/svg+xml (favicon/manifest 图标)');
  const getChat = await req('GET', '/api/chat');
  ok(getChat.status === 404, 'GET /api/chat (非 POST) → 404 (方法守卫落到静态分支, 且不耗限流窗口)');

  // 第26轮 三期: 根级 sw.js 托管 / POST 方法守卫对称 / 空体 400 / health 形状 / 2MB 请求体上限
  const swResp = await req('GET', '/sw.js');
  ok(swResp.status === 200 && /javascript/.test(swResp.headers['content-type'] || ''), 'GET /sw.js → 200 + JS MIME (PWA 离线壳根级托管)');
  const postProv = await req('POST', '/api/providers', '{}', { 'Content-Type': 'application/json' });
  ok(postProv.status === 404, 'POST /api/providers (非 GET) → 404 (与 GET /api/chat 方法守卫对称)');
  const emptyBody = await req('POST', '/api/chat', '', { 'Content-Type': 'application/json' });
  ok(emptyBody.status === 400, 'POST /api/chat 空请求体 → 400');
  const health = await req('GET', '/api/health');
  let healthShape = false;
  try { const hj = JSON.parse(health.body) || {}; healthShape = hj.ok === true && hj.relay === true && !!hj.version; } catch (eH) {}
  ok(health.status === 200 && healthShape, 'GET /api/health → 形状 {ok,relay,version} (前端 relayAvailable 探测依赖)');
  const huge = await req('POST', '/api/chat', Buffer.alloc(2 * 1024 * 1024 + 1024, 97).toString('utf8'), { 'Content-Type': 'application/json' });
  ok(huge.status === 0, 'POST /api/chat 请求体 >2MB → 连接中断 (readBody 上限防 OOM)');

  // 第27轮 四期: 前缀穿越加固 / 错误 ETag / sw.js 304 / 静态路径预检
  const fs = require('fs');
  const sibDir = path.join(ROOT, '..', 'LLM-chess-guard-' + process.pid);   // 同名前缀兄弟目录 — 裸 startsWith(ROOT) 会放行
  let trav2 = null;
  try {
    fs.mkdirSync(sibDir, { recursive: true });
    fs.writeFileSync(path.join(sibDir, 'secret.txt'), 'TOP-SECRET');
    trav2 = await req('GET', '/' + encodeURIComponent('../') + 'LLM-chess-guard-' + process.pid + '/secret.txt');
  } finally {
    try { fs.rmSync(sibDir, { recursive: true, force: true }); } catch (eRm) {}
  }
  ok(trav2 && trav2.status === 403, '前缀穿越 (兄弟同名前缀目录 …/LLM-chess-guard-N/secret.txt) → 403 (按路径段比对)');
  const wrongEtag = await req('GET', '/', null, { 'If-None-Match': '"bogus-etag"' });
  ok(wrongEtag.status === 200, 'If-None-Match 不命中 → 200 全量响应');
  const sw304 = await req('GET', '/sw.js', null, { 'If-None-Match': swResp.headers.etag });
  ok(sw304.status === 304, 'If-None-Match 命中 /sw.js → 304 (SW 更新检查省带宽)');
  const optStatic = await req('OPTIONS', '/');
  ok(optStatic.status === 204 && !!optStatic.headers['access-control-allow-origin'], 'OPTIONS / (静态路径) → 204 + ACAO (预检处理器全局, 不限 /api)');

  // 第29轮五期: 真实中继穿越 (本地 stub 上游) — 回归 v1.0.3 起的 req 脱作用域崩进程 bug
  const relayRes = await postChat({ provider: 'stubprov', model: 'stub-model', messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'usr' }] });
  ok(relayRes.status === 200, '中继穿越: POST /api/chat (stub 上游) → 200');
  ok(relayRes.body.indexOf('upstream-ok') >= 0, '中继穿越: 上游应答原文透传 (SSE 帧含 content)');
  const healthAfter = await req('GET', '/api/health');
  ok(healthAfter.status === 200, '中继穿越后: 服务进程存活 (v1.0.3 起此处曾 ReferenceError 崩溃)');
  const clampRes = await postChat({ provider: 'stubprov', model: 'stub-model', messages: [{ role: 'user', content: 'x' }], max_tokens: 999999 });
  ok(clampRes.status === 200 && clampRes.body.indexOf('"echo_max_tokens":32768') >= 0, 'max_tokens 钳制: 999999 → 转发 32768 (上游回显断言)');

  // 第28轮五期: Content-Type 门禁 + 404 no-store
  const ctBad = await req('POST', '/api/chat', '{"provider":"x"}', { 'Content-Type': 'text/plain' });
  ok(ctBad.status === 415, 'POST /api/chat text/plain → 415 (Content-Type 门禁, 无声明仍宽松放行)');
  const nf404 = await req('GET', '/no-such-page-' + process.pid);
  ok(nf404.status === 404 && nf404.headers['cache-control'] === 'no-store', '404 → Cache-Control no-store (负面响应不入缓存)');

  // 限流秒窗: 连发 12 个请求 (8/s 上限), 至少一个 429
  // (前 8 个可能 400/429 交错, 只断言出现 429 — 限流先于业务校验执行)
  const burst = [];
  for (let i = 0; i < 12; i++) burst.push(postChat({ provider: 'no-such-prov-' + i, model: 'x', messages: [] }));
  const burstRes = await Promise.all(burst);
  ok(burstRes.some(function (r) { return r.status === 429; }), '限流: 单秒 12 连发出现 429 (8/s 窗)');

  finish();
}

function finish() {
  try { if (server) server.kill(); } catch (e) {}
  try { upstream.close(); } catch (eU) {}
  try { fs.rmSync(keysFile, { force: true }); } catch (eK) {}
  setTimeout(function () {
    console.log('_server_http (port ' + PORT + '):');
    console.log(results.join('\n'));
    console.log((results.length - failed) + '/' + results.length + ' PASS' + (failed ? ', ' + failed + ' FAILED' : ''));
    process.exit(failed ? 1 : 0);
  }, 150);
}

// 90s 整体兜底 (服务起不来/挂起时不卡死 CI)
setTimeout(function () {
  console.error('_server_http: global timeout');
  try { if (server) server.kill(); } catch (e) {}
  process.exit(2);
}, 90 * 1000).unref();

main().catch(function (e) {
  console.error('_server_http crashed:', e);
  finish();
});
