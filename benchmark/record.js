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
      red: { name: opts.redName || 'Red', kind: opts.redKind || 'human', model: opts.redModel || null, style: opts.redStyle || null },
      black: { name: opts.blackName || 'Black', kind: opts.blackKind || 'human', model: opts.blackModel || null, style: opts.blackStyle || null },
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
    }
    record.moves.push(e);
  }

  function finish(record, engineResult, durationMs) {
    record.result = engineResult.result;
    record.winner = engineResult.winner;
    record.durationMs = durationMs || (Date.now() - new Date(record.date).getTime());
    return record;
  }

  /* ── localStorage 存取 ──
   * v1.7.6: 上限 MAX_RECORDS=60 (防 localStorage 无限膨胀) + 配额兑底
   * (QuotaExceeded → 逐级裁剪重试: 留30 → 留15 → 只存当前局, 保证刚下的这局永不丢) */
  var MAX_RECORDS = 60;
  function save(record) {
    var all = list();
    var i = all.findIndex(function (r) { return r.id === record.id; });
    if (i >= 0) { all.splice(i, 1); }   // 更新也视为最近活动: 移到末尾再截断, 上限裁剪按活跃度
    all.push(record);
    if (all.length > MAX_RECORDS) all = all.slice(all.length - MAX_RECORDS);
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(all));
    } catch (e) {
      var tryKeep = [30, 15];
      for (var t = 0; t < tryKeep.length; t++) {
        try { localStorage.setItem(LS_KEY, JSON.stringify(all.slice(-tryKeep[t]))); return record; } catch (e2) {}
      }
      try { localStorage.setItem(LS_KEY, JSON.stringify([record])); } catch (e3) {}   // 最后兑底: 只保当前局
    }
    return record;
  }
  function list() {
    try { return JSON.parse(localStorage.getItem(LS_KEY) || '[]'); } catch (e) { return []; }
  }
  function get(id) {
    return list().find(function (r) { return r.id === id; }) || null;
  }
  function remove(id) {
    var all = list().filter(function (r) { return r.id !== id; });
    try { localStorage.setItem(LS_KEY, JSON.stringify(all)); } catch (e) {}
    // 第28轮: 孤儿键内聚清理 (回放进度/书签随棋谱删除; 原只 rpDeleteRecord 手工清, 其它调用方漏网)
    try { localStorage.removeItem('xq_replay_pos_' + id); } catch (e2) {}
    try { localStorage.removeItem('xq_replay:bm:' + id); } catch (e3) {}
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
      var fr = new FileReader();
      fr.onload = function () {
        try {
          var txt = String(fr.result || '');
          if (txt.length > 10 * 1024 * 1024) throw new Error('文件超过 10MB 上限');
          var r = JSON.parse(txt);
          if (!r.moves || !Array.isArray(r.moves)) throw new Error('缺少 moves 字段');
          for (var i = 0; i < r.moves.length; i++) {   // 第28轮: 逐手形状校验 (旧版只查数组, 坏手到回放才炸且难定位)
            var mv = r.moves[i];
            if (!mv || typeof mv.from !== 'string' || typeof mv.to !== 'string'
              || !/^[a-i](10|[1-9])$/.test(mv.from) || !/^[a-i](10|[1-9])$/.test(mv.to)) {
              throw new Error('第 ' + (i + 1) + ' 手坐标无效 (需 a1-i10 形如 e3/h10)');
            }
          }
          resolve(r);
        } catch (e) { reject(e); }
      };
      fr.onerror = function () { reject(new Error('读取失败')); };
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
    var all = list();
    var imps = all.filter(function (r) { return r && typeof r.id === 'string' && r.id.indexOf(IMPORT_PREFIX) === 0; });
    for (var i = 0; i < imps.length - IMPORT_KEEP; i++) remove(imps[i].id);   // 超出保留数的旧导入清掉 (list 为旧→新序)
    return r2;
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

  XQ.Record = {
    blank: blank, addMove: addMove, finish: finish,
    save: save, list: list, get: get, remove: remove,
    saveImported: saveImported, summarize: summarize,
    toPrettyJSON: toPrettyJSON, downloadFile: downloadFile, importFromFile: importFromFile
  };
})(typeof window !== 'undefined' ? window : globalThis);
