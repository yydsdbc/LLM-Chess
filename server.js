#!/usr/bin/env node
/**
 * LLM-chess v1.0 本地服务器
 *  - 静态托管前端 (http://localhost:8788)
 *  - /api/chat: OpenAI 协议中继。API Key 只保存在服务端 config/keys.json, 前端永不见密钥。
 *  - /api/providers: 返回已配置的服务商列表 (不含 Key)
 *
 * 用法: node server.js [端口]     (默认 8788)
 * 首次运行会自动生成 config/keys.json 模板, 打开填入各服务商的 Key 即可。
 */
'use strict';
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');

const PORT = parseInt(process.argv[2] || process.env.PORT || '8788', 10);
const ROOT = __dirname;
const KEYS_PATH = process.env.LLMCHESS_KEYS || path.join(ROOT, 'config', 'keys.json');   // 第29轮: 测试可注入独立密钥文件 (不触用户真实 keys.json)
let VERSION = 'unknown';
try { VERSION = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version || 'unknown'; } catch (e) {}

/* ── 密钥配置加载 ── */
/* v1.0.3: mtime 缓存 — keys.json 未改动时复用上次解析 (热加载语义不变: 文件一改立即生效, 省每请求磁盘 IO/JSON 解析) */
let _keysCache = null, _keysMtime = 0;
function loadKeys() {
  try {
    const st = fs.statSync(KEYS_PATH);
    if (_keysCache && st.mtimeMs === _keysMtime) return _keysCache;
    _keysCache = JSON.parse(fs.readFileSync(KEYS_PATH, 'utf8'));
    _keysMtime = st.mtimeMs;
    return _keysCache;
  } catch (e) {
    if (_keysCache && (e.code === 'ENOENT' || e instanceof SyntaxError)) return _keysCache;   // 编辑器半写/临时删除容错: 保留上次有效配置
    _keysCache = null; _keysMtime = 0;
    const template = {
      _说明: '在此填入各服务商 apiKey 后重启 server.js。此文件不要提交到任何仓库。',
      providers: {
        moonshot: { name: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', apiKey: '' },
        deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', apiKey: '' },
        zhipu:    { name: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', apiKey: '' },
        openai:   { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', apiKey: '' },
        minimax:  { name: 'MiniMax', baseUrl: 'https://api.minimaxi.com/v1', apiKey: '' },
        tokenrhythm: { name: 'TokenRhythm', baseUrl: 'https://tokenrhythm.studio/v1', chatPath: '/chat/completions', apiKey: '', models: ['glm-5.3-flash', 'deepseek-v4-flash-0731', 'deepseek-v4-pro-0813'] },
        qwen: { name: '阿里通义千问', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: '', models: ['qwen-max', 'qwen-plus', 'qwen-turbo', 'qwen3-max'] },
        volcengine: { name: '字节豆包(火山方舟)', baseUrl: 'https://ark.cn-beijing.volces.com/api/v3', apiKey: '', models: ['doubao-1.5-pro-32k', 'doubao-pro-32k'] },
        hunyuan: { name: '腾讯混元', baseUrl: 'https://api.hunyuan.cloud.tencent.com/v1', apiKey: '', models: ['hunyuan-turbo', 'hunyuan-pro', 'hunyuan-standard'] },
        spark: { name: '讯飞星火', baseUrl: 'https://spark-api-open.xf-yun.com/v1', apiKey: '', models: ['generalv3.5', 'max-32k', '4.0Ultra'] },
        yi: { name: '零一万物', baseUrl: 'https://api.lingyiwanwu.com/v1', apiKey: '', models: ['yi-large', 'yi-medium', 'yi-spark'] },
        baichuan: { name: '百川智能', baseUrl: 'https://api.baichuan-ai.com/v1', apiKey: '', models: ['Baichuan4', 'Baichuan3-Turbo'] },
        step: { name: '阶跃星辰', baseUrl: 'https://api.stepfun.com/v1', apiKey: '', models: ['step-2-16k', 'step-1v-8k'] },
        siliconflow: { name: '硅基流动', baseUrl: 'https://api.siliconflow.cn/v1', apiKey: '', models: ['deepseek-ai/DeepSeek-V3', 'Qwen/Qwen2.5-72B-Instruct'] },
        anthropic: { name: 'Anthropic Claude', baseUrl: 'https://api.anthropic.com', protocol: 'anthropic', apiKey: '', models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-5-haiku-latest'] },
        custom: { name: '自定义(OpenAI兼容)', baseUrl: 'https://填入你的OpenAI兼容网关/v1', apiKey: '', _说明: '任意 OpenAI 兼容接口; models 留空则前端模型框可自由输入; 可加 headers 字段自定义请求头' }
      }
    };
    fs.mkdirSync(path.dirname(KEYS_PATH), { recursive: true });
    fs.writeFileSync(KEYS_PATH, JSON.stringify(template, null, 2));
    console.log('⚠ 已生成密钥模板: ' + KEYS_PATH + ' — 请填入 apiKey 后重启');
    return template;
  }
}

/* ── 静态文件 ── */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon',
  '.md': 'text/markdown; charset=utf-8', '.txt': 'text/plain; charset=utf-8'
};
var _staticCache = new Map();   // 第37轮: 静态内容缓存 (mtime 校验, 命中不回读磁盘; 上限 64 文件)
/* 第47轮: 静态托管敏感目录黑名单 — 只挡「穿越」不足以挡「点名取密钥」(见 serveStatic 内注释) */
const DENY_DIRS = new Set(['config', 'logs', 'node_modules']);
function serveStatic(req, res, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch (eU) { res.writeHead(400); return res.end('bad request'); }   // v1.0.daily: 畸形百分号编码 (/% etc) 抛 URIError → 回 400 而非连接崩溃
  /* 第47轮: 空字节守卫 — decodeURIComponent('/%00') 得到含 \u0000 的路径, 它能通过下方前缀校验,
     而 fs.stat 对含空字节的路径**同步抛出** ERR_INVALID_ARG_VALUE → 逃出 serveStatic → async 处理器的
     promise 拒绝 → Node 18+ 直接终止进程 (与第46轮 JSON.parse('null') 同类: 一个 GET 远程打死中继)。
     实测: GET /%00 → 连接重置 + 后续 /api/health ECONNREFUSED。 */
  if (p.indexOf('\u0000') >= 0) { res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('bad request'); }
  if (p === '/' || p === '') p = '/index.html';
  /* 第47轮: 敏感路径黑名单 — 原实现只有「穿越」防护 (路径必须落在 ROOT 内), 而 GET /config/keys.json
     是 ROOT 内的正常路径 → **逐字返回含真实 apiKey 的密钥文件** (实测 200), /.git/config 同样可取
     (可能含远端凭据), logs/ 暴露运行时产物 — 与 README「密钥永不离开服务器」直接矛盾。
     按首段判定并顺带拒绝一切点开头目录 (.git/.github 等, 静态面本无此需求)。 */
  const full = path.normalize(path.join(ROOT, p));
  // 第27轮: 前缀穿越加固 — 裸 startsWith(ROOT) 会放行同名前缀兄弟目录 (…/LLM-chess-backup/…), 必须按路径段比对
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) { res.writeHead(403, { 'Cache-Control': 'no-store' }); return res.end('forbidden'); }   // 第28轮: no-store
  /* 第48轮关键修复: 黑名单必须在**规范化之后**按每一段判定。第47轮的实现取 raw 路径的**首段**,
     而 path.normalize 随后才折叠 `..` → 首段只要是个无关目录名即可整条绕过:
     `GET /x/..%5cconfig/keys.json` (%5c 解码为反斜杠; 浏览器 URL 解析器不把 %5c 当路径分隔符, 故原样送达)
     的 raw 首段是 'x' → 通过黑名单, 规范化后却是 ROOT/config/keys.json (落在 ROOT 内, 前缀校验也通过)
     → 实测 200 **逐字返回含真实 apiKey 的密钥文件**, 第47轮刚加的黑名单被整条绕过。
     (Windows 上 \ 是分隔符故可折叠; Linux 上该串只是一个文件名 → 404, 所以这类绕过只在 Windows 部署上活着。)
     改为对规范化后的相对路径逐段判定, 与平台无关。 */
  const relSegs = path.relative(ROOT, full).split(path.sep).filter(Boolean);
  for (const seg of relSegs) {
    if (seg.charAt(0) === '.' || DENY_DIRS.has(seg.toLowerCase())) { res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('forbidden'); }
  }
  function sendBuf(buf) {
    const etag = '"' + require('crypto').createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag });
    res.end(buf);
  }
  fs.stat(full, (errS, st) => {
    if (errS) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('404 Not Found'); }
    const hit = _staticCache.get(full);
    if (hit && hit.mtime === st.mtimeMs && hit.size === st.size) { sendBuf(hit.buf); return; }   // 第37轮: 命中零磁盘 IO
    fs.readFile(full, (err, buf) => {
      if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('404 Not Found'); }
      if (_staticCache.size > 64) _staticCache.clear();
      _staticCache.set(full, { mtime: st.mtimeMs, size: st.size, buf: buf });
      sendBuf(buf);
    });
  });
}

/* ── 上游转发 ──
 * 第38轮: keep-alive Agents — 上游默认每请求新建连接 (TLS 握手 ~100-400ms); LLM 调用密集 (会诊双选民/重试) 下复用连接显著省时 */
const _httpsAgent = new https.Agent({ keepAlive: true, maxSockets: 16, keepAliveMsecs: 30000 });
const _httpAgent = new http.Agent({ keepAlive: true, maxSockets: 16, keepAliveMsecs: 30000 });
/* 第48轮: 非流式上游响应体上限 — 与 readBody 的 2MB 请求体上限对称。上游是 operator 可配的任意网关
   (或自身失控), 回一个超大体会在 Buffer.concat 前先撑爆中继内存 (零依赖进程无 --max-old-space 兜底)。 */
const MAX_UPSTREAM_BYTES = 16 * 1024 * 1024;
function relay(providerCfg, payload, res, req) {   // 第29轮关键修复: req 传入 (v1.0.3 起函数内引用 req 但不在作用域, 真实中继调用上游响应时 ReferenceError 崩进程)
  const base = (providerCfg.baseUrl || '').replace(/\/+$/, '');
  const path = providerCfg.chatPath || '/chat/completions';
  const url = new URL(base + path);
  const mod = url.protocol === 'https:' ? https : http;
  const wantStream = !!payload.stream;
  const body = JSON.stringify({
    model: payload.model,
    messages: payload.messages,
    temperature: typeof payload.temperature === 'number' ? payload.temperature : 0.3,
    max_tokens: Math.min(payload.max_tokens || 2048, 32768),   // 第30轮: 钳制 (恶意/误填超大值打爆上游计费)
    // thinking 开关仅 GLM 系 (bigmodel/tokenrhythm) 透传; 其他家 (deepseek/moonshot/openai/minimax) 不识别该字段,
    // 防严格校验的上游报未知字段 400 — deepseek-chat 本就不思考, deepseek-reasoner 恒思考, 无需开关
    thinking: /bigmodel\.cn|tokenrhythm/i.test(base) ? payload.thinking : undefined,
    stream: wantStream,
    stream_options: wantStream ? { include_usage: true } : undefined
  });
  const upReq = mod.request({
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    agent: url.protocol === 'https:' ? _httpsAgent : _httpAgent,   // 第38轮: 连接复用
    timeout: 180000,   // v1.5.9: 65s→180s — socket 空闲超时, provider 排队波 70~300s 时 65s 会杀掉排队中请求 → 502 → agent 重试更久; 需 > agent 的 120s
    headers: Object.assign({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + providerCfg.apiKey,
      'Content-Length': Buffer.byteLength(body)
    }, providerCfg.headers || {}),   // v3.5: 每服务商可自定义请求头 (部分网关需额外鉴权头)
  }, upRes => {
    if (!wantStream) {
      const out = [];
      let got = 0, settled = false;
      /* 第48轮关键修复: 非流式路径此前只有 'data'/'end' — 上游**连上之后中途断连** (写完头/半截体
         再拆 socket) 时既不 emit 'end' 也没有 'error' 监听, 于是这里永不响应: 实测客户端一路挂到
         超时 (12s 无任何字节) 而不是像「连不上」那样拿到 502 (第45轮补的 502 只覆盖连接失败)。
         注意这不是崩溃而是**永久挂起**: Node 的客户端响应只在**存在** 'error' 监听时才 emit 'error'
         (实测同一场景无监听只有 'aborted'+'close'), 所以既不会 unhandled 抛出也不会有人来收尾。
         收口成 settle() 单出口: 'end' 正常交付; 提前 'close' → 502。用 upRes.complete 判定
         (而不是依赖 'error' 是否 emit), 免得把「已完整收完」误判成中断。 */
      const settle = (buf, bad) => {
        if (settled) return;
        settled = true;
        if (bad) {
          if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': req_origin_safe(req) });
          try { res.end(JSON.stringify({ error: 'relay upstream error: ' + bad })); } catch (eR) {}
          return;
        }
        res.writeHead(upRes.statusCode || 502, {
          'Content-Type': upRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': req_origin_safe(req)
        });
        res.end(buf);
      };
      upRes.on('data', c => {
        got += c.length;
        if (got > MAX_UPSTREAM_BYTES) { try { upRes.destroy(); } catch (eD) {} return settle(null, 'upstream response exceeds ' + Math.round(MAX_UPSTREAM_BYTES / 1048576) + 'MB cap'); }
        out.push(c);
      });
      upRes.on('end', () => settle(Buffer.concat(out)));
      upRes.on('error', eU => settle(null, (eU && eU.message) || 'response error'));   // 有监听才不会变成 unhandled 'error'
      upRes.on('close', () => { if (!settled) settle(upRes.complete ? Buffer.concat(out) : null, upRes.complete ? null : 'upstream closed before response completed'); });
    } else {
      // SSE 透传: 状态码+头照抄上游, chunks 直通浏览器
      res.writeHead(upRes.statusCode || 502, {
        'Content-Type': upRes.headers['content-type'] || 'text/event-stream',
        'Cache-Control': 'no-store',
        'Access-Control-Allow-Origin': req_origin_safe(req)
      });
      upRes.on('data', c => res.write(c));
      upRes.on('end', () => res.end());
      upRes.on('error', () => res.end());
    }
  });
  upReq.on('timeout', () => upReq.destroy(new Error('upstream timeout(180s)')));
  res.on('close', () => { try { upReq.destroy(new Error('client closed')); } catch (e2) {} });   // v3.4: 浏览器断开即销毁上游请求 (免浪费 token)
  upReq.on('error', e => {
    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': req_origin_safe(req) });   // v1.0.daily: 错误响应也带 ACAO — file:// 调试/异源页才能读到错误明细
    }
    res.end(JSON.stringify({ error: 'relay upstream error: ' + e.message }));
  });
  upReq.write(body);
  upReq.end();
}
/* ── v3.5 Anthropic Claude 协议转换中继 ──
 * Anthropic /v1/messages 与 OpenAI 协议不同: system 独立字段 / messages 交替 / x-api-key 鉴权 / SSE 事件格式不同。
 * 这里做双向转换: 入站 OpenAI 风格 payload → Anthropic; 出站 Anthropic 响应 → 合成 OpenAI 风格 SSE 帧 (llm_agent 无需改动)。
 * 等待上游期间每 15s 发 SSE 注释心跳 (: ping), 防 llm_agent 的 streamIdleMs 60s 看门狗误杀长思考。
 */
function relayAnthropic(providerCfg, payload, res, req) {   // 第29轮: 同上
  const base = (providerCfg.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
  const url = new URL(base + (providerCfg.chatPath || '/v1/messages'));
  const mod = url.protocol === 'https:' ? https : http;
  const msgsIn = Array.isArray(payload.messages) ? payload.messages : [];
  let system = '';
  const rest = [];
  for (const m of msgsIn) {
    const c = typeof m.content === 'string' ? m.content : JSON.stringify(m.content);
    if (m.role === 'system') { system += (system ? '\n' : '') + c; continue; }
    rest.push({ role: m.role === 'assistant' ? 'assistant' : 'user', content: c });
  }
  const merged = [];
  for (const m of rest) {
    const last = merged[merged.length - 1];
    if (last && last.role === m.role) last.content += '\n' + m.content;   // Anthropic 要求 user/assistant 交替, 同角色合并
    else merged.push({ role: m.role, content: m.content });
  }
  if (!merged.length || merged[0].role !== 'user') merged.unshift({ role: 'user', content: '(开局)' });
  const body = JSON.stringify({
    model: payload.model,
    max_tokens: Math.min(payload.max_tokens || 2048, 32768),   // 第30轮: 钳制同上
    temperature: typeof payload.temperature === 'number' ? payload.temperature : 0.3,
    system: system || undefined,
    messages: merged,
    stream: false   // 上游固定非流式, 中继侧合成 SSE (省去 Anthropic 事件流转换)
  });
  const upReq = mod.request({
    hostname: url.hostname,
    port: url.port || (url.protocol === 'https:' ? 443 : 80),
    path: url.pathname + url.search,
    method: 'POST',
    agent: url.protocol === 'https:' ? _httpsAgent : _httpAgent,   // 第38轮: 连接复用
    timeout: 180000,
    headers: Object.assign({
      'Content-Type': 'application/json',
      'x-api-key': providerCfg.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }, providerCfg.headers || {})
  }, upRes => {
    const out = [];
    let got = 0, settled = false;
    /* 第48轮: 与 relay 的非流式路径同款 — 上游连上后中途断连时本路径也永不响应 (实测挂到客户端超时;
       Node 只在有 'error' 监听时才 emit 'error', 故表现为挂起而非崩溃), 补 premature-close → 502
       与响应体上限 (见 MAX_UPSTREAM_BYTES 注释)。 */
    const failUp = msg => {
      if (settled) return;
      settled = true;
      if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': req_origin_safe(req) });
      try { res.end(JSON.stringify({ error: 'relay upstream error: ' + msg })); } catch (eR) {}
    };
    upRes.on('data', c => {
      got += c.length;
      if (got > MAX_UPSTREAM_BYTES) { try { upRes.destroy(); } catch (eD) {} return failUp('upstream response exceeds ' + Math.round(MAX_UPSTREAM_BYTES / 1048576) + 'MB cap'); }
      out.push(c);
    });
    upRes.on('end', () => {
      if (settled) return;
      settled = true;
      let text = '', usage = null, httpErr = null;
      try {
        const jr = JSON.parse(Buffer.concat(out).toString('utf8'));
        if (jr.type === 'error' || jr.error) httpErr = (jr.error && jr.error.message) || 'anthropic error';
        else {
          text = (jr.content || []).filter(b2 => b2.type === 'text').map(b2 => b2.text).join('');
          const u2 = jr.usage || {};
          usage = { prompt_tokens: u2.input_tokens || 0, completion_tokens: u2.output_tokens || 0, total_tokens: (u2.input_tokens || 0) + (u2.output_tokens || 0) };
        }
      } catch (eP) { httpErr = 'anthropic 响应解析失败'; }
      if (httpErr) {
        res.writeHead(upRes.statusCode || 502, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': req_origin_safe(req) });   // v1.0.daily: 同上, anthropic 错误响应带 ACAO
        return res.end(JSON.stringify({ error: httpErr }));
      }
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': req_origin_safe(req) });
      const frame = o2 => res.write('data: ' + JSON.stringify(o2) + '\n\n');
      frame({ choices: [{ delta: { content: text }, finish_reason: 'stop' }], usage });
      frame({ choices: [], usage });
      res.write('data: [DONE]\n\n');
      res.end();
    });
    upRes.on('error', eU => failUp((eU && eU.message) || 'response error'));   // 有监听才不会变成 unhandled 'error'
    upRes.on('close', () => { if (!settled && !upRes.complete) failUp('upstream closed before response completed'); });
  });
  const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch (eB) {} }, 15000);   // v3.5: SSE 心跳防 streamIdle 误杀
  upReq.on('timeout', () => upReq.destroy(new Error('anthropic timeout(180s)')));
  upReq.on('error', e3 => { clearInterval(beat); if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': req_origin_safe(req) }); res.end(JSON.stringify({ error: 'relay upstream error: ' + e3.message })); });   // 第46轮: 补 ACAO — openai 路径的同类错误分支一直带 (file:// 调试/异源页要读到错误明细), 本分支漏了
  res.on('close', () => { clearInterval(beat); try { upReq.destroy(new Error('client closed')); } catch (e4) {} });
  upReq.write(body);
  upReq.end();
}
// 同源部署无需 CORS; 回显同源 Origin (防任意网页盗用用户浏览器打 LLM 烧 key); file:// 调试友好 (Origin 为空时回退 *)
function req_origin_safe(req) {
  const o = req && req.headers && req.headers.origin;
  if (!o) return '*';
  try {
    const u = new URL(o);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1' || u.hostname === '0.0.0.0') return o;
    if (u.origin === 'null') return '*';
  } catch (e) {}
  return '*';
}

// v1.0.3: /api/chat 轻量限流 (每 IP 30 次/分 + 8 次/秒 双窗, 内存滑动, 零依赖)
// v1.0.daily: 补秒窗 — 原仅分钟窗, 脚本可单秒连击打空整分钟预算再等下一窗; 人机/双 agent 每手 ≤2 请求远低于秒窗上限
const _rlMap = new Map();
function chatRateLimit(req) {
  const ip = req.headers['x-forwarded-for'] ? req.headers['x-forwarded-for'].split(',')[0].trim() : (req.socket && req.socket.remoteAddress) || 'unknown';   // 第60轮: 反向代理后取 real IP
  const now = Date.now();
  const sec = Math.floor(now / 1000);
  let entry = _rlMap.get(ip);
  if (!entry || now - entry.start >= 60000) { entry = { start: now, count: 0, sec: sec, secCount: 0 }; _rlMap.set(ip, entry); }
  if (entry.sec !== sec) { entry.sec = sec; entry.secCount = 0; }
  entry.secCount++;
  entry.count++;
  if (entry.count > 30 || entry.secCount > 8) return false;
  if (_rlMap.size > 1000) { for (const [k, v] of _rlMap) { if (now - v.start >= 60000) _rlMap.delete(k); } }
  return true;
}

function readBody(req) {
  return new Promise(resolve => {
    const chunks = [];
    let size = 0, done = false;
    const finish = v => { if (!done) { done = true; resolve(v); } };
    req.on('data', c => {
      size += c.length;
      if (size > 2 * 1024 * 1024) { finish(''); try { req.destroy(); } catch (e) {} return; }   // v3.4: 请求体上限 2MB (防异常大包 OOM)
      chunks.push(c);
    });
    req.on('end', () => finish(Buffer.concat(chunks).toString('utf8')));
    req.on('error', () => finish(''));   // v3.4: 客户端异常中断不再挂起
    req.on('aborted', () => finish(''));   // v3.4: 同上
  });
}

// 第49轮: 安全响应头统一注入 (nosniff/referrer-policy; writeHead 包装一次, 全分支生效)
const _origWriteHead = http.ServerResponse.prototype.writeHead;
http.ServerResponse.prototype.writeHead = function (code, headers) {
  const h = Object.assign({ 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' }, headers || {});
  return _origWriteHead.call(this, code, h);
};

const server = http.createServer(async (req, res) => {
  /* 第48轮: 路由只认 pathname — 原实现拿裸 req.url 做精确比对, 于是任何带 query 的请求
     (`POST /api/chat?t=1` 这类缓存击穿/埋点参数, 或前端调试时随手加的查询串) 都匹配不上 API 分支,
     一路落到静态分支 → 404, 前端只看到一句「404 Not Found」而不是真实的中继错误/服务商提示;
     `/api/health?x=1` 同理 (探测脚本带参数即误判服务未起)。serveStatic 内部本就自行 split('?'),
     故这里先行剥离对静态路径零影响。 */
  const u = (req.url || '/').split('?')[0];

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': req_origin_safe(req),
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  /* ── API ── */
  /* 第47轮: health/providers 与全部早期拒绝分支补 ACAO — 本仓设计上支持异源/file:// 调试
     (req_origin_safe 与中继各分支都带 ACAO), 而这两条探测端点与 429/415/400 系列一直漏着,
     异源页拿到的只有一句不透明的「Failed to fetch」, 看不到「未配置 apiKey」「rate limited」这类可操作提示。 */
  if (u === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': req_origin_safe(req) });
    return res.end(JSON.stringify({ ok: true, relay: true, version: VERSION, uptime_s: Math.round(process.uptime()) }));   // 第49轮: 运行时长
  }

  if (u === '/api/providers' && req.method === 'GET') {   // 第26轮: 加 GET 门禁 (原任意方法都返回列表; 非 GET 落静态分支 404, 与 /api/chat 的方法守卫同款) — 需重启生效
    const keys = loadKeys();
    const list = Object.keys(keys.providers || {}).map(id => ({
      id, name: keys.providers[id].name, baseUrl: keys.providers[id].baseUrl,
      hasKey: !!keys.providers[id].apiKey,
      models: keys.providers[id].models || []
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': req_origin_safe(req) });
    return res.end(JSON.stringify({ providers: list }));
  }

  if (u === '/api/chat' && req.method === 'POST') {
    // v1.0.3: 轻量限流 (每 IP 每分钟 30 次, 防失控/恶意刷请求烧 key; 内存滑动窗, 零依赖)
    if (!chatRateLimit(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60', 'Access-Control-Allow-Origin': req_origin_safe(req) });
      return res.end(JSON.stringify({ error: 'rate limited: max 30 requests/min per IP' }));
    }
    // 第28轮: Content-Type 门禁 (显式声明非 JSON 直接 415; 无声明宽松放行兼容旧行为)
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (ct && ct.indexOf('application/json') < 0) {
      res.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': req_origin_safe(req) });
      return res.end(JSON.stringify({ error: 'unsupported media type: use application/json' }));
    }
    const body = await readBody(req);
    if (!body) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': req_origin_safe(req) });
      return res.end(JSON.stringify({ error: '请求体为空或超过 2MB 上限' }));
    }
    let payload;
    try { payload = JSON.parse(body); } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': req_origin_safe(req) });
      return res.end(JSON.stringify({ error: 'bad json' }));
    }
    /* 第46轮: 非对象 JSON 体守卫 — JSON.parse('null') 合法返回 null, 而下一行读 payload.provider
       在 async 处理器里抛 TypeError; 全仓无 unhandledRejection 兜底 → Node 18+ 直接终止进程。
       即「一个 POST 就能远程打死中继」(实测 exitCode 1 + 后续请求 ECONNREFUSED)。数组/标量经
       provider 判定本来就走 400, 只有 null 会崩, 故按「非对象」判定。需重启生效。 */
    if (!payload || typeof payload !== 'object') {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': req_origin_safe(req) });
      return res.end(JSON.stringify({ error: '请求体必须是 JSON 对象' }));
    }
    const keys = loadKeys();
    const cfg = (keys.providers || {})[payload.provider];
    if (!cfg) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': req_origin_safe(req) });
      return res.end(JSON.stringify({ error: '未知服务商: ' + payload.provider }));
    }
    if (!cfg.apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': req_origin_safe(req) });
      return res.end(JSON.stringify({ error: '服务商 ' + payload.provider + ' 未配置 apiKey — 请编辑 config/keys.json 后重启' }));
    }
    if (!payload.model || !payload.messages) {
      res.writeHead(400, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': req_origin_safe(req) });
      return res.end(JSON.stringify({ error: '缺少 model/messages' }));
    }
    if (!Array.isArray(payload.messages) || !payload.messages.length || payload.messages.some(function (m) { return !m || typeof m.role !== 'string' || (typeof m.content !== 'string' && typeof m.content !== 'object'); })) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': req_origin_safe(req) });
      return res.end(JSON.stringify({ error: 'messages 需为 [{role,content}] 数组' }));   // 第49轮: 形状校验 (防畸形消息透传上游)
    }
    if ((cfg.protocol || '') === 'anthropic') return relayAnthropic(cfg, payload, res, req);   // v3.5: Claude 走协议转换
    return relay(cfg, payload, res, req);
  }

  /* ── 静态 ── */
  serveStatic(req, res, u);
});

process.on('SIGTERM', shutdown);   // 第36轮: 优雅停机
process.on('SIGINT', shutdown);
function shutdown() {
  server.close(function () { process.exit(0); });
  setTimeout(function () { process.exit(0); }, 1500);
}

server.headersTimeout = 10000;   // 第55轮: 请求头超时 (防慢速攻击)
server.requestTimeout = 300000;   // 第55轮: 整请求超时 (中继最长 180s + 缓冲)
server.keepAliveTimeout = 5000;   // 第55轮: keep-alive 空闲超时

const HOST = process.env.LLMCHESS_HOST || '127.0.0.1';   // v3.4: 默认仅本机可访问 (API Key 安全); 局域网访问设 LLMCHESS_HOST=0.0.0.0
server.on('error', e => {   // v1.0.daily: 端口占用等启动错误给可操作提示, 不再裸抛堆栈
  if (e && e.code === 'EADDRINUSE') {
    console.error('端口 ' + PORT + ' 已被占用 — 可能已有 LLM-chess 实例在跑 (Start.cmd/npm start 重复启动?) 或改用: node server.js ' + (PORT + 1));
  } else {
    console.error('服务器启动失败: ' + (e && e.message || e));
  }
  process.exit(1);
});
server.listen(PORT, HOST, () => {
  loadKeys();
  console.log('');
  console.log('🦞 LLM-chess v1.0 服务器已启动 (' + HOST + ':' + PORT + ')');
  console.log('   棋盘     : http://localhost:' + PORT + '/');
  if (HOST === '127.0.0.1') console.log('   访问范围 : 仅本机 (局域网访问设环境变量 LLMCHESS_HOST=0.0.0.0 后重启)');
  console.log('   密钥配置 : config/keys.json (填好后无需改前端)');
  console.log('   零配置   : 无 Key 也能玩 — 对战设置执方选「随机AI」');
  console.log('   中继接口 : POST /api/chat  {provider, model, messages}');
  console.log('   按 Ctrl+C 停止');
  console.log('');
});
