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
let server2 = null;   // 第48轮: 第二实例 (独立限流表, 见文末第48轮块)
const results = [];
let failed = 0;
function ok(cond, name) {
  results.push((cond ? '  [PASS] ' : '  [FAIL] ') + name);
  if (!cond) failed++;
}

function reqTo(base, method, urlPath, body, headers) {
  return new Promise(function (resolve) {
    const r = http.request(base + urlPath, { method: method, headers: headers || {} }, function (res) {
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
function req(method, urlPath, body, headers) { return reqTo(BASE, method, urlPath, body, headers); }

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
      lastUpReq = { headers: uReq.headers, body: ubody, url: uReq.url };   // 第45轮: 记录上游请求路径 (URL 构造口径此前零覆盖)
      var jb = {};
      try { jb = JSON.parse(ubody) || {}; } catch (eP) {}
      if (jb.model === 'stub-err') {   // anthropic 错误映射路径 (type:error → 客户端 JSON error)
        uRes.writeHead(400, { 'Content-Type': 'application/json' });
        return uRes.end(JSON.stringify({ type: 'error', error: { message: 'boom-claude' } }));
      }
      /* 第46轮: 上游非 200 透传 — 放在 stream 分支之前, 使同一条 stub 同时覆盖流式/非流式两条路径
         (server.js 的 `res.writeHead(upRes.statusCode || 502, …)` 若被改成 200, llm_agent 会把错误体
         当成功帧解析, 最终报「流式返回为空」或泛化中继错误, 用户看不到「HTTP 401」这句可操作提示)。 */
      if (jb.model === 'stub-401') {
        uRes.writeHead(401, { 'Content-Type': 'application/json' });
        return uRes.end(JSON.stringify({ error: { message: 'bad key 401' } }));
      }
      /* 第48轮: 上游「连上之后中途断连」— 写完头 + 半截体再拆 socket。修复前非流式两条路径
         (relay 的 !wantStream 分支与 relayAnthropic) 既不 emit 'end' 也没有 'error' 监听,
         于是中继永不响应: 实测客户端挂到超时 (12s 无任何字节), 而不是像「连不上」那样 502。 */
      if (jb.model === 'stub-reset') {
        uRes.writeHead(200, { 'Content-Type': 'application/json' });
        uRes.write('{"partial":');
        setTimeout(function () { try { uRes.socket.destroy(); } catch (eRD) {} }, 20);
        return;
      }
      /* 第48轮: 上游回超大响应体 — 修复前非流式路径无任何上限, 一路 Buffer.concat 撑爆中继内存。 */
      if (jb.model === 'stub-huge') {
        uRes.writeHead(200, { 'Content-Type': 'application/json' });
        const chunk1m = Buffer.alloc(1024 * 1024, 97);
        let sentMb = 0;
        const iv = setInterval(function () {
          if (sentMb >= 17) { clearInterval(iv); return uRes.end(); }   // 17MB > 16MB 上限
          sentMb++; uRes.write(chunk1m);
        }, 1);
        return;
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
  /* 第45轮: 一个「必定拒绝连接」的端口 (先监听再立即释放) — 用来驱动上游错误分支 (server.js 的 502 映射零覆盖) */
  const deadSrv = http.createServer(function () {});
  await new Promise(function (r) { deadSrv.listen(0, '127.0.0.1', r); });
  const deadPort = deadSrv.address().port;
  await new Promise(function (r) { deadSrv.close(r); });
  /* 第45轮: stubprov 的 baseUrl **故意带尾斜杠** — 去掉它, 「baseUrl 去尾斜杠」这条判据就无从区分
     (无尾斜杠时拼不拼都得到同一路径, 断言会静默变成恒真); stubglm 的 chatPath **故意不等于默认值** —
     否则「chatPath 生效」与「回落默认」得到同一路径, 同样恒真。 */
  /* 第46轮: stubprov 带 models 数组 — /api/providers 的 models 是前端模型下拉预填的唯一来源,
     丢掉它模型框静默变空白 (用户必须手打模型名); stubnokey 不带 models 以钉住「缺省 → 空数组」。
     stubantdead 指向必死端口, 用来覆盖 anthropic 路径的上游连接失败 502 (原仅 openai 路径有覆盖)。
     stubanthropic 的 baseUrl **不含 /v1** — 与真实配置 (https://api.anthropic.com) 同形, 这样
     「默认 chatPath /v1/messages 生效」才可断言 (baseUrl 自带 /v1 时会得到 /v1/v1/messages, 断言变成
     钉住一个拼接产物而非真实口径)。 */
  fS.writeFileSync(keysFile, JSON.stringify({ providers: { stubprov: { name: 'Stub', baseUrl: 'http://127.0.0.1:' + upPort + '/v1/', apiKey: 'test-key', models: ['m-a', 'm-b'] }, stubanthropic: { name: 'StubA', baseUrl: 'http://127.0.0.1:' + upPort, protocol: 'anthropic', apiKey: 'anthropic-test-key' }, stubantdead: { name: 'StubAntDead', baseUrl: 'http://127.0.0.1:' + deadPort + '/v1', protocol: 'anthropic', apiKey: 'dead-ant-key' }, stubnokey: { name: 'StubNoKey', baseUrl: 'http://127.0.0.1:' + upPort + '/v1', apiKey: '' }, stubheaders: { name: 'StubHdr', baseUrl: 'http://127.0.0.1:' + upPort + '/v1', apiKey: 'test-key', headers: { 'X-Custom-Auth': 'hdr-ok' } }, stubglm: { name: 'StubGLM', baseUrl: 'http://127.0.0.1:' + upPort + '/tokenrhythm/v1', chatPath: '/v2/chat', apiKey: 'glm-key' }, stubdead: { name: 'StubDead', baseUrl: 'http://127.0.0.1:' + deadPort + '/v1', apiKey: 'dead-key' }, stubreset: { name: 'StubReset', baseUrl: 'http://127.0.0.1:' + upPort + '/v1', apiKey: 'reset-key' }, stubresetant: { name: 'StubResetA', baseUrl: 'http://127.0.0.1:' + upPort, protocol: 'anthropic', apiKey: 'reset-ant-key' }, stubhuge: { name: 'StubHuge', baseUrl: 'http://127.0.0.1:' + upPort + '/v1', apiKey: 'huge-key' } } }));   // 第48轮: 后三个供「中途断连 / 超大响应体」断言 (另起实例跑, 见文末第48轮块)

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
  /* 第46轮: 静态 Cache-Control 值 — 只钉了 ETag/304, 指令值本身没断言。改成 max-age 后用户部署新代码
     强刷仍拿到旧 JS (而 ETag 校验在强刷下被绕过), 且旧写法对本套件完全不可见。 */
  ok(home.headers['cache-control'] === 'no-cache', '静态响应 Cache-Control: no-cache (改成 max-age 会让部署后强刷仍拿旧 JS, 实为 ' + home.headers['cache-control'] + ')');

  // 404 / 路径穿越 403 / 畸形编码 400
  const nf = await req('GET', '/no/such/file.js');
  ok(nf.status === 404, 'GET /no/such/file.js → 404');
  const trav = await req('GET', '/' + encodeURIComponent('../') + 'server.js');
  ok(trav.status === 403, '路径穿越 (../server.js) → 403');
  const bad = await req('GET', '/%zz');
  ok(bad.status === 400, '畸形百分号编码 (/%zz) → 400 (不崩连接)');

  /* ── 第47轮: 静态托管敏感路径黑名单 + 空字节守卫 ──
     (a) 原实现只有「穿越」防护 (路径须落在 ROOT 内), 而 /config/keys.json 是 ROOT 内的**正常路径** —
         实测逐字返回含真实 apiKey 的密钥文件 (200), /.git/config 同样可取, 与 README「密钥永不离开服务器」
         直接矛盾; (b) decodeURIComponent('/%00') 得到含 \u0000 的路径, 它能通过前缀校验而 fs.stat 对含
         空字节路径**同步抛出** ERR_INVALID_ARG_VALUE → 逃出 serveStatic → async 处理器 promise 拒绝 →
         Node 18+ 终止进程 (实测 GET /%00 后 /api/health ECONNREFUSED)。后者必须另断言进程仍存活。 */
  const keysReq = await req('GET', '/config/keys.json');
  ok(keysReq.status === 403 && keysReq.body.indexOf('apiKey') < 0, 'GET /config/keys.json → 403 且不含 apiKey (修复前 200 逐字返回真实密钥文件)');
  const keysEx = await req('GET', '/config/keys.example.json');
  ok(keysEx.status === 403, 'GET /config/keys.example.json → 403 (整个 config/ 目录不对外, 非逐个文件列举)');
  const gitCfg = await req('GET', '/.git/config');
  ok(gitCfg.status === 403, 'GET /.git/config → 403 (点开头目录一律拒绝; 该文件可能含远端凭据)');
  const logsReq = await req('GET', '/logs/anything.txt');
  ok(logsReq.status === 403, 'GET /logs/* → 403 (运行时产物不对外)');
  const nullByte = await req('GET', '/%00');
  ok(nullByte.status === 400, 'GET /%00 (空字节路径) → 400 (修复前 fs.stat 同步抛出 → 进程终止, 实为 ' + nullByte.status + ')');
  const aliveAfterNullByte = await req('GET', '/api/health');
  ok(aliveAfterNullByte.status === 200, '空字节路径之后服务进程仍存活 (修复前一个 GET 即远程打死中继)');
  const stillHome = await req('GET', '/');
  ok(stillHome.status === 200, '黑名单不误伤正常静态资源 (GET / 仍 200)');

  // CORS 预检
  const opt = await req('OPTIONS', '/api/chat');
  ok(opt.status === 204 && !!opt.headers['access-control-allow-origin'], 'OPTIONS /api/chat → 204 + ACAO');
  /* 第46轮: 预检的**头值**此前只断言了 ACAO 存在 — 方法/头清单一旦收窄, 异源浏览器会直接拦掉 /api/chat,
     前端只看到一句「Failed to fetch」(无任何服务端线索)。 */
  ok(opt.headers['access-control-allow-methods'] === 'POST, GET, OPTIONS' && opt.headers['access-control-allow-headers'] === 'Content-Type, Authorization',
    'OPTIONS 预检头值完整 (方法/头清单收窄会让异源调用被浏览器拦成「Failed to fetch」)');

  // /api/chat 参数校验 (不触上游: 均在 relay 之前被 400 拦下)
  const badJson = await req('POST', '/api/chat', '{not json', { 'Content-Type': 'application/json' });
  ok(badJson.status === 400, 'POST /api/chat 非法 JSON → 400');
  const noProv = await postChat({ model: 'x', messages: [] });
  ok(noProv.status === 400, '未知服务商 → 400');
  ok(noProv.headers['access-control-allow-origin'] === '*', '早期拒绝 (400 未知服务商) 带 ACAO (异源页才看得到错误明细)');

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
  ok(health.headers['x-content-type-options'] === 'nosniff' && health.headers['referrer-policy'] === 'no-referrer', '安全响应头 (nosniff + referrer-policy 全分支) — 第49轮');
  let healthShape = false;
  try { const hj = JSON.parse(health.body) || {}; healthShape = hj.ok === true && hj.relay === true && !!hj.version && typeof hj.uptime_s === 'number'; } catch (eH) {}
  ok(health.status === 200 && healthShape, 'GET /api/health → 形状 {ok,relay,version} (前端 relayAvailable 探测依赖)');
  /* 第47轮: 早期拒绝分支与两条探测端点的 ACAO — 本仓设计支持异源/file:// 调试 (中继各分支与 OPTIONS 都带),
     而 health/providers 与 429/415/400 系列一直漏着: 异源页只拿到不透明的「Failed to fetch」, 看不到
     「未配置 apiKey」「rate limited」这类可操作提示。 */
  ok(health.headers['access-control-allow-origin'] === '*', 'health 带 ACAO (异源页的 relayAvailable 探测才读得到)');
  ok(prov.headers['access-control-allow-origin'] === '*', 'providers 带 ACAO (异源页才读得到服务商列表)');
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
  const relayUpPath = lastUpReq && lastUpReq.url;   // 第45轮: 钉住「baseUrl 去尾斜杠 + 默认 chatPath」的拼接结果
  ok(relayRes.status === 200, '中继穿越: POST /api/chat (stub 上游) → 200');
  ok(relayRes.body.indexOf('upstream-ok') >= 0, '中继穿越: 上游应答原文透传 (SSE 帧含 content)');
  const healthAfter = await req('GET', '/api/health');
  ok(healthAfter.status === 200, '中继穿越后: 服务进程存活 (v1.0.3 起此处曾 ReferenceError 崩溃)');
  const clampRes = await postChat({ provider: 'stubprov', model: 'stub-model', messages: [{ role: 'user', content: 'x' }], max_tokens: 999999 });
  ok(clampRes.status === 200 && clampRes.body.indexOf('"echo_max_tokens":32768') >= 0, 'max_tokens 钳制: 999999 → 转发 32768 (上游回显断言)');

  /* ── 第43轮: 上游请求构造口径 (server.js 零改动) ──
     providerCfg.headers 是 v3.5 文档承诺的能力 (部分网关需额外鉴权头), 此前零自动化覆盖;
     thinking 字段只对 GLM 系 (bigmodel/tokenrhythm) 透传, 其余上游收到未知字段会直接 400 — 属真实回归风险;
     缺省值 (temperature/max_tokens/stream) 是「不传就按默认」的口径, 一旦漂移会静默改变上游采样行为。 */
  const hdrRes = await postChat({ provider: 'stubheaders', model: 'stub-model', messages: [{ role: 'user', content: 'h' }], thinking: true });
  ok(hdrRes.status === 200, '上游请求构造: 带自定义 headers 的服务商可正常中继 (200)');
  let hdrUp = null;
  try { hdrUp = { h: lastUpReq.headers, b: JSON.parse(lastUpReq.body) }; } catch (eH2) {}
  ok(!!hdrUp && hdrUp.h['x-custom-auth'] === 'hdr-ok', '上游请求构造: providerCfg.headers 自定义头透传到上游 (v3.5 特性此前零覆盖)');
  ok(!!hdrUp && hdrUp.h['content-type'] === 'application/json' && hdrUp.h.authorization === 'Bearer test-key',
    '上游请求构造: 自定义头合并不覆盖默认头 (Content-Type / Authorization 仍在)');
  ok(!!hdrUp && !('thinking' in hdrUp.b), '上游请求构造: 非 GLM 系上游不注入 thinking 字段 (严格校验的上游会 400)');
  ok(!!hdrUp && hdrUp.b.temperature === 0.3 && hdrUp.b.max_tokens === 2048 && hdrUp.b.stream === false && !('stream_options' in hdrUp.b),
    '上游请求构造: 缺省口径 temperature 0.3 / max_tokens 2048 / stream false / 无 stream_options');
  /* 第46轮: temperature 用 0 而非 0.9 — 0 是 falsy, 缺省表达式一旦漂移成 `payload.temperature || 0.3`,
     显式 0 会被静默改成 0.3 (采样行为改变, 上游侧才看得见); 用 0.9 时该回归仍然全绿, 故换成 0 才真正钉住。
     content 用中文: 同时钉住 Content-Length 必须是**字节**长度 (中文 prompt 下 body.length ≠ 字节数)。 */
  const tRes = await postChat({ provider: 'stubprov', model: 'stub-model', messages: [{ role: 'user', content: '炮二平五' }], temperature: 0, max_tokens: 512 });
  let tUp = null;
  try { tUp = JSON.parse(lastUpReq.body); } catch (eT2) {}
  ok(tRes.status === 200 && !!tUp && tUp.temperature === 0 && tUp.max_tokens === 512, '上游请求构造: 显式 temperature: 0 不被缺省覆盖 (falsy 陷阱; 原用 0.9 时 || 0.3 的回归仍会通过)');
  /* Content-Length 必须按**字节**长度。注意不能写成「头值 == 已收 body 的字节数」— 那样在回归发生时
     上游只收到被截断的 body, 两侧同时变小, 断言恒真 (第45轮「恒真断言」教训)。故比对服务端**应发**的
     字节数: 中文 payload 下 body.length 少算 8 字节 (115 → 107) → 当场红。 */
  const expectUpBody = JSON.stringify({ model: 'stub-model', messages: [{ role: 'user', content: '炮二平五' }], temperature: 0, max_tokens: 512, stream: false });
  ok(!!lastUpReq && lastUpReq.headers['content-length'] === String(Buffer.byteLength(expectUpBody)),
    '上游请求构造: Content-Length 按字节长度 (写成 body.length 会少算 → 上游收到截断 JSON; 实测 ' + (lastUpReq && lastUpReq.headers['content-length']) + ' 应为 ' + Buffer.byteLength(expectUpBody) + ')');
  ok(!!tUp && tUp.messages[0].content === '炮二平五', '上游请求构造: 中文 prompt 完整到达上游 (字节口径错误时上游收到截断/乱码 payload)');

  // 第37轮: anthropic 协议中继穿越 — 最复杂的转换路径 (system 提取/同角色合并/鉴权头/SSE 合成/错误映射) 此前零自动化覆盖
  // 节奏: 前 4 个 chat POST 同秒内就绪 → 先睡一个完整秒窗, 让本块 + 后续 415 断言均匀落在新秒窗 (8/s 限流下同秒连发自己打自己)
  await new Promise(function (r) { setTimeout(r, 1100); });
  const antRes = await postChat({ provider: 'stubanthropic', model: 'stub-a', messages: [{ role: 'system', content: 'SYS-HI' }, { role: 'user', content: 'u1' }, { role: 'user', content: 'u2' }], max_tokens: 999999 });
  ok(antRes.status === 200 && /text\/event-stream/.test(antRes.headers['content-type'] || ''), 'anthropic 中继: POST /api/chat (stub anthropic 上游) → 200 + SSE 帧');
  ok(antRes.body.indexOf('anthropic-ok') >= 0 && antRes.body.indexOf('[DONE]') >= 0, 'anthropic 中继: 响应转换合成的 SSE 帧含内容 + 收尾 [DONE]');
  ok(antRes.body.indexOf('"total_tokens":18') >= 0, 'anthropic 中继: usage input+output → total_tokens 18 换算正确');
  /* 第46轮: 上游 URL 构造 (anthropic 路径此前零覆盖 — 默认路径写错则上游 404, 前端只看到
     「anthropic 响应解析失败」这种指不到根因的提示) */
  ok(!!lastUpReq && lastUpReq.url === '/v1/messages', 'anthropic 中继: 上游 URL 为 /v1/messages (默认路径错则上游 404, 前端只见「响应解析失败」, 实为 ' + (lastUpReq && lastUpReq.url) + ')');
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
  ok(antErr.headers['access-control-allow-origin'] === '*', 'anthropic 中继: 错误响应带 ACAO (与 openai 路径同口径, file:// 调试才读得到错误明细)');
  ok(!!antErrUp && Array.isArray(antErrUp.messages) && antErrUp.messages.length === 2 && antErrUp.messages[0].role === 'user' && antErrUp.messages[0].content === '(开局)' && antErrUp.messages[1].role === 'assistant', 'anthropic 中继: 首条 assistant 前 unshift user (开局) — 交替约束补位不吞原消息');

  // 第39轮: 请求侧校验缺口 (未配 Key / 缺字段) + OpenAI 流式透传 + 目录与反斜杠边界 (server.js 零改动)
  const noKey = await postChat({ provider: 'stubnokey', model: 'x', messages: [{ role: 'user', content: 'x' }] });
  ok(noKey.status === 400 && /未配置 apiKey/.test(noKey.body), '未配置 apiKey 的服务商 → 400 + 可操作提示 (不触上游)');
  const missModel = await postChat({ provider: 'stubprov', messages: [{ role: 'user', content: 'x' }] });
  ok(missModel.status === 400, '缺 model/messages → 400 (参数校验先于中继)');
  const streamRes = await postChat({ provider: 'stubprov', model: 'stub-model', messages: [{ role: 'user', content: 's' }], stream: true });
  ok(streamRes.status === 200 && /text\/event-stream/.test(streamRes.headers['content-type'] || '') && streamRes.body.indexOf('stream-chunk') >= 0 && streamRes.body.indexOf('[DONE]') >= 0, 'openai 中继流式: stream:true → 上游 SSE 帧直通 (含内容与 [DONE])');
  ok(streamRes.headers['cache-control'] === 'no-store', 'openai 中继流式: Cache-Control no-store (流式响应不缓存)');
  let streamUp = null;
  try { streamUp = JSON.parse(lastUpReq.body); } catch (eS2) {}
  ok(!!streamUp && streamUp.stream === true && !!streamUp.stream_options && streamUp.stream_options.include_usage === true,
    'openai 中继流式: 请求体带 stream_options.include_usage (上游才会回报用量; 非流式路径已断言不带)');
  ok(relayRes.headers['access-control-allow-origin'] === '*', 'openai 中继非流式: 响应带 ACAO (无 Origin → *)');
  let healthVer = '', pkgVer = '';
  try { healthVer = JSON.parse(health.body).version; } catch (eV1) {}
  try { pkgVer = JSON.parse(require('fs').readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version; } catch (eV2) {}
  ok(!!healthVer && healthVer === pkgVer, '/api/health.version == package.json version (' + healthVer + ')');
  const dirReq = await req('GET', '/ui');
  ok(dirReq.status === 404, 'GET /ui (目录) → 404 (EISDIR 不崩连接)');
  const bslash = await req('GET', '/' + encodeURIComponent('..\\') + 'server.js');
  ok(bslash.status !== 200 && bslash.body.indexOf('API Key 只保存在服务端') < 0, '反斜杠穿越 (..\\server.js) → 非 200 且不泄露源码 (Windows/POSIX 双向断言)');

  /* ── 第45轮: 上游 URL 构造口径 / GLM 系 thinking 正向注入 / providers 元字段 / 上游失败映射 ──
     四者此前都只有「一半」覆盖或零覆盖, 且回归后完全静默:
     (a) baseUrl 尾斜杠若不去掉 → '//v1/chat/completions', 上游 404, 前端只看到泛化的中继错误;
     (b) thinking 只测过「非 GLM 不注入」, 而 GLM 系 (bigmodel/tokenrhythm) 的**注入**从未被断言 —
         漏注入会让 GLM 的思考开关静默失效 (界面上勾了快答模式却没关思考);
     (c) /api/providers 的 hasKey 是前端「已配置」指示的唯一依据, models 供模型下拉预填;
     (d) 上游连不上时的 502 映射 (server.js 的 upReq.on('error') 分支) 零覆盖 — 回归会变成挂起或错状态码。 */
  ok(relayUpPath === '/v1/chat/completions', '上游 URL 构造: baseUrl 尾斜杠去除 + 默认 chatPath /chat/completions (实为 ' + relayUpPath + ')');
  /* 第46轮: thinking 用**对象**形态 (UI 实际发的就是 {type:'enabled', effort:'high'}) — 原测试只发布尔 true,
     而 `!!payload.thinking` 这类回归会把对象压成 true: 布尔断言仍绿, effort 等级却静默丢失 (快答/深度思考
     档位失效)。故改成断言对象逐字段透传, 严格强于原来的布尔断言。 */
  const glmRes = await postChat({ provider: 'stubglm', model: 'stub-model', messages: [{ role: 'user', content: 'g' }], thinking: { type: 'enabled', effort: 'high' } });
  let glmUp = null;
  try { glmUp = { b: JSON.parse(lastUpReq.body), url: lastUpReq.url }; } catch (eG2) {}
  ok(glmRes.status === 200 && !!glmUp && !!glmUp.b.thinking && glmUp.b.thinking.type === 'enabled' && glmUp.b.thinking.effort === 'high',
    '上游请求构造: GLM 系 thinking 对象原样透传 (effort 等级; 用 !!payload.thinking 的回归会静默压成 true)');
  ok(!!glmUp && glmUp.url === '/tokenrhythm/v1/v2/chat', '上游 URL 构造: providerCfg.chatPath 覆盖默认路径 (实为 ' + (glmUp && glmUp.url) + ')');
  const deadRes = await postChat({ provider: 'stubdead', model: 'stub-model', messages: [{ role: 'user', content: 'd' }] });
  ok(deadRes.status === 502 && /relay upstream error/.test(deadRes.body), '上游连接失败 → 502 + relay upstream error (原为挂起/错误状态码)');
  ok(deadRes.headers['access-control-allow-origin'] === '*', '上游连接失败 502 带 ACAO (openai 路径; 异源页才读得到错误明细)');
  /* 第46轮: anthropic 路径的上游连接失败 502 — 原仅 openai 路径有覆盖, 而该分支的 ACAO 一直漏着
     (同文件另一条同类错误分支都带), 异源页只能看到不透明的 CORS 失败。 */
  const antDead = await postChat({ provider: 'stubantdead', model: 'x', messages: [{ role: 'user', content: 'x' }] });
  ok(antDead.status === 502 && /relay upstream error/.test(antDead.body), 'anthropic 上游连接失败 → 502 + relay upstream error (原零覆盖)');
  ok(antDead.headers['access-control-allow-origin'] === '*', 'anthropic 上游连接失败 502 带 ACAO (第46轮补齐, 与 openai 路径同口径)');
  const provStub = (provList || []).filter(function (p) { return p.id === 'stubprov' || p.id === 'stubnokey'; });
  const hasKeyOf = function (id) { var hit = provStub.filter(function (p) { return p.id === id; })[0]; return hit && hit.hasKey; };
  ok(hasKeyOf('stubprov') === true && hasKeyOf('stubnokey') === false, 'providers: hasKey 布尔正确反映是否配置 apiKey (前端「已配置」指示依赖)');
  ok(prov.headers['cache-control'] === 'no-store', 'providers: Cache-Control no-store (服务商列表不得被浏览器缓存)');
  /* 第46轮: name/baseUrl/models 透传 — models 是前端模型下拉预填的唯一来源 (app.js 用它填 model-datalist),
     丢失后模型框静默变空白, 用户必须手打模型名; 未声明 models 的服务商应得空数组而非 undefined。 */
  const pStub = (provList || []).filter(function (p) { return p.id === 'stubprov'; })[0];
  const pNoM = (provList || []).filter(function (p) { return p.id === 'stubnokey'; })[0];
  ok(!!pStub && pStub.name === 'Stub' && /127\.0\.0\.1/.test(pStub.baseUrl || '') && Array.isArray(pStub.models) && pStub.models.join(',') === 'm-a,m-b',
    'providers: name/baseUrl/models 透传 (models 丢失 → 前端模型下拉静默空白)');
  ok(!!pNoM && Array.isArray(pNoM.models) && pNoM.models.length === 0, 'providers: 未声明 models 的服务商 → 空数组 (非 undefined, 前端不会崩)');

  /* ── 第46轮: 上游非 200 状态透传 (流式 + 非流式) + 非对象请求体 ──
     非 200 透传: 两条路径都是 `res.writeHead(upRes.statusCode || 502, …)`: 一旦被改成固定 200, llm_agent
     会把上游的错误体当成功帧解析 (流式尤其致命 — 错误 JSON 不是 SSE, 最终只报「流式返回为空」),
     而 401/429 这类可操作提示 (「HTTP 401 Invalid API key」) 全部消失。
     非对象请求体: JSON.parse('null') 合法返回 null, 原实现下一行读 payload.provider 在 async 处理器里抛
     TypeError, 全仓无 unhandledRejection 兜底 → Node 18+ 直接终止进程。这不是「错误状态码」而是
     「一个 POST 远程打死中继」, 故除状态码外必须另断言进程仍存活 (否则断言自己也会因连接被拒而假绿)。
     节奏: 先睡一个完整秒窗 — 本套件是单 IP 单进程, 秒窗上限 8, 这一组 4 个 POST 必须自成一段。 */
  await new Promise(function (r) { setTimeout(r, 1050); });
  const nullBody = await req('POST', '/api/chat', 'null', { 'Content-Type': 'application/json' });
  ok(nullBody.status === 400, 'POST /api/chat body "null" → 400 (修复前此处抛 TypeError 并终止进程, 实为 ' + nullBody.status + ')');
  const aliveAfterNull = await req('GET', '/api/health');
  ok(aliveAfterNull.status === 200, '非对象请求体之后服务进程仍存活 (修复前一个 POST 即远程打死中继)');
  const up401 = await postChat({ provider: 'stubprov', model: 'stub-401', messages: [{ role: 'user', content: 'k' }] });
  ok(up401.status === 401 && up401.body.indexOf('bad key 401') >= 0, '上游非 200 透传 (非流式): 401 + 错误体原文 (压成 200/502 则用户看不到可操作提示)');
  ok(up401.headers['access-control-allow-origin'] === '*', '上游非 200 透传 (非流式): 错误响应带 ACAO');
  const up401s = await postChat({ provider: 'stubprov', model: 'stub-401', messages: [{ role: 'user', content: 'k' }], stream: true });
  ok(up401s.status === 401, '上游非 200 透传 (流式): 状态码不被改写成 200 (否则错误体被当 SSE 解析 → 「流式返回为空」)');

  /* ── 第43轮: 静态内容缓存 (_staticCache, 第37轮引入的 mtime+size 判据) — 此前零自动化覆盖 ──
     风险面: 判据一旦失效 (例如永远复用首读字节), 用户改了 js/css 后强刷仍拿到旧代码, 带 query 的
     cache-bust 也救不回来 (query 与裸路径共用同一 ETag/缓存项)。本组用真实文件改动双向钉住。 */
  const cacheName = 'guard-static-' + process.pid + '.txt';
  const cachePath = path.join(ROOT, 'temp', cacheName);
  const cacheUrl = '/temp/' + cacheName;
  fS.mkdirSync(path.dirname(cachePath), { recursive: true });
  fS.writeFileSync(cachePath, 'AAAA');
  const sc1 = await req('GET', cacheUrl);
  ok(sc1.status === 200 && sc1.body === 'AAAA', '静态缓存: 首读返回文件内容 + 200');
  const sc2 = await req('GET', cacheUrl);
  ok(sc2.status === 200 && sc2.body === 'AAAA' && sc2.headers.etag === sc1.headers.etag, '静态缓存: 二次请求命中缓存 (同字节同 ETag, 零磁盘回读)');
  await new Promise(function (r) { setTimeout(r, 30); });
  fS.writeFileSync(cachePath, 'BBBBBBBB');   // 长度与内容都变
  const sc3 = await req('GET', cacheUrl);
  ok(sc3.status === 200 && sc3.body === 'BBBBBBBB' && sc3.headers.etag !== sc1.headers.etag,
    '静态缓存: 文件改动后立即失效 (不返回旧字节/旧 ETag — 否则改代码强刷无效)');
  await new Promise(function (r) { setTimeout(r, 30); });
  fS.writeFileSync(cachePath, 'CCCCCCCC');   // 长度不变, 只有 mtime 变 → 单独钉住 mtime 判据
  const sc4 = await req('GET', cacheUrl);
  ok(sc4.body === 'CCCCCCCC', '静态缓存: 同长度改内容仍失效 (mtime 判据独立生效, 非仅靠 size)');
  try { fS.rmSync(cachePath, { force: true }); } catch (eSC) {}
  const sc5 = await req('GET', cacheUrl);
  ok(sc5.status === 404, '静态缓存: 文件删除后回到 404 (缓存不复活已删文件)');

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
  ok(ctBad.headers['access-control-allow-origin'] === '*', '早期拒绝 (415) 带 ACAO (第47轮补齐, 与中继各分支同口径)');
  const nf404 = await req('GET', '/no-such-page-' + process.pid);
  ok(nf404.status === 404 && nf404.headers['cache-control'] === 'no-store', '404 → Cache-Control no-store (负面响应不入缓存)');

  // 限流秒窗: 连发 9 个请求 (8/s 上限), 至少一个 429
  // (前 8 个可能 400/429 交错, 只断言出现 429 — 限流先于业务校验执行)
  // 第46轮: 12 → 9 — 本套件是单 IP 单进程, 分钟窗上限 30, 原 12 连发把预算占掉太多, 新增断言无位可放;
  // 9 仍严格大于秒窗上限 8, 断言强度不变 (9 个并发请求必落在同一秒)。
  const burst = [];
  for (let i = 0; i < 9; i++) burst.push(postChat({ provider: 'no-such-prov-' + i, model: 'x', messages: [] }));
  const burstRes = await Promise.all(burst);
  ok(burstRes.some(function (r) { return r.status === 429; }), '限流: 单秒 9 连发出现 429 (8/s 窗)');
  ok(burstRes.some(function (r) { return r.status === 429 && r.headers['retry-after'] === '60'; }), '限流 429 带 Retry-After: 60 (客户端退避依据)');
  ok(burstRes.some(function (r) { return r.status === 429 && r.headers['access-control-allow-origin'] === '*'; }),
    '限流 429 带 ACAO (第47轮补齐 — 异源页才看得到「rate limited」而非不透明 CORS 失败)');

  /* ── 第41轮: 静态托管 query 形态 (SW 的 ignoreSearch 离线兜底与用户手动 cache-bust 都依赖它) ──
     serveStatic 内 urlPath.split('?')[0] 后按扩展名取 MIME / 算 ETag; 若该切分被破坏, 带 query 的资源
     会退化成 404 或 application/octet-stream — 表现为「带参数强刷一次页面白屏」, 且 SW 离线兜底再也命中不到壳。 */
  const qIndex = await req('GET', '/index.html?v=2');
  ok(qIndex.status === 200 && /<!DOCTYPE html>/i.test(qIndex.body) && /text\/html/.test(qIndex.headers['content-type'] || ''),
    'GET /index.html?v=2 → 200 html (query 不参与路径/扩展名解析)');
  ok(!!etag && qIndex.headers.etag === etag, '带 query 与裸路径返回同一 ETag (同一文件字节)');
  const qRoot = await req('GET', '/?cachebust=' + process.pid);
  ok(qRoot.status === 200 && /<!DOCTYPE html>/i.test(qRoot.body), 'GET /?query → 200 index.html (根路径同样切分)');
  const qJs = await req('GET', '/ui/app.js?v=9');
  ok(qJs.status === 200 && /javascript/.test(qJs.headers['content-type'] || '') && qJs.body.indexOf('use strict') >= 0,
    'GET /ui/app.js?v=9 → 200 JS 且内容完整 (MIME 按真实扩展名)');

  /* ── 第41轮: keys.json 热加载 (mtime 缓存) 与半写容错 — v1.0.3 特性此前零自动化覆盖 ──
     语义: 文件未改动 → 复用解析结果 (省每请求磁盘 IO); 一改立即生效 (免重启); 编辑器半写 → 保留上次有效配置。
     若 mtime 判据失效 (如永远复用首读结果), 用户填完 key 必须重启才生效 — 这正是本组要钉住的行为。 */
  const origKeys = fS.readFileSync(keysFile, 'utf8');
  const withExtra = JSON.parse(origKeys);
  withExtra.providers.stubextra = { name: 'StubExtra', baseUrl: 'http://127.0.0.1:' + upPort + '/v1', apiKey: 'k2' };
  const ids = function (body) { try { return (((JSON.parse(body) || {}).providers) || []).map(function (p) { return p.id; }); } catch (e) { return []; } };
  await new Promise(function (r) { setTimeout(r, 25); });   // 拉开 mtime (粗粒度文件系统兜底)
  fS.writeFileSync(keysFile, JSON.stringify(withExtra, null, 2));
  const reloaded = await req('GET', '/api/providers');
  ok(ids(reloaded.body).indexOf('stubextra') >= 0,
    'keys.json 改动后免重启即生效 (mtime 缓存判据正确): ' + ids(reloaded.body).join(','));
  await new Promise(function (r) { setTimeout(r, 25); });
  fS.writeFileSync(keysFile, '{"providers": {"broken":');   // 模拟编辑器半写 (非法 JSON)
  const halfWritten = await req('GET', '/api/providers');
  ok(halfWritten.status === 200 && ids(halfWritten.body).indexOf('stubextra') >= 0,
    'keys.json 半写 (非法 JSON) → 保留上次有效配置, 不 500 不清空 (编辑期间对局不断)');
  /* 第46轮: ENOENT 路径 — 只测过「非法 JSON」这一半。原子保存式编辑器会先 unlink 再 create,
     中间必然出现 ENOENT; 若容错只认 SyntaxError, 这一瞬会回落到「生成模板」分支, /api/providers
     当场翻成 16 个空模板服务商 (对局中途前端选择被清空)。 */
  await new Promise(function (r) { setTimeout(r, 25); });
  fS.rmSync(keysFile, { force: true });
  const gone = await req('GET', '/api/providers');
  ok(gone.status === 200 && ids(gone.body).indexOf('stubextra') >= 0,
    'keys.json 被删 (ENOENT) → 保留上次有效配置 (原子保存先删后建, 不得回落模板)');
  await new Promise(function (r) { setTimeout(r, 25); });
  fS.writeFileSync(keysFile, origKeys);   // 还原: 后续中继穿越测试依赖 stubprov/stubanthropic
  const restored = await req('GET', '/api/providers');
  ok(ids(restored.body).indexOf('stubprov') >= 0 && ids(restored.body).indexOf('stubextra') < 0,
    'keys.json 还原后列表随之收敛 (热加载双向生效, 非单向追加)');

  /* ══ 第48轮: 静态黑名单绕过 / 路由 pathname 化 / 非流式中继的两处健壮性 ══
     为什么另起一个实例: 本套件是单 IP 单进程, 而 /api/chat 的分钟窗上限是 30 — 上面已经**用满**
     (16 个单发 + 5 个 req('POST') + 9 连发 = 30), 再加任何一个 POST 都会让末尾那条断言收到 429。
     新进程的限流表是空的, 因此本块既不受预算约束, 也不干扰既有断言。 */
  const PORT2 = 18000 + Math.floor(Math.random() * 20000);
  const BASE2 = 'http://127.0.0.1:' + PORT2;
  server2 = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT2)], { cwd: ROOT, stdio: 'ignore', env: Object.assign({}, process.env, { LLMCHESS_KEYS: keysFile }) });
  let up2 = false;
  for (let i = 0; i < 40 && !up2; i++) { up2 = (await reqTo(BASE2, 'GET', '/api/health')).status === 200; if (!up2) await new Promise(function (r) { setTimeout(r, 150); }); }
  ok(up2, '第48轮: 第二实例启动 (独立限流表, 供本轮新增断言使用)');

  // (a) 敏感路径黑名单必须按「规范化后」的路径逐段判定 — 修复前只按 raw 首段, `..%5c` 可整条绕过
  const bypWin = await reqTo(BASE2, 'GET', '/x/..%5cconfig/keys.json');
  ok(bypWin.status === 403 && bypWin.body.indexOf('apiKey') < 0,
    'GET /x/..%5cconfig/keys.json → 403 (raw 首段是 x, 但 %5c 解码为反斜杠后 path.normalize 折叠回 ROOT/config/ → 第47轮黑名单曾被绕过, 实测 200 逐字返回含 apiKey 的密钥文件)');
  const bypDot = await reqTo(BASE2, 'GET', '/x/../config/keys.json');
  ok(bypDot.status === 403, 'GET /x/../config/keys.json → 403 (黑名单改在规范化后判定)');
  const bypGit = await reqTo(BASE2, 'GET', '/x/..%5c.git/config');
  ok(bypGit.status === 403, 'GET /x/..%5c.git/config → 403 (.git 同样不可借道取回)');

  // (b) 路由只认 pathname — 修复前带 query 的请求一律落静态分支 404
  const qHealth = await reqTo(BASE2, 'GET', '/api/health?t=1');
  ok(qHealth.status === 200, 'GET /api/health?t=1 → 200 (带 query 的探测不再被当成静态路径 404)');
  const qChat = await reqTo(BASE2, 'POST', '/api/chat?t=1', JSON.stringify({ provider: 'stubprov', model: 'stub-model', messages: [{ role: 'user', content: 'q' }] }), { 'Content-Type': 'application/json' });
  ok(qChat.status === 200 && /upstream-ok/.test(qChat.body),
    'POST /api/chat?t=1 → 真实中继 (修复前 404: 前端只看到「404 Not Found」而非真实中继结果/错误)');

  // (c) 上游中途断连 — 非流式两条路径都必须快速 502 (修复前永久挂起)
  const tAbort = Date.now();
  const resetRes = await reqTo(BASE2, 'POST', '/api/chat', JSON.stringify({ provider: 'stubreset', model: 'stub-reset', messages: [{ role: 'user', content: 'x' }] }), { 'Content-Type': 'application/json' });
  const abortMs = Date.now() - tAbort;
  ok(resetRes.status === 502 && abortMs < 3000,
    '上游中途断连 (openai 非流式) → 502 且快速返回 (修复前客户端永久挂起: 实测 12s 无任何字节; 本次 ' + abortMs + 'ms)');
  const resetAnt = await reqTo(BASE2, 'POST', '/api/chat', JSON.stringify({ provider: 'stubresetant', model: 'stub-reset', messages: [{ role: 'user', content: 'x' }] }), { 'Content-Type': 'application/json' });
  ok(resetAnt.status === 502, '上游中途断连 (anthropic 非流式) → 502 同款 (该分支此前也没有收尾路径)');
  const aliveAfterAbort = await reqTo(BASE2, 'GET', '/api/health');
  ok(aliveAfterAbort.status === 200, '中途断连后服务仍存活 (无监听时 Node 只在有 ' + "'error'" + ' 监听才 emit, 表现是挂起而非崩溃 — 两种都要堵)');

  // (d) 非流式上游响应体上限 16MB
  const hugeUp = await reqTo(BASE2, 'POST', '/api/chat', JSON.stringify({ provider: 'stubhuge', model: 'stub-huge', messages: [{ role: 'user', content: 'x' }] }), { 'Content-Type': 'application/json' });
  ok(hugeUp.status === 502 && /exceeds/.test(hugeUp.body),
    '上游响应体 >16MB → 502 (修复前无上限: 超大响应在 Buffer.concat 前就撑爆中继内存)');
  const aliveAfterHuge = await reqTo(BASE2, 'GET', '/api/health');
  ok(aliveAfterHuge.status === 200, '超大响应被截断后服务仍存活 (只丢弃该次响应, 不影响后续请求)');

  try { server2.kill(); } catch (eK2b) {}

  finish();
}

function finish() {
  try { if (server) server.kill(); } catch (e) {}
  try { if (server2) server2.kill(); } catch (eS2) {}
  try { upstream.close(); } catch (eU) {}
  try { fs.rmSync(keysFile, { force: true }); } catch (eK) {}
  try { fs.rmSync(path.join(ROOT, 'temp', 'guard-static-' + process.pid + '.txt'), { force: true }); } catch (eK2) {}   // 第43轮: 静态缓存测试的临时文件兜底清理
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
