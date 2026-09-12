/* sw.js — LLM-chess Service Worker (第24轮 PWA 二期)
 * 策略: 网络优先 (network-first) — 在线行为与无 SW 时完全一致 (server.js 的 no-cache+ETag 语义不受影响),
 * 仅当网络失败 (断网 / server.js 未启动) 时回退缓存 → 随机AI 对战壳仍可用。
 * /api/* 永不缓存 (中继请求无离线意义, 且响应含计费); 非同源 (无) 与非 GET 直接放行。
 * 缓存按需填充 (访问过什么缓存什么), activate 时清理旧版本缓存 — 无预安装清单, 改资源无需动这里。
 */
'use strict';
var CACHE = 'xq-shell-v1';

self.addEventListener('install', function () {
  self.skipWaiting();   // 新 SW 立即激活 (无预缓存, 无等待必要)
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; })
        .map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

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
        caches.open(CACHE).then(function (c) { c.put(req, copy); });
      }
      return res;
    }).catch(function () {
      if (req.mode === 'navigate') {                   // 第28轮: 导航请求离线兜底壳 (带 query 的首访不再白屏)
        return caches.match('/index.html').then(function (shell) {
          return shell || Response.error();
        });
      }
      return caches.match(req, { ignoreSearch: false }).then(function (hit) {
        return hit || Response.error();                // 无缓存且离线: 交给浏览器错误页
      });
    })
  );
});
