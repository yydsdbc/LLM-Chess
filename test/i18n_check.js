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
 *  I9 JS 侧动态属性 CJK 守护 — JS 模板串里的 title=/placeholder=/aria-label= 含中文必须同串挂 data-i18n* 标记,
 *     .title = '…中文…' 赋值必须走 t/tArgs 家族 (第27轮; I8 只扫 index.html, JS 构建的 DOM 是第三盲区)
 *  I10 JS 动态写入口 (textContent=/aiBanner()/innerHTML=) 裸中文必须走 t 家族或挂 data-i18n (第37轮)
 *  I11 T 家族同行引用的 snake_case 字面量键必须存在于字典 — 补 I5 只认「键紧跟左括号」的盲区 (第40轮)
 *  I12 按钮文案含中文必须挂 data-i18n (非仅 -title) (第43轮)
 *  I13 偏好类下拉 (#ui-pieces) 的 option 文案必须挂 data-i18n 且键双语齐备 (第43轮)
 *  I14 JS 模板里的 data-i18n* 引用键必须存在于字典 — 补 I4 (只扫 index.html) / I5 (只认 t() 调用) 的第四盲区 (第44轮)
 *  I15 纯符号/emoji 按钮必须有无障碍名称 (aria-label / data-i18n-aria) (第44轮)
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

// I9 第27轮: JS 侧动态属性/文本 CJK 守护 — I8 只扫 index.html 静态区, JS 构建的 DOM (rpEnsure 模板/动态节点)
//   是同源盲区另一半: 回放工具条 title 曾靠 I5 间接覆盖, 而 .title='中文' 赋值 (走法条目) 与 JS 模板
//   placeholder/文本节点完全无守护 (EN 实机截图抓漏 d-more 折叠行)。规则 (逐行, 模板串每行自带闭合引号):
//   a) 行内 title="/placeholder="/aria-label=" 含 CJK → 同行必须出现 data-i18n 标记 (apply() 才会翻译);
//   b) 行内 .title = '…CJK…' 直接赋值 → 同行必须走 t/tArgs 家族调用 (T 家族别名均计);
//   c) 行内模板串 >…CJK…< 文本节点 → 同行必须走 t() 家族或挂 data-i18n 标记; 豁免盘面装饰 (楚河/汉界)。
var miss9 = [];
var I9_DENY_TEXT = ['>楚 河<', '>汉 界<'];   // 盘面中央装饰字 — 语言中立, 有意中文 (象棋盘传统)
jsFiles.forEach(function (f) {
  fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/).forEach(function (line, i) {
    if (!CJK7.test(line)) return;
    var ln = f + ':' + (i + 1);
    var attrRe9 = /(?:title|placeholder|aria-label)="([^"]*)"/g, am9;
    while ((am9 = attrRe9.exec(line)) != null) {
      if (CJK7.test(am9[1]) && !/data-i18n/.test(line)) miss9.push(ln + ' ' + am9[0].slice(0, 40));
    }
    var dm9 = line.match(/\.title\s*=\s*(['"])((?:(?!\1).)*)\1/);   // 只看赋值右侧首段字面量 — 行尾中文注释不计 (防误报)
    if (dm9 && CJK7.test(dm9[2]) && !/[tT][A-Za-z0-9]*\(/.test(line)) miss9.push(ln + ' .title="' + dm9[2].slice(0, 30) + '"');
    if (!/[tT][A-Za-z0-9]*\(/.test(line) && !/data-i18n/.test(line) && !I9_DENY_TEXT.some(function (d) { return line.indexOf(d) >= 0; })) {
      var tm9 = line.match(/['"`][^'"`]*>[^<>{}]*[\u4e00-\u9fff][^<>]*</);
      if (tm9) miss9.push(ln + ' 模板文本 ' + JSON.stringify(tm9[0].slice(0, 36)));
    }
  });
});
ok(miss9.length === 0, 'I9 JS 侧属性/文本 CJK 挂载/走 t()' + (miss9.length ? ' (漏挂: ' + miss9.join(' ; ') + ')' : ' (0 漏挂)'));

// I10 第37轮: JS 动态 UI 写入口裸中文守护 — I9 覆盖属性与模板文本, 但 .textContent= 赋值与 aiBanner() 消息参数
//   (innerHTML 注入) 是第三盲区: 状态行 第N手·时间 / 底部横幅 全局 X:XX / 会诊中 n/m 已应答 / tick 总思考
//   曾以裸中文漏进 EN 界面 (EN 实机截图抓漏)。规则 (逐行, 跳过注释行/块):
//   a) .textContent = '<…CJK…>' → 同行须有 t/tArgs 家族调用 (裸字面量即漏挂);
//   b) aiBanner( 消息含 CJK → 同行须走 t 家族 (banner 走 innerHTML);
//   c) .innerHTML =/+= '<…CJK…>' → 同行须走 t 家族或挂 data-i18n 标记。
var miss10 = [];
jsFiles.forEach(function (f) {
  fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/).forEach(function (line, i) {
    if (!CJK7.test(line)) return;
    var ls = line.trim();
    if (ls.indexOf('//') === 0 || ls.indexOf('*') === 0) return;   // 注释行豁免 (仅扫执行代码)
    var ln = f + ':' + (i + 1);
    var tcOk = /[tT][A-Za-z0-9]*\(/.test(line) || /XQ\.I18N/.test(line) || /data-i18n/.test(line);
    var m10 = line.match(/\.textContent\s*=\s*(['"])((?:(?!\1).)*\1)/);   // 右侧首段字面量 (行尾注释不计)
    if (m10 && CJK7.test(m10[2]) && !tcOk) miss10.push(ln + ' textContent="' + m10[2].slice(0, 24) + '"');
    if (line.indexOf('aiBanner(') >= 0 && !tcOk) {
      var ab = line.match(/aiBanner\([^)]*[\u4e00-\u9fff][^)]*/);
      if (ab) miss10.push(ln + ' ' + ab[0].slice(0, 34));
    }
    var im10 = line.match(/\.innerHTML\s*(?:\+=|=)\s*(['"])((?:(?!\1).)*\1)/);
    if (im10 && CJK7.test(im10[2]) && !tcOk) miss10.push(ln + ' innerHTML="' + im10[2].slice(0, 24) + '"');
  });
});
ok(miss10.length === 0, 'I10 JS 动态写入口 (textContent/aiBanner/innerHTML) 裸中文' + (miss10.length ? ' (漏挂: ' + miss10.join(' ; ') + ')' : ' (0 漏挂)'));

// I11 第40轮: 键存在性守护 (非首参形态) — I5 的正则要求引号键紧跟 t( 的左括号, 因此
//   TI(view.aiRetryWait ? 'status_retry_wait' : 'status_retry', …) 这类「键作为三元/拼接/非首参」的写法
//   从未被守护: 第38轮加入 waitMs 分支时引用了字典里根本不存在的 status_retry_wait, I5 全绿,
//   而界面上状态条原样显示字符串 'status_retry_wait' (中英皆是)。同理可漏掉任何新键。
//   规则: 凡同行出现 T 家族调用, 该行所有 snake_case 引号字面量 (形如 a_b…) 都必须在 ZH 字典中存在。
var miss11 = [];
var I11_DENY = {};   // 逃生口: 若将来某非键字面量确实与键同形, 在此登记 (键名 → 1)
jsFiles.forEach(function (f) {
  fs.readFileSync(path.join(ROOT, f), 'utf8').split(/\r?\n/).forEach(function (line, i) {
    if (!/\b[tT][A-Za-z0-9]*\(/.test(line)) return;      // 无 T 家族调用 → 该行字面量不可能是字典键
    var ls = line.trim();
    if (ls.indexOf('//') === 0 || ls.indexOf('*') === 0) return;   // 注释行豁免
    var re11 = /'([a-z][a-z0-9]*(?:_[a-z0-9]+)+)'/g, m11;
    while ((m11 = re11.exec(line)) != null) {
      if (I11_DENY[m11[1]]) continue;
      if (ZH[m11[1]] == null) miss11.push(f + ':' + (i + 1) + ' ' + m11[1]);
    }
  });
});
ok(miss11.length === 0, 'I11 T 家族同行引用的键均存在于字典 (非首参形态)' + (miss11.length ? ' (不存在: ' + miss11.join(' ; ') + ')' : ''));

// I12 第43轮: 按钮文案漏挂守护 — I9 的豁免条件是「同行出现 data-i18n」, 而 `data-i18n-title` 也含该子串,
//   于是「只挂了 title 没挂文本」的按钮整类逃过扫描: 回放层 ▶播放 / ⏪吃 / 吃子⏩ 三个按钮的**文本**
//   长期硬编码中文 (EN 界面原样显示), 其中 ▶播放 连首绘都没走字典 (打开回放层后停在模板文案)。
//   规则: <button …>TEXT</button> 的 TEXT 含 CJK 且**完全不走字典** → 报红; 文案由 T() 家族拼接
//   (或 XQ.I18N ? t('k') : '中文兜底' 这种无 i18n 环境兜底写法) 的按钮不受影响。
var miss12 = [];
function scanBtnText(src, label) {
  var re12 = /<button\b([^>]*)>([^<]*)<\/button>/g, m12;
  while ((m12 = re12.exec(src)) != null) {
    if (!CJK7.test(m12[2])) continue;
    if (/(?:^|\s)data-i18n=/.test(m12[1])) continue;
    if (/[tT][A-Za-z0-9]*\(/.test(m12[2]) || m12[2].indexOf('XQ.I18N') >= 0) continue;   // 走字典 (含 no-i18n 兜底形态)
    miss12.push(label + ' <button> "' + m12[2].trim().slice(0, 24) + '"');
  }
}
jsFiles.forEach(function (f) { scanBtnText(fs.readFileSync(path.join(ROOT, f), 'utf8'), f); });
scanBtnText(htmlNoScript, 'index.html');
ok(miss12.length === 0, 'I12 按钮文案含中文必须挂 data-i18n (非仅 -title)' + (miss12.length ? ' (漏挂: ' + miss12.join(' ; ') + ')' : ' (0 漏挂)'));

// I14 第44轮: JS 模板里的 data-i18n / -title / -aria 引用键必须存在于字典 —
//   I4 只扫 index.html, I5 只认 t('key') 字面量调用, 于是「JS 构建 DOM 时挂的 data-i18n 键」
//   (rpEnsure 回放层模板 / renderer 动态面板) 是第四盲区: 键名写错只会静默显示键名本身。
var re14 = /data-i18n(?:-title|-aria)?="([a-z0-9_]+)"/g;
var jsAttrKeys = {}, m14;
jsFiles.concat(['benchmark/record.js', 'ai/random_agent.js']).forEach(function (f) {
  var src = fs.readFileSync(path.join(ROOT, f), 'utf8');
  var mm; while ((mm = re14.exec(src)) != null) jsAttrKeys[mm[1]] = f;
});
var jsAttrList = Object.keys(jsAttrKeys);
var jsAttrMiss = jsAttrList.filter(function (k) { return ZH[k] == null || EN[k] == null; });
ok(jsAttrList.length >= 20 && jsAttrMiss.length === 0,
  'I14 JS 模板 data-i18n* 引用键双语齐备 (' + jsAttrList.length + ' 键)' + (jsAttrMiss.length ? ' (缺失: ' + jsAttrMiss.map(function (k) { return k + '@' + jsAttrKeys[k]; }).join(',') + ')' : ''));

// I15 第44轮 a11y: 「无字面文本」的按钮必须有无障碍名称 —
//   可访问名计算优先取内容, title 仅在内容为空时兜底; 纯符号/emoji 按钮 (‹ › 🏆 ⏮ …) 的内容
//   本身就是那个符号, 读屏只会念「按钮」/念出 emoji 名。故: 按钮文本里没有任何字母或汉字时,
//   必须带 aria-label 或 data-i18n-aria。翻页器 ‹ › 长期裸奔 (第24轮把它们做成 button 却只补了键盘可达)。
var miss15 = [];
function scanGlyphBtn(src, label) {
  var re15 = /<button\b([^>]*)>([^<]*)<\/button>/g, m15;
  while ((m15 = re15.exec(src)) != null) {
    var attrs = m15[1], txt = m15[2];
    if (txt.indexOf('+') >= 0) continue;                       // 拼接模板 (动态文本, 另有 I10 把关)
    if (!txt.trim()) continue;                                 // 空文本按钮由其他规则覆盖
    if (/[A-Za-z\u4e00-\u9fff]/.test(txt)) continue;           // 含字母/汉字 → 内容即可访问名
    if (/aria-label|data-i18n-aria/.test(attrs)) continue;
    miss15.push(label + ' <button> "' + txt.trim().slice(0, 12) + '"');
  }
}
jsFiles.forEach(function (f) { scanGlyphBtn(fs.readFileSync(path.join(ROOT, f), 'utf8'), f); });
scanGlyphBtn(htmlNoScript, 'index.html');
ok(miss15.length === 0, 'I15 纯符号按钮必须有无障碍名称 (aria-label / data-i18n-aria)' + (miss15.length ? ' (漏挂: ' + miss15.join(' ; ') + ')' : ' (0 漏挂)'));

// I13 第43轮: 「界面偏好」类 option 文案漏挂 — I7/I8 有意豁免 option (服务商品牌名/语言名不可译),
//   但同一豁免把偏好类下拉也放过了: #ui-pieces 的 汉字/Letters 是硬编码, 而字典里 pieces_cn/pieces_en
//   早已存在却全仓零引用 (孤儿键) — EN 界面下该下拉显示「汉字 / Letters」。
//   规则: #ui-pieces 的每个 option 必须挂 data-i18n 且键存在于字典 (品牌名下拉不受影响)。
var sel13 = (html.match(/<select[^>]*id="ui-pieces"[\s\S]*?<\/select>/) || [''])[0];
var opt13 = sel13.match(/<option\b[^>]*>/g) || [];
var opt13keys = opt13.map(function (o) { return (o.match(/data-i18n="([a-z0-9_]+)"/) || [])[1]; });
ok(opt13.length >= 2 && opt13keys.every(function (k) { return !!k; }),
  'I13 棋子显示下拉的选项文案挂 data-i18n (偏好类文案不得硬编码)' + (opt13keys.some(function (k) { return !k; }) ? ' (漏挂 ' + (opt13.length - opt13keys.filter(Boolean).length) + ' 个)' : ''));
ok(opt13keys.filter(Boolean).every(function (k) { return ZH[k] != null && EN[k] != null; }),
  'I13 棋子显示下拉引用的键双语齐备 (' + opt13keys.filter(Boolean).join(',') + ')');

console.log('i18n_check: ' + (15 - fails.length) + '/15 groups PASS, ' + zk.length + ' keys');
if (fails.length) { process.exit(1); }
process.exit(0);
