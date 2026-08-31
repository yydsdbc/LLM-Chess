/* test/match_headless.js — 真实中继无头对局自测 (LLM vs LLM)
 * 用法: node test/match_headless.js [provider] [model] [maxPlies]
 * 验证: 合法链路 / 扩展 meta / 决策日志 / 重试 / 棋谱写盘
 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
for (const f of ['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js',
  'core/generator.js', 'core/judge.js', 'core/engine.js', 'evaluation/xiangqi_knowledge.js', 'evaluation/position.js', 'benchmark/record.js',
  'ai/random_agent.js', 'ai/llm_agent.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const XQ = globalThis.XQ;

const PROVIDER = process.argv[2] || 'tokenrhythm';
const MODEL = process.argv[3] || 'glm-5.3-flash';
const MAX_PLIES = parseInt(process.argv[4] || '6', 10);

// 把 llm_agent 的相对 fetch('api/chat') 指到本地中继
const realFetch = globalThis.fetch;
globalThis.fetch = function (url, opts) {
  return realFetch(new URL(url, 'http://localhost:8788/').href, opts);
};

const engine = XQ.Engine.create();
const redAgent = XQ.LLMAgent.create({ side: 'red', provider: PROVIDER, model: MODEL });
const blackAgent = XQ.LLMAgent.create({ side: 'black', provider: PROVIDER, model: MODEL });
const record = XQ.Record.blank({ redName: MODEL + '(红)', redKind: 'llm', redModel: MODEL, blackName: MODEL + '(黑)', blackKind: 'llm', blackModel: MODEL });

(async function main() {
  console.log(`=== 无头对局自测: ${PROVIDER}:${MODEL} × 双方 | 上限 ${MAX_PLIES} 手 ===\n`);
  const t0 = Date.now();
  const thinkTimes = { red: [], black: [] };
  let retries = { red: 0, black: 0 };

  while (!engine.isOver() && engine.ply() < MAX_PLIES) {
    const side = engine.turn();
    const agent = side === 'red' ? redAgent : blackAgent;
    const tStart = Date.now();
    const pBefore = agent.usage().prompt || 0;   // v3.2: 本手 prompt 增量 (多轮历史增长可观测)
    let mv;
    try {
      mv = await agent.next(engine, null);
    } catch (e) {
      console.log(`✗ ${side} 第${engine.ply() + 1}手 LLM 失败: ${e.message}`);
      finish(true, e.message);   // v2.5: 残局保谱 — 不再整局丢弃 (09:47 断网局全丢教训)
    }
    const secs = (Date.now() - tStart) / 1000;
    const res = engine.applyPlayerMove(mv.from.x, mv.from.y, mv.to.x, mv.to.y);
    if (!res.ok) {
      console.log(`✗ 引擎拒绝了 agent 返回的着法 (${res.reason}) — agent 自校验失效!`);
      finish(true, 'agent 自校验失效: ' + res.reason);   // v2.5: 残局保谱
    }
    const before = agent.usage().requests;
    XQ.Record.addMove(record, engine, res.move, secs * 1000, mv.meta);
    const meta = mv.meta || {};
    thinkTimes[side].push(secs);
    retries[side] = Math.max(retries[side], agent.usage().requests - (side === 'red' ? redMoves : blackMoves));
    const tag = side === 'red' ? '红' : '黑';
    console.log(`#${String(engine.ply()).padStart(2, '0')} ${tag} ${XQ.Move.name(res.move)}`
      + ` | ${meta.evaluation || '?'}`
      + ` | 信${typeof meta.confidence === 'number' ? meta.confidence.toFixed(2) : '?'}`
      + ` | ${secs.toFixed(1)}s`
      + ` | ${meta.summary || '(无摘要)'}`
      + ` | in ${(agent.usage().prompt || 0) - pBefore} tok`);
  }

  // v2.5 残局保谱: 收尾封装 — LLM 故障/自校验失败也保存残谱 + 瞎走检测照跑 (此前 process.exit 直接丢整局)
  function finish(incomplete, why) {
    const dur = Date.now() - t0;
    try { XQ.Record.finish(record, engine.result(), dur); } catch (eR2) { console.log('(Record.finish 跳过: ' + String(eR2.message || eR2).slice(0, 60) + ')'); }
    record.tokens.red = redAgent.usage();
    record.tokens.black = blackAgent.usage();

    const allMoves = record.moves;
    const withMeta = allMoves.filter(m => m.summary).length;
    const avgConf = allMoves.filter(m => typeof m.confidence === 'number');
    const avgC = avgConf.length ? (avgConf.reduce((a, m) => a + m.confidence, 0) / avgConf.length).toFixed(2) : '?';
    const avgT = (s) => s.length ? (s.reduce((a, b) => a + b, 0) / s.length).toFixed(1) + 's' : '-';
    const captures = allMoves.filter(m => m.captured).length;

    console.log('\n=== 对局统计 ===');
    console.log(`总手数      : ${allMoves.length} (上限 ${MAX_PLIES})`);
    console.log(`吃子手数    : ${captures}`);
    console.log(`含决策 meta : ${withMeta}/${allMoves.length}`);
    console.log(`平均信心    : ${avgC}`);
    console.log(`平均思考    : 红 ${avgT(thinkTimes.red)} / 黑 ${avgT(thinkTimes.black)}`);
    console.log(`token 用量  : 红 ${record.tokens.red ? record.tokens.red.total : '?'} / 黑 ${record.tokens.black ? record.tokens.black.total : '?'}`);
    console.log(`非法重试    : 红 ${record.tokens.red ? record.tokens.red.requests - allMoves.filter(m => m.side === 'red').length : '?'} 次 / 黑 ${record.tokens.black ? record.tokens.black.requests - allMoves.filter(m => m.side === 'black').length : '?'} 次`);
    const hitR = record.tokens.red ? (record.tokens.red.cacheHit || 0) : 0;   // v2.6 缓存命中 (provider 上报口径)
    const hitB = record.tokens.black ? (record.tokens.black.cacheHit || 0) : 0;
    const pR = record.tokens.red && record.tokens.red.prompt ? Math.round(100 * hitR / record.tokens.red.prompt) : 0;
    const pB = record.tokens.black && record.tokens.black.prompt ? Math.round(100 * hitB / record.tokens.black.prompt) : 0;
    console.log(`缓存命中    : 红 ${hitR} tok (${pR}%) / 黑 ${hitB} tok (${pB}%) — provider 未上报则显示 0`);
    const blkR = record.tokens.red ? (record.tokens.red.blocked || 0) : 0;   // v2.9 代码级拦截计数 (开局保护/送吃守卫)
    const blkB = record.tokens.black ? (record.tokens.black.blocked || 0) : 0;
    console.log(`系统拦截    : 红 ${blkR} 次 / 黑 ${blkB} 次 (守卫拦下的问题着法)`);

    const out = path.join(ROOT, 'logs', 'match_headless.json');
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const tmpOut = out + '.tmp';   // v3.9a: 原子写 — 先落临时文件再替换, 防中途崩溃留下半写 json (回放/replay_smoke 读半文件会炸)
  fs.writeFileSync(tmpOut, JSON.stringify(record, null, 2), 'utf8');
  fs.renameSync(tmpOut, out);
    console.log(`\n棋谱已写入: ${out}${incomplete ? ` (残谱, ${allMoves.length} 手)` : ''}`);
    // v1.7.7: 对局结束自动跑瞎走检测 (送吃/漏吃/拉锯), 不再需要手动 analyze_blunders
    try {
      console.log('\n=== 瞎走检测 (analyze_blunders) ===');
      execSync('node test/analyze_blunders.js logs/match_headless.json', { cwd: ROOT, stdio: 'inherit' });
    } catch (eB) {
      console.log('(瞎走检测跳过: ' + String(eB.message || eB).slice(0, 80) + ')');
    }
    const okAll = !incomplete && withMeta === allMoves.length && allMoves.length >= Math.min(MAX_PLIES, 4);
    console.log(okAll ? '\nMATCH OK ✓' : '\nMATCH INCOMPLETE ✗');
    process.exit(okAll ? 0 : 1);
  }
  finish(false, '');
})().catch(e => { console.error('MATCH ERROR:', e); process.exit(1); });

// 计数辅助 (供 retries 估算)
var redMoves = 0, blackMoves = 0;
const _add = XQ.Record.addMove;
XQ.Record.addMove = function (r, e, m, t, meta) {
  if (m.piece.color === 'red') redMoves++; else blackMoves++;
  return _add(r, e, m, t, meta);
};