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
