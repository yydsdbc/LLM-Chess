// i18n style keys -> prompt level keys (one-shot migration)
const fs = require('fs');
const p = 'C:/Users/dukai/.openclaw/workspace/LLM-chess/ui/i18n.js';
let t = fs.readFileSync(p, 'utf8');
const zhOld = "    style: '棋风', style_aggressive: '攻击型', style_defensive: '防守型', style_balanced: '均衡型',";
const zhNew = "    prompt_level: '提示词等级 (风格注入量)', pl_none: '无 (不注入)', pl_low: '低 (一句话)', pl_mid: '中 (标准)', pl_high: '高 (标准+战术)',";
if (t.includes(zhOld)) { t = t.replace(zhOld, zhNew); console.log('zh ok'); } else { console.log('ZH ANCHOR FAIL'); }
t = t.replace('战略决策流 · 棋风对垒', '战略决策流 · 风格分级');
t = t.replace('Play styles', 'Tiered style injection');
const enOld = /    style: 'Style', style_aggressive: 'Aggressive', style_defensive: 'Defensive', style_balanced: '[^']*',/;
const enNew = "    prompt_level: 'Prompt level (style injection)', pl_none: 'None (no injection)', pl_low: 'Low (one-liner)', pl_mid: 'Mid (standard)', pl_high: 'High (standard + tactics)',";
if (enOld.test(t)) { t = t.replace(enOld, enNew); console.log('en ok'); } else { console.log('EN ANCHOR FAIL'); }
fs.writeFileSync(p, t, 'utf8');
