/* test/test_llm_convo.js — 无头验证 LLM v1.3 战略决策模块
 * mock fetch, 断言: 固定 system/扩展 JSON/局面基础评价/meta 流转/reset
 * 运行: node test/test_llm_convo.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
for (const f of ['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js',
  'core/generator.js', 'core/judge.js', 'core/engine.js', 'evaluation/xiangqi_knowledge.js', 'evaluation/position.js', 'benchmark/record.js', 'ai/llm_agent.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const XQ = globalThis.XQ;

const calls = [];
function userOf(b) { var m = b.messages; return m[m.length - 1].content; }   // v2.7: 多轮结构下当前 user = 最后一条消息
let n = 0;
const REASONS = ['首发开局,经典中炮控制中路', '延续局面,巩固中路优势'];
globalThis.fetch = async function (url, opts) {
  const body = JSON.parse(opts.body);
  calls.push(body);
  n++;
  const mv = n === 2 ? { from: 'e3', to: 'b3' } : { from: 'b3', to: 'e3' };
  const i = n - 1;
  return {
    ok: true,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => ({
      choices: [{ message: {
        content: JSON.stringify({
          from: mv.from, to: mv.to,
          summary: REASONS[i % REASONS.length],
          evaluation: '+0.5 红方略优',
          confidence: 0.72 + i * 0.05
      }),
      reasoning_content: '决策分析:选' + (n === 1 ? '中炮' : '回位') + '。输出JSON。'
      }}],
      usage: { prompt_tokens: 350, completion_tokens: 80, total_tokens: 430 }
    })
  };
};

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

(async function main() {
  const engine = XQ.Engine.create();
  const agent = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-1' });

  // ── 第 1 手 ──
  const mv1 = await agent.next(engine, null);
  ok(!!mv1 && mv1.from.x === 1 && mv1.to.x === 4, '第1手返回合法着法 b3→e3');
  ok(calls[0].messages.length === 2, '第1手 messages = system+user');
  ok(calls[0].messages[0].content.includes('AI决策模块'), 'system 角色: AI决策模块 (非棋手)');
  ok(calls[0].messages[0].content.includes('战略优先级'), 'system 含战略优先级节');
  ok(calls[0].messages[0].content.includes('中国象棋评价原则'), 'system 含中国象棋评价原则 (v1.4 阶段性知识)');
  ok(calls[0].messages[0].content.includes('必杀'), 'system 含"必杀"优先级');
  ok(calls[0].messages[0].content.includes('禁止深度推演') && !calls[0].messages[0].content.includes('推演未来至少'), 'system v1.5.1 快速决策: 禁止深算 (不再要求推演回合)');
  ok(calls[0].thinking && calls[0].thinking.type === 'enabled' && calls[0].thinking.effort === undefined, '请求体默认 thinking:{type:enabled} (v1.5.2 tokenrhythm 兼容; effort 为 zhipu/o1 预留)');
  ok(calls[0].max_tokens === 4096, '请求体 max_tokens=4096 (v1.5.9: 防长思考+JSON 同计截断)');
  ok(calls[0].messages[0].content.includes('summary') && calls[0].messages[0].content.includes('confidence'), 'system 含输出格式 summary/confidence');
  ok(!/你是一位中国象棋.*高手引擎/.test(calls[0].messages[0].content), 'system 不再含 v1.2 角色扮演短语');
  ok(calls[0].messages[0].content.length <= 2400, 'system 长度 ' + calls[0].messages[0].content.length + ' 在 2400 字以内 (v2.6: 开局三节全程保留换缓存恒定, 上限同步放宽)');
  ok(!/[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮≥≤~→←↑↓⚠]/.test(calls[0].messages[0].content), 'system 无乱码风险特殊符号 (①②③≥≤~→等, 模型复述会吐乱码, v1.8 守护)');
  ok(userOf(calls[0]).includes('局面基础评价'), 'user 含"局面基础评价"块');
  ok(userOf(calls[0]).includes('阶段: ') && userOf(calls[0]).includes('局面评分'), 'user 含阶段/局面评分 (专家摘要 v1.4)');
  ok(userOf(calls[0]).includes('优势: ') && userOf(calls[0]).includes('风险: '), 'user 注入优势/风险 (动态子力评价转为摘要, v1.4)');
  ok(userOf(calls[0]).includes('合法着法数'), 'user 注入合法着法数');
  ok(mv1.meta && typeof mv1.meta.summary === 'string' && mv1.meta.summary.length > 0, 'mv1.meta.summary 来自 JSON');
  ok(typeof mv1.meta.confidence === 'number' && mv1.meta.confidence >= 0 && mv1.meta.confidence <= 1, 'mv1.meta.confidence 在 0~1');

  // 应用 红→黑
  const p1 = XQ.Move.parseSq('b3'), t1 = XQ.Move.parseSq('e3');
  engine.applyPlayerMove(p1.x, p1.y, t1.x, t1.y);
  const p2 = XQ.Move.parseSq('h8'), t2 = XQ.Move.parseSq('e8');
  engine.applyPlayerMove(p2.x, p2.y, t2.x, t2.y);

  // ── 第 2 手 ──
  const mv2 = await agent.next(engine, null);
  ok(!!mv2, '第2手返回合法着法');
  ok(calls[1].messages[0].content === calls[0].messages[0].content, 'system 固定: 第2手与第1手 system 完全相同');
  ok(userOf(calls[1]).includes('延续对局'), 'user 含"延续对局"');
  ok(userOf(calls[1]).includes('对手上一手'), 'user 含对手上一手 (上一回合块)');
  ok(userOf(calls[1]).includes('你上一手') && userOf(calls[1]).includes(REASONS[0]), 'user 携带你上一手摘要');
  ok(userOf(calls[1]).includes('局面基础评价'), 'user 仍含局面基础评价 (引擎注入)');
  ok(mv2.meta && mv2.meta.evaluation && mv2.meta.evaluation.includes('+0.5'), 'mv2.meta.evaluation 流转');

  // ── Record 写入 meta ──
  const rec = XQ.Record.blank({ redName: 'L', redKind: 'llm' });
  XQ.Record.addMove(rec, engine, { from: mv1.from, to: mv1.to, piece: { color: 'red', type: 'cannon', id: 1 } }, 1000, mv1.meta);
  ok(rec.moves[0].summary === REASONS[0] && rec.moves[0].confidence >= 0.7, '棋谱 addMove 存储 summary/confidence (Benchmark 可读)');

  // ── usage 累计 ──
  const u = agent.usage();
  ok(u.requests === 2 && u.total === 860, 'usage 累计正确 (2 次 / 860 tok)');

  // ── reset: 新对局恢复首手 (虽然 system 永远固定, 但确认 reset 不污染 convo) ──
  agent.reset();
  const e2 = XQ.Engine.create();
  await agent.next(e2, null);
  ok(!userOf(calls[2]).includes('延续对局'), 'reset 后第1手 user 为"对局开始"块 (无延续)');
  ok(calls[2].messages[0].content === calls[0].messages[0].content, 'reset 后 system 仍与第1手完全相同');

  // ── v2.4 对手上一手吃子标注: 黑炮 e8-e5 借黑卒 e7 作架吃红兵 → 红 user 消息点名 吃掉你的兵 ──
  {
    const eC = XQ.Engine.create();
    const agentCap = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-cap' });
    let seqCap = 0;
    globalThis.fetch = async function (url, opts) {
      const body = JSON.parse(opts.body);
      calls.push(body);
      const picks = [
        { from: 'b3', to: 'e3', summary: '中炮' },
        { from: 'e4', to: 'e5', summary: '挺兵' },
        { from: 'd1', to: 'e2', summary: '上仕应将' }
      ];
      const p = picks[Math.min(seqCap++, picks.length - 1)];
      return {
        ok: true,
        headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => ({
          choices: [{ message: { content: JSON.stringify({ from: p.from, to: p.to, summary: p.summary, confidence: 0.6 }) } }],
          usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 }
        })
      };
    };
    const mvA = await agentCap.next(eC, null);   // 红 炮b3-e3 中炮
    ok(!!mvA, '吃子场景第1手成功');
    eC.applyPlayerMove(mvA.from.x, mvA.from.y, mvA.to.x, mvA.to.y);
    const c1 = XQ.Move.parseSq('h8'), c2 = XQ.Move.parseSq('e8');
    eC.applyPlayerMove(c1.x, c1.y, c2.x, c2.y);   // 黑 炮h8-e8 (无吃, 顺带验证零噪音)
    const mvB = await agentCap.next(eC, null);   // 红 兵e4-e5
    ok(!!mvB, '吃子场景第2手成功');
    eC.applyPlayerMove(mvB.from.x, mvB.from.y, mvB.to.x, mvB.to.y);
    const c3 = XQ.Move.parseSq('e8'), c4 = XQ.Move.parseSq('e5');
    const cap = eC.applyPlayerMove(c3.x, c3.y, c4.x, c4.y);   // 黑 炮e8-e5: 炮架=黑卒e7, 吃红兵
    ok(cap.ok && cap.move.captured && cap.move.captured.type === 'pawn', '场景预置: 黑炮 e8-e5 吃掉红兵');
    const baseCap = calls.length;
    ok(!userOf(calls[baseCap - 1]).includes('吃掉你的'), '黑方上一手无吃子时 user 不标注 (零噪音)');
    const mvC = await agentCap.next(eC, null);   // 第3手 (黑吃兵后带将军, mock 上仕应将)
    ok(!!mvC, '吃子场景第3手成功');
    ok(userOf(calls[baseCap]).includes('吃掉你的兵'), 'user 对手上一手标注 吃掉你的兵 (v2.4)');
  }

  // ── 非法着法重试路径 (引擎拒绝 → 重试 user 携带原因) ──
  const engine3 = XQ.Engine.create();
  const agentR = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-2' });
  const base = calls.length;
  globalThis.fetch = async function (url, opts) {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const first = calls.length - base === 1;
    // 第1次: 合法格式但非法走法 (车 a1→a5 被自家兵阻挡); 之後: 合法中炮
    const isBlack = /执黑方/.test(body.messages[0].content) || /执黑方/.test(userOf(body));
    const mv = first ? { from: 'a1', to: 'a5' } : (isBlack ? { from: 'b8', to: 'e8' } : { from: 'b3', to: 'e3' });
    const content = JSON.stringify({ from: mv.from, to: mv.to, summary: '测试决策', evaluation: '+0.2', confidence: 0.8 });
    return {
      ok: true,
      headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
    };
  };
  const mvR = await agentR.next(engine3, null);
  ok(mvR.from.x === 1 && mvR.to.x === 4, '非法后重试返回合法着法 b3→e3');
  ok(calls.length - base === 2, '一次拒绝共 2 次调用 (非法→重试)');
  const retryUser = userOf(calls[base + 1]);
  ok(retryUser.includes('你刚才的输出无效'), '重试 user 含"输出无效"警告块');
  ok(retryUser.includes('不在合法列表'), '重试 user 携带具体失败原因');
  ok(retryUser.includes('坐标颠倒'), '重试 user 含被拒归因指南 (v1.5.11: 坐标颠倒/送将等)');

  // ── 黑方视角 prompt ──
  const agentB = XQ.LLMAgent.create({ side: 'black', provider: 'mock', model: 'mock-3' });
  const mvB = await agentB.next(XQ.Engine.create(), null);
  const sysB = calls[calls.length - 1].messages[0].content;
  ok(sysB.includes('黑方(将方)'), '黑方 agent system 标示执黑');
  ok(mvB.from.x === 1 && mvB.to.x === 4, '黑方返回合法着法 b8→e8');

  // ── v1.5.7 提示词优化: 方向感/分边示例/候选坐标制/防拉锯/近几手 ──
  const sysR = calls[0].messages[0].content;
  ok(sysR.includes('方向感') && sysR.includes('红方在下方') && sysR.includes('进=行号增大'), 'system 含方向感节 (红在下方/进=行号增大)');
  ok(sysR.includes('"from":"h3","to":"e3"') && sysR.includes('"move":"h3-e3"'), '红方示例用红方坐标 h3-e3');
  ok(sysB.includes('"from":"h8","to":"e8"') && sysB.includes('"move":"h8-e8"'), '黑方示例用黑方坐标 h8-e8 (防照抄对方示例)');
  ok(!sysR.includes('炮二平五(h3-e3)'), '候选示例已改坐标制 (无中文记谱转换负担)');
  ok(sysR.includes('score 为你方视角') && sysR.includes('-3到+3'), 'score 口径已定义 (你方视角 -3到+3, v1.5.11c 符号清扫)');
  ok(sysR.includes('禁长将长捉'), '战略优先级含禁长将长捉/勿重复对拉');
  ok(sysR.includes('禁止 ``` 围栏'), '输出格式禁 markdown 围栏');
  ok(userOf(calls[1]).includes('近几手(全局)'), '增量 user 注入近几手全局序列 (防重复对拉)');

  // ── v1.5.8 落子提速: 思考纪律/战术快通道/必填对齐/动态开局节 ──
  ok(sysR.includes('思考纪律') && sysR.includes('最多 3 短句'), 'system 含思考纪律节 (思考≤3短句)');
  ok(sysR.includes('第一直觉即最终答案'), '战术快通道: 必杀/将军/白吃 第一直觉即答案');
  ok(sysR.includes('吃子三问') && sysR.includes('过河兵卒'), '战略含吃子三问安全检查 + 残局兵卒进攻 (v1.5.11)');
  ok(sysR.includes('总长90字以内') && sysR.includes('summary/confidence 必填'), '输出预算收紧 (90字以内) 且必填字段与严格校验对齐');

  // ── v3.9b 提示词定向优化守护 (用户指令: 提示词 10 项) ──
  const sysP = calls[0].messages[0].content;
  ok(sysP.includes('照面违规被拒'), 'system 含照面规则 (v3.9b: 引擎拒照面, 提示词预防烧重试)');
  ok(sysP.includes('一律红方视角'), 'system evaluation 红方视角口径统一 (v3.9b: 黑方不再歧义)');
  ok(sysP.includes('车换马炮亏'), 'system 含兑子速算 (v3.9b)');
  ok(sysP.includes('过河兵价值翻倍'), 'system 含过河兵价值 (v3.9b)');
  ok(!sysP.includes('解将除外'), 'system 防拉锯不再暗示连将豁免 (v3.9b, 与长将判负矛盾消解)');
  ok(sysP.includes('沿线直射'), 'system 露将具体化 (v3.9b)');
  {
    const agentMD = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-missfield' });
    const baseMD = calls.length;
    let mdN = 0;
    globalThis.fetch = async function (url, opts) {
      mdN++;
      calls.push({ messages: JSON.parse(opts.body).messages });
      const content = mdN === 1 ? '{"from":"b3","to":"e3","confidence":0.8}' : '{"from":"b3","to":"e3","summary":"架中炮","confidence":0.8}';
      return { ok: true, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    const mvMD = await agentMD.next(XQ.Engine.create(), null);
    const userMD = userOf(calls[baseMD + 1]);
    ok(userMD.includes('14字以内') && !userMD.includes('30字'), 'summary 字数口径统一为 14字 (v3.9b, 原 30/14 不一致)');
    ok(userMD.includes('全角字符一律半角'), 'retry 含全角字符提醒 (v3.9b)');
    ok(mvMD && mvMD.meta && mvMD.meta.attempts === 2, '缺字段场景重试成功 (v3.9b)');
  }
  ok(sysR.includes('开局路线'), '首手 system 含开局三节');
  ok(sysR.includes('标注图例') && sysR.includes('危=走后被白吃') && sysR.includes('亏=此吃子交换净亏'), 'system 含合法列表标注图例 (v3.3)');
  {
    // v2.6 连走 6 手: system 应逐字恒定 (缓存优先), 开局三节保留但自带忽略标记
    const engineM = XQ.Engine.create();
    const agentM = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-8' });
    const seq = [['b3', 'e3'], ['b1', 'c3'], ['h1', 'g3'], ['a1', 'a3'], ['i1', 'i3'], ['e4', 'e5']];
    const baseM = calls.length;
    globalThis.fetch = async function (url, opts) {
      const body = JSON.parse(opts.body);
      calls.push(body);
      const i = calls.length - baseM - 1;
      const mv = seq[i] || seq[seq.length - 1];
      const content = JSON.stringify({ from: mv[0], to: mv[1], summary: '推进出子', confidence: 0.7 });
      return {
        ok: true,
        headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
      };
    };
    for (let k = 0; k < 6; k++) await agentM.next(engineM, null);
    const sysMid = calls[calls.length - 1].messages[0].content;
    ok(sysMid === calls[baseM].messages[0].content, 'system 全程恒定: 第6手与第1手逐字相同 (v2.6 缓存优先, 动态裁剪取消)');
    ok(sysMid.includes('开局路线') && sysMid.includes('中残局忽略本节'), '开局三节全程保留且自带中残局忽略自限标记');
    ok(sysMid.includes('方向感') && sysMid.includes('思考纪律') && sysMid.includes('输出格式'), '中残局仍保留方向感/思考纪律/输出格式');
  }

  // ── 非 JSON 输出: 前 2 次严格拒绝重试, 第 3 次 JSON 到位 ──
  const engine4 = XQ.Engine.create();
  const agentN = XQ.LLMAgent.create({ side: 'black', provider: 'mock', model: 'mock-4' });
  const base2 = calls.length;
  globalThis.fetch = async function (url, opts) {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const k = calls.length - base2;   // 1,2 = 无 JSON 纯文本; 3 = 合规 JSON
    const content = k < 3
      ? '经过分析,黑方最好走炮8平5: b8>e8 控制中路,随后马8进7巩固阵型'
      : JSON.stringify({ from: 'b8', to: 'e8', summary: '中炮对抗', evaluation: '0.0 均势', confidence: 0.7 });
    return {
      ok: true,
      headers: { get: (k2) => (k2.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })
    };
  };
  const mvN = await agentN.next(engine4, null);
  ok(calls.length - base2 === 3, '非 JSON 输出被拒 2 次, 第 3 次成功 (共 3 次调用)');
  ok(mvN.meta && mvN.meta.summary === '中炮对抗', '最终 JSON 解析带完整 meta');
  const rj = userOf(calls[base2 + 1]);
  ok(rj.includes('你刚才的输出无效'), '非 JSON 重试 user 含警告块');
  ok(rj.includes('若刚才思考是英文或被截断'), '解析失败重试追加中文思考/直接给 JSON 提示 (v1.5.9)');

  // ── v1.5 嵌套 JSON 提取: candidates:[{...}] 嵌套对象不被截断, 一次成功 ──
  const agentJ = XQ.LLMAgent.create({ side: 'black', provider: 'mock', model: 'mock-nest' });
  const baseJ = calls.length;
  globalThis.fetch = async function (url, opts) {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const content = '决策如下: {"from":"b8","to":"e8","plan":"中炮控中路","summary":"架中炮威胁中卒","candidates":[{"move":"炮8平5","score":"+0.3"},{"move":"马8进7","score":"+0.1"}],"evaluation":"0.0 均势","confidence":0.8} 以上';
    return {
      ok: true,
      headers: { get: (k2) => (k2.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => ({ choices: [{ message: { content } }], usage: {} })
    };
  };
  const mvJ = await agentJ.next(XQ.Engine.create(), null);
  ok(calls.length - baseJ === 1, '嵌套 JSON 一次提取成功 (无需重试)');
  ok(mvJ.meta && mvJ.meta.summary === '架中炮威胁中卒' && mvJ.meta.confidence === 0.8 && mvJ.meta.plan === '中炮控中路', '嵌套 JSON meta 完整 (summary/confidence/plan)');
  ok(mvJ.meta.candidates.length === 2 && mvJ.meta.candidates[0].move === '炮8平5', '嵌套 candidates 解析无损');

  // ── v1.5 严格模式字段校验: JSON 可解析但缺 summary/confidence → 视同格式失败重试 ──
  const agentF = XQ.LLMAgent.create({ side: 'black', provider: 'mock', model: 'mock-field' });
  const baseF = calls.length;
  globalThis.fetch = async function (url, opts) {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const k = calls.length - baseF;   // 1 = 缺字段 JSON; 2 = 完整 JSON
    const content = k < 2
      ? '{"from":"b8","to":"e8","confidence":0.5}'
      : JSON.stringify({ from: 'b8', to: 'e8', plan: '中炮', summary: '架中炮', evaluation: '均势', confidence: 0.6 });
    return {
      ok: true,
      headers: { get: (k2) => (k2.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => ({ choices: [{ message: { content } }], usage: {} })
    };
  };
  const mvF = await agentF.next(XQ.Engine.create(), null);
  ok(calls.length - baseF === 2, '缺必填字段的 JSON 被拒, 第 2 次重试成功 (共 2 次调用)');
  ok(mvF.meta && mvF.meta.summary === '架中炮' && mvF.meta.confidence === 0.6, '字段补全后 meta 完整');
  ok(userOf(calls[baseF + 1]).includes('缺少必填字段'), '缺字段重试 user 含字段提醒');

  // ── 兑底扫描: 多坐标对时只选合法那个 (防误选已否决候选) ──
  const agentS = XQ.LLMAgent.create({ side: 'black', provider: 'mock', model: 'mock-scan' });
  const base3 = calls.length;
  globalThis.fetch = async function (url, opts) {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const k = calls.length - base3;   // 1,2 非 JSON 被拒; 3 兑底(带合法过滤)
    const content = k < 3
      ? '思考: 先看 h3-e3 但那是红炮的着法, 不合法, 改走 h8-e8 中炮最好'
      : '候选: h3-e3 否决(红炮着法); 稳妥选 h8-e8 中炮对抗';
    return {
      ok: true,
      headers: { get: (k2) => (k2.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => ({ choices: [{ message: { content } }], usage: {} })
    };
  };
  const mvS = await agentS.next(XQ.Engine.create(), null);
  ok(calls.length - base3 === 3, '兑底发生在第 3 次尝试');
  ok(mvS.from.x === 7 && mvS.to.x === 4, '兑底跳过非法 h3-e3, 选中合法 h8-e8 (而非盲取第一个)');
  ok(mvS.meta && mvS.meta.summary === '', '兑底路径 meta 为空(可接受)');

  // ── 兑底 pts 路径: 无分隔符 "from h8 to e8" + a10 行号10不截断 ──
  const agentP = XQ.LLMAgent.create({ side: 'black', provider: 'mock', model: 'mock-pts' });
  const base4 = calls.length;
  globalThis.fetch = async function (url, opts) {
    const body = JSON.parse(opts.body);
    calls.push(body);
    const content = '我认为 from e10 to e5 慢了(将不能远跳), 应该 from h8 to e8';
    return {
      ok: true,
      headers: { get: (k2) => (k2.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => ({ choices: [{ message: { content } }], usage: {} })
    };
  };
  const mvP = await agentP.next(XQ.Engine.create(), null);
  ok(mvP.from.x === 7 && mvP.to.x === 4, 'pts 兑底解析 "from h8 to e8" 并选中合法对');

  // ── v1.5.3: reasoning 中英文混杂时上推面板需只含中文片段 (extractCN) ──
  const reasoning_seen = [];
  const agentC = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-cnfilter',
    onThinking: function (sd, text) { reasoning_seen.push(text); } });
  const baseR = calls.length;
  globalThis.fetch = async function (url, opts) {
    const body = JSON.parse(opts.body);
    calls.push(body);
    return { ok: true, headers: { get: (k2) => (k2.toLowerCase() === 'content-type' ? 'application/json' : null) },
      json: async () => ({ choices: [{ message: {
        content: JSON.stringify({ from: 'b3', to: 'e3', plan: '架炮', summary: '控制中路', evaluation: '均势', confidence: 0.7 }),
        reasoning_content: 'Step 1: evaluate position. 马八进七 护中。炮二平五 控制中线。 Output JSON now.'
      } }], usage: {} }) };
  };
  const mvCN = await agentC.next(XQ.Engine.create(), null);
  ok(mvCN.from.x === 1 && mvCN.to.x === 4, 'CN filter mock 返回合法着法');
  ok(reasoning_seen.length >= 1, 'onThinking 被调用 (reasoning 流上推)');
  const lastReason = reasoning_seen[reasoning_seen.length - 1] || '';
  ok(/[\u4e00-\u9fff]/.test(lastReason), '面板收到文字含中文 (extractCN 保留中文)');
  ok(!/[A-Za-z]{5,}/.test(lastReason), '面板不出现连续 5+ 英文字符 (extractCN 已滤英文)');

  // ── v1.5.9: 永久性错误 (401 鉴权) 不烧重试, 立即失败 ──
  {
    const engine401 = XQ.Engine.create();
    const agent401 = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-401' });
    const base401 = calls.length;
    globalThis.fetch = async function (url, opts) {
      calls.push(JSON.parse(opts.body));
      return {
        ok: false, status: 401,
        headers: { get: () => 'application/json' },
        json: async () => ({ error: { message: 'Authentication Fails (no such user)' } })
      };
    };
    let threw401 = null;
    try { await agent401.next(engine401, null); } catch (e) { threw401 = e; }
    ok(threw401 && /HTTP 401/.test(threw401.message) && /Authentication/.test(threw401.message), '401 错误信息含状态码与上游详情 (不再 [object Object])');
    ok(calls.length - base401 === 1, '401 只调用 1 次, 不烧重试 (立即暴露未配 key)');
  }

  // ── v1.7.7 对拉代码级警示: 同子来回 (A-B-A) 后, 下一手 user 带禁止走回警告 ──
  {
    const enginePP = XQ.Engine.create();
    const agentPR = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-pong-r' });
    const agentPB = XQ.LLMAgent.create({ side: 'black', provider: 'mock', model: 'mock-pong-b' });
    const basePP = calls.length;
    const seqPP = {
      red: [['b1', 'c3'], ['c3', 'b1'], ['b3', 'e3']],
      black: [['b10', 'c8'], ['c8', 'b10']]
    };
    const counters = { red: 0, black: 0 };
    globalThis.fetch = async function (url, opts) {
      const body = JSON.parse(opts.body);
      calls.push(body);
      const isBlack = /执黑方/.test(body.messages[0].content);
      const sd = isBlack ? 'black' : 'red';
      const mv = seqPP[sd][counters[sd]] || seqPP[sd][seqPP[sd].length - 1];
      counters[sd]++;
      const content = JSON.stringify({ from: mv[0], to: mv[1], summary: '调整站位', confidence: 0.7 });
      return { ok: true, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    // 前 4 手: 红马 b1-c3 / 黑马 b10-c8 / 红马 c3-b1 / 黑马 c8-b10 (双方同子来回)
    for (let k = 0; k < 4; k++) {
      const ag = enginePP.turn() === 'red' ? agentPR : agentPB;
      const m = await ag.next(enginePP, null);
      const r = enginePP.applyPlayerMove(m.from.x, m.from.y, m.to.x, m.to.y);
      if (!r.ok) throw new Error('对拉测试预置走法被拒: ' + r.reason);
    }
    // 第 5 手请求 (红): 红方历史 = b1-c3 后 c3-b1 → 应带反拉锯警告
    const m5 = await agentPR.next(enginePP, null);
    ok(m5.from.x === 1 && m5.to.x === 4, '对拉场景第5手返回合法着法 b3-e3');
    const userP5 = userOf(calls[calls.length - 1]);
    ok(userP5.includes('来回走') && userP5.includes('严禁再走回去'), '对拉警示注入: 同子来回后 user 带禁止走回警告 (v1.7.7)');
    // 反向验证: 第3手请求 (红方仅1手历史) 不应带警告
    const userP3 = userOf(calls[basePP + 2]);
    ok(!userP3.includes('严禁再走回去'), '对拉警示仅在同子来回时注入 (正常对局零噪音)');
    ok(!userP3.includes('涉嫌长将'), '长将警告仅在连续将军时注入 (正常对局零噪音, v1.7.8)');
  }

  // ── v2.2 重复局面 user 警示: 引擎三次重复判和闭环后, 局面第2次出现 → user 带自动判和警告 ──
  {
    // 零噪音: 全新局面 (repN=0) 不带警告
    const engineA = XQ.Engine.create();
    const agentA = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-rep-clean' });
    const baseA = calls.length;
    globalThis.fetch = async function (url, opts) {
      const body = JSON.parse(opts.body);
      calls.push(body);
      const content = JSON.stringify({ from: 'b1', to: 'c3', summary: '出正马', confidence: 0.7 });
      return { ok: true, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    await agentA.next(engineA, null);
    const userClean = userOf(calls[calls.length - 1]);
    ok(!userClean.includes('第 3 次将自动判和'), '重复局面警示仅在 repN>=2 时注入 (全新局面零噪音, v2.2)');
    // 警示注入: 预置 8 手 (开局局面已第2次出现) → 下一手 user 带判和警告
    const engineRP = XQ.Engine.create();
    const seqRP = [[1,9,2,7],[1,0,2,2],[2,7,1,9],[2,2,1,0],[1,9,2,7],[1,0,2,2],[2,7,1,9],[2,2,1,0]];
    for (const mv of seqRP) {
      const r = engineRP.applyPlayerMove(mv[0], mv[1], mv[2], mv[3]);
      if (!r.ok) throw new Error('重复局面测试预置走法被拒: ' + r.reason);
    }
    if (engineRP.repetitionCount() !== 2) throw new Error('预置后重复计数应为2, 实际 ' + engineRP.repetitionCount());
    const agentRP = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-rep-warn' });
    await agentRP.next(engineRP, null);
    const userRP = userOf(calls[calls.length - 1]);
    ok(userRP.includes('已出现 2 次') && userRP.includes('自动判和'), '重复局面警示: 第2次出现后 user 带"第3次自动判和"警告 (v2.2)');
    ok(calls.length - baseA === 2, '重复局面警示测试共 2 次请求 (守卫不拦 b1-c3, 无额外重试)');
  }

  // ── v1.7.8 合法列表标注: 纯着法无标记, 吃子手附 吃X ──
  {
    const engineA = XQ.Engine.create();
    const agentAR = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-annot-r' });
    const agentAB = XQ.LLMAgent.create({ side: 'black', provider: 'mock', model: 'mock-annot-b' });
    const baseA = calls.length;
    let redReq = 0;
    globalThis.fetch = async function (url, opts) {
      const body = JSON.parse(opts.body);
      calls.push(body);
      const isBlack = /执黑方/.test(body.messages[0].content);
      const mv = isBlack ? ['e7', 'e6'] : (redReq++ === 0 ? ['e4', 'e5'] : ['e5', 'e6']);
      const content = JSON.stringify({ from: mv[0], to: mv[1], summary: '推进中兵', confidence: 0.7 });
      return { ok: true, headers: { get: (kk) => (kk.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    const mA1 = await agentAR.next(engineA, null);
    const uA1 = userOf(calls[baseA]);
    ok(uA1.includes('[b3>e3]') && uA1.includes('[e4>e5]'), '合法列表标注: 纯着法无标记 ([b3>e3] / [e4>e5])');
    engineA.applyPlayerMove(mA1.from.x, mA1.from.y, mA1.to.x, mA1.to.y);   // 红兵 e4-e5
    const mB1 = await agentAB.next(engineA, null);
    engineA.applyPlayerMove(mB1.from.x, mB1.from.y, mB1.to.x, mB1.to.y);   // 黑卒 e7-e6
    const mA2 = await agentAR.next(engineA, null);   // 红第2手: 兵吃卒 e5>e6 在合法列表
    const uA2 = userOf(calls[calls.length - 1]);
    ok(uA2.includes('[e5>e6吃卒]'), '合法列表标注吃子: 兵吃卒显示 [e5>e6吃卒] (无需扫盘)');
    ok(mA2.from.x === 4 && mA2.to.x === 4 && engineA.pieceAt(4, 4), '标注场景红方返回吃卒着法 e5-e6');
    ok(uA2.indexOf('[e5>e6吃卒]') < uA2.indexOf('[b3>e3]'), '合法列表排序: 吃子着法排在普通着法前 (v3.7 首因偏置)');
  }

  // ── v1.7.8 长将自查: 己方连续将军≥3 → user 注入长将警告 (Proxy 模拟引擎计数) ──
  {
    const engineW = new Proxy(XQ.Engine.create(), {
      get: function (t, k) {
        if (k === 'checkStreak') return function () { return 3; };
        const v = t[k];
        return typeof v === 'function' ? v.bind(t) : v;
      }
    });
    const agentW = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-chk' });
    const baseW = calls.length;
    globalThis.fetch = async function (url, opts) {
      const body = JSON.parse(opts.body);
      calls.push(body);
      const content = JSON.stringify({ from: 'b3', to: 'e3', summary: '架中炮', confidence: 0.7 });
      return { ok: true, headers: { get: (kk) => (kk.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    await agentW.next(engineW, null);   // 首手 (firstUserMsg, 无长将警告)
    await agentW.next(engineW, null);   // 第2手 → incUserMsg → 注入
    const uW = userOf(calls[baseW + 1]);
    ok(uW.includes('连续将军 3') && uW.includes('长将'), '长将自查: 连续将军3手后 user 注入长将警告 (v1.7.8)');
    ok(!userOf(calls[baseW]).includes('涉嫌长将'), '长将警告不注入首手 (firstUserMsg 无此节)');
  }

  // ── v1.8a/b 解析健壮性: 全角字符容错 + confidence 百分制归一 ──
  {
    const agentFW = XQ.LLMAgent.create({ side: 'black', provider: 'mock', model: 'mock-fullwidth' });
    const baseFW = calls.length;
    globalThis.fetch = async function (url, opts) {
      const body = JSON.parse(opts.body);
      calls.push(body);
      // 全角坐标 + 百分制 confidence (中文模型偶发输出形态: 原样 JSON 可解析但坐标不合法)
      const content = '{"from":"ｈ８","to":"ｅ８","plan":"中炮","summary":"架中炮对抗","confidence":78}';
      return { ok: true, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    const mvFW = await agentFW.next(XQ.Engine.create(), null);
    ok(calls.length - baseFW === 1, '全角坐标一次解析成功 (无需重试, v1.8a)');
    ok(mvFW && mvFW.from.x === 7 && mvFW.to.x === 4, '全角 ｈ８→ｅ８ 归一为 h8-e8 合法着法');
    ok(mvFW.meta && mvFW.meta.summary === '架中炮对抗' && mvFW.meta.plan === '中炮', '全角路径 meta 完整保留 (summary/plan)');
    ok(mvFW.meta && mvFW.meta.confidence === 0.78, 'confidence 78 百分制归一为 0.78 (v1.8b)');
  }
  {
    // 全角结构字符 (引号/冒号/逗号全角) → 整体 JSON 不可解析 → 归一化救回
    const agentFQ = XQ.LLMAgent.create({ side: 'black', provider: 'mock', model: 'mock-fw-struct' });
    globalThis.fetch = async function (url, opts) {
      const body = JSON.parse(opts.body);
      calls.push(body);
      const content = '{“from”:“h8”,“to”:“e8”,“summary”:“架中炮”,“confidence”:0.7}';
      return { ok: true, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    const mvFQ = await agentFQ.next(XQ.Engine.create(), null);
    ok(mvFQ && mvFQ.from.x === 7 && mvFQ.to.x === 4 && mvFQ.meta && mvFQ.meta.summary === '架中炮', '全角引号冒号逗号 JSON 结构救回 (v1.8a)');
  }

  // ── v3.9a 解析健壮性补强: 文案保原文 / confidenceRaw / 裸键容错 / attempts 计数 / 外部中断 ──
  {
    // 全角坐标 + 摘要含全角标点: 救回只归一化结构/坐标, 摘要保持模型原文 (v1.8a 遗留修)
    const agentTX = XQ.LLMAgent.create({ side: 'black', provider: 'mock', model: 'mock-fw-text' });
    globalThis.fetch = async function (url, opts) {
      const content = '{"from":"ｈ８","to":"ｅ８","summary":"架中炮，稳步推进","confidence":78}';
      return { ok: true, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    const mvTX = await agentTX.next(XQ.Engine.create(), null);
    ok(mvTX && mvTX.from.x === 7 && mvTX.to.x === 4, '全角坐标救回仍命中 (v3.9a)');
    ok(mvTX && mvTX.meta && mvTX.meta.summary === '架中炮，稳步推进', '救回场景摘要保持原文全角标点 (v3.9a, 原会被整段转半角)');
    ok(mvTX && mvTX.meta && mvTX.meta.confidence === 0.78 && mvTX.meta.confidenceRaw === 78, 'confidenceRaw=78 保留原始值 (1至1.5区间歧义可观测)');
  }
  {
    // 无引号键 JSON (LLM 偶发 {from: "h8"} 裸键) → 一次解析免重试
    const agentBK = XQ.LLMAgent.create({ side: 'black', provider: 'mock', model: 'mock-barekey' });
    let bkCalls = 0;
    globalThis.fetch = async function (url, opts) {
      bkCalls++;
      const content = '{from: "h8", to: "e8", summary: "架中炮", confidence: 0.7}';
      return { ok: true, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    const mvBK = await agentBK.next(XQ.Engine.create(), null);
    ok(bkCalls === 1 && mvBK && mvBK.from.x === 7 && mvBK.to.x === 4, '无引号键 JSON 一次解析成功免重试 (v3.9a)');
    ok(mvBK && mvBK.meta && mvBK.meta.summary === '架中炮' && mvBK.meta.attempts === 1, '裸键路径 meta 完整且 attempts=1 (v3.9a)');
  }
  {
    // attempts 计数: 首发炮吃马被开局保护拦截 → 第 2 次成功; meta.attempts 与 usage.attempts 同步
    const agentAT = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-attempts' });
    let atn = 0;
    globalThis.fetch = async function (url, opts) {
      atn++;
      const mv = atn === 1 ? { from: 'b3', to: 'b10' } : { from: 'b3', to: 'e3' };
      const content = JSON.stringify({ from: mv.from, to: mv.to, summary: '吃子', evaluation: '+4.5', confidence: 0.9 });
      return { ok: true, headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    const mvAT = await agentAT.next(XQ.Engine.create(), null);
    ok(mvAT && mvAT.meta && mvAT.meta.attempts === 2, 'meta.attempts=2 记录重试后成功 (v3.9a)');
    ok(agentAT.usage().attempts === 2, 'usage.attempts 累计 LLM 调用次数 (v3.9a)');
  }
  {
    // 外部中断: signal 已中止 → 立即拒绝且零调用 (v3.9a)
    const acPre = new AbortController();
    acPre.abort();
    const agentPA = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-preabort', signal: acPre.signal });
    let paErr = null;
    try { await agentPA.next(XQ.Engine.create(), null); } catch (e) { paErr = e; }
    ok(paErr && /外部中止/.test(paErr.message), 'signal 已中止 → 立即拒绝并明确归因 (v3.9a)');
  }
  {
    // 外部中断: 对局进行中止 → 拒绝不烧重试, 不误报为超时 (v3.9a)
    const acMid = new AbortController();
    const agentMA = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-midabort', signal: acMid.signal });
    globalThis.fetch = function (url, opts) {
      return new Promise(function (resolve, reject) {
        if (opts.signal) opts.signal.addEventListener('abort', function () {
          const er = new Error('The operation was aborted');
          er.name = 'AbortError';
          reject(er);
        });
      });
    };
    const pMA = agentMA.next(XQ.Engine.create(), null).then(function () { return null; }, function (e) { return e; });
    setTimeout(function () { try { acMid.abort(); } catch (eT) {} }, 25);
    const maErr = await pMA;
    ok(maErr && /外部中止/.test(maErr.message), '中途外部中止 → 拒绝并归因外部中止 (不误报超时, v3.9a)');
    ok(agentMA.usage().attempts === 1, '外部中止不烧重试 (attempts 停在 1, v3.9a)');
  }

  // ── 开局硬保护回归: 炮吃马被代码拦截 (v2.3 修复: 引擎类型是 knight/bishop, 原 horse/elephant 永不命中 → 拦截失效) ──
  {
    const engineG = XQ.Engine.create();
    const agentG = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-cannon-guard' });
    const baseG = calls.length;
    globalThis.fetch = async function (url, opts) {
      const body = JSON.parse(opts.body);
      calls.push(body);
      const k = calls.length - baseG;   // 1 = 炮打马 b3-b10 (被拦); 2 = 中炮
      const mv = k === 1 ? { from: 'b3', to: 'b10' } : { from: 'b3', to: 'e3' };
      const content = JSON.stringify({ from: mv.from, to: mv.to, summary: '吃子', evaluation: '+4.5', confidence: 0.9 });
      return { ok: true, headers: { get: (k2) => (k2.toLowerCase() === 'content-type' ? 'application/json' : null) },
        json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    const mvG = await agentG.next(engineG, null);
    ok(calls.length - baseG === 2, '开局炮吃马被拦截重选, 共 2 次调用 (修复前拦截失效仅 1 次)');
    const rg = userOf(calls[baseG + 1]);
    ok(rg.includes('开局保护') && rg.includes('前2回合'), '重试 user 含开局保护原因, 回合数口径同步 (前2回合)');
    ok(mvG.from.x === 1 && mvG.to.x === 4, '拦截后改选中炮 b3-e3');
  }

  {
    // v2.5 onRetry 钩子: 重试实时可见 (HUD 观战) — 第1次纯散文失败 → 钩子收到 attempt=1, 第2次成功
    const retryCalls = [];
    let nR2 = 0;
    globalThis.fetch = async function (url, opts) {
      nR2++;
      if (nR2 === 1) return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: 'Let me analyze the position. Red pieces are standard setup.' } }], usage: {} }) };
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: JSON.stringify({ from: 'h3', to: 'e3', summary: '中炮架起', evaluation: '均势', confidence: 0.7 }) } }], usage: {} }) };
    };
    const engineR2 = XQ.Engine.create();
    const agentR2 = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-retry', onRetry: (info) => retryCalls.push(info) });
    const mvR2 = await agentR2.next(engineR2, null);
    ok(retryCalls.length === 1, 'onRetry 钩子: 纯散文失败触发 1 次 (v2.5)');
    ok(retryCalls[0] && retryCalls[0].attempt === 1, 'onRetry 携带 attempt=1 (v2.5)');
    ok(!!mvR2 && mvR2.from.x === 7 && mvR2.to.x === 4, '重试后第2次成功返回 h3-e3 (v2.5)');
  }

  {
    // v2.7 多轮缓存: 请求 N+1 前缀 ⊇ 请求 N 全体 (历史以 user/assistant 对追加) + 重试仅追加末尾警告 + usage.cacheHit 统计
    let nC = 0;
    const cacheCalls = [];
    globalThis.fetch = async function (url, opts) {
      const body = JSON.parse(opts.body);
      cacheCalls.push(body);
      nC++;
      if (nC === 2) return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: '纯散文无JSON输出' } }], usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_cache_hit_tokens: 80 } }) };
      const content = JSON.stringify({ from: nC === 1 ? 'h3' : 'b1', to: nC === 1 ? 'e3' : 'c3', summary: '中炮架起', confidence: 0.7 });
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content } }], usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105, prompt_cache_hit_tokens: 80 } }) };
    };
    const engineC = XQ.Engine.create();
    const agentC = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-cache' });
    await agentC.next(engineC, null);   // 第1手 h3-e3
    ok(cacheCalls[0].messages.length === 2, '首请求 = system + user (v2.7 多轮)');
    ok(userOf(cacheCalls[0]).startsWith('## 任务: 给出当前局面你的最佳着法'), '首手 user 带静态任务头 (v2.7)');
    await agentC.next(engineC, null);   // 第2手: attempt1 散文失败 → attempt2 成功 b1-c3
    ok(cacheCalls[1].messages.length === 4 && cacheCalls[1].messages[2].role === 'assistant', '后续请求追加历史对: [system, u1, a1, u2] (v2.7)');
    ok(cacheCalls[1].messages[2].content.includes('中炮架起'), 'assistant 历史 = 模型当手原样 JSON (v2.7)');
    ok(userOf(cacheCalls[1]).includes('延续对局') && !userOf(cacheCalls[1]).startsWith('## 任务'), '增量 user 不再重复任务头 (v2.7 省字)');
    const pre2 = JSON.stringify(cacheCalls[1].messages.slice(0, 3));
    const u2a = userOf(cacheCalls[1]);   // 第2手 attempt1 (散文失败)
    const u2b = userOf(cacheCalls[2]);   // 第2手 attempt2 (带警告)
    ok(JSON.stringify(cacheCalls[2].messages.slice(0, 3)) === pre2, '重试请求前缀 = 失败请求全体 → 复用已缓存前缀 (v2.7)');
    ok(u2b.startsWith(u2a) && u2b.includes('警告: 你刚才的输出无效'), '重试块追加于末尾, 失败请求全体复用 (v2.7)');
    ok((agentC.usage().cacheHit || 0) > 0, 'usage.cacheHit 累计 provider 上报 (v2.7)');
  }

  {
    // v2.9 亏子标注: 静态交换净亏的吃子在合法列表带 '亏' (黑马吃兵被象反吃场景, 今日实战 #10→#11 复盘)
    const engineS = XQ.Engine.create();
    const seqS = [['b1', 'c3'], ['b10', 'c8'], ['h1', 'g3'], ['h10', 'g8'], ['c1', 'e3'], ['c8', 'e9'], ['g4', 'g5'], ['e9', 'f7'], ['g3', 'f5']];
    for (const [f, t] of seqS) { const F = XQ.Move.parseSq(f), T = XQ.Move.parseSq(t); const r = engineS.applyPlayerMove(F.x, F.y, T.x, T.y); if (!r.ok) throw new Error('谱面非法: ' + f + '-' + t + ' ' + r.reason); }
    const baseS = calls.length;
    globalThis.fetch = async function (url, opts) {
      const body = JSON.parse(opts.body);
      calls.push(body);
      const content = JSON.stringify({ from: 'f7', to: 'g5', summary: '吃兵', confidence: 0.6 });
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    const agentS = XQ.LLMAgent.create({ side: 'black', provider: 'mock', model: 'mock-s9' });
    await agentS.next(engineS, null);
    ok(userOf(calls[baseS]).includes('[f7>g5吃兵亏]'), '静态交换净亏吃子 → 合法列表标 亏 (v2.9)');
    ok((userOf(calls[baseS]).match(/亏\]/g) || []).length === 1, '仅净亏吃子标 亏, 其余吃子不误标 (v2.9 零噪音)');
  }
  {
    // v2.9 reasoning 打捞: 内容层散文 + 思考层 JSON → 免重试直接命中
    let nR3 = 0;
    globalThis.fetch = async function () {
      nR3++;
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: '我需要分析一下这个局面再给出着法。', reasoning_content: '先看h3-e3但那是红炮的着法不合法, 改走 {"from":"b1","to":"c3","summary":"跳正马","confidence":0.7} 稳妥。' } }], usage: {} }) };
    };
    const engineR3 = XQ.Engine.create();
    const agentR3 = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-r9' });
    const baseR3 = calls.length;
    const mvR3 = await agentR3.next(engineR3, null);
    ok(!!mvR3 && mvR3.from.x === 1 && mvR3.to.x === 2, 'reasoning_content 中的 JSON 被打捞 (b1-c3) (v2.9)');
    ok(nR3 === 1, '打捞命中零重试 (v2.9)');
  }

  {
    // v3.2 HIST_CAP 裁剪: 请求数超过上限后消息数封顶 (2 + 2*10 = 22), 且每手走子自驱动 (合法列表首个着法)
    let nH = 0;
    const capCalls = [];
    globalThis.fetch = async function (url, opts) {
      const body = JSON.parse(opts.body);
      capCalls.push(body);
      nH++;
      const um = body.messages[body.messages.length - 1].content;
      const all = um.match(/\[[^\]]+\]/g) || [];
      // v3.7: 只选无标记普通着法 (排序后 危/亏 沉底; 带标记的吃/危/亏/将 可能触发守卫/保护拦截 → 重试会让 capCalls 下标错位)
      // v3.7b: 必须匹配完整 [] 内容再测标记 — 截断匹配会把 [h3>h10吃马] 误判普通着法 → 首手被开局保护拦截 → 后续下标全错位 (本轮修复的假失败根因)
      const plain = all.filter(function (m2) { return !/吃|危|亏|将|杀|困/.test(m2); });
      const pick = (plain.length ? plain[nH % plain.length] : (all[nH % Math.max(all.length, 1)] || ''));
      const mm = pick.match(/\[([a-i](?:10|[1-9]))>([a-i](?:10|[1-9]))/);
      const content = JSON.stringify({ from: mm ? mm[1] : 'b1', to: mm ? mm[2] : 'c3', summary: '推进' + nH, confidence: 0.7 });
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    const engineH = XQ.Engine.create();
    const agentH = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-cap2' });
    const roundUsers = {};   // v3.7: 每手请求的 user 文本 (验证 HIST_CAP 裁剪后手数仍正确)
    for (let k = 0; k < 13; k++) {
      const startIdx = capCalls.length;
      const mvH = await agentH.next(engineH, null);
      roundUsers[k] = capCalls[startIdx] ? userOf(capCalls[startIdx]) : '';
      const rH = engineH.applyPlayerMove(mvH.from.x, mvH.from.y, mvH.to.x, mvH.to.y);
      if (!rH.ok) throw new Error('HIST_CAP 测试走法被拒: ' + rH.reason);
      const bl = engineH.isOver() ? [] : engineH.generateLegalMoves('black');
      if (!engineH.isOver() && bl.length) { const b0 = bl[0]; engineH.applyPlayerMove(b0.from.x, b0.from.y, b0.to.x, b0.to.y); }
      if (engineH.isOver()) break;
    }
    ok(nH >= 11 && capCalls[10].messages.length === 22, 'HIST_CAP 触顶前消息数线性增长 (第11手 = 2+2*10) (v3.2)');
    ok(capCalls[capCalls.length - 1].messages.length === 22, 'HIST_CAP=10 触顶: 消息数封顶 22 (v3.2)');
    ok(roundUsers[11] && roundUsers[11].includes('第12手轮到你'), 'HIST_CAP 裁剪后手数正确: 第12手请求显示第12手 (v3.7, 原 convo.length+1 会错显第11手)');
    ok(roundUsers[12] && roundUsers[12].includes('第13手轮到你'), 'HIST_CAP 裁剪后手数正确: 第13手请求显示第13手 (v3.7)');
  }

  {
    // v3.3 危标注: 非吃子送吃着法预标 '危' (与守卫同源逻辑, 模型提前避开 → 少烧重试); 复现实战 a10-b10 借架吃车场景
    const engineW2 = XQ.Engine.create();
    const seqW2 = [['h3', 'e3'], ['b10', 'c8'], ['b1', 'c3'], ['h10', 'g8'], ['h1', 'g3']];
    for (const [f, t] of seqW2) { const F = XQ.Move.parseSq(f), T = XQ.Move.parseSq(t); const r = engineW2.applyPlayerMove(F.x, F.y, T.x, T.y); if (!r.ok) throw new Error('谱面非法: ' + f + '-' + t); }
    globalThis.fetch = async function (url, opts) {
      const body = JSON.parse(opts.body);
      calls.push(body);
      const content = JSON.stringify({ from: 'a10', to: 'b10', summary: '出车', confidence: 0.6 });
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    const agentW3 = XQ.LLMAgent.create({ side: 'black', provider: 'mock', model: 'mock-w3' });
    try { await agentW3.next(engineW2, null); } catch (eW3) { /* 守卫可能拦截同着法, 只验证标注 */ }
    ok(userOf(calls[calls.length - 1]).includes('[a10>b10危]'), '非吃子送吃着法 → 合法列表预标 危 (v3.3)');
    const firstEntryW = (userOf(calls[calls.length - 1]).match(/\[[^\]]*\]/) || [''])[0];
    ok(!!firstEntryW && firstEntryW !== '[a10>b10危]', '危/亏 着法沉底: 列表首个条目不是 [a10>b10危] (v3.7 排序)');
  }

  {
    // v3.4 extractJson 加固: 尾逗号/单引号 JSON 免重试直接解析 (LLM 高频格式错误)
    let nJ = 0;
    globalThis.fetch = async function () {
      nJ++;
      const content = nJ === 1
        ? '{"from":"h3","to":"e3","summary":"中炮","confidence":0.7,}'
        : "{'from':'b1','to':'c3','summary':'跳马','confidence':0.7}";
      return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content } }], usage: {} }) };
    };
    const engineJ = XQ.Engine.create();
    const agentJ = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock-j4' });
    const mvJ1 = await agentJ.next(engineJ, null);
    const mvJ2 = await agentJ.next(engineJ, null);
    ok(!!mvJ1 && mvJ1.from.x === 7, '尾逗号 JSON 免重试解析 (h3) (v3.4)');
    ok(!!mvJ2 && mvJ2.from.x === 1 && mvJ2.to.x === 2, '单引号 JSON 免重试解析 (b1-c3) (v3.4)');
  }

  {
    // v3.8 重试退避决策 (retryWaitMs 模块级纯函数): 网关类瞬时错误线性退避, 格式错误短等
    const W = XQ.LLMAgent.retryWaitMs;
    ok(typeof W === 'function', '导出 retryWaitMs (v3.8 退避可测)');
    ok(W('HTTP 504 Gateway Time-out', 2) === 6000, '504 网关错误线性退避 6s (v3.8: 旧正则只覆盖 503 → 504 仅等 0.4s 重打)');
    ok(W('HTTP 502 Bad Gateway', 1) === 3000, '502 退避 3s (v3.8)');
    ok(W('HTTP 503 服务繁忙', 3) === 9000, '503 退避 9s (v2.9 原有行为保持)');
    ok(W('HTTP 429 rate limited', 2) === 6000, '429 限流退避 6s (原有行为保持)');
    ok(W('返回无法解析: xxx', 2) === 400, '格式类错误短等 400ms 不变 (v3.8)');
  }

  console.log(fail ? `\n${fail} FAILED` : `\n全部通过 ✓ (${pass} 项)`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
