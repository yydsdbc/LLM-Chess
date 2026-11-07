/* ui/danmaku.js — 赛事弹幕 (第95轮, 零依赖): 吃子/将军/长将预警/系统兜底 事件飘屏
 * 对标 AI 斗蛐蛐品类 (WhoisSpy 世界杯 / 养成对战观赛) 的观赛氛围层: 事件以弹幕形式飘过棋盘。
 * 设计:
 *  - buildDanmaku(event) 纯函数 → {key, args, sig} (Node 直测; sig 用于同事件去重)
 *  - feed(event, boardEl): 3 轨道轮询 + 同签名 0.9s 去重 + 层内上限 6 条 (不刷屏)
 *  - 弹幕层 aria-hidden (氛围层, 信息在决策卡/走法列表均可读), pointer-events:none 不挡棋盘
 *  - 全局 prefers-reduced-motion 闸门把动画压到 .01ms → animationend 即移除 (该用户群无弹幕, 符合预期)
 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var layer = null, lane = 0, lastSig = {}, SIG_TTL = 900, CAP = 6, LANES = 3;

  function buildDanmaku(ev) {
    ev = ev || {};
    var t = ev.type, k = null, args = {}, sig = t;
    if (t === 'capture') { k = 'dk_capture'; args = { piece: ev.captured || '' }; sig += '|' + (ev.captured || '') + '|' + (ev.ply || 0); }
    else if (t === 'check') { k = 'dk_check'; sig += '|' + (ev.ply || 0); }
    else if (t === 'perpetual') { k = 'dk_perpetual'; sig += '|' + (ev.side || ''); }
    else if (t === 'fallback') { k = 'dk_fallback'; args = { side: ev.side || '', ply: ev.ply || 0 }; sig += '|' + (ev.side || '') + '|' + (ev.ply || 0); }
    else if (t === 'swing') { k = 'dk_swing'; sig += '|' + (ev.ply || 0); }   // 第101轮: 天平剧变 (单手评分摆动超阈值)
    else if (t === 'multikill') { k = 'dk_multikill'; args = { side: ev.side || '', n: ev.n || 2 }; sig += '|' + (ev.side || '') + '|' + (ev.n || 0); }   // 第102轮: 连吃 (同方连续吃子)
    else return null;
    return { key: k, args: args, sig: sig };
  }

  function ensureLayer(boardEl) {
    if (layer && layer.isConnected) return layer;
    layer = document.createElement('div');
    layer.id = 'danmaku-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = 'position:absolute;top:6px;left:0;right:0;height:86px;overflow:hidden;pointer-events:none;z-index:5';
    layer.style.setProperty('--dkw', (layer.offsetWidth || boardEl.clientWidth || 432) + 'px');   // 第105轮: 用层自身实测宽 (board-container 内层 ~383 < 棋盘 432, 旧值让弹幕可见窗口只剩 ~15%)
    (boardEl.parentNode || boardEl).appendChild(layer);   // 与 move-arrow 同挂 board-container
    return layer;
  }

  function feed(ev, boardEl) {
    if (typeof document === 'undefined' || !boardEl) return;
    var d = buildDanmaku(ev);
    if (!d) return;
    var now = Date.now();
    if (lastSig[d.sig] && now - lastSig[d.sig] < SIG_TTL) return;
    lastSig[d.sig] = now;
    var el = ensureLayer(boardEl);
    if (el.children.length >= CAP) return;
    var T = XQ.I18N ? XQ.I18N.tArgs : function (k) { return k; };
    if (d.args && d.args.side) {   // 第95轮: side 占位符本地化 (red→红方/黑方; Node 直测环境无 I18N 时保持原值)
      d.args.side = XQ.I18N ? T(d.args.side === 'red' ? 'status_side_red' : 'status_side_black') : d.args.side;
    }
    var span = document.createElement('span');
    span.className = 'danmaku-item dk-' + ev.type;
    span.textContent = T(d.key, d.args);
    lane = (lane + 1) % LANES;
    span.style.top = (4 + lane * 27) + 'px';
    span.addEventListener('animationend', function () { if (span.parentNode) span.parentNode.removeChild(span); });
    el.appendChild(span);
  }

  XQ.Danmaku = { feed: feed, buildDanmaku: buildDanmaku };
})(typeof window !== 'undefined' ? window : globalThis);
