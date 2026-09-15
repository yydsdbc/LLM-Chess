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

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;          // 非同源放行
  if (url.pathname.indexOf('/api/') === 0) return;     // API 永不缓存 (计费/动态)
  e.respondWith(
    fetch(req).then(function (res) {
      if (res && res.ok && res.type === 'basic') {      // 仅缓存同源 2xx 成功响应
        var copy = res.clone();
        // 第41轮: 补 catch — 原为悬空 Promise, 配额耗尽/隐私模式 (QuotaExceededError) 直接变成未处理的
        // rejection; 写缓存是纯优化, 失败只应降级为「本次不缓存」, 不能污染在线路径
        caches.open(CACHE).then(function (c) { return c.put(req, copy); }).catch(function () {});
      }
      return res;
    }).catch(function () {
      if (req.mode === 'navigate') return offlineShell(req);   // 第28轮引入兜底, 第40轮修正查询键
      return caches.match(req, { ignoreSearch: false }).then(function (hit) {
        return hit || Response.error();                // 无缓存且离线: 交给浏览器错误页
      });
    })
  );
});
