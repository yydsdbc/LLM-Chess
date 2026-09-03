#!/usr/bin/env node
/* v1.0.daily `npm run check` — 跨平台提交前检查 (CI 与本地同一入口):
 * 1) 全部业务 .js 语法扫描 (node --check; 排除产物/依赖目录, 替代 git ls-files | xargs 在 Windows runner 的兼容坑)
 * 2) 提示词硬门禁 test/dump_prompts.js --check (system ≤2400 字 + 无特殊符号 ①②③≥≤~→⚠)
 * 任何一步失败即非零退出。
 */
'use strict';
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const SKIP = new Set(['node_modules', '.git', 'logs', 'temp', 'screenshots', 'docs']);

const files = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) {
      if (!SKIP.has(e.name)) walk(path.join(dir, e.name));
      continue;
    }
    if (e.isFile() && e.name.endsWith('.js')) files.push(path.relative(ROOT, path.join(dir, e.name)));
  }
})(ROOT);

if (!files.length) { console.error('check: no js files found'); process.exit(1); }

let failed = 0;
for (const f of files) {
  try {
    execFileSync(process.execPath, ['--check', f], { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    failed++;
    console.error('SYNTAX FAIL:', f, '\n' + String(e.stderr || e.message));
  }
}
console.log('syntax checked:', files.length, 'files | failed:', failed);
if (failed) process.exit(1);

try {
  execFileSync(process.execPath, ['test/dump_prompts.js', '--check'], { cwd: ROOT, stdio: 'inherit' });
  console.log('prompt gate: PASS (system length + symbol scan)');
} catch (e) {
  console.error('PROMPT GATE FAIL: dump_prompts --check 非零退出');
  process.exit(1);
}
console.log('check: ALL PASS');
