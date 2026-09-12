/* ui/renderer.js — 纯渲染层: 只读 Engine 快照, 不碰棋局逻辑 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var CS = 48, W = 432, H = 480, HC = CS / 2;
  function T(k) { return XQ.I18N ? XQ.I18N.t(k) : k; }   // 第27轮 i18n: 模块级别名 (thinkPanel/capturedTray 空态与俘字翻译; 原仅 renderStatus 函数局部有 T; 函数形式免加载顺序/语言热切问题)
  function TA(k, a) { return XQ.I18N ? XQ.I18N.tArgs(k, a) : k; }   // 第27轮 i18n: tArgs 模块级别名 (d-more 折叠行等)

  // v1.0.daily 棋子记谱切换: localStorage xq_pieces = 'cn' 汉字 (默认) | 'en' 西文字母 — 仅棋盘显示层
  var _glyphMode = null, _glyphTable = null;
  function glyphTable() {
    if (_glyphTable && _glyphMode === (root.localStorage && root.localStorage.getItem('xq_pieces') || 'cn')) return _glyphTable;   // 第28轮: 90 格 × 每帧 localStorage 读取 → 单次渲染缓存
    try { _glyphMode = (root.localStorage && root.localStorage.getItem('xq_pieces')) || 'cn'; } catch (e) { _glyphMode = 'cn'; }
    _glyphTable = _glyphMode === 'en' ? XQ.Piece.LETTERS : XQ.Piece.CHARS;
    return _glyphTable;
  }
  function pieceGlyph(p) {
    var table = glyphTable();
    return (table[p.color] || {})[p.type] || XQ.Piece.CHARS[p.color][p.type];
  }

  /* ── 棋盘线条 (一次绘制) ── */
  function drawBoard(svgEl) {
    var lines = '';
    for (var i = 0; i < 10; i++) {
      var y = i * CS + HC;
      lines += '<line x1="24" y1="' + y + '" x2="408" y2="' + y + '" stroke="#8b6914" stroke-width="' + ((i === 0 || i === 9) ? '1.2' : '0.8') + '" />';
    }
    for (var c = 0; c < 9; c++) {
      var x = c * CS + HC;
      if (c === 0 || c === 8) {
        lines += '<line x1="' + x + '" y1="24" x2="' + x + '" y2="456" stroke="#8b6914" stroke-width="1.2" />';
      } else {
        lines += '<line x1="' + x + '" y1="24" x2="' + x + '" y2="216" stroke="#8b6914" stroke-width="0.8" />';
        lines += '<line x1="' + x + '" y1="264" x2="' + x + '" y2="456" stroke="#8b6914" stroke-width="0.8" />';
      }
    }
    lines += '<rect x="19" y="19" width="394" height="442" fill="none" stroke="#8b6914" stroke-width="1.2" />';
    lines += '<line x1="168" y1="24" x2="264" y2="120" stroke="#8b6914" />';
    lines += '<line x1="264" y1="24" x2="168" y2="120" stroke="#8b6914" />';
    lines += '<line x1="168" y1="360" x2="264" y2="456" stroke="#8b6914" />';
    lines += '<line x1="264" y1="360" x2="168" y2="456" stroke="#8b6914" />';
    lines += '<text x="110" y="240" fill="#8b6914" font-size="18" font-family="KaiTi,serif" text-anchor="middle" dominant-baseline="central">楚 河</text>';
    lines += '<text x="322" y="240" fill="#8b6914" font-size="18" font-family="KaiTi,serif" text-anchor="middle" dominant-baseline="central">汉 界</text>';
    [[2,1],[2,7],[7,1],[7,7]].forEach(function (pt) {
      var cx = pt[1]*CS+HC, cy = pt[0]*CS+HC, o = 4, l = 7;
      function seg(x1,y1,x2,y2){ return '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="#8b6914" stroke-width="0.7"/>'; }
      if (pt[1] > 0) { lines += seg(cx-o-l,cy-o,cx-o,cy-o)+seg(cx-o-l,cy+o,cx-o,cy+o); }
      if (pt[1] < 8) { lines += seg(cx+o,cy-o,cx+o+l,cy-o)+seg(cx+o,cy+o,cx+o+l,cy+o); }
    });
    [3,6].forEach(function (row) {
      for (var c2 = 0; c2 <= 8; c2 += 2) {
        var cx2 = c2*CS+HC, cy2 = row*CS+HC, o2 = 4, l2 = 7;
        function seg2(x1,y1,x2,y2){ return '<line x1="'+x1+'" y1="'+y1+'" x2="'+x2+'" y2="'+y2+'" stroke="#8b6914" stroke-width="0.7"/>'; }
        if (c2 > 0) { lines += seg2(cx2-o2-l2,cy2-o2,cx2-o2,cy2-o2)+seg2(cx2-o2-l2,cy2+o2,cx2-o2,cy2+o2); }
        if (c2 < 8) { lines += seg2(cx2+o2,cy2-o2,cx2+o2+l2,cy2-o2)+seg2(cx2+o2,cy2+o2,cx2+o2+l2,cy2+o2); }
      }
    });
    svgEl.innerHTML = lines;
  }

  /* ── 主渲染: 依据快照更新格子 ──
     第23轮 性能: 90 格持久化复用 — 原实现每次 render 全拆全建 90 节点 (键盘光标每移一格 / 每手棋都触发),
     改为创建一次常驻, 之后只差量更新 className 与棋子子元素; DOM 节点身份跨渲染保持,
     .cell 的 background 过渡在键盘光标/选中切换时真正生效; ghost 播完自清 (不再靠全拆带走) */
  var _cellPool = null;   // {owner, list[90]} 行主序 y*9+x, 与棋盘 grid 排布一致
  function cellPool(boardEl) {
    if (_cellPool && _cellPool.owner === boardEl) return _cellPool.list;
    boardEl.querySelectorAll('.cell').forEach(function (c) { c.remove(); });   // 兜底: 清掉旧实现遗留节点
    var list = [];
    for (var i = 0; i < 90; i++) {
      var c = document.createElement('div');
      c.className = 'cell';
      boardEl.appendChild(c);
      list.push(c);
    }
    _cellPool = { owner: boardEl, list: list };
    return list;
  }
  function render(engine, view) {
    var snap = engine.snapshot();
    var boardEl = view.boardEl;
    var cells = cellPool(boardEl);

    var selected = view.selected;
    var legalList = (selected && !engine.isOver()) ? engine.legalTargets(selected.x, selected.y) : [];
    var legal = {};   // 第28轮: 90 格 × O(n) find → O(1) 哈希命中
    var danger = {};
    for (var li = 0; li < legalList.length; li++) legal[legalList[li].x + ',' + legalList[li].y] = legalList[li];
    if (selected && !engine.isOver()) {
      engine.dangerTargets(selected.x, selected.y).forEach(function (d) { danger[d.x + ',' + d.y] = d; });
    }

    for (var y = 0; y < 10; y++) {
      for (var x = 0; x < 9; x++) {
        var c = cells[y * 9 + x];
        var p = snap.cells[y][x];
        // 棋子差量更新: glyph(色+种) 未变复用现节点, 变则重建 (重建即重放 just-placed/滑入动画)
        var wantKey = p ? (p.color + ':' + p.type) : null;
        if (c._glyph !== wantKey) {
          c.textContent = '';   // 清旧棋子 + 残留 ghost (animationend 未及时的兜底)
          if (p) {
            var pe0 = document.createElement('div');
            pe0.className = 'piece ' + p.color;
            pe0.textContent = pieceGlyph(p);
            c.appendChild(pe0);
          }
          c._glyph = wantKey;
          // 第26轮 a11y: 棋子变更时同步 aria-label (坐标+棋子, 读屏可逐格探索盘面; 字符随 xq_pieces 语言偏好, 坐标语言中立)
          try { c.setAttribute('aria-label', XQ.Move.sqName({ x: x, y: y }) + (p ? ' ' + pieceGlyph(p) : '')); } catch (eA) {}
        }
        var pe = c.firstChild;
        if (p) {
          var justIt = !!(snap.lastMove && x === snap.lastMove.to.x && y === snap.lastMove.to.y);
          // 第25轮: 滑动期间压制 just-placed — scale 关键帧与滑动 transform 同元素冲突 (旧版僵硬根因);
          // contains('slide-in') 兜 mid-slide 重渲染 (pendingAnim 已清但动画未完)
          var sliding = !!(justIt && (view.pendingAnim || pe.classList.contains('slide-in')));
          pe.classList.toggle('just-placed', justIt && !sliding);
          // v1.5 观战动画 → 第25轮重制: CSS 关键帧真滑动 (--dx/--dy 变量位移, 距离定时长 0.22s~0.38s,
          // 72% 落位 + 86% 轻微压定); ghost 滞后 0.07s 淡出; 途中整格抬层防穿子; 结束摘类恢复 hover 缩放
          if (sliding && view.pendingAnim) {
            var m0 = snap.lastMove;
            var dx = (m0.from.x - m0.to.x) * 100, dy = (m0.from.y - m0.to.y) * 100;   // piece 与 cell 同尺寸 → 百分比即一格
            if (dx || dy) {
              var dist = Math.max(Math.abs(m0.from.x - m0.to.x), Math.abs(m0.from.y - m0.to.y));
              pe.style.setProperty('--dx', dx + '%');
              pe.style.setProperty('--dy', dy + '%');
              pe.style.setProperty('--slide-dur', (0.2 + Math.min(dist, 8) * 0.022).toFixed(3) + 's');
              pe.classList.add('slide-in');
              c.classList.add('sliding-cell');
              pe.addEventListener('animationend', function () {
                this.classList.remove('slide-in', 'just-placed');
                this.parentNode.classList.remove('sliding-cell');
              }, { once: true });
            }
            if (m0.captured) {
              var gh = document.createElement('div');
              gh.className = 'piece ghost-out ' + m0.captured.color;
              gh.textContent = pieceGlyph(m0.captured);
              gh.addEventListener('animationend', function () { if (this.parentNode) this.parentNode.removeChild(this); });   // 第23轮: ghost 淡出即自清
              c.insertBefore(gh, pe);   // ghost 在新子下方淡出
            }
            view.pendingAnim = null;
          }
        }
        // 状态类逐格开关 (toggle 对无变化类零操作, 样式失效面最小)
        c.classList.toggle('selected', !!(selected && selected.x === x && selected.y === y));
        // v1.0.daily a11y: 键盘走子光标 (app 键盘事件维护 view.kbCursor, 方向键移动 + Enter 选子走子)
        c.classList.toggle('kb-cursor', !!(view.kbCursor && view.kbCursor.x === x && view.kbCursor.y === y));
        var hit = legal[x + ',' + y];
        c.classList.toggle('legal-capture', !!(hit && hit.isCapture));
        c.classList.toggle('legal-target', !!(hit && !hit.isCapture));
        c.classList.toggle('illegal-target', !hit && !!danger[x + ',' + y]);
        c.classList.toggle('last-start', !!(snap.lastMove && x === snap.lastMove.from.x && y === snap.lastMove.from.y));
        c.classList.toggle('last-move', !!(snap.lastMove && x === snap.lastMove.to.x && y === snap.lastMove.to.y));
        c.classList.toggle('in-check', !engine.isOver() && !!p && p.type === 'king' && p.color === snap.turn && engine.inCheck(snap.turn));
        if (!c._clickBound) {   // 第24轮: 池化后 onclick 只绑一次 (原每帧重建 90 个闭包; 坐标恒定, 重复绑定是纯浪费)
          c._clickBound = true;
          (function (rx, ry) { c.onclick = function () { view.onCellClick(rx, ry); }; })(x, y);
        }
      }
    }
    renderStatus(engine, view);
    renderOverlay(engine, view);
  }

  /* ── 棋局阶段中文 (v3.7 HUD 徽章: 状态条显示 开局/中局/残局, 观战者一眼知阶段) ── */
  function phaseCN(engine) {
    try {
      var ph = XQ.XiangqiKnowledge && XQ.XiangqiKnowledge.detectPhase(engine);
      return (XQ.XiangqiKnowledge.PHASE_CN && XQ.XiangqiKnowledge.PHASE_CN[ph]) || '';
    } catch (e) { return ''; }
  }

  function renderStatus(engine, view) {
    var snap = engine.snapshot();
    var text = '', cls = '';
    var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
    var S18 = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return k; };
    if (engine.isOver()) {
      var r = snap.result;
      if (snap.winner === 'red') { text = T('status_win_red'); cls = 'status-win'; }
      else if (snap.winner === 'black') { text = T('status_win_black'); cls = 'status-win'; }
      else { text = T('status_draw'); cls = 'status-draw'; }
    } else {
      text = S18('status_turn', { side: (snap.turn === 'red' ? T('status_side_red') : T('status_side_black')) });
      cls = snap.turn === 'red' ? 'status-red-turn' : 'status-black-turn';
      if (engine.inCheck(snap.turn)) { text += ' ' + T('status_check'); cls = 'status-check'; }
    }
    if (view.aiThinking) {
      text = S18('status_thinking', { model: view.aiThinking, side: (view.aiThinkingSide === 'black' ? T('status_side_black') : T('status_side_red')) });   // v1.7.4: 加方别
      cls = 'status-thinking-' + (view.aiThinkingSide === 'black' ? 'black' : 'red');
    }
    document.getElementById('status-text').textContent = text;
    // v1.0.daily a11y: 读屏播报走独立 sr-only 区 (低频回合/将军/胜负/思考开始), 与每秒 tick 解耦;
    // 仅文本变化才写入 — render() 在键盘光标移动等场景也会触发, 无变化不重复播报
    var srSt = document.getElementById('sr-status');
    if (srSt) {
      var key = text + '|' + cls;
      if (key !== srSt._last) { srSt._last = key; srSt.textContent = text; }
    }
    if (view.aiThinking) {
      document.getElementById('status-info').textContent = '';   // 思考中: 由 tick 填充当前思考时间
    } else {
      var elapsed = (Date.now() - view.startTime) / 1000 | 0;
      var ph = phaseCN(engine);
      document.getElementById('status-info').textContent = '第' + engine.ply() + '手 · ' + (elapsed / 60 | 0) + ':' + ('0' + (elapsed % 60)).slice(-2) + (ph ? ' · ' + ph : '');
    }
    document.getElementById('status-bar').className = cls;
    document.getElementById('btn-row').classList.toggle('visible', engine.isOver());
  }

  function renderOverlay(engine, view) {
    var overlay = document.getElementById('end-overlay');
    if (engine.isOver()) {
      var r = engine.result();
      var reason = r.result === 'stalemate' ? '困毙 · 对方无子可动且未被将军'
                 : r.result === 'checkmate' ? '绝杀 · 对方无合法应将走法'
                 : r.result === 'perpetual' ? '长将判负 · 一方连续将军不变招 (v2.0 规则闭环)'
                 : r.result === 'repetition' ? '三次重复判和 · 同一局面反复出现, 双方不变招 (v2.2 规则闭环)'
                 : r.result === 'natural' ? '自然限着判和 · 双方 60 回合无吃子 (v3.8 规则闭环)' : '';
      document.getElementById('eo-title').textContent = r.winner === 'red' ? (XQ.I18N ? XQ.I18N.t('status_win_red') : '🏆 红方胜利') : r.winner === 'black' ? (XQ.I18N ? XQ.I18N.t('status_win_black') : '🏆 黑方胜利') : (XQ.I18N ? XQ.I18N.t('status_draw') : '和棋');
      document.getElementById('eo-sub').textContent = reason;
      overlay.classList.add('show');
      // 第24轮 a11y: 终局卡焦点入卡 (仅 隐藏→显示 转换沿触发一次; 双 rAF 等 visibility 过渡起帧 — 同第23轮设置面板教训)
      if (!overlay._wasShown) {
        overlay._wasShown = true;
        var eoBtn = overlay.querySelector('.eo-btn');
        var eoFocus = function () { if (eoBtn && document.getElementById('end-overlay').classList.contains('show')) { try { eoBtn.focus({ preventScroll: true }); } catch (eF) { eoBtn.focus(); } } };
        if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { requestAnimationFrame(eoFocus); });
        else setTimeout(eoFocus, 0);
      }
    } else {
      overlay.classList.remove('show');
      overlay._wasShown = false;   // 复位: 下一局终局再次焦点入卡
    }
  }

  function aiBanner(mode, msg, side) {
    var b = document.getElementById('ai-banner');
    b.className = mode || '';
    if (side) b.classList.add(side === 'red' ? 'side-red' : 'side-black');
    b.innerHTML = msg || '';   // v2 HUD: 分段配色 (ico/model/state/meta spans)
  }

  /* v1.0.daily 长对局 (100+ 手) DOM 防护: move-log 条目超上限只保留尾部, 头部一行折叠提示
     (100 手 = 100+ 常驻节点 + 每手 scrollTop 强制重排; 裁剪封顶节点数, 全程仍可回放/棋谱导出) */
  var LOG_CAP = 150, logTrimmed = 0;
  function logMove(n, side, pieceChar, name, capturedType, capturedChar, secs, cn) {
    var log = document.getElementById('move-log');
    if (!log.children.length) logTrimmed = 0;   // v1.0.daily 复审修复: 新对局重置折叠计数 (重开/导入清空 move-log 后不再累积旧值)
    var e = document.createElement('div');
    e.className = 'log-entry';
    e.dataset.ply = n;   // v1.5.5: 点击复盘 — 点击该手跳到该局面
    var Tl = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return 'Click to jump to move ' + a.n; };   // 第27轮 i18n: 条目 title 原硬编码中文 (I9 守护点)
    e.title = Tl('log_entry_title', { n: n }) + (cn ? ' · ' + cn : '');   // v1.7: 中文记谱
    e.innerHTML = '<span class="log-dot ' + side + '">●</span><span class="log-num">' + n + '. </span><span class="' + (side === 'red' ? 'log-red' : 'log-black') + '">'
      + pieceChar + '</span> ' + name + (capturedChar ? ' ×' + capturedChar : '')
      + (secs ? '<span class="log-secs"> ⏱' + secs + 's</span>' : '');
    log.appendChild(e);
    var entries = log.querySelectorAll('.log-entry');
    if (entries.length > LOG_CAP) {
      logTrimmed++;
      entries[0].parentNode.removeChild(entries[0]);
      var more = log.querySelector('.log-more');
      if (!more) {
        more = document.createElement('div');
        more.className = 'log-more';
        log.insertBefore(more, log.firstChild);
      }
      var T = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return ('… ' + a.n + ' earlier moves folded'); };
      more.textContent = T('log_trimmed', { n: logTrimmed });
    }
    log.scrollTop = log.scrollHeight;
  }

  // v1.5.5: 点击 move-log 中任意一手, 派发 xq:replay 事件 (app.js 接手)
  document.addEventListener('DOMContentLoaded', function () {
    var log = document.getElementById('move-log');
    if (!log || log._replayBound) return;
    log._replayBound = true;
    log.addEventListener('click', function (ev) {
      var e = ev.target.closest('.log-entry');
      if (!e || !e.dataset.ply) return;
      var ply = parseInt(e.dataset.ply, 10);
      document.dispatchEvent(new CustomEvent('xq:replay', { detail: { ply: ply } }));
    });
  });

  /* ── 竞技场思考面板 (红左/黑右): name+stat+body+分页器 ──
     流式全文分页展示: 页满自动跳下一页(跟随最新), ‹› 可回看历史页 */
  var thinkState = {};

  var _mfSeq = 0, _fontCache = {};
  function measureFont(body) {
    var key = body._mfKey || (body._mfKey = 'm' + (++_mfSeq));
    var curSize = body.clientWidth + 'x' + body.clientHeight;
    var hit = _fontCache[key];
    if (hit && hit.size === curSize) return hit.m;   // v1.0.daily 性能: 尺寸未变复用测量 (流式分页不再每段 canvas 测量 + getBoundingClientRect 重排; 折叠/缩放后尺寸变化自动重测)
    var cs = window.getComputedStyle(body);
    var fs = parseFloat(cs.fontSize) || 10.5;
    var cw = fs * 0.62;                          // ASCII 估计
    var cwCJK = fs;                              // CJK 全宽估计
    try {
      var cv = document.createElement('canvas').getContext('2d');
      cv.font = cs.fontStyle + ' ' + cs.fontWeight + ' ' + fs + 'px ' + cs.fontFamily;
      cw = Math.max(4, cv.measureText('MMMMMMMMMM').width / 10);
      cwCJK = Math.max(fs * 0.8, cv.measureText('测测测测测测测测测测').width / 10);
    } catch (e) {}
    var lh = parseFloat(cs.lineHeight);
    // line-height:1.5 (无单位) 的 computed value 是数字 1.5, 必须乘回字号; 否则行数虚高 10 倍致单页容量失控
    if (!lh || isNaN(lh) || lh < fs) lh = fs * 1.5;
    var m = { cw: (cw + cwCJK) / 2, lh: lh };     // 中英混合按均值估
    _fontCache[key] = { size: curSize, m: m };
    return m;
  }

  function paginate(body, text) {
    if (!text) return [''];
    var m = measureFont(body);
    var rect = body.getBoundingClientRect();
    var cols = Math.max(8, Math.floor((rect.width - 18) / m.cw));
    var lines = Math.max(2, Math.floor((rect.height - 14) / m.lh));
    var cap = Math.max(40, Math.min(2400, Math.floor(cols * lines * 0.85)));   // 上限保护 + 15% 折行误差余量 (canvas 测量 vs DOM 实际折行有偏差)
    var pages = [];
    for (var i = 0; i < text.length; i += cap) pages.push(text.slice(i, i + cap));
    return pages.length ? pages : [''];
  }

  function paintPager(root, body, st) {
    var pg = root.querySelector('.think-pager');
    if (!pg) {
      pg = document.createElement('div');
      pg.className = 'think-pager';
      pg.innerHTML = '<button type="button" class="pg-btn pg-prev">‹</button><span class="pg-info"></span><button type="button" class="pg-btn pg-next">›</button>';   // 第24轮: span→button — 翻页器键盘可达 (Tab 聚焦 + Enter 原生触发)
      root.appendChild(pg);
      pg.querySelector('.pg-prev').onclick = function (e) {
        e.stopPropagation();
        st.idx = Math.max(0, st.idx - 1); body.textContent = st.pages[st.idx]; paintPager(root, body, st);
      };
      pg.querySelector('.pg-next').onclick = function (e) {
        e.stopPropagation();
        st.idx = Math.min(st.pages.length - 1, st.idx + 1); body.textContent = st.pages[st.idx]; paintPager(root, body, st);
      };
    }
    if (st.pages.length > 1) {
      pg.classList.add('show');
      pg.querySelector('.pg-info').textContent = (st.idx + 1) + '/' + st.pages.length;
    } else {
      pg.classList.remove('show');
    }
  }

  function thinkPanel(side, opts) {
    opts = opts || {};
    var key = side === 'red' ? 'red' : 'black';
    var root = document.getElementById(key === 'red' ? 'think-red' : 'think-black');
    if (!root) return;
    var body = root.querySelector('.think-body');
    var st = thinkState[key] = thinkState[key] || { text: '', pages: [''], idx: 0 };
    // v1.5 AI 信息条: 等级徽章 + 当前优势评价
    if (opts.info !== undefined) {
      var infoEl = document.getElementById(key === 'red' ? 'think-red-info' : 'think-black-info');
      if (infoEl) infoEl.innerHTML = opts.info;
    }
    if (opts.name !== undefined) {
      var nameEl = document.getElementById(key === 'red' ? 'think-red-name' : 'think-black-name');
      if (nameEl) {
        nameEl.textContent = opts.name;
        nameEl.title = opts.title || opts.name;
      }
    }
    if (opts.stat !== undefined) {
      var statEl = document.getElementById(key === 'red' ? 'think-red-stat' : 'think-black-stat');
      if (statEl) statEl.textContent = opts.stat;
    }
    if (opts.cards !== undefined && body) {
      // v1.5 决策卡片模式: 结构化信息 (策略/候选/评价) 替代长文本; 分页器隐藏
      st.cards = opts.cards;
      body.classList.add('card-mode');
      body.innerHTML = opts.cards.length ? opts.cards.join('') : '<div class="d-empty">' + T('think_wait') + '</div>';   // 第27轮 i18n: 空态原硬编码中文 (复用 think_wait)
      body.scrollTop = body.scrollHeight;   // v1.7.1: 卡片模式自动滚到底部 (最新决策可见)
    } else if (body) {
      body.classList.remove('card-mode');
    }
    if (opts.text !== undefined && body && opts.cards === undefined) {
      st.text = String(opts.text);
      if (st.text.length > 20000) st.text = st.text.slice(-20000);   // 防护: 超长日志只留尾部
      st.pages = paginate(body, st.text);
      if (st.idx >= st.pages.length) st.idx = st.pages.length - 1;
      if (opts.active) st.idx = st.pages.length - 1;   // 流式跟随最新页 (页满自动翻页)
      body.textContent = st.pages[st.idx];
      if (opts.active) body.scrollTop = body.scrollHeight;   // v1.7.1: 流式文本贴底
    }
    if (opts.active !== undefined) {
      root.classList.toggle('idle', !opts.active);
      root.classList.toggle('thinking', !!opts.active);   // 思考状态呼吸动画 (CSS)
      if (body) body.classList.toggle('on', !!opts.active);
    }
    paintPager(root, body, st);
  }

  /* ── v1.5 决策卡片渲染 (app 提供 meta, 输出 HTML 片段数组) ──
   * 展示: 手号/着法/策略/候选走法与评分/局面评价/信心耗时 — 直播平台信息卡 */
  function esc(s) {
    return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }
  function decisionCards(entries, total) {
    var cards = entries.map(function (e) {
      var cands = (e.candidates || []).map(function (c) {
        return '<span class="d-cand">' + esc(c.move) + (c.score ? ' <b>' + esc(c.score) + '</b>' : '') + '</span>';
      }).join('');
      var hasReason = !!e.reasoning;
      return '<div class="dcard">'
        + '<div class="d-head"><span class="d-move">#' + e.n + ' ' + esc(e.name) + '</span>'
        + (e.evaluation ? '<span class="d-eval">' + esc(e.evaluation) + '</span>' : '')
        + (hasReason ? '<button class="d-toggle" data-ply="' + e.n + '">💭</button>' : '')
        + '</div>'
        + (e.plan ? '<div class="d-plan">📌 ' + esc(e.plan) + '</div>' : '')
        + (e.summary ? '<div class="d-sum">' + esc(e.summary === '兑底·安全着法' ? T('fb_summary') : e.summary) + '</div>' : '')   // 第27轮 i18n: 兑底摘要是数据标记 (app.js:295 按 zh 串比对), 渲染层按标记本地化, 数据不动
        + (cands ? '<div class="d-cands">' + cands + '</div>' : '')
        + '<div class="d-meta">' + (e.confidence != null ? T('d_conf') + esc(e.confidence) + ' · ' : '') + (e.secs ? esc(e.secs) + 's' : '') + '</div>'   // 第27轮 i18n: 信 角标原硬编码
        + (hasReason ? '<div class="d-reason" data-ply="' + e.n + '" style="display:none">' + esc(e.reasoning.indexOf('【兑底】') === 0 ? T('fb_reason') : e.reasoning) + '</div>' : '')   // 第27轮 i18n: 兑底推理同上 (标记前缀比对)
        + '</div>';
    });
    if (total > entries.length) cards.push('<div class="d-more">' + TA('d_more', { n: total - entries.length }) + '</div>');   // 第27轮 i18n: 折叠行原硬编码中文 (EN 实机截图抓漏)
    return cards;
  }
  // v1.5.5: 卡片 💭 按钮折叠/展开思考过程
  document.addEventListener('DOMContentLoaded', function () {
    document.body.addEventListener('click', function (ev) {
      var b = ev.target.closest('.d-toggle');
      if (!b) return;
      var ply = b.dataset.ply;
      var r = document.querySelector('.d-reason[data-ply="' + ply + '"]');
      if (r) {
        var open = r.style.display !== 'none';
        r.style.display = open ? 'none' : 'block';
        b.classList.toggle('on', !open);
      }
    });
  });

  /* ═══ v1.7 HUD 组件 ═══ */
  /* 被吃子力托盘: chars = 该方吃掉的对方子力字符数组 */
  function capturedTray(side, chars) {
    var el = document.getElementById('think-' + side + '-captured');
    if (el) el.innerHTML = (chars && chars.length) ? '<b>' + T('tray_captured') + '</b>' + chars.join('') : '';   // 第27轮 i18n: 俘 字原硬编码
  }
  /* 最新着法大字徽章: html 传入, null 隐藏 (app 侧 4s 定时淡出) */
  function lastMoveBadge(html) {
    var el = document.getElementById('last-move-badge');
    if (!el) return;
    if (!html) { el.classList.remove('show'); return; }
    el.innerHTML = html;
    el.classList.add('show');
  }
  /* 评值走势 sparkline: arr = 本方视角评值序列, 中线=均势, 越高越优 */
  function evalSpark(side, arr) {
    var el = document.getElementById('think-' + side + '-spark');
    if (!el) return;
    if (!arr || !arr.length) { el.innerHTML = ''; return; }
    var w = 182, h = 26;
    var clamp = function (v) { return Math.max(-3, Math.min(3, v)); };
    var span = Math.max(1, arr.length - 1);   // v1.0.daily 修复: 采样窗取实际点数 — 原 Math.max(len,8) 让 1~7 点序列挤在左缘细条 (对局早期曲线几乎不可见)
    var xOf = function (i) { return (i / span) * (w - 4) + 2; };
    var pts = arr.map(function (v, i) {
      var x = arr.length === 1 ? w / 2 : xOf(i);   // 单点居中
      var y = h / 2 - clamp(v) / 3 * (h / 2 - 3);
      return x.toFixed(1) + ',' + y.toFixed(1);
    }).join(' ');
    var li = arr.length - 1;
    var cx = arr.length === 1 ? w / 2 : xOf(li);
    var cy = h / 2 - clamp(arr[li]) / 3 * (h / 2 - 3);
    var lineCol = side === 'red' ? '#e78a7a' : '#7fb8e8';
    /* v1.0.daily 第20轮: 线下渐变面积填充 (SVG 内部装饰, 不加 DOM) — 走势方向一眼可读 */
    var areaPts = '2,' + (h - 1) + ' ' + pts + ' ' + (arr.length === 1 ? w / 2 : (w - 2)) + ',' + (h - 1);
    el.innerHTML = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none">'
      + '<defs><linearGradient id="spark-fill-' + side + '" x1="0" y1="0" x2="0" y2="1">'
      + '<stop offset="0" stop-color="' + lineCol + '" stop-opacity=".30"/>'
      + '<stop offset="1" stop-color="' + lineCol + '" stop-opacity="0"/></linearGradient></defs>'
      + '<polygon points="' + areaPts + '" fill="url(#spark-fill-' + side + ')"/>'
      + '<line x1="0" y1="' + h / 2 + '" x2="' + w + '" y2="' + h / 2 + '" stroke="rgba(240,217,160,.25)" stroke-width="1" stroke-dasharray="3,3"/>'
      + '<polyline points="' + pts + '" fill="none" stroke="' + lineCol + '" stroke-width="1.6"/>'
      + '<circle cx="' + cx.toFixed(1) + '" cy="' + cy.toFixed(1) + '" r="2.4" fill="#ffd54a"><title>' + (XQ.I18N ? XQ.I18N.tArgs('spark_latest', { v: arr[li].toFixed(1) }) : ('最新 ' + arr[li].toFixed(1))) + '</title></circle>'
      + '</svg>';
  }

  /* ── 轻量时钟刷新 (每秒 tick, 不重建棋盘) ── */
  function updateClock(engine, view) {
    if (engine.isOver()) return;
    var elapsed = (Date.now() - view.startTime) / 1000 | 0;
    var el = document.getElementById('status-info');
    var ph = phaseCN(engine);
    if (el) el.textContent = '第' + engine.ply() + '手 · ' + (elapsed / 60 | 0) + ':' + ('0' + (elapsed % 60)).slice(-2) + (ph ? ' · ' + ph : '');
  }

  XQ.UI = { CS: CS, drawBoard: drawBoard, render: render, aiBanner: aiBanner, logMove: logMove, thinkPanel: thinkPanel, decisionCards: decisionCards, updateClock: updateClock, capturedTray: capturedTray, lastMoveBadge: lastMoveBadge, evalSpark: evalSpark };
})(typeof window !== 'undefined' ? window : globalThis);
