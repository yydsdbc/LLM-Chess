#!/usr/bin/env node
/* tools/token_audit.js — LLM 对局 token 账单离线测量 (mock 传输, 不打真 API, 零依赖)
 *
 * 用法: node tools/token_audit.js [plies=30] [historyCap=10]
 *
 * 驱动一局真实引擎对局 (两侧各挂一个 mock LLM: 回合法法着法 + 真实形态的输出 JSON),
 * 逐手拆账单: system (可缓存前缀) / 历史 (缓存依赖) / 新尾 (每手全价) / assistant 输出。
 * token 粗估: CJK 字符 ≈1 token, ASCII ≈0.25 token (够做相对比较; 精确值以 provider usage 为准)。
 *
 * 场景: 提示词成本优化决策 (第96轮) — 调 HIST_CAP / 裁剪历史载荷前先跑本工具拿数据。
 */
'use strict';
var path = require('path');
var ROOT = path.join(__dirname, '..');
['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js', 'core/generator.js', 'core/judge.js', 'core/engine.js',
 'evaluation/xiangqi_knowledge.js', 'evaluation/position.js', 'ai/random_agent.js', 'ai/llm_agent.js']
  .forEach(function (f) { require(path.join(ROOT, f)); });
var XQ = globalThis.XQ;

var PLIES = parseInt(process.argv[2] || '30', 10);
var CAP = process.argv[3] != null ? parseInt(process.argv[3], 10) : undefined;   // 传给 create.historyCap; 缺省 = agent 默认

function tokEstimate(s) {
  var cjk = 0;
  for (var i = 0; i < s.length; i++) if (s.charCodeAt(i) > 0x2e00) cjk++;
  var ascii = s.length - cjk;
  return cjk + Math.round(ascii * 0.25);
}

function mkAgent(side, cap) {
  var opts = { side: side, provider: 'audit', model: 'audit-' + side };
  if (cap != null) opts.historyCap = cap;
  return XQ.LLMAgent.create(opts);
}

(async function main() {
  var engine = XQ.Engine.create();
  var agents = { red: mkAgent('red', CAP), black: mkAgent('black', CAP) };
  var bill = { moves: [], system: 0, hist: 0, tail: 0, out: 0 };
  var current = 'red';
  var ply = 0;

  // mock 传输: 每次调用取当前行棋方的一个合法着法 (驱动前由主循环闭包提供)
  var pendingMove = null;
  globalThis.fetch = async function (url, opts) {
    function legalJSON(mv) {
      return JSON.stringify({
        from: mv.from, to: mv.to,
        summary: '中炮控线,压制中路反击',
        plan: '稳住中路',
        evaluation: '+0.5 红方略优',
        score: 0.5,
        confidence: 0.82,
        candidates: [{ from: mv.from, to: mv.to }]
      });
    }
    var body = JSON.parse(opts.body);
    // 送吃守卫同口径择着: 从最后一手 user 的标注列表挑无 危/亏 项 (随机项会被守卫拒绝至抛错)
    var tailText = body.messages[body.messages.length - 1].content;
    var items = [], re = /\[([a-i](?:10|[1-9]))>([a-i](?:10|[1-9]))([^\]]*)\]/g, mm;
    while ((mm = re.exec(tailText))) if (!/危|亏/.test(mm[3])) items.push({ from: mm[1], to: mm[2] });
    if (!items.length) items.push({ from: XQ.Move.sqName(pendingMove.from), to: XQ.Move.sqName(pendingMove.to) });
    var pick = items[Math.floor(Math.random() * items.length)];
    var out = legalJSON(pick, ply);
    var sys = body.messages[0].content;
    var hist = '', tail = body.messages[body.messages.length - 1].content;
    for (var i = 1; i < body.messages.length - 1; i++) hist += body.messages[i].content;
    bill.moves.push({
      ply: ply,
      sys: sys.length, hist: hist.length, tail: tail.length, out: out.length,
      sysT: tokEstimate(sys), histT: tokEstimate(hist), tailT: tokEstimate(tail), outT: tokEstimate(out)
    });
    return {
      ok: true,
      headers: { get: function (k) { return k.toLowerCase() === 'content-type' ? 'application/json' : null; } },
      json: async function () {
        return { choices: [{ message: { content: out }, reasoning_content: '' }], usage: {} };
      }
    };
  };

  while (ply < PLIES) {
    if (engine.isOver()) break;
    var agent = agents[current];
    var legals = engine.generateLegalMoves(current);
    pendingMove = legals[Math.floor(Math.random() * legals.length)];   // 随机着法 → 长局 (固定首着会快速终局, 测不到稳态)
    var mv = await agent.next(engine, null);
    if (!mv || !mv.from) { console.error('move failed at ply', ply, mv && mv.reason); process.exit(1); }
    engine.applyPlayerMove(mv.from.x, mv.from.y, mv.to.x, mv.to.y);
    ply++;
    current = current === 'red' ? 'black' : 'red';
  }

  bill.moves.forEach(function (m) {
    bill.system += m.sysT; bill.hist += m.histT; bill.tail += m.tailT; bill.out += m.outT;
  });
  var rows = [1, 2, Math.floor(PLIES / 4), Math.floor(PLIES / 2), PLIES];
  console.log('config: plies=' + bill.moves.length + ' historyCap=' + (CAP == null ? 'default(10)' : CAP));
  console.log('ply | sys | hist | tail | out | (chars, 粗估token在括号内)');
  bill.moves.forEach(function (m) {
    if (rows.indexOf(m.ply) < 0) return;
    console.log(' ' + String(m.ply).padStart(3) + ' | ' + String(m.sys).padStart(5) + ' | ' + String(m.hist).padStart(6) + ' | ' + String(m.tail).padStart(5) + ' | ' + String(m.out).padStart(4));
  });
  var totC = bill.system + bill.hist + bill.tail + bill.out;
  var totT = bill.system + bill.hist + bill.tail + bill.out;
  console.log('---整局合计 (粗估 token)---');
  console.log('system: ' + bill.system + ' | history: ' + bill.hist + ' | tail(每手全价): ' + bill.tail + ' | output: ' + bill.out);
  console.log('全价部分 (tail+output, 不吃缓存): ' + (bill.tail + bill.out));
  console.log('注: system/history 是否吃缓存取决于 provider; 无缓存 provider 上 system+history 也按全价计');
})();
