#!/usr/bin/env node
/* test/test_arena_fx.js — 赛事弹幕 / VS 开场卡 纯函数守护 (第95轮)
 * 断言:
 *  D1 buildDanmaku: capture/check/perpetual/fallback → 正确文案键; 未知类型 → null
 *  D2 去重签名: 同类型不同 ply/captured/side → 不同 sig (不误去重)
 *  D3 参数: capture 带 {piece}; fallback 带 side+ply (tArgs 占位符可达)
 *  F1 buildData: 有战绩 → record {w,d,l} + rating 保留一位小数
 *  F2 buildData: 无对局 (games 0) → rating '—' + record null
 *  F3 buildData: 非数值/缺 stats → '—' 不炸; 名字缺省 '?'
 *  F4 buildData: 纯函数不变异输入
 * 用法: node test/test_arena_fx.js
 */
'use strict';
var path = require('path');
var ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'ui', 'danmaku.js'));
require(path.join(ROOT, 'ui', 'fight_card.js'));
var DK = globalThis.XQ.Danmaku, FC = globalThis.XQ.FightCard;

var fails = [];
function ok(cond, msg) {
  if (cond) { console.log('  [PASS] ' + msg); }
  else { console.log('  [FAIL] ' + msg); fails.push(msg); }
}

// D1 文案键
ok(DK.buildDanmaku({ type: 'capture', captured: '车', ply: 9 }).key === 'dk_capture', 'D1a capture → dk_capture');
ok(DK.buildDanmaku({ type: 'check', ply: 10 }).key === 'dk_check', 'D1b check → dk_check');
ok(DK.buildDanmaku({ type: 'perpetual', side: 'red' }).key === 'dk_perpetual', 'D1c perpetual → dk_perpetual');
ok(DK.buildDanmaku({ type: 'fallback', side: 'black', ply: 12 }).key === 'dk_fallback', 'D1d fallback → dk_fallback');
ok(DK.buildDanmaku({ type: 'unknown' }) === null && DK.buildDanmaku(null) === null, 'D1e 未知/空事件 → null');

// D2 签名区分
var s1 = DK.buildDanmaku({ type: 'capture', captured: '车', ply: 9 }).sig;
var s2 = DK.buildDanmaku({ type: 'capture', captured: '马', ply: 9 }).sig;
var s3 = DK.buildDanmaku({ type: 'capture', captured: '车', ply: 11 }).sig;
var s4 = DK.buildDanmaku({ type: 'fallback', side: 'red', ply: 5 }).sig;
var s5 = DK.buildDanmaku({ type: 'fallback', side: 'black', ply: 5 }).sig;
ok(s1 !== s2 && s1 !== s3, 'D2a capture 签名随 captured/ply 区分');
ok(s4 !== s5, 'D2b fallback 签名随 side 区分');
ok(DK.buildDanmaku({ type: 'capture', captured: '车', ply: 9 }).sig === s1, 'D2c 同事件同 sig (去重可达)');

// D3 参数
var d3 = DK.buildDanmaku({ type: 'capture', captured: '砲' });
ok(d3.args.piece === '砲', 'D3a capture args.piece 透传 (占位符 {piece})');
var d4 = DK.buildDanmaku({ type: 'fallback', side: 'red', ply: 7 });
ok(d4.args.side === 'red' && d4.args.ply === 7, 'D3b fallback args 透传 (side/ply)');

// F1 有战绩
var f1 = FC.buildData({
  redName: 'glm-5.3-flash', blackName: 'deepseek-chat',
  redRating: 1543.66, blackRating: 1456.3,
  redStats: { games: 9, win: 5, draw: 2, loss: 2 }, blackStats: { games: 9, win: 2, draw: 2, loss: 5 }
});
ok(f1.red.rating === '1543.7' && f1.red.record.w === 5 && f1.red.record.l === 2, 'F1a red: rating 一位小数 + record');
ok(f1.black.rating === '1456.3' && f1.black.record.d === 2, 'F1b black 同口径');

// F2 无对局
var f2 = FC.buildData({ redName: '新人', blackName: '老将', redRating: 1500, blackRating: 1500, redStats: { games: 0, win: 0, draw: 0, loss: 0 } });
ok(f2.red.rating === '—' && f2.red.record === null, 'F2a games 0 → rating — / record null');
ok(f2.black.rating === '—', 'F2b black 无战绩 → —');

// F3 缺失不炸
var f3 = FC.buildData({ redName: 'A', blackName: 'B' });
ok(f3.red.rating === '—' && f3.black.name === 'B', 'F3a 缺 stats 不炸');
var f4 = FC.buildData({});
ok(f4.red.name === '?' && f4.red.rating === '—', 'F3b 全空 → 名字 ? / rating —');
var f5 = FC.buildData({ redName: 'X', redRating: NaN, redStats: { games: 3, win: 1, draw: 1, loss: 1 }, blackName: 'Y', blackRating: Infinity });
ok(f5.red.rating === '—' && f5.black.rating === '—', 'F3c NaN/Infinity → —');

// F4 纯函数
var input = { redName: 'A', blackName: 'B', redStats: { games: 1, win: 1, draw: 0, loss: 0 } };
var snap = JSON.stringify(input);
FC.buildData(input);
ok(JSON.stringify(input) === snap, 'F4 输入不被变异');

console.log(fails.length ? 'arena fx: ' + fails.length + ' FAIL' : 'arena fx: ALL PASS');
process.exit(fails.length ? 1 : 0);
