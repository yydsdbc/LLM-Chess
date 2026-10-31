/* benchmark/record.js — 棋局记录 (创建 / 存取 / 导入导出) */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var LS_KEY = 'xq_records_v1';

  function blank(opts) {
    opts = opts || {};
    return {
      id: 'm' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      date: new Date().toISOString(),
      red: { name: opts.redName || 'Red', kind: opts.redKind || 'human', model: opts.redModel || null, style: opts.redStyle || null, models: opts.redModels || null },
      black: { name: opts.blackName || 'Black', kind: opts.blackKind || 'human', model: opts.blackModel || null, style: opts.blackStyle || null, models: opts.blackModels || null },
      moves: [],          // {n, side, from, to, piece, captured, name, timeMs}
      result: null,       // 'checkmate' | 'stalemate' | 'perpetual' (v2.0 长将判负) | 'repetition' (v2.2 三次重复判和) | 'natural' (v3.8 自然限着判和) | 'resign' | 'max_plies' | 'error'
      winner: null,       // 'red' | 'black' | null
      durationMs: 0,
      illegal: 0,
      tokens: { red: null, black: null }
    };
  }

  function addMove(record, engine, moveObj, timeMs, meta) {
    var e = {
      n: record.moves.length + 1,
      side: moveObj.piece.color,
      piece: moveObj.piece.type,
      from: XQ.Move.sqName(moveObj.from),
      to: XQ.Move.sqName(moveObj.to),
      name: XQ.Move.name(moveObj),
      captured: moveObj.captured ? moveObj.captured.type : null,
      timeMs: timeMs || 0
    };
    // v1.3/v1.5 LLM 决策元数据 (summary/plan/candidates/evaluation/confidence) — 可选, 写进棋谱便于 Benchmark
    if (meta) {
      if (meta.summary) e.summary = String(meta.summary).slice(0, 80);
      if (meta.plan) e.plan = String(meta.plan).slice(0, 40);
      if (meta.evaluation) e.evaluation = String(meta.evaluation).slice(0, 60);
      if (typeof meta.confidence === 'number') e.confidence = Math.max(0, Math.min(1, meta.confidence));
      if (Array.isArray(meta.candidates) && meta.candidates.length) {
        e.candidates = meta.candidates.slice(0, 3).map(function (c) { return { move: String(c.move || '').slice(0, 30), score: String(c.score || '').slice(0, 14) }; });
      }
      if (Array.isArray(meta.votes) && meta.votes.length) {   // 第34轮: 会诊投票明细入谱 (回放信息面板可展示)
        e.votes = meta.votes.slice(0, 8).map(function (v) {
          return { model: String(v.model || '').slice(0, 40), from: String(v.from || '').slice(0, 6), to: String(v.to || '').slice(0, 6),
            conf: typeof v.conf === 'number' ? Math.round(v.conf * 100) / 100 : null, weight: typeof v.weight === 'number' ? Math.round(v.weight * 100) / 100 : null,
            changed: v.changed === true, ok: v.ok !== false };
        });
      }
      if (typeof meta.unanimity === 'boolean') e.unanimity = meta.unanimity;
      if (['rotate', 'council', 'roundtable'].indexOf(meta.committeeMode) >= 0) e.committeeMode = meta.committeeMode;
      if (meta.voterName) e.voterName = String(meta.voterName).slice(0, 40);
    }
    record.moves.push(e);
  }

  function finish(record, engineResult, durationMs) {
    record.result = engineResult.result;
    record.winner = engineResult.winner;
    record.durationMs = typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0
      ? durationMs : (Date.now() - new Date(record.date).getTime());
    return record;
  }

  /* ── localStorage 存取 ──
   * v1.7.6: 上限 MAX_RECORDS=60 (防 localStorage 无限膨胀) + 配额兑底
   * (QuotaExceeded → 逐级裁剪重试: 留30 → 留15 → 只存当前局, 保证刚下的这局永不丢) */
  var MAX_RECORDS = 60;
  function isImported(record) { return !!(record && typeof record.id === 'string' && record.id.indexOf('import-') === 0); }
  function capPools(records, realLimit, importLimit) {
    var real = 0, imported = 0, kept = [];
    for (var i = records.length - 1; i >= 0; i--) {
      var record = records[i];
      if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !Array.isArray(record.moves)) continue;
      if (isImported(record)) { if (imported++ < importLimit) kept.push(record); }
      else if (real++ < realLimit) kept.push(record);
    }
    return kept.reverse();
  }
  function validImportedMove(mv) {
    return !!(mv && typeof mv.from === 'string' && typeof mv.to === 'string'
      && /^[a-i](10|[1-9])$/.test(mv.from) && /^[a-i](10|[1-9])$/.test(mv.to));
  }
  var _listCache = null, _listRaw = null;   // 第37轮: list() 解析缓存 (raw 串校验 — 外部写入/跨标签自愈)
  function save(record) {
    var all = list();
    var i = all.findIndex(function (r) { return r.id === record.id; });
    if (i >= 0) { all.splice(i, 1); }   // 更新也视为最近活动: 移到末尾再截断, 上限裁剪按活跃度
    all.push(record);
    all = capPools(all, MAX_RECORDS, IMPORT_KEEP);
    try { writeList(all); return record; } catch (e) {}
    var tryKeep = [30, 15];
    for (var t = 0; t < tryKeep.length; t++) {
      try { writeList(capPools(all, tryKeep[t], IMPORT_KEEP)); return record; } catch (e2) {}
    }
    try { writeList([record]); } catch (e3) {}   // 最后兑底: 只保当前局
    return record;
  }
  function storageUsage() {   // 第59轮: 存储用量估算
    var total = 0;
    try {
      for (var k in root.localStorage) {
        if (root.localStorage.hasOwnProperty(k) && k.indexOf('xq_') === 0) total += (root.localStorage[k] || '').length;
      }
    } catch (e) {}
    return { bytes: total * 2, kb: Math.round(total * 2 / 1024) };
  }
  function list() {
    var raw = null;
    try { raw = localStorage.getItem(LS_KEY) || '[]'; } catch (eR) { raw = '[]'; }
    if (_listCache && _listRaw === raw) return _listCache.slice();   // 第37轮: 原始串未变才用 memo (外部写入自愈)
    try {
      var parsed = JSON.parse(raw);
      _listCache = Array.isArray(parsed) ? parsed.filter(function (r) {
        return !!(r && typeof r === 'object' && !Array.isArray(r) && typeof r.id === 'string' && Array.isArray(r.moves));
      }) : [];
    } catch (e) { _listCache = []; }
    _listRaw = raw;
    return _listCache.slice();
  }
  function get(id) {
    return list().find(function (r) { return r.id === id; }) || null;
  }
  function clearReplayState(id) {
    try { localStorage.removeItem('xq_replay_pos_' + id); } catch (e2) {}
    try { localStorage.removeItem('xq_replay:bm:' + id); } catch (e3) {}
  }
  function writeList(records) {
    var previous = list();
    var kept = Object.create ? Object.create(null) : {};
    records.forEach(function (record) { if (record && typeof record.id === 'string') kept['$' + record.id] = true; });
    var raw = JSON.stringify(records);
    localStorage.setItem(LS_KEY, raw);
    _listCache = records;
    _listRaw = raw;
    previous.forEach(function (record) {
      if (record && typeof record.id === 'string' && !kept['$' + record.id]) clearReplayState(record.id);
    });
  }
  function remove(id) {
    var all = list().filter(function (r) { return r.id !== id; });
    try { writeList(all); } catch (e) { return false; }
    return true;
  }

  /* ── 文件导入导出 (浏览器) ── */
  function toPrettyJSON(record) { return JSON.stringify(record, null, 2); }
  function downloadFile(record) {
    var blob = new Blob([toPrettyJSON(record)], { type: 'application/json' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    var safe = function (s) { return String(s || '?').replace(/[^\w.-]+/g, '-').slice(0, 32); };
    var d = new Date(record.date || Date.now());
    var stamp = d.getFullYear() + ('0' + (d.getMonth() + 1)).slice(-2) + ('0' + d.getDate()).slice(-2)
      + '-' + ('0' + d.getHours()).slice(-2) + ('0' + d.getMinutes()).slice(-2);
    a.download = 'xiangqi_' + safe(record.red && record.red.name) + '_vs_' + safe(record.black && record.black.name) + '_' + stamp + '.json';
    a.click();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
  }
  function importFromFile(file) {
    return new Promise(function (resolve, reject) {
      if (file && Number.isFinite(file.size) && file.size > 10 * 1024 * 1024) { reject(new Error('文件超过 10MB 上限')); return; }
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var txt = String(fr.result || '');
          if (txt.length > 10 * 1024 * 1024) throw new Error('文件超过 10MB 上限');
          var r;
          try { r = JSON.parse(txt); } catch (eJ) {
            if (/\[Event /.test(txt)) { r = importFromPGN(txt); }   // 第36轮: PGN 自动识别 (JSON 解析失败且含 [Event 头)
            else throw eJ;
          }
          if (!r || typeof r !== 'object' || Array.isArray(r) || !Array.isArray(r.moves)) throw new Error('文件根节点无效或缺少 moves 字段');
          for (var i = 0; i < r.moves.length; i++) {   // 第28轮: 逐手形状校验 (旧版只查数组, 坏手到回放才炸且难定位)
            var mv = r.moves[i];
            if (!validImportedMove(mv)) {
              throw new Error('第 ' + (i + 1) + ' 手坐标无效 (需 a1-i10 形如 e3/h10)');
            }
          }
          resolve(r);
        } catch (e) { reject(e); }
      };
      fr.onerror = function () { reject(new Error('读取失败')); };
      fr.onabort = function () { reject(new Error('读取已中止')); };
      fr.readAsText(file);
    });
  }

  /* ── v3.9 导入棋谱落库: 独立 id 前缀 import-, 只保留最近 IMPORT_KEEP=2 条 ──
   * 使 #rp=ls:<id> 深链/刷新续看对导入文件也可用, 且不挤占真实对局记录 (真实记录上限 60 独立计算) */
  var IMPORT_PREFIX = 'import-';
  var IMPORT_KEEP = 2;
  function saveImported(rec) {
    var r2 = JSON.parse(JSON.stringify(rec));
    r2.id = IMPORT_PREFIX + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    save(r2);
    var stored = get(r2.id);
    if (!stored) throw new Error('Imported game could not be saved. Local storage may be full or unavailable.');
    return stored;
  }

  /* ── v3.9 一行战绩汇总 (红胜/黑胜/和 + 总手数+吃子+用时): cli / match_headless / 回放统一口径 ── */
  var RESULT_CN = { checkmate: '将杀', stalemate: '困毙', perpetual: '长将判负', repetition: '重复判和', natural: '自然限着判和', resign: '认负', max_plies: '限手数', error: '异常', draw: '协议和', agree: '协议和' };
  function summarize(rec) {
    if (!rec) return '';
    var moves = rec.moves || [], n = moves.length, caps = 0, i;
    for (i = 0; i < n; i++) if (moves[i] && moves[i].captured) caps++;
    var win = rec.winner === 'red' ? '红胜' : rec.winner === 'black' ? '黑胜'
      : (rec.result === 'repetition' || rec.result === 'natural' || rec.result === 'draw' || rec.result === 'agree') ? '和棋' : '未分胜负';
    var secs = Math.round((rec.durationMs || 0) / 1000);
    var dur = secs >= 60 ? Math.floor(secs / 60) + '分' + (secs % 60) + '秒' : secs + '秒';
    var tag = rec.result && rec.result !== 'checkmate' ? ' (' + (RESULT_CN[rec.result] || rec.result) + ')' : '';
    return win + ' · ' + n + '手 · 吃子' + caps + ' · ' + dur + tag;
  }

  /* ── 第36轮 PGN 导入: 解析本仓导出格式 (标准头 + from-to 制着法 + {注释}) ── */
  function pgnMainline(text) {
    var out = [], comment = 0, variation = 0, lineComment = false;
    for (var i = 0; i < text.length; i++) {
      var ch = text.charAt(i);
      if (lineComment) {
        if (ch === '\n' || ch === '\r') { lineComment = false; out.push(' '); }
        continue;
      }
      if (comment) {
        if (ch === '{') comment++;
        else if (ch === '}') comment--;
        continue;
      }
      if (ch === '{') { comment = 1; out.push(' '); continue; }
      if (ch === ';') { lineComment = true; out.push(' '); continue; }
      if (ch === '(') { variation++; out.push(' '); continue; }
      if (ch === ')') { if (variation) variation--; out.push(' '); continue; }
      if (!variation) out.push(ch);
    }
    return out.join('');
  }
  function importFromPGN(text) {
    var lines = String(text || '').split(/\r?\n/);
    var tags = {};
    var moveText = [];
    lines.forEach(function (l) {
      var t = l.trim();
      if (t.charAt(0) === '[') {
        var mTag;   // 第36轮修正: 一行可含多个标签 ([Red "a"] [RedModel "b"]), 全局逐个匹配
        var tagRe = /\[(\w+)\s+"([^"]*)"\]/g;
        while ((mTag = tagRe.exec(t)) !== null) tags[mTag[1]] = mTag[2];
      } else if (t && t.charAt(0) !== '[') {
        moveText.push(t);
      }
    });
    var body = pgnMainline(moveText.join('\n')).replace(/\$\d+/g, ' ');   // 主线坐标不能来自注释、建议着法或变例
    var pairs = [];
    var re = /([a-i](?:10|[1-9]))\s*-\s*([a-i](?:10|[1-9]))/g;   // 第37轮: 宽松连字符空格
    var pm;
    while ((pm = re.exec(body)) !== null) pairs.push({ from: pm[1], to: pm[2] });
    if (!pairs.length) throw new Error('PGN 中未找到着法 (需 from-to 制, 如 e3-e6)');
    // 重建 piece/captured: 逐手用引擎走一遍 (非法即报错, 保证谱面干净)
    var XQE = root.XQ;
    var eng = XQE.Engine.create({ ruleEnforce: false });
    var moves = [];
    for (var i = 0; i < pairs.length; i++) {
      var from = XQE.Move.parseSq(pairs[i].from), to = XQE.Move.parseSq(pairs[i].to);
      var res = eng.applyPlayerMove(from.x, from.y, to.x, to.y);
      if (!res.ok) throw new Error('第 ' + (i + 1) + ' 手 ' + pairs[i].from + '-' + pairs[i].to + ' 非法: ' + (res.reason || ''));
      var mv = res.move;
      moves.push({
        n: i + 1, side: mv.piece.color, piece: mv.piece.type,
        from: pairs[i].from, to: pairs[i].to, name: XQE.Move.name(mv),
        captured: mv.captured ? mv.captured.type : null, timeMs: 0
      });
    }
    var winner = tags.Result === '1-0' ? 'red' : tags.Result === '0-1' ? 'black' : (tags.Result === '1/2-1/2' ? null : null);
    var result = tags.Result === '1-0' || tags.Result === '0-1' ? 'checkmate' : (tags.Result === '1/2-1/2' ? 'draw' : null);
    var rec = {
      id: 'pgn' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
      date: tags.Date && tags.Date !== '????.??.??' ? tags.Date.replace(/\./g, '-') + 'T00:00:00' : new Date().toISOString(),
      red: { name: tags.Red || 'Red', kind: 'llm', model: tags.RedModel || null, style: null, models: null },
      black: { name: tags.Black || 'Black', kind: 'llm', model: tags.BlackModel || null, style: null, models: null },
      moves: moves, result: result, winner: winner,
      durationMs: 0, illegal: 0, tokens: { red: null, black: null },
      note: tags.Termination ? 'PGN Termination: ' + tags.Termination : null
    };
    return rec;
  }

  /* 第55轮: CSV 导出 */
  function csvCell(value) {
    var s = String(value == null ? '' : value);
    if (/^\s*[=+\-@]/.test(s)) s = "'" + s;
    return /[",\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  function exportCSV() {
    var rows = [['name', 'rating', 'games', 'win', 'draw', 'loss']];
    try {
      XQ.Elo.leaderboard().forEach(function (entry) {
        rows.push([entry.name, entry.rating, entry.games, entry.win, entry.draw, entry.loss]);
      });
    } catch (e) {}
    return rows.map(function (r) { return r.map(csvCell).join(','); }).join('\n');
  }
  function parseStoredObject(key, fallback) {
    try {
      var raw = root.localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : fallback;
    } catch (e) { return fallback; }
  }
  /* ── 第30轮 一键备份/恢复: records + Elo + 界面设置 打包为单 JSON ── */
  function exportAll() {
    return {
      kind: 'llm-chess-backup',
      version: 2,
      date: new Date().toISOString(),
      records: list(),
      elo: XQ.Elo.exportTable(),
      settings: parseStoredObject('xq_v1_settings', null)
    };
  }
  function importAllBackup(bak, mode) {
    if (!bak || bak.kind !== 'llm-chess-backup' || !Array.isArray(bak.records)) throw new Error('备份格式无效 (需 llm-chess-backup 导出文件)');
    if (mode != null && mode !== 'merge' && mode !== 'replace') throw new Error('备份导入模式无效');
    var cur = mode === 'replace' ? [] : list();
    var seen = Object.create ? Object.create(null) : {};
    cur.forEach(function (r) { seen['$' + r.id] = true; });
    var incoming = Object.create ? Object.create(null) : {};
    bak.records.forEach(function (r) {
      if (!r || typeof r !== 'object' || Array.isArray(r) || typeof r.id !== 'string' || !Array.isArray(r.moves)
        || r.moves.some(function (mv) { return !validImportedMove(mv); })) return;
      var key = '$' + r.id;
      if (seen[key]) return;
      seen[key] = true; incoming[key] = true; cur.push(r);
    });
    cur = capPools(cur, MAX_RECORDS, IMPORT_KEEP);
    try { writeList(cur); } catch (e) {
      var fallbackLimits = [30, 15];
      var stored = false;
      for (var fi = 0; fi < fallbackLimits.length; fi++) {
        try { cur = capPools(cur, fallbackLimits[fi], IMPORT_KEEP); writeList(cur); stored = true; break; } catch (e2) {}
      }
      if (!stored) throw new Error('棋谱存储失败，请检查本地存储空间');
    }
    var failedParts = [];
    if (bak.elo && typeof bak.elo === 'object') {
      try { XQ.Elo.importTable(bak.elo, mode); } catch (e4) { failedParts.push('elo'); }
    }
    if (bak.settings && typeof bak.settings === 'object' && mode === 'replace') {
      try { root.localStorage.setItem('xq_v1_settings', JSON.stringify(bak.settings)); } catch (e5) { failedParts.push('settings'); }
    }
    var added = cur.filter(function (r) { return incoming['$' + r.id]; }).length;
    return { added: added, skipped: Math.max(0, bak.records.length - added), failedParts: failedParts };
  }

  /* 第80轮数据契约层：回放、备份和研究脚本共用的轻量归一化工具。
   * 这些函数不改变旧存储格式，只在调用方明确请求时复制并收敛外部数据，避免
   * 导入一个带巨大/循环引用元数据的对象后污染后续统计或拖慢回放。 */
  var SAFE_RESULTS = { checkmate: 1, stalemate: 1, perpetual: 1, repetition: 1, natural: 1, resign: 1, max_plies: 1, error: 1, draw: 1, agree: 1 };
  var SAFE_PIECES = { king: 1, advisor: 1, bishop: 1, knight: 1, cannon: 1, rook: 1, pawn: 1 };
  var MAX_DATA_TEXT = 4096;
  function dataText(value, max, fallback) {
    if (value == null) return fallback == null ? '' : fallback;
    var s;
    try { s = String(value); } catch (e) { return fallback == null ? '' : fallback; }
    s = s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '');
    return s.slice(0, max || MAX_DATA_TEXT);
  }
  function finiteNonNegative(value, fallback, cap) {
    var n = Number(value);
    if (!Number.isFinite(n) || n < 0) return fallback == null ? 0 : fallback;
    return Math.min(n, cap == null ? 2147483647 : cap);
  }
  function validRecordId(value) { return typeof value === 'string' && /^[A-Za-z0-9_.:-]{1,160}$/.test(value); }
  function validSquare(value) { return typeof value === 'string' && /^[a-i](?:10|[1-9])$/.test(value); }
  function plainClone(value, depth) {
    if (depth > 8 || value == null || typeof value !== 'object') return value;
    if (Array.isArray(value)) return value.slice(0, 64).map(function (v) { return plainClone(v, depth + 1); });
    var out = {};
    Object.keys(value).slice(0, 128).forEach(function (key) {
      if (key === '__proto__' || key === 'constructor' || key === 'prototype') return;
      var v = value[key];
      if (typeof v !== 'function' && typeof v !== 'symbol') out[key] = plainClone(v, depth + 1);
    });
    return out;
  }
  function normalizePlayerData(value, fallbackName) {
    value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    return {
      name: dataText(value.name, 120, fallbackName),
      kind: dataText(value.kind, 32, 'unknown'),
      model: value.model == null ? null : dataText(value.model, 160, null),
      style: value.style == null ? null : dataText(value.style, 80, null),
      models: Array.isArray(value.models) ? value.models.slice(0, 16).map(function (m) { return dataText(m, 160, ''); }).filter(Boolean) : null
    };
  }
  function normalizeMoveData(value, index) {
    value = value && typeof value === 'object' && !Array.isArray(value) ? value : {};
    var out = {
      n: index + 1,
      side: value.side === 'black' ? 'black' : value.side === 'red' ? 'red' : null,
      piece: SAFE_PIECES[value.piece] ? value.piece : null,
      from: typeof value.from === 'string' ? value.from.toLowerCase().trim().slice(0, 3) : null,
      to: typeof value.to === 'string' ? value.to.toLowerCase().trim().slice(0, 3) : null,
      name: dataText(value.name, 80, ''),
      captured: SAFE_PIECES[value.captured] ? value.captured : null,
      timeMs: finiteNonNegative(value.timeMs, 0, 86400000)
    };
    ['summary', 'plan', 'evaluation', 'voterName'].forEach(function (key) {
      if (value[key] != null) out[key] = dataText(value[key], key === 'summary' ? 240 : 120, '');
    });
    if (typeof value.confidence === 'number' && Number.isFinite(value.confidence)) out.confidence = Math.max(0, Math.min(1, value.confidence));
    if (Array.isArray(value.candidates)) out.candidates = value.candidates.slice(0, 8).map(function (candidate) {
      candidate = candidate && typeof candidate === 'object' ? candidate : {};
      return { move: dataText(candidate.move, 40, ''), score: dataText(candidate.score, 24, '') };
    });
    if (Array.isArray(value.votes)) out.votes = value.votes.slice(0, 16).map(function (vote) {
      vote = vote && typeof vote === 'object' ? vote : {};
      return { model: dataText(vote.model, 80, ''), from: dataText(vote.from, 3, ''), to: dataText(vote.to, 3, ''),
        conf: Number.isFinite(Number(vote.conf)) ? Math.max(0, Math.min(1, Number(vote.conf))) : null,
        weight: Number.isFinite(Number(vote.weight)) ? Math.max(0, Number(vote.weight)) : null,
        changed: vote.changed === true, ok: vote.ok !== false };
    });
    if (typeof value.unanimity === 'boolean') out.unanimity = value.unanimity;
    if (['rotate', 'council', 'roundtable'].indexOf(value.committeeMode) >= 0) out.committeeMode = value.committeeMode;
    return out;
  }
  function normalizeRecordData(value, opts) {
    opts = opts || {};
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
    var maxMoves = Number.isInteger(opts.maxMoves) && opts.maxMoves >= 0 ? Math.min(opts.maxMoves, 100000) : 10000;
    var moves = Array.isArray(value.moves) ? value.moves.slice(0, maxMoves).map(normalizeMoveData) : [];
    var date = new Date(value.date);
    var out = {
      id: validRecordId(value.id) ? value.id : 'normalized-' + Date.now().toString(36),
      date: Number.isNaN(date.getTime()) ? new Date(0).toISOString() : date.toISOString(),
      red: normalizePlayerData(value.red, 'Red'), black: normalizePlayerData(value.black, 'Black'), moves: moves,
      result: value.result == null ? null : (SAFE_RESULTS[value.result] ? value.result : 'error'),
      winner: value.winner === 'red' || value.winner === 'black' ? value.winner : null,
      durationMs: finiteNonNegative(value.durationMs, 0, 315360000000),
      illegal: Math.floor(finiteNonNegative(value.illegal, 0, 1000000)),
      tokens: plainClone(value.tokens, 0) || { red: null, black: null }
    };
    if (value.note != null) out.note = dataText(value.note, 1000, '');
    return out;
  }
  function validateRecordData(value, opts) {
    var errors = [], warnings = [], normalized = normalizeRecordData(value, opts);
    if (!normalized) return { ok: false, errors: ['record must be an object'], warnings: [], record: null };
    if (!validRecordId(value.id)) errors.push('invalid id');
    if (!Array.isArray(value.moves)) errors.push('moves must be an array');
    (Array.isArray(value.moves) ? value.moves : []).forEach(function (move, i) {
      if (!move || !validSquare(typeof move.from === 'string' ? move.from.toLowerCase().trim() : move.from)
        || !validSquare(typeof move.to === 'string' ? move.to.toLowerCase().trim() : move.to)) errors.push('move ' + (i + 1) + ' has invalid coordinates');
      if (move && move.side != null && move.side !== 'red' && move.side !== 'black') warnings.push('move ' + (i + 1) + ' has unknown side');
    });
    if (value.result != null && !SAFE_RESULTS[value.result]) warnings.push('unknown result normalized to error');
    if (value.winner != null && value.winner !== 'red' && value.winner !== 'black') warnings.push('unknown winner normalized to draw');
    return { ok: errors.length === 0, errors: errors, warnings: warnings, record: normalized };
  }
  function canonicalValue(value, stack) {
    if (value == null || typeof value !== 'object') return value;
    stack = stack || [];
    if (stack.indexOf(value) >= 0) return '[Circular]';
    stack.push(value);
    if (Array.isArray(value)) { var arr = value.map(function (item) { return canonicalValue(item, stack); }); stack.pop(); return arr; }
    var out = {};
    Object.keys(value).sort().forEach(function (key) {
      if (key !== '__proto__' && key !== 'constructor' && key !== 'prototype') out[key] = canonicalValue(value[key], stack);
    });
    stack.pop();
    return out;
  }
  function canonicalJSON(value) { return JSON.stringify(canonicalValue(value)); }
  function fingerprint(value) {
    var s = canonicalJSON(value), h = 2166136261;
    for (var i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
    return ('00000000' + (h >>> 0).toString(16)).slice(-8);
  }
  function recordStats(value) {
    var rec = value && Array.isArray(value.moves) ? value : normalizeRecordData(value) || { moves: [] }, moves = rec.moves || [], captures = 0, totalMs = 0;
    moves.forEach(function (move) { if (move && move.captured) captures++; totalMs += finiteNonNegative(move && move.timeMs, 0, 86400000); });
    return { plies: moves.length, captures: captures, quiet: Math.max(0, moves.length - captures), durationMs: finiteNonNegative(rec.durationMs, 0), moveTimeMs: totalMs,
      averageTimeMs: moves.length ? Math.round(totalMs / moves.length * 100) / 100 : 0, illegal: Math.floor(finiteNonNegative(rec.illegal, 0)) };
  }
  function sortRecords(records, descending) {
    return (Array.isArray(records) ? records : []).slice().sort(function (a, b) {
      var ad = new Date(a && a.date).getTime(), bd = new Date(b && b.date).getTime();
      ad = Number.isFinite(ad) ? ad : 0; bd = Number.isFinite(bd) ? bd : 0;
      if (ad !== bd) return descending === false ? ad - bd : bd - ad;
      return String(a && a.id || '').localeCompare(String(b && b.id || ''));
    });
  }
  function dedupeRecords(records) {
    var byId = Object.create(null);
    (Array.isArray(records) ? records : []).forEach(function (rec) {
      if (!rec || !validRecordId(rec.id)) return;
      var old = byId['$' + rec.id];
      if (!old || new Date(rec.date).getTime() >= new Date(old.date).getTime()) byId['$' + rec.id] = rec;
    });
    return sortRecords(Object.keys(byId).map(function (key) { return byId[key]; }));
  }
  function mergeRecords(left, right) { return dedupeRecords((Array.isArray(left) ? left : []).concat(Array.isArray(right) ? right : [])); }
  function estimateRecordBytes(value) { return canonicalJSON(value).length * 2; }
  function compactRecord(value) {
    var rec = normalizeRecordData(value);
    if (!rec) return null;
    rec.moves = rec.moves.map(function (move) { return { n: move.n, side: move.side, piece: move.piece, from: move.from, to: move.to, captured: move.captured, timeMs: move.timeMs }; });
    return rec;
  }
  function parseRecordJSON(text, opts) {
    if (typeof text !== 'string' || text.length > 10 * 1024 * 1024) throw new Error('record JSON exceeds 10MB');
    var value;
    try { value = JSON.parse(text); } catch (e) { throw new Error('invalid record JSON'); }
    var checked = validateRecordData(value, opts);
    if (!checked.ok) throw new Error(checked.errors.join('; '));
    return checked.record;
  }
  function moveAt(value, ply) {
    var rec = value && Array.isArray(value.moves) ? value : null, n = Math.trunc(Number(ply));
    return rec && Number.isFinite(n) && n >= 1 && n <= rec.moves.length ? rec.moves[n - 1] || null : null;
  }
  function resultLabel(value) { return RESULT_CN[value] || (value == null ? '' : dataText(value, 40, '未知')); }

  XQ.Record = {
    blank: blank, addMove: addMove, finish: finish,
    save: save, list: list, get: get, remove: remove,
    saveImported: saveImported, summarize: summarize, importFromPGN: importFromPGN,
    exportAll: exportAll, importAllBackup: importAllBackup, storageUsage: storageUsage, exportCSV: exportCSV,
    toPrettyJSON: toPrettyJSON, downloadFile: downloadFile, importFromFile: importFromFile,
    validRecordId: validRecordId, normalize: normalizeRecordData, validate: validateRecordData,
    canonicalJSON: canonicalJSON, fingerprint: fingerprint, stats: recordStats,
    sortRecords: sortRecords, dedupeRecords: dedupeRecords, mergeRecords: mergeRecords,
    estimateBytes: estimateRecordBytes, compact: compactRecord, parseJSON: parseRecordJSON,
    moveAt: moveAt, resultLabel: resultLabel, clone: plainClone
  };
})(typeof window !== 'undefined' ? window : globalThis);
