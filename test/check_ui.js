const { execSync } = require('child_process');
const fs = require('fs');

// 1) Syntax checks — v1.7.6: 扩容 4→17 文件 (replay/core/evaluation/record 此前从未被语法检查过)
for (const f of [
  'ui/renderer.js', 'ui/app.js', 'ai/llm_agent.js', 'server.js',
  'core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js', 'core/generator.js', 'core/judge.js', 'core/engine.js',
  'evaluation/position.js', 'evaluation/xiangqi_knowledge.js',
  'replay/replay.js', 'replay/replay_controller.js', 'benchmark/record.js', 'ai/random_agent.js'
]) {
  execSync(`node --check ${f}`, { cwd: __dirname + '/..', stdio: 'pipe' });
  console.log('syntax OK:', f);
}

// 2) ID cross-check: every getElementById in JS must exist in HTML
const html = fs.readFileSync(__dirname + '/../index.html', 'utf8');
const js = ['ui/renderer.js', 'ui/app.js', 'ai/llm_agent.js']
  .map(f => fs.readFileSync(__dirname + '/../' + f, 'utf8')).join('\n');
const re = /getElementById\((['"])([\w-]+)\1\)/g;
const ids = new Set();
let m;
while ((m = re.exec(js))) ids.add(m[2]);
const missing = [...ids].filter(id => !html.includes('id="' + id + '"'));
// v2.0 动态 ID 白名单: 运行时 JS 创建的元素 (replay-bar 复盘工具条 / rp-help-overlay 回放键盘帮助) 不在静态 HTML, 属已知误报
const DYNAMIC_IDS = new Set(['replay-bar', 'rp-help-overlay']);
const realMissing = missing.filter(id => !DYNAMIC_IDS.has(id));
const dynHit = missing.filter(id => DYNAMIC_IDS.has(id));
console.log('IDs referenced:', ids.size, '| missing in HTML:', realMissing.length ? realMissing.join(', ') : '(none)'
  + (dynHit.length ? ' | dynamic (runtime-created, OK): ' + dynHit.join(', ') : ''));

// 3) Panel IDs present
const panels = ['think-red-body', 'think-black-body', 'think-red-name', 'think-black-name', 'think-red-stat', 'think-black-stat'];
console.log('panel ids present:', panels.every(c => html.includes('id="' + c + '"')));

// 4) XQ.UI export surface matches app.js usage
const r = fs.readFileSync(__dirname + '/../ui/renderer.js', 'utf8');
const exp = r.match(/XQ\.UI\s*=\s*\{([^}]+)\}/)[1];
for (const fn of ['thinkPanel', 'updateClock', 'aiBanner', 'logMove', 'render', 'drawBoard']) {
  const used = new RegExp('XQ\\.UI\\.' + fn + '\\b').test(js);
  const exported = exp.includes(fn);
  console.log(`UI.${fn}: exported=${exported} used=${used}`);
}

// 5) v3.9 <script src> 本地引用存在性扫描 (CDN http(s) 跳过)
const srcRe = /<script[^>]*\ssrc=["']([^"']+)["']/g;
const missingSrc = [];
while ((m = srcRe.exec(html))) { if (!/^https?:/i.test(m[1]) && !fs.existsSync(__dirname + '/../' + m[1])) missingSrc.push(m[1]); }

// 6) v3.9 localStorage key 前缀守护: 字面量 key 与 *_KEY 常量都必须以 xq_ 开头
const jsAll2 = ['ui/renderer.js', 'ui/app.js', 'ai/llm_agent.js', 'replay/replay.js', 'replay/replay_controller.js', 'benchmark/record.js']
  .map(f => fs.readFileSync(__dirname + '/../' + f, 'utf8')).join('\n');
const lsRe = /localStorage\.(?:getItem|setItem|removeItem)\((["'])([^"']+)\1\)/g;
const lsLiteral = new Set(); const badLs = [];
while ((m = lsRe.exec(jsAll2))) { lsLiteral.add(m[2]); if (m[2].indexOf('xq_') !== 0) badLs.push(m[2]); }
const keyDefRe = /([A-Z][A-Z_]*_KEY)\s*=\s*(["'])([^"']+)\2/g;
while ((m = keyDefRe.exec(jsAll2))) { if (m[3].indexOf('xq_') !== 0) badLs.push(m[1] + '=' + m[3]); }
console.log('script src missing:', missingSrc.length ? missingSrc.join(', ') : '(none)');
console.log('localStorage keys:', lsLiteral.size, 'literal | 非 xq_ 前缀:', badLs.length ? badLs.join(', ') : '(none)');
if (missingSrc.length || badLs.length) process.exit(1);

// 7) 发布文件存在性守护 (v1.0.daily 第14轮: 四件套扩容 4→6, +CHANGELOG/SUPPORT)
const pubFiles = ['.gitignore', 'LICENSE', 'package.json', 'config/keys.example.json', 'CHANGELOG.md', '.github/SUPPORT.md', 'manifest.json', 'sw.js'];
const missingPub = pubFiles.filter(f => !fs.existsSync(__dirname + '/../' + f));
console.log('发布文件:', missingPub.length ? '缺失 ' + missingPub.join(', ') : '8/8 (gitignore/LICENSE/package.json/keys.example/CHANGELOG/SUPPORT/manifest/sw)');
if (missingPub.length) process.exit(1);

// 8) v1.0.daily README 双语版本一致性 + package.json 版本对齐 (防主/中文档版本漂移)
const pkg = JSON.parse(fs.readFileSync(__dirname + '/../package.json', 'utf8'));
const tEn = (fs.readFileSync(__dirname + '/../README.md', 'utf8').match(/^\uFEFF?#.+$/m) || [''])[0];
const tZh = (fs.readFileSync(__dirname + '/../README.zh-CN.md', 'utf8').match(/^\uFEFF?#.+$/m) || [''])[0];
const vEn = (tEn.match(/v(\d+\.\d+)/) || [])[1];
const vZh = (tZh.match(/v(\d+\.\d+)/) || [])[1];
console.log('README version:', 'EN=' + vEn, 'ZH=' + vZh, 'pkg=' + pkg.version);
if (!vEn || !vZh || vEn !== vZh || pkg.version.indexOf(vEn) !== 0) process.exit(1);

// 13) 第28轮 套件挂链守护: 单元/守护套件必须都出现在 run_all.js 的 SUITES 里 (防死测试; 排除需服务器/浏览器的冒烟与调试脚本)
const runAllSrc = fs.readFileSync(__dirname + '/../test/run_all.js', 'utf8');
const mustWire = ['run_tests.js', 'test_evaluation.js', 'test_llm_convo.js', 'replay_smoke.js', '_clean_reason_check.js',
  'cn_notation_check.js', 'i18n_check.js', 'link_check.js', 'check_ui.js', '_replay_edge.js', '_logic_layer.js',
  '_server_http.js', '_prompt_level_smoke.js', 'replay_risk_check.js', '_committee_agent.js'];
const unwired = mustWire.filter(function (f) { return runAllSrc.indexOf("'" + f + "'") < 0; });
const phantom = [];
runAllSrc.split("'").forEach(function (seg, qi) {
  if (qi % 2 === 1 && seg.length > 3 && seg.slice(-3) === '.js' && seg !== 'run_all.js' && !fs.existsSync(__dirname + '/' + seg)) phantom.push(seg);
});
if (unwired.length || phantom.length) process.exit(1);

// 9) v1.0.daily 第22轮 HTML 净化守护: PowerShell 转义残留 (`n/`r/`t 等) 与双重转义实体
//    根因: 第16轮 PowerShell 编辑把换行转义原样写进 HTML (`652a770`), 静态裸文本无 data-i18n 标记,
//    既有守护只查 ID/i18n 键/链接/版本, 不查文本内容 → 存活 5 轮。本节补上该盲区。
//    只扫非 <script> 区 (JS 里反引号/转义合法); index.html 的 <script> 全在文件尾部, 行号不漂移。
const SCRIPT_RE = new RegExp('<script[^>]*>[\\s\\S]*?</script>', 'gi');
const htmlText = html.replace(SCRIPT_RE, '');
const dirty = [];
htmlText.split('\n').forEach((line, i) => {
  const esc = line.match(/`[a-z]/gi);
  if (esc) dirty.push('L' + (i + 1) + ' PowerShell转义残留 ' + esc.join(''));
  if (/&amp;amp;/i.test(line)) dirty.push('L' + (i + 1) + ' 双重转义');
});
console.log('HTML 净化:', dirty.length ? dirty.join(' | ') : 'PASS (无转义残留/双重转义)');
if (dirty.length) process.exit(1);

// 10) v1.0.daily 第23轮 PWA manifest 守护: link 存在 + JSON 合法 + 字段齐 + 图标文件在盘 + theme-color 在页
const manLink = (html.match(/<link rel="manifest" href="([^"]+)"/) || [])[1];
if (!manLink) { console.log('PWA manifest: index.html 缺 <link rel="manifest">'); process.exit(1); }
const manPath = __dirname + '/../' + manLink;
if (!fs.existsSync(manPath)) { console.log('PWA manifest: 文件缺失 ' + manLink); process.exit(1); }
let man = null;
try { man = JSON.parse(fs.readFileSync(manPath, 'utf8')); } catch (eM) { console.log('PWA manifest: JSON 解析失败 ' + eM.message); process.exit(1); }
const manIssues = [];
if (!man.name || !man.short_name) manIssues.push('缺 name/short_name');
if (man.display !== 'standalone') manIssues.push('display != standalone');
if (!man.start_url) manIssues.push('缺 start_url');
if (!man.id) manIssues.push('缺 id (第26轮: PWA 身份, 卸载重装/多 start_url 下缓存与存储归属一致)');
if (!(man.shortcuts || []).length) manIssues.push('缺 shortcuts (第26轮: 系统级快捷入口)');
if (!man.theme_color || !man.background_color) manIssues.push('缺 theme_color/background_color');
for (const ic of (man.icons || [])) {
  if (!fs.existsSync(__dirname + '/../' + ic.src)) manIssues.push('图标不在盘: ' + ic.src);
}
if (!(man.icons || []).length) manIssues.push('缺 icons');
// 第39轮: 富安装卡片 — screenshots (文件在盘 + sizes/type 齐) + categories (应用商店分类)
if (!Array.isArray(man.categories) || !man.categories.length) manIssues.push('缺 categories (第39轮)');
if (!(man.screenshots || []).length) manIssues.push('缺 screenshots (第39轮: 安装卡片截图)');
for (const sc of (man.screenshots || [])) {
  if (!sc.src || !sc.sizes || !sc.type) manIssues.push('screenshot 缺 src/sizes/type: ' + JSON.stringify(sc).slice(0, 60));
  else if (!fs.existsSync(__dirname + '/../' + sc.src)) manIssues.push('screenshot 不在盘: ' + sc.src);
}
const themeMeta = /<meta name="theme-color" content="([^"]+)"/.test(html);
if (!themeMeta) manIssues.push('index.html 缺 theme-color meta');
console.log('PWA manifest:', manIssues.length ? manIssues.join(' | ') : 'OK (' + manLink + ', icons ' + (man.icons || []).length + ', shots ' + (man.screenshots || []).length + ', cat ' + (man.categories || []).join('/') + ')');
if (manIssues.length) process.exit(1);

// 11) 第24轮 PWA service worker 守护: 根级 sw.js 在盘 (作用域=/) + 三事件/API排除 + app.js 有注册调用
const swPath = __dirname + '/../sw.js';
if (!fs.existsSync(swPath)) { console.log('SW: 根级 sw.js 缺失'); process.exit(1); }
const swSrc = fs.readFileSync(swPath, 'utf8');
const appSrc = fs.readFileSync(__dirname + '/../ui/app.js', 'utf8');
const swIssues = [];
if (!/addEventListener\('fetch'/.test(swSrc) || !/addEventListener\('activate'/.test(swSrc)) swIssues.push('sw.js 缺 fetch/activate 事件');
if (!/\/api\//.test(swSrc)) swIssues.push('sw.js 未排除 /api/ (中继请求不得缓存)');
if (!/serviceWorker\.register\(\s*'sw\.js'\s*\)/.test(appSrc)) swIssues.push('app.js 缺 sw.js 注册调用');
console.log('SW:', swIssues.length ? swIssues.join(' | ') : 'OK (fetch+activate 事件, /api/ 排除, app.js 注册)');
if (swIssues.length) process.exit(1);

// 12) 第27轮 a11y 守护: 回放层对话框语义 (rpEnsure 是 JS 构建的 DOM, I7/I8 只扫 index.html 够不到 —
//    守护以 app.js 源串为对象): role=dialog + aria-modal + aria-labelledby 指到 rp-title + 焦点入层/归还
const rpIssues = [];
const rpEnsureSrc = (appSrc.match(/function rpEnsure\(\)[\s\S]*?\n  \}/) || [''])[0];
if (!rpEnsureSrc) rpIssues.push('app.js 找不到 rpEnsure');
else {
  if (!/role="dialog"/.test(rpEnsureSrc)) rpIssues.push('rpEnsure 模板缺 role="dialog"');
  if (!/aria-modal="true"/.test(rpEnsureSrc)) rpIssues.push('rpEnsure 模板缺 aria-modal="true"');
  if (!/aria-labelledby="rp-title"/.test(rpEnsureSrc)) rpIssues.push('rpEnsure 模板缺 aria-labelledby="rp-title"');
  if (!/id="rp-title"/.test(rpEnsureSrc)) rpIssues.push('rpEnsure 模板缺 id="rp-title"');
}
if (!/rpOpener\s*=\s*document\.activeElement/.test(appSrc)) rpIssues.push('app.js 缺焦点宿主记录 (rpOpener)');
if (!/function rpClose[\s\S]*?rpOpener\.focus/.test(appSrc)) rpIssues.push('rpClose 缺焦点归还');
console.log('回放层对话框:', rpIssues.length ? rpIssues.join(' | ') : 'OK (dialog 语义 + 焦点入层/归还)');
if (rpIssues.length) process.exit(1);

// 14) 第39轮 对局生命周期世代守卫: 无 DOM 环境下的源串层防线 —
//     第38轮 gameAbort 接入后 (a) applyAgents 早于 startRecord 把旧代 signal 固化进 agent → 每手被"外部中止"秒拒;
//     (b) startRecord 触发的 abort 会让旧局请求以失败形态回到 catch, 污染新局状态。四道锚点:
const llmSrc = fs.readFileSync(__dirname + '/../ai/llm_agent.js', 'utf8');
const lifeIssues = [];
if (!/\.catch\(function \(err\) \{\s*\n\s*if \(gid !== gameId\) return;/.test(appSrc)) lifeIssues.push('scheduleAgent catch 缺 gid!==gameId 世代守卫');
const sigFnCount = (appSrc.match(/signal: function \(\) \{ return gameAbort \? gameAbort\.signal : undefined; \}/g) || []).length;
if (sigFnCount < 2) lifeIssues.push('LLM/委员会 signal 非取值函数形态 (' + sigFnCount + '/2)');
if (!/if \(gid !== gameId\) \{ if \(selfTimer\) clearInterval\(selfTimer\); return; \}/.test(appSrc)) lifeIssues.push('bannerThinking tick 缺世代自清');
if (!/typeof opts\.signal === 'function' \? opts\.signal\(\)/.test(llmSrc)) lifeIssues.push('llm_agent 未支持 signal 取值函数');
console.log('生命周期世代守卫:', lifeIssues.length ? lifeIssues.join(' | ') : 'OK (catch 守卫 + 信号取值函数 x2 + ticker 自清 + agent 侧支持)');
if (lifeIssues.length) process.exit(1);

// 15) 第40轮 a11y / PWA 源串守卫 — 本轮修复中无 DOM 可达的部分 (app.js 全局分支、渲染层事件绑定、
//     sw.js 安装期行为已在 _logic_layer L11 行为化覆盖, 此处补源串层防线防回退):
//     (a) 错误/警告播报区 #sr-alert 存在且为断言式; (b) 设置面板 label 与控件程序化关联 (for=);
//     (c) 走法列表条目键盘可达 + 事件键处理; (d) 拖拽 pointercancel 中止清理; (e) 渲染热路径短路与签名去重;
//     (f) 终局卡焦点归还; (g) serviceWorker.register 的 Promise 拒绝已兜底; (h) 悔棋 AI 思考期不再静默无反应; (i) sw 预缓存壳。
const renSrc = fs.readFileSync(__dirname + '/../ui/renderer.js', 'utf8');
const a11yIssues = [];
// (a) 断言式播报区
if (!/id="sr-alert"[^>]*role="alert"/.test(html) || !/id="sr-alert"[^>]*aria-live="assertive"/.test(html)) {
  a11yIssues.push('index.html 缺 #sr-alert 断言式播报区 (role=alert + aria-live=assertive)');
}
if (!/getElementById\('sr-alert'\)/.test(renSrc)) a11yIssues.push('renderer 未把警告横幅写入 #sr-alert (读屏感知不到失败)');
// (b) label ↔ 控件程序化关联: 非包裹式 label 挂 data-i18n 时必须带 for= 且目标 id 存在
const labelRe = /<label([^>]*)>([\s\S]*?)<\/label>/g;
let lm, forCount = 0;
while ((lm = labelRe.exec(html)) !== null) {
  const attrs = lm[1], inner = lm[2];
  if (/<(input|select|textarea)/i.test(inner)) continue;         // 包裹式: 关联由结构给出
  if (!/data-i18n(?:-title|-aria)?=/.test(attrs)) continue;       // 非文案标签 (装饰)
  const forM = attrs.match(/\bfor="([\w-]+)"/);
  if (!forM) { a11yIssues.push('label 未关联控件 (缺 for=): ' + attrs.trim().slice(0, 60)); continue; }
  if (!html.includes('id="' + forM[1] + '"')) a11yIssues.push('label for="' + forM[1] + '" 指向不存在的 id');
  forCount++;
}
if (forCount < 12) a11yIssues.push('设置面板 for= 关联数不足 (' + forCount + '/12)');
// (c) 走法列表键盘可达
if (!/log\.addEventListener\('keydown'/.test(renSrc)) a11yIssues.push('走法列表缺 keydown 处理 (键盘无法跳转局面)');
if (!/e\.tabIndex = 0;/.test(renSrc)) a11yIssues.push('走法列表条目缺 tabIndex=0 (不可聚焦)');
// (d) 拖拽中止清理
if (!/addEventListener\('pointercancel', dragAbort\)/.test(renSrc) || !/addEventListener\('lostpointercapture', dragAbort\)/.test(renSrc)) {
  a11yIssues.push('拖拽未接管 pointercancel/lostpointercapture (指针被夺走 → _drag 残留永久阻断拖拽)');
}
// (e) 渲染热路径
if (!/sel \? legal\[x \+ ',' \+ y\] : null/.test(renSrc)) a11yIssues.push('逐格 legal 查表未按选中态短路 (未选中仍分配 90 次键串)');
if (!/_sparkSig/.test(renSrc)) a11yIssues.push('评值走势 SVG 缺内容签名去重');
if (!/tabIndex = \(mode === 'warn' && msg\) \? 0 : -1/.test(renSrc)) a11yIssues.push('横幅缺焦点落点管理 (仅警告态可聚焦)');
// (f) 终局卡焦点归还
if (!/overlay\._opener/.test(renSrc) || !/back\.isConnected/.test(renSrc)) a11yIssues.push('终局卡缺焦点归还 (关闭后焦点丢失到 body)');
// (g)(h) app.js 侧
if (!/serviceWorker\.register\('sw\.js'\)\.catch\(/.test(appSrc)) a11yIssues.push('serviceWorker.register 缺 Promise 拒绝兜底 (404 变 unhandled rejection)');
if (!/XQ\.I18N\.t\('undo_ai_busy'\)/.test(appSrc)) a11yIssues.push('悔棋在 AI 思考期仍静默 return (应为可见+可播报提示)');
if (!/abEl\.addEventListener\('keydown'/.test(appSrc)) a11yIssues.push('警告横幅缺键盘关闭 (键盘用户只能等 15s 自清)');
// (i) sw 安装期预缓存 — 第41轮: 原正则写死 `var SHELL = ['./', './index.html']` 字面量, 壳清单一旦增补即误报;
//     此处只守「机制在」(SHELL 数组 + 安装期 c.add + 导航兜底键), 清单完整性交由 _logic_layer L13 行为断言
//     (按 index.html 实际引用逐个比对预缓存结果, 漏挂新脚本会被抓红)
if (!/var SHELL = \[/.test(swSrc) || !/c\.add\(u\)/.test(swSrc) || !/addEventListener\('install'/.test(swSrc)) a11yIssues.push('sw.js 缺安装期壳预缓存');
if (!/caches\.match\('\.\/index\.html'\)/.test(swSrc)) a11yIssues.push('sw.js 导航兜底未用作用域相对键 (绝对路径写法在子路径部署必然 miss)');
if (!/return c\.put\(req, copy\); \}\)\.catch\(/.test(swSrc)) a11yIssues.push('sw.js 运行时写缓存的 Promise 悬空 (配额错误变 unhandled rejection)');
// (j) 第41轮: 键盘走子光标播报 + 设置层模态闸门
if (!/getElementById\('sr-cursor'\)/.test(appSrc) || !/announceCursor\(\);/.test(appSrc)) a11yIssues.push('键盘走子光标缺读屏播报 (方向键移动无反馈)');
if (!/sr-cursor/.test(html) || !/aria-live="polite"/.test(html)) a11yIssues.push('index.html 缺 #sr-cursor 播报区');
if (!/soMod\.classList\.contains\('show'\)\) return;/.test(appSrc)) a11yIssues.push('设置层开启时单键快捷键未拦截 (R/U/M/F 会操作面板后方棋局)');
// 第41轮: 源码串守卫需忽略注释的干扰 — 本轮多处修复的说明注释里会引用「被修掉的旧写法」原文
// (例如 app.js 注释中描述 `entry.summary` 与 '(无摘要)' 比对的历史实现), 否则守卫会被自己的文档误触发。
// 状态机剥注释 (块注释跨行, 行首标记法不够用) 并保留字符串字面量内容; 正则字面量内的 // 可能被误判,
// 但本仓守卫全部是「必须存在」形态 — 误剥只会让守卫报缺失 (响亮失败), 不会静默放行。
function codeOnly(src) {
  var out = '', i = 0, n = src.length, st = 0, c, d;   // st: 0=code 1=行注释 2=块注释 3/4/5=单/双/反引号串
  while (i < n) {
    c = src[i]; d = src[i + 1];
    if (st === 0) {
      if (c === '/' && d === '/') { st = 1; i += 2; continue; }
      if (c === '/' && d === '*') { st = 2; i += 2; continue; }
      if (c === "'") st = 3; else if (c === '"') st = 4; else if (c === '`') st = 5;
      out += c; i++; continue;
    }
    if (st === 1) { if (c === '\n') { st = 0; out += c; } i++; continue; }
    if (st === 2) { if (c === '*' && d === '/') { st = 0; i += 2; } else { if (c === '\n') out += c; i++; } continue; }
    if (c === '\\') { out += c + (d || ''); i += 2; continue; }
    if ((st === 3 && c === "'") || (st === 4 && c === '"') || (st === 5 && c === '`')) st = 0;
    out += c; i++;
  }
  return out;
}
const appCode = codeOnly(appSrc);
const renCode = codeOnly(renSrc);
// (k) 第41轮: 棋子显示偏好单出口 (HUD/回放层不得直取 CHARS)
if (!/XQ\.UI\.pieceGlyph/.test(appCode) || !/function pieceGlyphOf\(color, type\)/.test(renCode)) a11yIssues.push('棋子显示字缺单出口 (HUD/回放层直取 CHARS → Letters 模式下与棋盘矛盾)');
// (l) 第41轮: 兑底判定必须基于「模型是否给了 summary」这一原始事实, 不得比对字典产物 (EN 恒 false → 兑底透明化在英文界面整体失效)
if (!/function fbMark\(entry, hasSummary/.test(appCode) || !/var hasSummary = !!\(meta && meta\.summary\)/.test(appCode)) {
  a11yIssues.push('app.js 兑底判定未按原始 summary 事实 (fbMark/hasSummary)');
}
if (/entry\.summary === '\(无摘要\)'/.test(appCode)) a11yIssues.push('app.js 仍以翻译串判定兑底 (EN 下恒不成立, 兑底徽章/摘要/推理全部失效)');
if (!/var fbBadge = entry\.fallback \?/.test(appCode)) a11yIssues.push('兑底徽章未按 fallback 旗标 (应为语言中立)');
if (!/fbMark\(entry2, !!m\.summary/.test(appCode)) a11yIssues.push('续局重建未恢复兑底旗标 (存档往返后兑底手退化为「无摘要」)');
// (m) 第41轮: 思考中切换语言必须重新解析随机AI 名称 (否则状态条整轮停在旧语言)
if (!/thH\.kind === 'random'\) view\.aiThinking =/.test(appCode)) a11yIssues.push('语言热切未重新解析思考中的随机AI 名称 (状态条整轮停在旧语言)');
console.log('a11y/PWA 源串守卫:', a11yIssues.length ? a11yIssues.join(' | ') : 'OK (sr-alert 播报 + label for= x' + forCount + ' + 走法列表键盘 + 拖拽中止 + 热路径 + 终局焦点 + SW 壳/兜底/写缓存兜底 + 光标播报 + 设置层模态闸门)');
if (a11yIssues.length) process.exit(1);

// 16) 第42轮 接线/写入点 源串+结构守卫 — 本轮缺陷共同的形态是「代码本身看着对, 断链在别处」:
//     写出点根本不存在 (dataset.flip)、查询落在错误子树 (终局导出按钮)、清理漏了一处 (光标播报区)、
//     隐藏态语义不全 (opacity:0 仍可聚焦)、维护性拷贝 (stat 文案)、缺闸门 (回放态被 AI 接管)。
//     逐条钉住「谁写 / 谁读 / 谁清理 / 谁兜底」:
//     (a) 静态 id 只许文档层取用 — 子树查询静态 id 是「查询落空」类死链的通用形态;
//     (b) dataset.flip 写入点; (c) #btn-row 隐藏态 visibility; (d) 时钟秒级补位; (e) Enter/Space 让位;
//     (f) 光标清理单出口; (g) 齿轮 aria 展开态; (h) 回放进度/过滤读屏名称声明式; (i) 帮助层可再按关闭;
//     (j) 终局直达回放的焦点管理; (k) 决策卡按钮标签本地化; (l) stat 文案单出口; (m) 回放态 AI 闸门。
const wireIssues = [];
// (a) 通用: querySelector('#静态id') 一律不许 — 静态元素必须从 document 取, 子树查询极易落空 (死链)
const staticIds = new Set();
let sid; const sidRe = /id="([\w-]+)"/g;
while ((sid = sidRe.exec(html)) !== null) staticIds.add(sid[1]);
['ui/renderer.js', 'ui/app.js', 'ai/llm_agent.js'].forEach(function (f) {
  const src = codeOnly(fs.readFileSync(__dirname + '/../' + f, 'utf8'));   // 剥注释: 修复说明里会引用旧写法原文 (第41轮教训), 否则守卫被自己的文档误触发
  let m; const selRe = /querySelector(?:All)?\(\s*'(#[\w-]+)'/g;
  while ((m = selRe.exec(src)) !== null) {
    const id = m[1].slice(1);
    if (id.slice(-1) === '-') continue;              // 字符串拼接前缀 ('#think-' + side + …) → 运行时元素
    if (!staticIds.has(id)) continue;                // 运行时创建的动态 id (rp-*/elo-s-* 等)
    wireIssues.push(f + ' 用子树查询取静态 id #' + id + ' (静态元素必须走 getElementById, 子树查询易落空)');
  }
});
// (a2) 终局卡「导出本局」的宿主是 .eo-card (与 #eo-stats 同级) — 结构性前提 + 绑定形态双向钉住
const eoStatsOpen = html.indexOf('id="eo-stats"');
const eoStatsSlice = eoStatsOpen < 0 ? '' : html.slice(eoStatsOpen, html.indexOf('</div>', html.indexOf('>', eoStatsOpen)));
if (/id="eo-export"/.test(eoStatsSlice)) wireIssues.push('守卫前提失效: #eo-export 已变成 #eo-stats 的子节点');
if (!/getElementById\('eo-export'\)/.test(appCode)) wireIssues.push('终局「导出本局」未从文档层绑定 (#eo-export 不在 #eo-stats 子树内 → 恒 null 的死按钮)');
// (b) dataset.flip: 两个消费方 (候选悬停高亮 / 回放盘面) 必须有写入者
if (!/document\.documentElement\.dataset\.flip = /.test(appCode)) wireIssues.push('dataset.flip 无写入点 (回放盘面与候选格高亮的翻转感知恒为 false)');
const flipReaders = (appCode + renCode).match(/dataset\.flip === '1'/g) || [];
if (flipReaders.length < 2) wireIssues.push('dataset.flip 消费点少于 2 处 (应覆盖候选悬停与回放盘面), 实为 ' + flipReaders.length);
// (c) #btn-row 隐藏态: 仅 opacity:0 的按钮仍在 Tab 序内且可被 Enter 激活
const btnRowBase = (html.match(/#btn-row\{[^}]*\}/) || [''])[0];
const btnRowShow = (html.match(/#btn-row\.visible\{[^}]*\}/) || [''])[0];
if (!/visibility:hidden/.test(btnRowBase)) wireIssues.push('#btn-row 隐藏态缺 visibility:hidden (不可见按钮仍可 Tab 聚焦并被 Enter 激活)');
if (!/visibility:visible/.test(btnRowShow)) wireIssues.push('#btn-row.visible 未恢复 visibility');
// (d) 状态条时钟: render() 之外的秒级补位 (updateClock 曾是零调用点纯导出 → 无 AI 思考期间时钟冻结)
if (!/setInterval\(function \(\) \{[\s\S]{0,220}?updateClock\(engine, view\)/.test(appCode)) wireIssues.push('状态条时钟缺秒级补位调用 (updateClock 零调用点 → 无 AI 思考时时钟与限着计数冻结)');
if (!/if \(view\.aiThinking \|\| engine\.isOver\(\)\) return;/.test(appCode)) wireIssues.push('时钟补位未与 AI 思考期互斥 (会与思考 ticker 每秒互写)');
// (e) 全局 Enter/Space: 必须放行「该键已被消费」与「目标自身可交互」的情形
if (!/if \(ev\.defaultPrevented \|\| selfActing\) return;/.test(appCode)) wireIssues.push('全局 Enter/Space 未放行已消费/自身可交互的按键 (焦点在走法条目或折叠头上按 Enter = 双动作)');
if (!/var selfActing = /.test(appCode)) wireIssues.push('缺 selfActing 交互元素判定');
if (!/ev\.preventDefault\(\);\s*\n\s*ev\.stopPropagation\(\);/.test(renCode)) wireIssues.push('走法条目 keydown 未 stopPropagation (Enter 会再冒泡到全局键盘走子分支)');
// (f) 光标清理单出口 (并清播报区, 否则回到同一格无法再次播报)
const ckcBody = (appCode.match(/function clearKbCursor\(\) \{[\s\S]*?\n  \}/) || [''])[0];
if (!ckcBody) wireIssues.push('缺 clearKbCursor 单出口');
const kbAll = (appCode.match(/kbCursor = null/g) || []).length;
const kbInCkc = (ckcBody.match(/kbCursor = null/g) || []).length;
const kbDecls = (appCode.match(/var kbCursor = null/g) || []).length;
if (kbAll - kbInCkc - kbDecls !== 0) wireIssues.push('仍有 ' + (kbAll - kbInCkc - kbDecls) + ' 处绕过 clearKbCursor 直接置空光标');
if ((appCode.match(/clearKbCursor\(\)/g) || []).length < 5) wireIssues.push('clearKbCursor 调用点不足 (清光标路径应全部收敛)');
if (!/getElementById\('sr-cursor'\);\s*\n\s*if \(el\) el\.textContent = '';/.test(ckcBody)) wireIssues.push('clearKbCursor 未清 #sr-cursor 播报区 (内容未变的重复写入不再被读屏播报)');
// (g) 齿轮按钮: 弹层类按钮的展开态
if (!/id="gear-toggle"[^>]*aria-haspopup="dialog"/.test(html)) wireIssues.push('齿轮按钮缺 aria-haspopup="dialog"');
if (!/id="gear-toggle"[^>]*aria-expanded="false"/.test(html)) wireIssues.push('齿轮按钮缺 aria-expanded 初值');
if (!/gb\.setAttribute\('aria-expanded', 'true'\)/.test(appCode)) wireIssues.push('设置层打开未置 aria-expanded=true');
if (!/g\.setAttribute\('aria-expanded', 'false'\)/.test(appCode)) wireIssues.push('设置层关闭未置 aria-expanded=false');
// (h) 回放层读屏名称声明式挂载 (语言热切由 apply() 自愈)
if (!/id="rp-range"[^']*data-i18n-aria="rp_jump_label"/.test(appCode)) wireIssues.push('回放进度条读屏名称未挂 data-i18n-aria (切语言后停在旧语言)');
if (/rpEl\.range\.setAttribute\('aria-label'/.test(appCode)) wireIssues.push('回放进度条仍一次性硬设 aria-label (语言热切后过期)');
if (!/id="rp-moves-filter"[^']*aria-label="/.test(appCode)) wireIssues.push('回放走法过滤框只有 placeholder 无读屏名称');
// (i) 帮助层可再次按键关闭 (与 rp_hk_help 文案承诺一致); 第43轮: 关闭走统一模态出口 (原内联 remove() 不归还焦点)
if (!/if \(ex\) \{ rpHelpClose\(\); return; \}/.test(appCode)) wireIssues.push('回放帮助层仍不可再次按下关闭 (与帮助文案承诺不符)');
// (j) 终局卡直达回放的焦点管理
const rpWatchBody = (appCode.match(/function rpWatchRecord\(\) \{[\s\S]*?\n  \}/) || [''])[0];
if (!/rpOpener = document\.activeElement/.test(rpWatchBody)) wireIssues.push('终局直达回放未记录焦点宿主 (关闭后焦点无处可还)');
if (!/rpEl\.pick\.focus/.test(rpWatchBody)) wireIssues.push('终局直达回放未把焦点移入层 (焦点留在被遮蔽的终局卡上)');
// (k) 决策卡 💭 按钮标签本地化
if (!/T\('d_reason_toggle'\)/.test(renCode)) wireIssues.push('决策卡 💭 按钮标签未走字典 (原硬编码英文 reasoning)');
if (/aria-label="reasoning"/.test(renCode)) wireIssues.push('决策卡 💭 按钮仍有硬编码英文标签');
// (l) 面板 stat 文案单出口 (撤销路径复用同一实现)
if (!/function panelStatText\(side, secs\)/.test(appCode)) wireIssues.push('面板 stat 文案缺单出口');
if ((appCode.match(/panelStatText\(/g) || []).length < 3) wireIssues.push('面板 stat 单出口复用点不足 (定义 + 落子 + 撤销回滚)');
if (/var statTxt = XQ\.I18N/.test(appCode)) wireIssues.push('afterMove 仍内联一份 stat 文案 (撤销路径无法复用, 两处会漂移)');
// (m) 回放态 (currentRecord=null) 不得让 AI 接管
const schedBody = (appCode.match(/function scheduleAgent\(\) \{[\s\S]*?\n  \}/) || [''])[0];
if (!/if \(!currentRecord\) return;/.test(schedBody)) wireIssues.push('scheduleAgent 缺 currentRecord 闸门 (载入棋谱后 AI 会继续走导入的残局且不入档)');
// (n) 回放层首绘兜底: 记忆进度为 0 时控制器不发状态回调 → 必须显式补一次首绘, 否则回放以空白盘面开场
if (!/rpOnState\(rpSession\.state\(\)\);/.test(appCode)) wireIssues.push('回放层缺首绘兜底 (记忆进度=0 时 gotoPly(0) 不触发状态回调 → 盘面/信息面板全空)');
// (o) 终局卡文案别名 Te/TAe 必须先赋值后使用 — var 只提升声明不提升赋值, 在字面声明之前调用 = TypeError;
//     该异常被 scheduleAgent 的 AI 失败 catch 吞掉, 表现为「AI 对 AI 局终局卡整块不渲染 + 棋谱 note 写入垃圾」
const iTAeDecl = appCode.indexOf('TAe = XQ.I18N ? XQ.I18N.tArgs');
const iTAeUse = appCode.indexOf("TAe('eo_elo'");
if (iTAeDecl < 0 || iTAeUse < 0 || iTAeDecl > iTAeUse) {
  wireIssues.push('终局卡 Te/TAe 早于赋值被调用 (var 提升无赋值 → AI 对 AI 局 TypeError, 统计/Elo/终局按钮整块跳过且被 catch 吞掉)');
}
console.log('接线/写入点守卫:', wireIssues.length ? wireIssues.join(' | ') : 'OK (静态 id 文档层取用 + 导出按钮绑定 + dataset.flip 写入 + btn-row visibility + 时钟补位 + Enter/Space 让位 + 光标清理单出口 + 齿轮 aria + 回放 aria 声明式 + 帮助层开关 + 直达回放焦点 + 卡片标签本地化 + stat 单出口 + 回放态 AI 闸门 + 回放首绘 + 终局卡别名先赋值后使用)');
if (wireIssues.length) process.exit(1);

// 17) 第43轮 源串/结构守卫 — 本轮三类缺陷的共同形态: 「写死的展示值」与「键取在错误的时点」。
//     (a) 回放工具条三个按钮的文案硬编码中文 (只挂了 data-i18n-title → 所有 CJK 守护放行);
//     (b) ▶播放 连首绘都没走字典 (只在「播放态变化」时才写文本 → 首次打开停在模板文案);
//     (c) Elo 天梯浮层无对话语义/无键盘出口/无快捷键闸门, 且排序入口是键盘不可达的 th;
//     (d) 重复计数的键取在 undoMove **之后** (取到恢复出来的局面 → 悔棋重走虚增计数 → 误判三次重复和棋);
//     (e) 引擎热路径 memo 必须存在且由 bumpVer 统一失效。
const wire43 = [];
// (a) 回放工具条文案走字典
if (!/T\('btn_play'\)/.test(appCode)) wire43.push('回放播放/暂停按钮文案未走字典 (EN 界面显示硬编码中文)');
if (!/T\('rp_prevcap'\)/.test(appCode) || !/T\('rp_nextcap'\)/.test(appCode)) wire43.push('回放上一手/下一手吃子按钮文案未走字典 (字典无键时 EN 界面显示中文)');
['▶ 播放', '⏪吃', '吃子⏩'].forEach(function (lit) {
  if (appCode.indexOf('>' + lit + '<') >= 0) wire43.push('回放按钮仍存在硬编码文案 "' + lit + '"');
});
/* (a2) 回放层是**建一次缓存复用**的 (rpEnsure 只在首次打开时构建, 之后只切 display) — 模板里由 T('键')
      写死的按钮文案必须同时挂 data-i18n, 否则「英文打开 → 关闭 → 切中文 → 再打开」仍是旧语言
      (apply() 只刷 data-i18n 元素; 缓存节点不会重建)。播放/暂停键豁免: 它的文案是状态相关的,
      由 rpOnPlayState 单出口维护 (i18n 监听内已按当前语言重解析)。 */
var rpEnsureBody = (appCode.match(/function rpEnsure\(\) \{[\s\S]*?\n  \}/) || [''])[0];
var btnTRe = /<button\b([^>]*)>'\s*\+\s*T\('([a-z0-9_]+)'\)\s*\+\s*'/g, mB;
while ((mB = btnTRe.exec(rpEnsureBody)) !== null) {
  if (mB[2] === 'btn_play') continue;
  if (!new RegExp('data-i18n="' + mB[2] + '"').test(mB[1])) {
    wire43.push('回放层缓存模板按钮 ' + mB[2] + ' 未挂 data-i18n (关回放后切语言再打开仍是旧语言)');
  }
}
// (b) 播放态首绘: rpStart 内必须显式调用一次 rpOnPlayState (条件性回调不会在首次打开时到达)
var rpStartBody = (appCode.match(/function rpStart\(record\) \{[\s\S]*?\n  \}/) || [''])[0];
if (!/rpOnPlayState\(rpCtrl\.playing/.test(rpStartBody)) wire43.push('rpStart 缺播放态首绘 (首次打开回放时 ▶播放 按钮停在模板文案, EN 下即中文)');
// (c) Elo 天梯浮层: 对话语义 + 唯一关闭出口 + 快捷键闸门 + 键盘可达排序入口
if (!/id="rp-elo-overlay" role="dialog" aria-modal="true" aria-labelledby="rp-elo-title"/.test(appCode)) wire43.push('Elo 天梯浮层缺对话语义 (role=dialog/aria-modal/labelledby)');
if (!/function rpEloClose\(\)/.test(appCode)) wire43.push('Elo 天梯浮层缺唯一关闭出口 rpEloClose (Esc/✕/遮罩三处必须同一出口并归还焦点)');
if (/onclick="if\(event\.target===this\)this\.remove\(\)"/.test(appCode)) wire43.push('全屏模态浮层仍用内联 onclick=this.remove() 关闭 (摘节点不归还焦点, 且无 Esc 出口)');
if (!/function modalClose\(id\)/.test(appCode) || !/function modalKeyGate\(ev, id, closeFn, toggleKeys\)/.test(appCode)) wire43.push('缺模态浮层统一出口 modalClose / 键盘闸门 modalKeyGate');
if (!/modalKeyGate\(ev, 'rp-elo-overlay', rpEloClose\)/.test(appCode)) wire43.push('Elo 天梯打开时未接管键盘 (Esc 会被下层回放层接走 → 关掉下层回放层, 天梯留在主界面上)');
if (!/modalKeyGate\(ev, 'rp-help-overlay', rpHelpClose, \['\?', '\/'\]\)/.test(appCode)) wire43.push('回放帮助层打开时未接管键盘 (自述「再次按下 ? 关闭」须成立, 且 Esc 不得穿透到下层回放层)');
if (!/if \(!ov\) return false;/.test(appCode)) wire43.push('modalKeyGate 未在浮层不存在时放行 (会吞掉全部全局快捷键)');
var gateBody = (appCode.match(/function modalKeyGate\(ev, id, closeFn, toggleKeys\) \{[\s\S]*?\n  \}/) || [''])[0];
if (!/return true;/.test(gateBody)) wire43.push('模态闸门未对「其余按键」整体让位 (方向键/空格会在遮罩后面步进棋局)');
if (!/ev\.key === 'Escape'\) \{ closeFn\(\)/.test(gateBody)) wire43.push('模态闸门未把 Esc 接给关闭出口 (会被下层回放层接走 → 关掉下层回放层, 浮层留在主界面上)');
if (!/if \(toggleKeys && toggleKeys\.indexOf\(ev\.key\) >= 0\)/.test(gateBody)) wire43.push('模态闸门未支持「自述再次按下关闭」的浮层开关键');
if (!/modalMarkOpen\('rp-elo-overlay', ov\)/.test(appCode) || !/modalMarkOpen\('rp-help-overlay', ov\)/.test(appCode)) wire43.push('两个模态浮层未走统一开启出口 modalMarkOpen (焦点入层/遮罩关闭/焦点归还)');
if (!/id="rp-help-overlay" role="dialog" aria-modal="true" aria-labelledby="rp-help-title"/.test(appCode)) wire43.push('回放帮助层缺对话语义 (role=dialog/aria-modal/labelledby)');
if (!/id="rp-help-close"/.test(appCode)) wire43.push('帮助层 ✕ 缺 id (无法走统一出口, 原为内联 remove)');
if (!/class="btn elo-sort"/.test(appCode) || !/aria-sort="none"/.test(appCode)) wire43.push('Elo 排序入口非键盘可达的 button / 缺 aria-sort (th+cursor:pointer 键盘不可达且无排序语义)');
if (!/thR\.setAttribute\('aria-sort'/.test(appCode)) wire43.push('Elo 排序态未写回 aria-sort (读屏不知当前按哪列排序)');
// (d) 重复计数: 被撤局面的键必须在 undoMove 之前取
var undoBody = (appCode.replace(/\s+/g, ' ') === '' ? '' : '') + (function () {
  var m17 = codeOnly(fs.readFileSync(__dirname + '/../core/engine.js', 'utf8'));
  return m17;
})();
var iUndoFn = undoBody.indexOf('undoPly: function () {');
var iKey = undoBody.indexOf('var undoneKey = posKey();', iUndoFn);
var iUndoMove = undoBody.indexOf('board.undoMove(m);', iUndoFn);
if (iUndoFn < 0 || iKey < 0 || iUndoMove < 0 || iKey > iUndoMove) {
  wire43.push('重复计数的键取在 undoMove 之后 (取到恢复出来的局面 → 悔棋重走虚增计数, 第3次重走误判三次重复和棋)');
}
if (!/bumpPos\(-1, undoneKey\)/.test(undoBody)) wire43.push('undoPly 未把被撤局面的键传给 bumpPos (扣错键)');
// (e) 热路径 memo: 存在且由 bumpVer 统一失效 (inCheck 按方别分键, posKey 按状态版本分键)
if (!/var _chkCache = null;/.test(undoBody) || !/_chkCache = null;/.test((undoBody.match(/function bumpVer\(\)[^\n]*/) || [''])[0])) {
  wire43.push('inCheck 缺 memo 或 bumpVer 未失效它 (每帧两次全盘攻击图扫描)');
}
if (!/_chkCache\.color === c/.test(undoBody)) wire43.push('inCheck memo 未按方别分键 (两方询问会互相覆盖)');
if (!/var _pkCache = null;/.test(undoBody) || !/_pkCache\.ver !== _stateVer/.test(undoBody)) {
  wire43.push('posKey 缺盘面文本 memo (snapshot 每帧重建 90 格文本)');
}
// (f) 人类执子方名字走字典 + replay 摘要兜底走字典
if (!/T\('type_human'\)/.test(appCode)) wire43.push('人类执子方名字未走字典 (EN 回放列表/头部显示「人类」)');
if (!/title: currentRecord && currentRecord\[sd\]/.test(appCode)) wire43.push('语言热切重绘面板名时未传回 title (thinkPanel 契约 title||name → 切一次语言就把表头悬停的模型名覆盖成方别名)');
if (/agents\.red \? \(agents\.red\.model \|\| agents\.red\.label\) : '人类'/.test(appCode)) wire43.push('人类执子方名字仍是硬编码中文常量');
var repCode = codeOnly(fs.readFileSync(__dirname + '/../replay/replay.js', 'utf8'));
if (!/XQ\.I18N \? XQ\.I18N\.t\('status_side_red'\)/.test(repCode)) wire43.push('回放摘要兜底名未走字典 (无名导入棋谱在 EN 列表显示「红方」)');
console.log('第17节 展示值/时点守卫:', wire43.length ? wire43.join(' | ') : 'OK (回放按钮文案走字典 + 播放态首绘 + Elo 浮层对话语义/键盘出口/闸门 + 排序 button/aria-sort + 重复计数键时点 + 热路径 memo + 人类名与回放兜底走字典)');
if (wire43.length) process.exit(1);

// 18) 第44轮 源串/结构守卫 — 本轮三类缺陷的共同形态:
//     (a) 「元素有 title 但没有可访问名」— 纯符号按钮 (🏆 ⏮ ‹ ›) 的可访问名取内容, title 只在内容为空时兜底;
//     (b) 「下层容器的键盘陷阱不认上层模态」— 回放层 Tab 陷阱把焦点从打开着的对话里拉回遮罩背后;
//     (c) 「热路径每事件一次同步副作用」— 拖动/自动重复期间每次都落盘或整层重画。
const wire44 = [];
// (a1) 回放工具条: 挂了 data-i18n-title 的按钮必须同时挂 data-i18n-aria (符号按钮的可访问名)
const rpToolIds = ['rp-next-record', 'rp-export-pgn', 'rp-elo', 'rp-backup', 'rp-restore', 'rp-del', 'rp-help', 'rp-fullscreen',
  'rp-loop', 'rp-start', 'rp-prev', 'rp-next', 'rp-end', 'rp-back5', 'rp-back10', 'rp-skip5', 'rp-skip10'];
rpToolIds.forEach(function (id) {
  const m = rpEnsureSrc.match(new RegExp('<button\\b[^>]*id="' + id + '"[^>]*>'));
  if (!m) { wire44.push('回放工具条缺按钮 #' + id); return; }
  if (!/data-i18n-aria=/.test(m[0])) wire44.push('#' + id + ' 只有 title 没有可访问名 (读屏播报原始符号)');
});
// (a2) 回放下拉/跳转输入框必须有程序化名称 (原 #rp-pick 完全无名; #rp-jump 只有 placeholder)
if (!/id="rp-pick"[^>]*data-i18n-aria=/.test(rpEnsureSrc)) wire44.push('#rp-pick 无可访问名称 (读屏只报「组合框」)');
if (!/id="rp-jump"[^>]*data-i18n-aria=/.test(rpEnsureSrc)) wire44.push('#rp-jump 无可访问名称 (原只有 placeholder「手」)');
// (a3) 翻页器 ‹ › 必须有无障碍名称 (第24轮做成 button 却只补了键盘可达)
if (/class="pg-btn pg-prev"(?!\s+data-i18n-aria)/.test(renCode)) wire44.push('思考面板翻页 ‹ 按钮无可访问名');
if (!/data-i18n-aria="pg_next"/.test(renCode)) wire44.push('思考面板翻页 › 按钮无可访问名');
// (a4) 切换式按钮补 aria-pressed (翻转/全屏), 且全屏状态随 fullscreenchange 同步 (Esc 退出也走该事件)
if (!/aria-pressed="false">⇅ 翻转/.test(html)) wire44.push('翻转按钮缺 aria-pressed 初值 (切换式按钮无开关态)');
if (!/id="btn-fullscreen"[^>]*aria-pressed=/.test(html)) wire44.push('全屏按钮缺 aria-pressed 初值');
if (!/function paintFullscreenPressed\(on\)/.test(appCode)) wire44.push('缺全屏 aria-pressed 同步出口 (Esc 原生退全屏后状态停在「已全屏」)');
if (!/bfP\.setAttribute\('aria-pressed'/.test(appCode)) wire44.push('翻转按钮的 aria-pressed 未随 applyFlip 同步');
if (!/rpEl\.btnFull\.setAttribute\('aria-label'/.test(appCode)) wire44.push('回放全屏按钮的 aria-label 未随全屏态切换 (全屏中仍念「全屏模式」)');
// (a5) 试连结果是异步写入的, 必须投进 live region (否则读屏用户按了「试连」得不到任何反馈)
if (!/id="ai-red-testres"[^>]*role="status"/.test(html) || !/id="ai-black-testres"[^>]*role="status"/.test(html)) {
  wire44.push('服务商试连结果无 live region (读屏按「试连」后静默)');
}
// (b) 回放层 Tab 陷阱必须认「更高层模态」— 否则 Elo 天梯/帮助层打开时每按一次 Tab 就被拉回遮罩背后的回放控件
if (!/function modalAnyOpen\(\)/.test(appCode)) wire44.push('缺 modalAnyOpen (下层容器无法感知上层模态)');
const rpTrapBody = (appCode.match(/document\.addEventListener\('keydown', function \(ev\) \{\s*\n\s*if \(!rpEl \|\| rpEl\.ov\.style\.display !== 'block'\) return;\s*\n\s*if \(ev\.key !== 'Tab'\) return;[\s\S]*?\n    \}\)/) || [''])[0];
if (!rpTrapBody) wire44.push('未定位到回放层 Tab 陷阱 (守卫锚点失效, 请同步更新)');
else if (!/if \(modalAnyOpen\(\)\) return;/.test(rpTrapBody)) wire44.push('回放层 Tab 陷阱未对更高层模态让位 (焦点被拉出打开着的对话)');
// (b2) 走法列表整表重建必须归还焦点 (键盘导航条目按 Enter 后焦点掉回 body)
if (!/var keepPly = /.test(appCode) || !/querySelector\('li\[data-ply="' \+ keepPly \+ '"\]'\)[\s\S]{0,120}?\.focus\(/.test(appCode)) {
  wire44.push('回放走法列表重建后未归还焦点 (Enter 激活条目后焦点丢到 body)');
}
// (b3) 表格语义: 会诊投票表头 th[scope=col], 帮助表首列 th[scope=row]
if (!/<th scope="col"[^>]*>' \+ T\('votes_model'\)/.test(appCode)) {
  wire44.push('会诊投票表表头仍是 <td> (读屏无法把信心值关联到列)');
}
if (!/th scope="row"/.test(appCode)) wire44.push('回放帮助表首列仍是 <td> (按键与行为无关联)');
// (c1) i18n: 走法列表的 杀/困/将 展示文本与 #rp-go 文案必须走字典 (判定仍留在语言中立标记上)
if (!/T\('rp_mk_mate'\)/.test(appCode) || !/T\('rp_mk_stuck'\)/.test(appCode) || !/T\('rp_mk_check'\)/.test(appCode)) {
  wire44.push('走法列表 杀/困/将 展示文本未走字典 (EN 界面显示中文)');
}
if (!/mk === '杀'/.test(appCode)) wire44.push('走法标记判定被改写 (必须留在 core/judge.js 的语言中立标记上)');
if (!/id="rp-go" data-i18n="rp_go"/.test(rpEnsureSrc)) wire44.push('#rp-go 文案仍硬编码 GO');
// (c2) 拖拽幽灵: 移动路径不得读 offsetWidth/Height (写 left/top 后读尺寸 = 每次 pointermove 强制同步布局)
const ghostMove = (renCode.match(/function dragGhostMove\(g, x, y\) \{[\s\S]*?\n  \}/) || [''])[0];
if (!ghostMove) wire44.push('未定位到 dragGhostMove (守卫锚点失效)');
else if (/offsetWidth|offsetHeight/.test(ghostMove)) wire44.push('dragGhostMove 仍读 offsetWidth/Height (每次 pointermove 强制同步布局)');
if (!/g\._gw = gw; g\._gh = gh;/.test(renCode)) wire44.push('幽灵尺寸未在建时缓存 (拖拽热路径读布局)');
// (c3) 拖动/自动重复期间的同步副作用必须收敛: 分隔条松手才落盘, 音量 change 才落盘, 进度条 input 合帧
if (!/var spApply = function \(w, persist\)/.test(appCode)) wire44.push('面板分隔条未把「生效」与「落盘」拆开 (拖动每像素一次 localStorage 同步写)');
if (!/spEl\.addEventListener\('pointercancel', spCommit\)/.test(appCode)) wire44.push('分隔条缺 pointercancel 落盘 (指针被系统夺走时宽度不持久化)');
const volInput = (appCode.match(/volEl\.addEventListener\('input', function \(\) \{[\s\S]*?\n      \}\);/) || [''])[0];
if (!volInput) wire44.push('未定位到音量滑块 input 处理器 (守卫锚点失效)');
else if (/localStorage\.setItem\('xq_vol'/.test(volInput)) wire44.push('音量滑块仍在 input 里同步落盘 (拖动一次上百次磁盘写)');
if (!/volEl\.addEventListener\('change'[\s\S]{0,120}localStorage\.setItem\('xq_vol'/.test(appCode)) wire44.push('音量滑块缺 change 落盘 (拆开后不持久化)');
if (!/var rpRangePending = false;/.test(appCode)) wire44.push('回放进度条 input 未合帧 (拖动每像素一次整层重画)');
// (c4) sw.js: API 判定作用域相对 + 写缓存挂事件生命周期
const swCode = codeOnly(fs.readFileSync(__dirname + '/../sw.js', 'utf8'));
if (!/function isApiPath\(pathname\)/.test(swCode)) wire44.push('sw.js 缺作用域相对的 API 判定 (子路径部署下 api/* 被当静态资源缓存)');
if (!/if \(isApiPath\(url\.pathname\)\) return;/.test(swCode)) wire44.push('sw.js fetch 处理器未走作用域相对的 API 判定 (写死 /api/ 时子路径部署漏排除)');
if (!/SCOPE_ROOT \+ 'api\/'/.test(swCode)) wire44.push('sw.js 未按作用域根匹配 api/ (与壳清单/导航兜底的作用域相对设计不一致)');
if (!/e\.waitUntil\(putDone\)/.test(swCode)) wire44.push('sw.js 写缓存未挂 waitUntil (respondWith 一 resolve 写入即可能被丢弃)');
if (/caches\.open\(CACHE\)\.then\(function \(c\) \{ return c\.put\(req, copy\); \}\)\.catch\(function \(\) \{\}\);/.test(swCode)) {
  wire44.push('sw.js 写缓存仍是悬空 Promise (未 return 未 waitUntil)');
}
// (c5) manifest: 启动底色必须与首屏**生效的**底色一致 (否则冷启动闪色); 截图声明尺寸必须等于真实像素
//      第44轮教训: index.html 里有两条 body 规则, 后一条 (#080607 + radial) 才是生效的 — 取第一条匹配
//      会得出 #1a0f08 这个被覆盖的旧值。故取「最后一条含 background 的 body 规则」, 优先其中的纯色声明。
const mf = JSON.parse(fs.readFileSync(__dirname + '/../manifest.json', 'utf8'));
const bodyRules = (html.match(/body\{[^}]*\}/g) || []).map(function (r) { return r.replace(/^body\{|\}$/g, ''); });
const bgRule = bodyRules.reverse().find(function (r) { return /background/.test(r); }) || '';
const bgSolid = (bgRule.match(/background:\s*(#[0-9a-fA-F]{6})/) || [])[1];
const bgStops = bgRule.match(/#[0-9a-fA-F]{6}/g) || [];
const bodyBg = bgSolid || bgStops[bgStops.length - 1] || null;
if (!bodyBg) wire44.push('未从 index.html 取到生效的首屏底色 (守卫锚点失效)');
else if (String(mf.background_color).toLowerCase() !== bodyBg.toLowerCase()) {
  wire44.push('manifest background_color (' + mf.background_color + ') 与首屏生效底色 (' + bodyBg + ') 不一致 (冷启动闪色)');
}
(mf.screenshots || []).forEach(function (s) {
  let buf; try { buf = fs.readFileSync(__dirname + '/../' + s.src); } catch (e) { wire44.push('manifest 截图不存在: ' + s.src); return; }
  const real = buf.readUInt32BE(16) + 'x' + buf.readUInt32BE(20);
  if (s.sizes !== real) wire44.push('manifest 截图 ' + s.src + ' 声明 ' + s.sizes + ' 实际 ' + real + ' (安装卡预览失效)');
});
const iconPurposes = (mf.icons || []).map(function (i) { return i.purpose; });
if (iconPurposes.indexOf('any') < 0 || iconPurposes.indexOf('maskable') < 0) wire44.push('manifest 图标 purpose 未同时覆盖 any + maskable');
console.log('第18节 a11y/i18n/热路径/PWA 守卫:', wire44.length ? wire44.join(' | ') : 'OK (工具条可访问名 + 下拉/跳转/翻页名 + aria-pressed + 试连 live region + 模态让位 + 焦点归还 + 表格语义 + 展示文本走字典 + 拖拽/分隔条/音量/进度条热路径 + sw 作用域相对与 waitUntil + manifest 底色/截图尺寸)');
if (wire44.length) process.exit(1);

// 19) 第45轮 源串/结构守卫 — 本轮三类缺陷的共同形态:
//     (a) 「同一个事件被两层各自处理」— 分隔条的 ←/→ 与全局棋盘键盘分支都跑, 一次按键两个动作;
//     (b) 「承诺了动作却没有绑定」/「有 ARIA 语义却没有能承载它的角色」— 徽章 cursor:pointer 零 click、格子 aria-label 挂在无角色 div 上;
//     (c) 「整块重建吞掉焦点与状态」— 思考面板卡片流 / 回放头部与信息面板。
const wire45 = [];
// (a) 分隔条: 方向键必须放行「已被消费」, 且自身可交互判定要覆盖 role=separator
if (!/if \(ev\.defaultPrevented\) return;/.test(appCode)) wire45.push('全局键盘分支未放行已消费的按键 (方向键缺这一条 → 分隔条上按 ←/→ 既调宽又移动棋盘光标)');
var iDpArrow = appCode.indexOf('if (ev.defaultPrevented) return;');
var iArrowBranch = appCode.indexOf("k === 'arrowup' || k === 'arrowdown'");
if (iDpArrow < 0 || iArrowBranch < 0 || iDpArrow > iArrowBranch) {
  wire45.push('方向键分支未排在 defaultPrevented 放行之后 (守卫锚点或实现顺序失效)');
}
if (!/var tRole = /.test(appCode) || !/separator/.test(appCode)) wire45.push('selfActing 未覆盖 role=separator (分隔条不消费 Enter/Space → 焦点在它上面按 Enter 会在棋盘上替用户走一手)');
var spKeyBody = (appCode.match(/spEl\.addEventListener\('keydown', function \(e\) \{[\s\S]*?\n      \}\)/) || [''])[0];
if (!spKeyBody) wire45.push('未定位到分隔条 keydown 处理器 (守卫锚点失效)');
else if (!/e\.stopPropagation\(\)/.test(spKeyBody)) wire45.push('分隔条未 stopPropagation (方向键会继续冒泡到全局棋盘分支)');
// (b1) 最新着法徽章: 元素必须是按钮 + 隐藏态不可聚焦 + 真的有 click 绑定
if (!/<button type="button" id="last-move-badge">/.test(html)) wire45.push('#last-move-badge 不是按钮 (第28轮就承诺「可点击回看该手」)');
if (/<div id="last-move-badge"/.test(html)) wire45.push('#last-move-badge 仍是 <div> (可访问名与原生 Enter/Space 都拿不到)');
var lmbBase = (html.match(/#last-move-badge\{[^}]*\}/) || [''])[0];
var lmbShow = (html.match(/#last-move-badge\.show\{[^}]*\}/) || [''])[0];
if (!/visibility:hidden/.test(lmbBase)) wire45.push('徽章隐藏态缺 visibility:hidden (不可见按钮仍留在 Tab 序内, 第42轮 #btn-row 同款)');
if (!/visibility:visible/.test(lmbShow)) wire45.push('徽章 .show 未恢复 visibility');
if (!/lmBadgeEl\.onclick = function \(\) \{/.test(appCode)) wire45.push('徽章缺 click 绑定 (cursor:pointer 的死按钮)');
if (!/el\.dataset\.ply = String\(ply\)/.test(renCode)) wire45.push('徽章未记录 ply (点击回看的目标手数无处可取)');
if (!/TA\('badge_replay'/.test(renCode)) wire45.push('徽章缺动作型可访问名 (内容是一串着法文本, 不表达「按下去会怎样」)');
// 徽章动作名含 {n} 占位符 → 无法用 data-i18n-aria 声明式刷新, 语言热切必须显式重算 (实机验收抓到切中文后仍播英文)
if (!/function relabelLastMoveBadge\(\)/.test(renCode) || !/relabelLastMoveBadge: relabelLastMoveBadge/.test(renCode)) {
  wire45.push('缺徽章动作名重算出口 relabelLastMoveBadge (或其未导出)');
}
if (!/XQ\.UI\.relabelLastMoveBadge\(\)/.test(appCode)) wire45.push('语言热切未重算徽章动作名 (切到中文后读屏仍播英文, 要等下一手才自愈)');
// (b2) 棋盘格: 有 aria-label 就必须有允许命名的角色
if (!/c\.setAttribute\('role', 'img'\)/.test(renCode)) wire45.push('棋盘格缺 role (无角色 div 的隐式 generic 角色 Name From: prohibited → aria-label 被读屏忽略)');
// (b3) 走法列表条目: 可聚焦必须有动作语义
if (!/e\.setAttribute\('role', 'button'\)/.test(renCode)) wire45.push('走法列表条目缺 role=button (读屏念成无归属文本, 不知道 Enter 能跳局面)');
// (b4) 终局卡键盘出口: 唯一出口 + 「已收起」旗标必须被渲染层尊重与复位
if (!/function dismissEndOverlay\(\)/.test(renCode) || !/dismissEndOverlay: dismissEndOverlay/.test(renCode)) wire45.push('缺终局卡收起单出口 dismissEndOverlay (或其未导出)');
if (!/if \(engine\.isOver\(\) && !overlay\._dismissed\)/.test(renCode)) wire45.push('renderOverlay 未尊重「已收起」旗标 (收起后下一次 refresh 会把卡弹回来)');
if (!/overlay\._dismissed = false;/.test(renCode)) wire45.push('「已收起」旗标未在对局不再结束时复位 (下一局终局卡不再弹出)');
if (!/XQ\.UI\.dismissEndOverlay && XQ\.UI\.dismissEndOverlay\(\)/.test(appCode)) wire45.push('Esc 分支未接终局卡出口 (键盘用户只能靠「再来一局」离开终局卡)');
// (b5) 通知横幅必须有 live 语义, 且先入 DOM 再写文本 (带内容一起插入时部分读屏不播报)
if (!/msgSpan\.setAttribute\('role', 'status'\)/.test(appCode)) wire45.push('续局横幅文本无 live 语义 (异步插入的可操作提示读屏完全不知)');
var iAppendBar = appCode.indexOf('document.body.appendChild(bar);');
var iMsgText = appCode.indexOf("msgSpan.textContent = TA('resume_banner'");
if (iAppendBar < 0 || iMsgText < 0 || iAppendBar > iMsgText) wire45.push('续局横幅未先入 DOM 再写文本 (区域带着内容一起插入时部分读屏不播报)');
// (c1) 思考面板卡片流整块重建: 焦点与展开态都必须存活
if (!/var keepToggle = /.test(renCode)) wire45.push('思考面板卡片重建前未记住焦点 (💭 按钮上的焦点掉回 body)');
if (!/st\.openPlys/.test(renCode) || !/stP\.openPlys\.push\(ply\)/.test(renCode)) wire45.push('💭 展开态未记到面板状态上 (下一手重建时被静默折叠)');
if (!/querySelector\('\.d-toggle\[data-ply="' \+ keepToggle \+ '"\]'\)[\s\S]{0,120}?\.focus\(/.test(renCode)) wire45.push('思考面板卡片重建后未归还焦点 (守卫锚点过弱: 只钉了变量存在)');
// (c2) 回放头部/信息面板重建: 两个 a[href] 链接上的焦点必须归还
if (!/function rpRepaintFocus\(container, html\)/.test(appCode)) wire45.push('缺 rpRepaintFocus 单出口 (#rp-head/#rp-info 重建吞掉链接焦点)');
if (!/rpRepaintFocus\(rpEl\.head, headHtml\)/.test(appCode)) wire45.push('#rp-head 未走焦点保留重建 (最长思考链接上的焦点掉回 body)');
if (!/rpRepaintFocus\(rpEl\.info, html\)/.test(appCode)) wire45.push('#rp-info 未走焦点保留重建 (备注编辑链接上的焦点掉回 body)');
if (/rpEl\.head\.innerHTML =/.test(appCode)) wire45.push('#rp-head 仍直接整块重建 innerHTML (焦点不归还)');
// (c3) 四处焦点陷阱的可聚焦集合必须含 a[href]
var trapSel = (appCode.match(/'button, input, select, a\[href\], \[tabindex="0"\]'/g) || []).length;
if (trapSel < 4) wire45.push('焦点陷阱的可聚焦集合未全部含 a[href] (实为 ' + trapSel + '/4 — 回放层两个锚点漏在集合外)');
console.log('第19节 事件双跑/ARIA 角色/重建保焦点守卫:', wire45.length ? wire45.join(' | ') : 'OK (分隔条让位 + 徽章真按钮与绑定 + 格子与条目角色 + 终局卡收起旗标 + 横幅 live 语义 + 思考面板与回放重建保焦点 + 陷阱含 a[href])');
if (wire45.length) process.exit(1);

