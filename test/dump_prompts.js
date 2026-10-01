/* test/dump_prompts.js — 导出 LLM 实际发送的完整提示词 (首手/后续手)
 * 运行: node test/dump_prompts.js  → 输出到 prompts_dump.md
 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
for (const f of ['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js',
  'core/generator.js', 'core/judge.js', 'core/engine.js', 'evaluation/xiangqi_knowledge.js', 'evaluation/position.js', 'ai/llm_agent.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const XQ = globalThis.XQ;

const calls = [];
let n = 0;
globalThis.fetch = async function (url, opts) {
  const body = JSON.parse(opts.body);
  calls.push(body);
  n++;
  const mv = n === 2
    ? { from: 'e3', to: 'b3', plan: '牵制中路', summary: '炮退八防马路', evaluation: '+0.2 红略优', confidence: 0.7 }
    : { from: 'b3', to: 'e3', plan: '中炮控中路', summary: '架中炮威胁中卒', evaluation: '0.0 均势', confidence: 0.75 };
  return {
    ok: true,
    headers: { get: (k) => (k.toLowerCase() === 'content-type' ? 'application/json' : null) },
    json: async () => ({
      choices: [{ message: { content: JSON.stringify(mv), reasoning_content: '标准开局,红方先行。选择中炮(炮二平五)是经典开局,控制中路。输出JSON。' } }],
      usage: { prompt_tokens: 300, completion_tokens: 50, total_tokens: 350 }
    })
  };
};

(async function main() {
  const checkOnly = process.argv.includes('--check');   // v3.9a: --check 只输出 system 字数与特殊符号扫描, 不写文件 (CI/守护用)
  const engine = XQ.Engine.create();
  const agent = XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'glm-5.3-flash' });

  // 第 1 手 (首手: 完整提示词)
  await agent.next(engine, null);
  const first = calls[0].messages;

  // 红走 b3→e3, 黑应 h8→e8, 再轮红 (第 2 手: 增量提示词)
  const p1 = XQ.Move.parseSq('b3'), t1 = XQ.Move.parseSq('e3');
  engine.applyPlayerMove(p1.x, p1.y, t1.x, t1.y);
  const p2 = XQ.Move.parseSq('h8'), t2 = XQ.Move.parseSq('e8');
  engine.applyPlayerMove(p2.x, p2.y, t2.x, t2.y);
  await agent.next(engine, null);
  const inc = calls[1].messages;

  // 从真实重试请求导出警告, 避免手写副本与实现漂移。
  const retryCalls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async function (url, opts) {
    retryCalls.push(JSON.parse(opts.body));
    const reply = { from: 'b3', to: 'e3', confidence: 0.75 };
    if (retryCalls.length > 1) reply.summary = '架中炮';
    return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: JSON.stringify(reply) } }] }) };
  };
  try {
    await XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'dump-format' }).next(XQ.Engine.create());
  } finally { globalThis.fetch = originalFetch; }
  const retryUser = retryCalls[1].messages[retryCalls[1].messages.length - 1].content;
  const retryText = retryUser.slice(retryUser.indexOf('\n## 警告:')).trim();

  let md = '# LLM 实际发送的提示词 (v' + JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version + ' 真实渲染)\n\n';
  md += '> 生成时间: ' + new Date().toLocaleString('zh-CN') + ' | 场景: 红方执子, mock 对局第1手与第3手\n\n';
  md += '---\n\n## 一、首手 (每局第一次调用)\n\n### System (完整提示词)\n\n```text\n' + first[0].content + '\n```\n\n';
  md += '### User\n\n```text\n' + first[1].content + '\n```\n\n';
  md += '---\n\n## 二、后续每手 (v2.7 多轮结构: system + 历史 user/assistant 对 + 增量 user; 请求 N+1 前缀 ⊇ 请求 N 全体, 前缀缓存最大化)\n\n### System (恒定提示词)\n\n```text\n' + inc[0].content + '\n```\n\n';
  md += '### 历史对数: ' + ((inc.length - 2) / 2 | 0) + ' 对 (末条为当前增量 user)\n\n### 增量 User (末条消息)\n\n```text\n' + inc[inc.length - 1].content + '\n```\n\n---\n\n';
  md += '## 三、缺少字段重试时的实际追加块 (格式修正可保持合法原选, 着法被引擎或守卫拒绝时才禁选)\n\n```text\n' + retryText + '\n```\n\n';
  md += '## 提示词所在位置: `ai/llm_agent.js`\n'
    + '- 首手 System: `systemPrompt()` 函数\n'
    + '- 多轮组装: `buildMessagesWithEngine()` (历史对追加, v2.7) + `firstUserMsg/incUserMsg`\n';

  if (checkOnly) {
    const sys = first[0].content;
    const bad = sys.match(/[①②③④⑤⑥⑦⑧⑨⑩≥≤~→⚠]/g) || [];
    console.log('[--check] 首手 system: ' + sys.length + ' 字 (上限 2400)');
    console.log('[--check] 特殊符号扫描: ' + (bad.length ? '发现 ' + bad.join(' ') : '0 (通过)'));
    console.log('[--check] 增量消息数: ' + inc.length + ' | 历史对数: ' + ((inc.length - 2) / 2 | 0));
    if (sys.length > 2400 || bad.length) { console.log('[--check] ✗ 守护违例 — exit 1'); process.exit(1); }   // v3.9a: 升级为硬门禁
    // 默认 mid 不能代表 high: 对红黑双方与全部等级检查实际发送的字节。
    try {
      for (const side of ['red', 'black']) {
        for (const promptLevel of ['none', 'low', 'mid', 'high']) {
          const fixture = XQ.Engine.create();
          const move = fixture.generateLegalMoves(side)[0];
          let rendered;
          globalThis.fetch = async function (url, opts) {
            rendered = JSON.parse(opts.body).messages[0].content;
            const answer = JSON.stringify({ from: XQ.Move.sqName(move.from), to: XQ.Move.sqName(move.to), summary: '测试', confidence: 0.5 });
            return { ok: true, headers: { get: () => 'application/json' }, json: async () => ({ choices: [{ message: { content: answer } }] }) };
          };
          await XQ.LLMAgent.create({ side, promptLevel, provider: 'mock', model: 'dump-gate' }).next(fixture);
          const prohibited = /[①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮≥≤~→←↑↓⚠]/.test(rendered);
          console.log('[--check] ' + side + '/' + promptLevel + ' system: ' + rendered.length + ' 字');
          if (rendered.length > 2400 || prohibited) throw new Error(side + '/' + promptLevel + ' system 守护违例');
        }
      }
    } finally { globalThis.fetch = originalFetch; }
    // v1.0.4: prompts_dump 漂移守护 — 磁盘上的 dump 若与当前代码渲染不一致 (除生成时间行) 即 fail, 防文档腐化
    const dumpPath = path.join(ROOT, 'prompts_dump.md');
    if (fs.existsSync(dumpPath)) {
      const norm = (s) => s.split(/\r?\n/).filter((l) => !l.startsWith('> 生成时间:')).join('\n').trim();
      if (norm(md) !== norm(fs.readFileSync(dumpPath, 'utf8'))) {
        console.log('[--check] prompts_dump.md 与当前提示词不一致 — 运行 node test/dump_prompts.js 重新生成后提交');
        process.exit(1);
      }
      console.log('[--check] prompts_dump.md 新鲜度: PASS');
    }
    return;
  }
  fs.writeFileSync(path.join(ROOT, 'prompts_dump.md'), md, 'utf8');
  console.log('已写入 prompts_dump.md (' + md.length + ' 字节)');
  console.log('首手 system: ' + first[0].content.length + ' 字 | 首手 user: ' + first[1].content.length + ' 字');
  console.log('增量 system: ' + inc[0].content.length + ' 字 | 增量 user (末条): ' + inc[inc.length - 1].content.length + ' 字 | 消息数: ' + inc.length);
})().catch(e => { console.error(e); process.exit(1); });
