/* ui/app.js — 应用控制器: 组装 Engine + Agents + Renderer */
(function () {
  'use strict';
  var XQ = window.XQ;
  if (XQ.I18N) XQ.I18N.init();   // 第23轮修复: init 从未被任何人调用 — 存了 en 的用户首屏静态文案与 <html lang> 停在中文 (实测抓到的既有 bug; i18n.js 先于本文件加载, 此处注册的 DOMContentLoaded apply 先于下方 app 初始化跑)

  /* ── 音效 (Web Audio 合成) ── */
  var actx = null, mBus = null, _noise = null;
  var sndMuted = false;
  try { sndMuted = localStorage.getItem('xq_snd') === 'off'; } catch (e) {}
  window._snd = { select: 0, drop: 0 };
  function ensureAudio() {
    if (!actx) { try { actx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return; } }
    if (actx && actx.state === 'suspended') { try { actx.resume(); } catch (e) {} }
  }
  var volPct = 90;   // 第34轮: 音量百分比 (设置滑条联动 masterBus 增益)
  function masterBus() {
    if (!mBus) {
      mBus = actx.createGain(); mBus.gain.value = 0.9 * volPct / 100;
      var comp = actx.createDynamicsCompressor();
      comp.threshold.value = -20; comp.knee.value = 14; comp.ratio.value = 5;
      mBus.connect(comp); comp.connect(actx.destination);
    }
    return mBus;
  }
  function noiseBuf() {
    if (!_noise) {
      _noise = actx.createBuffer(1, actx.sampleRate * 0.15 | 0, actx.sampleRate);
      var d = _noise.getChannelData(0);
      for (var i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    }
    return _noise;
  }
  function playSelect() {
    window._snd.select++;
    if (sndMuted || !actx) return;
    var t = actx.currentTime + 0.001;
    var j = Math.pow(2, Math.random() * 0.10 - 0.05);
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = 'triangle';
    o.frequency.setValueAtTime(860 * j, t);
    o.frequency.exponentialRampToValueAtTime(575 * j, t + 0.07);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 0.007);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.09);
    o.connect(g); g.connect(masterBus()); o.start(t); o.stop(t + 0.11);
  }
  function playDrop(isCapture) {
    window._snd.drop++;
    if (sndMuted || !actx) return;
    var t = actx.currentTime + 0.001;
    var j = Math.pow(2, Math.random() * 0.09 - 0.045);
    var o = actx.createOscillator(), g = actx.createGain();
    o.type = 'sine';
    var f = isCapture ? 148 : 192;
    o.frequency.setValueAtTime(f * j, t);
    o.frequency.exponentialRampToValueAtTime(f * 0.55 * j, t + 0.11);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(isCapture ? 0.23 : 0.165, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.0001, t + (isCapture ? 0.21 : 0.15));
    o.connect(g); g.connect(masterBus()); o.start(t); o.stop(t + 0.26);
    var s = actx.createBufferSource(); s.buffer = noiseBuf();
    var bp = actx.createBiquadFilter(); bp.type = 'bandpass';
    bp.frequency.value = (isCapture ? 720 : 940) * j; bp.Q.value = 1.1;
    var ng = actx.createGain();
    ng.gain.setValueAtTime(0.0001, t);
    ng.gain.exponentialRampToValueAtTime(isCapture ? 0.20 : 0.135, t + 0.004);
    ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.10);
    s.connect(bp); bp.connect(ng); ng.connect(masterBus()); s.start(t); s.stop(t + 0.13);
  }
  /* v1.5 将军警示音: 两连上升音 (紧迫感) */
  function playCheck() {
    if (sndMuted || !actx) return;
    var t = actx.currentTime + 0.02;
    [740, 988].forEach(function (f, i) {
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(f, t + i * 0.09);
      g.gain.setValueAtTime(0.0001, t + i * 0.09);
      g.gain.exponentialRampToValueAtTime(0.09, t + i * 0.09 + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.09 + 0.085);
      o.connect(g); g.connect(masterBus()); o.start(t + i * 0.09); o.stop(t + i * 0.09 + 0.1);
    });
  }

  /* ── 全局状态 ── */
  var engine = XQ.Engine.create();
  var selected = null;
  var startTime = Date.now();
  var agents = { red: null, black: null };   // {kind:'human'|'random'|'llm', agent?}
  var aiBusy = false;
  var currentRecord = null;
  var relayAvailable = false;
  var _noKeysConfigured = false;   // 第28轮: 中继活但零 Key (server-warn 提示条件)
  var thinkStat = { red: { total: 0, moves: 0 }, black: { total: 0, moves: 0 } };
  var decisionLog = { red: [], black: [] };   // v1.3 决策日志 (漏声明会炸 startRecord → 对局永不启动) // 思考耗时/手数
  var thinkStart = { red: 0, black: 0 };     // 当前思考开始时刻
  // ═══ v1.7 HUD 状态 ═══
  var capturedBy = { red: [], black: [] };   // 各方吃掉的对方子力字符
  var evalHist = { red: [], black: [] };     // 各方自评走势 (数字序列)
  var checkPulseTimer = null, lastBadgeTimer = null, thinkWarned = false;
  var gameId = 0;              // v1.0.daily 对局世代: startRecord 自增; 迟到的 agent/兑底回调按世代作废 (重开不串局)
  var gameAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;   // 第38轮: 对局级中止 — 重开/改设置即掐断在飞 LLM 请求 (不再继续烧 token)
  var kbCursor = null;         // v1.0.daily a11y 键盘走子光标 (声明提前, 供 startRecord/restart 复位)
  var checkFlashUntil = 0;   // 将军横幅闪屏期间, tick 暂停覆盖 ai-banner
  var repWarnedN = 0;        // v1.7.7 重复局面已告警到的次数 (只升不降, restart 清零)
var chWarnedN = 0;         // v1.7.8 长将已告警到的连续将军手数 (只升不降, restart 清零)

  var view = {
    boardEl: document.getElementById('board'),
    selected: null,
    startTime: startTime,
    aiThinking: null,
    aiThinkingSide: null,
    onCellClick: onCellClick,
    onCancelSelect: function () { selected = null; refresh(); }   // 第33轮: 拖拽取消语义 (渲染层拖出/原地放下时调用)
  };

  /* 第28轮: 全局脚本错误轻量钩子 — 首错横幅 (err 态) + console 详情; 不重复轰炸观战 */
  var _errShown = false;
  window.addEventListener('error', function (ev) {
    console.warn('[LLM-chess] script error:', ev.message, ev.filename + ':' + ev.lineno);
    if (_errShown) return;
    _errShown = true;
    try {
      XQ.UI.aiBanner('err', '⚠ ' + String(ev.message || 'script error').slice(0, 60), null);
      bindBannerDismiss();   // 第46轮: 脚本错误横幅此前无任何关闭绑定 (errBanner 才绑) → 出现即永久驻留
    } catch (eE) {}
  });

  /* ── 交互 ── */
  function onCellClick(x, y) {
    if (engine.isOver() || aiBusy) return;
    var p = engine.pieceAt(x, y);
    if (selected) {
      var res = engine.applyPlayerMove(selected.x, selected.y, x, y);
      if (res.ok) {
        selected = null;
        afterMove(res);
      } else if (p && p.color === engine.turn()) {
        selected = { x: x, y: y };
        playSelect();
      } else {
        selected = null;
      }
    } else if (p && p.color === engine.turn()) {
      selected = { x: x, y: y };
      playSelect();
    }
    refresh();
  }

  /* 决策日志渲染: 每手一行 (手号/着法/摘要/评价/信心/耗时) — 文本模式 (卡片不可用时兜底) */
  function logTextFor(side) {
    if (!decisionLog[side] || !decisionLog[side].length) return '';
    var Tf = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
    return decisionLog[side].map(function (e) {
      return '#' + e.n + ' ' + e.name + '\n  ' + (e.fallback ? Tf('fb_summary') : e.summary)   // 第41轮: 兑底行同样走字典 (卡片模式为主路径, 此处为纯文本兜底)
        + (e.evaluation ? ' | ' + e.evaluation : '')
        + (e.confidence != null ? ' | ' + (XQ.I18N ? XQ.I18N.t('d_conf') : '信') + e.confidence : '')
        + (e.secs ? ' | ' + e.secs + 's' : '');
    }).join('\n');
  }
  /* v1.0.3 提示词等级徽章与决策面板 */
  function levelCN(s) {   // 第27轮 i18n: 档位徽章 无/低/中/高 原硬编码中文 (EN 面板徽章可见)
    var k = s === 'none' ? 'lvl_none' : s === 'low' ? 'lvl_low' : s === 'high' ? 'lvl_high' : 'lvl_mid';
    return XQ.I18N ? XQ.I18N.t(k) : (s === 'none' ? '无' : s === 'low' ? '低' : s === 'high' ? '高' : '中');
  }
  function levelClass(s) { return s === 'none' ? 'st-none' : s === 'low' ? 'st-low' : s === 'high' ? 'st-high' : 'st-mid'; }
  /* v1.0.daily i18n: token 统计后缀 (总tok/缓存命中%/拦截次) — modelCard 与 tick 共用一处, 双语 (原两处各自裸中文) */
  function tokenStatsSuffix(u) {
    var Tk = XQ.I18N ? XQ.I18N.t : function (k2) { return k2; };
    var s = '';
    if (u && u.total) s += ' · ' + (u.total > 999 ? (u.total / 1000).toFixed(1) + 'k' : u.total) + ' tok';
    if (u && u.cacheHit && u.prompt) s += ' · ' + Tk('stats_cached') + ' ' + Math.round(100 * u.cacheHit / u.prompt) + '%';   // v2.9: 缓存命中率上卡 (provider 上报才显示)
    if (u && u.blocked) s += ' · ' + Tk('stats_blocked') + ' ' + u.blocked;   // v3.2: 系统拦截次数上卡
    return s;
  }
  /* v1.7.2 模型信息卡: 提供商/模型全名/总思考时间/_tokens — 放在思考内容上方的浮卡里 */
  function modelCardHTML(side, holder) {
    var h = holder || agents[side];
    var st = thinkStat[side] || { total: 0 };
    var tok = (h && h.agent && h.agent.usage) ? tokenStatsSuffix(h.agent.usage()) : '';
    var model = (h && h.model) || (currentRecord && currentRecord[side] && currentRecord[side].model) || '';
    var prov = (h && h.provider) || (currentRecord && currentRecord[side] && currentRecord[side].provider) || '';
    if (!model) return '';
    var perVoter = '';
    if (h && h.agent && h.agent.usage) {
      var uv = h.agent.usage();
      if (uv && uv.perVoter && uv.perVoter.length > 1) {   // 第32轮: 会诊逐选民 token 分解
        perVoter = '<div class="im-stat">' + uv.perVoter.map(function (pv) {
          return esc2(pv.name) + ': ' + (pv.total > 999 ? (pv.total / 1000).toFixed(1) + 'k' : pv.total) + 'tok';
        }).join(' · ') + '</div>';
      }
    }
    return '<div class="im-model">' + esc2((prov ? prov + ' · ' : '') + model) + '</div>'
      + '<div class="im-stat">' + (XQ.I18N ? XQ.I18N.tArgs('think_total', { n: st.total || 0 }) : '总思考 ' + (st.total || 0) + 's') + tok + '</div>' + perVoter;   // 第27轮 i18n: 统计行原硬编码中文
  }
  function infoHTML(side, holder, evaluation) {
    var h = holder || agents[side];
    var badge = (h && h.quick ? '<span class="badge-quick">' + (XQ.I18N ? XQ.I18N.t('badge_quick') : '⚡快答') + '</span> ' : '') + (h ? '<span class="badge-style ' + levelClass(h.style) + '">' + levelCN(h.style) + '</span>' : '');   // 第27轮 i18n: 快答徽章原硬编码中文
    return modelCardHTML(side, h) + badge + (evaluation ? ' <span class="info-eval">⚖️ ' + esc2(evaluation) + '</span>' : '');
  }
  /* v1.7 中文记谱: 炮二平五 / 马八进七 (红汉字/黑数字, 马象走目标列, 直线子走步数) */
  function cnNotation(side, piece, from, to, pieceAt) {
    try {
      var CN = ['一', '二', '三', '四', '五', '六', '七', '八', '九'];
      /* v1.7.6 修复: 引擎类型名是 knight/bishop (原 horse/elephant 永不命中 → 马/象的中文记谱恒为空) */
      var pc = { red: { rook: '车', cannon: '炮', knight: '马', bishop: '相', advisor: '仕', king: '帅', pawn: '兵' },
        black: { rook: '车', cannon: '砲', knight: '马', bishop: '象', advisor: '士', king: '将', pawn: '卒' } }[side][piece];
      if (!pc) return '';
      var fileOf = function (x) { return side === 'red' ? CN[8 - x] : String(x + 1); };
      /* v3.9a 同列同种消歧 (亚洲记谱): 同列 2+ 同色同种 → 前/后 替代列号; 兵 3+ 同列 → 前/中/后。
         pieceAt(x,y) 由调用方注入对局后盘面视图: 走子方仍在原列 (直线进退) 时扫描自然命中 to 位;
         已离列 (平移/马象仕) 时补回 from.y。无盘面 (回放/测试 4 参调用) 时跳过, 保持旧形态 */
      var prefix = '';
      if (typeof pieceAt === 'function') {
        var ranks = [], moverRank = (to.x === from.x) ? to.y : from.y;
        for (var yy = 0; yy < 10; yy++) {
          var q = null;
          try { q = pieceAt(from.x, yy); } catch (eQ) {}
          if (q && q.color === side && q.type === piece && yy !== from.y) ranks.push(yy);
        }
        if (ranks.indexOf(moverRank) < 0) ranks.push(moverRank);
        if (ranks.length > 1) {
          ranks.sort(function (a2, b2) { return side === 'red' ? a2 - b2 : b2 - a2; });   // 前 = 更贴近敌方 (红 y 小 / 黑 y 大)
          var idx2 = ranks.indexOf(moverRank);
          if (idx2 >= 0) {
            if (piece === 'pawn' && ranks.length >= 3) prefix = idx2 === 0 ? '前' : (idx2 === ranks.length - 1 ? '后' : '中');
            else prefix = idx2 === 0 ? '前' : '后';
          }
        }
      }
      var head = prefix ? prefix + pc : pc + fileOf(from.x);
      if (from.y === to.y) return head + '平' + fileOf(to.x);
      var fwd = side === 'red' ? to.y < from.y : to.y > from.y;
      var d = fwd ? '进' : '退';
      var steps = Math.abs(to.y - from.y);
      /* v1.7.6: 斜行子 (马/象/仕) 进退数字均为目标列 — 原漏了 advisor (仕四进五 被误算成步数) */
      var t = (piece === 'knight' || piece === 'bishop' || piece === 'advisor') ? fileOf(to.x) : (side === 'red' ? CN[steps - 1] : String(steps));
      return head + d + t;
    } catch (e) { return ''; }
  }
  function parseEvalNum(s) {
    var m = /([+-]?\d+(?:\.\d+)?)/.exec(String(s || ''));
    return m ? parseFloat(m[1]) : NaN;
  }
  function esc2(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }
  /* 第42轮: 面板 stat 文案单出口 (总耗时·手数·token 用量) — afterMove 与 undoLastMove 共用。
     原实现内联在 afterMove 里, 撤销路径无法复用, 于是撤销后 stat 一直显示撤销前的手数/累计耗时 (虚高)。 */
  function panelStatText(side, secs) {
    var Tm3 = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return k; };
    var tok = '';
    var h = agents[side];
    if (h && h.agent && h.agent.usage) {
      var u = h.agent.usage();
      if (u && u.total) tok = (u.total > 999 ? (u.total / 1000).toFixed(1) : u.total) + 'tok';
    }
    var perMove = secs ? Tm3('think_per_move', { s: secs }) : '?';
    return XQ.I18N
      ? Tm3('think_stat_tpl', { t: thinkStat[side].total, m: thinkStat[side].moves, p: perMove }) + (tok ? '·' + tok : '')
      : thinkStat[side].total + 's·' + thinkStat[side].moves + '手·' + perMove + (tok ? '·' + tok : '');
  }
  function decisionPanelOpts(side) {
    var log = decisionLog[side] || [];
    if (log.length && XQ.UI.decisionCards) {
      return { cards: XQ.UI.decisionCards(log.slice(-4), log.length), active: false };
    }
    var Tw0 = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
    return { text: logTextFor(side) || Tw0('think_wait'), active: false };   // 第26轮 i18n
  }
  /* 第41轮: 棋子显示字统一出口 (渲染层按 xq_pieces 决定汉字/字母) — 原 HUD/回放层多处直取 CHARS,
     「EN 界面 + Letters」下最新着法徽章、吃子托盘、回放盘面与信息面板都与棋盘自相矛盾 (第40轮只修了走法列表) */
  function pg(color, type) {
    return XQ.UI && XQ.UI.pieceGlyph ? XQ.UI.pieceGlyph(color, type) : XQ.Piece.CHARS[color][type];
  }
  /* 第41轮 兑底透明化 (v2.0 语义): 兑底着法 = 模型未给 summary 且未给 confidence (重试全败后安全阀代走)。
     原实现用 `entry.summary === '(无摘要)'` 判定 — 而该值自第40轮起改由字典产出 (EN 译作 '(no summary)'),
     跨语言比对必然失败 → 英文界面下兑底徽章/摘要/推理全部不再出现 (功能随 i18n 修复静默消失)。
     现按「模型是否真的给了 summary」这一原始事实判定, 并落在语言中立的布尔旗标 entry.fallback 上,
     渲染层据旗标选词 (见 renderer.decisionCards), 与界面语言彻底解耦。 */
  function fbMark(entry, hasSummary, rawReasoning) {
    entry.fallback = !hasSummary && entry.confidence == null;
    if (!entry.fallback) return entry;
    entry.summary = '';   // 摘要位置让给本地化的 fb_summary (旗标即数据, 不再用中文串充当标记)
    if (!rawReasoning) entry.reasoning = '【兑底】前几次输出无效, 系统按静态评分选定此安全走法';   // 前缀是数据标记, renderer 按前缀映射 fb_reason
    return entry;
  }
  function afterMove(res, secs, meta) {
    var m = res.move;
    var side = m.piece.color;
    secs = secs || 0;
    if (secs) thinkStat[side].total += secs;
    thinkStat[side].moves++;
    var cn = cnNotation(side, m.piece.type, m.from, m.to, function (px, py) { try { return engine.pieceAt(px, py); } catch (eCN) { return null; } });   // v1.7 中文记谱 (v3.9a 注入盘面视图 → 同列同种 前/中/后 消歧)
    XQ.UI.logMove(engine.ply(), side,
      XQ.Piece.CHARS[m.piece.color][m.piece.type],
      XQ.Move.name(m),
      m.captured ? m.captured.type : null,
      m.captured ? XQ.Piece.CHARS[m.captured.color][m.captured.type] : null,
      secs, cn);
    // 决策日志 (v1.5): 含 plan/candidates, 渲染为结构化卡片
    var holder = agents[side];
    var hasSummary = !!(meta && meta.summary);   // 第41轮: 原始事实 (非字典产物) — 兑底判定的唯一依据
    var entry = {
      n: engine.ply(),
      name: pg(m.piece.color, m.piece.type) + '-' + XQ.Move.sqName(m.from) + '\u2192' + XQ.Move.sqName(m.to),   // 第41轮: 卡片标题子名随显示偏好 (浏览器实机抓出 — 静态扫描看不出拼接产物)
      summary: hasSummary ? meta.summary : '',
      plan: (meta && meta.plan) || '',
      evaluation: (meta && meta.evaluation) || '',
      confidence: (meta && typeof meta.confidence === 'number') ? meta.confidence : null,
      candidates: (meta && meta.candidates) || [],
      reasoning: cleanReason((meta && meta.reasoning) || ''),   // v1.5.5 中文过滤 + v1.5.10 清洗坐标扫描噪音, 卡片 💭 展开查看
      secs: secs
    };
    fbMark(entry, hasSummary, entry.reasoning);   // 第41轮: 兑底着法标旗 (无 summary 且无 confidence)
    if (!entry.fallback && !entry.summary) entry.summary = (XQ.I18N ? XQ.I18N.t('summary_none') : '(无摘要)');   // 纯展示兜底: 有 summary 缺失但置信度在 → 保留原「无摘要」占位
    decisionLog[side].push(entry);
    if (decisionLog[side].length > 60) decisionLog[side].shift();
    XQ.UI.thinkPanel(side, {
      cards: XQ.UI.decisionCards ? XQ.UI.decisionCards(decisionLog[side].slice(-4), decisionLog[side].length) : null,
      /* 第47轮 热路径: 纯文本兜底改为**按需**拼接 — XQ.UI.decisionCards 恒存在 (renderer 提供), 原实现却每手都
         调 logTextFor(side) 把整份决策日志 (上限 60 条) 拼成多行串, 随即因 text 为 undefined 被丢弃 (纯垃圾分配)。 */
      text: XQ.UI.decisionCards ? undefined : logTextFor(side),
      active: false,
      info: infoHTML(side, holder, entry.evaluation)
    });
    var newest33 = document.querySelector('#think-' + side + '-body .dcard:last-of-type:not(.d-thinking)');   // 第33轮: 仅最新决策卡入场
    if (newest33) newest33.classList.add('d-new');
    // 面板 stat: 总耗时·手数·token 用量 (不覆盖卡片模式, 只更新 stat)
    thinkStat[side].lastSecs = secs;   // v1.5.5: 最近一手延迟 (面板 stat 实时显示)
    // 第40轮 i18n: 原 statTxt 直接拼裸中文 ('手' / 's/手') → EN 界面面板尾部显示 "11s·11手·1s/手"
    XQ.UI.thinkPanel(side, { stat: panelStatText(side, secs) });   // 第42轮: 文案走单出口 (撤销路径复用同一实现)
    playDrop(!!m.captured);
    // v1.5 观战动画: 滑动入位 + 吃子 ghost; 将军提示音 + 状态条已有文字
    view.pendingAnim = m;
    if (engine.inCheck(engine.turn()) && !engine.isOver()) playCheck();
    // ═══ v1.7 HUD 更新 ═══
    if (m.captured) {
      capturedBy[side].push(XQ.Piece.CHARS[m.captured.color][m.captured.type]);
      XQ.UI.capturedTray(side, capturedBy[side]);
    }
    var evN = parseEvalNum(meta && meta.evaluation);
    if (!isNaN(evN)) { evalHist[side].push(evN); if (evalHist[side].length > 60) evalHist[side].shift(); }
    XQ.UI.evalSpark(side, evalHist[side]);
    var srEl = document.getElementById('sr-move');
    if (srEl) {
      var Ts = XQ.I18N ? XQ.I18N.t : function (k) { return k; }, TAs = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return k; };
      srEl.textContent = TAs('sr_move', { n: engine.ply(), side: Ts(side === 'red' ? 'status_side_red' : 'status_side_black'), cn: cn || (XQ.Move.sqName(m.from) + '->' + XQ.Move.sqName(m.to)) });   // v1.0.daily a11y: 屏幕阅读器着法播报
    }
    var fbBadge = entry.fallback ? ' <span style="color:#e67e22">' + Ts('fb_badge') + '</span>' : '';   // v2.0 兑底透明化; 第26轮 i18n (兑底徽章双语); 第41轮 改按 fallback 旗标 (原比对中文串, EN 恒 false)
    XQ.UI.lastMoveBadge('<b>#' + engine.ply() + '</b> ' + (side === 'red' ? '🔴' : '⚫') + ' '
      + pg(side, m.piece.type) + ' <b>' + esc2(cn) + '</b> <span style="opacity:.65">' + esc2(XQ.Move.sqName(m.from) + '→' + XQ.Move.sqName(m.to)) + '</span>'
      + (m.captured ? ' <span style="color:#e67e22">✕' + pg(m.captured.color, m.captured.type) + '</span>' : '') + fbBadge, engine.ply());   // 第45轮: 把 ply 一并交给徽章 (点击回看该手的数据源)
    if (lastBadgeTimer) clearTimeout(lastBadgeTimer);
    lastBadgeTimer = setTimeout(function () { XQ.UI.lastMoveBadge(null); }, 4000);
    if (engine.inCheck(engine.turn()) && !engine.isOver()) {
      checkFlashUntil = Date.now() + 2500;
      warnBanner(Ts('status_check'), side);   // 第26轮: 复用字典 status_check (原硬编码中文, EN 用户不可读)
      var bd = document.getElementById('board');
      if (bd) {
        bd.classList.remove('check-pulse'); void bd.offsetWidth; bd.classList.add('check-pulse');
        if (checkPulseTimer) clearTimeout(checkPulseTimer);
        checkPulseTimer = setTimeout(function () { bd.classList.remove('check-pulse'); }, 1900);
      }
    }
    // v1.7.7 重复局面告警 (v2.2 更新): 2次提示变招; 3次引擎已自动判和 (result='repetition')
    if (engine.repetitionCount) {
      var repN = engine.repetitionCount();
      if (repN >= 2 && repN > repWarnedN) {
        repWarnedN = repN;
        warnBanner(repN >= 3 ? TAs('warn_repetition_draw', { n: repN }) : TAs('warn_repetition_2'), side);   // 第26轮 i18n
      }
    }
    // v1.7.8 长将告警: 一方连续将军 4 手以上 → 横幅提示长将判负风险 (引擎 checkStreak)
    if (engine.checkStreak) {
      var csN = engine.checkStreak(side);
      if (csN >= 4 && csN > chWarnedN) {
        chWarnedN = csN;
        warnBanner(TAs('warn_long_check', { side: (side === 'red' ? '🔴 ' + Ts('status_side_red') : '⚫ ' + Ts('status_side_black')), n: csN }), side);   // 第26轮 i18n
      }
    }
    if (currentRecord) {
      XQ.Record.addMove(currentRecord, engine, m, secs * 1000);
      if (engine.ply() % 5 === 0) XQ.Record.save(currentRecord);   // 第30轮: 进行中对局每 5 手自动存档 (崩溃/F5 可续)
      syncArchive();   // v1.0.daily: 有手可存 → 启用 存棋谱
      if (res.status.over) {
        playEnd(res.status.winner);   // v1.0.daily 终局提示音 (红胜上行/黑胜下行/和棋单音)
        // 终局: 记录 token 用量并自动存入本地战绩
        ['red', 'black'].forEach(function (sd) {
          var hh = agents[sd];
          if (hh && hh.agent && hh.agent.usage) currentRecord.tokens[sd] = hh.agent.usage();
        });
        XQ.Record.finish(currentRecord, res.status, Date.now() - startTime);
        XQ.Record.save(currentRecord);
        /* 第42轮: Te/TAe 必须在**首次使用之前**赋值 — 原实现在终局卡渲染处 (且嵌在 `if (eo)` 内) 才声明, 而下面
           Elo 行已经调用了 TAe; var 只提升声明不提升赋值 → AI 对 AI 局 (双方都非人类, 即本项目主场景) 走到该行必抛
           `TypeError: TAe is not a function`, 终局卡统计/Elo 行/两个按钮整块被跳过, 且异常被 scheduleAgent 的
           AI 失败 catch 吞掉 (误判为模型失败 → 弹错误横幅 + 往棋谱 note 写入垃圾 + 在已终局局面再排一次随机兑底走子)。
           实机证据: 一局 489 手自然限着判和的棋谱 note = `#489(TAe is not a function)随机;`。 */
        var Te = XQ.I18N ? XQ.I18N.t : function (k) { return k; }, TAe = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return k; };   // 第26轮 i18n
        // 第28轮: Elo 实时记账 (双方均非人类才入表 — 人类执子成绩不污染模型对战胜率表)
        var eloHtml = '';
        if (agents.red && agents.black && agents.red.kind !== 'human' && agents.black.kind !== 'human'
          && XQ.Elo && XQ.Elo.previewDelta && XQ.Elo.applyResult) {
          var eR = currentRecord.red.name, eB = currentRecord.black.name;
          var eScore = res.status.winner === 'red' ? 1 : res.status.winner === 'black' ? 0 : 0.5;
          var eD = XQ.Elo.previewDelta(XQ.Elo.ratingOf(eR), XQ.Elo.ratingOf(eB), eScore);
          XQ.Elo.applyResult(eR, eB, res.status.winner);
          var eFmt = function (v) { return (v > 0 ? '+' : '') + v; };
          eloHtml = '<br>' + TAe('eo_elo', { r: XQ.Elo.ratingOf(eR), dr: eFmt(eD.dra), b: XQ.Elo.ratingOf(eB), db: eFmt(eD.drb) });
        }
        // v1.7 终局结算数据
        var eo = document.getElementById('eo-stats');
        if (eo) {
          var rAvg = thinkStat.red.moves ? (thinkStat.red.total / thinkStat.red.moves).toFixed(1) : '-';
          var bAvg = thinkStat.black.moves ? (thinkStat.black.total / thinkStat.black.moves).toFixed(1) : '-';
          var fmtT = function (x) { return x ? (x > 999 ? (x / 1000).toFixed(1) + 'k' : x) : '-'; };
          var tk = currentRecord.tokens || {};
          var cachePct = function (t2) { return t2 && t2.cacheHit && t2.prompt ? Math.round(100 * t2.cacheHit / t2.prompt) + '%' : Te('eo_cache_na'); };   // v3.4 终局卡缓存命中; 第26轮 i18n
          var blkCnt = function (t2) { return t2 && t2.blocked ? t2.blocked : 0; };   // v3.4 系统拦截计数
          var eoLine = function (dot, sd) {   // 第26轮: 红黑统计行共用一键 eo_stats_side (原两行硬编码中文)
            return dot + ' ' + Te(sd === 'red' ? 'status_side_red' : 'status_side_black') + ' '
              + TAe('eo_stats_side', { a: sd === 'red' ? rAvg : bAvg, t: fmtT(tk[sd] && tk[sd].total), c: capturedBy[sd].length, p: cachePct(tk[sd]), b: blkCnt(tk[sd]) });
          };
          eo.innerHTML = TAe('eo_stats_total', { n: engine.ply(), s: Math.round((Date.now() - startTime) / 1000) })
            + '<br>' + eoLine('🔴', 'red')
            + '<br>' + eoLine('⚫', 'black') + eloHtml;
          // v2.4 终局一键回放本局 (对局→录像闭环, 免去回放选择器翻找; Record 已在上方落 localStorage)
          eo.insertAdjacentHTML('beforeend', '<div style="margin-top:8px"><button class="btn" id="eo-replay">' + Te('eo_replay_btn') + '</button></div>');   // 第26轮 i18n
          var eob = eo.querySelector('#eo-replay');
          if (eob) eob.onclick = function () { rpWatchRecord(); };
          /* 第42轮: 终局「💾 导出本局」的宿主是终局卡 (.eo-card), 与 #eo-stats 是兄弟节点; 原实现从 eo (=#eo-stats)
             子树里 querySelector('#eo-export') 恒为 null → 该按钮自第33轮加入起从未生效 (点了没有任何反应)。 */
          var eox = document.getElementById('eo-export');
          if (eox) eox.onclick = function () { if (currentRecord) XQ.Record.downloadFile(currentRecord); };   // 第33轮: 终局一键导出
        }
      }
    }
    if (!engine.isOver()) scheduleAgent();
  }

  function refresh() {
    view.selected = selected;
    view.kbCursor = kbCursor;   // v1.0.daily a11y: 键盘走子光标随渲染高亮
    view.startTime = startTime;
    XQ.UI.render(engine, view);
  }

  /* v1.0.daily a11y 键盘走子: 方向键移动光标, Enter/Space 选子/走子, Esc 取消 (人棋玩家无鼠标可玩) */
  var kbCursor = null;
  /* 第41轮 a11y: 光标落点播报 — 原实现只有一圈视觉描边, 读屏用户按方向键拿不到任何反馈 (知道自己在哪一格、
     格上有没有子、是哪一方的子), 键盘走子对读屏等于不可用。独立播报区避免与着法播报互相覆盖。 */
  function announceCursor() {
    if (!kbCursor) return;
    var el = document.getElementById('sr-cursor');
    if (!el) return;
    var Ta = XQ.I18N ? XQ.I18N.tArgs : function (kk, a) { return kk; };
    var p = null;
    try { p = engine.pieceAt(kbCursor.x, kbCursor.y); } catch (eP) {}
    var sq = XQ.Move.sqName({ x: kbCursor.x, y: kbCursor.y });
    el.textContent = p ? Ta('sr_cursor_piece', { sq: sq, p: pg(p.color, p.type) }) : Ta('sr_cursor_empty', { sq: sq });
  }
  /* 第42轮 a11y: 光标清理单出口 — 原实现有 5 处各自 `kbCursor = null`, 都不清 #sr-cursor 的文本。
     播报区留着上一格的文案, 读屏对「内容没有变化的重复写入」不会再次播报 → 清掉光标后回到同一格
     (默认落点 f5 再按一次方向键仍是 f5) 就再也听不到坐标反馈。与第40轮「#sr-alert 收起时必须清空,
     否则同一错误无法再次播报」同一条教训, 本轮把它补到光标播报区。 */
  function clearKbCursor() {
    kbCursor = null;
    var el = document.getElementById('sr-cursor');
    if (el) el.textContent = '';
  }
  function kbMove(dx, dy) {
    if (!kbCursor) { kbCursor = { x: 4, y: 5 }; }   // 缺省落在棋盘中央
    kbCursor.x = Math.max(0, Math.min(8, kbCursor.x + dx * (flipOn ? -1 : 1)));
    kbCursor.y = Math.max(0, Math.min(9, kbCursor.y + dy * (flipOn ? -1 : 1)));
    refresh();
    announceCursor();
  }

  /* ── Agent 调度 ── */
  function agentFor(side) { return agents[side] && agents[side].kind !== 'human' ? agents[side] : null; }

  /* v1.5.10c: 思考流清洗 — 三层兕底
     1) 复述提示词类机械短语 (方向感"行15 进行号增大"/输出预算"总长90字"被模型背进思考) → 删
     2) token 级扫描: ≥4 连续垃圾 token (子力字/1-2位数字/点横加号斜杠) → 压缩 …
     3) … 与 … 之间仅夹孤立垃圾残渣 (… 炮 …//… 炮 …) → 循环合并为单个 …
     进/平/捉/护等实词打断序列: 正常记谱 (马 8 进 7) 与战术句子原样保留 */
  function cleanReason(raw) {
    var s = String(raw || '');
    s = s.replace(/(?:红方|黑方)?在?(?:上方|下方)?行?\d+[\s　]*进行号[增减][大小]?/g, ' ');   // ① 方向感复述
    s = s.replace(/进行号[增减][大小]?/g, ' ');
    s = s.replace(/总长\s*\d+\s*字/g, ' ');                                                    // ① 输出预算复述
    s = s.replace(/^[，。,;；\s　]+/, '');                                                    // ① 输出预算复述
    s = s.replace(/([01])[\.．]([0-9]{1,2})(?![0-9])/g, '$1\u0001$2');   // 保护 0.x/1.x 小数 (信心/评价值), 占位符含控制符不会被当垃圾 token
    s = s.replace(/(?:[车马炮兵卒将士象帅相仕]|[0-9]{1,2}|[\.．\/\-－—–\+＋?？])(?:[\s　]*(?:[车马炮兵卒将士象帅相仕]|[0-9]{1,2}|[\.．\/\-－—–\+＋?？])){3,}/g, '…');   // ② 含 / 变体; 逗号等散文标点会打断序列; v1.7.6 修复: 主扫描类 \/- 未转义形成 U+002F..U+FF0D 区间, 吞掉全部汉字/数字 → 正常中文思考被压成省略号
    s = s.replace(/\u0001/g, '.');   // 还原小数点
    var prev;                                                                                   // ③ …残渣合并 (… 炮 …//… 炮 … → …)
    do {
      prev = s;
      s = s.replace(/…(?:[\s　]*(?:[\/\.．\-－—–\+＋?？0-9]|[车马炮兵卒将士象帅相仕])){0,6}[\s　]*…/g, '…');
      s = s.replace(/…[\s　]*[平进退][\s　]*…/g, '…');
      s = s.replace(/…[\s　]*[\/\.．\-－—–\+＋?？]+(?=[^\s\/\.．\-－—–\+＋?？0-9]|$)/g, '…');   // … 后拖尾标点 (…//占线 → …占线)
    } while (s !== prev);
    s = s.replace(/(^|[\s　，。,;；])(?:[\/\.．\-－—–\+＋?？])(?:[\s　]*[\/\.．\-－—–\+＋?？]){1,6}(?=\s|$)/gm, '$1');   // 行尾孤立标点残渣 (- . .)
    s = s.replace(/[\.．]{2,}/g, ' ');
    s = s.replace(/[ \t]{3,}/g, ' ');
    s = s.replace(/\n{2,}/g, '\n');
    return s.trim();
  }
  /* 思考面板 (竞技场): 红左/黑右, 流式全文写入, 面板内部分页展示 */
  function showThinking(side, text) {
    var t = cleanReason(text);
    XQ.UI.thinkPanel(side, { text: t || '…', active: true });
  }
  function hideThinking(side) {
    XQ.UI.thinkPanel(side, { text: '', active: false });
  }

  var thinkTimer = null, warnTimer = null;
  function bannerThinking(modelName, side) {
    var start = Date.now();
    var gid = gameId;   // 第39轮: 世代快照 — 旧局 ticker 到期自清 (只清自己的句柄, 不误清新局定时器)
    thinkStart[side] = start;
    view.aiThinkingSide = side;
    view.aiRetries = view.aiRetries || {}; view.aiRetries[side] = 0;   // v2.5: 每手重试计数归零
    thinkWarned = false;
    if (thinkTimer) clearInterval(thinkTimer);
    var TI = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return k; };   // 第26轮 i18n (ticker/慢思考横幅)
    var selfTimer = null;
    var tick = function () {
      if (gid !== gameId) { if (selfTimer) clearInterval(selfTimer); return; }
      var s = Math.floor((Date.now() - start) / 1000);           // 当前思考时间 → 顶部状态条
      var g = Math.floor((Date.now() - startTime) / 1000);       // 全局时间
      var info = document.getElementById('status-info');
      if (info && view.aiThinking) { var rcR = view.aiRetries ? view.aiRetries[view.aiThinkingSide] : 0; var phT = ''; try { var pht = XQ.XiangqiKnowledge && XQ.XiangqiKnowledge.detectPhase(engine); phT = (pht && XQ.I18N) ? XQ.I18N.t('phase_' + pht) : ((pht && XQ.XiangqiKnowledge.PHASE_CN && XQ.XiangqiKnowledge.PHASE_CN[pht]) || ''); } catch (eP) {} info.textContent = TI('status_ticker', { n: engine.ply(), s: s, ph: phT ? ' · ' + phT : '', rt: rcR ? TI(view.aiRetryWait ? 'status_retry_wait' : 'status_retry', { n: rcR, s: Math.round((view.aiRetryWait || 0) / 1000) }) : '' }); }   // 第38轮: 重试等待量 · v1.7.4 全局时间只在下方横幅; v2.5 重试可见; v3.7 阶段徽章; 第40轮: 阶段名走字典 (原直取中文常量 → EN 每秒显示中文)
      if (s >= 60 && !thinkWarned) { thinkWarned = true; warnBanner(TI('warn_think_slow', { m: modelName, n: s }), side); }   // 第26轮 i18n
      if (Date.now() >= checkFlashUntil) {   // 将军横幅闪屏期不被 tick 覆盖
        XQ.UI.aiBanner('busy', (XQ.I18N ? XQ.I18N.tArgs('ai_elapsed', { t: (g / 60 | 0) + ':' + ('0' + g % 60).slice(-2) }) : '全局 ' + (g / 60 | 0) + ':' + ('0' + g % 60).slice(-2)), side);   // v1.7.4: 下方横幅只显示全局时间 (上方已含模型/方别/手数)
      }
      var hh = agents[side];   // v1.7.3: 信息卡总思考实时跳动
      var imStat = document.querySelector('#think-' + side + '-info .im-stat');
      if (imStat) {
        var tok = (hh && hh.agent && hh.agent.usage) ? tokenStatsSuffix(hh.agent.usage()) : '';
        imStat.textContent = (XQ.I18N ? XQ.I18N.tArgs('think_total', { n: (thinkStat[side] ? thinkStat[side].total : 0) + s }) : '总思考 ' + ((thinkStat[side] ? thinkStat[side].total : 0) + s) + 's') + tok;
      }
    };
    tick();
    selfTimer = setInterval(tick, 1000);   // 第39轮: 句柄本地化 — 旧局 tick 到期时只清自己的 interval
    thinkTimer = selfTimer;
  }
  function bannerClear() {
    if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
    view.aiThinkingSide = null;
    XQ.UI.aiBanner('', '');
  }
  function warnBanner(msg, side) {
    XQ.UI.aiBanner('warn', msg, side);
    clearTimeout(warnTimer);
    var wg = gameId;   // 第39轮: 世代 — 旧局定时器不得清掉新局横幅
    warnTimer = setTimeout(function () { if (wg !== gameId) return; XQ.UI.aiBanner('', ''); }, 6000);   // 警告 6s 后自动消失
  }
  /* 第46轮: 横幅关闭绑定抽成单出口 — 原实现只在 errBanner (LLM 失败) 里就地绑定, 于是 window.onerror
     的脚本错误横幅 (走 XQ.UI.aiBanner('err', …), 不经 errBanner) 全仓零关闭绑定: 它既没有自动消失定时器
     (warnTimer 只在两个 banner 函数里设), 也没有 click/keydown 监听 → 一旦出现就永久驻留、键盘也关不掉。
     现在两个入口共用同一份绑定 (含 Enter/Space 键盘出口)。 */
  function bindBannerDismiss() {
    var abEl = document.getElementById('ai-banner');
    if (!abEl || abEl._dismissBound) return;
    abEl._dismissBound = true;
    var abClose = function () { clearTimeout(warnTimer); XQ.UI.aiBanner('', ''); };
    abEl.addEventListener('click', abClose);   // v1.0.daily: 点击横幅立即关闭 (取消残留定时器)
    /* 第40轮 a11y: renderer 仅在警告态给横幅 tabIndex=0 — 补 Enter/Space 关闭, 键盘用户不再只能干等 15s 自清 */
    abEl.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Enter' && ev.key !== ' ') return;
      ev.preventDefault();
      ev.stopPropagation();   // 不外溢到全局 Enter/Space 键盘走子分支
      abClose();
    });
  }
  // v1.5.5: LLM 错误分类提示 (常驻 15s, 区分网络/鉴权/格式/上游限流) — 第26轮: 分类文案全部走字典
  function errBanner(model, errMsg, side) {
    var m = String(errMsg || '').slice(0, 80);
    var TwE = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
    var tag = /429|\u9650\u6d41|rate/.test(m) ? TwE('err_rate_limited')
            : /503|\u7e41\u5fd9|busy/.test(m) ? TwE('err_busy')
            : /REASONING_REQUIRED|\u6df1\u5ea6\u601d\u8003/.test(m) ? TwE('err_think_required')
            : /UNKNOWN_FIELD|\u672a\u77e5\u5b57\u6bb5/.test(m) ? TwE('err_unknown_field')
            : /402|insufficient balance|\u4f59\u989d|\u6b20\u8d39|quota/i.test(m) ? TwE('warn_pay')
            : /401|403|\u9274\u6743|key|Key/.test(m) ? TwE('err_bad_key')
            : /400/.test(m) ? TwE('err_bad_request')
            : /fetch|network|abort|timeout/.test(m) ? TwE('err_network')
            : '❌ ' + m;
    XQ.UI.aiBanner('warn', tag, side);
    bindBannerDismiss();
    clearTimeout(warnTimer);
    var wgE = gameId;   // 第39轮: 同上 — 世代守卫 (错误横幅 15s 后自清, 不跨局)
    warnTimer = setTimeout(function () { if (wgE !== gameId) return; XQ.UI.aiBanner('', ''); }, 15000);   // 错误提示延长 15s
  }

  /* v1.5.5: 复盘 — 点击 move-log 中任一手跳到该局面 (支持 还原 到最新) */
  var replayStack = [];   // undo 多出的 moves, 用于 还原
  function replayTo(ply) {
    var hist = engine.history();
    var cur = hist.length;
    if (ply < 0 || ply > cur) return;
    if (ply === cur) return;   // 点击最新手不做任何事
    replayStack = [];
    while (engine.ply() > ply) {
      var last = engine.lastMove();
      replayStack.push(last);
      engine.undoPly();   // 第30轮关键修复: 门面只有 undoPly (无 undoMove) — 复盘功能自第19轮起点击即抛错从未生效
    }
    aiBusy = false;
    bannerClear();
    refresh();
    var T8 = XQ.I18N ? XQ.I18N.t : function (k) { return k; }, TA8 = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return k; };
    warnBanner(TA8('rp_replay_toast', { n: ply }), replayStack.length ? (replayStack[0].piece && replayStack[0].piece.color) : null);   // v1.0.daily i18n
    // 高亮选中 (长对局时滚入视区)
    var log = document.getElementById('move-log');
    if (log) Array.from(log.children).forEach(function (e) {
      var isCur = parseInt(e.dataset.ply, 10) === ply;
      e.classList.toggle('active', isCur);
      /* 第47轮 a11y: 条目是 role=button (第45轮补), 而「当前手」此前只有 .active 视觉底色 — 读屏用户跳转后
         不知道自己在哪一手 (第46轮给回放层走法表补了 aria-current, 主界面这处漏了)。 */
      if (isCur) e.setAttribute('aria-current', 'true'); else e.removeAttribute('aria-current');
    });
    var act = log && log.querySelector('.log-entry.active');
    if (act) { try { act.scrollIntoView({ block: 'nearest' }); } catch (eSV) {} }
    // 复盘后加还原按钮到状态条
    paintReplayBar();
  }
  function replayRestore() {
    /* 第30轮关键修复: 门面无 applyMove — 还原改走 applyPlayerMove (按 LIFO 顺序重放; 规则闭环触发时截断保底盘) */
    while (replayStack.length) {
      var m30 = replayStack.pop();
      var r30 = engine.applyPlayerMove(m30.from.x, m30.from.y, m30.to.x, m30.to.y);
      if (!r30.ok) break;
    }
    replayStack = [];
    refresh();
    paintReplayBar();
    warnBanner((XQ.I18N ? XQ.I18N.t('rp_restored') : '✅ 已还原到最新局面'), null);   // v1.0.daily i18n
  }
  function paintReplayBar() {
    var bar = document.getElementById('replay-bar');
    if (!bar) {
      bar = document.createElement('div');
      bar.id = 'replay-bar';
      bar.style.cssText = 'position:absolute;left:50%;top:6px;transform:translateX(-50%);z-index:55;display:none;gap:6px';
      bar.innerHTML = '<button id="replay-restore" style="background:#f1c40f;color:#1a0e08;border:1px solid #a08040;border-radius:8px;padding:4px 12px;cursor:pointer;font-size:12px;font-weight:bold">' + (XQ.I18N ? XQ.I18N.t('rp_restore') : '⟲ 还原') + '</button>';   // 第26轮 i18n
      document.body.appendChild(bar);
      bar.querySelector('#replay-restore').onclick = replayRestore;
    }
    bar.style.display = replayStack.length ? 'flex' : 'none';
  }
  document.addEventListener('xq:replay', function (ev) { replayTo(ev.detail.ply); });

  /* 最近走法历史(旧→新, 最多12手) */
  function recentHistory() {
    if (!currentRecord) return null;
    var ms = currentRecord.moves.slice(-12);
    return ms.length ? ms : null;
  }

  function scheduleAgent() {
    /* 第42轮: 回放态 (载入棋谱后 currentRecord 置空 = 明确「不记新档」) 不得让 AI 接管。
       载入棋谱走的是 restartGame() → 其中排了 100ms 后的本函数, 而导入流程紧接着把 currentRecord 置空;
       原实现没有这道闸门 → AI 会在刚导入的残局上继续走子, 而这些手既不进棋谱 (currentRecord=null) 也不进
       终局结算, 界面状态自相矛盾 (像是「能续弈但存不下来」), 也与「导入棋谱JSON并重放」的按钮语义相反。 */
    if (!currentRecord) return;
    if (engine.isOver() || aiBusy) return;
    var side = engine.turn();
    var gid = gameId;   // v1.0.daily 世代捕获: 重开/新局后迟到的调度作废
    var holder = agentFor(side);
    if (!holder) { bannerClear(); return; }
    aiBusy = true;
    /* 第27轮 i18n: 随机AI 的 label 已含方别 (随机AI(红)/Random AI (Red)), status_thinking 模板还会再拼一次
       {side} → EN 出现 "(Red) (Red)"、zh 出现 "随机AI(红)（红方）" (第26轮遗留观察); 状态条走无方别名 */
    view.aiThinking = holder.kind === 'random' ? (XQ.I18N ? XQ.I18N.t('agent_random_name') : '随机AI') : holder.label;
    // 对方面板: 保留决策卡片 (v1.5), 无卡片时退回日志文本
    var oppSide = side === 'red' ? 'black' : 'red';
    XQ.UI.thinkPanel(oppSide, decisionPanelOpts(oppSide));
    var Tw = XQ.I18N ? XQ.I18N.t : function (k) { return k; };   // 第26轮 i18n (思考中提示)
    var thinkCards = decisionLog[side] && decisionLog[side].length ? XQ.UI.decisionCards(decisionLog[side].slice(-4), decisionLog[side].length) : null;
        if (thinkCards) thinkCards.push('<div class="dcard d-thinking">' + Tw('think_busy') + '</div>');   // v1.7.3: 保留决策卡+思考中提示; 第26轮 i18n
        XQ.UI.thinkPanel(side, thinkCards
          ? { cards: thinkCards, active: true, info: infoHTML(side, holder, '') + ' <span class="info-thinking">' + Tw('think_busy') + '</span>' }
          : { text: Tw('think_busy'), active: true, info: infoHTML(side, holder, '') + ' <span class="info-thinking">' + Tw('think_busy') + '</span>' });
    refresh();                       // 先渲染顶部状态条 (方色/文案)
    bannerThinking(holder.model, side);   // 再启动 tick: 顶部思考时间 + 底部全局时间
    setTimeout(function () {
      if (gid !== gameId) return;   // v1.0.daily: 调度时刻已过期 → 静默放弃 (防旧分析串入新局)
      Promise.resolve()
        .then(function () { return holder.agent.next(engine, recentHistory()); })
        .then(function (mv) {
        if (gid !== gameId) return;   // v1.0.daily: 等待上游期间对局被重开 → 结果作废
        if (engine.isOver()) { aiBusy = false; bannerClear(); return; }
        var secs = thinkStart[side] ? Math.round((Date.now() - thinkStart[side]) / 1000) : 0;
        var res = engine.applyPlayerMove(mv.from.x, mv.from.y, mv.to.x, mv.to.y);
        aiBusy = false;
        view.aiThinking = null;
        thinkStart[side] = 0;
        bannerClear();
        if (res.ok) { selected = null; afterMove(res, secs, mv.meta); }
        else { warnBanner((XQ.I18N ? XQ.I18N.tArgs('warn_move_rejected', { m: holder.model, r: res.reason }) : '⚠️ ' + holder.model + ' 走法被拒: ' + res.reason), side); }   // 第26轮 i18n
        refresh();
      }).catch(function (err) {
        if (gid !== gameId) return;   // 第39轮: 旧世代失败作废 — startRecord 触发的 abort 也会走到这里, 不得清掉新局的 aiBusy/横幅或把旧局错误写进新谱
        var secs = thinkStart[side] ? Math.round((Date.now() - thinkStart[side]) / 1000) : 0;
        aiBusy = false;
        view.aiThinking = null;
        thinkStart[side] = 0;
        bannerClear();
        // 兑底: LLM 三次重试全败 → 随机合法着法, 保证对局不卡死
        var moves = engine.generateLegalMoves(side);
        if (moves && moves.length) {
          var mv = moves[Math.floor(Math.random() * moves.length)];
          errBanner(holder.model, err && err.message || err, side);   // v1.5.5: 错误分类提示 (15s)
          // 追加兑底原因到当前棋谱 (供 benchmark 复盘)
          if (currentRecord) currentRecord.note = (currentRecord.note || '') + '#' + engine.ply() + '(' + String(err && err.message || '').slice(0, 24) + ')随机;';
          setTimeout(function () {
            if (gid !== gameId) return;   // v1.0.daily: 兑底延时期间已重开 → 不再乱走新局
            var res = engine.applyPlayerMove(mv.from.x, mv.from.y, mv.to.x, mv.to.y);
            if (res.ok) { selected = null; afterMove(res, secs); }
            refresh();
          }, 1200);
        } else {
          XQ.UI.thinkPanel(side, { text: (XQ.I18N ? XQ.I18N.tArgs('agent_fail', { m: String(err && err.message || err).slice(0, 80) }) : '失败: ' + String(err && err.message || err).slice(0, 80)), active: false });   // 第26轮 i18n
          errBanner(holder.model, err && err.message || err, side);
          refresh();
        }
      });
    }, 350);
  }

  /* ── 设置 ── */
  var SIDE_DEFS = {
    red: { checkbox: 'ai-red-enabled', type: 'ai-red-type', provider: 'ai-red-provider', model: 'ai-red-model', style: 'ai-red-style', quick: 'ai-red-quick', multi: 'ai-red-multi', label: '红方' },
    black: { checkbox: 'ai-black-enabled', type: 'ai-black-type', provider: 'ai-black-provider', model: 'ai-black-model', style: 'ai-black-style', quick: 'ai-black-quick', multi: 'ai-black-multi', label: '黑方' }
  };
  var CFG_KEY = 'xq_v1_settings';

  /* 动态拉取服务商列表 (中继可用时覆盖静态 options) */
  var PROVIDER_MODELS = {};
  function fillModelDatalist() {
    var dl = document.getElementById('model-datalist');
    if (!dl) return;
    var opts = [];
    var seen = {};
    Object.keys(SIDE_DEFS).forEach(function (side) {
      var pid = document.getElementById(SIDE_DEFS[side].provider).value;
      (PROVIDER_MODELS[pid] || []).forEach(function (m) {
        if (seen[m]) return; seen[m] = 1; opts.push(m);
      });
    });
    /* v3.9: 中继不可用/当前服务商无 models 时保留 index.html 静态兑底模型名 (与 config/keys.json 核对去重), 不再清空 */
    if (!opts.length) return;
    dl.innerHTML = '';
    opts.forEach(function (m) {
      var opt = document.createElement('option');
      opt.value = m;
      dl.appendChild(opt);
    });
  }
  function refreshModelDefaults() {
    Object.keys(SIDE_DEFS).forEach(function (side) {
      var pid = document.getElementById(SIDE_DEFS[side].provider).value;
      var recs = PROVIDER_MODELS[pid] || [];
      var inp = document.getElementById(SIDE_DEFS[side].model);
      if (!inp.value.trim() && recs.length) inp.value = recs[0];
    });
    fillModelDatalist();
  }
  function loadProviderOptions() {
    if (!relayAvailable) return Promise.resolve(false);
    return fetch('api/providers').then(function (r) { return r.json(); })
      .then(function (j) {
        var list = (j && j.providers) || [];
        if (!list.length) return false;
        _noKeysConfigured = !list.some(function (pk) { return pk.hasKey; });   // 第28轮: 零 Key 探测 (设置面板给可操作提示)
        PROVIDER_MODELS = {};
        list.forEach(function (p) { PROVIDER_MODELS[p.id] = p.models || []; });
        Object.keys(SIDE_DEFS).forEach(function (side) {
          var sel = document.getElementById(SIDE_DEFS[side].provider);
          var cur = sel.value;
          sel.innerHTML = '';
          list.forEach(function (p) {
            var opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name + (p.hasKey ? '' : ' (' + (XQ.I18N ? XQ.I18N.t('provider_no_key') : '未配Key') + ')');   // 第30轮 i18n
            sel.appendChild(opt);
          });
          // 保留原选择; 若已不存在则回退到第一个已配Key的项
          var has = list.some(function (p) { return p.id === cur; });
          if (has) { sel.value = cur; }
          else {
            var keyed = list.filter(function (p) { return p.hasKey; });
            sel.value = keyed.length ? keyed[0].id : list[0].id;
          }
          // 模型为空时默认填该服务商第一个推荐模型
          var modelInput = document.getElementById(SIDE_DEFS[side].model);
          if (!modelInput.value.trim()) {
            var recs = PROVIDER_MODELS[sel.value] || [];
            if (recs.length) modelInput.value = recs[0];
          }
        });
        fillModelDatalist();
        // 换服务商时同步默认模型 + datalist
        Object.keys(SIDE_DEFS).forEach(function (side) {
          document.getElementById(SIDE_DEFS[side].provider).addEventListener('change', function () {
            var recs = PROVIDER_MODELS[this.value] || [];
            document.getElementById(SIDE_DEFS[side].model).value = recs[0] || '';
            fillModelDatalist();
          });
        });
        return true;
      })
      .catch(function () { return false; });
  }

  function readSettings() {
    var s = { red: {}, black: {} };
    Object.keys(SIDE_DEFS).forEach(function (side) {
      var d = SIDE_DEFS[side];
      s[side] = {
        enabled: document.getElementById(d.checkbox).checked,
        type: document.getElementById(d.type).value,
        provider: document.getElementById(d.provider).value,
        model: document.getElementById(d.model).value,
        style: document.getElementById(d.style) ? document.getElementById(d.style).value : 'mid',
        quick: document.getElementById(d.quick) ? document.getElementById(d.quick).checked : false,
        multi: document.getElementById(d.multi) ? document.getElementById(d.multi).value : 'off'   // 第31轮: 逐侧多 LLM 模式
      };
    });
    return s;
  }
  function fillSettings(saved) {
    Object.keys(SIDE_DEFS).forEach(function (side) {
      var d = SIDE_DEFS[side], v = saved[side] || {};
      if (!v.multi && saved.multi) v.multi = saved.multi;   // 第31轮: 旧全局 multi 迁移到逐侧
      document.getElementById(d.checkbox).checked = !!v.enabled;
      document.getElementById(d.type).value = v.type || 'human';
      document.getElementById(d.provider).value = v.provider || 'deepseek';
      document.getElementById(d.model).value = v.model || '';
      if (document.getElementById(d.style)) document.getElementById(d.style).value = v.style || 'mid';
      if (document.getElementById(d.quick)) document.getElementById(d.quick).checked = !!v.quick;
      if (document.getElementById(d.multi)) document.getElementById(d.multi).value = v.multi || 'off';
    });
  }
  function saveAISettings() {
    /* 第36轮: 对局进行中改设置=开新局 — 与 R 键悔棋路径同口径确认 */
    if (engine.ply() > 0 && !engine.isOver()) {
      var Tc = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
      if (!window.confirm(Tc('btn_restart_confirm'))) return;
    }
    var s = readSettings();
    try { localStorage.setItem(CFG_KEY, JSON.stringify(s)); } catch (e) {}
    closeAISettings();   // 第23轮: 走统一出口 (焦点归还齿轮)
    applyAgents(s);
    engine.newGame();
    startRecord();
    selected = null; startTime = Date.now();
    document.getElementById('move-log').innerHTML = '';
    aiBusy = false;
    refresh();
    setTimeout(scheduleAgent, 100);
  }
  function applyAgents(s) {
    Object.keys(SIDE_DEFS).forEach(function (side) {
      var v = s[side] || { type: 'human' };
      if (!v.enabled || !v.type || v.type === 'human') { agents[side] = null; return; }
      if (v.type === 'random') {
        var Ts7 = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return k; };   // 第26轮 i18n
        agents[side] = { kind: 'random', label: Ts7('agent_random', { side: (XQ.I18N ? XQ.I18N.t(side === 'red' ? 'rp_red_short' : 'rp_black_short') : (side === 'red' ? '红' : '黑')) }), agent: XQ.RandomAgent.create({ side: side, name: 'Random-' + side }) };
      } else if (v.type === 'llm') {
        if (!relayAvailable) {
          warnBanner((XQ.I18N ? XQ.I18N.t('warn_llm_no_server') : '⚠️ LLM 需要本地服务: 请运行 node server.js 后访问本页地址') + ' <b>http://' + location.host + '</b>');   // v1.0.daily: 端口随实际服务端口 (server.js 支持 argv 端口)
          agents[side] = null; return;
        }
        /* 第29轮 同方多 LLM: 模型框逗号/分号分隔多模型 (支持 provider:model 跨厂商); 第31轮: 逐侧模式 + 重复模型去重 */
        var specs = [];
        String(v.model || '').split(/[,，;；]/).forEach(function (tok) {
          tok = tok.trim();
          if (tok && specs.indexOf(tok) < 0) specs.push(tok);
        });
        var multiMode = (v.multi === 'rotate' || v.multi === 'council') && specs.length > 1 ? v.multi : 'off';
        var onThink = function (s2, text) { if (aiBusy && s2 === side) showThinking(s2, text); };
        var onRetry2 = function (info) { view.aiRetries = view.aiRetries || {}; view.aiRetries[side] = info.attempt; view.aiRetryWait = info.waitMs || 0; };   // 第38轮: 等待量可见   // v2.5: 重试实时可见 (状态条 重试N次)
        var onProg = function (p) {   // 第31轮: 会诊进度实时上卡 (⚡ 思考中卡片文字替换)
          if (!aiBusy || p.side !== side) return;
          var dc = document.querySelector('#think-' + side + '-body .dcard.d-thinking');
          if (dc) dc.textContent = XQ.I18N ? XQ.I18N.tArgs('council_progress', { a: p.answered, t: p.total }) : '⚡ 会诊中 (' + p.answered + '/' + p.total + ' 已应答)…';
        };
        var agent, modelName, modelsOut = null;
        if (multiMode !== 'off') {
          agent = XQ.CommitteeAgent.create({
            side: side, provider: v.provider, models: specs, mode: multiMode,
            promptLevel: v.style || 'mid', thinking: v.quick ? 'disabled' : 'enabled',
            onThinking: onThink, onRetry: onRetry2, onProgress: onProg,
            signal: function () { return gameAbort ? gameAbort.signal : undefined; },   // 第39轮: 取值函数 — applyAgents 先于 startRecord, 固化实例拿到的是随即被 abort 的旧代控制器 (每手请求被秒拒 → LLM 退化为随机走子)
            voterBudgetMs: 90000,
            jitter: true                                         // 第38轮: 退避抖动 (多选民错峰不撞限流窗)
          });
          modelName = specs.join('+');
          modelsOut = specs;
        } else {
          agent = XQ.LLMAgent.create({
            side: side, provider: v.provider, model: specs[0] || v.model, promptLevel: v.style || 'mid',
            thinking: v.quick ? 'disabled' : 'enabled',
            onThinking: onThink, onRetry: onRetry2,
            signal: function () { return gameAbort ? gameAbort.signal : undefined; },   // 第39轮: 同上 — 取值函数解耦控制器换代
            jitter: true
          });
          modelName = specs[0] || v.model;
        }
        agents[side] = { kind: 'llm', label: modelName || 'LLM', model: modelName, provider: v.provider, quick: !!v.quick, style: v.style || 'mid', models: modelsOut, agent: agent };
      }
    });
    paintGear();
  }
  function paintGear() {
    var s = readSettings();
    var any = Object.keys(s).some(function (k) { return s[k].enabled && s[k].type !== 'human'; });
    document.getElementById('gear-toggle').classList.toggle('on', any);
  }

  function closeAISettings() {   // 第23轮 a11y: 统一关闭出口 (原 4 处各自 remove('show')); 关闭后焦点还给齿轮, Tab 不落回隐藏层
    document.getElementById('settings-overlay').classList.remove('show');
    var g = document.getElementById('gear-toggle');
    if (g) g.setAttribute('aria-expanded', 'false');   // 第42轮 a11y: 与 openAISettings 对称 — 读屏可感知开关态
    try { g.focus({ preventScroll: true }); } catch (eF) { g.focus(); }
  }

  function openAISettings() {
    var saved;
    try { saved = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch (e) { saved = {}; }
    fillSettings(saved);
    var llmOpts = document.querySelectorAll('.llm-only');
    llmOpts.forEach(function (el) {
      el.style.display = relayAvailable ? '' : 'none';
    });
    var swEl = document.getElementById('server-warn');
    if (swEl) {
      var noKey = relayAvailable && typeof _noKeysConfigured !== 'undefined' && _noKeysConfigured;   // 第28轮: 中继活但零 Key → 给可操作提示 (原先只在走子失败时暴露)
      swEl.style.display = (!relayAvailable || noKey) ? 'block' : 'none';
      swEl.innerHTML = noKey
        ? (XQ.I18N ? XQ.I18N.t('server_no_key') : '')
        : (XQ.I18N ? XQ.I18N.t('server_warn') : '') + '<b>http://' + location.host + '</b>';
    }
    document.getElementById('settings-overlay').classList.add('show');
    var gb = document.getElementById('gear-toggle');   // 第42轮 a11y: 展开态与 aria-haspopup="dialog" 配套
    if (gb) gb.setAttribute('aria-expanded', 'true');
    // 第23轮 a11y: focus 延到下一渲染帧 — visibility 过渡起帧前元素仍按 hidden 计算, 同步/强制 reflow 的 focus 都被静默忽略 (实测定位)
    var fEl = document.getElementById('ai-red-enabled');
    var doFocus = function () { if (fEl) { try { fEl.focus({ preventScroll: true }); } catch (eF) { fEl.focus(); } } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { requestAnimationFrame(doFocus); });
    else setTimeout(doFocus, 0);   // v1.0.daily a11y: 打开焦点入面板
  }

  /* ── 记录/存档 ── */
  function startRecord() {
    var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
    gameId++;   // v1.0.daily 世代翻转: 任何新对局作废旧异步回调
    try { if (gameAbort) gameAbort.abort(); } catch (eAb) {}   // 第38轮: 中止上一局在飞请求
    gameAbort = (typeof AbortController !== 'undefined') ? new AbortController() : null;
    clearKbCursor();   // 第42轮: 走单出口 (连播报区一起清, 否则新局回到同一格听不到反馈)
    syncArchive();
    var s = readSettings();
    // 新对局: 重置 LLM 对话上下文
    ['red', 'black'].forEach(function (sd) {
      var h = agents[sd];
      if (h && h.agent && typeof h.agent.reset === 'function') h.agent.reset();
    });
    currentRecord = XQ.Record.blank({
      /* 第43轮 i18n: 人类执子方的名字此前硬编码 '人类' 入谱 — EN 界面下回放列表/回放头部/面板提示
         都会原样显示「人类 vs deepseek」(纯中文常量, 三组 CJK 守护都只看「是否挂了 data-i18n」, 属性赋值不算)。 */
      redName: agents.red ? (agents.red.model || agents.red.label) : T('type_human'),
      redKind: agents.red ? agents.red.kind : 'human', redModel: agents.red && agents.red.model, redStyle: agents.red && agents.red.style,
      redModels: agents.red && agents.red.models || null,   // 第31轮: 委员会阵容入谱
      blackName: agents.black ? (agents.black.model || agents.black.label) : T('type_human'),
      blackKind: agents.black ? agents.black.kind : 'human', blackModel: agents.black && agents.black.model, blackStyle: agents.black && agents.black.style,
      blackModels: agents.black && agents.black.models || null
    });
    // 思考面板表头: 长名字截短显示 (悬停看全名), 防止挤掉 stat
    function short(n) { n = String(n || ''); return n.length > 11 ? n.slice(0, 10) + '…' : n; }
    thinkStat.red = { total: 0, moves: 0 };
    thinkStat.black = { total: 0, moves: 0 };
    decisionLog.red = [];
    decisionLog.black = [];
    var TwR = XQ.I18N ? XQ.I18N.t : function (k) { return k; };   // 第26轮 i18n (面板表头/等待文案)
    XQ.UI.thinkPanel('red', { name: TwR('status_side_red'), title: currentRecord.red.name, stat: '', text: TwR('think_wait'), active: false,
      info: modelCardHTML('red') + (currentRecord.red.style ? '<span class="badge-style ' + levelClass(currentRecord.red.style) + '">' + levelCN(currentRecord.red.style) + '</span>' : '') });
    XQ.UI.thinkPanel('black', { name: TwR('status_side_black'), title: currentRecord.black.name, stat: '', text: TwR('think_wait'), active: false,
      info: modelCardHTML('black') + (currentRecord.black.style ? '<span class="badge-style ' + levelClass(currentRecord.black.style) + '">' + levelCN(currentRecord.black.style) + '</span>' : '') });
  }
  /* v1.0.daily 存档按钮可用性 (无棋谱/空谱禁用, 防误点导出空文件) */
  function syncArchive() {
    var b = document.getElementById('btn-save');
    if (b) b.disabled = !(currentRecord && currentRecord.moves && currentRecord.moves.length);
    var bu = document.getElementById('btn-undo');   // 第33轮: 悔棋按钮无手可悔时禁用
    if (bu) bu.disabled = !(currentRecord && currentRecord.moves && currentRecord.moves.length);
  }
  /* v1.0.daily 终局提示音: 红胜上行分解和弦 / 黑胜下行 / 和棋单中音 (遵循静音开关) */
  function playEnd(winner) {
    if (sndMuted || !actx) return;
    var t = actx.currentTime + 0.02;
    var seq = winner === 'red' ? [523.25, 659.25, 783.99] : winner === 'black' ? [392, 329.63, 261.63] : [440];
    seq.forEach(function (f, i) {
      var o = actx.createOscillator(), g = actx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, t + i * 0.13);
      g.gain.setValueAtTime(0.0001, t + i * 0.13);
      g.gain.exponentialRampToValueAtTime(0.085, t + i * 0.13 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + i * 0.13 + 0.32);
      o.connect(g); g.connect(masterBus()); o.start(t + i * 0.13); o.stop(t + i * 0.13 + 0.36);
    });
  }
  var flipOn = false;   // 第34轮: 视角翻转 (黑方视角)
  try { flipOn = localStorage.getItem('xq_flip') === '1'; } catch (eF0) {}
  function applyFlip() {   // 翻转: 渲染变量 + 行列标反转 (按钮/持久化调用)
    view.flip = flipOn;
    /* 第42轮: dataset.flip 是两个读取点共同的事实源 (renderer 候选悬停高亮 / rpPaintBoard 回放盘面),
       但全仓此前没有任何写入点 → 两处翻转感知恒为 false, 回放盘面与候选格高亮从不跟随主盘面翻转。此处补唯一写入点。 */
    try { document.documentElement.dataset.flip = flipOn ? '1' : '0'; } catch (eF2) {}
    try { localStorage.setItem('xq_flip', flipOn ? '1' : '0'); } catch (eF1) {}
    var cols = document.querySelectorAll('#col-labels span');
    var rowsL = document.querySelectorAll('#row-labels span');
    var CL = ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'];
    for (var ci = 0; ci < 9; ci++) if (cols[ci]) cols[ci].textContent = flipOn ? CL[8 - ci] : CL[ci];
    for (var ri = 0; ri < 10; ri++) if (rowsL[ri]) rowsL[ri].textContent = String(flipOn ? ri + 1 : 10 - ri);
    /* 第44轮 a11y: 翻转是切换式按钮 — 补 aria-pressed, 读屏可感知当前视角 (此前只有「⇅ 翻转」文案, 无开/关态) */
    var bfP = document.getElementById('btn-flip');
    if (bfP) bfP.setAttribute('aria-pressed', flipOn ? 'true' : 'false');
    if (typeof refresh === 'function') refresh();
    // 第42轮: 回放层开着时立即按新视角重画 (否则要等下一次步进才翻转, 与主盘面短暂不一致)
    if (rpEl && rpEl.ov.style.display === 'block' && rpSession) { try { rpPaintBoard(rpSession.state(), false); } catch (eFB) {} }
  }

  /* 第47轮 a11y: 走法条目是 role=button + tabindex=0 的可聚焦控件, 而悔棋/重开/保存设置都会直接摘掉
     或清空整个 #move-log → 焦点静默掉回 body (下一次 Tab 从页首重来, 读屏用户直接迷路)。与第44/45/46轮
     对回放走法表/思考面板/续局横幅同款处理: 摘节点**前**记「焦点是否在日志内」, 之后归还焦点
     (有剩余条目则落在最后一条, 否则回盘面 #board)。返回一个幂等的收尾函数。 */
  function logFocusGuard() {
    var log = document.getElementById('move-log');
    var act = document.activeElement;
    var had = !!(log && act && act !== log && log.contains(act));
    return function () {
      if (!had) return;
      var log2 = document.getElementById('move-log');
      var last = log2 && log2.querySelector('.log-entry:last-child');
      var target = last || document.getElementById('board');
      if (!target) return;
      try { target.focus({ preventScroll: true }); } catch (eLF) { try { target.focus(); } catch (eLF2) {} }
    };
  }

  /* 第30轮 悔棋: 人机局撤「人类+AI」一对; AI-vs-AI 撤 1 手并让对局继续。
     同步回滚: 走法列表/决策日志/吃子托盘/评值走势; LLM 会话 reset (历史已不匹配, 重建) */
  function undoLastMove() {
    // 第40轮: aiBusy 原为静默 return — 按钮看着可用却毫无反应 (读屏/键盘用户零反馈); 改为警告横幅, 同经 #sr-alert 播报
    if (aiBusy) { warnBanner((XQ.I18N ? XQ.I18N.t('undo_ai_busy') : 'AI 思考中 — 请等本手落子后再悔棋'), null); return; }
    if (engine.ply() === 0) return;
    if (replayStack.length) { warnBanner((XQ.I18N ? XQ.I18N.t('undo_need_restore') : '复盘查看中 — 请先 ⟲ 还原再悔棋'), null); return; }
    var restoreLogFocus = logFocusGuard();   // 第47轮: 下面会摘掉被聚焦的条目, 收尾时归还焦点
    var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
    var steps = 1;
    var lastSide = engine.lastMove() && engine.lastMove().piece.color;
    if (lastSide && !agents[lastSide] && agents[engine.turn()]) steps = 2;   // 上手是人类且轮到 AI → 撤一对
    var touched = {};
    while (steps-- > 0 && engine.ply() > 0) {
      var lm = engine.lastMove();
      if (!lm) break;
      var side = lm.piece.color;
      engine.undoPly();   // 第30轮: 门面 API 名 (undoMove 不存在)
      if (currentRecord && currentRecord.moves.length) currentRecord.moves.pop();
      var le = document.querySelector('#move-log .log-entry:last-child');
      if (le) le.parentNode.removeChild(le);
      /* 第42轮: 撤销必须把面板状态一并回滚 — 原实现只弹 decisionLog 却不重绘思考面板
         (撤销后卡片仍显示刚被撤掉的那一手), thinkStat 的累计耗时/手数也一直虚高。 */
      if (decisionLog[side] && decisionLog[side].length) {
        var popped = decisionLog[side].pop();
        if (popped && popped.secs) thinkStat[side].total = Math.max(0, thinkStat[side].total - popped.secs);
        if (thinkStat[side].moves > 0) thinkStat[side].moves--;
        touched[side] = true;
      }
      if (lm.captured && capturedBy[side].length) {
        capturedBy[side].pop();
        XQ.UI.capturedTray(side, capturedBy[side]);
      }
      if (evalHist[side].length) { evalHist[side].pop(); XQ.UI.evalSpark(side, evalHist[side]); }
    }
    // 第42轮: 受影响侧的面板按回滚后的日志重绘 (卡片 + stat 同一口径)
    Object.keys(touched).forEach(function (sd) {
      var lg = decisionLog[sd] || [];
      var opts = decisionPanelOpts(sd);
      opts.stat = panelStatText(sd, lg.length ? lg[lg.length - 1].secs : 0);
      XQ.UI.thinkPanel(sd, opts);
    });
    replayStack = [];
    selected = null; clearKbCursor();
    ['red', 'black'].forEach(function (sd) {
      var h = agents[sd];
      if (h && h.agent && typeof h.agent.reset === 'function') h.agent.reset();
    });
    bannerClear(); thinkWarned = false; repWarnedN = 0; chWarnedN = 0;
    syncArchive(); refresh(); paintReplayBar();
    restoreLogFocus();   // 第47轮 a11y: 条目已摘, 焦点若原在日志内则归还 (最后一条 / 盘面)
    warnBanner(T('undo_ok'), null);
    if (!engine.isOver()) setTimeout(scheduleAgent, 100);
  }
  /* v1.0.daily 用户重开入口 (R 键/重开按钮): 对局已走且未终局时先确认, 防误触丢进度 */
  function userRestart() {
    if (engine.ply() > 0 && !engine.isOver()) {
      var cT = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
      if (!window.confirm(cT('btn_restart_confirm'))) return;
    }
    restartGame();
  }
  function restartGame() {
    var restoreLogFocus = logFocusGuard();   // 第47轮 a11y: 下面清空 #move-log (焦点若在条目上会掉回 body)
    engine.newGame();
    startRecord();
    selected = null; startTime = Date.now(); aiBusy = false;
    document.getElementById('move-log').innerHTML = '';
    XQ.UI.aiBanner('', '');
    // v1.7 HUD 清理
    capturedBy.red.length = 0; capturedBy.black.length = 0;
    evalHist.red.length = 0; evalHist.black.length = 0;
    XQ.UI.capturedTray('red', capturedBy.red); XQ.UI.capturedTray('black', capturedBy.black);
    XQ.UI.evalSpark('red', evalHist.red); XQ.UI.evalSpark('black', evalHist.black);
    XQ.UI.lastMoveBadge(null);
    var eoStats = document.getElementById('eo-stats');
    if (eoStats) eoStats.innerHTML = '';
    thinkWarned = false;
    repWarnedN = 0;   // v1.7.7 重复局面告警重置
    chWarnedN = 0;    // v1.7.8 长将告警重置
    refresh();
    restoreLogFocus();   // 第47轮 a11y: 日志已清空 → 焦点归还盘面 (而非静默掉回 body)
    setTimeout(scheduleAgent, 100);
  }
  /* v2.3 主界面全屏观战: 按钮或 F 键 (回放模式内 F 由回放分支接管, 不冲突); Esc 由浏览器原生退全屏 */
  function toggleFullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    var el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen();
  }
  /* 第44轮 a11y: 全屏按钮是切换式按钮 (aria-pressed 语义) — 此前只改文案, 读屏不知当前是否已全屏。
     状态唯一事实源 = document.fullscreenElement; 浏览器原生 Esc 退全屏也会派发 fullscreenchange, 故两条路径同源。 */
  function paintFullscreenPressed(on) {
    var b = document.getElementById('btn-fullscreen');
    if (b) b.setAttribute('aria-pressed', on ? 'true' : 'false');
  }

  /* ── 音效开关 ── */
  function initSoundToggle() {
    var b = document.getElementById('snd-toggle');
    function paint() { b.textContent = sndMuted ? '🔇' : '🔊'; b.setAttribute('aria-pressed', sndMuted ? 'false' : 'true'); }   // 第23轮 a11y: 开关态读屏可感知
    b.onclick = function (e) {
      e.stopPropagation();
      sndMuted = !sndMuted;
      try { localStorage.setItem('xq_snd', sndMuted ? 'off' : 'on'); } catch (e2) {}
      paint();
    };
    paint();
  }

  /* 第30轮 未完对局续局: 每手自动存档的伴生功能 — 找最近无 result 记录, 提示续弈 (走子重放 + HUD 重建 + 续录同谱) */
  function resumeGame(rec) {
    restartGame();
    currentRecord = rec;
    rec.moves.forEach(function (m) {
      if (!m || !m.from || !m.to) return;
      var p2 = XQ.Move.parseSq(m.from), t2 = XQ.Move.parseSq(m.to);
      var res = engine.applyPlayerMove(p2.x, p2.y, t2.x, t2.y);
      if (!res.ok) return;
      var sd = res.move.piece.color;
      var secs2 = Math.round((m.timeMs || 0) / 1000);
      XQ.UI.logMove(engine.ply(), sd, XQ.Piece.CHARS[sd][res.move.piece.type], XQ.Move.name(res.move),
        res.move.captured ? res.move.captured.type : null,
        res.move.captured ? XQ.Piece.CHARS[res.move.captured.color][res.move.captured.type] : null, secs2, '');
      if (m.captured) capturedBy[sd].push(XQ.Piece.CHARS[sd === 'red' ? 'black' : 'red'][m.captured]);
      var ev2 = parseEvalNum(m.evaluation);
      if (!isNaN(ev2)) evalHist[sd].push(ev2);
      thinkStat[sd].total += secs2; thinkStat[sd].moves++;
      // 第41轮: 续局重建的决策卡与实盘同口径 — 兑底旗标按记录里的原始事实判定 (记录只在模型给了 summary 时才写该字段,
      // 故「无 summary 且无 confidence」即兑底手; 原实现无条件写 summary_none 占位 → 续局后兑底标记整体丢失)
      var entry2 = { n: m.n, name: (m.piece ? pg(m.side, m.piece) : '?') + '-' + m.from + '→' + m.to,
        summary: m.summary || '', plan: m.plan || '', evaluation: m.evaluation || '',
        confidence: (typeof m.confidence === 'number') ? m.confidence : null, candidates: m.candidates || [], reasoning: '', secs: secs2 };
      fbMark(entry2, !!m.summary, '');
      if (!entry2.fallback && !entry2.summary) entry2.summary = (XQ.I18N ? XQ.I18N.t('summary_none') : '(无摘要)');
      decisionLog[sd].push(entry2);
    });
    XQ.UI.capturedTray('red', capturedBy.red); XQ.UI.capturedTray('black', capturedBy.black);
    XQ.UI.evalSpark('red', evalHist.red); XQ.UI.evalSpark('black', evalHist.black);
    selected = null; clearKbCursor();
    syncArchive(); refresh();
    setTimeout(scheduleAgent, 200);
  }
  function tryOfferResume() {
    try {
      var recs = XQ.Record.list();
      var rec = null;
      for (var i = 0; i < recs.length; i++) {
        if (!recs[i].result && recs[i].moves && recs[i].moves.length >= 2) { rec = recs[i]; break; }
      }
      if (!rec) return;
      var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; }, TA = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return k; };
      var bar = document.createElement('div');
      bar.style.cssText = 'position:fixed;left:50%;bottom:18px;transform:translateX(-50%);z-index:250;background:rgba(20,14,6,.95);border:1px solid #C28A20;border-radius:10px;padding:8px 14px;display:flex;gap:10px;align-items:center;color:#FFE8A3;font-size:12px;box-shadow:0 8px 24px rgba(0,0,0,.6)';
      /* 第45轮 a11y: 这条「有未完对局, 是否续下」的横幅是异步插进 body 的, 却没有任何 live 语义 —
         读屏用户永远不知道页面上多了一个可操作提示 (只能靠 Tab 偶然撞到)。文本走 role=status 播报;
         注意必须「先把空区域插入 DOM, 再写文本」: 带着内容一起插入时部分读屏不会播报该内容。 */
      var msgSpan = document.createElement('span');
      msgSpan.setAttribute('role', 'status');
      bar.appendChild(msgSpan);
      var b1 = document.createElement('button'); b1.className = 'btn'; b1.textContent = T('resume_btn');
      var b2 = document.createElement('button'); b2.className = 'btn'; b2.textContent = T('resume_later');
      bar.appendChild(b1); bar.appendChild(b2);
      document.body.appendChild(bar);
      msgSpan.textContent = TA('resume_banner', { n: rec.moves.length });
      /* 第46轮 a11y: 横幅是异步插入 body 的 (用户 Tab 到两个按钮时焦点在横幅内), 两个出口都只 bar.remove() —
         承载焦点的按钮被摘掉, 焦点静默掉回 body, 键盘用户当场迷路。与终局卡收起/横幅自清同口径:
         只在焦点确实在横幅内时交还盘面 (#board 是 tabindex=-1 的程序化落点, 不打断已移到别处的焦点)。 */
      var dropBar = function () {
        var hadFocus = !!(bar.contains && document.activeElement && bar.contains(document.activeElement));
        bar.remove();
        if (hadFocus) {
          var bdR = document.getElementById('board');
          if (bdR && bdR.focus) { try { bdR.focus({ preventScroll: true }); } catch (eRB) { try { bdR.focus(); } catch (eRB2) {} } }
        }
      };
      b2.onclick = function () { dropBar(); };
      b1.onclick = function () { dropBar(); resumeGame(rec); };
    } catch (eR) {}
  }
  /* ── 初始化 ── */
  document.addEventListener('DOMContentLoaded', function () {
    XQ.UI.drawBoard(document.getElementById('board-lines'));
    if (flipOn) applyFlip();   // 第34轮: 恢复翻转视角 (labels/view/refresh)
    /* 第46轮: 首屏先同步渲染一次。原实现的首帧渲染挂在 boot 链末尾 (api/health → api/providers 两个
       网络往返之后才 refresh()), 于是这段时间状态条停在 index.html 的静态文案、盘面 90 格全空 —
       中继慢或不可达时这个空窗肉眼可见, 且 EN 界面下静态文案是中文。render 只依赖 engine/view
       (不碰 agents/currentRecord/relayAvailable), 因此可安全提前。 */
    refresh();
    setTimeout(tryOfferResume, 1200);   // 第30轮: 初始化后探测未完对局
    // 第24轮 PWA 二期: service worker (网络优先离线壳, 见根级 sw.js) — file:// 等非安全上下文静默跳过
    if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
      // 第40轮: register() 返回 Promise — 原 try/catch 只兜同步抛错, sw.js 404/MIME 异常会变成未处理的 rejection (控制台报错且静默无 SW, 离线壳失效无迹可寻)
      try { navigator.serviceWorker.register('sw.js').catch(function (eSW) { if (window.console && console.warn) console.warn('[sw] registration failed:', eSW && eSW.message); }); } catch (eSW) {}
    }
    initSoundToggle();
    /* 第45轮 a11y: 「最新着法」徽章自第28轮起就带 cursor:pointer + pointer-events:auto (CSS 注释写着
       「显示时可点击回看该手」), 但全仓从未有过 click 绑定 — 点了没有任何反应, 是个承诺了动作的死按钮。
       现补上真实行为: 打开回放层并定位到该手 (与走法列表条目同语义, 但不必先滚到列表)。
       徽章本身已是 <button> (renderer 侧), Enter/Space 原生可用。 */
    var lmBadgeEl = document.getElementById('last-move-badge');
    if (lmBadgeEl) {
      lmBadgeEl.onclick = function () {
        if (!currentRecord || !currentRecord.moves || !currentRecord.moves.length) return;   // 无档可回放
        var ply = parseInt(lmBadgeEl.dataset.ply || '', 10);
        rpWatchRecord();
        if (isFinite(ply) && rpCtrl) rpCtrl.gotoPly(ply);   // 定位到徽章所示那一手
      };
    }
    /* 第42轮: 状态条时钟的补位 tick — renderStatus 只在 render() 时写 #status-info, 而 renderer 的 updateClock
       自第41轮收敛成单出口后始终没有调用点 (纯导出) → 没有 AI 在思考时 (人机局等人类落子 / 双方人类的观战局)
       时钟整段冻结在上一手的时刻, 限着计数同样不刷新。此处按秒补位; AI 思考期间该元素由 bannerThinking 的
       ticker 独占 (避免两处每秒互写打架)。 */
    setInterval(function () {
      if (view.aiThinking || engine.isOver()) return;
      try { XQ.UI.updateClock(engine, view); } catch (eUC) {}
    }, 1000);
    // v3.9c 语言切换 (ui-lang 下拉: zh/en, localStorage xq_lang 持久化, 切换即刷新全部 data-i18n)
    var langSel = document.getElementById('ui-lang');
    if (langSel && XQ.I18N) {
      langSel.value = XQ.I18N.getLang();
      langSel.addEventListener('change', function () { XQ.I18N.setLang(langSel.value, true); });
    }
    // v1.0.daily 棋子记谱切换 (ui-pieces 下拉: 汉字/西文字母, localStorage xq_pieces 持久化, 切换即重绘)
    var pieceSel = document.getElementById('ui-pieces');
    if (pieceSel) {
      try { pieceSel.value = localStorage.getItem('xq_pieces') || 'cn'; } catch (e5) {}
      pieceSel.addEventListener('change', function () {
        try { localStorage.setItem('xq_pieces', pieceSel.value); } catch (e6) {}
        refresh();
      });
    }
    // v1.0.daily 语言切换联动回放层: 覆盖层打开时重刷图表标题与动态面板 (静态骨架由 data-i18n apply() 自动覆盖)
    document.addEventListener('xq:i18n', function () {
      /* v1.0.daily 主界面动态文案热切: 状态条/面板名/决策卡 (静态 data-i18n 已由 apply 刷新) */
      /* 第41轮 i18n 漏挂 (浏览器实机抓出): view.aiThinking 是本次思考开始时按当时语言解析出的**字符串**
         (随机AI 的名称含方别词), 切语言后 refresh() 只是把这个旧串重画一遍 → 状态条在整轮思考期间停在旧语言
         (LLM 一手思考 30~60s, 肉眼可见)。此处按当前语言重新解析; LLM 的 label 是模型名 (语言中立), 不动。 */
      if (view.aiThinking) {
        var thH = agents[view.aiThinkingSide];
        if (thH && thH.kind === 'random') view.aiThinking = XQ.I18N ? XQ.I18N.t('agent_random_name') : view.aiThinking;
      }
      refresh();
      /* 第45轮: 徽章的可访问名含手数占位符 (无法声明式刷新) — 语言热切时显式重算, 否则切到中文后
         读屏仍播报英文, 要等下一手落子才自愈。实机验收当场抓到 (badgeZh === badgeEn)。 */
      if (XQ.UI.relabelLastMoveBadge) XQ.UI.relabelLastMoveBadge();
      ['red', 'black'].forEach(function (sd) {
        /* 第43轮: 这里必须把 title 一并传回 — thinkPanel 的契约是 nameEl.title = opts.title || opts.name,
           只传 name 会把面板表头的悬停全名 (模型名 / 「人类」) 覆盖成方别名 (「红方」/Red),
           即「切一次语言就丢掉模型名」。title 与 startRecord 同源 (currentRecord[side].name)。 */
        XQ.UI.thinkPanel(sd, {
          name: XQ.I18N ? XQ.I18N.t(sd === 'red' ? 'status_side_red' : 'status_side_black') : (sd === 'red' ? '红方' : '黑方'),
          title: currentRecord && currentRecord[sd] ? currentRecord[sd].name : undefined
        });
        var lg = decisionLog[sd] || [];
        if (lg.length) XQ.UI.thinkPanel(sd, { cards: XQ.UI.decisionCards(lg.slice(-4), lg.length) });
      });
      if (rpEl && rpSession) {
        rpPaintChartCaptions();
        rpPaintHead();
        rpPaintEval(rpSession.state());
        rpPaintInfo(rpSession.state());
        rpPaintMoveList();
        rpOnPlayState(rpCtrl && rpCtrl.playing ? rpCtrl.playing() : false);
      }
      /* 第47轮 a11y: 全屏按钮名称随态 (全屏中为「退出全屏」), 而 apply() 刚把它重写成静态键 → 此处按当前
         全屏态重算 (单出口, 与 fullscreenchange 共用), 否则全屏中切语言后名称与动作相反。 */
      if (rpEl && rpEl.paintFullBtn) rpEl.paintFullBtn();
    });
    // v1.7 思考面板折叠 (点 head 切换)
    ['think-red', 'think-black'].forEach(function (id) {
      var root = document.getElementById(id);
      var head = root && root.querySelector('.think-head');
      if (head && !head._foldBound) {
        head._foldBound = true;
        head.insertAdjacentHTML('beforeend', '<span class="fold">▾</span>');
        head.setAttribute('tabindex', '0');   // 第24轮 a11y: 折叠头键盘可达 (原仅鼠标可点)
        head.setAttribute('role', 'button');
        var syncExp = function () { head.setAttribute('aria-expanded', root.classList.contains('collapsed') ? 'false' : 'true'); };
        syncExp();
        head.addEventListener('click', function () {
          root.classList.toggle('collapsed');
          var f = head.querySelector('.fold');
          if (f) f.textContent = root.classList.contains('collapsed') ? '▸' : '▾';
          syncExp();
          try { localStorage.setItem('xq_fold_' + (id === 'think-red' ? 'red' : 'black'), root.classList.contains('collapsed') ? '1' : '0'); } catch (eF) {}   // v1.0.daily: 折叠态持久化
        });
        head.addEventListener('keydown', function (ev) {   // 第24轮: Enter/Space 切换折叠
          if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); head.click(); }
        });
        try { if (localStorage.getItem('xq_fold_' + (id === 'think-red' ? 'red' : 'black')) === '1') { root.classList.add('collapsed'); var f0 = head.querySelector('.fold'); if (f0) f0.textContent = '▸'; syncExp(); } } catch (eF2) {}
      }
    });
    document.getElementById('gear-toggle').onclick = openAISettings;
    document.getElementById('btn-restart').onclick = userRestart;   // v1.0.daily 确认入口
    var bfEl = document.getElementById('btn-flip');   // 第34轮: 视角翻转
    if (bfEl) bfEl.onclick = function () { flipOn = !flipOn; applyFlip(); };
    paintFullscreenPressed(!!document.fullscreenElement);   // 第44轮 a11y: 全屏按钮初始 aria-pressed (刷新后仍处全屏时不误报「未全屏」)
    /* 第33轮: 服务商试连 (1-token 探活, 实测延迟/HTTP 错误) */
    ['red', 'black'].forEach(function (sd) {
      var tbtn = document.getElementById('ai-' + sd + '-testconn');
      if (!tbtn) return;
      tbtn.onclick = function () {
        var T2 = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
        var res = document.getElementById('ai-' + sd + '-testres');
        if (!window.XQApp.isRelay()) { if (res) res.innerHTML = '<span style="color:#ff8a7a">' + T2('test_no_relay') + '</span>'; return; }
        if (res) res.innerHTML = '<span style="opacity:.7">' + T2('test_run') + '</span>';
        var prov = document.getElementById(SIDE_DEFS[sd].provider).value;
        var mdl = document.getElementById(SIDE_DEFS[sd].model).value || 'test';
        var t0 = Date.now();
        fetch('api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: prov, model: mdl, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }] }) })
          .then(function (r2) { var ms = Date.now() - t0; if (res) res.innerHTML = r2.ok ? '<span style="color:#58d68d">✓ ' + T2('test_ok', { ms: ms }) + '</span>' : '<span style="color:#ff8a7a">✗ HTTP ' + r2.status + ' (' + ms + 'ms)</span>'; })
          .catch(function () { if (res) res.innerHTML = '<span style="color:#ff8a7a">✗ ' + T2('test_no_relay') + '</span>'; });
      };
    });
    var buEl = document.getElementById('btn-undo');
    if (buEl) buEl.onclick = undoLastMove;   // 第30轮: 悔棋
    var eoOv = document.getElementById('end-overlay');
    if (eoOv && !eoOv._dismissBound) {
      eoOv._dismissBound = true;
      /* 第46轮: 遮罩点击必须走 dismissEndOverlay 单出口 — 原实现只摘 'show' 类名, 而 renderOverlay 在
         engine.isOver() 时无条件 add('show'), 于是「鼠标点遮罩收起 → 按一下方向键」卡片当场弹回来
         (第45轮只给 Esc 那条路径落了「已收起」旗标, 鼠标这条漏了)。 */
      eoOv.addEventListener('click', function (ev) { if (ev.target === eoOv) XQ.UI.dismissEndOverlay(); });   // v1.0.daily: 点遮罩关闭终局卡 → 可自由回看终局走子/复盘 (再来一局 按钮不受影响)
    }
    var soEl = document.getElementById('settings-overlay');
    if (soEl && !soEl._backdropBound) {
      soEl._backdropBound = true;
      soEl.addEventListener('click', function (ev) { if (ev.target === soEl) closeAISettings(); });   // v1.0.daily: 点遮罩关闭设置; 第23轮: 统一出口
    }
    document.getElementById('btn-save').onclick = function () {
      if (currentRecord && currentRecord.moves.length) XQ.Record.downloadFile(currentRecord);
    };
    document.getElementById('btn-load').onclick = function () {
      var input = document.createElement('input');
      input.type = 'file'; input.accept = '.json,.pgn,application/json';
      input.onchange = function () {
        if (!input.files[0]) return;
        XQ.Record.importFromFile(input.files[0]).then(function (rec) {
          // 重放棋谱
          restartGame();
          currentRecord = null; // 回放不记新档
          rec.moves.forEach(function (m) {
            var p = XQ.Move.parseSq(m.from), t = XQ.Move.parseSq(m.to);
            var res = engine.applyPlayerMove(p.x, p.y, t.x, t.y);
            if (res.ok) {
              XQ.UI.logMove(engine.ply(), res.move.piece.color,
                XQ.Piece.CHARS[res.move.piece.color][res.move.piece.type],
                XQ.Move.name(res.move),
                res.move.captured ? res.move.captured.type : null,
                res.move.captured ? XQ.Piece.CHARS[res.move.captured.color][res.move.captured.type] : null);
            }
          });
          syncArchive();   // 回放导入不存新档 → 存棋谱保持禁用
          warnBanner((XQ.I18N ? XQ.I18N.tArgs('import_ok', { n: rec.moves.length }) : '已载入 ' + rec.moves.length + ' 手'), null);   // 第28轮: 成功提示 (原静默)
          refresh();
        }).catch(function (e) {
          warnBanner((XQ.I18N ? XQ.I18N.tArgs('import_fail_banner', { msg: e && e.message || e }) : '导入失败: ' + (e && e.message || e)), null);   // 第28轮: 最后一个 alert 下岗
        });
      };
      input.click();
    };
    document.getElementById('btn-replay-watch').onclick = rpOpen;   // v1.6 回放模式
    document.getElementById('btn-fullscreen').onclick = toggleFullscreen;   // v2.3 全屏观战
    ['pointerdown', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, function () { ensureAudio(); }, { once: false, passive: true });
    });

    /* 第34轮: 坐标标开关 / 音量滑条 / 拖拽开关 / 危险区重置 */
    var coordsEl = document.getElementById('ui-coords');
    var volEl = document.getElementById('ui-vol');
    var dragEl = document.getElementById('ui-drag');
    function applyCoords(v) {
      var c1 = document.getElementById('col-labels'), c2 = document.getElementById('row-labels');
      if (c1) c1.style.display = v ? '' : 'none';
      if (c2) c2.style.display = v ? '' : 'none';
    }
    var savedCoords = '1', savedVol = 90, savedDrag = '1';
    try {
      savedCoords = localStorage.getItem('xq_coords') || '1';
      savedVol = parseInt(localStorage.getItem('xq_vol') || '90', 10);
      if (isNaN(savedVol)) savedVol = 90;
      savedDrag = localStorage.getItem('xq_drag') || '1';
    } catch (eSV) {}
    volPct = savedVol;
    view.dragEnabled = savedDrag === '1';
    if (coordsEl) {
      coordsEl.checked = savedCoords === '1';
      applyCoords(coordsEl.checked);
      coordsEl.addEventListener('change', function () {
        try { localStorage.setItem('xq_coords', coordsEl.checked ? '1' : '0'); } catch (eC) {}
        applyCoords(coordsEl.checked);
      });
    }
    if (volEl) {
      volEl.value = savedVol;
      /* 第44轮 性能: 拖动滑块时 input 每次像素移动都触发, 原来每次都同步落盘 localStorage
         (localStorage 是同步写, 拖动一次产生上百次磁盘写)。拆开: input 只做实时生效 (增益),
         change (松手/键盘结束) 才持久化 — 用户感知与落盘结果都不变。 */
      volEl.addEventListener('input', function () {
        volPct = parseInt(volEl.value, 10) || 0;
        if (mBus) mBus.gain.value = 0.9 * volPct / 100;
      });
      volEl.addEventListener('change', function () {
        try { localStorage.setItem('xq_vol', String(volEl.value)); } catch (eV) {}
      });
    }
    if (dragEl) {
      dragEl.checked = savedDrag === '1';
      dragEl.addEventListener('change', function () {
        try { localStorage.setItem('xq_drag', dragEl.checked ? '1' : '0'); } catch (eD) {}
        view.dragEnabled = dragEl.checked;
      });
    }
    var rdEl = document.getElementById('ui-resetdata');
    if (rdEl) rdEl.onclick = function () {
      var T3 = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
      if (!window.confirm(T3('reset_confirm'))) return;
      var kill = [];
      for (var ki = 0; ki < localStorage.length; ki++) {
        var k2 = localStorage.key(ki);
        if (k2.indexOf('xq_') === 0 && k2 !== 'xq_v1_settings' && k2 !== 'xq_lang' && k2.indexOf('xq_fold_') !== 0 && k2 !== 'xq_snd') kill.push(k2);
      }
      kill.forEach(function (k3) { localStorage.removeItem(k3); });
      location.reload();
    };
    // 第33轮: 面板宽度分隔条 (170-300px 拖拽, localStorage 记忆; 第37轮: 键盘可调 + 分隔条语义)
    var spEl = document.getElementById('panel-splitter-r');
    if (spEl) {
      try {
        var savedW = parseInt(localStorage.getItem('xq_panel_w') || '0', 10);
        if (savedW >= 170 && savedW <= 300) {
          document.documentElement.style.setProperty('--panel-w', savedW + 'px');
          if (spEl.setAttribute) spEl.setAttribute('aria-valuenow', String(savedW));
        }
      } catch (eW0) {}
      var spDrag = null;
      /* 第44轮 性能: 拖动分隔条时 pointermove 每次都同步写 localStorage (一次拖动上百次磁盘写)。
         拆开: 拖动过程只改 CSS 变量 (实时观感), 松手/键盘调宽才落盘 (persist=true) — 落盘值与最终宽度一致。 */
      var spApply = function (w, persist) {
        w = Math.max(170, Math.min(300, w));
        document.documentElement.style.setProperty('--panel-w', w + 'px');
        if (persist) { try { localStorage.setItem('xq_panel_w', String(w)); } catch (eS2) {} }
        if (spEl.setAttribute) spEl.setAttribute('aria-valuenow', String(w));
        return w;
      };
      spEl.addEventListener('pointerdown', function (e) {
        spDrag = { x: e.clientX, w: parseInt(getComputedStyle(document.querySelector('.think-panel')).width, 10) || 200, lastW: null };
        if (spEl.setPointerCapture) { try { spEl.setPointerCapture(e.pointerId); } catch (eC) {} }
        e.preventDefault();
      });
      spEl.addEventListener('pointermove', function (e) {
        if (!spDrag) return;
        spDrag.lastW = spApply(spDrag.w + (e.clientX - spDrag.x), false);
      });
      var spCommit = function () {
        if (!spDrag) return;
        var w = spDrag.lastW;
        spDrag = null;
        if (w != null) spApply(w, true);   // 松手才持久化 (仅拖动过才写)
      };
      spEl.addEventListener('pointerup', spCommit);
      spEl.addEventListener('pointercancel', spCommit);   // 第44轮: 指针被系统夺走 (触屏转滚动) 时同样落盘, 与拖拽中止同口径
      spEl.addEventListener('keydown', function (e) {   // 第37轮 a11y: 键盘用户 ←/→ 调宽 (步长 10px, 与拖拽同口径持久化)
        if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
        e.preventDefault();
        /* 第45轮: 本处理器与下方全局棋盘键盘分支监听的是同一个事件流 (分隔条在 target 阶段先跑, 全局在
           document 冒泡阶段后跑)。全局分支此前只对 Enter/Space 放行「已被消费」, 方向键这条漏了 →
           焦点在分隔条上按一次 ←/→ 既调宽又移动棋盘光标 (还多播报一次格位)。此处显式 stopPropagation,
           与「已被消费就放行」的全局判据形成双保险 (任一条单独存在即可阻断)。 */
        e.stopPropagation();
        var cur = parseInt(getComputedStyle(document.querySelector('.think-panel')).width, 10) || 200;
        spApply(cur + (e.key === 'ArrowRight' ? 10 : -10), true);
      });
    }
    // 第30轮: 页面隐藏兜底存档 (与每 5 手自动存档配套)
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'hidden' && currentRecord && currentRecord.moves.length && !engine.isOver()) {
        try { XQ.Record.save(currentRecord); } catch (eVS) {}
      }
    });
    // 设置层独立监听 (输入框内也生效; 主 keydown 对 INPUT 早退, 管不到这里)
    document.addEventListener('keydown', function (ev) {
      var so3 = document.getElementById('settings-overlay');
      if (!so3 || !so3.classList.contains('show')) return;
      if (ev.key === 'Escape') {
        closeAISettings();
        if (kbCursor) { clearKbCursor(); refresh(); }
        /* 第46轮: 声明「该键已被消费」— 本监听注册在主 keydown 之前, 主分支的 Esc 现已穿过输入框早退,
           若不 preventDefault, 同一次 Esc 会继续在主分支里求值并顺带收起终局卡 (一次按键两个动作,
           与第45轮分隔条/方向键同一类)。 */
        ev.preventDefault();
        return;
      }
      // 第24轮 a11y: aria-modal=true 的配套 Tab 焦点陷阱 — 焦点在层内循环 (原 Tab 可逃出面板落到被遮住的棋盘)
      if (ev.key === 'Tab') {
        /* 第45轮: 可聚焦集合必须含 a[href] — 回放层的 #rp-jump-max (最长思考) 与 #rp-note-edit (备注编辑)
           都是 href="javascript:void(0)" 的锚点, 原生可聚焦却不在原选择器里, 于是陷阱的「首/末元素」
           是按不完整清单算出来的 (将来若有锚点排在末尾, Tab 就能从它逃出对话框)。四处陷阱同口径。 */
        var fables = Array.prototype.filter.call(
          so3.querySelectorAll('button, input, select, a[href], [tabindex="0"]'),
          function (el) { return el.offsetParent !== null && !el.disabled; }
        );
        if (!fables.length) return;
        var act = document.activeElement;
        if (ev.shiftKey) {
          if (act === fables[0] || !so3.contains(act)) { fables[fables.length - 1].focus(); ev.preventDefault(); }
        } else {
          if (act === fables[fables.length - 1] || !so3.contains(act)) { fables[0].focus(); ev.preventDefault(); }
        }
      }
    });
    // 快捷键: M 静音 / R 重开
    document.addEventListener('keydown', function (ev) {
      /* 第46轮: Esc 必须穿过输入控件早退 — 回放层的默认焦点是 #rp-pick (<select>), 而「退出回放」的 Esc
         分支在本行之下, 于是「打开回放后立刻按 Esc」被这条早退整条吃掉, 与回放帮助层自述的
         「Esc 退出回放」不符 (把焦点挪到任意按钮后 Esc 才生效, 极难自查)。其余单键快捷键仍让位输入框。 */
      if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName) && ev.key !== 'Escape') return;
      /* 第43轮 a11y: Elo 天梯与回放帮助层都是盖在回放层之上的 aria-modal 浮层 — 打开期间全局快捷键
         必须整体让位。原实现没有任何闸门: Esc 被下层回放层接走 (关掉**下层**回放层, 浮层留在主界面上),
         方向键/空格还会在遮罩后面步进棋局。帮助层自述「再次按下 ? 关闭」, 故把 ? 也交给它当开关。 */
      if (modalKeyGate(ev, 'rp-elo-overlay', rpEloClose)) return;
      if (modalKeyGate(ev, 'rp-help-overlay', rpHelpClose, ['?', '/'])) return;
      /* v1.6 回放模式快捷键: ←/→ 步进, 空格 播放/暂停, Esc 退出 */
      if (rpEl && rpEl.ov.style.display === 'block') {
        if (ev.key === 'Tab') {   // 第37轮 a11y: aria-modal=true 的配套 Tab 陷阱 (与设置层同款) — 焦点在回放对话框内循环, 不逃到背后棋盘
          var rpDlg = rpEl.ov.querySelector('#rp-dialog');
          if (rpDlg) {
            var rpFables = Array.prototype.filter.call(
              rpDlg.querySelectorAll('button, input, select, a[href], [tabindex="0"]'),
              function (el) { return el.offsetParent !== null && !el.disabled; }
            );
            if (rpFables.length) {
              var rpAct = document.activeElement;
              if (ev.shiftKey) {
                if (rpAct === rpFables[0] || !rpDlg.contains(rpAct)) { rpFables[rpFables.length - 1].focus(); ev.preventDefault(); }
              } else {
                if (rpAct === rpFables[rpFables.length - 1] || !rpDlg.contains(rpAct)) { rpFables[0].focus(); ev.preventDefault(); }
              }
            }
          }
          return;
        }
        if (ev.key === 'ArrowRight') { if (rpCtrl) rpCtrl.stepNext(); ev.preventDefault(); return; }
        if (ev.key === 'ArrowLeft') { if (rpCtrl) rpCtrl.stepPrev(); ev.preventDefault(); return; }
        if (ev.key === ' ') { if (rpCtrl) rpCtrl.toggle(); ev.preventDefault(); return; }
        if (ev.key === 'Escape') { if (document.fullscreenElement) return; rpClose(); return; }   // v1.7.7: 全屏时 Esc 先由浏览器退全屏, 第二次才退回放
        if (ev.key === 'f' || ev.key === 'F') { var fb = rpEl.btnFull; if (fb) fb.click(); ev.preventDefault(); return; }
        if (ev.key === 'l' || ev.key === 'L') { if (rpCtrl) { rpCtrl.setLoop(!rpCtrl.isLooping()); rpPaintLoop(); } ev.preventDefault(); return; }
        if (ev.key === 'Home') { if (rpCtrl) rpCtrl.toStart(); ev.preventDefault(); return; }
        if (ev.key === 'End') { if (rpCtrl) rpCtrl.toEnd(); ev.preventDefault(); return; }
        if (ev.key === '0') { if (rpCtrl) rpCtrl.toggle(); ev.preventDefault(); return; }
        if (/^[1-7]$/.test(ev.key)) {
          var speeds = XQ.ReplayController.SPEEDS;
          if (rpCtrl && speeds[parseInt(ev.key, 10) - 1] != null) { rpCtrl.setSpeed(speeds[parseInt(ev.key, 10) - 1]); rpPaintSpeeds(); }
          ev.preventDefault(); return;
        }
        if (rpCtrl && (ev.key === '[' || ev.key === ']')) {
          var curIdx = (rpSession && rpSession.idx) ? rpSession.idx() : 0;
          rpCtrl.gotoPly(curIdx + (ev.key === ']' ? 5 : -5));   // v3.9a: ±5 手键盘跳转 (v1.6.2 跳转按钮的键盘版; gotoPly 内建 clamp)
          ev.preventDefault(); return;
        }
        if (ev.key === 'c' || ev.key === 'C') {
          if (rpCtrl) { if (ev.shiftKey) rpCtrl.stepPrevCapture(); else rpCtrl.stepNextCapture(); }
          ev.preventDefault(); return;
        }   // v3.9.2: 下一手吃子 (C) / 上一手吃子 (Shift+C) — 长局跳过拉扯段快速看子力交换点
        if (ev.key === 'b' || ev.key === 'B') { rpToggleBookmark(); ev.preventDefault(); return; }   // v1.0.daily: 书签 标注/取消当前手
        if (ev.key === 'n' || ev.key === 'N') { rpGotoBookmark(1); ev.preventDefault(); return; }   // v1.0.daily: 下一书签
        if (ev.key === 'p' || ev.key === 'P') { rpGotoBookmark(-1); ev.preventDefault(); return; }   // v1.0.daily: 上一书签
        if (ev.key === '?' || ev.key === '/') { rpShowHelp(); ev.preventDefault(); return; }
        /* 第47轮 a11y: 回放层是 aria-modal="true" 对话 (背景对读屏声明为惰性), 且帮助层自述「回放打开时
           快捷键归回放」。但本分支此前只 return「已处理的键」, 未处理的键会一路落到下方主界面分支:
           ArrowUp/ArrowDown 会移动**被遮住的**棋盘键盘光标并向 live region (#sr-cursor) 播报, m/u/r 仍会
           静音/悔棋(改掉正在直播的对局)/弹重开确认 — 与第41轮给设置层加的闸门同类, 这里漏了。
           故回放开启期间一律在此收口 (Tab 与已处理键已在上面各自 return, 未 preventDefault 的浏览器
           组合键如 Ctrl+R 不受影响)。 */
        return;
      }
      /* v1.0.daily a11y 键盘走子: 方向键光标 / Enter·Space 选子走子 / Esc 取消 */
      var k = (ev.key || '').toLowerCase();
      if (k === 'escape') {   // Esc 必须先于模态守卫求值 (关闭面板 + 清理棋盘光标是它的既有职责)
        /* 第46轮: 已被更早的监听消费 (设置层 Esc 会 preventDefault) 就放行 — 否则同一次 Esc 会连锁收起终局卡。 */
        if (ev.defaultPrevented) return;
        var so2 = document.getElementById('settings-overlay');
        if (so2 && so2.classList.contains('show')) { closeAISettings(); if (kbCursor) { clearKbCursor(); refresh(); } ev.preventDefault(); return; }   // v1.0.daily: Esc 关设置; 第23轮: 统一出口
        /* 第45轮 a11y: 终局卡的键盘出口 — 点遮罩可收起卡片回看终局局面, 键盘此前无等价路径
           (卡内只有「再来一局」会丢掉刚结束的局面)。收起落在 renderer 的单出口上 (含「已收起」旗标)。 */
        if (XQ.UI.dismissEndOverlay && XQ.UI.dismissEndOverlay()) { ev.preventDefault(); return; }
        if (kbCursor) { clearKbCursor(); refresh(); ev.preventDefault(); return; }
      }
      /* 第41轮 a11y: 设置层是 aria-modal="true" 对话 (背景对读屏/键盘声明为惰性), 但键盘快捷键不走 Tab 序 —
         面板开着时按 R/U/M/F 会在用户看不见的遮罩后面重开对局/悔棋/静音/全屏; 方向键/Enter 还会把棋盘光标
         (连同高亮与落子动作) 操作到面板后方。此处把「面板开启」作为统一闸门挡在棋盘键盘交互与单键快捷键之前。 */
      var soMod = document.getElementById('settings-overlay');
      if (soMod && soMod.classList.contains('show')) return;
      /* 第45轮 a11y: 方向键也必须放行「已被消费」的按键 — 面板分隔条 (role=separator, tabindex=0) 自己处理
         ←/→ 并 preventDefault, 但事件仍会冒泡到这里: 原实现在这条分支上只判键名, 于是按一次方向键
         = 调宽面板 + 同时移动棋盘光标 (并多播报一次格位)。Enter/Space 分支第42轮已放行, 方向键漏了。 */
      if (ev.defaultPrevented) return;
      if (k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') {
        kbMove(k === 'arrowleft' ? -1 : k === 'arrowright' ? 1 : 0, k === 'arrowup' ? -1 : k === 'arrowdown' ? 1 : 0);
        ev.preventDefault(); return;
      }
      if (k === 'enter' || k === ' ') {
        if (!kbCursor) return;   // v1.0.daily 复审修复: 无光标时放行原生行为 (Tab 聚焦按钮的 Enter/Space 激活不再被吞)
        /* 第42轮: 「无光标才放行」不够 — 光标存在时焦点若落在某个自身处理 Enter/Space 的控件上, 这条分支会再叠加
           一次棋盘动作: 焦点在走法条目上按 Enter = 跳局面 + 顺手选/走一子; 面板折叠头 (role=button) 同理。
           凡「该键已被消费」(defaultPrevented) 或「目标自身就是可交互控件」一律放行, 由控件自己的语义处理。 */
        var tEl = ev.target;
        /* 第45轮: 「自身可交互」不能只认 role=button — 面板分隔条是 role=separator 的键盘控件, 它不消费
           Enter/Space, 于是焦点在它上面按 Enter 会一路走到下面这行, 在棋盘上替用户走一手 (光标存在时)。
           按「角色是否自带按键语义」判定, 而非逐个补角色名。 */
        var tRole = (tEl && tEl.getAttribute && tEl.getAttribute('role')) || '';
        var selfActing = !!(tEl && tEl.tagName && /^(BUTTON|A|INPUT|TEXTAREA|SELECT)$/.test(tEl.tagName))
          || /^(button|separator|slider|spinbutton|combobox|listbox|textbox|switch|tab|checkbox|radio)$/.test(tRole);
        if (ev.defaultPrevented || selfActing) return;
        ev.preventDefault();
        if (!engine.isOver() && !aiBusy) { onCellClick(kbCursor.x, kbCursor.y); }
        return;
      }
      if (k === 'm') document.getElementById('snd-toggle').click();
      else if (k === 'u') undoLastMove();   // 第33轮: U 键悔棋
      else if (k === 'r') userRestart();
      else if (k === 'f') toggleFullscreen();   // v2.3 全屏观战 (回放打开时上方分支已接管 F)
    });

    // 探测本地中继是否可用
    fetch('api/health').then(function (r) { return r.json(); })
      .then(function (j) { relayAvailable = !!(j && j.relay); })
      .catch(function () { relayAvailable = false; })
      .then(function () {
        return loadProviderOptions();
      })
      .then(function () {
        var saved;
        try { saved = JSON.parse(localStorage.getItem(CFG_KEY) || '{}'); } catch (e) { saved = {}; }
        fillSettings(saved);
        applyAgents(saved);
        startRecord();
        refresh();
        setTimeout(scheduleAgent, 200);
        if (/(?:^|[#&])rp=/.test(location.hash || '')) rpOpen();   // v3.8: URL 带深链 (#rp=ls:<id> / #rp=file:headless) 时页面加载直达回放
      });
  });

  /* ══════ v1.6 回放模式 (Replay): 读已保存棋谱重驱动棋盘, 不调用 LLM ══════ */
  var rpEl = null;
  var rpSession = null, rpCtrl = null, rpFileRecord = null, rpImportRecord = null;   // v2.4: rpImportRecord 回放层导入棋谱
  var rpLastIdx = -1;
  var rpOpener = null;   // 第27轮 a11y: 打开回放时的焦点宿主, 关闭后归还 (Tab 不落回已隐藏的层)
  var RP_LAST_KEY = 'xq_replay_last_pick';

  function rpEnsure() {
    if (rpEl) return rpEl;
    var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; };   // 第43轮: 模板里的按钮文案此前硬编码中文 (▶播放 / ⏪吃 / 吃子⏩ 在 EN 界面原样显示)
    var ov = document.createElement('div');
    ov.id = 'replay-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(10,6,2,.82);display:none;overflow:auto;padding:18px';
    ov.innerHTML =
      '<style>#rp-moves li{padding:3px 8px;border-radius:6px;cursor:pointer;list-style:none;display:flex;gap:4px;align-items:baseline}#rp-moves li:hover{background:rgba(255,255,255,.08)}#rp-moves li.active{background:#e0a030;color:#1a0e08;font-weight:bold}#rp-moves li.active b{color:#1a0e08}#rp-moves li b{color:#e0a030;min-width:24px;text-align:right}#rp-moves li .rp-ml-side{min-width:18px;font-size:11px;text-align:center}#rp-moves::-webkit-scrollbar{width:6px}#rp-moves::-webkit-scrollbar-thumb{background:#7a5a2a;border-radius:3px}.btn:disabled{opacity:.4;cursor:not-allowed}.cell.next-target{background:rgba(224,160,48,.18);box-shadow:inset 0 0 0 2px rgba(224,160,48,.7)}#rp-moves-filter{width:100%;margin-bottom:4px;padding:4px 8px;border-radius:6px;border:1px solid #7a5a2a;background:#2a1a0c;color:#f0e0c0;font-size:12px;box-sizing:border-box}kbd{display:inline-block;padding:1px 6px;border-radius:4px;background:#3a2a1c;border:1px solid #7a5a2a;color:#f0d9a0;font-family:monospace;font-size:12px;margin-right:4px}</style>'
      + '<div id="rp-dialog" role="dialog" aria-modal="true" aria-labelledby="rp-title" style="max-width:1040px;margin:0 auto">'
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">'
      + '  <b id="rp-title" style="color:#f0d9a0;font-size:16px" data-i18n="rp_title">🎬 对局回放</b>'
      + '  <select id="rp-pick" data-i18n-aria="rp_pick_label" aria-label="选择棋谱" style="flex:1;min-width:260px;padding:6px;border-radius:6px;border:1px solid #7a5a2a;background:#2a1a0c;color:#f0e0c0;font-size:12px"></select>'
      + '  <button class="btn" id="rp-import" data-i18n="rp_import_btn" data-i18n-title="rp_import_title" title="导入本地棋谱 JSON (与主界面 保存棋谱 导出格式一致)">📂 导入</button>'
      + '  <label style="color:#c4a56e;font-size:12px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="rp-autoplay" style="accent-color:#e0a030"><span data-i18n="rp_autoplay_label"> 自动播放</span></label>'
      + '  <button class="btn" id="rp-next-record" data-i18n-title="rp_nextrecord_title" data-i18n-aria="rp_nextrecord_title" aria-label="下一局" title="下一局">▶▶</button>'
      + '  <button class="btn" id="rp-export-pgn" data-i18n-title="rp_export_pgn_title" data-i18n-aria="rp_export_pgn_title" aria-label="导出 PGN" title="导出 PGN">💾 PGN</button>'
      + '  <button class="btn" id="rp-elo" data-i18n-title="elo_title" data-i18n-aria="elo_title" aria-label="Elo 天梯" title="Elo 天梯">🏆</button>'
      + '  <button class="btn" id="rp-backup" data-i18n-title="backup_btn" data-i18n-aria="backup_btn" aria-label="备份" title="备份全部数据">📦</button>'
      + '  <button class="btn" id="rp-restore" data-i18n-title="restore_btn" data-i18n-aria="restore_btn" aria-label="恢复" title="恢复备份">📥</button>'
      + '  <button class="btn" id="rp-del" data-i18n-title="rp_delete_title" data-i18n-aria="rp_delete_title" aria-label="删除该棋谱" title="删除该棋谱" style="background:rgba(192,57,43,.25)">🗑</button>'
      + '  <button class="btn" id="rp-help" data-i18n-title="rp_help_title" data-i18n-aria="rp_help_title" aria-label="键盘帮助 (?)" title="键盘帮助 (?)">⌨</button>'
      + '  <button class="btn" id="rp-fullscreen" data-i18n-title="rp_full_title" data-i18n-aria="rp_full_title" aria-label="全屏模式 (F)" title="全屏模式 (F)">⛶</button>'
      + '  <button class="btn" id="rp-close" data-i18n="rp_close_btn" style="background:#c0392b">✕ 退出回放</button>'
      + '</div>'
      + '<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">'
      + '  <div style="position:relative;padding:10px 10px 22px 26px;background:linear-gradient(135deg,#6b4f1a,#a08040,#6b4f1a);border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.6)">'
      + '    <div id="rp-board" style="position:relative;display:grid;grid-template-columns:repeat(9,var(--cell));grid-template-rows:repeat(10,var(--cell));width:calc(var(--cell)*9);height:calc(var(--cell)*10);background:#dcc88a;border:2px solid #5a3a18;box-sizing:content-box"></div>'
      + '    <div id="rp-col-labels" aria-hidden="true" style="position:absolute;left:28px;bottom:3px;width:calc(var(--cell)*9);display:grid;grid-template-columns:repeat(9,var(--cell));pointer-events:none;z-index:4"></div>'
      + '    <div id="rp-row-labels" aria-hidden="true" style="position:absolute;left:3px;top:12px;height:calc(var(--cell)*10);width:20px;display:grid;grid-template-rows:repeat(10,var(--cell));pointer-events:none;z-index:4"></div>'
      + '  </div>'
      + '  <div style="flex:1;min-width:300px;max-width:420px;display:flex;flex-direction:column;gap:10px">'
      + '    <div id="rp-head" style="color:#e8d5ae;font-size:12px;line-height:1.5"></div>'
      + '    <div id="rp-evalbar" style="position:relative;height:20px;border-radius:10px;overflow:hidden;background:#1a0e08;border:1px solid #7a5a2a;display:flex">'
      + '      <div class="rp-eb-red" style="background:linear-gradient(90deg,#c0392b,#e74c3c);width:50%;transition:width .3s"></div>'
      + '      <div class="rp-eb-black" style="background:linear-gradient(270deg,#2c3e50,#34495e);width:50%;transition:width .3s"></div>'
      + '      <div style="position:absolute;left:50%;top:0;bottom:0;width:2px;background:#f0d9a0;opacity:.5"></div>'
      + '      <span class="rp-eb-val" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#f0d9a0;font-size:11px;font-weight:bold;text-shadow:0 1px 2px rgba(0,0,0,.8);min-width:42px;text-align:center" data-i18n="rp_even">均势</span>'
      + '    </div>'
      + '    <div id="rp-info" aria-live="polite" style="background:rgba(30,18,8,.75);border:1px solid #7a5a2a;border-radius:10px;padding:10px 12px;color:#f0e0c0;font-size:13px;line-height:1.7;min-height:160px"></div>'
      + '    <input id="rp-moves-filter" data-i18n="rp_filter_placeholder" data-i18n-aria="rp_filter_placeholder" aria-label="🔍 过滤走法 (summary / 坐标)" placeholder="🔍 过滤走法 (summary / 坐标)">'
      + '    <ol id="rp-moves" style="background:rgba(30,18,8,.75);border:1px solid #7a5a2a;border-radius:10px;padding:6px 8px;margin:0;color:#e8d5ae;font-size:12px;line-height:1.5;max-height:140px;overflow-y:auto"></ol>'
      + '    <div id="rp-timechart" style="background:rgba(30,18,8,.75);border:1px solid #7a5a2a;border-radius:10px;padding:6px 10px;font-size:11px;color:#c4a56e"><div class="rp-tc-cap" style="margin-bottom:4px"></div></div>'
      + '    <div id="rp-evalchart" style="background:rgba(30,18,8,.75);border:1px solid #7a5a2a;border-radius:10px;padding:6px 10px;font-size:11px;color:#c4a56e"><div class="rp-ec-cap" style="margin-bottom:4px"></div></div>'
      + '    <div style="background:rgba(30,18,8,.75);border:1px solid #7a5a2a;border-radius:10px;padding:10px 12px">'
      + '      <input id="rp-range" type="range" min="0" max="0" value="0" step="1" data-i18n-aria="rp_jump_label" aria-label="跳转" style="width:100%;accent-color:#e0a030">'
      + '      <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:8px">'
      + '        <button class="btn" id="rp-loop" data-i18n-title="rp_loop_title" data-i18n-aria="rp_loop_title" aria-label="循环播放 (L)" title="循环播放 (L)">🔁</button>'
      + '        <button class="btn" id="rp-start" data-i18n-title="rp_start_title" data-i18n-aria="rp_start_title" aria-label="回到开头" title="回到开头">⏮</button>'
      + '        <button class="btn" id="rp-prev" data-i18n-title="rp_prev_title" data-i18n-aria="rp_prev_title" aria-label="上一步" title="上一步">◀</button>'
      + '        <button class="btn" id="rp-toggle" data-i18n-title="rp_toggle_title" title="播放/暂停 (Space)" style="min-width:72px">' + T('btn_play') + '</button>'
      + '        <button class="btn" id="rp-next" data-i18n-title="rp_next_title" data-i18n-aria="rp_next_title" aria-label="下一步" title="下一步">▶|</button>'
      + '        <button class="btn" id="rp-end" data-i18n-title="rp_end_title" data-i18n-aria="rp_end_title" aria-label="跳到结尾" title="跳到结尾">⏭</button>'
      + '        <button class="btn" id="rp-back5" data-i18n-title="rp_back5_title" data-i18n-aria="rp_back5_title" aria-label="后退5手" title="后退5手" style="font-size:11px">⏪-5</button>'
      + '        <button class="btn" id="rp-back10" data-i18n-title="rp_back10_title" data-i18n-aria="rp_back10_title" aria-label="后退10手" title="后退10手" style="font-size:11px">⏪-10</button>'
      + '        <button class="btn" id="rp-skip5" data-i18n-title="rp_skip5_title" data-i18n-aria="rp_skip5_title" aria-label="快进5手" title="快进5手" style="font-size:11px">+5⏩</button>'
      + '        <button class="btn" id="rp-skip10" data-i18n-title="rp_skip10_title" data-i18n-aria="rp_skip10_title" aria-label="快进10手" title="快进10手" style="font-size:11px">+10⏩</button>'
      + '        <button class="btn" id="rp-prev-cap" data-i18n="rp_prevcap" data-i18n-title="rp_prevcap_title" title="上一手吃子 (Shift+C)" style="font-size:11px">' + T('rp_prevcap') + '</button>'
      + '        <button class="btn" id="rp-next-cap" data-i18n="rp_nextcap" data-i18n-title="rp_nextcap_title" title="下一手吃子 (C)" style="font-size:11px">' + T('rp_nextcap') + '</button>'
      + '      </div>'
      + '      <div style="display:flex;gap:6px;justify-content:center;align-items:center;margin-top:8px;flex-wrap:wrap">'
      + '        <span style="color:#c4a56e;font-size:12px" data-i18n="speed">倍速</span>'
      + '        <button class="btn rp-speed" data-x="0.25">0.25x</button>'
      + '        <button class="btn rp-speed" data-x="0.5">0.5x</button>'
      + '        <button class="btn rp-speed" data-x="1">1x</button>'
      + '        <button class="btn rp-speed" data-x="2">2x</button>'
      + '        <button class="btn rp-speed" data-x="5">5x</button>'
      + '        <button class="btn rp-speed" data-x="10">10x</button>'
      + '        <button class="btn rp-speed" data-x="20">20x</button>'
      + '        <span style="color:#c4a56e;font-size:12px;margin-left:8px" data-i18n="rp_jump_label">跳转</span>'
      + '        <input id="rp-jump" type="number" min="0" step="1" data-i18n="rp_jump_placeholder" data-i18n-aria="rp_jump_input_label" aria-label="跳转到指定手数" placeholder="手" style="width:64px;padding:4px;border-radius:6px;border:1px solid #7a5a2a;background:#2a1a0c;color:#f0e0c0;font-size:12px">'
      + '        <button class="btn" id="rp-go" data-i18n="rp_go">' + T('rp_go') + '</button>'
      + '      </div>'
      + '    </div>'
      + '  </div>'
      + '</div></div>';
    document.body.appendChild(ov);
    /* v1.0.daily 回放层 i18n: 骨架带 data-i18n 标记, 构建后立即按当前语言刷新 (含 EN 用户首次打开) */
    if (XQ.I18N) XQ.I18N.apply();
    /* 第27轮 i18n: 图表标题首帧 tArgs 填充 — 模板原硬编码中文, EN 用户在空态 (无棋谱, rpPaint* 未跑) 下
       恒见中文; 载入棋谱后 1333 行的 rpPaint* 会用带色 span 版本覆盖, 此处只兜首帧/空态 */
    if (XQ.I18N) {
      var tc0 = ov.querySelector('.rp-tc-cap');
      if (tc0) tc0.textContent = XQ.I18N.tArgs('rp_timechart_caption', { r: XQ.I18N.t('rp_red_short'), b: XQ.I18N.t('rp_black_short'), g: XQ.I18N.t('rp_gold_cur') });
      var ec0 = ov.querySelector('.rp-ec-cap');
      if (ec0) ec0.textContent = XQ.I18N.tArgs('rp_evalchart_caption', { g: XQ.I18N.t('rp_gold_cur') });
    }
    var lines = document.createElement('div');
    lines.style.cssText = 'position:absolute;top:0;left:0;width:calc(var(--cell)*9);height:calc(var(--cell)*10);pointer-events:none;z-index:1';
    var rb = ov.querySelector('#rp-board');
    rb.appendChild(lines);
    XQ.UI.drawBoard(lines);
    /* v1.6.4 回放棋盘坐标标签: 与主棋盘同口径 (a-i 左→右 / 10-1 上→下) */
    var colL = ov.querySelector('#rp-col-labels'), rowL = ov.querySelector('#rp-row-labels');
    if (colL && !colL.childNodes.length) {
      'a,b,c,d,e,f,g,h,i'.split(',').forEach(function (ch) {
        var sp = document.createElement('span'); sp.textContent = ch;
        sp.style.cssText = 'text-align:center;font-size:11px;font-weight:bold;color:rgba(255,240,200,.62)'; colL.appendChild(sp);
      });
      ['10', '9', '8', '7', '6', '5', '4', '3', '2', '1'].forEach(function (ch) {
        var sp = document.createElement('span'); sp.textContent = ch;
        sp.style.cssText = 'display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:bold;color:rgba(255,240,200,.62)'; rowL.appendChild(sp);
      });
    }
    rpEl = {
      ov: ov, pick: ov.querySelector('#rp-pick'), head: ov.querySelector('#rp-head'),
      info: ov.querySelector('#rp-info'), range: ov.querySelector('#rp-range'),
      toggle: ov.querySelector('#rp-toggle'), jump: ov.querySelector('#rp-jump'),
      board: rb,
      evalbar: ov.querySelector('#rp-evalbar'),
      ebRed: ov.querySelector('.rp-eb-red'),
      ebBlack: ov.querySelector('.rp-eb-black'),
      ebVal: ov.querySelector('.rp-eb-val'),
      movelist: ov.querySelector('#rp-moves'),
      btnLoop: ov.querySelector('#rp-loop'),
      btnStart: ov.querySelector('#rp-start'),
      btnPrev: ov.querySelector('#rp-prev'),
      btnNext: ov.querySelector('#rp-next'),
      btnEnd: ov.querySelector('#rp-end'),
      btnSkip5: ov.querySelector('#rp-skip5'),
      btnSkip10: ov.querySelector('#rp-skip10'),
      btnBack5: ov.querySelector('#rp-back5'),
      btnBack10: ov.querySelector('#rp-back10'),
      btnPrevCap: ov.querySelector('#rp-prev-cap'),
      btnNextCap: ov.querySelector('#rp-next-cap'),
      btnNextRecord: ov.querySelector('#rp-next-record'),
      btnImport: ov.querySelector('#rp-import'),
      btnExportPGN: ov.querySelector('#rp-export-pgn'),
      btnDel: ov.querySelector('#rp-del'),
      btnHelp: ov.querySelector('#rp-help'),
      btnFull: ov.querySelector('#rp-fullscreen'),
      autoplay: ov.querySelector('#rp-autoplay'),
      timechart: ov.querySelector('#rp-timechart'),
      evalchart: ov.querySelector('#rp-evalchart'),
      movesFilter: ov.querySelector('#rp-moves-filter')
    };
    ov.querySelector('#rp-close').onclick = rpClose;
    rpEl.btnStart.onclick = function () { rpCtrl && rpCtrl.toStart(); };
    rpEl.btnPrev.onclick = function () { rpCtrl && rpCtrl.stepPrev(); };
    rpEl.toggle.onclick = function () { rpCtrl && rpCtrl.toggle(); };
    rpEl.btnNext.onclick = function () { rpCtrl && rpCtrl.stepNext(); };
    rpEl.btnEnd.onclick = function () { rpCtrl && rpCtrl.toEnd(); };
    rpEl.btnSkip5.onclick = function () { rpCtrl && rpCtrl.gotoPly(rpSession.idx() + 5); };
    rpEl.btnSkip10.onclick = function () { rpCtrl && rpCtrl.gotoPly(rpSession.idx() + 10); };
    rpEl.btnBack5.onclick = function () { rpCtrl && rpCtrl.gotoPly(rpSession.idx() - 5); };
    rpEl.btnBack10.onclick = function () { rpCtrl && rpCtrl.gotoPly(rpSession.idx() - 10); };
    rpEl.btnPrevCap.onclick = function () { rpCtrl && rpCtrl.stepPrevCapture(); };
    rpEl.btnNextCap.onclick = function () { rpCtrl && rpCtrl.stepNextCapture(); };
    rpEl.btnNextRecord.onclick = rpGotoNextRecord;
    rpEl.btnExportPGN.onclick = rpExportPGN;
    rpEl.btnDel.onclick = rpDeleteRecord;
    ov.querySelector('#rp-elo').onclick = rpShowElo;      // 第30轮: 天梯浮层
    ov.querySelector('#rp-backup').onclick = rpBackupAll; // 第30轮: 一键备份
    ov.querySelector('#rp-restore').onclick = rpRestoreAll; // 第30轮: 备份恢复
    rpEl.btnHelp.onclick = rpShowHelp;
    /* v1.7.7 全屏模式: 覆盖层整体进全屏, Esc 先退全屏再退回放 */
    function rpToggleFull() {
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (ov.requestFullscreen) ov.requestFullscreen();
      } catch (eF) {}
    }
    rpEl.btnFull.onclick = rpToggleFull;
    /* 第47轮 a11y: 名称按全屏态重算抽成单出口 — 原实现只在 fullscreenchange 里按态写名, 而 I18N.apply()
       会按 data-i18n-title/-aria 无条件把名字重写回静态键 (rp_full_title): 全屏中切换语言后, 读屏听到的
       又变回「全屏模式 (F)」(与当前动作相反)。故语言热切 (xq:i18n) 也必须重跑本出口。 */
    function rpPaintFullBtn() {
      if (!rpEl || !rpEl.btnFull) return;
      var on = !!document.fullscreenElement;
      var Tf = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
      rpEl.btnFull.textContent = on ? '⤡' : '⛶';
      rpEl.btnFull.title = on ? Tf('rp_exit_full_title') : Tf('rp_full_title');
      rpEl.btnFull.setAttribute('aria-label', on ? Tf('rp_exit_full_title') : Tf('rp_full_title'));   // 第44轮: 名称随态 (全屏中读屏听到「退出全屏」而非「全屏模式」)
    }
    rpEl.paintFullBtn = rpPaintFullBtn;
    document.addEventListener('fullscreenchange', function () {
      rpPaintFullBtn();
      paintFullscreenPressed(!!document.fullscreenElement);   // 第44轮: 主界面全屏按钮同样随 fullscreenchange 同步 (Esc 退出也走这里)
    });
    rpEl.autoplay.checked = rpGetSetting('autoplay');
    rpEl.autoplay.onchange = function () { try { localStorage.setItem(RP_AUTOPLAY_KEY, this.checked ? '1' : '0'); } catch (e) {} };
    /* 第27轮 a11y: 回放层 role=dialog + aria-modal 的配套 Tab 焦点陷阱 — 回放层全屏遮蔽主界面 (body 滚动锁定),
       Tab 可逃出到被遮住的棋盘; 现焦点在层内循环, 层外拉回 (模式同第24轮设置面板; 注意独立监听不早退 INPUT —
       走法过滤框/跳转输入框内 Tab 也要被拦) */
    document.addEventListener('keydown', function (ev) {
      if (!rpEl || rpEl.ov.style.display !== 'block') return;
      if (ev.key !== 'Tab') return;
      /* 第44轮: Elo 天梯/键盘帮助是挂在 document.body 上的**更高层** aria-modal 浮层 (不在 rpEl.ov 内)。
         它们的 Tab 陷阱 (modalKeyGate) 注册更早, 但只在「焦点到边界」时才 preventDefault —
         层内正常 Tab 时它放行, 随后本监听看到 activeElement 不在 rpEl.ov 内, 便强行把焦点拉回回放层控件:
         用户每按一次 Tab 就被踢出打开着的对话, 落到遮罩**背后**的按钮上。凡有更高层模态打开, 本陷阱必须整体让位。 */
      if (modalAnyOpen()) return;
      var fables = Array.prototype.filter.call(
        rpEl.ov.querySelectorAll('button, input, select, a[href], [tabindex="0"]'),
        function (el) { return el.offsetParent !== null && !el.disabled; }
      );
      if (!fables.length) return;
      var act = document.activeElement;
      if (ev.shiftKey) {
        if (act === fables[0] || !rpEl.ov.contains(act)) { fables[fables.length - 1].focus(); ev.preventDefault(); }
      } else {
        if (act === fables[fables.length - 1] || !rpEl.ov.contains(act)) { fables[0].focus(); ev.preventDefault(); }
      }
    });
    rpEl.movesFilter.addEventListener('input', rpPaintMoveList);
    /* v1.6.3 委托: head 内动态生成的 #rp-jump-max (最长思考链接) 点击跳转 */
    document.body.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('#rp-jump-max');
      if (a && rpCtrl) { rpCtrl.gotoPly(parseInt(a.dataset.ply, 10)); e.preventDefault(); }
    });
    ov.querySelector('#rp-go').onclick = rpJump;
    rpEl.jump.addEventListener('keydown', function (e) { if (e.key === 'Enter') rpJump(); });
    /* 第44轮 性能: 拖动进度条时 input 每个像素都触发, 每次 gotoPly 都会整层重画 (90 格 DOM 重建 + 走法表/图表
       innerHTML 全量替换)。同一帧内只认最后一次: rAF 合帧 — 拖动观感不变, 一帧最多一次重画。
       无 rAF 环境 (老浏览器/测试桩) 退化为同步执行, 行为与修复前一致。 */
    var rpRangePending = false;
    rpEl.range.addEventListener('input', function () {
      if (rpRangePending) return;
      rpRangePending = true;
      var apply = function () { rpRangePending = false; if (rpCtrl) rpCtrl.gotoPly(parseInt(rpEl.range.value, 10)); };
      if (typeof requestAnimationFrame === 'function') requestAnimationFrame(apply); else apply();
    });
    Array.prototype.forEach.call(ov.querySelectorAll('.rp-speed'), function (b) {
      b.onclick = function () { rpCtrl && rpCtrl.setSpeed(parseFloat(b.dataset.x)); rpPaintSpeeds(); try { localStorage.setItem('xq_replay:speed', b.dataset.x); } catch (e5) {} };
    });
    rpEl.btnLoop.onclick = function () {
      if (!rpCtrl) return;
      rpCtrl.setLoop(!rpCtrl.isLooping());
      rpPaintLoop();
      try { localStorage.setItem('xq_replay:loop', rpCtrl.isLooping() ? '1' : '0'); } catch (e6) {}   // v2.4 循环状态记忆
    };
    /* v2.4 导入本地 JSON 棋谱直接回放 (与 Record.downloadFile 导出格式一致, 主界面载入只重放无控制, 这里给完整回放体验) */
    rpEl.btnImport.onclick = function () {
      var input = document.createElement('input');
      input.type = 'file'; input.accept = '.json,.pgn,application/json';
      input.onchange = function () {
        if (!input.files[0]) return;
        XQ.Record.importFromFile(input.files[0]).then(function (rec) {
          /* v3.9: 导入棋谱落库 (id=import-*, 只留最近2条, Record.saveImported) — #rp=ls:<id> 深链/刷新续看对导入文件也可用; rpClose 不删记录 */
          var saved = (XQ.Record.saveImported) ? XQ.Record.saveImported(rec) : rec;
          rpImportRecord = saved;
          var sel = rpEl.pick;
          Array.prototype.forEach.call(sel.options, function (op) { if (op.value === 'file:import') sel.removeChild(op); });   // 清理旧版占位项
          var o = document.createElement('option');
          o.value = 'ls:' + saved.id;
          o.textContent = '📂 ' + (saved.red && saved.red.name || '?') + ' vs ' + (saved.black && saved.black.name || '?') + ' (' + (XQ.I18N ? XQ.I18N.tArgs('rp_moves_unit', { n: saved.moves.length }) : saved.moves.length + '手') + ')';   // 第28轮 i18n
          o.title = (saved.date || '') + (saved.redModel ? ' [' + saved.redModel + ']' : '') + (saved.blackModel ? ' [' + saved.blackModel + ']' : '');   // 第28轮: 长名悬停看全
          sel.insertBefore(o, sel.firstChild);
          sel.value = o.value;
          try { history.replaceState(null, '', '#rp=' + encodeURIComponent(o.value)); } catch (eH5) {}   // v3.9: 导入也写深链 (与 rpPickLoad 同款)
          rpStart(saved);
        }).catch(function (eImp) {
          rpEl.info.innerHTML = '<span style="color:#e67e22">' + (XQ.I18N ? XQ.I18N.t('rp_import_fail') : '导入失败: ') + (eImp && eImp.message || eImp) + '</span>';
        });
      };
      input.click();
    };
    /* 第42轮: 进度条的读屏名称改由 data-i18n-aria 声明式提供 (apply() 在语言热切时自动刷新)。
       原实现只在此处 setAttribute 一次 — 切语言后名称停在旧语言, 直到下次打开回放层才更新。 */
    rpEl.movelist.addEventListener('click', function (e) {
      var li = e.target.closest('li[data-ply]');
      if (li && rpCtrl) rpCtrl.gotoPly(parseInt(li.dataset.ply, 10));
    });
    rpEl.movelist.addEventListener('keydown', function (e) {   // 第37轮 a11y: 走法 li 键盘可达 (tabindex=0 + Enter/Space; stopPropagation 防 Space 落到回放全局 播放/暂停)
      if (e.key !== 'Enter' && e.key !== ' ') return;
      var li = e.target.closest && e.target.closest('li[data-ply]');
      if (!li) return;
      e.preventDefault();
      e.stopPropagation();
      if (rpCtrl) rpCtrl.gotoPly(parseInt(li.dataset.ply, 10));
    });
    /* 滚轮步进: 棋盘上 wheel 下=next 上=prev, 180ms 节流 */
    var rpWheelLock = 0;
    function rpWheelStep(e) {
      e.preventDefault();
      var now = Date.now();
      if (now - rpWheelLock < 180 || !rpCtrl) return;
      rpWheelLock = now;
      if (e.deltaY > 0) rpCtrl.stepNext(); else if (e.deltaY < 0) rpCtrl.stepPrev();
    }
    rb.addEventListener('wheel', rpWheelStep, { passive: false });
    /* 第28轮: 评值/时长图表上同样滚轮步进 (长图表浏览免挪手到棋盘) */
    rpEl.timechart.addEventListener('wheel', rpWheelStep, { passive: false });
    rpEl.evalchart.addEventListener('wheel', rpWheelStep, { passive: false });
    rpPaintSpeeds();
    rpPaintLoop();
    rpPaintChartCaptions();
  }
  /* v1.0.daily 图表标题双语 (含占位符嵌套 span, 走 tArgs 动态拼装不走 data-i18n) */
  function rpPaintChartCaptions() {
    if (!rpEl || !XQ.I18N) return;
    var r = '<span style="color:#c0392b">' + XQ.I18N.t('rp_red_short') + '</span>';
    var b = '<span style="color:#3498db">' + XQ.I18N.t('rp_black_short') + '</span>';
    var g = '<span style="color:#e0a030">' + XQ.I18N.t('rp_gold_cur') + '</span>';
    var tc = rpEl.timechart && rpEl.timechart.querySelector('.rp-tc-cap');
    if (tc) tc.innerHTML = XQ.I18N.tArgs('rp_timechart_caption', { r: r, b: b, g: g });
    var g2 = '<span style="color:#ffd76a">' + XQ.I18N.t('rp_gold_cur') + '</span>';
    var ec = rpEl.evalchart && rpEl.evalchart.querySelector('.rp-ec-cap');
    if (ec) ec.innerHTML = XQ.I18N.tArgs('rp_evalchart_caption', { g: g2 });
  }
  function rpPaintLoop() {
    var on = rpCtrl && rpCtrl.isLooping();
    rpEl.btnLoop.style.background = on ? '#e0a030' : '';
    rpEl.btnLoop.style.color = on ? '#1a0e08' : '';
    rpEl.btnLoop.style.fontWeight = on ? 'bold' : '';
    rpEl.btnLoop.setAttribute('aria-pressed', on ? 'true' : 'false');   // 第28轮: 循环开关读屏可感知
  }
  function rpPaintSpeeds() {
    var cur = rpCtrl ? rpCtrl.speed() : 1;
    Array.prototype.forEach.call(rpEl.ov.querySelectorAll('.rp-speed'), function (b) {
      var active = parseFloat(b.dataset.x) === cur;
      b.style.background = active ? '#e0a030' : '';
      b.style.color = active ? '#1a0e08' : '';
      b.style.fontWeight = active ? 'bold' : '';
      b.setAttribute('aria-pressed', active ? 'true' : 'false');   // 第28轮: 倍速按钮按下态读屏可感知
    });
  }
  function rpJump() {
    var n = parseInt(rpEl.jump.value, 10);
    if (!isNaN(n) && rpCtrl) {
      var tot = rpSession ? rpSession.total() : 0;
      var clamped = Math.max(0, Math.min(tot, n));
      rpEl.jump.value = clamped;   // 第28轮: 越界输入回落到钳制值 (可见反馈, 原先静默)
      rpCtrl.gotoPly(clamped);
    }
  }
  function rpFillPicker() {
    var sel = rpEl.pick;
    var list = XQ.Replay.listLocal();
    sel.innerHTML = '';
    if (!list.length) {
      var o0 = document.createElement('option');
      o0.value = ''; o0.textContent = XQ.I18N ? XQ.I18N.t('rp_no_local') : '(暂无本地棋谱)'; sel.appendChild(o0);
    }
    var T2 = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
    var TA = XQ.I18N ? XQ.I18N.tArgs : function (k) { return k; };
    list.forEach(function (s) {
      var o = document.createElement('option');
      o.value = 'ls:' + s.id;
      var tag = s.winner === 'red' ? T2('rp_tag_red_win') : s.winner === 'black' ? T2('rp_tag_black_win') : (s.result ? T2('rp_tag_over') : '');
      var imp = typeof s.id === 'string' && s.id.indexOf('import-') === 0 ? '📂 ' : '';   // v3.9: 导入落库的棋谱加标记
      o.textContent = imp + s.stamp + '  ' + s.red + ' vs ' + s.black + '  (' + TA('rp_moves_unit', { n: s.plies }) + (tag ? '·' + tag : '') + ')';
      sel.appendChild(o);
    });
    return fetch('logs/match_headless.json').then(function (r) { if (!r.ok) throw 0; return r.json(); })
      .then(function (rec) {
        if (rec && rec.moves) {
          rpFileRecord = rec;
          var o = document.createElement('option');
          o.value = 'file:headless';
          o.textContent = '📁 logs/match_headless.json  (' + (XQ.I18N ? XQ.I18N.tArgs('rp_moves_unit', { n: rec.moves.length }) : rec.moves.length + '手') + ')';
          sel.insertBefore(o, sel.firstChild);
        }
      }).catch(function () {});
  }
  function rpPickLoad() {
    var v = rpEl.pick.value;
    if (!v) return;
    try { localStorage.setItem(RP_LAST_KEY, v); } catch (e) {}
    try { history.replaceState(null, '', '#rp=' + encodeURIComponent(v)); } catch (eH1) {}   // v3.8/v3.9 深链: URL hash 记录当前回放对象 (file:import 已改落库为 ls:import-*, 全部可深链)
    var rec = null;
    if (v === 'file:headless') rec = rpFileRecord;
    else if (v === 'file:import') rec = rpImportRecord;   // v2.4 回放层导入的本地棋谱
    else if (v.indexOf('ls:') === 0) rec = (XQ.Record && XQ.Record.get(v.slice(3))) || null;
    rpStart(rec);
  }
  var rpBookmarks = [];   // v1.0.daily 回放书签 (当前棋谱, localStorage 持久按 id 隔离)
  function rpBookmarkLoad(record) {
    rpBookmarks = [];
    try {
      var raw = JSON.parse(localStorage.getItem(XQ.Replay.bookmarkKey(record.id)) || '[]');
      if (Array.isArray(raw)) rpBookmarks = raw;
    } catch (e) {}
  }
  function rpToggleBookmark() {
    if (!rpSession || !rpSession.idx) return;
    var cur = rpSession.idx();
    if (cur < 1) return;   // 初始局面无手可标
    rpBookmarks = XQ.Replay.toggleBookmark(rpBookmarks, cur);
    try { localStorage.setItem(XQ.Replay.bookmarkKey(rpSession.record.id), JSON.stringify(rpBookmarks)); } catch (e) {}
    rpPaintMoveList();
  }
  /* v1.0.daily 书签跳转: dir>0 下一书签 / dir<0 上一书签; 到头无更多则原地不动 */
  function rpGotoBookmark(dir) {
    if (!rpCtrl || !rpSession || !rpBookmarks.length) return;
    var cur = rpSession.idx();
    var target = dir > 0 ? XQ.Replay.nextBookmark(rpBookmarks, cur) : XQ.Replay.prevBookmark(rpBookmarks, cur);
    if (target == null || target < 0 || target > rpSession.total()) return;
    rpCtrl.gotoPly(target);
  }
  /* v1.0.daily 删除当前回放棋谱 (含其进度/书签 localStorage), 重建选择器 */
  function rpDeleteRecord() {
    var rec = rpSession && rpSession.record;
    if (!rec || !rec.id) return;
    var T9 = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
    if (!window.confirm(T9('rp_delete_confirm'))) return;
    XQ.Record.remove(rec.id);   // 第28轮: 进度/书签孤儿键清理已内聚到 Record.remove
    rpFillPicker().then(function () {
      if (rpEl.pick.options.length && rpEl.pick.options[0].value !== '') { rpEl.pick.selectedIndex = 0; rpPickLoad(); }
      else rpEl.info.innerHTML = '<span style="color:#e67e22">' + T9('rp_pick_empty') + '</span>';   // 全删光 → 引导导入
    });
  }
  function rpStart(record) {
    if (!record || !record.moves) {
      rpEl.info.innerHTML = '<span style="color:#e67e22">' + (XQ.I18N ? XQ.I18N.t('rp_no_record') : '⚠ 没有可回放的棋谱数据') + '</span>'; return;
    }
    if (rpCtrl) rpCtrl.dispose();
    rpSession = XQ.Replay.create(record);
    rpCtrl = XQ.ReplayController.create(rpSession, { onState: rpOnState, onPlayState: rpOnPlayState });
    rpLastIdx = -1;
    /* v1.6.4 记忆倍速: 恢复上次选择的倍速 (localStorage xq_replay:speed) */
    var sp = parseFloat(rpGetSetting('speed'));
    if (XQ.ReplayController.SPEEDS.indexOf(sp) >= 0) rpCtrl.setSpeed(sp);
    if (rpGetSetting('loop') === '1') rpCtrl.setLoop(true);
    rpBookmarkLoad(record);   // v1.0.daily 书签恢复   // v2.4 循环播放状态记忆 (与倍速同欥 localStorage)
    rpPaintSpeeds();
    rpPaintLoop();
    rpPaintHead();
    rpPaintMoveList();
    /* 第43轮: 播放/暂停按钮同样需要首绘 — rpOnPlayState 原先只在「播放态变化」与语言热切时被调用,
       而首次打开回放时没有任何播放态变化 → 按钮停在模板里的初始文案 (EN 界面下就是硬编码中文「▶ 播放」),
       要等用户按一次播放才可能变。与第42轮「回放层首绘缺失」同类: 依赖对端条件性通知的路径必须自补首帧。 */
    rpOnPlayState(rpCtrl.playing ? rpCtrl.playing() : false);
    var pos = 0;
    try { pos = parseInt(localStorage.getItem('xq_replay_pos_' + record.id) || '0', 10); } catch (e) {}
    if (pos < 0 || pos > rpSession.total()) pos = 0;
    if (pos > 0) rpCtrl.gotoPly(pos); else rpCtrl.gotoPly(0);
    /* 第42轮: 控制器的手动导航在「目标位置 == 当前位置」时不发状态 (replay.js session.goto 无位移返回 false →
       controller.manual 跳过 emit), 而首次打开某局时记忆进度恰好是 0 → gotoPly(0) 是空操作,
       于是盘面 90 格 / 信息面板 / 时长与评值图 / 进度条上限 全部停在初始空白, 直到用户点一次上/下一步。
       显式补一次首绘: 回放层不得以空白开场 (有位移时这次重绘是幂等的, 且不再触发落子动画)。 */
    rpOnState(rpSession.state());
    if (rpGetSetting('autoplay') === '1') setTimeout(function () { rpCtrl && rpCtrl.play(); }, 300);
  }
  var _rpHeavyTick = 0;   // 第30轮 (第28轮该编辑曾随脚本中断丢失, 本轮落地)
  function rpOnState(st) {
    var animate = (st.idx === rpLastIdx + 1);
    rpPaintBoard(st, animate);
    rpPaintInfo(st);
    rpPaintEval(st);
    rpPaintButtons(st);
    /* ≥10x 高倍速: 时长/评值图/头部/走法列表 每 5 手或终态重绘; 非重绘手只切走法列表 active 高亮 (当前手指示不中断) */
    _rpHeavyTick++;
    var heavy = rpCtrl && rpCtrl.speed() >= 10;
    if (!heavy || _rpHeavyTick % 5 === 0 || st.idx === st.total) {
      rpPaintTimeChart();
      rpPaintEvalChart();
      rpPaintHead();
      rpPaintMoveList();
    } else {
      var curPly30 = st.idx;
      Array.prototype.forEach.call(rpEl.movelist.querySelectorAll('li[data-ply]'), function (li) {
        li.classList.toggle('active', parseInt(li.dataset.ply, 10) === curPly30);
      });
    }
    rpSavePos(st);
    rpLastIdx = st.idx;
  }
  function rpOnPlayState(playing) {
    var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
    rpEl.toggle.textContent = playing ? T('btn_pause') : T('btn_play');
  }
  var RP_AUTOPLAY_KEY = 'xq_replay:autoplay';
  function rpGetSetting(k) { try { return localStorage.getItem('xq_replay:' + k); } catch (e) { return null; } }
  function rpHeadProgress() {
    var cur = rpSession.idx(), tot = rpSession.total();
    var pct = Math.round(cur / Math.max(1, tot) * 100);
    return ' · <b style="color:#e0a030">' + pct + '%</b> ' + (XQ.I18N ? XQ.I18N.tArgs('rp_progress', { c: cur, t: tot }) : '(' + cur + '/' + tot + '手)');
  }
  function rpCountMaterial(cells) {
    var r = 0, b = 0;
    for (var y = 0; y < cells.length; y++) for (var x = 0; x < cells[y].length; x++) {
      var p = cells[y][x]; if (!p || p.type === 'king') continue;
      if (p.color === 'red') r++; else b++;
    }
    return { red: r, black: b, diff: r - b };
  }
  function rpHeadMaterial() {
    var mat = rpCountMaterial(rpSession.engine().snapshot().cells);
    var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; }, TA = XQ.I18N ? XQ.I18N.tArgs : function (k) { return k; };
    var tag = mat.diff === 0 ? ' · ' + T('rp_even') : (mat.diff > 0 ? ' · <span style="color:#e74c3c">' + TA('rp_red_plus', { n: mat.diff }) + '</span>' : ' · <span style="color:#3498db">' + TA('rp_black_plus', { n: -mat.diff }) + '</span>');
    return ' · ' + T('rp_material') + ' <span style="color:#e74c3c">🔴 ' + mat.red + '</span>-<span style="color:#3498db">⚫ ' + mat.black + '</span>' + tag;
  }
  function rpHeadMaxTime() {
    var rec = rpSession.record, maxT = 0, maxN = 0;
    for (var i = 0; i < rec.moves.length; i++) { var t = rec.moves[i].timeMs || 0; if (t > maxT) { maxT = t; maxN = i + 1; } }
    if (maxT <= 0) return '';
    /* 第46轮 a11y: 该锚点是 href="javascript:void(0)" 的原生可聚焦元素 (第45轮起进了焦点陷阱的可聚焦集合),
       但它的可见文本是 '@#59' — 可访问名取内容, 读屏只会念「@ 井号 59」, 完全不知道这是「跳到最长思考那一手」。
       补动作型 aria-label (含手数, 故随 rpPaintHead 重建, 语言热切经 xq:i18n 监听重绘同步)。 */
    var maxName = XQ.I18N ? XQ.I18N.tArgs('rp_jump_max', { n: maxN }) : '跳到最长思考那一手 (#' + maxN + ')';
    return ' · ' + (XQ.I18N ? XQ.I18N.tArgs('rp_longest', { s: (maxT / 1000).toFixed(1) }) : '最长 ' + (maxT / 1000).toFixed(1) + 's') + ' <a href="javascript:void(0)" id="rp-jump-max" style="color:#e0a030;text-decoration:underline" data-ply="' + maxN + '" aria-label="' + esc2(maxName) + '" title="' + esc2(maxName) + '">@#' + maxN + '</a>';
  }
  function rpPaintTimeChart() {
    if (!rpEl || !rpEl.timechart) return;
    var rec = rpSession.record;
    var maxT = 1;
    for (var i = 0; i < rec.moves.length; i++) maxT = Math.max(maxT, rec.moves[i].timeMs || 0);
    var w = 320, h = 50, gap = 1;
    var bw = Math.max(2, (w - (rec.moves.length - 1) * gap) / Math.max(1, rec.moves.length));
    var cur = rpSession.idx();
    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="width:100%;height:' + h + 'px;display:block;background:rgba(0,0,0,.2);border-radius:4px">';
    for (var i = 0; i < rec.moves.length; i++) {
      var t = rec.moves[i].timeMs || 0;
      var bh = Math.max(2, t / maxT * (h - 6));
      var x = i * (bw + gap);
      var isCur = (i + 1 === cur);
      var color = isCur ? '#e0a030' : (rec.moves[i].side === 'red' ? '#c0392b' : '#3498db');
      svg += '<rect x="' + x.toFixed(1) + '" y="' + (h - bh).toFixed(1) + '" width="' + bw.toFixed(1) + '" height="' + bh.toFixed(1) + '" fill="' + color + '" rx="1" opacity="' + (isCur ? 1 : 0.65) + '" data-ply="' + (i + 1) + '" style="cursor:pointer"><title>#' + (i + 1) + ' ' + Math.round(t / 1000) + 's</title></rect>';
    }
    svg += '</svg>';
    var existingSvg = rpEl.timechart.querySelector('svg');
    if (existingSvg) existingSvg.outerHTML = svg; else rpEl.timechart.insertAdjacentHTML('beforeend', svg);
    Array.prototype.forEach.call(rpEl.timechart.querySelectorAll('rect[data-ply]'), function (r) {
      r.onclick = function () { rpCtrl && rpCtrl.gotoPly(parseInt(r.dataset.ply, 10)); };
    });
  }
  /* v1.6.4 评值走势曲线: 全局 evaluation 数字连线 (红方视角, clamp ±3), 金点=当前位置, 点击跳转 */
  function rpPaintEvalChart() {
    if (!rpEl || !rpEl.evalchart || !rpSession) return;
    var rec = rpSession.record;
    var w = 320, h = 46, pad = 4;
    var pts = [];
    for (var i = 0; i < rec.moves.length; i++) {
      var v = rpParseEval(rec.moves[i].evaluation);
      if (isFinite(v)) pts.push({ n: i + 1, v: Math.max(-3, Math.min(3, v)) });
    }
    var old = rpEl.evalchart.querySelector('svg');
    if (old) old.remove();
    var ph = rpEl.evalchart.querySelector('.rp-ec-ph');
    if (ph) ph.remove();
    if (pts.length < 2) {
      var d0 = document.createElement('div');
      d0.className = 'rp-ec-ph';
      d0.style.cssText = 'color:#7a5a2a;padding:6px 0';
      d0.textContent = XQ.I18N ? XQ.I18N.t('rp_eval_sparse') : '(评值数据不足, 需至少 2 手含数字 evaluation)';   // 第28轮 i18n
      rpEl.evalchart.appendChild(d0);
      return;
    }
    function xOf(n) { return pad + (n - 1) / Math.max(1, rec.moves.length - 1) * (w - pad * 2); }
    function yOf(v) { return h / 2 - v / 3 * (h / 2 - pad); }
    var svg = '<svg viewBox="0 0 ' + w + ' ' + h + '" preserveAspectRatio="none" style="width:100%;height:' + h + 'px;display:block;background:rgba(0,0,0,.2);border-radius:4px">';
    svg += '<line x1="' + pad + '" y1="' + h / 2 + '" x2="' + (w - pad) + '" y2="' + h / 2 + '" stroke="#7a5a2a" stroke-dasharray="3,3" stroke-width="1"/>';
    var path = '';
    for (var p = 0; p < pts.length; p++) path += (p ? ' ' : '') + xOf(pts[p].n).toFixed(1) + ',' + yOf(pts[p].v).toFixed(1);
    svg += '<polyline points="' + path + '" fill="none" stroke="#e0a030" stroke-width="1.6" opacity=".85"/>';
    for (var p2 = 0; p2 < pts.length; p2++) {
      var isCur = pts[p2].n === rpSession.idx();
      svg += '<circle cx="' + xOf(pts[p2].n).toFixed(1) + '" cy="' + yOf(pts[p2].v).toFixed(1) + '" r="' + (isCur ? 3.5 : 2) + '" fill="' + (isCur ? '#ffd76a' : '#e0a030') + '"' + (isCur ? ' stroke="#fff" stroke-width="1"' : '') + ' data-ply="' + pts[p2].n + '" style="cursor:pointer"><title>#' + pts[p2].n + ' ' + (pts[p2].v > 0 ? '+' : '') + pts[p2].v.toFixed(1) + '</title></circle>';
    }
    svg += '</svg>';
    rpEl.evalchart.insertAdjacentHTML('beforeend', svg);
    Array.prototype.forEach.call(rpEl.evalchart.querySelectorAll('circle[data-ply]'), function (c) {
      c.onclick = function () { rpCtrl && rpCtrl.gotoPly(parseInt(c.dataset.ply, 10)); };
    });
  }
  function rpGotoNextRecord() {
    var sel = rpEl.pick;
    var opts = Array.prototype.slice.call(sel.options).filter(function (o) { return o.value; });
    var idx = opts.findIndex(function (o) { return o.value === sel.value; });
    if (idx < 0 || idx >= opts.length - 1) return;
    sel.value = opts[idx + 1].value;
    rpPickLoad();
  }
  function rpExportPGN() {
    if (!rpSession) return;
    var rec = rpSession.record;
    var date = rec.date ? new Date(rec.date).toISOString().slice(0, 10) : '????.??.??';
    var pgnRes = rec.winner === 'red' ? '1-0' : rec.winner === 'black' ? '0-1'
      : (rec.result === 'repetition' || rec.result === 'natural' || rec.result === 'draw' || rec.result === 'agree') ? '1/2-1/2' : '*';   // v3.8: 和棋局 (重复/自然限着判和) 用 PGN 标准记号, 与未完成局 '*' 区分
    var lines = [
      '[Event "LLM-chess Replay"]',
      '[Site "LLM-chess (github.com/yydsdbc/LLM-Chess)"]',   // 第28轮: PGN 标准头补全 (Site/Round/Termination)
      '[Date "' + date + '"]',
      '[Round "' + (rec.id || '-') + '"]',
      '[Red "' + (rec.red && rec.red.name || '?') + '"] [RedModel "' + (rec.red && rec.red.model || '?') + '"]',
      '[Black "' + (rec.black && rec.black.name || '?') + '"] [BlackModel "' + (rec.black && rec.black.model || '?') + '"]',
      '[Result "' + pgnRes + '"]',
      '[Termination "' + (rec.result || 'unterminated') + '"]'
    ];
    var bmKeys = rpBookmarks || [];
    var tokens = [];
    for (var i = 0; i < rec.moves.length; i++) {
      var m = rec.moves[i];
      /* v3.9.2 PGN 加中文记谱 (与 {summary} 并列) — 国际象棋 PGN 应用忽略额外 {} 字段 */
      var cnN = (m.side && m.piece && m.from && m.to && typeof cnNotation === 'function') ? cnNotation(m.side, m.piece, m.from, m.to) : '';
      var cmts = [];
      if (cnN) cmts.push('cn:' + cnN);
      if (m.summary) cmts.push(m.summary);
      if (i % 2 === 0) tokens.push(Math.floor(i / 2) + 1 + '.');
      tokens.push(m.from + '-' + m.to + (cmts.length ? ' {' + cmts.join(' | ') + '}' : ''));
      if (bmKeys.indexOf(i + 1) >= 0) tokens.push('{%bm ' + (i + 1) + '}');   // 第28轮: 书签随 PGN 导出 ({%bm N} 自定义注释)
    }
    tokens.push(pgnRes);
    /* v1.6.4 PGN 修复 + v3.8 结果记号统一由 pgnRes 计算; 第28轮: 80 列折行 (PGN 惯例), 长注释不撑超长单行 */
    var curL = '';
    for (var ti = 0; ti < tokens.length; ti++) {
      if (curL.length && (curL + ' ' + tokens[ti]).length > 80) { lines.push(curL); curL = tokens[ti]; }
      else curL = curL ? curL + ' ' + tokens[ti] : tokens[ti];
    }
    if (curL) lines.push(curL);
    var blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var safeN = function (s2) { return String(s2 || '?').replace(/[^\w.-]+/g, '-').slice(0, 24); };   // 第28轮: 富文件名 (双方名+日期)
    var dN = rec.date ? new Date(rec.date) : new Date();
    var stampN = dN.getFullYear() + ('0' + (dN.getMonth() + 1)).slice(-2) + ('0' + dN.getDate()).slice(-2);
    a.download = 'xq_' + safeN(rec.red && rec.red.name) + '_vs_' + safeN(rec.black && rec.black.name) + '_' + stampN + '.pgn';
    a.click();
    
  }
  /* 第43轮: 全屏模态浮层 (Elo 天梯 / 回放帮助层) 的统一开启与收尾 —
     两处原先都用内联 onclick="…remove()" 关闭: 摘节点即完事, 焦点留在已摘掉的按钮上; 且都没有 Esc 出口
     → Esc 被**下层**回放层的处理器接走 (关掉下层回放层, 浮层孤零零留在主界面上)。 */
  var _modalOpener = {};
  function modalClose(id) {
    var ov = document.getElementById(id);
    if (ov && ov.parentNode) ov.parentNode.removeChild(ov);
    var back = _modalOpener[id];
    delete _modalOpener[id];
    if (back && back.isConnected && typeof back.focus === 'function') { try { back.focus({ preventScroll: true }); } catch (eFM) { back.focus(); } }
  }
  function modalMarkOpen(id, ov) {
    _modalOpener[id] = (document.activeElement && document.activeElement !== document.body) ? document.activeElement : null;
    ov.addEventListener('click', function (ev) { if (ev.target === ov) modalClose(id); });   // 遮罩点击关闭 (与 Esc/✕ 同一出口)
    var btn = ov.querySelector('button');
    // 焦点入层: 与设置层同口径 (双 rAF 等 visibility 过渡起帧, 同步 focus 会被静默忽略)
    var focusIn = function () { if (btn && document.getElementById(id)) { try { btn.focus({ preventScroll: true }); } catch (eFM2) { btn.focus(); } } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { requestAnimationFrame(focusIn); });
    else setTimeout(focusIn, 0);
  }
  /* 第44轮: 「当前是否有更高层模态浮层开着」的唯一事实源 — 供下层容器 (回放层) 的 Tab 陷阱让位用。
     判据取 _modalOpener 的键 + 节点仍在文档内 (键在 modalClose 时删除, 故键存在即代表开启中)。 */
  function modalAnyOpen() {
    for (var id in _modalOpener) { if (document.getElementById(id)) return true; }
    return false;
  }
  /* 模态浮层的统一键盘闸门 (Esc 关闭 / Tab 陷阱 / 其余按键整体让位) — 返回 true 表示已接管该按键 */
  function modalKeyGate(ev, id, closeFn, toggleKeys) {
    var ov = document.getElementById(id);
    if (!ov) return false;
    if (ev.key === 'Escape') { closeFn(); ev.preventDefault(); return true; }
    if (toggleKeys && toggleKeys.indexOf(ev.key) >= 0) { closeFn(); ev.preventDefault(); return true; }   // 自述「再次按下关闭」的浮层
    if (ev.key === 'Tab') {
      var fables = Array.prototype.filter.call(
        ov.querySelectorAll('button, input, select, a[href], [tabindex="0"]'),
        function (el) { return el.offsetParent !== null && !el.disabled; }
      );
      if (fables.length) {
        var act = document.activeElement;
        if (ev.shiftKey) {
          if (act === fables[0] || !ov.contains(act)) { fables[fables.length - 1].focus(); ev.preventDefault(); }
        } else if (act === fables[fables.length - 1] || !ov.contains(act)) { fables[0].focus(); ev.preventDefault(); }
      }
    }
    return true;   // 浮层打开期间其余按键一律不落到棋盘/回放快捷键
  }

  /* 第30轮 Elo 天梯浮层 (回放层 🏆)
     第43轮 a11y: 它是盖在回放层之上的全屏 aria-modal 对话, 但此前既无对话语义也无键盘出口 —
     只能鼠标点遮罩关闭; 而 Esc 会被下层回放层的处理器接走 (关掉**下层**回放层, 天梯孤零零留在主界面上),
     方向键/空格还会在遮罩后面步进棋局。现补: 对话语义 + 唯一关闭出口 (Esc/✕/遮罩同一出口, 归还焦点)
     + 打开期间全局快捷键整体让位 + Tab 焦点陷阱。 */
  function rpEloClose() { modalClose('rp-elo-overlay'); }
  function rpShowElo() {
    if (document.getElementById('rp-elo-overlay')) return;
    var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
    var sortKey = 'rating';
    function paint() {
      var rows = XQ.Elo.leaderboard();
      rows.sort(function (a, b) { return (b[sortKey] || 0) - (a[sortKey] || 0) || (a.name < b.name ? -1 : 1); });
      var body = rows.length
        ? rows.map(function (r2) {
            return '<tr><td style="padding:2px 10px">' + esc2(r2.name) + '</td><td style="padding:2px 10px;text-align:right;color:#f0d9a0"><b>' + r2.rating + '</b></td><td style="padding:2px 10px;text-align:right">' + r2.games + '</td><td style="padding:2px 10px;text-align:right;color:#58d68d">' + r2.win + '</td><td style="padding:2px 10px;text-align:right">' + r2.draw + '</td><td style="padding:2px 10px;text-align:right;color:#ff8a7a">' + r2.loss + '</td></tr>';
          }).join('')
        : '<tr><td colspan="6" style="text-align:center;padding:10px;color:#c4a56e">' + T('elo_empty') + '</td></tr>';
      var ov = document.getElementById('rp-elo-overlay');
      if (!ov) return;   // 已关闭 (paint 由排序/清空触发, 可能晚于 Esc 关闭)
      ov.querySelector('#rp-elo-body').innerHTML = body;
      // 第43轮 a11y: 排序态对读屏可感知 — aria-sort 只能落在列头 th 上 (放在按钮上无效)
      var thR = ov.querySelector('#elo-s-rating'), thG = ov.querySelector('#elo-s-games');
      if (thR) thR.setAttribute('aria-sort', sortKey === 'rating' ? 'descending' : 'none');
      if (thG) thG.setAttribute('aria-sort', sortKey === 'games' ? 'descending' : 'none');
    }
    /* 第43轮 a11y: 排序入口改原生 <button> — 原实现是带 cursor:pointer 的 <th> + onclick, 键盘不可达且无排序语义 */
    var sortBtn = function (k2, label) {
      return '<button type="button" class="btn elo-sort" data-k="' + k2 + '" style="background:none;border:0;padding:0 2px;color:#c4a56e;font:inherit;cursor:pointer">' + label + '</button>';
    };
    var html = '<div id="rp-elo-overlay" role="dialog" aria-modal="true" aria-labelledby="rp-elo-title" style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:310;display:flex;align-items:center;justify-content:center">'
      + '<div style="background:#2a1a0c;border:1px solid #7a5a2a;border-radius:14px;padding:20px 24px;min-width:420px;color:#f0e0c0;box-shadow:0 8px 32px rgba(0,0,0,.7)">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin-bottom:12px"><b id="rp-elo-title" style="color:#f0d9a0;font-size:18px">' + T('elo_title') + '</b>'
      + '<span style="display:flex;gap:8px">'
      + '<button id="rp-elo-close" class="btn" data-i18n-aria="overlay_close" aria-label="' + T('overlay_close') + '" title="Esc">✕</button>'
      + '<button id="rp-elo-reset" class="btn" style="background:rgba(192,57,43,.3)">' + T('elo_reset') + '</button></span></div>'
      + '<table style="width:100%;font-size:13px"><thead><tr style="color:#c4a56e">'
      + '<th scope="col" style="text-align:left;padding:2px 10px">' + T('elo_th_model') + '</th>'
      + '<th scope="col" id="elo-s-rating" aria-sort="none" style="text-align:right;padding:2px 10px">' + sortBtn('rating', T('elo_th_rating')) + '</th>'
      + '<th scope="col" id="elo-s-games" aria-sort="none" style="text-align:right;padding:2px 10px">' + sortBtn('games', T('elo_th_games')) + '</th>'
      + '<th scope="col" colspan="3" style="text-align:right;padding:2px 10px">' + T('elo_th_wdl') + '</th></tr></thead>'
      + '<tbody id="rp-elo-body"></tbody></table></div></div>';
    var d = document.createElement('div');
    d.innerHTML = html;
    var ov = d.firstChild;
    modalMarkOpen('rp-elo-overlay', ov);
    ov.addEventListener('click', function (ev) {
      var k2 = ev.target && ev.target.getAttribute ? ev.target.getAttribute('data-k') : null;
      if (k2) { sortKey = k2; paint(); }
    });
    document.body.appendChild(ov);
    paint();
    ov.querySelector('#rp-elo-close').onclick = rpEloClose;
    ov.querySelector('#rp-elo-reset').onclick = function () {
      if (!window.confirm(T('elo_reset_confirm'))) return;
      XQ.Elo.resetAll();
      paint();
    };
  }
  /* 第30轮 备份/恢复 (回放层 📦/📥): records + Elo + 设置 打包导出 / 按 id 合并导入 */
  function rpBackupAll() {
    var bak = XQ.Record.exportAll();
    var blob = new Blob([JSON.stringify(bak, null, 2)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'llm-chess-backup_' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function rpRestoreAll() {
    var input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,.pgn,application/json';
    input.onchange = function () {
      if (!input.files[0]) return;
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var bak = JSON.parse(fr.result);
          var r2 = XQ.Record.importAllBackup(bak, 'merge');
          warnBanner((XQ.I18N ? XQ.I18N.tArgs('backup_ok', { n: r2.added }) : '恢复完成'), null);
          rpFillPicker();
        } catch (eB) {
          warnBanner((XQ.I18N ? XQ.I18N.t('restore_fail') : '') + (eB && eB.message || eB), null);
        }
      };
      fr.readAsText(input.files[0]);
    };
    input.click();
  }
  function rpHelpClose() { modalClose('rp-help-overlay'); }
  function rpShowHelp() {
    /* 第42轮: 帮助层自述「再次按下或点击遮罩关闭」(rp_hk_help 双语文案), 但原实现遇到已存在就 return —
       再按 ? 是空操作, 用户会以为按键失灵。改为开关, 与自己的帮助文案一致。
       第43轮: 该层挂在 document.body 上 (不在回放层内), 却同样没有 Esc 出口与对话语义 — Esc 会关掉下层
       回放层而把它留在主界面上; 关闭走内联 remove() 也不归还焦点。现与 Elo 天梯统一走模态出口。 */
    var ex = document.getElementById('rp-help-overlay');
    if (ex) { rpHelpClose(); return; }
    var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
    /* 第44轮 a11y: 帮助表是「按键 → 行为」的对照表, 首列是行标题而非普通单元格 —
       用 th[scope=row] 让读屏把按键与行为关联起来 (原为 <td>, 读屏只报一串无归属的文本)。样式保持原观感 (左对齐/常规字重)。 */
    var row = function (keys, label) { return '<tr><th scope="row" style="text-align:left;font-weight:normal;padding:0">' + keys + '</th><td>' + label + '</td></tr>'; };
    var html = '<div id="rp-help-overlay" role="dialog" aria-modal="true" aria-labelledby="rp-help-title" style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:300;display:flex;align-items:center;justify-content:center">'
      + '<div style="background:#2a1a0c;border:1px solid #7a5a2a;border-radius:14px;padding:20px 24px;max-width:520px;color:#f0e0c0;box-shadow:0 8px 32px rgba(0,0,0,.7)">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><b id="rp-help-title" style="color:#f0d9a0;font-size:18px">' + T('rp_help_title_h') + '</b>'
      + '<button id="rp-help-close" class="btn" data-i18n-aria="overlay_close" aria-label="' + T('overlay_close') + '" style="background:#c0392b">✕</button></div>'
      + '<table style="width:100%;font-size:13px;line-height:2">'
      + row('<kbd>←</kbd> / <kbd>→</kbd>', T('rp_hk_prev_next'))
      + row('<kbd>Home</kbd> / <kbd>End</kbd>', T('rp_hk_home_end'))
      + row('<kbd>Space</kbd> / <kbd>0</kbd>', T('rp_hk_space'))
      + row('<kbd>L</kbd>', T('rp_hk_loop'))
      + row('<kbd>F</kbd>', T('rp_hk_full'))
      + row('<kbd>1</kbd>~<kbd>7</kbd>', T('rp_hk_speeds'))
      + row('<kbd>[</kbd> / <kbd>]</kbd>', T('rp_hk_skip5') + ' (v3.9a)')
      + row('<kbd>C</kbd> / <kbd>Shift+C</kbd>', T('rp_hk_capture') + ' (v3.9.2)')
      + row('<kbd>B</kbd>', T('rp_hk_bm'))
      + row('<kbd>N</kbd> / <kbd>P</kbd>', T('rp_hk_bm_go'))
      + row('<kbd>' + T('rp_hk_wheel_label') + '</kbd>', T('rp_hk_wheel'))   // 第30轮: 去掉按首词猜语言的 hack
      + row('<kbd>?</kbd> / <kbd>/</kbd>', T('rp_hk_help'))
      + row('<kbd>Esc</kbd>', T('rp_hk_esc'))
      + '</table>'
      + '<div style="margin-top:12px;padding-top:10px;border-top:1px dashed rgba(122,90,42,.4);font-size:12px;color:#c4a56e">' + T('rp_hk_tips') + '<br>' + T('rp_hk_main') + '</div>'
      + '</div></div>';
    var d = document.createElement('div');
    d.innerHTML = html;
    var ov = d.firstChild;
    modalMarkOpen('rp-help-overlay', ov);
    document.body.appendChild(ov);
    ov.querySelector('#rp-help-close').onclick = rpHelpClose;
  }
  function rpHeadSideStats() {
    var rec = rpSession.record;
    var rT = 0, rN = 0, bT = 0, bN = 0;
    for (var i = 0; i < rec.moves.length; i++) {
      var m = rec.moves[i];
      if (m.side === 'red') { rN++; rT += (m.timeMs || 0); }
      else { bN++; bT += (m.timeMs || 0); }
    }
    var TA = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return k; };
    var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
    return '<br><span style="color:#e74c3c">🔴 ' + T('rp_red_short') + ' ' + TA('rp_moves_secs', { n: rN, s: Math.round(rT / 1000) }) + '</span> · <span style="color:#3498db">⚫ ' + T('rp_black_short') + ' ' + TA('rp_moves_secs', { n: bN, s: Math.round(bT / 1000) }) + '</span> · ' + TA('rp_avg_per_move', { s: Math.round((rT + bT) / Math.max(1, rec.moves.length) / 1000 * 10) / 10 });
  }
  /* 第45轮 a11y: #rp-head 与 #rp-info 都是「每步整块重建 innerHTML」的容器, 而两者内部各有一个原生可聚焦的
     链接 (#rp-jump-max 跳到最长思考那一手 / #rp-note-edit 编辑备注)。焦点落在链接上时按 ←/→ 步进或自动播放,
     节点当场被摘掉 → 焦点静默掉回 <body>, 下一次 Tab 从页首重来 (读屏用户直接迷路)。
     与第44轮回放走法列表同一处理: 重建前记住被聚焦元素的 id, 重建后按 id 找回同一元素。 */
  function rpRepaintFocus(container, html) {
    var ae = document.activeElement;
    var keepId = (ae && ae.id && container.contains(ae)) ? ae.id : null;
    container.innerHTML = html;
    if (!keepId) return;
    var back = document.getElementById(keepId);
    if (back && container.contains(back) && typeof back.focus === 'function') {
      try { back.focus({ preventScroll: true }); } catch (eRF) { back.focus(); }
    }
  }
  function rpPaintHead() {
    var s = rpSession.summary;
    var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; }, TA = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return k; };
    var resTag = { repetition: T('rp_res_repetition'), natural: T('rp_res_natural'), draw: T('rp_res_draw'), agree: T('rp_res_agree') };
    var tag = s.winner === 'red' ? T('rp_tag_red_win') : s.winner === 'black' ? T('rp_tag_black_win') : (s.result ? (resTag[s.result] || s.result) : T('rp_tag_ongoing'));
    var headHtml = '<b>' + esc2(s.stamp) + '</b> · '
      + esc2(s.red) + (s.redModel ? ' <span style="color:#c4a56e;font-size:11px">[' + esc2(s.redModel) + ']</span>' : '')
      + (s.redModels && s.redModels.length ? ' <span style="color:#ffd76a;font-size:11px">[' + esc2((XQ.I18N ? XQ.I18N.tArgs('rp_committee_tag', { n: s.redModels.join(' + ') }) : s.redModels.join(' + '))) + ']</span>' : '')   // 第31轮: 委员会阵容
      + ' <span style="color:#7a5a2a">vs</span> '
      + esc2(s.black) + (s.blackModel ? ' <span style="color:#c4a56e;font-size:11px">[' + esc2(s.blackModel) + ']</span>' : '')
      + (s.blackModels && s.blackModels.length ? ' <span style="color:#ffd76a;font-size:11px">[' + esc2((XQ.I18N ? XQ.I18N.tArgs('rp_committee_tag', { n: s.blackModels.join(' + ') }) : s.blackModels.join(' + '))) + ']</span>' : '')   // 第31轮: 委员会阵容
      + ' ' + TA('rp_head_plies', { n: s.plies }) + ' ' + tag
      + (s.durationMs ? ' · ' + TA('rp_total_time', { s: Math.round(s.durationMs / 1000) }) : '')
      + rpHeadSideStats()
      + rpHeadProgress()
      + rpHeadMaterial()
      + rpHeadMaxTime()
      + ((rpSession.record && rpSession.record.note) ? '<div style="color:#c4a56e;font-size:11px;margin-top:3px;word-break:break-all">' + T('rp_note') + ' ' + esc2(String(rpSession.record.note).slice(0, 240))
        + ' <a href="javascript:void(0)" id="rp-note-edit" style="color:#e0a030">' + T('rp_note_edit') + '</a></div>' : '');   // 第30轮: 备注可编辑
    rpRepaintFocus(rpEl.head, headHtml);
  }
  var rpNextTarget = null;
  function rpPaintBoard(st, animate) {
    var board = rpEl.board;
    var flip = document.documentElement.dataset.flip === '1';   // 第36轮: 回放盘面跟随主界面翻转
    rpNextTarget = null;
    if (rpSession && st.idx < st.total) {
      var nxt = rpSession.record.moves[st.idx];
      if (nxt && nxt.to) rpNextTarget = XQ.Move.parseSq(nxt.to);
    }
    Array.prototype.slice.call(board.querySelectorAll('.cell')).forEach(function (c) { c.remove(); });
    var last = st.lastMove;
    for (var y = 0; y < 10; y++) {
      for (var x = 0; x < 9; x++) {
        var c = document.createElement('div');
        c.className = 'cell';
        if (flip) { c.style.gridRowStart = (9 - y) + 1; c.style.gridColumnStart = (8 - x) + 1; } else { c.style.gridRowStart = ''; c.style.gridColumnStart = ''; }   // 第36轮: 翻转摆位
        var p = st.cells[y][x];
        /* 第46轮 a11y: 回放盘面沿用第45轮主盘面的口径 — 格子补 role=img 才让 aria-label 生效
           (无角色 <div> 的隐式 generic 角色 Name From 为 prohibited, 标签会被读屏按规范忽略),
           名字是「坐标 + 格上棋子」(坐标语言中立, 子字随 xq_pieces 偏好)。此前回放盘面 90 格
           既无角色也无标签, 读屏完全无法探索回放局面。 */
        c.setAttribute('role', 'img');
        try { c.setAttribute('aria-label', XQ.Move.sqName({ x: x, y: y }) + (p ? ' ' + pg(p.color, p.type) : '')); } catch (eRA) {}
        if (p) {
          var pe = document.createElement('div');
          pe.className = 'piece ' + p.color;
          pe.textContent = pg(p.color, p.type);   // 第41轮: 回放盘面此前恒用汉字 — Letters 偏好下与主盘面不一致
          var isLanding = last && x === last.to.x && y === last.to.y;
          if (isLanding && !animate) pe.classList.add('just-placed');   // 手动步进的落地 pop; 自动播放走真滑动 (第25轮重制, 与主棋盘同款关键帧)
          c.appendChild(pe);
          if (animate && isLanding) {
            var dx = (last.from.x - last.to.x) * 100, dy = (last.from.y - last.to.y) * 100;
            if (dx || dy) {
              var dist = Math.max(Math.abs(last.from.x - last.to.x), Math.abs(last.from.y - last.to.y));
              pe.style.setProperty('--dx', dx + '%');
              pe.style.setProperty('--dy', dy + '%');
              pe.style.setProperty('--slide-dur', (0.2 + Math.min(dist, 8) * 0.022).toFixed(3) + 's');
              pe.classList.add('slide-in');
              c.classList.add('sliding-cell');
              pe.addEventListener('animationend', function () {
                this.classList.remove('slide-in');
                this.parentNode.classList.remove('sliding-cell');
              }, { once: true });
            }
            if (last.captured) {
              var gh = document.createElement('div');
              gh.className = 'piece ghost-out ' + last.captured.color;
              gh.textContent = pg(last.captured.color, last.captured.type);   // 第41轮: 回放吃子幽灵同上
              c.insertBefore(gh, pe);
            }
          }
        }
        if (last) {
          if (x === last.from.x && y === last.from.y) c.classList.add('last-start');
          if (x === last.to.x && y === last.to.y) c.classList.add('last-move');
        }
        if (st.check && p && p.type === 'king' && p.color === st.turn) c.classList.add('in-check');
        if (rpNextTarget && x === rpNextTarget.x && y === rpNextTarget.y) c.classList.add('next-target');
        /* 第36轮: 翻转时按显示位置摆放 (池序仍按盘面, 由 dataset 映射) */
        if (flip) {
          var dx0 = 8 - x, dy0 = 9 - y;
          board.appendChild(c);
          c.style.gridRowStart = dy0 + 1;
          c.style.gridColumnStart = dx0 + 1;
        } else {
          board.appendChild(c);
        }
      }
    }
    if (flip) {
      var rc = document.getElementById('rp-col-labels'), rr = document.getElementById('rp-row-labels');
      if (rc) 'a,b,c,d,e,f,g,h,i'.split(',').forEach(function (ch, i2) { if (rc.children[i2]) rc.children[i2].textContent = 'abcdefghi'[7 - i2]; });
      if (rr) '10,9,8,7,6,5,4,3,2,1'.split(',').forEach(function (ch, i2) { if (rr.children[i2]) rr.children[i2].textContent = String(i2 + 1); });
    } else {
      var rc2 = document.getElementById('rp-col-labels'), rr2 = document.getElementById('rp-row-labels');
      if (rc2) 'a,b,c,d,e,f,g,h,i'.split(',').forEach(function (ch, i2) { if (rc2.children[i2]) rc2.children[i2].textContent = 'abcdefghi'[i2]; });
      if (rr2) '10,9,8,7,6,5,4,3,2,1'.split(',').forEach(function (ch, i2) { if (rr2.children[i2]) rr2.children[i2].textContent = String(10 - i2); });
    }
    if (animate && last) { playDrop(!!last.captured); if (st.check) playCheck(); }
  }
  function rpPaintInfo(st) {
    var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; }, TA = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return k; };
    var e = st.entry;
    var html = '';
    if (!e) {
      var delaySec = rpCtrl ? Math.round(rpCtrl.delay() / 1000) : 10;
      html = '<b style="font-size:15px">' + T('rp_initial') + '</b> · ' + TA('rp_initial_hint', { n: st.total, s: delaySec });
    } else {
      var opp = e.side === 'red' ? 'black' : 'red';
      var sideTag = e.side === 'red' ? T('rp_side_red_full') : T('rp_side_black_full');
      var model = e.side === 'red' ? rpSession.summary.redModel : rpSession.summary.blackModel;
      var pc = (XQ.Piece.CHARS[e.side] && XQ.Piece.CHARS[e.side][e.piece]) ? pg(e.side, e.piece) : e.piece;   // 第41轮: 信息面板子名随显示偏好
      var capTxt = e.captured ? TA('rp_capture', { p: (XQ.Piece.CHARS[opp] && XQ.Piece.CHARS[opp][e.captured]) ? pg(opp, e.captured) : e.captured }) : '';
      html += '<div style="font-size:15px"><b>' + TA('rp_move_of', { n: st.idx, t: st.total }) + '</b> · ' + sideTag
        + (model ? ' <span style="color:#c4a56e;font-size:11px">[' + esc2(model) + ']</span>' : '') + '</div>';
      html += '<div style="font-size:18px;margin:4px 0"><b style="color:#f0d9a0">' + esc2(pc) + '</b> <span style="color:#e8d5ae">' + esc2(e.from) + ' → ' + esc2(e.to) + '</span><span style="color:#e67e22">' + esc2(capTxt) + '</span></div>';
      /* v1.7.6 疑误着法提示: 静态交换推演此手净丢子 */
      if ((st.risk || 0) >= ((XQ.Replay && XQ.Replay.RISK_MARK) || 3)) {
        html += '<div style="color:#e67e22;font-size:12px">' + TA('rp_suspect', { s: st.risk.toFixed(1) }) + '</div>';
      }
      /* v1.7.9 一步效果: 将/杀/困 标注 */
      if (st.mark === '杀') html += '<div style="color:#ff5050;font-size:13px;font-weight:bold">' + T('rp_mate') + '</div>';
      else if (st.mark === '困') html += '<div style="color:#ff5050;font-size:13px;font-weight:bold">' + T('rp_stuck') + '</div>';
      else if (st.mark === '将') html += '<div style="color:#e0a030;font-size:12px">' + T('rp_check_now') + '</div>';
      if (e.summary) html += '<div>🧠 <b>' + T('rp_ai_summary') + '</b> ' + esc2(e.summary) + '</div>';
      else html += '<div>🧠 <b>' + T('rp_ai_summary') + '</b> <span style="color:#c4a56e">' + T('rp_fallback_summary') + '</span></div>';   // v3.4: 兑底手回放不空白
      if (e.plan) html += '<div style="color:#c4a56e;font-size:12px">📋 ' + T('rp_plan') + ' ' + esc2(e.plan) + '</div>';
      if (e.evaluation) html += '<div>⚖️ <b>' + T('rp_eval_label') + '</b> ' + esc2(e.evaluation) + '</div>';
      html += '<div>🎯 <b>' + T('rp_confidence') + '</b> ' + (typeof e.confidence === 'number' ? e.confidence : '—')
        + ' &nbsp; ' + T('rp_think_time') + ' <b>' + (e.timeMs ? (e.timeMs / 1000).toFixed(1) + 's' : '—') + '</b></div>';
      if (e.candidates && e.candidates.length) {
        html += '<div style="color:#c4a56e;font-size:12px">' + T('rp_candidates') + ' '
          + e.candidates.map(function (c) { return '<code style="background:rgba(255,255,255,.06);padding:1px 5px;border-radius:4px">' + esc2(c.move) + '(' + esc2(c.score || '?') + ')</code>'; }).join(' ')
          + '</div>';
      }
      if (e.votes && e.votes.length) {   // 第34轮: 会诊投票明细表 (逐选民落点/信心/失败)
        /* 第44轮 a11y: 表头行原为 <td> → 读屏无法把「信心 0.8」关联到「信心」列。改 th[scope=col]
           (样式显式保持原观感: 左对齐 + 常规字重, 避免 UA 默认的居中/加粗改变版式)。 */
        var vth = 'padding:2px 6px;text-align:left;font-weight:normal';
        html += '<table style="width:100%;font-size:11px;margin-top:5px;border-collapse:collapse;background:rgba(0,0,0,.2);border-radius:6px">'
          + '<tr style="color:#c4a56e"><th scope="col" style="' + vth + '">' + T('votes_model') + '</th><th scope="col" style="' + vth + '">' + T('votes_to') + '</th><th scope="col" style="' + vth + '">' + T('votes_conf') + '</th></tr>';
        e.votes.forEach(function (v) {
          html += v.ok
            ? '<tr><td style="padding:2px 6px">' + esc2(v.model) + '</td><td style="padding:2px 6px;color:#f0d9a0">' + esc2(v.to) + '</td><td style="padding:2px 6px">' + (v.conf != null ? v.conf : '—') + '</td></tr>'
            : '<tr><td style="padding:2px 6px">' + esc2(v.model) + '</td><td colspan="2" style="padding:2px 6px;color:#ff8a7a">' + T('votes_fail') + '</td></tr>';
        });
        html += '</table>';
      }
    }
    if (st.over) {
      var t = st.winner === 'red' ? T('status_win_red') : st.winner === 'black' ? T('status_win_black') : T('status_draw');
      html = '<div style="color:#f1c40f;font-weight:bold;font-size:16px;margin-bottom:6px">' + t + '</div>' + html;
    }
    if (st.skippedCount > 0) html += '<div style="color:#e67e22;font-size:11px;margin-top:4px">' + TA('rp_skipped', { n: st.skippedCount }) + '</div>';
    /* v1.6.2 ETA: 剩 N 手 ≈ X秒 @ Yx */
    if (rpCtrl && st.idx < st.total && !st.over) {
      var delay = rpCtrl.delay() / 1000, remain = st.total - st.idx;
      html += '<div style="color:#c4a56e;font-size:12px;margin-top:4px">' + TA('rp_eta', { n: remain, s: Math.round(remain * delay), x: rpCtrl.speed() }) + '</div>';
    }
    /* v1.6.2 下着预览: 下一手方色/棋子/坐标/AI分析 */
    if (st.idx < st.total && !st.over) {
      var nxt = rpSession.record.moves[st.idx];
      var nTag = nxt.side === 'red' ? '🔴' : '⚫';
      var nPc = (XQ.Piece.CHARS[nxt.side] && XQ.Piece.CHARS[nxt.side][nxt.piece]) ? pg(nxt.side, nxt.piece) : nxt.piece;   // 第41轮: 下着预览同上
      html += '<div style="font-size:12px;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(122,90,42,.4)">↪ <b style="color:#e0a030">' + T('rp_next_move') + '</b> ' + nTag + ' <b style="color:#f0d9a0">' + esc2(nPc) + '</b> <span style="color:#e8d5ae">' + esc2(nxt.from) + ' → ' + esc2(nxt.to) + '</span>' + (nxt.summary ? ' <span style="color:#c4a56e">· ' + esc2(nxt.summary) + '</span>' : '') + '</div>';
    }
    rpRepaintFocus(rpEl.info, html);
    var ne = document.getElementById('rp-note-edit');
    if (ne) ne.onclick = function () {
      var v = window.prompt(T('rp_note_edit'), (rpSession.record.note || '').slice(0, 240));
      if (v == null) return;
      rpSession.record.note = v.slice(0, 240);
      XQ.Record.save(rpSession.record);   // 备注落谱
      rpPaintInfo(rpSession.state());
    };
    rpEl.range.max = st.total;
    rpEl.range.value = st.idx;
  }
  /* v1.6.1 评估条: 解析 entry.evaluation → 数字 → 红/黑横条
     v3.9: 解析逻辑迁移至 replay/replay.js XQ.Replay.parseEval (node 可测 + 方向判定修复: 只在含胜负词时定方向, 子力词不动方向) */
  function rpParseEval(s) {
    return (XQ.Replay && XQ.Replay.parseEval) ? XQ.Replay.parseEval(s) : NaN;
  }
  function rpEvalToPct(v) {
    if (!isFinite(v)) return 50;
    /* -3..+3 → 5..95 (留边距), clamp */
    return Math.max(5, Math.min(95, 50 + v / 6 * 50));
  }
  function rpPaintEval(st) {
    if (!rpEl || !rpEl.evalbar) return;
    var e = st.entry;
    var v = e ? rpParseEval(e.evaluation) : NaN;
    var pct = rpEvalToPct(v);
    rpEl.ebRed.style.width = pct + '%';
    rpEl.ebBlack.style.width = (100 - pct) + '%';
    if (st.over) {
      var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
      rpEl.ebVal.textContent = st.winner === 'red' ? T('rp_tag_red_win') : st.winner === 'black' ? T('rp_tag_black_win') : T('status_draw');
      rpEl.ebVal.style.color = '#f1c40f';
      rpEl.ebRed.style.width = st.winner === 'red' ? '100%' : '0%';
      rpEl.ebBlack.style.width = st.winner === 'black' ? '100%' : '0%';
    } else {
      rpEl.ebVal.textContent = isFinite(v) ? (v > 0 ? '+' + v.toFixed(1) : v.toFixed(1)) : (XQ.I18N ? XQ.I18N.t('rp_even') : '均势');
      rpEl.ebVal.style.color = '#f0d9a0';
    }
  }
  /* v1.6.1 走法列表: AI 简短分析作为主导航 (点击跳转), 当前手高亮, 自动滚入视区 */
  function rpPaintMoveList() {
    if (!rpEl || !rpEl.movelist || !rpSession) return;
    var rec = rpSession.record;
    var cur = rpSession.idx();
    var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; }, TA = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return k; };
    /* 第44轮 a11y: 本函数整体重建 innerHTML — 焦点若正落在某个 <li> 上 (键盘导航走法列表), 该节点会被摘掉,
       焦点静默掉回 <body> (下一次 Tab 从页首重新开始, 读屏用户直接迷路)。重建前记住 ply, 重建后把焦点还给同一手。 */
    var ae = document.activeElement;
    var keepPly = (ae && ae.dataset && ae.dataset.ply && rpEl.movelist.contains(ae)) ? ae.dataset.ply : null;
    var risks = rpSession.risks ? rpSession.risks() : {};   // v1.7.6: 疑误着法静态风险分
    var marks = rpSession.marks ? rpSession.marks() : {};   // v1.7.9: 将/杀/困 一步效果标注
    var riskMark = (XQ.Replay && XQ.Replay.RISK_MARK) || 3;
    var q = ((rpEl.movesFilter && rpEl.movesFilter.value) || '').toLowerCase().trim();
    var html = '';
    var visible = 0;
    for (var i = 0; i < rec.moves.length; i++) {
      var m = rec.moves[i];
      var label = m.summary || m.name || (m.from + '→' + m.to);
      if (q && (label + ' ' + m.from + m.to + ' #' + m.n).toLowerCase().indexOf(q) < 0) continue;
      var cls = (i + 1 === cur) ? ' class="active"' : '';
      /* 第46轮 a11y: 条目 tabindex=0 且 Enter/Space 真能跳局面 (第37轮接的), 但隐式角色是 listitem —
         读屏只念「列表项」, 从不提示可激活; 第45轮给主界面走法条目补了 role=button, 这一处 (回放层走法表)
         漏了。当前手另补 aria-current, 读屏步进时才知道自己在哪一手 (原实现只有 .active 的视觉底色)。 */
      var curAttr = (i + 1 === cur) ? ' aria-current="true"' : '';
      var sideTag = m.side === 'red' ? '🔴' : '⚫';
      var bmHtml = rpBookmarks.indexOf(i + 1) >= 0 ? '<span title="' + esc2(T('rp_bm_title')) + '" style="color:#ffd54a">🔖</span> ' : '';   // v1.0.daily 书签标记
      var risky = (risks[i + 1] || 0) >= riskMark ? '<span title="' + esc2(TA('rp_title_risky', { s: (risks[i + 1]).toFixed(1) })) + '" style="color:#e67e22">⚠</span> ' : '';
      var mk = marks[i + 1];   // v1.7.9: 将/杀/困 彩色标记 (杀 > 风险 > 将 > 标签)
      /* 第44轮 i18n: mk 是 core/judge.js 的语言中立数据标记 ('杀'/'困'/'将'), 判定必须留在字面量上;
         但**展示文本**此前把同一批汉字写死 → EN 界面下走法列表显示中文。现按字典取词 (zh 仍为一字, EN 为 Mate/Stuck/Check)。 */
      var mkHtml = mk === '杀' ? '<span title="' + esc2(T('rp_title_mate')) + '" style="color:#ff5050;font-weight:bold">' + esc2(T('rp_mk_mate')) + '</span> '
        : mk === '困' ? '<span title="' + esc2(T('rp_title_stuck')) + '" style="color:#ff5050">' + esc2(T('rp_mk_stuck')) + '</span> '
        : mk === '将' ? '<span title="' + esc2(T('rp_title_check')) + '" style="color:#e0a030">' + esc2(T('rp_mk_check')) + '</span> ' : '';
      html += '<li' + cls + ' data-ply="' + (i + 1) + '" tabindex="0" role="button"' + curAttr + '><span class="rp-ml-side">' + sideTag + '</span><b>' + m.n + '</b><span style="flex:1">' + bmHtml + mkHtml + risky + esc2(label) + '</span></li>';
      visible++;
    }
    if (html) rpEl.movelist.innerHTML = html;
    else if (!rec.moves || !rec.moves.length) rpEl.movelist.innerHTML = '<li style="color:#7a5a2a;justify-content:center">' + TA('rp_moves_unit', { n: 0 }) + '</li>';   // v1.0.daily: 空谱≠过滤无匹配 (0手 提示)
    else rpEl.movelist.innerHTML = '<li style="color:#7a5a2a;justify-content:center">' + T('rp_no_match') + '</li>';
    if (rpEl.movesFilter) rpEl.movesFilter.title = visible + ' / ' + rec.moves.length;   // 第36轮: 过滤匹配计数
    if (visible > 0) { var act = rpEl.movelist.querySelector('li.active'); if (act) act.scrollIntoView({ block: 'nearest' }); }
    /* 第44轮: 焦点归还 — 只在重建前焦点确实在本列表内时才接管, 否则会抢走过滤框/跳转框里的光标 */
    if (keepPly != null) {
      var back = rpEl.movelist.querySelector('li[data-ply="' + keepPly + '"]');
      if (back && typeof back.focus === 'function') { try { back.focus({ preventScroll: true }); } catch (eFL) { back.focus(); } }
    }
  }
  /* v1.6.1 边界禁用: 在起点 ⏮◀ 灰, 在终点 ⏭▶| 灰 (循环开启时 ▶ 在终点可继续) */
  function rpPaintButtons(st) {
    if (!rpEl) return;
    /* 第47轮 a11y: 必须在改 disabled **之前**取焦点宿主 — 浏览器在 `el.disabled = true` 赋值那一刻就把
       聚焦中的元素移出焦点序 (实测赋值后 activeElement 已是 body), 之后再读就找不到「谁被禁用了」。 */
    var act0 = document.activeElement;
    var atStart = st.idx === 0, atEnd = st.idx === st.total;
    rpEl.btnStart.disabled = atStart;
    rpEl.btnPrev.disabled = atStart;
    rpEl.btnNext.disabled = atEnd;
    rpEl.btnEnd.disabled = atEnd;
    rpEl.toggle.disabled = atEnd && !(rpCtrl && rpCtrl.isLooping());
    /* 第47轮 a11y: 禁用「正在聚焦」的控件会让焦点静默掉回 body (下一次 Tab 从层首重来)。键盘用户 Tab 到 ◀
       后一路退到起点, 或 Tab 到 ▶| 后按 End 就会命中。若焦点落在刚被禁用的传输按钮上, 交还给同组第一个仍可用的
       按钮 (都没有则落到进度条, 它始终可用)。 */
    if (act0 && /^(rp-start|rp-prev|rp-next|rp-end|rp-toggle)$/.test(act0.id || '') && act0.disabled) {
      var cands = [rpEl.btnPrev, rpEl.btnNext, rpEl.toggle, rpEl.btnStart, rpEl.btnEnd];
      for (var i = 0; i < cands.length; i++) {
        if (cands[i] && !cands[i].disabled) {
          try { cands[i].focus({ preventScroll: true }); } catch (eBF) { try { cands[i].focus(); } catch (eBF2) {} }
          return;
        }
      }
      if (rpEl.range && typeof rpEl.range.focus === 'function') { try { rpEl.range.focus({ preventScroll: true }); } catch (eBF3) { rpEl.range.focus(); } }
    }
  }
  /* v1.6.1 续看进度: 每个棋谱保留最近 ply, 重新打开自动跳转 */
  var rpSaveLock = 0;
  function rpSavePos(st) {
    if (!rpSession) return;
    var now = Date.now();
    if (now - rpSaveLock < 100) return;
    rpSaveLock = now;
    try { localStorage.setItem('xq_replay_pos_' + rpSession.record.id, String(st.idx)); } catch (e) {}
  }
  /* v2.4 终局一键回放本局: 结算卡 🎬 按钮直达 (Record 已在终局时落 localStorage, 直接驱劢回放) */
  function rpWatchRecord() {
    if (!currentRecord || !currentRecord.moves || !currentRecord.moves.length) return;
    rpEnsure();
    /* 第42轮 a11y: 终局卡「🎬 回放本局」此前绕过 rpOpen 的焦点管理 — 层已遮蔽全屏而焦点仍留在终局卡按钮上,
       且 rpOpener 为空 → 关闭回放后焦点无处可还 (读屏用户被丢回背景)。与 rpOpen 同口径: 记录打开者 + 焦点入层。 */
    rpOpener = document.activeElement && rpEl.ov.contains(document.activeElement) ? null : document.activeElement;
    rpEl.ov.style.display = 'block';
    rpLockScroll(true);
    try { rpEl.pick.focus({ preventScroll: true }); } catch (eF6) { try { rpEl.pick.focus(); } catch (eF8) {} }
    try { history.replaceState(null, '', '#rp=' + encodeURIComponent('ls:' + currentRecord.id)); } catch (eH4) {}   // v3.8: 终局回放本局同样写深链
    rpStart(currentRecord);
  }
  function rpLockScroll(on) {
    try { document.body.style.overflow = on ? 'hidden' : ''; } catch (eL) {}   // v1.0.daily: 回放打开时锁背景滚动 (移动端双滚动条/误触)
  }
  function rpOpen() {
    rpEnsure();
    rpOpener = document.activeElement && rpEl.ov.contains(document.activeElement) ? null : document.activeElement;   // 第27轮 a11y: 记录打开者供关闭归还
    rpEl.ov.style.display = 'block';
    rpLockScroll(true);
    try { rpEl.pick.focus({ preventScroll: true }); } catch (eF6) { rpEl.pick.focus(); }   // 第27轮 a11y: 焦点入层 (选择棋谱是回放首要操作; display:none→block 无过渡, 同步 focus 生效)
    rpFillPicker().then(function () {
      if (!rpEl.pick.options.length || rpEl.pick.options[0].value === '') {
        rpEl.info.innerHTML = '<span style="color:#e67e22">' + (XQ.I18N ? XQ.I18N.t('rp_pick_empty') : '暂无本地棋谱 — 完成一局对战后自动保存, 或用 载入棋谱 导入 JSON') + '</span>';   // v1.0.daily i18n
        return;
      }
      var hpick = '';
      try { var mh2 = /[#&]rp=([^&]+)/.exec(location.hash || ''); if (mh2) hpick = decodeURIComponent(mh2[1]); } catch (eH2) {}   // v3.8: 解析深链
      var last = null;
      try { last = localStorage.getItem(RP_LAST_KEY); } catch (e) {}
      if (hpick && rpEl.pick.querySelector('option[value="' + hpick + '"]')) rpEl.pick.value = hpick;   // v3.8: 深链指定对象优先于上次选择
      else if (last && rpEl.pick.querySelector('option[value="' + last + '"]')) rpEl.pick.value = last;
      if (!rpEl.pick.value || rpEl.pick.selectedIndex < 0) rpEl.pick.selectedIndex = 0;
      rpEl.pick.onchange = rpPickLoad;
      rpPickLoad();
    });
  }
  function rpClose() {
    if (rpCtrl) rpCtrl.dispose();
    rpEl.ov.style.display = 'none';
    rpLockScroll(false);
    if (rpOpener) { try { rpOpener.focus({ preventScroll: true }); } catch (eF7) { try { rpOpener.focus(); } catch (eF8) {} } }   // 第27轮 a11y: 焦点归还打开者
    rpOpener = null;
    try { history.replaceState(null, '', location.pathname + location.search); } catch (eH3) {}   // v3.8: 退出回放清除深链
    refresh();
  }

  // 暴露调试句柄
  window.XQApp = {
    engine: function () { return engine; },
    restart: restartGame,
    saveAISettings: saveAISettings,
    closeAISettings: closeAISettings,   // 第23轮: 取消按钮 inline onclick 走统一出口
    isRelay: function () { return relayAvailable; },
    replayOpen: rpOpen,
    replayWatchRecord: rpWatchRecord   // v2.4 终局回放本局 (调试句柄)
  };
})();
