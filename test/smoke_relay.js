/* test/smoke_relay.js — 通过本地中继真实调用一次 LLM, 验证 v1.3 全链路
 * 检查: SSE 流式 / usage / 简短中文思考 / 扩展 JSON (from/to/summary/evaluation/confidence)
 * 运行: node test/smoke_relay.js [provider] [model]
 */
'use strict';
const provider = process.argv[2] || 'tokenrhythm';
const model = process.argv[3] || 'glm-5.3-flash';

const SYSTEM = '你是中国象棋AI决策模块, 现在执红方(帅方)。\n'
  + '你的任务: 从引擎提供的合法着法列表中, 选择胜率最高的一步。\n'
  + '\n## 输出语言(最高优先级, 必须遵守): 全程简体中文 — 简短直接, 禁止英文思考与英文输出。'
  + '\n## 决策方法(内部完成, 不输出过程):'
  + '\n- 对每个候选着法推演未来至少3个回合: 己方此步 → 对手最佳回应 → 己方后续计划。'
  + '\n- 结合"局面基础评价"(子力差/威胁/将军状态)做战略判断, 不重复计算规则。'
  + '\n- 只把决策结论写入 summary/evaluation/confidence, 不输出中间推演。'
  + '\n## 战略优先级(从高到低, 严格按序权衡):'
  + '\n1. 必杀机会  2. 强制将军  3. 明显得子  4. 保护关键棋子  5. 攻势发展  6. 稳定布局'
  + '\n注意: 不做单纯贪吃 — 吃子若导致失势, 按优先级向下退一档。'
  + '\n## 合法性约束(必须遵守):'
  + '\n- 只能从提供的合法着法列表中选择, 禁止创造列表外的走法。'
  + '\n- 禁止修改坐标格式(列a~i, 行1~10, 例 "e3")。'
  + '\n- 禁止输出 JSON 以外的任何内容(解释/代码块/思考过程)。'
  + '\n## 输出格式(严格遵守): 只输出一个 JSON 对象:'
  + '\n{"from":"起点格","to":"终点格","summary":"≤30字关键决策原因","evaluation":"局面评价, 如 +0.5 红方略优","confidence":0.72}'
  + '\n- summary ≤30字, 只写关键原因; evaluation 含分数与局势; confidence 0~1; 三项必填。';
const USER = '## 对局开始 (第 1 手), 你执红方(帅方)\n'
  + '## 局面基础评价 (引擎提供):\n- 子力差: 0 (均衡)\n- 将军状态: 双方均未被将军\n- 合法着法数: 44\n'
  + '## 当前棋盘:\n[10行×9列标准开局]\n## 你的合法着法(共44个): [a4>a5]...[h3>h10]...\n'
  + '请决策, 只输出 JSON: {"from":"…","to":"…","summary":"…","evaluation":"…","confidence":0.0}';

async function main() {
  const t0 = Date.now();
  let res;
  try {
    res = await fetch('http://localhost:8788/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        provider, model,
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: USER }
        ],
        temperature: 0.3, max_tokens: 2400, stream: true, stream_options: { include_usage: true }
      })
    });
  } catch (e) {
    console.log('无法连接 http://localhost:8788 — 请先启动服务: node server.js (' + (e && e.message || e) + ')');
    process.exit(1);
  }
  if (!res.ok) { console.log('HTTP', res.status, await res.text().catch(() => '')); process.exit(1); }
  const ct = res.headers.get('content-type') || '';
  let answer = '', reasoning = '', usage = null, chunks = 0;
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';
  for (;;) {
    const r = await reader.read();
    if (r.done) break;
    buf += dec.decode(r.value, { stream: true });
    const lines = buf.split('\n'); buf = lines.pop();
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith('data:')) continue;
      const d = l.slice(5).trim();
      if (!d || d === '[DONE]') continue;
      try {
        const j = JSON.parse(d);
        chunks++;
        if (j.usage) usage = j.usage;
        const delta = j.choices && j.choices[0] && j.choices[0].delta || {};
        if (delta.reasoning_content) reasoning += delta.reasoning_content;
        if (delta.content) answer += delta.content;
      } catch (e) {}
    }
  }
  const ms = Date.now() - t0;
  const cjk = (reasoning.match(/[\u4e00-\u9fff]/g) || []).length;
  const cjkRatio = reasoning.length ? (cjk / reasoning.replace(/\s/g, '').length) : 0;
  console.log('content-type :', ct);
  console.log('chunks       :', chunks);
  console.log('usage        :', JSON.stringify(usage));
  console.log('latency      :', ms + 'ms');
  console.log('reasoning len:', reasoning.length, '| 中文字符:', cjk, '| 中文占比:', (cjkRatio * 100).toFixed(0) + '%');
  console.log('reasoning 前80字:', reasoning.slice(0, 80).replace(/\n/g, ' '));
  console.log('answer       :', answer.slice(0, 200));
  const m = answer.match(/\{[^{}]*\}/);
  let parsed = null;
  if (m) {
    try { parsed = JSON.parse(m[0]); } catch (e) {}
  }
  if (parsed) {
    console.log('parsed JSON  :', JSON.stringify(parsed));
  }
  const hasFromTo = parsed && parsed.from && parsed.to;
  const hasMeta = parsed && typeof parsed.summary === 'string' && typeof parsed.evaluation === 'string' && typeof parsed.confidence === 'number';
  const okMove = !!hasFromTo;
  const okMeta = !!hasMeta;
  const okZh = reasoning.length === 0 || cjkRatio > 0.3;
  console.log('\n字段完整性:');
  console.log('  from/to   :', hasFromTo ? '✓' : '✗');
  console.log('  summary/evaluation/confidence :', hasMeta ? '✓ (' + (parsed.summary || '').slice(0, 20) + '...)' : '✗');
  console.log(okMove && okZh && okMeta ? '\nSMOKE OK ✓ (v1.3 完整字段)' : '\nSMOKE FAIL ✗');
  process.exit(okMove && okZh && okMeta ? 0 : 1);
}
main().catch(e => { console.error('SMOKE ERROR:', e.message); process.exit(1); });