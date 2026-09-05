// app.js style -> promptLevel migration (one-shot)
const fs = require('fs');
const p = 'C:/Users/dukai/.openclaw/workspace/LLM-chess/ui/app.js';
let t = fs.readFileSync(p, 'utf8');
let n = 0;
function rep(oldS, newS, tag) {
  if (t.includes(oldS)) { t = t.split(oldS).join(newS); n++; console.log('ok:', tag); }
  else { console.log('ANCHOR FAIL:', tag); }
}

// 1) styleCN/styleClass -> levelCN/levelClass
rep("  /* v1.5 棋风徽章与决策面板 */\n  function styleCN(s) { return s === 'aggressive' ? '攻击型' : s === 'defensive' ? '防守型' : '均衡型'; }\n  function styleClass(s) { return s === 'aggressive' ? 'st-agg' : s === 'defensive' ? 'st-def' : 'st-bal'; }",
  "  /* v1.0.3 提示词等级徽章与决策面板 */\n  function levelCN(s) { return s === 'none' ? '无' : s === 'low' ? '低' : s === 'high' ? '高' : '中'; }\n  function levelClass(s) { return s === 'none' ? 'st-none' : s === 'low' ? 'st-low' : s === 'high' ? 'st-high' : 'st-mid'; }",
  'styleCN/styleClass -> levelCN/levelClass');

// 2) SIDE_DEFS style 字段注释不变 (id 保留 ai-red-style 兼容 localStorage), 但读取默认值改 mid
rep("style: document.getElementById(d.style) ? document.getElementById(d.style).value : 'balanced',",
  "style: document.getElementById(d.style) ? document.getElementById(d.style).value : 'mid',",
  "readSettings default mid");

rep("if (document.getElementById(d.style)) document.getElementById(d.style).value = v.style || 'balanced';",
  "if (document.getElementById(d.style)) document.getElementById(d.style).value = v.style || 'mid';",
  "fillSettings default mid");

// 3) agent 创建: style -> promptLevel
rep("side: side, provider: v.provider, model: v.model, style: v.style || 'balanced',",
  "side: side, provider: v.provider, model: v.model, promptLevel: v.style || 'mid',",
  'LLMAgent.create promptLevel');

rep("agents[side] = { kind: 'llm', label: v.model || 'LLM', model: v.model, provider: v.provider, quick: !!v.quick, style: v.style || 'balanced', agent: agent };",
  "agents[side] = { kind: 'llm', label: v.model || 'LLM', model: v.model, provider: v.provider, quick: !!v.quick, style: v.style || 'mid', agent: agent };",
  'agents[side] style field kept (record compat)');

// 4) 徽章调用点: styleCN/styleClass -> levelCN/levelClass
t = t.split('styleClass(currentRecord').join('levelClass(currentRecord');
t = t.split('styleCN(currentRecord').join('levelCN(currentRecord');
console.log('badges migrated');

fs.writeFileSync(p, t, 'utf8');
console.log('total replacements:', n);
