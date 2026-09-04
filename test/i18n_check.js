#!/usr/bin/env node
/* test/i18n_check.js — i18n 字典/覆盖守护 (v1.0.daily 第4轮, npm test 第8套件)
 * 断言:
 *  I1 zh/en 键集一致 (缺失/多出逐键点名)
 *  I2 全部键值非空
 *  I3 占位符 {xxx} 集合 zh/en 逐键一致 (tArgs 参数双语同形)
 *  I4 index.html data-i18n / -title / -aria 引用的键全部存在于字典
 *  I5 ui/ + replay/ JS 里 t('key') / tArgs('key') 字面量键全部存在
 *  I6 关键哨兵键 (状态条/回放动态面板) 双语齐全
 * 用法: node test/i18n_check.js
 */
'use strict';
var fs = require('fs');
var path = require('path');
var ROOT = path.join(__dirname, '..');
require(path.join(ROOT, 'ui', 'i18n.js'));
var I = globalThis.XQ.I18N;

var fails = [];
function ok(cond, msg) {
  if (cond) { console.log('  [PASS] ' + msg); }
  else { console.log('  [FAIL] ' + msg); fails.push(msg); }
}

var ZH = I.STRINGS.zh, EN = I.STRINGS.en;
var zk = Object.keys(ZH), ek = Object.keys(EN);
console.log('i18n_check — 字典键数 zh=' + zk.length + ' en=' + ek.length);

// I1 键集一致
var onlyZh = zk.filter(function (k) { return EN[k] == null; });
var onlyEn = ek.filter(function (k) { return ZH[k] == null; });
ok(zk.length === ek.length && onlyZh.length === 0 && onlyEn.length === 0,
  'I1 zh/en 键集一致' + (onlyZh.length ? ' (仅zh: ' + onlyZh.join(',') + ')' : '') + (onlyEn.length ? ' (仅en: ' + onlyEn.join(',') + ')' : ''));

// I2 非空
var empties = zk.filter(function (k) { return typeof ZH[k] !== 'string' || ZH[k].length === 0 || typeof EN[k] !== 'string' || EN[k].length === 0; });
ok(empties.length === 0, 'I2 键值非空' + (empties.length ? ' (空: ' + empties.join(',') + ')' : ''));

// I3 占位符一致
function ph(s) { return (String(s).match(/\{\w+\}/g) || []).sort().join(','); }
var phBad = zk.filter(function (k) { return EN[k] != null && ph(ZH[k]) !== ph(EN[k]); });
ok(phBad.length === 0, 'I3 占位符 zh/en 逐键一致' + (phBad.length ? ' (不一致: ' + phBad.join(',') + ')' : ''));

// I4 index.html 静态引用覆盖
var html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
var reAttr = /data-i18n(?:-title|-aria)?="([a-z0-9_]+)"/g;
var attrKeys = {}, m;
while ((m = reAttr.exec(html)) != null) attrKeys[m[1]] = true;
var attrList = Object.keys(attrKeys);
var attrMissing = attrList.filter(function (k) { return ZH[k] == null; });
ok(attrList.length >= 30 && attrMissing.length === 0,
  'I4 index.html 引用键覆盖 (' + attrList.length + ' 键)' + (attrMissing.length ? ' (缺失: ' + attrMissing.join(',') + ')' : ''));

// I5 JS 字面量 t()/tArgs() 覆盖
var jsFiles = ['ui/app.js', 'ui/renderer.js', 'replay/replay.js', 'replay/replay_controller.js'];
var reT = /\bt\(\s*'([a-z0-9_]+)'\s*[,)]/g;
var reTArgs = /\btArgs\(\s*'([a-z0-9_]+)'/g;
var jsKeys = {}, jsCount = 0;
jsFiles.forEach(function (f) {
  var src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  var mm;
  while ((mm = reT.exec(src)) != null) { jsKeys[mm[1]] = true; jsCount++; }
  while ((mm = reTArgs.exec(src)) != null) { jsKeys[mm[1]] = true; jsCount++; }
});
var jsList = Object.keys(jsKeys);
var jsMissing = jsList.filter(function (k) { return ZH[k] == null; });
ok(jsList.length >= 10 && jsMissing.length === 0,
  'I5 JS 字面量键覆盖 (' + jsCount + ' 处/' + jsList.length + ' 键)' + (jsMissing.length ? ' (缺失: ' + jsMissing.join(',') + ')' : ''));

// I6 哨兵键
var sentinels = ['status_thinking', 'status_win_red', 'rp_eta', 'rp_help_title_h', 'warn_blocked', 'rp_suspect'];
var sMissing = sentinels.filter(function (k) { return ZH[k] == null || EN[k] == null; });
ok(sMissing.length === 0, 'I6 哨兵键双语齐全' + (sMissing.length ? ' (缺: ' + sMissing.join(',') + ')' : ''));

console.log('i18n_check: ' + (6 - fails.length) + '/6 groups PASS, ' + zk.length + ' keys');
if (fails.length) { process.exit(1); }
process.exit(0);
