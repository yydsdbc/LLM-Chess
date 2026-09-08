#!/usr/bin/env node
/* test/i18n_check.js — i18n 字典/覆盖守护 (v1.0.daily 第4轮, npm test 第8套件)
 * 断言:
 *  I1 zh/en 键集一致 (缺失/多出逐键点名)
 *  I2 全部键值非空
 *  I3 占位符 {xxx} 集合 zh/en 逐键一致 (tArgs 参数双语同形)
 *  I4 index.html data-i18n / -title / -aria 引用的键全部存在于字典
 *  I5 ui/ + replay/ JS 里 t('key') / tArgs('key') 字面量键全部存在
 *  I6 关键哨兵键 (状态条/回放动态面板) 双语齐全
 *  I7 静态 CJK 裸文本必须挂 data-i18n/-aria (第23轮)
 *  I8 静态 CJK 属性 (title/aria-label/placeholder) 必须挂对应 data-i18n 标记 (第24轮)
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

// I5 JS 字面量 t()/tArgs() 覆盖 — 第26轮拓宽: 本地别名 (T/TA/Ts/TAs/TwE/TI… 大小写 T 家族) 同样是字典调用,
//   原正则只认 \bt\(/tArgs\( 时别名调用从未被守护 (68 处 T( 历史盲区)。T 家族 + 排除名单。
var jsFiles = ['ui/app.js', 'ui/renderer.js', 'replay/replay.js', 'replay/replay_controller.js'];
var reT = /\b([tT][A-Za-z0-9]*)\(\s*'([a-z0-9_]+)'\s*[,)]/g;
var I5_DENY = { toggle: 1, thinkPanel: 1, rpToggleBookmark: 1 };   // classList.toggle('类名') / XQ.UI.thinkPanel(方别) / 书签切换 同形误报 (非字典调用)
var jsKeys = {}, jsCount = 0;
jsFiles.forEach(function (f) {
  var src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  var mm;
  while ((mm = reT.exec(src)) != null) { if (I5_DENY[mm[1]]) continue; jsKeys[mm[2]] = true; jsCount++; }
});
var jsList = Object.keys(jsKeys);
var jsMissing = jsList.filter(function (k) { return ZH[k] == null; });
ok(jsList.length >= 10 && jsMissing.length === 0,
  'I5 JS 字面量键覆盖 (' + jsCount + ' 处/' + jsList.length + ' 键)' + (jsMissing.length ? ' (缺失: ' + jsMissing.join(',') + ')' : ''));

// I6 哨兵键
var sentinels = ['status_thinking', 'status_win_red', 'rp_eta', 'rp_help_title_h', 'warn_blocked', 'rp_suspect'];
var sMissing = sentinels.filter(function (k) { return ZH[k] == null || EN[k] == null; });
ok(sMissing.length === 0, 'I6 哨兵键双语齐全' + (sMissing.length ? ' (缺: ' + sMissing.join(',') + ')' : ''));

// I7 第23轮: 静态 CJK 裸文本漏挂守护 — 非脚本区元素文本含中文必须有 data-i18n/-aria 标记
//   (data-i18n-title 只译 title 属性, 不算文本标记 — 第22轮 `n 事故同源盲区: 静态文本此前无守护)
//   豁免: option (服务商品牌名/语言名; provider 列表还由 /api/providers 动态覆盖)、
//         meta (SEO description 有意中文)、#status-text (renderer.renderStatus 按对局状态动态管理, 静态键会在语言切换时误覆盖)
var htmlNoScript = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
var tagRe7 = /<(\w+)([^>]*)>([^<]*)/g;
var miss7 = [], mm7;
var CJK7 = /[\u4e00-\u9fff]/;
while ((mm7 = tagRe7.exec(htmlNoScript)) != null) {
  var tag7 = mm7[1], attrs7 = mm7[2] || '', text7 = mm7[3] || '';
  if (tag7 === 'style' || tag7 === 'option' || tag7 === 'meta') continue;
  if (/(?:^|\s)id="status-text"/.test(attrs7)) continue;
  if (!CJK7.test(text7)) continue;
  if (/data-i18n=/.test(attrs7) || /data-i18n-aria/.test(attrs7)) continue;
  miss7.push('<' + tag7 + '> "' + text7.trim().slice(0, 30) + '"');
}
ok(miss7.length === 0, 'I7 静态 CJK 文本 data-i18n 挂载' + (miss7.length ? ' (漏挂: ' + miss7.join(' ; ') + ')' : ' (0 漏挂)'));

// I8 第24轮: 静态属性 CJK 漏挂守护 — title=/aria-label=/placeholder= 含中文必须挂对应 data-i18n 标记
//   (I7 只查文本节点; 属性是同源盲区的另一半 — apply() 仅在挂了 data-i18n-title/-aria/-i18n 时才翻译对应属性)
var tagRe8 = /<(\w+)([^>]*)>/g;
var miss8 = [], mm8;
while ((mm8 = tagRe8.exec(htmlNoScript)) != null) {
  var tag8 = mm8[1], attrs8 = mm8[2] || '';
  if (tag8 === 'script' || tag8 === 'style' || tag8 === 'option') continue;   // option 同 I7 豁免 (品牌名/语言名)
  var mT8 = attrs8.match(/(?:^|\s)title="([^"]*)"/);
  if (mT8 && CJK7.test(mT8[1]) && !/data-i18n-title=/.test(attrs8)) miss8.push('<' + tag8 + '> title="' + mT8[1].trim().slice(0, 20) + '"');
  var mA8 = attrs8.match(/(?:^|\s)aria-label="([^"]*)"/);
  if (mA8 && CJK7.test(mA8[1]) && !/data-i18n-aria=/.test(attrs8)) miss8.push('<' + tag8 + '> aria-label="' + mA8[1].trim().slice(0, 20) + '"');
  var mP8 = attrs8.match(/(?:^|\s)placeholder="([^"]*)"/);
  if (mP8 && CJK7.test(mP8[1]) && !/data-i18n=/.test(attrs8)) miss8.push('<' + tag8 + '> placeholder="' + mP8[1].trim().slice(0, 20) + '"');
}
ok(miss8.length === 0, 'I8 静态 CJK 属性 data-i18n 挂载' + (miss8.length ? ' (漏挂: ' + miss8.join(' ; ') + ')' : ' (0 漏挂)'));

console.log('i18n_check: ' + (8 - fails.length) + '/8 groups PASS, ' + zk.length + ' keys');
if (fails.length) { process.exit(1); }
process.exit(0);
