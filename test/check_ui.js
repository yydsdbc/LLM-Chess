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
const pubFiles = ['.gitignore', 'LICENSE', 'package.json', 'config/keys.example.json', 'CHANGELOG.md', '.github/SUPPORT.md'];
const missingPub = pubFiles.filter(f => !fs.existsSync(__dirname + '/../' + f));
console.log('发布文件:', missingPub.length ? '缺失 ' + missingPub.join(', ') : '6/6 (gitignore/LICENSE/package.json/keys.example/CHANGELOG/SUPPORT)');
if (missingPub.length) process.exit(1);

// 8) v1.0.daily README 双语版本一致性 + package.json 版本对齐 (防主/中文档版本漂移)
const pkg = JSON.parse(fs.readFileSync(__dirname + '/../package.json', 'utf8'));
const tEn = (fs.readFileSync(__dirname + '/../README.md', 'utf8').match(/^\uFEFF?#.+$/m) || [''])[0];
const tZh = (fs.readFileSync(__dirname + '/../README.zh-CN.md', 'utf8').match(/^\uFEFF?#.+$/m) || [''])[0];
const vEn = (tEn.match(/v(\d+\.\d+)/) || [])[1];
const vZh = (tZh.match(/v(\d+\.\d+)/) || [])[1];
console.log('README version:', 'EN=' + vEn, 'ZH=' + vZh, 'pkg=' + pkg.version);
if (!vEn || !vZh || vEn !== vZh || pkg.version.indexOf(vEn) !== 0) process.exit(1);

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
if (!man.theme_color || !man.background_color) manIssues.push('缺 theme_color/background_color');
for (const ic of (man.icons || [])) {
  if (!fs.existsSync(__dirname + '/../' + ic.src)) manIssues.push('图标不在盘: ' + ic.src);
}
if (!(man.icons || []).length) manIssues.push('缺 icons');
const themeMeta = /<meta name="theme-color" content="([^"]+)"/.test(html);
if (!themeMeta) manIssues.push('index.html 缺 theme-color meta');
console.log('PWA manifest:', manIssues.length ? manIssues.join(' | ') : 'OK (' + manLink + ', icons ' + (man.icons || []).length + ')');
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
