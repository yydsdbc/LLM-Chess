// v1.7.6: 不再手抄 cleanReason 副本 (已与 app.js 实现漂移), 直接从 ui/app.js 提取真实实现 — 单一来源, 改动自动受测
const fs = require('fs');
const src = fs.readFileSync(__dirname + '/../ui/app.js', 'utf8');
const start = src.indexOf('function cleanReason(raw)');
if (start < 0) { console.error('cleanReason not found in ui/app.js'); process.exit(1); }
let depth = 0, end = -1;
for (let i = src.indexOf('{', start); i < src.length; i++) {
  if (src[i] === '{') depth++;
  else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
}
if (end < 0) { console.error('cleanReason body not terminated'); process.exit(1); }
const cleanReason = new Function('return (' + src.slice(start, end) + ')')();
const cases = [
  ['垃圾-截图1(v15.10)', '10．109．\n象 108－.\n7．\n 车 107－7 7 7 车 7 7\n.车 7.7 7．车 7 1．\n7.\n108． . +6.\n6 7 6 10 10．6', true],
  ['垃圾-截图2(v1.5.10)', '象 10 10 士 10 10 将 10\n马 8 卒 7 7.\n相 1 帅 1 马 2 兵 4 4 4.', true],
  ['垃圾-截图3(v1.5.10c 复述+残渣)', '… 炮 … 炮 …//… 炮 …//…\n 炮 84 炮 4 平... 进行号增大 红方在下方行15 进行号增大 - . 红方在下方行15 进行号增大 - . 黑方在上方行610 进行号减小…//…//占线捉兵车进河沿，白拐中兵保持大优... 黑大优0... 总长90字 - . .', true],
  ['禁词-进行号', '红方在下方行15 进行号增大，所以马跳河口', 'nogen'],
  ['禁词-总长', '这步吃车划算。总长90字', 'nogen'],
  ['保留-记谱1', '红方中炮威胁中卒, 马 8 进 7 保护, 炮 2 平 5 对攻', false],
  ['保留-记谱2', '黑车 9 平 8 捉炮, 我应跳马护炮', false],
  ['保留-残局', '残局阶段, 兵 4 路 5 兵过河后价值大增, 直捣九宫', false],
  ['保留-小数', '中兵 0.85 价值, 第 11 手车 5 平 3 抽将', false],
  ['保留-信心', '信心 0.85, 这步白吃大子', false]
];
let fail = 0;
cases.forEach(([name, input, expectCollapse]) => {
  const out = cleanReason(input);
  let ok;
  if (expectCollapse === true) {
    ok = !/进行号|行15|行610|总长|\/\/…|…\s*[车炮马兵卒将士象]\s*…/.test(out) && out.length < input.length / 2;
  } else if (expectCollapse === 'nogen') {
    ok = !/进行号|总长|行15/.test(out) && /马跳河口|吃车划算/.test(out);
  } else {
    ok = out === input;
  }
  if (!ok) fail++;
  console.log((ok ? 'PASS' : 'FAIL') + ' [' + name + '] ' + JSON.stringify(out));
});
process.exit(fail ? 1 : 0);
