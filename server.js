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
function serveStatic(req, res, urlPath) {
  let p;
  try { p = decodeURIComponent(urlPath.split('?')[0]); } catch (eU) { res.writeHead(400); return res.end('bad request'); }   // v1.0.daily: 畸形百分号编码 (/% etc) 抛 URIError → 回 400 而非连接崩溃
  if (p === '/' || p === '') p = '/index.html';
  const full = path.normalize(path.join(ROOT, p));
  // 第27轮: 前缀穿越加固 — 裸 startsWith(ROOT) 会放行同名前缀兄弟目录 (…/LLM-chess-backup/…), 必须按路径段比对
  if (full !== ROOT && !full.startsWith(ROOT + path.sep)) { res.writeHead(403, { 'Cache-Control': 'no-store' }); return res.end('forbidden'); }   // 第28轮: no-store
  fs.readFile(full, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end('404 Not Found'); }   // 第28轮: 404 不入缓存
    // v1.0.3: ETag/304 — 文件未变时浏览器用本地副本 (对局中 F5 秒开, 省带宽); api/keys 动态路径不走这里
    const etag = '"' + require('crypto').createHash('sha1').update(buf).digest('hex').slice(0, 16) + '"';
    if (req.headers['if-none-match'] === etag) { res.writeHead(304, { ETag: etag }); return res.end(); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', ETag: etag });
    res.end(buf);
  });
}

/* ── 上游转发 ── */
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
    timeout: 180000,   // v1.5.9: 65s→180s — socket 空闲超时, provider 排队波 70~300s 时 65s 会杀掉排队中请求 → 502 → agent 重试更久; 需 > agent 的 120s
    headers: Object.assign({
      'Content-Type': 'application/json',
      'Authorization': 'Bearer ' + providerCfg.apiKey,
      'Content-Length': Buffer.byteLength(body)
    }, providerCfg.headers || {}),   // v3.5: 每服务商可自定义请求头 (部分网关需额外鉴权头)
  }, upRes => {
    if (!wantStream) {
      const out = [];
      upRes.on('data', c => out.push(c));
      upRes.on('end', () => {
        res.writeHead(upRes.statusCode || 502, {
          'Content-Type': upRes.headers['content-type'] || 'application/json',
          'Access-Control-Allow-Origin': req_origin_safe(req)
        });
        res.end(Buffer.concat(out));
      });
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
    timeout: 180000,
    headers: Object.assign({
      'Content-Type': 'application/json',
      'x-api-key': providerCfg.apiKey,
      'anthropic-version': '2023-06-01',
      'Content-Length': Buffer.byteLength(body)
    }, providerCfg.headers || {})
  }, upRes => {
    const out = [];
    upRes.on('data', c => out.push(c));
    upRes.on('end', () => {
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
  });
  const beat = setInterval(() => { try { res.write(': ping\n\n'); } catch (eB) {} }, 15000);   // v3.5: SSE 心跳防 streamIdle 误杀
  upReq.on('timeout', () => upReq.destroy(new Error('anthropic timeout(180s)')));
  upReq.on('error', e3 => { clearInterval(beat); if (!res.headersSent) res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify({ error: 'relay upstream error: ' + e3.message })); });
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
  const ip = (req.socket && req.socket.remoteAddress) || 'unknown';
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

const server = http.createServer(async (req, res) => {
  const u = req.url || '/';

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': req_origin_safe(req),
      'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  /* ── API ── */
  if (u === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ ok: true, relay: true, version: VERSION }));
  }

  if (u === '/api/providers' && req.method === 'GET') {   // 第26轮: 加 GET 门禁 (原任意方法都返回列表; 非 GET 落静态分支 404, 与 /api/chat 的方法守卫同款) — 需重启生效
    const keys = loadKeys();
    const list = Object.keys(keys.providers || {}).map(id => ({
      id, name: keys.providers[id].name, baseUrl: keys.providers[id].baseUrl,
      hasKey: !!keys.providers[id].apiKey,
      models: keys.providers[id].models || []
    }));
    res.writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    return res.end(JSON.stringify({ providers: list }));
  }

  if (u === '/api/chat' && req.method === 'POST') {
    // v1.0.3: 轻量限流 (每 IP 每分钟 30 次, 防失控/恶意刷请求烧 key; 内存滑动窗, 零依赖)
    if (!chatRateLimit(req)) {
      res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '60' });
      return res.end(JSON.stringify({ error: 'rate limited: max 30 requests/min per IP' }));
    }
    // 第28轮: Content-Type 门禁 (显式声明非 JSON 直接 415; 无声明宽松放行兼容旧行为)
    const ct = (req.headers['content-type'] || '').toLowerCase();
    if (ct && ct.indexOf('application/json') < 0) {
      res.writeHead(415, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      return res.end(JSON.stringify({ error: 'unsupported media type: use application/json' }));
    }
    const body = await readBody(req);
    if (!body) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '请求体为空或超过 2MB 上限' }));
    }
    let payload;
    try { payload = JSON.parse(body); } catch (e) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: 'bad json' }));
    }
    const keys = loadKeys();
    const cfg = (keys.providers || {})[payload.provider];
    if (!cfg) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: '未知服务商: ' + payload.provider }));
    }
    if (!cfg.apiKey) {
      res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end(JSON.stringify({ error: '服务商 ' + payload.provider + ' 未配置 apiKey — 请编辑 config/keys.json 后重启' }));
    }
    if (!payload.model || !payload.messages) {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ error: '缺少 model/messages' }));
    }
    if ((cfg.protocol || '') === 'anthropic') return relayAnthropic(cfg, payload, res, req);   // v3.5: Claude 走协议转换
    return relay(cfg, payload, res, req);
  }

  /* ── 静态 ── */
  serveStatic(req, res, u);
});

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
