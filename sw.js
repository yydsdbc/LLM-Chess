/* sw.js — LLM-chess Service Worker (第24轮 PWA 二期; 第40轮 离线壳修复; 第41轮 壳资源补全)
 * 策略: 网络优先 (network-first) — 在线行为与无 SW 时完全一致 (server.js 的 no-cache+ETag 语义不受影响),
 * 仅当网络失败 (断网 / server.js 未启动) 时回退缓存 → 随机AI 对战壳仍可用。
 * /api/* 永不缓存 (中继请求无离线意义, 且响应含计费); 非同源 (无) 与非 GET 直接放行。
 *
 * 第40轮修复 (原实现离线首启白屏):
 *   ① 缓存按访问 URL 写入 → 根导航键是 './' 而非 './index.html', 而兜底却查 './index.html' 这个从未写入的键, 必然 miss;
 *   ② 无安装期预缓存 → 即便键对, 首次访问就断网也无壳可用;
 *   ③ 兜底只用绝对路径 '/index.html' → 子路径部署 (如 GitHub Pages /LLM-Chess/) 下恒 miss。
 * 现: 安装期预缓存壳 (相对 SW 作用域, 与 manifest start_url './' 对齐) + 兜底按 index.html → 作用域根 → 原请求顺序查。
 *
 * 第41轮修复 (第40轮遗留: 只预缓存了 HTML 本身 → 离线首启仍是白页):
 *   ④ 壳清单原来只有 './' 与 './index.html'。首屏加载发生在 SW 接管之前, 网络优先策略来不及为这些子资源建缓存,
 *      因此断网首启虽然拿得到 HTML, 20 个 <script src> 与图标/manifest 全部命中不到缓存 → XQ 未定义, 页面空白。
 *      现按 index.html 实际引用逐条预缓存 (test/_logic_layer.js 以「解析 index.html 与壳清单比对」守护, 防新增脚本漏挂)。
 *   ⑤ 运行时写缓存的 Promise 悬空 (c.put(...) 未 return 也未 catch) → 配额/隐私模式下的 QuotaExceededError
 *      变成 unhandledrejection (控制台报错, 且无任何降级说明)。补 catch, 失败即静默降级为纯网络优先。
 *
 * 第44轮修复 (两处「在线看着正常、只在特定部署/时序下坏掉」):
 *   ⑥ API 排除写死根绝对 '/api/' — 与全仓「作用域相对」的设计 (壳清单/导航兜底/manifest 全用 './')
 *      不一致: 子路径部署 (GitHub Pages /LLM-Chess/) 下 fetch('api/providers') 解析成 /LLM-Chess/api/providers,
 *      不匹配 → 被当静态资源缓存 (离线拿到过期服务商列表)。现按 self.registration.scope 计算作用域根,
 *      同时保留根绝对判定 (根部署行为不变)。
 *   ⑦ 写缓存未挂事件生命周期 — caches.open().put() 既不 return 也不 waitUntil, respondWith 一 resolve
 *      浏览器即可终止 SW, 写入被丢弃 (在线加载过的子资源离线兜底反而 miss)。现用 deferred 把写入完成
 *      交给 e.waitUntil (必须在派发期间同步调用), 且四条路径都 settle 防事件悬挂。
 */
'use strict';
var CACHE = 'xq-shell-v3';            // 第41轮: 升版 → activate 清掉 v2 (其壳清单缺全部脚本, 用户下次访问自然重建)
var SHELL = [                         // 相对路径: 子路径部署同样成立 (与 manifest start_url './' / scope './' 对齐)
  './', './index.html',
  './manifest.json', './ui/icon.svg',
  './core/piece.js', './core/move.js', './core/board.js', './core/rules.js', './core/generator.js',
  './core/judge.js', './core/engine.js',
  './evaluation/xiangqi_knowledge.js', './evaluation/position.js',
  './ai/random_agent.js', './ai/llm_agent.js', './ai/committee_agent.js',
  './benchmark/record.js', './benchmark/elo.js', './benchmark/match.js',
  './replay/replay.js', './replay/replay_controller.js',
  './ui/renderer.js', './ui/i18n.js', './ui/app.js'
];

self.addEventListener('install', function (e) {
  // 第40轮: 安装期预缓存应用壳 — 首个会话即断网/关服时仍可离线开局 (原为无预缓存, skipWaiting 即刻激活)
  e.waitUntil(
    caches.open(CACHE).then(function (c) {
      return Promise.all(SHELL.map(function (u) {
        return c.add(u).catch(function () {});   // 单个资源失败不阻断安装 (仍走网络优先按需填充)
      }));
    }).then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

/* 第40轮: 导航离线兜底 — 按「壳索引 → 作用域根 → 原请求(忽略 query)」依次尝试, 命中即离线起壳 */
function offlineShell(req) {
  return caches.match('./index.html').then(function (hit) {
    return hit || caches.match('./');
  }).then(function (hit) {
    return hit || caches.match(req, { ignoreSearch: true });   // 带 query 的深链 (#rp= 走 location.hash, 不进 query) 兜底
  }).then(function (hit) {
    return hit || Response.error();   // 确无缓存且离线: 交给浏览器错误页
  });
}

/* 第44轮: API 判定改作用域相对 — 原写死根绝对 '/api/', 而全仓其余部分 (壳清单/导航兜底/manifest) 都按
   作用域相对设计以支持子路径部署 (GitHub Pages /LLM-Chess/)。子路径下 app.js 的 fetch('api/providers')
   解析成 /LLM-Chess/api/providers, 不以 '/api/' 开头 → 被当成普通静态资源缓存 (离线时拿旧服务商列表)。
   兼容保留根绝对判定 (根部署行为不变), 并额外接受「作用域根 + api/」。 */
function scopeRoot() {
  var sc = null;
  try { sc = self.registration && self.registration.scope; } catch (eSc) {}
  if (!sc) { try { sc = location.pathname || '/'; } catch (eSc2) { sc = '/'; } }
  try { if (/^https?:/i.test(sc)) sc = new URL(sc).pathname; } catch (eSc3) {}
  if (!sc || sc.charAt(0) !== '/') sc = '/';
  if (sc.charAt(sc.length - 1) !== '/') sc = sc.replace(/[^/]*$/, '');   // 末段若是文件名则截到目录
  return sc;
}
var SCOPE_ROOT = scopeRoot();
function isApiPath(pathname) {
  if (pathname.indexOf('/api/') === 0) return true;                       // 根部署 (原行为)
  return SCOPE_ROOT !== '/' && pathname.indexOf(SCOPE_ROOT + 'api/') === 0;
}

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;          // 非同源放行
  if (isApiPath(url.pathname)) return;                 // API 永不缓存 (计费/动态)
  /* 第44轮: 写缓存必须挂在事件生命周期上 — 原实现的 caches.open().put() 是悬空 Promise (既不 return 也不
     waitUntil), respondWith 一 resolve 浏览器即可终止 SW, 写缓存被直接丢弃 (在线明明加载过的子资源, 离线兜底
     却 miss)。waitUntil 只能在事件派发期间**同步**调用, 因此用一个 deferred 把「写入完成」暴露给 waitUntil,
     并在 fetch 结果落地的每条路径上 settle (可缓存/不可缓存/网络异常), 避免事件永不结束。 */
  var settlePut = null;
  var putDone = new Promise(function (resolve) { settlePut = resolve; });
  e.waitUntil(putDone);
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {      // 仅缓存同源 2xx 成功响应
        var copy = res.clone();
        // 第41轮: 补 catch — 配额耗尽/隐私模式 (QuotaExceededError) 不变成未处理的 rejection;
        // 写缓存是纯优化, 失败只应降级为「本次不缓存」, 不能污染在线路径
        caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {}).then(settlePut, settlePut);
      } else settlePut();
      return res;
    }).catch(function () {
      settlePut();
      if (req.mode === 'navigate') return offlineShell(req);   // 第28轮引入兜底, 第40轮修正查询键
      return caches.match(req, { ignoreSearch: false }).then(function (hit) {
        return hit || Response.error();                // 无缓存且离线: 交给浏览器错误页
      });
    })
  );
});
