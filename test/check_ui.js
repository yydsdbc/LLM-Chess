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

// 7) v3.9 发布四件套存在性 (GitHub 用户体验守护)
const pubFiles = ['.gitignore', 'LICENSE', 'package.json', 'config/keys.example.json'];
const missingPub = pubFiles.filter(f => !fs.existsSync(__dirname + '/../' + f));
console.log('发布文件:', missingPub.length ? '缺失 ' + missingPub.join(', ') : '4/4 (gitignore/LICENSE/package.json/keys.example)');
if (missingPub.length) process.exit(1);

// 8) v1.0.daily README 双语版本一致性 + package.json 版本对齐 (防主/中文档版本漂移)
const pkg = JSON.parse(fs.readFileSync(__dirname + '/../package.json', 'utf8'));
const tEn = (fs.readFileSync(__dirname + '/../README.md', 'utf8').match(/^\uFEFF?#.+$/m) || [''])[0];
const tZh = (fs.readFileSync(__dirname + '/../README.zh-CN.md', 'utf8').match(/^\uFEFF?#.+$/m) || [''])[0];
const vEn = (tEn.match(/v(\d+\.\d+)/) || [])[1];
const vZh = (tZh.match(/v(\d+\.\d+)/) || [])[1];
console.log('README version:', 'EN=' + vEn, 'ZH=' + vZh, 'pkg=' + pkg.version);
if (!vEn || !vZh || vEn !== vZh || pkg.version.indexOf(vEn) !== 0) process.exit(1);
