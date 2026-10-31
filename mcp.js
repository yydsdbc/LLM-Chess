#!/usr/bin/env node
/* mcp.js — LLM-Chess MCP server (Model Context Protocol, stdio transport, 零依赖)
 *
 * 让任何 MCP 客户端 (Claude Desktop / Claude Code / Cursor / Grok Build …) 直接使用本仓
 * perft 金标准验证过的象棋引擎: 开局 44 合法着法、perft(3)=79666、完整亚洲棋规
 * (长将判负 / 三次重复判和 / 自然限着判和 / 将杀困毙)。
 *
 * 协议: newline-delimited JSON-RPC 2.0 over stdio (MCP stdio transport)。
 * 实现 MCP 核心子集: initialize 握手(版本协商) / ping / tools/list / tools/call。
 * 零依赖: 只 require 本仓 core/ 模块, 不引第三方包。
 *
 * 工具 (会话式对局 + 无状态基准):
 *   xiangqi_new_session  开新局 → sessionId
 *   xiangqi_board        盘面 (字母格 + 分色棋子清单, LLM 友好) + 轮到谁 + 终局状态
 *   xiangqi_legal_moves  当前合法着法 (坐标 + 走子名)
 *   xiangqi_move         落子 (from/to = 'h3' 形坐标: 列 a-i, 行 1-10, 红 1 黑 10)
 *   xiangqi_history      已走着法序列
 *   xiangqi_perft        开局 perft 基准 (depth ≤3)
 *
 * 会话只活在本进程内存, 上限 32 (LRU 淘汰) — 无外部存储, 无网络调用。
 * 配置示例 (Claude Desktop claude_desktop_config.json):
 *   { "mcpServers": { "llm-chess": { "command": "node", "args": ["<本仓路径>/mcp.js"] } } }
 */
'use strict';
var path = require('path');
var ROOT = __dirname;

/* 按依赖序装载引擎链 (与 index.html 的 script 顺序一致) */
['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js', 'core/generator.js', 'core/judge.js', 'core/engine.js']
  .forEach(function (f) { require(path.join(ROOT, f)); });
var XQ = globalThis.XQ;
var VERSION = '1.1.5';
var SERVER_NAME = 'llm-chess-mcp';
var SUPPORTED_PROTOCOLS = ['2024-11-05', '2025-03-26', '2025-06-18'];
var FALLBACK_PROTOCOL = '2024-11-05';
var SESSION_CAP = 32;

var sessions = new Map();   // sessionId → { engine, id }; Map 保插入序 → LRU 淘汰最旧

function makeId() { return 'xq-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8); }

/* 坐标: 'h3' → {x:7, y:7} — 列 a-i → x 0-8; 行号 r → y = 10-r (红方底线行 1 = y 9) */
function parseSq(s) {
  var m = /^([a-i])(10|[1-9])$/.exec(String(s == null ? '' : s).trim());
  if (!m) return null;
  return { x: m[1].charCodeAt(0) - 97, y: 10 - parseInt(m[2], 10) };
}
function sqName(x, y) { return String.fromCharCode(97 + x) + String(10 - y); }

function getSession(id) {
  var s = sessions.get(String(id == null ? '' : id));
  if (!s) return null;
  sessions.delete(id); sessions.set(id, s);   // LRU touch
  return s;
}
function putSession(engine) {
  var id = makeId();
  sessions.set(id, { engine: engine, id: id });
  while (sessions.size > SESSION_CAP) {
    var oldest = sessions.keys().next().value;
    sessions.delete(oldest);
  }
  return id;
}

/* 盘面双视图: 字母格 (红大写/黑小写/空位.) + 分色棋子清单 (车马同字, 分组消歧) */
function boardViews(engine) {
  var snap = engine.snapshot();
  var grid = [];
  var red = [], black = [];
  for (var y = 0; y < 10; y++) {
    var row = [];
    for (var x = 0; x < 9; x++) {
      var p = snap.cells[y][x];
      if (!p) { row.push('.'); continue; }
      var L = XQ.Piece.LETTERS[p.color][p.type];
      row.push(p.color === 'red' ? L : L.toLowerCase());
      var item = XQ.Piece.CHARS[p.color][p.type] + sqName(x, y);
      (p.color === 'red' ? red : black).push(item);
    }
    grid.push(row.join(' '));
  }
  var st = engine.result();
  var lines = [
    '格子图 (大写=红方 小写=黑方 .=空位; 行序 10→1, 列 a→i):',
    '10| ' + grid[0]
  ];
  for (var r = 8; r >= 0; r--) {
    var rank = String(r + 1);
    lines.push((rank.length === 1 ? ' ' : '') + rank + '| ' + grid[9 - r]);
  }
  lines.push('   a b c d e f g h i');
  lines.push('黑方 (上): ' + black.join(' '));
  lines.push('红方 (下): ' + red.join(' '));
  lines.push('轮到: ' + (engine.turn() === 'red' ? '红方 (red)' : '黑方 (black)') + ' | 第 ' + engine.ply() + ' 手');
  if (st.over) lines.push('终局: ' + st.result + (st.winner ? ' — ' + (st.winner === 'red' ? '红方胜' : '黑方胜') : ' — 和局'));
  return { text: lines.join('\n'), snap: snap, status: st };
}

function moveList(engine) {
  var color = engine.turn();
  var moves = engine.generateLegalMoves(color);
  return moves.map(function (m) {
    return {
      from: sqName(m.from.x, m.from.y),
      to: sqName(m.to.x, m.to.y),
      piece: XQ.Piece.CHARS[m.piece.color][m.piece.type],
      name: XQ.Move.name(m),
      captures: m.captured ? XQ.Piece.CHARS[m.captured.color][m.captured.type] : null
    };
  });
}

var TOOLS = [
  { name: 'xiangqi_new_session', description: '开一局新象棋对局 (完整亚洲棋规: 长将判负/三次重复判和/自然限着判和)。返回 sessionId 与初始盘面。', inputSchema: { type: 'object', properties: {}, required: [] } },
  { name: 'xiangqi_board', description: '读取当前盘面: 字母格 (大写红/小写黑) + 分色棋子清单 + 轮到谁 + 终局状态。', inputSchema: { type: 'object', properties: { sessionId: { type: 'string', description: 'xiangqi_new_session 返回的会话 id' } }, required: ['sessionId'] } },
  { name: 'xiangqi_legal_moves', description: '列出当前行棋方的全部合法着法 (坐标 from/to + 走子 + 是否吃子)。开局 44 种。', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] } },
  { name: 'xiangqi_move', description: "落子。from/to 用 '列字母+行号' 坐标 (如 'h3'→'e3' 是红方中炮; 行 1=红方底线, 10=黑方底线)。返回结果与新盘面; 非法着法给出原因。", inputSchema: { type: 'object', properties: { sessionId: { type: 'string' }, from: { type: 'string', description: "如 'h3'" }, to: { type: 'string', description: "如 'e3'" } }, required: ['sessionId', 'from', 'to'] } },
  { name: 'xiangqi_history', description: '本局已走着法 (中文记谱序列)。', inputSchema: { type: 'object', properties: { sessionId: { type: 'string' } }, required: ['sessionId'] } },
  { name: 'xiangqi_perft', description: '开局 perft 基准 (走法生成正确性金标准): depth 1/2/3 → 44/1920/79666。', inputSchema: { type: 'object', properties: { depth: { type: 'integer', description: '1-3 (3 约 0.3s)', minimum: 1, maximum: 3 } }, required: ['depth'] } }
];

function textResult(text, isError) {
  var r = { content: [{ type: 'text', text: String(text) }] };
  if (isError) r.isError = true;
  return r;
}

function callTool(name, args) {
  args = args || {};
  switch (name) {
    case 'xiangqi_new_session': {
      var engine = XQ.Engine.create();
      var id = putSession(engine);
      var v = boardViews(engine);
      return textResult('sessionId: ' + id + '\n\n' + v.text);
    }
    case 'xiangqi_board': {
      var s1 = getSession(args.sessionId);
      if (!s1) return textResult('会话不存在或已被淘汰 (上限 32 个 LRU) — 请重新 xiangqi_new_session', true);
      return textResult(boardViews(s1.engine).text);
    }
    case 'xiangqi_legal_moves': {
      var s2 = getSession(args.sessionId);
      if (!s2) return textResult('会话不存在或已被淘汰 — 请重新 xiangqi_new_session', true);
      var list = moveList(s2.engine);
      if (s2.engine.isOver()) return textResult('对局已结束, 无合法着法。\n' + boardViews(s2.engine).text);
      return textResult('共 ' + list.length + ' 种合法着法:\n' + list.map(function (m) {
        return m.name + '  (' + m.piece + ' ' + m.from + '→' + m.to + (m.captures ? ', 吃 ' + m.captures : '') + ')';
      }).join('\n'));
    }
    case 'xiangqi_move': {
      var s3 = getSession(args.sessionId);
      if (!s3) return textResult('会话不存在或已被淘汰 — 请重新 xiangqi_new_session', true);
      var from = parseSq(args.from), to = parseSq(args.to);
      if (!from || !to) return textResult("坐标格式应为 '列字母+行号', 如 'h3'", true);
      var res = s3.engine.applyPlayerMove(from.x, from.y, to.x, to.y);
      if (!res.ok) {
        var why = { game_over: '对局已结束', invalid_coordinates: '坐标越界', empty_square: '起点无子', not_your_turn: '不是该方行棋', illegal_move: '非法着法 (违例或该子走不到)' }[res.reason] || res.reason;
        return textResult('落子失败: ' + why + '\n\n' + boardViews(s3.engine).text, true);
      }
      var v3 = boardViews(s3.engine);
      var mv = s3.engine.history()[s3.engine.history().length - 1];
      return textResult('已落子: ' + XQ.Move.name(mv) + '\n\n' + v3.text);
    }
    case 'xiangqi_history': {
      var s4 = getSession(args.sessionId);
      if (!s4) return textResult('会话不存在或已被淘汰 — 请重新 xiangqi_new_session', true);
      var h = s4.engine.history();
      if (!h.length) return textResult('尚未落子 (第 0 手)。');
      return textResult(h.map(function (m, i) {
        return '#' + (i + 1) + ' ' + (m.piece.color === 'red' ? '红' : '黑') + ' ' + XQ.Move.name(m);
      }).join('\n'));
    }
    case 'xiangqi_perft': {
      var depth = Number(args.depth);
      if (!Number.isInteger(depth) || depth < 1 || depth > 3) return textResult('depth 取 1-3 (3 约 0.3s)', true);
      var board = XQ.Board.create();
      var t0 = Date.now();
      var nodes = XQ.Generator.perft(board, 'red', depth);
      return textResult('perft(' + depth + ') = ' + nodes + ' (' + (Date.now() - t0) + 'ms) — 金标准 44/1920/79666');
    }
    default:
      return textResult('未知工具: ' + name, true);
  }
}

function handleLine(line) {
  var msg;
  try { msg = JSON.parse(line); } catch (e) {
    send({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } });
    return;
  }
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') {
    if (msg && msg.id != null) send({ jsonrpc: '2.0', id: msg.id, error: { code: -32600, message: 'Invalid Request' } });
    return;
  }
  var isNotification = msg.id == null;
  function reply(result) { if (!isNotification) send({ jsonrpc: '2.0', id: msg.id, result: result }); }
  function fail(code, message) { if (!isNotification) send({ jsonrpc: '2.0', id: msg.id, error: { code: code, message: message } }); }

  if (msg.method === 'initialize') {
    var requested = (msg.params && msg.params.protocolVersion) || '';
    var proto = SUPPORTED_PROTOCOLS.indexOf(requested) >= 0 ? requested : FALLBACK_PROTOCOL;
    reply({ protocolVersion: proto, capabilities: { tools: { listChanged: false } }, serverInfo: { name: SERVER_NAME, version: VERSION } });
    return;
  }
  if (msg.method === 'notifications/initialized' || msg.method === 'notifications/cancelled') return;   // 通知无响应
  if (msg.method === 'ping') { reply({}); return; }
  if (msg.method === 'tools/list') { reply({ tools: TOOLS }); return; }
  if (msg.method === 'tools/call') {
    var p = msg.params || {};
    var result;
    try { result = callTool(p.name, p.arguments); }
    catch (e) { result = textResult('工具执行异常: ' + (e && e.message ? e.message : String(e)), true); }
    reply(result);
    return;
  }
  fail(-32601, 'Method not found: ' + msg.method);
}

function send(obj) {
  process.stdout.write(JSON.stringify(obj) + '\n');
}

var buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', function (chunk) {
  buf += chunk;
  var idx;
  while ((idx = buf.indexOf('\n')) >= 0) {
    var line = buf.slice(0, idx).trim();
    buf = buf.slice(idx + 1);
    if (line) {
      try { handleLine(line); } catch (e) { /* 单行故障不终止服务 */ }
    }
  }
});
process.stdin.on('end', function () { process.exit(0); });
process.stdin.resume();
