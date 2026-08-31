#!/usr/bin/env node
// 停止后台 server
const { execSync } = require('child_process');
const PORT = parseInt(process.argv[2] || process.env.PORT || '8788', 10);

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

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
  if (killed.size === 0) console.log(`端口 ${PORT} 上无 server 进程`);
  else console.log(`已停止 ${killed.size} 个进程 (PID: ${[...killed].join(', ')})`);
} catch (e) {
  console.error('停止失败:', e.message);
}
