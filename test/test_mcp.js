#!/usr/bin/env node
/* test/test_mcp.js — MCP server 协议级守护 (第93轮, spawn 真实子进程)
 * 时序纪律 (第93轮 CI 修正): 全部断言按「响应到达」轮询等待 (expect(id)), 不用固定 sleep —
 *   首版固定 sleep 在慢 runner (windows CI + 29 套件并行) 上竞态失败, ubuntu 全绿_windows 红。
 * 断言:
 *  M1 initialize 版本协商: 受支持版本原样返回; 未知版本回退 2024-11-05; serverInfo 就位; 通知不回包; ping → {}
 *  M2 tools/list: 6 工具, 每个带 description + inputSchema
 *  M3 会话: sessionId + 初始盘面 (分色清单); 未知会话 isError; 开局合法着法 44 (金标准)
 *  M4 落子: 中炮成功轮黑方; 黑马直线非法 isError; 坐标格式错误 isError
 *  M5 perft: depth 2 = 1920; depth 5 拒绝
 *  M6 协议健壮性: 坏 JSON → -32700 (id:null); 未知方法 → -32601; 此后 ping 仍正常 (进程存活)
 *  M7 LRU: 33 会话后最早一个失效
 *  M8 history 中文记谱序列
 *  M9 子进程 stderr 无输出
 * 用法: node test/test_mcp.js
 */
'use strict';
var cp = require('child_process');
var path = require('path');
var ROOT = path.join(__dirname, '..');

var child = cp.spawn(process.execPath, [path.join(ROOT, 'mcp.js')], { stdio: ['pipe', 'pipe', 'pipe'] });
var buf = '';
var responses = [];
child.stdout.on('data', function (d) {
  buf += d;
  var i;
  while ((i = buf.indexOf('\n')) >= 0) {
    var line = buf.slice(0, i).trim();
    buf = buf.slice(i + 1);
    if (line) { try { responses.push(JSON.parse(line)); } catch (e) { responses.push({ __bad: true }); } }
  }
});
var stderrTail = '';
child.stderr.on('data', function (d) { stderrTail += d; });
function send(o) { child.stdin.write(JSON.stringify(o) + '\n'); }
function sendRaw(line) { child.stdin.write(line + '\n'); }
function find(id) { for (var i = responses.length - 1; i >= 0; i--) if (responses[i].id === id) return responses[i]; return null; }
function wait(ms) { return new Promise(function (r) { setTimeout(r, ms); }); }
/* 按 id 轮询等响应到达 (默认 15s) — CI 慢 runner 安全 */
async function expect(id, ms) {
  var deadline = Date.now() + (ms || 15000);
  for (;;) {
    var r = find(id);
    if (r) return r;
    if (Date.now() > deadline) return null;
    await wait(40);
  }
}

var fails = [];
function ok(cond, msg) {
  if (cond) console.log('  [PASS] ' + msg);
  else { console.log('  [FAIL] ' + msg); fails.push(msg); }
}

(async function main() {
  /* M1 initialize + 通知 + ping */
  send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '0' } } });
  send({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  send({ jsonrpc: '2.0', method: 'notifications/initialized' });   // 通知: 不应产生任何响应
  send({ jsonrpc: '2.0', id: 3, method: 'ping' });
  var init = await expect(1);
  ok(!!init && init.result && init.result.protocolVersion === '2025-06-18' && init.result.serverInfo.name === 'llm-chess-mcp', 'M1a initialize 版本协商 + serverInfo');
  var init2 = await expect(2);
  ok(!!init2 && init2.result && init2.result.protocolVersion === '2024-11-05', 'M1b 未知版本回退 2024-11-05');
  await expect(3);
  var ping = find(3);
  ok(!!ping && ping.result && JSON.stringify(ping.result) === '{}', 'M1c ping → 空结果');
  var notifications = responses.filter(function (r) { return r.id === undefined && !r.__bad; });
  ok(notifications.length === 0, 'M1d 通知不产生响应');

  /* M2 tools/list */
  send({ jsonrpc: '2.0', id: 10, method: 'tools/list' });
  var list = await expect(10);
  var tools = (list && list.result && list.result.tools) || [];
  var names = tools.map(function (t) { return t.name; });
  ok(names.length === 6 && names.indexOf('xiangqi_move') >= 0 && names.indexOf('xiangqi_perft') >= 0,
    'M2a 6 工具且含 move/perft: ' + names.join(','));
  ok(tools.every(function (t) { return t.description && t.inputSchema && t.inputSchema.type === 'object'; }), 'M2b 每工具带 description + inputSchema');

  /* M3 会话 + 开局 44 着法 */
  send({ jsonrpc: '2.0', id: 20, method: 'tools/call', params: { name: 'xiangqi_new_session', arguments: {} } });
  send({ jsonrpc: '2.0', id: 21, method: 'tools/call', params: { name: 'xiangqi_legal_moves', arguments: { sessionId: 'NOPE' } } });
  var ns = await expect(20);
  var sid = ns && ns.result ? (ns.result.content[0].text.match(/sessionId: (\S+)/) || [])[1] : null;
  ok(!!sid, 'M3a new_session 返回 sessionId');
  ok(!!ns && /轮到: 红方/.test(ns.result.content[0].text) && /黑方 \(上\): /.test(ns.result.content[0].text) && /帅e1/.test(ns.result.content[0].text), 'M3b 盘面含分色清单与行棋方');
  var bad1 = await expect(21);
  ok(!!bad1 && bad1.result && bad1.result.isError === true, 'M3c 不存在的会话 → isError');
  send({ jsonrpc: '2.0', id: 22, method: 'tools/call', params: { name: 'xiangqi_legal_moves', arguments: { sessionId: sid } } });
  var legal = await expect(22);
  var legalCount = parseInt(((legal.result.content[0].text.match(/共 (\d+) 种/)) || [])[1], 10);
  ok(legalCount === 44, 'M3d 开局合法着法 44 (金标准), 实得 ' + legalCount);

  /* M4 落子: 中炮 + 黑马直线非法 + 坏坐标 */
  send({ jsonrpc: '2.0', id: 30, method: 'tools/call', params: { name: 'xiangqi_move', arguments: { sessionId: sid, from: 'h3', to: 'e3' } } });
  send({ jsonrpc: '2.0', id: 31, method: 'tools/call', params: { name: 'xiangqi_move', arguments: { sessionId: sid, from: 'b10', to: 'b6' } } });   // 黑马直线 = 非法
  send({ jsonrpc: '2.0', id: 32, method: 'tools/call', params: { name: 'xiangqi_move', arguments: { sessionId: sid, from: 'zz', to: 'e3' } } });
  var mv = await expect(30);
  var mvBad = await expect(31);
  var mvBad2 = await expect(32);
  ok(!!mv && /已落子: h3-e3/.test(mv.result.content[0].text) && /轮到: 黑方/.test(mv.result.content[0].text), 'M4a 中炮落子成功 + 轮到黑方');
  ok(!!mvBad && mvBad.result.isError === true && /非法着法/.test(mvBad.result.content[0].text), 'M4b 非法着法 isError + 原因 (黑马直线)');
  ok(!!mvBad2 && mvBad2.result.isError === true && /坐标格式/.test(mvBad2.result.content[0].text), 'M4c 坐标格式错误 isError');

  /* M5 perft */
  send({ jsonrpc: '2.0', id: 40, method: 'tools/call', params: { name: 'xiangqi_perft', arguments: { depth: 2 } } });
  send({ jsonrpc: '2.0', id: 41, method: 'tools/call', params: { name: 'xiangqi_perft', arguments: { depth: 5 } } });
  var pf = await expect(40, 30000);
  var pfBad = await expect(41);
  ok(!!pf && /perft\(2\) = 1920/.test(pf.result.content[0].text), 'M5a perft(2)=1920 金标准');
  ok(!!pfBad && pfBad.result.isError === true, 'M5b depth 5 拒绝');

  /* M6 协议健壮性: 坏 JSON (id:null) / 未知方法 / 存活后 ping */
  sendRaw('{this is not json');
  send({ jsonrpc: '2.0', id: 50, method: 'resources/list' });
  send({ jsonrpc: '2.0', id: 51, method: 'ping' });
  var unknown = await expect(50);
  var pong = await expect(51);
  var parseErr = null;
  for (var i = responses.length - 1; i >= 0; i--) {
    if (responses[i].id === null && responses[i].error && responses[i].error.code === -32700) { parseErr = responses[i]; break; }
  }
  ok(!!parseErr, 'M6a 坏 JSON → -32700 (id:null, 按 code 扫描)');
  ok(!!unknown && unknown.error && unknown.error.code === -32601, 'M6b resources/list → -32601 (未知方法)');
  ok(!!pong && pong.result && JSON.stringify(pong.result) === '{}', 'M6c 坏 JSON 后进程仍存活, ping 正常响应');

  /* M7 LRU: 再造 33 个会话, 最早的应被淘汰 */
  for (var s = 0; s < 33; s++) send({ jsonrpc: '2.0', id: 100 + s, method: 'tools/call', params: { name: 'xiangqi_new_session', arguments: {} } });
  send({ jsonrpc: '2.0', id: 200, method: 'tools/call', params: { name: 'xiangqi_board', arguments: { sessionId: sid } } });
  var evicted = await expect(200, 30000);
  ok(!!evicted && evicted.result && evicted.result.isError === true, 'M7 超过 32 会话 LRU 淘汰 (旧 sessionId 失效)');

  /* M8 history (新会话走两手) */
  send({ jsonrpc: '2.0', id: 300, method: 'tools/call', params: { name: 'xiangqi_new_session', arguments: {} } });
  var ns2 = await expect(300);
  var sid2 = (ns2.result.content[0].text.match(/sessionId: (\S+)/) || [])[1];
  send({ jsonrpc: '2.0', id: 301, method: 'tools/call', params: { name: 'xiangqi_move', arguments: { sessionId: sid2, from: 'b3', to: 'e3' } } });
  await expect(301);
  send({ jsonrpc: '2.0', id: 302, method: 'tools/call', params: { name: 'xiangqi_move', arguments: { sessionId: sid2, from: 'b8', to: 'e8' } } });
  await expect(302);
  send({ jsonrpc: '2.0', id: 303, method: 'tools/call', params: { name: 'xiangqi_history', arguments: { sessionId: sid2 } } });
  var hist = await expect(303);
  ok(/#1 红 b3-e3/.test(hist.result.content[0].text) && /#2 黑 b8-e8/.test(hist.result.content[0].text), 'M8 history 中文记谱序列');

  child.kill();
  ok(stderrTail.length === 0, 'M9 子进程 stderr 无输出 (异常不外溢)' + (stderrTail ? ': ' + stderrTail.slice(0, 200) : ''));
  console.log(fails.length ? 'mcp: ' + fails.length + ' FAIL' : 'mcp: ALL PASS');
  process.exit(fails.length ? 1 : 0);
})().catch(function (e) {
  child.kill();
  console.error('mcp test crashed:', e);
  process.exit(1);
});
