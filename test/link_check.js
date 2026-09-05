// test/link_check.js — 第9套件: 文档相对链接守护 (zero-dep)
// 扫描仓库全部 .md (跳过 node_modules/.git/temp/logs/screenshots), 提取 [text](target) 与 <img src> 中的相对链接,
// 校验目标文件存在; http(s)/mailto/纯锚点/data: 跳过; fenced code block 内的示例不校验。
// 目的: 文档被重命名/移动后 README 双语与 docs/ 立刻报死链, CI 红灯可见。
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP_DIRS = new Set(['node_modules', '.git', 'temp', 'logs', 'screenshots']);
const EXTS = new Set(['.md', '.markdown']);

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

for (const file of files) {
  const base = path.dirname(file);
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
    let target;
    try { target = path.resolve(base, decodeURIComponent(clean)); } catch (e) { target = path.resolve(base, clean); }
    if (!fs.existsSync(target)) {
      broken.push(file.replace(ROOT + path.sep, '') + ' -> ' + raw);
    }
  }
}

console.log('link_check: docs scanned = ' + files.length + ' | relative links checked = ' + checked + ' | broken = ' + broken.length);
if (broken.length) {
  for (const b of broken) console.log('  BROKEN: ' + b);
  process.exit(1);
}
