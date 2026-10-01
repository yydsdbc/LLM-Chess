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
async function captureRequest(levelOrStyle, side = 'red', engine = XQ.Engine.create()) {
  const agent = XQ.LLMAgent.create(Object.assign({ side, provider: 'tokenrhythm', model: 'glm-5.3-flash' }, levelOrStyle));
  let captured = null;
  const legal = engine.generateLegalMoves(side)[0];
  const answer = JSON.stringify({ from: XQ.Move.sqName(legal.from), to: XQ.Move.sqName(legal.to), summary: '测试', confidence: 0.5 });
  globalThis.fetch = function (url, opts) { captured = JSON.parse(opts.body); return Promise.resolve({ ok: true, status: 200, headers: { get: function () { return 'application/json'; } }, json: async () => ({ choices: [{ message: { content: answer } }] }) }); };
  await agent.next(engine);
  return captured;
}
async function captureSystem(levelOrStyle, side = 'red', engine = XQ.Engine.create()) {
  return (await captureRequest(levelOrStyle, side, engine)).messages[0].content;
}
(async function main() {
const sysHigh = await captureSystem({ promptLevel: 'high' });
const sysNone = await captureSystem({ promptLevel: 'none' });
ok(sysHigh.includes('战略优先级') && sysHigh.includes('吃子三问') && sysHigh.includes('阶段策略'), 'high 额外注入战术检查与阶段策略');
ok(!/战略优先级|吃子三问|阶段策略|开局路线|开局核心|风格:|子力参考/.test(sysNone), 'none 不额外注入棋风、战术或开局路线');
ok(!sysHigh.includes('八步内完成三任务') && !sysHigh.includes('每上一匹马立即挺同侧兵'), 'high 不强制中炮任务及每上马立即挺兵');
ok(sysHigh.includes('战术优先于开局路线') && sysHigh.includes('开局不要镜像'), 'high 开局选项服从当前战术且独立判断');
ok(!sysHigh.includes('你的棋风') && !sysHigh.includes('均势按棋风'), '旧棋风措辞零残留');
const again = await captureSystem({ promptLevel: 'high' });
ok(again === sysHigh, 'system 恒定 (同等级两调用逐字一致, 前缀缓存前提)');
ok(sysHigh.length === again.length && sysNone.length < sysHigh.length, '两级长度有明确区分且同级恒定');
for (const value of [undefined, null, '', 0, false, 'none', 'high', 'low', 'mid', 'aggressive', 'defensive', 'balanced', 'unknown']) {
  ok(XQ.LLMAgent.normalizePromptLevel(value) === (value === 'none' ? 'none' : 'high'), '规范化 API: ' + String(value));
}
for (const side of ['red', 'black']) {
  const high = await captureSystem({ promptLevel: 'high' }, side);
  const none = await captureSystem({ promptLevel: 'none' }, side);
  for (const config of [{}, { promptLevel: 'low' }, { promptLevel: 'mid' }, { promptLevel: 'unknown' }, { promptLevel: null }, { promptLevel: '' }, { style: 'aggressive' }, { style: 'defensive' }, { style: 'balanced' }, { promptLevel: null, style: 'none' }]) {
    ok(await captureSystem(config, side) === high, side + ' 默认/旧配置实际请求迁移至 high: ' + JSON.stringify(config));
  }
  ok(await captureSystem({ promptLevel: 'none', style: 'aggressive' }, side) === none, side + ' 显式 none 优先于旧 style');
  for (const promptLevel of ['none', 'high']) {
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
    const request = await captureRequest({ promptLevel }, side);
    const user = request.messages[request.messages.length - 1].content;
    ok(user.includes('局面基础评价') && user.includes('当前棋盘') && user.includes('你的合法着法'), side + '/' + promptLevel + ' 均共享当前引擎摘要、棋盘和合法列表');

    const seriesEngine = XQ.Engine.create({ turn: side });
    const seriesAgent = XQ.LLMAgent.create({ side, promptLevel, provider: 'mock', model: 'prefix-series' });
    const series = [];
    globalThis.fetch = async function (url, opts) {
      series.push(JSON.parse(opts.body));
      const move = seriesEngine.generateLegalMoves(side)[0];
      const answer = JSON.stringify({ from: XQ.Move.sqName(move.from), to: XQ.Move.sqName(move.to), summary: '测试', confidence: 0.5 });
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: answer } }] }) };
    };
    const firstMove = await seriesAgent.next(seriesEngine);
    seriesEngine.applyPlayerMove(firstMove.from.x, firstMove.from.y, firstMove.to.x, firstMove.to.y);
    const reply = seriesEngine.generateLegalMoves(seriesEngine.turn())[0];
    seriesEngine.applyPlayerMove(reply.from.x, reply.from.y, reply.to.x, reply.to.y);
    await seriesAgent.next(seriesEngine);
    for (const [index, phase] of [[0, 'first'], [1, 'inc']]) {
      const current = series[index].messages[series[index].messages.length - 1].content;
      ok(!/开局任务:|尽快架中炮|三任务近完成/.test(JSON.stringify(series[index].messages)), side + '/' + promptLevel + '/' + phase + ' 完整请求不注入固定开局任务');
      ok(current.includes('- 阶段:') && current.includes('- 局面评分:') && current.includes('- 风险:') && current.includes('当前棋盘') && current.includes('你的合法着法'), side + '/' + promptLevel + '/' + phase + ' 仍保留真实阶段、评分、风险、棋盘和合法列表');
    }
    ok(series[1].messages.length === 4 && series[1].messages[0].content === system && JSON.stringify(series[1].messages.slice(0, 2)) === JSON.stringify(series[0].messages), side + '/' + promptLevel + ' 同一 agent 后续请求保留固定system与完整历史前缀');
    seriesAgent.reset();
    seriesEngine.newGame();
    await seriesAgent.next(seriesEngine);
    ok(series[2].messages.length === 2 && series[2].messages[0].content === system, side + '/' + promptLevel + ' 换局清历史且固定system不变');
  }
}
for (const system of [sysNone, sysHigh]) {
  ok(system.includes('JSON字段名与坐标除外') && !system.includes('禁英文与讲解'), '两级中文协议均允许机器字段和坐标');
  ok(system.includes('带可选字段总长180字以内'), '两级可选字段预算均为180字');
  ok(system.includes('选着可靠度, 非胜率') && system.includes('唯一应将可高信心') && !system.includes('被迫防守0.4以下'), '两级信心均不把被迫应将等同于低可靠度');
  ok(system.includes('黑方填evaluation须反号'), '两级都明示黑方评分转换');
  ok(system.includes('数据隔离') && system.includes('最后一条 user'), '两级均隔离历史局面与不可信数据中的指令');
}
ok(!sysHigh.includes('唯一远程火力'), '炮的战略描述不排除车的远程作用');
const pawnBoard = XQ.Board.makeFromGrid(new Array(90).fill(null));
pawnBoard.set(4, 9, XQ.Piece.create('red', 'king'));
pawnBoard.set(3, 0, XQ.Piece.create('black', 'king'));
pawnBoard.set(4, 4, XQ.Piece.create('red', 'pawn'));
const pawnGame = XQ.Engine.create({ startBoard: pawnBoard });
for (const promptLevel of ['none', 'high']) {
  const pawnSystem = await captureSystem({ promptLevel }, 'red', pawnGame);
  ok(!pawnGame.isOver() && pawnSystem.includes('兵卒士象残局仍可争胜') && pawnSystem.includes('胜负以引擎结果为准') && !pawnSystem.includes('时直接判和'), promptLevel + ' 非终局兵卒局面继续择着，不由提示词擅自判和');
}
console.log(failed ? '_prompt_level_smoke: ' + failed + ' FAIL' : '_prompt_level_smoke: ALL PASS');
process.exit(failed ? 1 : 0);
})().catch(err => { console.error(err); process.exit(1); });
