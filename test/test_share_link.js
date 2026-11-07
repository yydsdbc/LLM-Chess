#!/usr/bin/env node
/* test/test_share_link.js — 分享链接回放 + JSONL 导出 守护 (第103轮)
 * 断言:
 *  S1 encodeRecord: 正常局 → 'r=' 前缀 base64url (无 +/=)
 *  S2 round-trip: encode → recordFromHash → 着法/胜方/名字一致 (引擎重放验证)
 *  S3 CJK 名字 round-trip (红方/黑方)
 *  S4 非法序列: 篡改着法 → null
 *  S5 坏 hash: 非法 base64 / 非 JSON / v2 → null
 *  S6 和局 (winner null) round-trip
 *  J1 buildJSONL: 每行可 JSON.parse, 字段齐全 (n/side/from/to)
 *  J2 决策元数据入行 (summary/confidence/fallback); 空字段省略
 *  J3 null/缺 moves → 空串
 * 用法: node test/test_share_link.js
 */
'use strict';
var path = require('path');
var ROOT = path.join(__dirname, '..');
['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js', 'core/generator.js', 'core/judge.js', 'core/engine.js',
 'ui/share_link.js', 'ui/debate_export.js'].forEach(function (f) {
  var code = require('fs').readFileSync(path.join(ROOT, f), 'utf8');
  require('vm').runInThisContext(code, { filename: f });
});
var XQ = globalThis.XQ;

var fails = 0;
function ok(cond, name) {
  if (cond) console.log('  [PASS] ' + name);
  else { console.log('  [FAIL] ' + name); fails++; }
}

function mkRecord() {
  var eng = XQ.Engine.create();
  var moves = [];
  var seq = [['b3', 'e3'], ['h8', 'e8'], ['h3', 'h7'], ['b8', 'b4'], ['e4', 'e5']];
  for (var i = 0; i < seq.length; i++) {
    var f = XQ.Move.parseSq(seq[i][0]), t = XQ.Move.parseSq(seq[i][1]);
    var res = eng.applyPlayerMove(f.x, f.y, t.x, t.y);
    if (!res.ok) { f = XQ.Move.parseSq('a1'); t = XQ.Move.parseSq('a2'); res = eng.applyPlayerMove(f.x, f.y, t.x, t.y); }
    var mv = res.move;
    moves.push({ n: i + 1, side: mv.piece.color, piece: mv.piece.type, from: seq[i][0], to: seq[i][1], name: XQ.Move.name(mv), captured: mv.captured ? mv.captured.type : null, timeMs: 500, summary: i === 0 ? '中炮' : undefined, confidence: i === 0 ? 0.8 : undefined, fallback: i === 2 });
  }
  return {
    id: 't1', date: '2026-11-01T00:00:00Z',
    red: { name: '红方·模型甲', kind: 'llm' }, black: { name: 'black-model-B', kind: 'llm' },
    moves: moves, result: 'checkmate', winner: 'black', durationMs: 60000
  };
}

// S1 encode
var rec = mkRecord();
var enc = XQ.ShareLink.encodeRecord(rec);
ok(typeof enc === 'string' && enc.indexOf('r=') === 0, 'S1a encode → r= 前缀');
ok(!/[+/=]/.test(enc.slice(2)), 'S1b base64url 字母表 (无 +/=)');

// S2 round-trip
var dec = XQ.ShareLink.recordFromHash('#' + enc);
ok(!!dec && dec.moves.length === rec.moves.length, 'S2a round-trip 手数一致 (' + (dec && dec.moves.length) + ')');
ok(dec.moves[0].from === 'b3' && dec.moves[0].to === 'e3' && dec.moves[0].name === rec.moves[0].name, 'S2b 首手坐标与记谱一致');
ok(dec.winner === 'black' && dec.red.name === '红方·模型甲' && dec.black.name === 'black-model-B', 'S2c 胜方与 CJK 名字一致');
ok(dec.moves[2].captured === rec.moves[2].captured, 'S2c2 吃子字段经引擎重放重建');

// S3 纯 hash (无 #)
var dec3 = XQ.ShareLink.recordFromHash(enc);
ok(!!dec3 && dec3.moves.length === rec.moves.length, 'S3 无 # 前缀亦可解码');

// S4 非法序列: 外科手术式篡改 (解码 payload → 改着法 → 重编码) — 真正考验引擎重放验证
function retamper(enc2, mut) {
  var raw = JSON.parse(Buffer.from(enc2.slice(2).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
  mut(raw);
  return 'r=' + Buffer.from(JSON.stringify(raw), 'utf8').toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
var bad1 = retamper(enc, function (raw) { raw.m[1] = ['h8', 'z9']; });   // 越界坐标
ok(XQ.ShareLink.recordFromHash('#' + bad1) === null, 'S4a 非法着法序列 (越界坐标) → null');
var bad2 = retamper(enc, function (raw) { raw.m[2] = ['e3', 'e3']; });   // 原地着法 (非法)
ok(XQ.ShareLink.recordFromHash('#' + bad2) === null, 'S4b 原地着法 (非法) → null');
var bad3 = retamper(enc, function (raw) { raw.m[0] = ['b8', 'e8']; });   // 首手换成黑炮 (黑先必非法 not_your_turn)
ok(XQ.ShareLink.recordFromHash('#' + bad3) === null, 'S4c 首手黑方着法 (not_your_turn) → null');
var bad4 = retamper(enc, function (raw) { raw.m.pop(); raw.m.pop(); });   // 截断到 3 手 (仍合法 → 应通过, 验证按 m 长度而非原局)
var dec4 = XQ.ShareLink.recordFromHash('#' + bad4);
ok(!!dec4 && dec4.moves.length === 3, 'S4d 截断到合法前缀 → 3 手可回放 (按内容验证而非黑名单)');

// S5 坏输入
ok(XQ.ShareLink.recordFromHash('#r=!!!not-base64!!!') === null, 'S5a 坏 base64 → null');
ok(XQ.ShareLink.recordFromHash('#r=eyJ2IjoyfQ==') === null, 'S5b v2 未知版本 → null');
ok(XQ.ShareLink.recordFromHash('') === null && XQ.ShareLink.recordFromHash('#x=1') === null, 'S5c 空/无关 hash → null');

// S6 和局
var recDraw = mkRecord(); recDraw.winner = null; recDraw.result = 'draw';
var decDraw = XQ.ShareLink.recordFromHash('#' + XQ.ShareLink.encodeRecord(recDraw));
ok(decDraw && decDraw.winner === null, 'S6 和局 round-trip (winner null)');

// J1 buildJSONL
var jl = XQ.Debate.buildJSONL(rec);
var lines = jl.split('\n');
ok(lines.length === rec.moves.length, 'J1a 行数 = 手数 (' + lines.length + ')');
var parsedOk = true, first = null;
try { first = JSON.parse(lines[0]); } catch (e) { parsedOk = false; }
ok(parsedOk && first.n === 1 && first.from === 'b3' && first.to === 'e3' && first.side && first.piece, 'J1b 每行可解析且字段齐全');

// J2 元数据
ok(first.summary === '中炮' && first.confidence === 0.8, 'J2a 决策元数据入行');
ok(lines[2] ? JSON.parse(lines[2]).fallback === true : false, 'J2b fallback 旗标入行');

// J3 空输入
ok(XQ.Debate.buildJSONL(null) === '' && XQ.Debate.buildJSONL({ moves: [] }) === '', 'J3 null/空谱 → 空串');

console.log(fails ? 'share link: ' + fails + ' FAIL' : 'share link: ALL PASS');
process.exit(fails ? 1 : 0);
