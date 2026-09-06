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
  function masterBus() {
    if (!mBus) {
      mBus = actx.createGain(); mBus.gain.value = 0.9;
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
  var thinkStat = { red: { total: 0, moves: 0 }, black: { total: 0, moves: 0 } };
  var decisionLog = { red: [], black: [] };   // v1.3 决策日志 (漏声明会炸 startRecord → 对局永不启动) // 思考耗时/手数
  var thinkStart = { red: 0, black: 0 };     // 当前思考开始时刻
  // ═══ v1.7 HUD 状态 ═══
  var capturedBy = { red: [], black: [] };   // 各方吃掉的对方子力字符
  var evalHist = { red: [], black: [] };     // 各方自评走势 (数字序列)
  var checkPulseTimer = null, lastBadgeTimer = null, thinkWarned = false;
  var gameId = 0;              // v1.0.daily 对局世代: startRecord 自增; 迟到的 agent/兑底回调按世代作废 (重开不串局)
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
    onCellClick: onCellClick
  };

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
    return decisionLog[side].map(function (e) {
      return '#' + e.n + ' ' + e.name + '\n  ' + e.summary
        + (e.evaluation ? ' | ' + e.evaluation : '')
        + (e.confidence != null ? ' | 信' + e.confidence : '')
        + (e.secs ? ' | ' + e.secs + 's' : '');
    }).join('\n');
  }
  /* v1.0.3 提示词等级徽章与决策面板 */
  function levelCN(s) { return s === 'none' ? '无' : s === 'low' ? '低' : s === 'high' ? '高' : '中'; }
  function levelClass(s) { return s === 'none' ? 'st-none' : s === 'low' ? 'st-low' : s === 'high' ? 'st-high' : 'st-mid'; }
  /* v1.7.2 模型信息卡: 提供商/模型全名/总思考时间/_tokens — 放在思考内容上方的浮卡里 */
  function modelCardHTML(side, holder) {
    var h = holder || agents[side];
    var st = thinkStat[side] || { total: 0 };
    var tok = '';
    if (h && h.agent && h.agent.usage) {
      var u = h.agent.usage();
      if (u && u.total) tok = ' · ' + (u.total > 999 ? (u.total / 1000).toFixed(1) + 'k' : u.total) + ' tok';
      if (u && u.cacheHit && u.prompt) tok += ' · 缓存' + Math.round(100 * u.cacheHit / u.prompt) + '%';   // v2.9: 缓存命中率上卡 (provider 上报才显示)
      if (u && u.blocked) tok += ' · 拦截' + u.blocked;   // v3.2: 系统拦截次数上卡
    }
    var model = (h && h.model) || (currentRecord && currentRecord[side] && currentRecord[side].model) || '';
    var prov = (h && h.provider) || (currentRecord && currentRecord[side] && currentRecord[side].provider) || '';
    if (!model) return '';
    return '<div class="im-model">' + esc2((prov ? prov + ' · ' : '') + model) + '</div>'
      + '<div class="im-stat">总思考 ' + (st.total || 0) + 's' + tok + '</div>';
  }
  function infoHTML(side, holder, evaluation) {
    var h = holder || agents[side];
    var badge = (h && h.quick ? '<span class="badge-quick">⚡快答</span> ' : '') + (h ? '<span class="badge-style ' + levelClass(h.style) + '">' + levelCN(h.style) + '</span>' : '');
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
  function decisionPanelOpts(side) {
    var log = decisionLog[side] || [];
    if (log.length && XQ.UI.decisionCards) {
      return { cards: XQ.UI.decisionCards(log.slice(-4), log.length), active: false };
    }
    return { text: logTextFor(side) || '等待对局开始…', active: false };
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
    var entry = {
      n: engine.ply(),
      name: XQ.Piece.CHARS[m.piece.color][m.piece.type] + '-' + XQ.Move.sqName(m.from) + '\u2192' + XQ.Move.sqName(m.to),
      summary: (meta && meta.summary) || '(无摘要)',
      plan: (meta && meta.plan) || '',
      evaluation: (meta && meta.evaluation) || '',
      confidence: (meta && typeof meta.confidence === 'number') ? meta.confidence : null,
      candidates: (meta && meta.candidates) || [],
      reasoning: cleanReason((meta && meta.reasoning) || ''),   // v1.5.5 中文过滤 + v1.5.10 清洗坐标扫描噪音, 卡片 💭 展开查看
      secs: secs
    };
    // v2.0 兑底透明化: 3 次重试后的兑底着法 (无 summary 且无 confidence) → 决策卡标訽, 观战者知悉这手不是模型自信决策
    if (entry.summary === '(无摘要)' && entry.confidence == null) {
      entry.summary = '兑底·安全着法';
      if (!entry.reasoning) entry.reasoning = '【兑底】前几次输出无效, 系统按静态评分选定此安全走法';
    }
    decisionLog[side].push(entry);
    if (decisionLog[side].length > 60) decisionLog[side].shift();
    var logText = logTextFor(side);
    XQ.UI.thinkPanel(side, {
      cards: XQ.UI.decisionCards ? XQ.UI.decisionCards(decisionLog[side].slice(-4), decisionLog[side].length) : null,
      text: XQ.UI.decisionCards ? undefined : logText,
      active: false,
      info: infoHTML(side, holder, entry.evaluation)
    });
    // 面板 stat: 总耗时·手数·token 用量 (不覆盖卡片模式, 只更新 stat)
    var tok = '';
    var h = agents[side];
    if (h && h.agent && h.agent.usage) {
      var u = h.agent.usage();
      if (u && u.total) tok = (u.total > 999 ? (u.total / 1000).toFixed(1) + 'k' : u.total) + 'tok';
    }
    thinkStat[side].lastSecs = secs;   // v1.5.5: 最近一手延迟 (面板 stat 实时显示)
    var statTxt = thinkStat[side].total + 's·' + thinkStat[side].moves + '手·' + (secs ? secs + 's/手' : '?') + (tok ? '·' + tok : '');
    XQ.UI.thinkPanel(side, { stat: statTxt });
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
    var fbBadge = entry.summary === '兑底·安全着法' ? ' <span style="color:#e67e22">⚠兜底</span>' : '';   // v2.0 兑底透明化
    XQ.UI.lastMoveBadge('<b>#' + engine.ply() + '</b> ' + (side === 'red' ? '🔴' : '⚫') + ' '
      + XQ.Piece.CHARS[side][m.piece.type] + ' <b>' + esc2(cn) + '</b> <span style="opacity:.65">' + esc2(XQ.Move.sqName(m.from) + '→' + XQ.Move.sqName(m.to)) + '</span>'
      + (m.captured ? ' <span style="color:#e67e22">✕' + XQ.Piece.CHARS[m.captured.color][m.captured.type] + '</span>' : '') + fbBadge);
    if (lastBadgeTimer) clearTimeout(lastBadgeTimer);
    lastBadgeTimer = setTimeout(function () { XQ.UI.lastMoveBadge(null); }, 4000);
    if (engine.inCheck(engine.turn()) && !engine.isOver()) {
      checkFlashUntil = Date.now() + 2500;
      warnBanner('⚠️ 将军！', side);
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
        warnBanner(repN >= 3 ? '⚠️ 已' + repN + '次重复局面 — 引擎已自动判和' : '⚠️ 局面第二次重复 — 再重复一次将自动判和, 优势方须变招', side);
      }
    }
    // v1.7.8 长将告警: 一方连续将军 4 手以上 → 横幅提示长将判负风险 (引擎 checkStreak)
    if (engine.checkStreak) {
      var csN = engine.checkStreak(side);
      if (csN >= 4 && csN > chWarnedN) {
        chWarnedN = csN;
        warnBanner('⚠️ ' + (side === 'red' ? '🔴 红方' : '⚫ 黑方') + '已连续将军 ' + csN + ' 手 — 长将判负风险, 需换攻', side);
      }
    }
    if (currentRecord) {
      XQ.Record.addMove(currentRecord, engine, m, secs * 1000);
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
        // v1.7 终局结算数据
        var eo = document.getElementById('eo-stats');
        if (eo) {
          var rAvg = thinkStat.red.moves ? (thinkStat.red.total / thinkStat.red.moves).toFixed(1) : '-';
          var bAvg = thinkStat.black.moves ? (thinkStat.black.total / thinkStat.black.moves).toFixed(1) : '-';
          var fmtT = function (x) { return x ? (x > 999 ? (x / 1000).toFixed(1) + 'k' : x) : '-'; };
          var tk = currentRecord.tokens || {};
          var cachePct = function (t2) { return t2 && t2.cacheHit && t2.prompt ? Math.round(100 * t2.cacheHit / t2.prompt) + '%' : '未上报'; };   // v3.4 终局卡缓存命中
          var blkCnt = function (t2) { return t2 && t2.blocked ? t2.blocked : 0; };   // v3.4 系统拦截计数
          eo.innerHTML = '共 <b>' + engine.ply() + '</b> 手 · 用时 <b>' + Math.round((Date.now() - startTime) / 1000) + 's</b>'
            + '<br>🔴 红方 均 <b>' + rAvg + 's</b>/手 · ' + fmtT(tk.red && tk.red.total) + ' tok · 吃 ' + capturedBy.red.length + ' 子 · 缓存 ' + cachePct(tk.red) + ' · 拦截 ' + blkCnt(tk.red)
            + '<br>⚫ 黑方 均 <b>' + bAvg + 's</b>/手 · ' + fmtT(tk.black && tk.black.total) + ' tok · 吃 ' + capturedBy.black.length + ' 子 · 缓存 ' + cachePct(tk.black) + ' · 拦截 ' + blkCnt(tk.black);
          // v2.4 终局一键回放本局 (对局→录像闭环, 免去回放选择器翻找; Record 已在上方落 localStorage)
          eo.insertAdjacentHTML('beforeend', '<div style="margin-top:8px"><button class="btn" id="eo-replay">🎬 回放本局</button></div>');
          var eob = eo.querySelector('#eo-replay');
          if (eob) eob.onclick = function () { rpWatchRecord(); };
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
  function kbMove(dx, dy) {
    if (!kbCursor) { kbCursor = { x: 4, y: 5 }; }   // 缺省落在棋盘中央
    kbCursor.x = Math.max(0, Math.min(8, kbCursor.x + dx));
    kbCursor.y = Math.max(0, Math.min(9, kbCursor.y + dy));
    refresh();
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
    thinkStart[side] = start;
    view.aiThinkingSide = side;
    view.aiRetries = view.aiRetries || {}; view.aiRetries[side] = 0;   // v2.5: 每手重试计数归零
    thinkWarned = false;
    if (thinkTimer) clearInterval(thinkTimer);
    var tick = function () {
      var s = Math.floor((Date.now() - start) / 1000);           // 当前思考时间 → 顶部状态条
      var g = Math.floor((Date.now() - startTime) / 1000);       // 全局时间
      var info = document.getElementById('status-info');
      if (info && view.aiThinking) { var rcR = view.aiRetries ? view.aiRetries[view.aiThinkingSide] : 0; var phT = ''; try { var pht = XQ.XiangqiKnowledge && XQ.XiangqiKnowledge.detectPhase(engine); phT = (XQ.XiangqiKnowledge.PHASE_CN && XQ.XiangqiKnowledge.PHASE_CN[pht]) || ''; } catch (eP) {} info.textContent = '第' + engine.ply() + '手 · ' + s + 's' + (phT ? ' · ' + phT : '') + (rcR ? ' · 重试' + rcR + '次' : ''); }   // v1.7.4 全局时间只在下方横幅; v2.5 重试可见; v3.7 阶段徽章
      if (s >= 60 && !thinkWarned) { thinkWarned = true; warnBanner('⚠ ' + modelName + ' 已思考 ' + s + 's (排队/网络波动?)', side); }
      if (Date.now() >= checkFlashUntil) {   // 将军横幅闪屏期不被 tick 覆盖
        XQ.UI.aiBanner('busy', '全局 ' + (g / 60 | 0) + ':' + ('0' + g % 60).slice(-2), side);   // v1.7.4: 下方横幅只显示全局时间 (上方已含模型/方别/手数)
      }
      var hh = agents[side];   // v1.7.3: 信息卡总思考实时跳动
      var imStat = document.querySelector('#think-' + side + '-info .im-stat');
      if (imStat) {
        var tok = '';
        if (hh && hh.agent && hh.agent.usage) { var u = hh.agent.usage(); if (u && u.total) tok = ' · ' + (u.total > 999 ? (u.total / 1000).toFixed(1) + 'k' : u.total) + ' tok'; if (u && u.cacheHit && u.prompt) tok += ' · 缓存' + Math.round(100 * u.cacheHit / u.prompt) + '%'; if (u && u.blocked) tok += ' · 拦截' + u.blocked; }   // v2.9 缓存命中 + v3.2 拦截计数实时上卡
        imStat.textContent = '总思考 ' + ((thinkStat[side] ? thinkStat[side].total : 0) + s) + 's' + tok;
      }
    };
    tick();
    thinkTimer = setInterval(tick, 1000);
  }
  function bannerClear() {
    if (thinkTimer) { clearInterval(thinkTimer); thinkTimer = null; }
    view.aiThinkingSide = null;
    XQ.UI.aiBanner('', '');
  }
  function warnBanner(msg, side) {
    XQ.UI.aiBanner('warn', msg, side);
    clearTimeout(warnTimer);
    warnTimer = setTimeout(function () { XQ.UI.aiBanner('', ''); }, 6000);   // 警告 6s 后自动消失
  }
  // v1.5.5: LLM 错误分类提示 (常驻 15s, 区分网络/鉴权/格式/上游限流)
  function errBanner(model, errMsg, side) {
    var m = String(errMsg || '').slice(0, 80);
    var tag = /429|\u9650\u6d41|rate/.test(m) ? '⚠ 上游限流 (429)'
            : /503|\u7e41\u5fd9|busy/.test(m) ? '⚠ 上游繁忙 (503)'
            : /REASONING_REQUIRED|\u6df1\u5ea6\u601d\u8003/.test(m) ? '⚠ 模型强制思考, 已自动重试'
            : /UNKNOWN_FIELD|\u672a\u77e5\u5b57\u6bb5/.test(m) ? '⚠ 不支持的思考参数, 已摘掉重试'
            : /402|insufficient balance|\u4f59\u989d|\u6b20\u8d39|quota/i.test(m) ? (XQ.I18N ? XQ.I18N.t('warn_pay') : '')
            : /401|403|\u9274\u6743|key|Key/.test(m) ? '🔑 API Key 未配或失效'
            : /400/.test(m) ? '❌ 接口返回 400 (格式错误)'
            : /fetch|network|abort|timeout/.test(m) ? '🌐 网络异常'
            : '❌ ' + m;
    XQ.UI.aiBanner('warn', tag, side);
    var abEl = document.getElementById('ai-banner');
    if (abEl && !abEl._dismissBound) {
      abEl._dismissBound = true;
      abEl.addEventListener('click', function () { clearTimeout(warnTimer); XQ.UI.aiBanner('', ''); });   // v1.0.daily: 点击横幅立即关闭 (取消残留定时器)
    }
    clearTimeout(warnTimer);
    warnTimer = setTimeout(function () { XQ.UI.aiBanner('', ''); }, 15000);   // 错误提示延长 15s
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
      engine.undoMove(last);
      replayStack.push(last);
    }
    aiBusy = false;
    bannerClear();
    refresh();
    var T8 = XQ.I18N ? XQ.I18N.t : function (k) { return k; }, TA8 = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return k; };
    warnBanner(TA8('rp_replay_toast', { n: ply }), replayStack.length ? (replayStack[0].piece && replayStack[0].piece.color) : null);   // v1.0.daily i18n
    // 高亮选中 (长对局时滚入视区)
    var log = document.getElementById('move-log');
    if (log) Array.from(log.children).forEach(function (e) {
      e.classList.toggle('active', parseInt(e.dataset.ply, 10) === ply);
    });
    var act = log && log.querySelector('.log-entry.active');
    if (act) { try { act.scrollIntoView({ block: 'nearest' }); } catch (eSV) {} }
    // 复盘后加还原按钮到状态条
    paintReplayBar();
  }
  function replayRestore() {
    while (replayStack.length) engine.applyMove(replayStack.pop());
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
      bar.innerHTML = '<button id="replay-restore" style="background:#f1c40f;color:#1a0e08;border:1px solid #a08040;border-radius:8px;padding:4px 12px;cursor:pointer;font-size:12px;font-weight:bold">⟲ 还原</button>';
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
    if (engine.isOver() || aiBusy) return;
    var side = engine.turn();
    var gid = gameId;   // v1.0.daily 世代捕获: 重开/新局后迟到的调度作废
    var holder = agentFor(side);
    if (!holder) { bannerClear(); return; }
    aiBusy = true;
    view.aiThinking = holder.label;
    // 对方面板: 保留决策卡片 (v1.5), 无卡片时退回日志文本
    var oppSide = side === 'red' ? 'black' : 'red';
    XQ.UI.thinkPanel(oppSide, decisionPanelOpts(oppSide));
    var thinkCards = decisionLog[side] && decisionLog[side].length ? XQ.UI.decisionCards(decisionLog[side].slice(-4), decisionLog[side].length) : null;
        if (thinkCards) thinkCards.push('<div class="dcard d-thinking">⚡ 思考中…</div>');   // v1.7.3: 保留决策卡+思考中提示
        XQ.UI.thinkPanel(side, thinkCards
          ? { cards: thinkCards, active: true, info: infoHTML(side, holder, '') + ' <span class="info-thinking">⚡ 思考中…</span>' }
          : { text: '思考中…', active: true, info: infoHTML(side, holder, '') + ' <span class="info-thinking">⚡ 思考中…</span>' });
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
        else { warnBanner('⚠️ ' + holder.model + ' 走法被拒: ' + res.reason, side); }
        refresh();
      }).catch(function (err) {
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
          XQ.UI.thinkPanel(side, { text: '失败: ' + String(err && err.message || err).slice(0, 80), active: false });
          errBanner(holder.model, err && err.message || err, side);
          refresh();
        }
      });
    }, 350);
  }

  /* ── 设置 ── */
  var SIDE_DEFS = {
    red: { checkbox: 'ai-red-enabled', type: 'ai-red-type', provider: 'ai-red-provider', model: 'ai-red-model', style: 'ai-red-style', quick: 'ai-red-quick', label: '红方' },
    black: { checkbox: 'ai-black-enabled', type: 'ai-black-type', provider: 'ai-black-provider', model: 'ai-black-model', style: 'ai-black-style', quick: 'ai-black-quick', label: '黑方' }
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
        PROVIDER_MODELS = {};
        list.forEach(function (p) { PROVIDER_MODELS[p.id] = p.models || []; });
        Object.keys(SIDE_DEFS).forEach(function (side) {
          var sel = document.getElementById(SIDE_DEFS[side].provider);
          var cur = sel.value;
          sel.innerHTML = '';
          list.forEach(function (p) {
            var opt = document.createElement('option');
            opt.value = p.id;
            opt.textContent = p.name + (p.hasKey ? '' : ' (未配Key)');
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
        quick: document.getElementById(d.quick) ? document.getElementById(d.quick).checked : false
      };
    });
    return s;
  }
  function fillSettings(saved) {
    Object.keys(SIDE_DEFS).forEach(function (side) {
      var d = SIDE_DEFS[side], v = saved[side] || {};
      document.getElementById(d.checkbox).checked = !!v.enabled;
      document.getElementById(d.type).value = v.type || 'human';
      document.getElementById(d.provider).value = v.provider || 'deepseek';
      document.getElementById(d.model).value = v.model || '';
      if (document.getElementById(d.style)) document.getElementById(d.style).value = v.style || 'mid';
      if (document.getElementById(d.quick)) document.getElementById(d.quick).checked = !!v.quick;
    });
  }
  function saveAISettings() {
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
        agents[side] = { kind: 'random', label: '随机AI(' + (side === 'red' ? '红' : '黑') + ')', agent: XQ.RandomAgent.create({ side: side, name: 'Random-' + side }) };
      } else if (v.type === 'llm') {
        if (!relayAvailable) {
          warnBanner((XQ.I18N ? XQ.I18N.t('warn_llm_no_server') : '⚠️ LLM 需要本地服务: 请运行 node server.js 后访问本页地址') + ' <b>http://' + location.host + '</b>');   // v1.0.daily: 端口随实际服务端口 (server.js 支持 argv 端口)
          agents[side] = null; return;
        }
        var agent = XQ.LLMAgent.create({
          side: side, provider: v.provider, model: v.model, promptLevel: v.style || 'mid',
          thinking: v.quick ? 'disabled' : 'enabled',   // v1.7.2: 快答模式关思考 (不支持时 400 自动降级)
          onThinking: function (s, text) { if (aiBusy && s === side) showThinking(s, text); },
          onRetry: function (info) { view.aiRetries = view.aiRetries || {}; view.aiRetries[side] = info.attempt; }   // v2.5: 重试实时可见 (状态条 重试N次)
        });
        agents[side] = { kind: 'llm', label: v.model || 'LLM', model: v.model, provider: v.provider, quick: !!v.quick, style: v.style || 'mid', agent: agent };
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
      swEl.style.display = relayAvailable ? 'none' : 'block';
      swEl.innerHTML = (XQ.I18N ? XQ.I18N.t('server_warn') : '') + '<b>http://' + location.host + '</b>';   // v1.0.daily: 动态端口 (替换原硬编码 8788)
    }
    document.getElementById('settings-overlay').classList.add('show');
    // 第23轮 a11y: focus 延到下一渲染帧 — visibility 过渡起帧前元素仍按 hidden 计算, 同步/强制 reflow 的 focus 都被静默忽略 (实测定位)
    var fEl = document.getElementById('ai-red-enabled');
    var doFocus = function () { if (fEl) { try { fEl.focus({ preventScroll: true }); } catch (eF) { fEl.focus(); } } };
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(function () { requestAnimationFrame(doFocus); });
    else setTimeout(doFocus, 0);   // v1.0.daily a11y: 打开焦点入面板
  }

  /* ── 记录/存档 ── */
  function startRecord() {
    gameId++;   // v1.0.daily 世代翻转: 任何新对局作废旧异步回调
    kbCursor = null;
    syncArchive();
    var s = readSettings();
    // 新对局: 重置 LLM 对话上下文
    ['red', 'black'].forEach(function (sd) {
      var h = agents[sd];
      if (h && h.agent && typeof h.agent.reset === 'function') h.agent.reset();
    });
    currentRecord = XQ.Record.blank({
      redName: agents.red ? (agents.red.model || agents.red.label) : '人类',
      redKind: agents.red ? agents.red.kind : 'human', redModel: agents.red && agents.red.model, redStyle: agents.red && agents.red.style,
      blackName: agents.black ? (agents.black.model || agents.black.label) : '人类',
      blackKind: agents.black ? agents.black.kind : 'human', blackModel: agents.black && agents.black.model, blackStyle: agents.black && agents.black.style
    });
    // 思考面板表头: 长名字截短显示 (悬停看全名), 防止挤掉 stat
    function short(n) { n = String(n || ''); return n.length > 11 ? n.slice(0, 10) + '…' : n; }
    thinkStat.red = { total: 0, moves: 0 };
    thinkStat.black = { total: 0, moves: 0 };
    decisionLog.red = [];
    decisionLog.black = [];
    XQ.UI.thinkPanel('red', { name: '红方', title: currentRecord.red.name, stat: '', text: '等待对局开始…', active: false,
      info: modelCardHTML('red') + (currentRecord.red.style ? '<span class="badge-style ' + levelClass(currentRecord.red.style) + '">' + levelCN(currentRecord.red.style) + '</span>' : '') });
    XQ.UI.thinkPanel('black', { name: '黑方', title: currentRecord.black.name, stat: '', text: '等待对局开始…', active: false,
      info: modelCardHTML('black') + (currentRecord.black.style ? '<span class="badge-style ' + levelClass(currentRecord.black.style) + '">' + levelCN(currentRecord.black.style) + '</span>' : '') });
  }
  /* v1.0.daily 存档按钮可用性 (无棋谱/空谱禁用, 防误点导出空文件) */
  function syncArchive() {
    var b = document.getElementById('btn-save');
    if (b) b.disabled = !(currentRecord && currentRecord.moves && currentRecord.moves.length);
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
  /* v1.0.daily 用户重开入口 (R 键/重开按钮): 对局已走且未终局时先确认, 防误触丢进度 */
  function userRestart() {
    if (engine.ply() > 0 && !engine.isOver()) {
      var cT = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
      if (!window.confirm(cT('btn_restart_confirm'))) return;
    }
    restartGame();
  }
  function restartGame() {
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
    setTimeout(scheduleAgent, 100);
  }
  /* v2.3 主界面全屏观战: 按钮或 F 键 (回放模式内 F 由回放分支接管, 不冲突); Esc 由浏览器原生退全屏 */
  function toggleFullscreen() {
    if (document.fullscreenElement) { document.exitFullscreen(); return; }
    var el = document.documentElement;
    if (el.requestFullscreen) el.requestFullscreen();
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

  /* ── 初始化 ── */
  document.addEventListener('DOMContentLoaded', function () {
    XQ.UI.drawBoard(document.getElementById('board-lines'));
    initSoundToggle();
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
      refresh();
      ['red', 'black'].forEach(function (sd) {
        XQ.UI.thinkPanel(sd, { name: XQ.I18N ? XQ.I18N.t(sd === 'red' ? 'status_side_red' : 'status_side_black') : (sd === 'red' ? '红方' : '黑方') });
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
    });
    // v1.7 思考面板折叠 (点 head 切换)
    ['think-red', 'think-black'].forEach(function (id) {
      var root = document.getElementById(id);
      var head = root && root.querySelector('.think-head');
      if (head && !head._foldBound) {
        head._foldBound = true;
        head.insertAdjacentHTML('beforeend', '<span class="fold">▾</span>');
        head.addEventListener('click', function () {
          root.classList.toggle('collapsed');
          var f = head.querySelector('.fold');
          if (f) f.textContent = root.classList.contains('collapsed') ? '▸' : '▾';
          try { localStorage.setItem('xq_fold_' + (id === 'think-red' ? 'red' : 'black'), root.classList.contains('collapsed') ? '1' : '0'); } catch (eF) {}   // v1.0.daily: 折叠态持久化
        });
        try { if (localStorage.getItem('xq_fold_' + (id === 'think-red' ? 'red' : 'black')) === '1') { root.classList.add('collapsed'); var f0 = head.querySelector('.fold'); if (f0) f0.textContent = '▸'; } } catch (eF2) {}
      }
    });
    document.getElementById('gear-toggle').onclick = openAISettings;
    document.getElementById('btn-restart').onclick = userRestart;   // v1.0.daily 确认入口
    var eoOv = document.getElementById('end-overlay');
    if (eoOv && !eoOv._dismissBound) {
      eoOv._dismissBound = true;
      eoOv.addEventListener('click', function (ev) { if (ev.target === eoOv) eoOv.classList.remove('show'); });   // v1.0.daily: 点遮罩关闭终局卡 → 可自由回看终局走子/复盘 (再来一局 按钮不受影响)
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
      input.type = 'file'; input.accept = '.json,application/json';
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
          refresh();
        }).catch(function (e) { alert('导入失败: ' + e.message); });
      };
      input.click();
    };
    document.getElementById('btn-replay-watch').onclick = rpOpen;   // v1.6 回放模式
    document.getElementById('btn-fullscreen').onclick = toggleFullscreen;   // v2.3 全屏观战
    ['pointerdown', 'keydown'].forEach(function (ev) {
      document.addEventListener(ev, function () { ensureAudio(); }, { once: false, passive: true });
    });

    // 设置层 Esc 独立监听 (输入框内也生效; 主 keydown 对 INPUT 早退, 管不到这里)
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      var so3 = document.getElementById('settings-overlay');
      if (so3 && so3.classList.contains('show')) {
        closeAISettings();
        if (kbCursor) { kbCursor = null; refresh(); }
      }
    });
    // 快捷键: M 静音 / R 重开
    document.addEventListener('keydown', function (ev) {
      if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
      /* v1.6 回放模式快捷键: ←/→ 步进, 空格 播放/暂停, Esc 退出 */
      if (rpEl && rpEl.ov.style.display === 'block') {
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
      }
      /* v1.0.daily a11y 键盘走子: 方向键光标 / Enter·Space 选子走子 / Esc 取消 */
      var k = (ev.key || '').toLowerCase();
      if (k === 'arrowup' || k === 'arrowdown' || k === 'arrowleft' || k === 'arrowright') {
        kbMove(k === 'arrowleft' ? -1 : k === 'arrowright' ? 1 : 0, k === 'arrowup' ? -1 : k === 'arrowdown' ? 1 : 0);
        ev.preventDefault(); return;
      }
      if (k === 'enter' || k === ' ') {
        if (!kbCursor) return;   // v1.0.daily 复审修复: 无光标时放行原生行为 (Tab 聚焦按钮的 Enter/Space 激活不再被吞)
        ev.preventDefault();
        if (!engine.isOver() && !aiBusy) { onCellClick(kbCursor.x, kbCursor.y); }
        return;
      }
      if (k === 'escape') {
        var so2 = document.getElementById('settings-overlay');
        if (so2 && so2.classList.contains('show')) { closeAISettings(); if (kbCursor) { kbCursor = null; refresh(); } ev.preventDefault(); return; }   // v1.0.daily: Esc 关设置; 第23轮: 统一出口
        if (kbCursor) { kbCursor = null; refresh(); ev.preventDefault(); return; }
      }
      if (k === 'm') document.getElementById('snd-toggle').click();
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
  var RP_LAST_KEY = 'xq_replay_last_pick';

  function rpEnsure() {
    if (rpEl) return rpEl;
    var ov = document.createElement('div');
    ov.id = 'replay-overlay';
    ov.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(10,6,2,.82);display:none;overflow:auto;padding:18px';
    ov.innerHTML =
      '<style>#rp-moves li{padding:3px 8px;border-radius:6px;cursor:pointer;list-style:none;display:flex;gap:4px;align-items:baseline}#rp-moves li:hover{background:rgba(255,255,255,.08)}#rp-moves li.active{background:#e0a030;color:#1a0e08;font-weight:bold}#rp-moves li.active b{color:#1a0e08}#rp-moves li b{color:#e0a030;min-width:24px;text-align:right}#rp-moves li .rp-ml-side{min-width:18px;font-size:11px;text-align:center}#rp-moves::-webkit-scrollbar{width:6px}#rp-moves::-webkit-scrollbar-thumb{background:#7a5a2a;border-radius:3px}.btn:disabled{opacity:.4;cursor:not-allowed}.cell.next-target{background:rgba(224,160,48,.18);box-shadow:inset 0 0 0 2px rgba(224,160,48,.7)}#rp-moves-filter{width:100%;margin-bottom:4px;padding:4px 8px;border-radius:6px;border:1px solid #7a5a2a;background:#2a1a0c;color:#f0e0c0;font-size:12px;box-sizing:border-box}kbd{display:inline-block;padding:1px 6px;border-radius:4px;background:#3a2a1c;border:1px solid #7a5a2a;color:#f0d9a0;font-family:monospace;font-size:12px;margin-right:4px}</style>'
      + '<div style="max-width:1040px;margin:0 auto">'
      + '<div style="display:flex;align-items:center;gap:10px;margin-bottom:12px;flex-wrap:wrap">'
      + '  <b style="color:#f0d9a0;font-size:16px" data-i18n="rp_title">🎬 对局回放</b>'
      + '  <select id="rp-pick" style="flex:1;min-width:260px;padding:6px;border-radius:6px;border:1px solid #7a5a2a;background:#2a1a0c;color:#f0e0c0;font-size:12px"></select>'
      + '  <button class="btn" id="rp-import" data-i18n="rp_import_btn" data-i18n-title="rp_import_title" title="导入本地棋谱 JSON (与主界面 保存棋谱 导出格式一致)">📂 导入</button>'
      + '  <label style="color:#c4a56e;font-size:12px;display:flex;align-items:center;gap:4px"><input type="checkbox" id="rp-autoplay" style="accent-color:#e0a030"><span data-i18n="rp_autoplay_label"> 自动播放</span></label>'
      + '  <button class="btn" id="rp-next-record" data-i18n-title="rp_nextrecord_title" title="下一局">▶▶</button>'
      + '  <button class="btn" id="rp-export-pgn" data-i18n-title="rp_export_pgn_title" title="导出 PGN">💾 PGN</button>'
      + '  <button class="btn" id="rp-del" data-i18n-title="rp_delete_title" title="删除该棋谱" style="background:rgba(192,57,43,.25)">🗑</button>'
      + '  <button class="btn" id="rp-help" data-i18n-title="rp_help_title" title="键盘帮助 (?)">⌨</button>'
      + '  <button class="btn" id="rp-fullscreen" data-i18n-title="rp_full_title" title="全屏模式 (F)">⛶</button>'
      + '  <button class="btn" id="rp-close" data-i18n="rp_close_btn" style="background:#c0392b">✕ 退出回放</button>'
      + '</div>'
      + '<div style="display:flex;gap:14px;align-items:flex-start;flex-wrap:wrap">'
      + '  <div style="position:relative;padding:10px 10px 22px 26px;background:linear-gradient(135deg,#6b4f1a,#a08040,#6b4f1a);border-radius:6px;box-shadow:0 6px 24px rgba(0,0,0,.6)">'
      + '    <div id="rp-board" style="position:relative;display:grid;grid-template-columns:repeat(9,var(--cell));grid-template-rows:repeat(10,var(--cell));width:calc(var(--cell)*9);height:calc(var(--cell)*10);background:#dcc88a;border:2px solid #5a3a18;box-sizing:content-box"></div>'
      + '    <div id="rp-col-labels" style="position:absolute;left:28px;bottom:3px;width:calc(var(--cell)*9);display:grid;grid-template-columns:repeat(9,var(--cell));pointer-events:none;z-index:4"></div>'
      + '    <div id="rp-row-labels" style="position:absolute;left:3px;top:12px;height:calc(var(--cell)*10);width:20px;display:grid;grid-template-rows:repeat(10,var(--cell));pointer-events:none;z-index:4"></div>'
      + '  </div>'
      + '  <div style="flex:1;min-width:300px;max-width:420px;display:flex;flex-direction:column;gap:10px">'
      + '    <div id="rp-head" style="color:#e8d5ae;font-size:12px;line-height:1.5"></div>'
      + '    <div id="rp-evalbar" style="position:relative;height:20px;border-radius:10px;overflow:hidden;background:#1a0e08;border:1px solid #7a5a2a;display:flex">'
      + '      <div class="rp-eb-red" style="background:linear-gradient(90deg,#c0392b,#e74c3c);width:50%;transition:width .3s"></div>'
      + '      <div class="rp-eb-black" style="background:linear-gradient(270deg,#2c3e50,#34495e);width:50%;transition:width .3s"></div>'
      + '      <div style="position:absolute;left:50%;top:0;bottom:0;width:2px;background:#f0d9a0;opacity:.5"></div>'
      + '      <span class="rp-eb-val" style="position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);color:#f0d9a0;font-size:11px;font-weight:bold;text-shadow:0 1px 2px rgba(0,0,0,.8);min-width:42px;text-align:center" data-i18n="rp_even">均势</span>'
      + '    </div>'
      + '    <div id="rp-info" style="background:rgba(30,18,8,.75);border:1px solid #7a5a2a;border-radius:10px;padding:10px 12px;color:#f0e0c0;font-size:13px;line-height:1.7;min-height:160px"></div>'
      + '    <input id="rp-moves-filter" data-i18n="rp_filter_placeholder" placeholder="🔍 过滤走法 (summary / 坐标)">'
      + '    <ol id="rp-moves" style="background:rgba(30,18,8,.75);border:1px solid #7a5a2a;border-radius:10px;padding:6px 8px;margin:0;color:#e8d5ae;font-size:12px;line-height:1.5;max-height:140px;overflow-y:auto"></ol>'
      + '    <div id="rp-timechart" style="background:rgba(30,18,8,.75);border:1px solid #7a5a2a;border-radius:10px;padding:6px 10px;font-size:11px;color:#c4a56e"><div class="rp-tc-cap" style="margin-bottom:4px">⏱ 思考时长 · <span style="color:#c0392b">红</span>/<span style="color:#3498db">黑</span> · <span style="color:#e0a030">金=当前</span> · 点击跳转</div></div>'
      + '    <div id="rp-evalchart" style="background:rgba(30,18,8,.75);border:1px solid #7a5a2a;border-radius:10px;padding:6px 10px;font-size:11px;color:#c4a56e"><div class="rp-ec-cap" style="margin-bottom:4px">📈 评值走势 (红方视角, 上=红优) · <span style="color:#ffd76a">金点=当前</span> · 点击跳转</div></div>'
      + '    <div style="background:rgba(30,18,8,.75);border:1px solid #7a5a2a;border-radius:10px;padding:10px 12px">'
      + '      <input id="rp-range" type="range" min="0" max="0" value="0" step="1" style="width:100%;accent-color:#e0a030">'
      + '      <div style="display:flex;gap:6px;justify-content:center;flex-wrap:wrap;margin-top:8px">'
      + '        <button class="btn" id="rp-loop" data-i18n-title="rp_loop_title" title="循环播放 (L)">🔁</button>'
      + '        <button class="btn" id="rp-start" data-i18n-title="rp_start_title" title="回到开头">⏮</button>'
      + '        <button class="btn" id="rp-prev" data-i18n-title="rp_prev_title" title="上一步">◀</button>'
      + '        <button class="btn" id="rp-toggle" data-i18n-title="rp_toggle_title" title="播放/暂停 (Space)" style="min-width:72px">▶ 播放</button>'
      + '        <button class="btn" id="rp-next" data-i18n-title="rp_next_title" title="下一步">▶|</button>'
      + '        <button class="btn" id="rp-end" data-i18n-title="rp_end_title" title="跳到结尾">⏭</button>'
      + '        <button class="btn" id="rp-back5" data-i18n-title="rp_back5_title" title="后退5手" style="font-size:11px">⏪-5</button>'
      + '        <button class="btn" id="rp-back10" data-i18n-title="rp_back10_title" title="后退10手" style="font-size:11px">⏪-10</button>'
      + '        <button class="btn" id="rp-skip5" data-i18n-title="rp_skip5_title" title="快进5手" style="font-size:11px">+5⏩</button>'
      + '        <button class="btn" id="rp-skip10" data-i18n-title="rp_skip10_title" title="快进10手" style="font-size:11px">+10⏩</button>'
      + '        <button class="btn" id="rp-prev-cap" data-i18n-title="rp_prevcap_title" title="上一手吃子 (Shift+C)" style="font-size:11px">⏪吃</button>'
      + '        <button class="btn" id="rp-next-cap" data-i18n-title="rp_nextcap_title" title="下一手吃子 (C)" style="font-size:11px">吃子⏩</button>'
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
      + '        <input id="rp-jump" type="number" min="0" step="1" data-i18n="rp_jump_placeholder" placeholder="手" style="width:64px;padding:4px;border-radius:6px;border:1px solid #7a5a2a;background:#2a1a0c;color:#f0e0c0;font-size:12px">'
      + '        <button class="btn" id="rp-go">GO</button>'
      + '      </div>'
      + '    </div>'
      + '  </div>'
      + '</div></div>';
    document.body.appendChild(ov);
    /* v1.0.daily 回放层 i18n: 骨架带 data-i18n 标记, 构建后立即按当前语言刷新 (含 EN 用户首次打开) */
    if (XQ.I18N) XQ.I18N.apply();
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
    rpEl.btnHelp.onclick = rpShowHelp;
    /* v1.7.7 全屏模式: 覆盖层整体进全屏, Esc 先退全屏再退回放 */
    function rpToggleFull() {
      try {
        if (document.fullscreenElement) document.exitFullscreen();
        else if (ov.requestFullscreen) ov.requestFullscreen();
      } catch (eF) {}
    }
    rpEl.btnFull.onclick = rpToggleFull;
    document.addEventListener('fullscreenchange', function () {
      if (rpEl && rpEl.btnFull) {
        var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
        rpEl.btnFull.textContent = document.fullscreenElement ? '⤡' : '⛶';
        rpEl.btnFull.title = document.fullscreenElement ? T('rp_exit_full_title') : T('rp_full_title');
      }
    });
    rpEl.autoplay.checked = rpGetSetting('autoplay');
    rpEl.autoplay.onchange = function () { try { localStorage.setItem(RP_AUTOPLAY_KEY, this.checked ? '1' : '0'); } catch (e) {} };
    rpEl.movesFilter.addEventListener('input', rpPaintMoveList);
    /* v1.6.3 委托: head 内动态生成的 #rp-jump-max (最长思考链接) 点击跳转 */
    document.body.addEventListener('click', function (e) {
      var a = e.target.closest && e.target.closest('#rp-jump-max');
      if (a && rpCtrl) { rpCtrl.gotoPly(parseInt(a.dataset.ply, 10)); e.preventDefault(); }
    });
    ov.querySelector('#rp-go').onclick = rpJump;
    rpEl.jump.addEventListener('keydown', function (e) { if (e.key === 'Enter') rpJump(); });
    rpEl.range.addEventListener('input', function () { rpCtrl && rpCtrl.gotoPly(parseInt(rpEl.range.value, 10)); });
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
      input.type = 'file'; input.accept = '.json,application/json';
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
          o.textContent = '📂 ' + (saved.red && saved.red.name || '?') + ' vs ' + (saved.black && saved.black.name || '?') + ' (' + saved.moves.length + '手)';
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
    rpEl.movelist.addEventListener('click', function (e) {
      var li = e.target.closest('li[data-ply]');
      if (li && rpCtrl) rpCtrl.gotoPly(parseInt(li.dataset.ply, 10));
    });
    /* 滚轮步进: 棋盘上 wheel 下=next 上=prev, 180ms 节流 */
    var rpWheelLock = 0;
    rb.addEventListener('wheel', function (e) {
      e.preventDefault();
      var now = Date.now();
      if (now - rpWheelLock < 180 || !rpCtrl) return;
      rpWheelLock = now;
      if (e.deltaY > 0) rpCtrl.stepNext(); else if (e.deltaY < 0) rpCtrl.stepPrev();
    }, { passive: false });
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
  }
  function rpPaintSpeeds() {
    var cur = rpCtrl ? rpCtrl.speed() : 1;
    Array.prototype.forEach.call(rpEl.ov.querySelectorAll('.rp-speed'), function (b) {
      var active = parseFloat(b.dataset.x) === cur;
      b.style.background = active ? '#e0a030' : '';
      b.style.color = active ? '#1a0e08' : '';
      b.style.fontWeight = active ? 'bold' : '';
    });
  }
  function rpJump() {
    var n = parseInt(rpEl.jump.value, 10);
    if (!isNaN(n)) rpCtrl && rpCtrl.gotoPly(n);
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
    XQ.Record.remove(rec.id);
    try { localStorage.removeItem('xq_replay_pos_' + rec.id); localStorage.removeItem(XQ.Replay.bookmarkKey(rec.id)); } catch (eD) {}
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
    var pos = 0;
    try { pos = parseInt(localStorage.getItem('xq_replay_pos_' + record.id) || '0', 10); } catch (e) {}
    if (pos < 0 || pos > rpSession.total()) pos = 0;
    if (pos > 0) rpCtrl.gotoPly(pos); else rpCtrl.gotoPly(0);
    if (rpGetSetting('autoplay') === '1') setTimeout(function () { rpCtrl && rpCtrl.play(); }, 300);
  }
  function rpOnState(st) {
    var animate = (st.idx === rpLastIdx + 1);
    rpPaintBoard(st, animate);
    rpPaintInfo(st);
    rpPaintEval(st);
    rpPaintMoveList();
    rpPaintTimeChart();
    rpPaintEvalChart();
    rpPaintHead();
    rpPaintButtons(st);
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
    return ' · ' + (XQ.I18N ? XQ.I18N.tArgs('rp_longest', { s: (maxT / 1000).toFixed(1) }) : '最长 ' + (maxT / 1000).toFixed(1) + 's') + ' <a href="javascript:void(0)" id="rp-jump-max" style="color:#e0a030;text-decoration:underline" data-ply="' + maxN + '">@#' + maxN + '</a>';
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
      d0.textContent = '(评值数据不足, 需至少 2 手含数字 evaluation)';
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
      '[Date "' + date + '"]',
      '[Red "' + (rec.red && rec.red.name || '?') + '"] [RedModel "' + (rec.red && rec.red.model || '?') + '"]',
      '[Black "' + (rec.black && rec.black.name || '?') + '"] [BlackModel "' + (rec.black && rec.black.model || '?') + '"]',
      '[Result "' + pgnRes + '"]'
    ];
    var body = '';
    for (var i = 0; i < rec.moves.length; i++) {
      var m = rec.moves[i];
      /* v3.9.2 PGN 加中文记谱: 同一手追加 {cn: 炮八平五} (与 {summary} 并列) — 中文观战者可一眼看走子, 国际象棋 PGN 应用忽略额外 {} 字段 */
      var cnN = (m.side && m.piece && m.from && m.to && typeof cnNotation === 'function') ? cnNotation(m.side, m.piece, m.from, m.to) : '';
      var cmts = [];
      if (cnN) cmts.push('cn:' + cnN);
      if (m.summary) cmts.push(m.summary);
      body += (i % 2 === 0 ? Math.floor(i / 2) + 1 + '. ' : '') + m.from + '-' + m.to + (cmts.length ? ' {' + cmts.join(' | ') + '}' : '') + ' ';
    }
    /* v1.6.4 PGN 修复: 原黑方手前插 '*' (终局标记) 会被解析器当对局结束截断; 改标准 "1. 红手 黑手 2. ..." 格式, 末尾追加结果标记 (v3.8: 结果记号统一由 pgnRes 计算, 和棋局 1/2-1/2) */
    lines.push((body.trim() + ' ' + pgnRes).trim());
    var blob = new Blob([lines.join('\n')], { type: 'text/plain;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'xq_' + (rec.id || Date.now()) + '.pgn';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function rpShowHelp() {
    if (document.getElementById('rp-help-overlay')) return;
    var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; };
    var row = function (keys, label) { return '<tr><td>' + keys + '</td><td>' + label + '</td></tr>'; };
    var html = '<div id="rp-help-overlay" style="position:fixed;inset:0;background:rgba(0,0,0,.85);z-index:300;display:flex;align-items:center;justify-content:center" onclick="if(event.target===this)this.remove()">'
      + '<div style="background:#2a1a0c;border:1px solid #7a5a2a;border-radius:14px;padding:20px 24px;max-width:520px;color:#f0e0c0;box-shadow:0 8px 32px rgba(0,0,0,.7)">'
      + '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:14px"><b style="color:#f0d9a0;font-size:18px">' + T('rp_help_title_h') + '</b>'
      + '<button onclick="document.getElementById(&quot;rp-help-overlay&quot;).remove()" class="btn" style="background:#c0392b">✕</button></div>'
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
      + row(T('rp_hk_wheel').split(' ')[0] === '棋盘上' ? '滚轮' : 'Wheel', T('rp_hk_wheel'))
      + row('<kbd>?</kbd> / <kbd>/</kbd>', T('rp_hk_help'))
      + row('<kbd>Esc</kbd>', T('rp_hk_esc'))
      + '</table>'
      + '<div style="margin-top:12px;padding-top:10px;border-top:1px dashed rgba(122,90,42,.4);font-size:12px;color:#c4a56e">' + T('rp_hk_tips') + '<br>' + T('rp_hk_main') + '</div>'
      + '</div></div>';
    var d = document.createElement('div');
    d.innerHTML = html;
    document.body.appendChild(d.firstChild);
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
  function rpPaintHead() {
    var s = rpSession.summary;
    var T = XQ.I18N ? XQ.I18N.t : function (k) { return k; }, TA = XQ.I18N ? XQ.I18N.tArgs : function (k, a) { return k; };
    var resTag = { repetition: T('rp_res_repetition'), natural: T('rp_res_natural'), draw: T('rp_res_draw'), agree: T('rp_res_agree') };
    var tag = s.winner === 'red' ? T('rp_tag_red_win') : s.winner === 'black' ? T('rp_tag_black_win') : (s.result ? (resTag[s.result] || s.result) : T('rp_tag_ongoing'));
    rpEl.head.innerHTML = '<b>' + esc2(s.stamp) + '</b> · '
      + esc2(s.red) + (s.redModel ? ' <span style="color:#c4a56e;font-size:11px">[' + esc2(s.redModel) + ']</span>' : '')
      + ' <span style="color:#7a5a2a">vs</span> '
      + esc2(s.black) + (s.blackModel ? ' <span style="color:#c4a56e;font-size:11px">[' + esc2(s.blackModel) + ']</span>' : '')
      + ' ' + TA('rp_head_plies', { n: s.plies }) + ' ' + tag
      + (s.durationMs ? ' · ' + TA('rp_total_time', { s: Math.round(s.durationMs / 1000) }) : '')
      + rpHeadSideStats()
      + rpHeadProgress()
      + rpHeadMaterial()
      + rpHeadMaxTime()
      + ((rpSession.record && rpSession.record.note) ? '<div style="color:#c4a56e;font-size:11px;margin-top:3px;word-break:break-all">' + T('rp_note') + ' ' + esc2(String(rpSession.record.note).slice(0, 240)) + '</div>' : '');   // v1.0.daily: 谱内备注 (如兑底原因) 回放可见
  }
  var rpNextTarget = null;
  function rpPaintBoard(st, animate) {
    var board = rpEl.board;
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
        var p = st.cells[y][x];
        if (p) {
          var pe = document.createElement('div');
          pe.className = 'piece ' + p.color;
          pe.textContent = XQ.Piece.CHARS[p.color][p.type];
          if (last && x === last.to.x && y === last.to.y) pe.classList.add('just-placed');
          c.appendChild(pe);
          if (animate && last && x === last.to.x && y === last.to.y) {
            var dx = (last.from.x - last.to.x) * 100, dy = (last.from.y - last.to.y) * 100;
            if (dx || dy) {
              pe.style.transform = 'translate(' + dx + '%,' + dy + '%)';
              pe.style.transition = 'none';
              (function (el) {
                requestAnimationFrame(function () {
                  requestAnimationFrame(function () {
                    el.style.transition = 'transform .28s cubic-bezier(.2,.8,.3,1)';
                    el.style.transform = 'translate(0,0)';
                  });
                });
              })(pe);
            }
            if (last.captured) {
              var gh = document.createElement('div');
              gh.className = 'piece ghost-out ' + last.captured.color;
              gh.textContent = XQ.Piece.CHARS[last.captured.color][last.captured.type];
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
        board.appendChild(c);
      }
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
      var pc = (XQ.Piece.CHARS[e.side] && XQ.Piece.CHARS[e.side][e.piece]) || e.piece;
      var capTxt = e.captured ? TA('rp_capture', { p: (XQ.Piece.CHARS[opp] && XQ.Piece.CHARS[opp][e.captured]) || e.captured }) : '';
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
      var nPc = (XQ.Piece.CHARS[nxt.side] && XQ.Piece.CHARS[nxt.side][nxt.piece]) || nxt.piece;
      html += '<div style="font-size:12px;margin-top:6px;padding-top:6px;border-top:1px dashed rgba(122,90,42,.4)">↪ <b style="color:#e0a030">' + T('rp_next_move') + '</b> ' + nTag + ' <b style="color:#f0d9a0">' + esc2(nPc) + '</b> <span style="color:#e8d5ae">' + esc2(nxt.from) + ' → ' + esc2(nxt.to) + '</span>' + (nxt.summary ? ' <span style="color:#c4a56e">· ' + esc2(nxt.summary) + '</span>' : '') + '</div>';
    }
    rpEl.info.innerHTML = html;
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
      var sideTag = m.side === 'red' ? '🔴' : '⚫';
      var bmHtml = rpBookmarks.indexOf(i + 1) >= 0 ? '<span title="' + esc2(T('rp_bm_title')) + '" style="color:#ffd54a">🔖</span> ' : '';   // v1.0.daily 书签标记
      var risky = (risks[i + 1] || 0) >= riskMark ? '<span title="' + esc2(TA('rp_title_risky', { s: (risks[i + 1]).toFixed(1) })) + '" style="color:#e67e22">⚠</span> ' : '';
      var mk = marks[i + 1];   // v1.7.9: 将/杀/困 彩色标记 (杀 > 风险 > 将 > 标签)
      var mkHtml = mk === '杀' ? '<span title="' + esc2(T('rp_title_mate')) + '" style="color:#ff5050;font-weight:bold">杀</span> '
        : mk === '困' ? '<span title="' + esc2(T('rp_title_stuck')) + '" style="color:#ff5050">困</span> '
        : mk === '将' ? '<span title="' + esc2(T('rp_title_check')) + '" style="color:#e0a030">将</span> ' : '';
      html += '<li' + cls + ' data-ply="' + (i + 1) + '"><span class="rp-ml-side">' + sideTag + '</span><b>' + m.n + '</b><span style="flex:1">' + bmHtml + mkHtml + risky + esc2(label) + '</span></li>';
      visible++;
    }
    if (html) rpEl.movelist.innerHTML = html;
    else if (!rec.moves || !rec.moves.length) rpEl.movelist.innerHTML = '<li style="color:#7a5a2a;justify-content:center">' + TA('rp_moves_unit', { n: 0 }) + '</li>';   // v1.0.daily: 空谱≠过滤无匹配 (0手 提示)
    else rpEl.movelist.innerHTML = '<li style="color:#7a5a2a;justify-content:center">' + T('rp_no_match') + '</li>';
    if (visible > 0) { var act = rpEl.movelist.querySelector('li.active'); if (act) act.scrollIntoView({ block: 'nearest' }); }
  }
  /* v1.6.1 边界禁用: 在起点 ⏮◀ 灰, 在终点 ⏭▶| 灰 (循环开启时 ▶ 在终点可继续) */
  function rpPaintButtons(st) {
    if (!rpEl) return;
    var atStart = st.idx === 0, atEnd = st.idx === st.total;
    rpEl.btnStart.disabled = atStart;
    rpEl.btnPrev.disabled = atStart;
    rpEl.btnNext.disabled = atEnd;
    rpEl.btnEnd.disabled = atEnd;
    rpEl.toggle.disabled = atEnd && !(rpCtrl && rpCtrl.isLooping());
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
    rpEl.ov.style.display = 'block';
    rpLockScroll(true);
    try { history.replaceState(null, '', '#rp=' + encodeURIComponent('ls:' + currentRecord.id)); } catch (eH4) {}   // v3.8: 终局回放本局同样写深链
    rpStart(currentRecord);
  }
  function rpLockScroll(on) {
    try { document.body.style.overflow = on ? 'hidden' : ''; } catch (eL) {}   // v1.0.daily: 回放打开时锁背景滚动 (移动端双滚动条/误触)
  }
  function rpOpen() {
    rpEnsure();
    rpEl.ov.style.display = 'block';
    rpLockScroll(true);
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
