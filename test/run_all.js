#!/usr/bin/env node
/* test/run_all.js — 并行测试运行器 (v1.0.3, 第4项优化)
 * 10 套件并行跑 (串行 33.5s → 并行 ~15s, 2.3x)。
 * 零依赖 (child_process); Windows/Unix 兼容; 任一套件失败即整体失败 (CI 友好)。
 * 原串行链保留: npm run test:serial (test_llm_convo 带 mock 时序, 并行安全已验证)
 */
'use strict';
const { spawn } = require('child_process');
const path = require('path');
const os = require('os');

const SUITES = [   // v1.0.daily 第18轮 +1: _replay_edge.js (回放边界+书签守护)
  'run_tests.js',
  'test_evaluation.js',
  'test_llm_convo.js',
  'replay_smoke.js',
  '_clean_reason_check.js',
  'cn_notation_check.js',
  'i18n_check.js',
  'link_check.js',
  'check_ui.js',
  '_replay_edge.js',
];

const root = path.join(__dirname, '..');
const quiet = process.argv.includes('--quiet');
const children = [];
const results = [];
let done = 0, failed = 0;

console.log('llm-chess parallel test runner: ' + SUITES.length + ' suites');
for (const suite of SUITES) {
  const p = spawn(process.execPath, [path.join(__dirname, suite)], {
    cwd: root,
    stdio: quiet ? 'ignore' : ['ignore', 'pipe', 'pipe'],
  });
  children.push(p);
  let tail = '';
  if (!quiet) {
    p.stdout.on('data', c => { tail = (tail + c.toString()).slice(-4000); });
    p.stderr.on('data', c => { tail = (tail + c.toString()).slice(-4000); });
  }
  p.on('exit', (code) => {
    done++;
    if (code === 0) {
      results.push('  [PASS] ' + suite);
    } else {
      failed++;
      results.push('  [FAIL] ' + suite + ' (exit ' + code + ')');
      console.log('--- ' + suite + ' failed, tail output ---');
      console.log(tail || '(no output)');
    }
    if (done === SUITES.length) {
      console.log(results.join('\n'));
      console.log('parallel runner: ' + (SUITES.length - failed) + '/' + SUITES.length + ' PASS' + (failed ? ', ' + failed + ' FAILED' : ''));
      process.exit(failed ? 1 : 0);
    }
  });
}

// 任一套件失败超过 5 分钟整体超时兜底 (防挂起套件卡死 CI)
setTimeout(() => {
  console.error('parallel runner: global timeout (5min) — killing all suites');
  for (const p of children) { try { p.kill(); } catch (e) {} }
  process.exit(2);
}, 5 * 60 * 1000).unref();
