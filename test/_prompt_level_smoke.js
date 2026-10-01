// test/_prompt_level_smoke.js — promptLevel 分级注入验证 (第28轮: 修复迁移前陈旧绝对路径 + 退出码纪律, 挂链 run_all)
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
for (const f of ['core/piece.js','core/move.js','core/board.js','core/rules.js','core/generator.js','core/judge.js','core/engine.js','evaluation/xiangqi_knowledge.js','evaluation/position.js','ai/llm_agent.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const XQ = globalThis.XQ;
let failed = 0;
function ok(cond, name) {
  console.log((cond ? '  [PASS] ' : '  [FAIL] ') + name);
  if (!cond) failed++;
}
async function captureSystem(levelOrStyle, side = 'red', engine = XQ.Engine.create()) {
  const agent = XQ.LLMAgent.create(Object.assign({ side, provider: 'tokenrhythm', model: 'glm-5.3-flash' }, levelOrStyle));
  let captured = null;
  const legal = engine.generateLegalMoves(side)[0];
  const answer = JSON.stringify({ from: XQ.Move.sqName(legal.from), to: XQ.Move.sqName(legal.to), summary: '测试', confidence: 0.5 });
  globalThis.fetch = function (url, opts) { captured = JSON.parse(opts.body); return Promise.resolve({ ok: true, status: 200, headers: { get: function () { return 'application/json'; } }, json: async () => ({ choices: [{ message: { content: answer } }] }) }); };
  await agent.next(engine);
  return captured.messages[0].content;
}
(async function main() {
const sysHigh = await captureSystem({ promptLevel: 'high' });
const sysNone = await captureSystem({ promptLevel: 'none' });
const sysMid = await captureSystem({ promptLevel: 'mid' });
const sysLow = await captureSystem({ promptLevel: 'low' });
const sysLegacy = await captureSystem({ style: 'defensive' });   // legacy 兼容
ok(sysHigh.includes('## 风格:') && sysHigh.includes('战术补充'), 'high 注入风格节 + 战术补充');
ok(!sysNone.includes('## 风格:'), 'none 无风格节');
ok(sysMid.includes('风格: 主动制造威胁') && !sysMid.includes('战术补充'), 'mid 标准风格 (无战术补充)');
ok(sysLow.includes('主动但不冒进') && !sysLow.includes('战术补充'), 'low 一句话风格');
ok(sysLegacy.includes('风格: 主动制造威胁'), 'legacy style=defensive 兼容 (映射 mid)');
ok(!sysHigh.includes('你的棋风') && !sysHigh.includes('均势按棋风'), '旧棋风措辞零残留');
const again = await captureSystem({ promptLevel: 'high' });
ok(again === sysHigh, 'system 恒定 (同等级两调用逐字一致, 前缀缓存前提)');
ok(sysHigh.length === again.length && new Set([sysHigh.length, sysMid.length, sysLow.length, sysNone.length]).size === 4, '四级 system 长度互异且同级恒定');
ok(sysNone.length < sysLow.length && sysLow.length < sysMid.length && sysMid.length < sysHigh.length, '提示等级保持从 none 到 high 递增');
for (const side of ['red', 'black']) {
  for (const promptLevel of ['none', 'low', 'mid', 'high']) {
    const system = await captureSystem({ promptLevel }, side);
    ok(system.length <= 2400, side + '/' + promptLevel + ' 全等级字数门禁: ' + system.length);
    ok(!/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮≥≤~→←↑↓⚠]/.test(system), side + '/' + promptLevel + ' 禁用符号门禁');
    const changed = XQ.Engine.create();
    changed.applyPlayerMove(1, 7, 4, 7);
    changed.applyPlayerMove(7, 2, 4, 2);
    ok(await captureSystem({ promptLevel }, side, changed) === system, side + '/' + promptLevel + ' 棋盘变化不改 system 前缀');
    const exampleText = system.split('\n').find(line => line.startsWith('{'));
    const example = JSON.parse(exampleText);
    ok(exampleText.length <= 90 && Object.keys(example).sort().join(',') === 'confidence,from,summary,to', side + '/' + promptLevel + ' 必填示例可解析且符合90字预算');
    ok(example.from === (side === 'red' ? 'h3' : 'h8') && example.to === (side === 'red' ? 'e3' : 'e8'), side + '/' + promptLevel + ' 示例坐标符合执子方');
    const optionalExample = system.split('\n').find(line => line.startsWith('- candidates 示例: '));
    const candidates = JSON.parse(optionalExample.slice('- candidates 示例: '.length));
    const fullExample = Object.assign({}, example, { plan: '控制中路', evaluation: side === 'red' ? '+0.3 红略优' : '-0.3 黑略优', candidates });
    ok(JSON.stringify(fullExample).length <= 180 && candidates[0].move === example.from + '-' + example.to, side + '/' + promptLevel + ' 可选示例符合180字预算且首候选等于选着');
  }
}
ok(sysMid.includes('JSON字段名与坐标除外') && !sysMid.includes('禁英文与讲解'), '中文输出限制及末尾提醒一致允许机器字段和坐标');
ok(sysMid.includes('带可选字段总长180字以内'), '可选分析字段拥有明确且独立的输出预算');
ok(sysMid.includes('选着可靠度, 非胜率') && sysMid.includes('唯一应将可高信心') && !sysMid.includes('被迫防守0.4以下'), '信心描述不把被迫应将等同于低可靠度');
ok(sysMid.includes('黑方填evaluation须反号'), '黑方输出明确转换引擎的你方评分视角');
ok(!sysMid.includes('唯一远程火力'), '炮的战略描述不排除车的远程作用');
const pawnBoard = XQ.Board.makeFromGrid(new Array(90).fill(null));
pawnBoard.set(4, 9, XQ.Piece.create('red', 'king'));
pawnBoard.set(3, 0, XQ.Piece.create('black', 'king'));
pawnBoard.set(4, 4, XQ.Piece.create('red', 'pawn'));
const pawnGame = XQ.Engine.create({ startBoard: pawnBoard });
const pawnSystem = await captureSystem({ promptLevel: 'mid' }, 'red', pawnGame);
ok(!pawnGame.isOver() && pawnSystem.includes('兵卒士象残局仍可争胜') && pawnSystem.includes('胜负以引擎结果为准') && !pawnSystem.includes('时直接判和'), '非终局兵卒局面继续择着，不由提示词擅自判和');
console.log(failed ? '_prompt_level_smoke: ' + failed + ' FAIL' : '_prompt_level_smoke: ALL PASS');
process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
