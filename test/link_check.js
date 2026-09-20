// test/link_check.js — 第9套件: 文档相对链接守护 (zero-dep)
// 扫描仓库全部 .md (跳过 node_modules/.git/temp/logs/screenshots), 提取 [text](target) 与 <img src> 中的相对链接,
// 校验目标文件存在; http(s)/mailto/纯锚点/data: 跳过; fenced code block 内的示例不校验。
// 目的: 文档被重命名/移动后 README 双语与 docs/ 立刻报死链, CI 红灯可见。
// 第45轮: 追加「子目录文档的相对链接必须 ../ 前缀」判据 — AGENTS.md 与 CONTRIBUTING 一直这么要求, 而本套件
//   只做存在性解析 (path.resolve 允许同目录写法), 于是 .github/SUPPORT.md 里写 [x](SUPPORT.md) 会全绿通过,
//   在 GitHub 上却指向 /docs/SUPPORT.md 这类不存在的地址。存在性判据无法覆盖「路径解析正确但写法定错」这一类。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'temp', 'logs', 'screenshots']);
const EXTS = new Set(['.md', '.markdown']);
const PREFIX_DIRS = new Set(['docs', '.github']);   // 第45轮: 这些目录下的 md 必须用 ../ 指回仓库根/其他目录

function walk(dir, out) {
  for (const name of fs.readdirSync(dir)) {
    const p = path.join(dir, name);
    let st;
    try { st = fs.statSync(p); } catch (e) { continue; }
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(name)) walk(p, out);
    } else if (EXTS.has(path.extname(name).toLowerCase())) {
      out.push(p);
    }
  }
  return out;
}

const files = walk(ROOT, []);
const linkRe = /\[[^\]\n]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)|<img[^>]+src=["']([^"']+)["']/g;
let checked = 0;
const broken = [];
const prefixBad = [];

for (const file of files) {
  const base = path.dirname(file);
  const relDir = path.relative(ROOT, base).split(path.sep)[0];   // 相对仓库根的首段目录 (docs / .github / '')
  const needsPrefix = PREFIX_DIRS.has(relDir);
  const text = fs.readFileSync(file, 'utf8');
  const noFence = text.replace(/^```[\s\S]*?^```/gm, ''); // 剥 fenced code block
  let m;
  while ((m = linkRe.exec(noFence))) {
    const raw = m[1] || m[2];
    if (!raw) continue;
    if (/^(https?:|mailto:|#|data:)/i.test(raw)) continue;
    const clean = raw.split('#')[0].trim(); // 锚点部分不校验 (GitHub 渲染规则复杂, 只守护文件存在性)
    if (!clean) continue;
    checked++;
    if (needsPrefix && clean.indexOf('../') !== 0) {   // 第45轮: 子目录文档的相对链接必须回到上级再走
      prefixBad.push(file.replace(ROOT + path.sep, '') + ' -> ' + raw);
    }
    let target;
    try { target = path.resolve(base, decodeURIComponent(clean)); } catch (e) { target = path.resolve(base, clean); }
    if (!fs.existsSync(target)) {
      broken.push(file.replace(ROOT + path.sep, '') + ' -> ' + raw);
    }
  }
}

console.log('link_check: docs scanned = ' + files.length + ' | relative links checked = ' + checked
  + ' | broken = ' + broken.length + ' | 缺 ../ 前缀 = ' + prefixBad.length);
if (prefixBad.length) {
  for (const p of prefixBad) console.log('  MISSING-PREFIX (docs/ 与 .github/ 下的相对链接必须以 ../ 开头): ' + p);
}
if (broken.length) {
  for (const b of broken) console.log('  BROKEN: ' + b);
}
if (broken.length || prefixBad.length) process.exit(1);
