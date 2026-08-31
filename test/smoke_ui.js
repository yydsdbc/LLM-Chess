/* smoke_ui.js — 无头浏览器 UI 冒烟测试 (CDP 直驱 Edge, 无需 puppeteer)
 * 流程: 起 Edge headless → 打开 http://localhost:8788 → DOM 断言 →
 *       注入双 LLM 配置 → reload 自动开局 → 等第一手落子 → 截图 ×2
 * 用法: node test/smoke_ui.js [model=glm-5.3-flash] [moveTimeoutMs=480000]
 * 退出码: 0=PASS, 1=FAIL
 */
'use strict';
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const MODEL = process.argv[2] || 'glm-5.3-flash';
const MOVE_TIMEOUT = parseInt(process.argv[3] || '480000', 10);
const PORT = 9333;
const URL_APP = 'http://localhost:8788';
const EDGE_CANDIDATES = [
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Google/Chrome/Application/chrome.exe'
];
const SHOT_DIR = path.join(__dirname, '..', 'screenshots');

const edgeBin = EDGE_CANDIDATES.find(p => fs.existsSync(p));
if (!edgeBin) { console.error('未找到 Edge/Chrome'); process.exit(1); }

const sleep = ms => new Promise(r => setTimeout(r, ms));
let ws, msgId = 0;
const pending = new Map();

function send(method, params = {}, sessionId) {
  const id = ++msgId;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    setTimeout(() => { if (pending.has(id)) { pending.delete(id); reject(new Error('CDP 超时: ' + method)); } }, 30000);
  });
}

async function cdpEval(expr) {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error('页面异常: ' + JSON.stringify(r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text).slice(0, 200));
  return r.result && r.result.value;
}

async function waitReady(port, tries = 40) {
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return true;
    } catch (e) { /* not ready */ }
    await sleep(250);
  }
  return false;
}

async function shot(name) {
  const r = await send('Page.captureScreenshot', { format: 'png' });
  fs.mkdirSync(SHOT_DIR, { recursive: true });
  const file = path.join(SHOT_DIR, name);
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  console.log('  📸 ' + file);
}

async function main() {
  let passed = 0, failed = 0;
  const ok = (cond, name) => { if (cond) { passed++; console.log('  [PASS] ' + name); } else { failed++; console.log('  [FAIL] ' + name); } };

  const profile = fs.mkdtempSync(path.join(require('os').tmpdir(), 'edge-xq-'));
  const proc = spawn(edgeBin, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1500,950', 'about:blank'
  ], { stdio: 'ignore' });
  const cleanup = () => { try { proc.kill(); } catch (e) {} try { fs.rmSync(profile, { recursive: true, force: true }); } catch (e2) {} };
  process.on('exit', cleanup);

  try {
    if (!await waitReady(PORT)) throw new Error('CDP 端口未就绪');
    // 新建 page target
    const created = await fetch(`http://127.0.0.1:${PORT}/json/new?about:blank`, { method: 'PUT' }).then(r => r.json());
    const wsUrl = created.webSocketDebuggerUrl;
    ws = new WebSocket(wsUrl);
    await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
    ws.onmessage = ev => {
      const m = JSON.parse(ev.data);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); p.resolve(m.result || {}); }
    };

    await send('Page.enable');
    await send('Page.navigate', { url: URL_APP });
    await sleep(2500);   // 等 DOMContentLoaded + health 探测

    // ── 基础渲染断言 ──
    ok(await cdpEval(`!!window.XQ`), 'window.XQ 已加载 (core+ai+ui 全链路)');
    ok(await cdpEval(`!!document.getElementById('board')`), '棋盘 #board 存在');
    ok(await cdpEval(`document.getElementById('board').getBoundingClientRect().width > 0`), '棋盘 canvas 已绘制 (CSS 盒宽>0)');
    ok(await cdpEval(`!!document.getElementById('think-red-body') && !!document.getElementById('think-black-body')`), '双侧思考面板存在');
    ok(await cdpEval(`(document.getElementById('status-text')||{}).textContent !== undefined`), '状态条存在');
    ok(await cdpEval(`window.XQ.Engine && !!window.XQ.Engine.create`), '引擎可用');
    const relay = await cdpEval(`fetch('api/health').then(r=>r.json()).then(j=>!!j.relay)`);
    ok(relay === true, '页面内中继探测通过 (relay=true)');

    await shot('ui_home.png');

    // ── 注入双 LLM 配置 → reload → 自动开局 ──
    const cfg = JSON.stringify({
      red: { enabled: true, type: 'llm', provider: 'tokenrhythm', model: MODEL },
      black: { enabled: true, type: 'llm', provider: 'tokenrhythm', model: MODEL }
    });
    await cdpEval(`localStorage.setItem('xq_v1_settings', ${JSON.stringify(cfg)}); 'ok'`);
    await send('Page.navigate', { url: URL_APP });
    await sleep(3000);

    const aiBanner = await cdpEval(`(document.getElementById('ai-banner')||{}).textContent || ''`);
    console.log('  开局横幅: "' + aiBanner.trim() + '"');

    // ── 等第一手落子 (move-log 出现条目) ──
    console.log('  等待 LLM 走第一手 (上限 ' + Math.round(MOVE_TIMEOUT / 1000) + 's) ...');
    const t0 = Date.now();
    let moved = false, thinkText = '';
    while (Date.now() - t0 < MOVE_TIMEOUT) {
      await sleep(5000);
      const st = await cdpEval(`JSON.stringify({
        moves: document.getElementById('move-log').children.length,
        redBody: (document.getElementById('think-red-body').textContent||'').length,
        blackBody: (document.getElementById('think-black-body').textContent||'').length,
        status: (document.getElementById('status-text')||{}).textContent || '',
        info: (document.getElementById('status-info')||{}).textContent || ''
      })`);
      const s = JSON.parse(st);
      thinkText = s.status + ' | ' + s.info;
      if (s.moves >= 1) { moved = true; console.log('  第一手完成 @ ' + Math.round((Date.now() - t0) / 1000) + 's | 状态: ' + thinkText); break; }
      if (Date.now() - t0 > 30000 && (Date.now() - t0) % 30000 < 5000) console.log('  ...思考中 (' + Math.round((Date.now() - t0) / 1000) + 's) 状态: ' + thinkText);
    }
    ok(moved, '第一手落子 (move-log 出现记录)');

    // v1.5 决策卡片断言: 结构断言(应用渲染, 落子即有) 与 meta 质量断言(模型输出) 分离
    const meta = await cdpEval(`JSON.stringify({
      red: (document.getElementById('think-red-body').textContent||''),
      black: (document.getElementById('think-black-body').textContent||''),
      cards: document.querySelectorAll('.dcard').length,
      hasNum: !!document.querySelector('.dcard .d-move') && /#[0-9]+/.test((document.querySelector('.dcard .d-move')||{}).textContent||''),
      hasConf: document.querySelectorAll('.dcard .d-meta').length > 0 && /\u4fe1[0-9.]/.test((document.querySelector('.dcard .d-meta')||{}).textContent||'')
    })`);
    const m = JSON.parse(meta);
    const allMeta = m.red + m.black;
    ok(m.red.length > 0 || m.black.length > 0, '思考面板非空 (流式内容到达)');
    ok(m.cards >= 1 && m.hasNum, '决策卡片已渲染 (dcard 结构+手号#n)');
    ok(m.hasConf, '决策信心已渲染 (d-meta 含信x.x)');
    ok(!/\(\u65e0\u6458\u8981\)/.test(allMeta), '第一手决策摘要非空 (meta 未丢失)');

    await shot('ui_move1.png');

    // ── 分页回归哨兵: 长文注入, 面板零溢出且翻页器显示 ──
    // (历史 bug: line-height:1.5 无单位 computed 是数字, 未乘字号致单页容量虚高10倍 → 不分页溢出)
    const LONGTXT = '这是中国象棋开局第一步。红方先手执先，局面完全均衡，子力差为0。受威胁之子：马(b1)、马(h1)。'.repeat(25);
    const pgr = await cdpEval(`(function(){
      XQ.UI.thinkPanel('black', { text: ${JSON.stringify(LONGTXT)}, active: true });
      var root=document.getElementById('think-black'), body=document.getElementById('think-black-body');
      var pager=root.querySelector('.think-pager');
      return JSON.stringify({
        overflow: Math.round(body.scrollHeight - body.getBoundingClientRect().height),
        pager: pager ? pager.classList.contains('show') : false,
        pages: pager ? pager.querySelector('.pg-info').textContent : ''
      });
    })()`);
    const pj = JSON.parse(pgr);
    ok(pj.overflow <= 2, '长文分页: 面板零溢出 (超氟' + pj.overflow + 'px)');
    ok(pj.pager, '长文分页: 翻页器显示 (' + pj.pages + ')');

    console.log(failed ? `\n${failed} FAILED` : `\nUI 冒烟全部通过 ✓ (${passed} 项)`);
    process.exitCode = failed ? 1 : 0;
  } catch (e) {
    console.error('UI 冒烟异常:', e.message);
    process.exitCode = 1;
  } finally {
    try { if (ws) ws.close(); } catch (e) {}
    cleanup();
  }
}

main();
