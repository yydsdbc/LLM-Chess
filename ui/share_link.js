/* ui/share_link.js — 对局分享链接 (第103轮, 零依赖): 把整局着法编码进 URL hash, 任何人点开链接即可看回放
 *
 * 对标 GitHub 生态的可分享产物模式 (每场对局 = 一个传播载体, 静态托管零后端)。
 *
 * 格式: #r=<base64url(JSON)>
 *   JSON = { v:1, r:红方名, b:黑方名, w:'red'|'black'|null, m:[['b3','e3'],...] }
 *   CJK 名字经 UTF-8 → base64url (btoa 不支持非 Latin1, 手动编码)。
 *
 * 解码: recordFromHash(hash) 逐手用引擎重放验证 (与 PGN 导入同口径) — 非法着法/坏 hash → null。
 * Node 直测: encodeRecord/decodeHash 纯函数 (decode 只依赖 core/ 引擎链)。
 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};

  function b64urlEncode(str) {
    var bytes = new TextEncoder().encode(str);
    var bin = '';
    for (var i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
    return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function b64urlDecode(enc) {
    var norm = String(enc).replace(/-/g, '+').replace(/_/g, '/');
    while (norm.length % 4) norm += '=';
    var bin = atob(norm);
    var bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  /* 编码: record (含 moves from/to + winner) → 'r=<b64url>' (不含 '#') */
  function encodeRecord(record) {
    if (!record || !Array.isArray(record.moves)) return null;
    var m = record.moves.map(function (mv) { return [mv.from, mv.to]; });
    var payload = {
      v: 1,
      r: record.red && record.red.name || 'Red',
      b: record.black && record.black.name || 'Black',
      w: record.winner || null,
      m: m
    };
    return 'r=' + b64urlEncode(JSON.stringify(payload));
  }

  /* 解码+验证: hash ('#r=...' 或 'r=...') → 可回放棋谱对象 (引擎逐手重放, 与 PGN 导入同口径); 失败 → null */
  function recordFromHash(hash) {
    try {
      var h = String(hash == null ? '' : hash);
      var pos = h.indexOf('r=');
      if (pos < 0) return null;
      var payload = JSON.parse(b64urlDecode(h.slice(pos + 2)));
      if (!payload || payload.v !== 1 || !Array.isArray(payload.m) || !payload.m.length) return null;
      if (payload.w !== null && payload.w !== 'red' && payload.w !== 'black') return null;
      var eng = XQ.Engine.create({ ruleEnforce: false });
      var moves = [];
      for (var i = 0; i < payload.m.length; i++) {
        var pair = payload.m[i];
        if (!Array.isArray(pair) || pair.length !== 2) return null;
        var from = XQ.Move.parseSq(pair[0]), to = XQ.Move.parseSq(pair[1]);
        if (!from || !to) return null;
        var res = eng.applyPlayerMove(from.x, from.y, to.x, to.y);
        if (!res.ok) return null;   // 非法序列 (篡改/截断) → 整条拒绝
        var mv = res.move;
        moves.push({
          n: i + 1, side: mv.piece.color, piece: mv.piece.type,
          from: pair[0], to: pair[1], name: XQ.Move.name(mv),
          captured: mv.captured ? mv.captured.type : null, timeMs: 0
        });
      }
      var winner = payload.w;
      return {
        id: 'share' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5),
        date: new Date().toISOString(),
        red: { name: payload.r || 'Red', kind: 'llm', model: null, style: null, models: null },
        black: { name: payload.b || 'Black', kind: 'llm', model: null, style: null, models: null },
        moves: moves,
        result: winner ? 'checkmate' : 'draw',   // 语义近似: 链接只携带胜负, 终局原因不进链接
        winner: winner,
        durationMs: 0, illegal: 0,
        tokens: { red: null, black: null }
      };
    } catch (e) {
      return null;
    }
  }

  XQ.ShareLink = { encodeRecord: encodeRecord, recordFromHash: recordFromHash };
})(typeof window !== 'undefined' ? window : globalThis);
