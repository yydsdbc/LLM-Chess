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
  // 第37轮: 扩展为双协议 stub — openai 回显 shape / anthropic 内容 shape / stub-err 错误分支; 并捕获每请求上游侧 头+体
  let lastUpReq = null;
  const upstream = http.createServer(function (uReq, uRes) {
    let ubody = '';
    uReq.on('data', function (c) { ubody += c; });
    uReq.on('end', function () {
      lastUpReq = { headers: uReq.headers, body: ubody };
      var jb = {};
      try { jb = JSON.parse(ubody) || {}; } catch (eP) {}
      if (jb.model === 'stub-err') {   // anthropic 错误映射路径 (type:error → 客户端 JSON error)
        uRes.writeHead(400, { 'Content-Type': 'application/json' });
        return uRes.end(JSON.stringify({ type: 'error', error: { message: 'boom-claude' } }));
      }
      if (String(jb.model || '').indexOf('stub-a') === 0) {   // anthropic 协议 content shape
        uRes.writeHead(200, { 'Content-Type': 'application/json' });
        return uRes.end(JSON.stringify({ content: [{ type: 'text', text: '{"from":"h3","to":"e3","summary":"anthropic-ok","confidence":0.7}' }], usage: { input_tokens: 12, output_tokens: 6 } }));
      }
      if (jb.stream) {   // 第39轮: OpenAI 流式透传路径 (原测试只用非流式, SSE 直通零覆盖)
        uRes.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' });
        uRes.write('data: ' + JSON.stringify({ choices: [{ delta: { content: 'stream-chunk' } }] }) + '\n\n');
        uRes.write('data: [DONE]\n\n');
        return uRes.end();
      }
      var echo = jb.max_tokens || 0;
      uRes.writeHead(200, { 'Content-Type': 'application/json' });
      uRes.end(JSON.stringify({ echo_max_tokens: echo, choices: [{ message: { content: '{"from":"h3","to":"e3","summary":"upstream-ok","confidence":0.8}' } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } }));
    });
  });
  await new Promise(function (r) { upstream.listen(0, '127.0.0.1', r); });
  const upPort = upstream.address().port;
  const fS = require('fs');   // 第29轮: 文件级 const fs 在 133 行 (TDZ), main 顶部先取独立引用
  const keysFile = path.join(ROOT, 'temp', 'guard-keys-' + process.pid + '.json');
  fS.mkdirSync(path.dirname(keysFile), { recursive: true });
  fS.writeFileSync(keysFile, JSON.stringify({ providers: { stubprov: { name: 'Stub', baseUrl: 'http://127.0.0.1:' + upPort + '/v1', apiKey: 'test-key' }, stubanthropic: { name: 'StubA', baseUrl: 'http://127.0.0.1:' + upPort + '/v1', protocol: 'anthropic', apiKey: 'anthropic-test-key' }, stubnokey: { name: 'StubNoKey', baseUrl: 'http://127.0.0.1:' + upPort + '/v1', apiKey: '' } } }));

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

  // 第37轮: anthropic 协议中继穿越 — 最复杂的转换路径 (system 提取/同角色合并/鉴权头/SSE 合成/错误映射) 此前零自动化覆盖
  // 节奏: 前 4 个 chat POST 同秒内就绪 → 先睡一个完整秒窗, 让本块 + 后续 415 断言均匀落在新秒窗 (8/s 限流下同秒连发自己打自己)
  await new Promise(function (r) { setTimeout(r, 1100); });
  const antRes = await postChat({ provider: 'stubanthropic', model: 'stub-a', messages: [{ role: 'system', content: 'SYS-HI' }, { role: 'user', content: 'u1' }, { role: 'user', content: 'u2' }], max_tokens: 999999 });
  ok(antRes.status === 200 && /text\/event-stream/.test(antRes.headers['content-type'] || ''), 'anthropic 中继: POST /api/chat (stub anthropic 上游) → 200 + SSE 帧');
  ok(antRes.body.indexOf('anthropic-ok') >= 0 && antRes.body.indexOf('[DONE]') >= 0, 'anthropic 中继: 响应转换合成的 SSE 帧含内容 + 收尾 [DONE]');
  ok(antRes.body.indexOf('"total_tokens":18') >= 0, 'anthropic 中继: usage input+output → total_tokens 18 换算正确');
  let antUp = null;
  try { antUp = JSON.parse(lastUpReq.body); } catch (eA) {}
  ok(!!antUp && antUp.system === 'SYS-HI', 'anthropic 中继: system 消息提取为独立 system 字段 (不进 messages)');
  ok(!!antUp && Array.isArray(antUp.messages) && antUp.messages.length === 1 && antUp.messages[0].role === 'user' && antUp.messages[0].content === 'u1\nu2', 'anthropic 中继: 相邻同角色消息合并 (u1+u2 → 单 user, 满足交替约束)');
  ok(!!antUp && antUp.max_tokens === 32768, 'anthropic 中继: max_tokens 钳制 999999 → 32768 (与 openai 路径同口径)');
  ok(!!lastUpReq && lastUpReq.headers['x-api-key'] === 'anthropic-test-key' && lastUpReq.headers['anthropic-version'] === '2023-06-01', 'anthropic 中继: 上游鉴权头 x-api-key + anthropic-version');
  const antErr = await postChat({ provider: 'stubanthropic', model: 'stub-err', messages: [{ role: 'assistant', content: 'a1' }] });
  let antErrUp = null;
  try { antErrUp = JSON.parse(lastUpReq.body); } catch (eE2) {}
  ok(antErr.status === 400 && antErr.body.indexOf('boom-claude') >= 0, 'anthropic 中继: 上游 type:error → 客户端 4xx + JSON error 原文 (不合成虚假成功帧)');
  ok(!!antErrUp && Array.isArray(antErrUp.messages) && antErrUp.messages.length === 2 && antErrUp.messages[0].role === 'user' && antErrUp.messages[0].content === '(开局)' && antErrUp.messages[1].role === 'assistant', 'anthropic 中继: 首条 assistant 前 unshift user (开局) — 交替约束补位不吞原消息');

  // 第39轮: 请求侧校验缺口 (未配 Key / 缺字段) + OpenAI 流式透传 + 目录与反斜杠边界 (server.js 零改动)
  const noKey = await postChat({ provider: 'stubnokey', model: 'x', messages: [{ role: 'user', content: 'x' }] });
  ok(noKey.status === 400 && /未配置 apiKey/.test(noKey.body), '未配置 apiKey 的服务商 → 400 + 可操作提示 (不触上游)');
  const missModel = await postChat({ provider: 'stubprov', messages: [{ role: 'user', content: 'x' }] });
  ok(missModel.status === 400, '缺 model/messages → 400 (参数校验先于中继)');
  const streamRes = await postChat({ provider: 'stubprov', model: 'stub-model', messages: [{ role: 'user', content: 's' }], stream: true });
  ok(streamRes.status === 200 && /text\/event-stream/.test(streamRes.headers['content-type'] || '') && streamRes.body.indexOf('stream-chunk') >= 0 && streamRes.body.indexOf('[DONE]') >= 0, 'openai 中继流式: stream:true → 上游 SSE 帧直通 (含内容与 [DONE])');
  ok(streamRes.headers['cache-control'] === 'no-store', 'openai 中继流式: Cache-Control no-store (流式响应不缓存)');
  ok(relayRes.headers['access-control-allow-origin'] === '*', 'openai 中继非流式: 响应带 ACAO (无 Origin → *)');
  let healthVer = '', pkgVer = '';
  try { healthVer = JSON.parse(health.body).version; } catch (eV1) {}
  try { pkgVer = JSON.parse(require('fs').readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch (eV2) {}
  ok(!!healthVer && healthVer === pkgVer, '/api/health.version == package.json version (' + healthVer + ')');
  const dirReq = await req('GET', '/ui');
  ok(dirReq.status === 404, 'GET /ui (目录) → 404 (EISDIR 不崩连接)');
  const bslash = await req('GET', '/' + encodeURIComponent('..\\') + 'server.js');
  ok(bslash.status !== 200 && bslash.body.indexOf('API Key 只保存在服务端') < 0, '反斜杠穿越 (..\\server.js) → 非 200 且不泄露源码 (Windows/POSIX 双向断言)');

  // 第37轮: CORS 策略 (req_origin_safe 零覆盖) — localhost 回显 / 异源与无 Origin 均 '*' (走 OPTIONS 预检, 不耗限流窗)
  const or1 = await req('OPTIONS', '/api/chat', null, { Origin: 'http://localhost:5173' });
  ok(or1.status === 204 && or1.headers['access-control-allow-origin'] === 'http://localhost:5173', 'CORS 策略: localhost Origin → ACAO 回显同源');
  const or2 = await req('OPTIONS', '/api/chat', null, { Origin: 'https://evil.example.com' });
  ok(or2.status === 204 && or2.headers['access-control-allow-origin'] === '*', 'CORS 策略: 异源 Origin → ACAO * (不泄露同源回显)');
  const or3 = await req('OPTIONS', '/api/chat', null, {});
  ok(or3.status === 204 && or3.headers['access-control-allow-origin'] === '*', 'CORS 策略: 无 Origin (file://) → ACAO *');

  // 第37轮: 二次编码穿越边界 — %252e.. 只解码一层不还原为 ../ → 404 非文件泄露 (防护纵深实证)
  const dbl = await req('GET', '/%252e%252e%252fserver.js');
  ok(dbl.status === 404, '二次编码穿越 (%252e%252e%252fserver.js) → 404 (单次 decode, 无二次解码, 不泄露文件)');

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
  ok(burstRes.some(function (r) { return r.status === 429 && r.headers['retry-after'] === '60'; }), '限流 429 带 Retry-After: 60 (客户端退避依据)');

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
