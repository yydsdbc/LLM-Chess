#!/usr/bin/env node
// LLM-chess v1.0 一键启动
// 用法: node tools/start.js [port]   默认 8790
const { spawn, execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const http = require('http');

const PORT = parseInt(process.argv[2] || process.env.PORT || '8788', 10);
const ROOT = path.resolve(__dirname, '..');
const URL  = `http://localhost:${PORT}/`;
const LOG_DIR = path.join(ROOT, 'logs');
const LOG_FILE = path.join(LOG_DIR, 'server.log');

function log(tag, msg) {
  const c = { '!':'\x1b[33m', '+':'\x1b[32m', '-':'\x1b[31m', '=':'\x1b[36m' }[tag] || '';
  console.log(`${c}${tag}\x1b[0m ${msg}`);
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function killOld() {
  try {
    const out = execSync(`netstat -ano`, { encoding: 'utf8' });
    const re = new RegExp(`[:.]${PORT}\\s.*?(\\d+)\\s*$`, 'gm');
    let m, killed = new Set();
    while ((m = re.exec(out))) {
      const pid = parseInt(m[1], 10);
      if (pid > 4 && !killed.has(pid)) {
        try { execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' }); killed.add(pid); }
        catch {}
      }
    }
    return killed.size;
  } catch { return 0; }
}

function fetchJSON(p) {
  return new Promise((resolve, reject) => {
    const req = http.get(URL + p, { timeout: 3000 }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => {
        try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
        catch (e) { reject(e); }
      });
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('timeout')); });
  });
}

async function main() {
  console.log('\x1b[36m\x1b[1m');
  console.log('==========================================');
  console.log('  LLM-chess v1.0  一键启动');
  console.log('==========================================');
  console.log('\x1b[0m');

  log('!', `[1/4] 清理端口 ${PORT} 上的旧进程...`);
  const n = killOld();
  log(' ', `    终止 ${n} 个进程`);
  await sleep(800);

  log('!', `[2/4] 启动 server.js (端口 ${PORT})...`);
  if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
  const out = fs.openSync(LOG_FILE, 'a');
  const err = fs.openSync(LOG_FILE, 'a');
  const srv = spawn(process.execPath, [path.join(ROOT, 'server.js'), String(PORT)], {
    cwd: ROOT,
    detached: true,
    windowsHide: true,
    stdio: ['ignore', out, err],
  });
  srv.unref();
  log('+', `    server PID ${srv.pid}, 日志: ${LOG_FILE}`);
  await sleep(2500);

  log('!', '[3/4] 健康检查 / 拉取服务商列表...');
  let info = null;
  for (let i = 1; i <= 6; i++) {
    try {
      info = await fetchJSON('api/providers');
      break;
    } catch (e) {
      log(' ', `    第 ${i} 次未就绪 (${e.message})`);
      await sleep(1500);
    }
  }
  if (!info) {
    log('-', 'server 启动失败, 最近日志:');
    try { console.log(fs.readFileSync(LOG_FILE, 'utf8').split('\n').slice(-15).join('\n')); } catch {}
    process.exit(1);
  }
  log('+', `    OK, 找到 ${info.providers.length} 个服务商:`);
  for (const p of info.providers) {
    const mark = p.hasKey ? '[KEY]' : '[  ]';
    console.log(`      ${mark.padEnd(6)} ${p.id.padEnd(13)} ${p.name}  ${p.baseUrl}`);
  }
  if (!info.providers.some(p => p.hasKey)) {
    log('!', '未检测到任何 apiKey — 零配置试玩: 对战设置执方选「随机AI」; 或编辑 config/keys.json 填入 key 后重启');
  }

  log('!', '[4/4] 打开浏览器...');
  const url = `${URL}?nocache=${Math.random().toString(36).slice(2, 10)}`;
  spawn('cmd', ['/c', 'start', '""', url], { detached: true, stdio: 'ignore' }).unref();

  console.log('\x1b[36m\x1b[1m');
  console.log('==========================================');
  console.log('  OK, 已就绪');
  console.log('==========================================');
  console.log('\x1b[0m');
  console.log(`  URL:     ${URL}`);
  console.log(`  Server:  PID ${srv.pid} (后台运行, 关窗口不退出)`);
  console.log(`  日志:    ${LOG_FILE}`);
  console.log(`  停止:    node tools/stop.js   或   任务管理器结束 node.exe (PID ${srv.pid})`);
  console.log('');
}

main().catch(e => { log('-', e.stack || String(e)); process.exit(1); });
