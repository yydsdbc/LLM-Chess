/* ui/debate_export.js — 第85轮: 委员会/圆桌辩论实录导出 (Markdown 下载)
 * 数据源: 棋谱每手 meta (record.js 落谱的 summary/plan/candidates/votes[]/unanimity/committeeMode/voterName)。
 * 结构: buildMarkdown(record, L) 纯函数 (Node 直测, L = 调用方 t() 解析好的标签表) → md 字符串;
 *       download() 浏览器 Blob → <a download>。人类走子不出现在实录 (只记 LLM 决策)。
 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};

  /* 单手块: meta 里有什么就写什么, 人类手/裸手返回 '' */
  function moveBlock(mv, idx, L) {
    if (!mv || mv.kind === 'human') return '';
    var meta = mv.meta || {};
    var lines = [];
    var sideTxt = mv.side === 'red' ? L.red : mv.side === 'black' ? L.black : '';
    var hdr = L.move.replace('{n}', String(idx + 1)).replace('{side}', sideTxt).replace('{mv}', mv.name || (mv.from + '→' + toCoor(mv)));
    var capTxt = mv.captured != null ? mv.captured : meta.captured;   // record.js 落谱: captured 是 move 顶层字段
    if (capTxt) hdr += ' ' + L.captured.replace('{p}', String(capTxt));
    lines.push('### ' + hdr);
    if (meta.voterName) {
      lines.push('- ' + L.finalPick.replace('{v}', String(meta.voterName))
        + (meta.unanimity === true ? ' (' + L.unanim + ')' : ''));
    }
    if (meta.plan) lines.push('- ' + L.plan + ': ' + meta.plan);
    if (meta.summary) lines.push('- ' + L.summary + ': ' + meta.summary);
    if (meta.evaluation) lines.push('- ' + L.evaln + ': ' + meta.evaluation);
    if (typeof meta.confidence === 'number') lines.push('- ' + L.conf + ': ' + Math.round(meta.confidence * 100) + '%');
    if (Array.isArray(meta.votes) && meta.votes.length) {
      lines.push('');
      lines.push('| ' + L.vModel + ' | ' + L.vProp + ' | ' + L.vConf + ' | ' + L.vChg + ' |');
      lines.push('|---|---|---|---|');
      meta.votes.forEach(function (v) {
        lines.push('| ' + (v.model || '?') + ' | ' + (v.ok === false ? '~~' + v.from + v.to + '~~' : (v.from + v.to))
          + ' | ' + (v.conf == null ? '-' : Math.round(v.conf * 100) + '%')
          + ' | ' + (v.changed ? L.yesMark : '') + ' |');
      });
    }
    if (Array.isArray(meta.candidates) && meta.candidates.length) {
      lines.push('- ' + L.cands + ': ' + meta.candidates.map(function (c) { return c.move + (c.score ? '(' + c.score + ')' : ''); }).join(' / '));
    }
    return lines.join('\n');
  }
  /* 记谱坐标兜底: move 条目有 from/to 数字坐标时拼 'x,y→x,y' */
  function toCoor(mv) {
    return mv.from && typeof mv.from.x === 'number' ? (mv.from.x + ',' + mv.from.y + '→' + mv.to.x + ',' + mv.to.y) : '?';
  }

  function buildMarkdown(record, L) {
    record = record || {};
    var L2 = L || {};
    var red = String(record.red && record.red.name || record.red || '?');
    var black = String(record.black && record.black.name || record.black || '?');
    var head = '# ' + (L2.title || 'Debate transcript') + '\n\n'
      + '> ' + red + ' vs ' + black
      + ' · ' + String(record.date || record.stamp || '').slice(0, 19)
      + (record.result ? ' · ' + String(record.result) : '') + '\n\n'
      + (L2.footer || '') + '\n';
    var body = [];
    var moves = Array.isArray(record.moves) ? record.moves : [];
    for (var i = 0; i < moves.length; i++) {
      var blk = moveBlock(moves[i], i, L2);
      if (blk) body.push(blk);
    }
    if (!body.length) body.push('_' + (L2.empty || 'No LLM decision metadata.') + '_');
    return head + body.join('\n\n') + '\n';
  }

  function download(md, filename) {
    var doc = root.document;
    if (!doc) return false;
    var blob = new Blob([md], { type: 'text/markdown;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = doc.createElement('a');
    a.href = url;
    a.download = filename || 'llm-chess-debate.md';
    doc.body.appendChild(a);
    a.click();
    setTimeout(function () { doc.body.removeChild(a); URL.revokeObjectURL(url); }, 200);
    return true;
  }

  XQ.Debate = { buildMarkdown: buildMarkdown, moveBlock: moveBlock, download: download };
})(typeof window !== 'undefined' ? window : this);
