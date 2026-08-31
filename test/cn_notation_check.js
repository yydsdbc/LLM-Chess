/* test/cn_notation_check.js — 中文记谱 cnNotation 回归 (v1.7.6)
 * v1.7.6 发现: app.js cnNotation 用 horse/elephant 键, 引擎类型实为 knight/bishop → 马象记谱恒返回空串。
 * 本测试从 ui/app.js 提取真实实现 (与 _clean_reason_check 同款单源手法), 锁定经典谱着。 */
const fs = require('fs');

function extractFn(src, signature) {
  const start = src.indexOf(signature);
  if (start < 0) { console.error(signature + ' not found in ui/app.js'); process.exit(1); }
  let depth = 0, end = -1;
  for (let i = src.indexOf('{', start); i < src.length; i++) {
    if (src[i] === '{') depth++;
    else if (src[i] === '}') { depth--; if (!depth) { end = i + 1; break; } }
  }
  if (end < 0) { console.error(signature + ' body not terminated'); process.exit(1); }
  return new Function('return (' + src.slice(start, end) + ')')();
}

const src = fs.readFileSync(__dirname + '/../ui/app.js', 'utf8');
const cnNotation = extractFn(src, 'function cnNotation(');   // v3.9a: 签名加 pieceAt 可选参, 提取器只锚函数名

/* 坐标: x=0..8 → 列 a..i; y=0..9 → 行 10..1 (sqName 同口径) */
const sq = (c, r) => ({ x: c.charCodeAt(0) - 97, y: 10 - r });
let failed = 0;
const cases = [
  ['红马八进七', ['red', 'knight', sq('b', 1), sq('c', 3)], '马八进七'],
  ['红炮二平五 (中炮)', ['red', 'cannon', sq('h', 3), sq('e', 3)], '炮二平五'],
  ['红炮八平五', ['red', 'cannon', sq('b', 3), sq('e', 3)], '炮八平五'],
  ['红相三进五 (象开)', ['red', 'bishop', sq('g', 1), sq('e', 3)], '相三进五'],
  ['红车九进一', ['red', 'rook', sq('a', 1), sq('a', 2)], '车九进一'],
  ['红兵五进一', ['red', 'pawn', sq('e', 4), sq('e', 5)], '兵五进一'],
  ['黑马2进3 (屏风马)', ['black', 'knight', sq('b', 10), sq('c', 8)], '马2进3'],
  ['黑象3进5', ['black', 'bishop', sq('c', 10), sq('e', 8)], '象3进5'],
  ['黑砲8平5', ['black', 'cannon', sq('h', 8), sq('e', 8)], '砲8平5'],
  ['黑卒3进1', ['black', 'pawn', sq('c', 7), sq('c', 6)], '卒3进1'],
  ['红仕四进五', ['red', 'advisor', sq('f', 1), sq('e', 2)], '仕四进五'],
  ['黑士4进5', ['black', 'advisor', sq('d', 10), sq('e', 9)], '士4进5'],
  /* A2 边界核对: 同列多兵/车/马的「前/中/后」区分需要棋盘上下文 — 现 cnNotation (ui/app.js, 无 board 参数) 不做区分。
   * 锁定行为 = 同列多子各自产出相同基础形态、确定性、不崩; 记谱歧义缺口已上报主代理, 修复点在 ui 层 (不在 core 所有权内) */
  ['边界: 同列第2红兵同形态(无前/后区分)', ['red', 'pawn', sq('e', 5), sq('e', 6)], '兵五进一'],
  ['边界: 同列第3红兵同形态', ['red', 'pawn', sq('e', 6), sq('e', 7)], '兵五进一'],
  ['边界: 同列第2红车同形态', ['red', 'rook', sq('a', 5), sq('a', 6)], '车九进一'],
  ['边界: 同列第2红马同形态', ['red', 'knight', sq('b', 5), sq('c', 7)], '马八进七']
];
for (const [name, args, want] of cases) {
  const got = cnNotation.apply(null, args);
  const ok = got === want;
  if (!ok) failed++;
  console.log((ok ? 'PASS' : 'FAIL') + ' [' + name + '] got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
}
/* A2 哨兵: 全部产出不得含 前/中/后 — 无棋盘上下文的实现做不了同列区分, 若出现说明混入了未经对局验证的新逻辑 */
let sweepBad = 0;
for (const [, args] of cases) {
  if (/[前中后]/.test(cnNotation.apply(null, args))) sweepBad++;
}
const sweepOk = sweepBad === 0;
if (!sweepOk) failed++;
console.log((sweepOk ? 'PASS' : 'FAIL') + ' [哨兵: 全部记谱不含 前/中/后 (同列区分缺口已上报, 修复点在 ui 层)]');

/* v3.9a 同列同种消歧 (pieceAt 注入, 对局后盘面视图语义): 同列 2+ 同色同种 → 前/后; 兵 3+ 同列 → 前/中/后 */
const mkPA = (list, color, type) => {
  const m = {};
  for (const [c, r] of list) m[(c.charCodeAt(0) - 97) + ',' + (10 - r)] = { color: color, type: type };
  return (x, y) => m[x + ',' + y] || null;
};
const preCases = [
  ['前兵进一 (双兵同列, 前兵直进)', ['red', 'pawn', sq('e', 6), sq('e', 7), mkPA([['e', 4], ['e', 6]], 'red', 'pawn')], '前兵进一'],
  ['后兵平六 (双兵同列, 后兵平移)', ['red', 'pawn', sq('e', 4), sq('d', 4), mkPA([['e', 4], ['e', 6]], 'red', 'pawn')], '后兵平六'],
  ['中兵平六 (三兵同列)', ['red', 'pawn', sq('e', 5), sq('d', 5), mkPA([['e', 4], ['e', 5], ['e', 6]], 'red', 'pawn')], '中兵平六'],
  ['前兵进一 (三兵同列, 最前直进)', ['red', 'pawn', sq('e', 6), sq('e', 7), mkPA([['e', 4], ['e', 5], ['e', 6]], 'red', 'pawn')], '前兵进一'],
  ['前车进一 (双车同列)', ['red', 'rook', sq('a', 6), sq('a', 7), mkPA([['a', 5], ['a', 6]], 'red', 'rook')], '前车进一'],
  ['后车平八 (双车同列, 后车平移)', ['red', 'rook', sq('a', 5), sq('b', 5), mkPA([['a', 5], ['a', 6]], 'red', 'rook')], '后车平八'],
  ['前马进7 (双马同列, 黑方)', ['black', 'knight', sq('h', 8), sq('g', 6), mkPA([['h', 8], ['h', 9]], 'black', 'knight')], '前马进7'],
  ['后马退6 (双马同列, 黑方)', ['black', 'knight', sq('h', 9), sq('f', 10), mkPA([['h', 8], ['h', 9]], 'black', 'knight')], '后马退6']
];
for (const [name, args, want] of preCases) {
  const got = cnNotation.apply(null, args);
  const okp = got === want;
  if (!okp) failed++;
  console.log((okp ? 'PASS' : 'FAIL') + ' [' + name + '] got=' + JSON.stringify(got) + ' want=' + JSON.stringify(want));
}

/* 修复前回归哨兵: horse/elephant 旧键必须不再被依赖 (传旧键应得空串而非记谱) */
const legacy = cnNotation('red', 'horse', sq('b', 1), sq('c', 3)) + cnNotation('red', 'elephant', sq('g', 1), sq('e', 3));
const sentinel = legacy === '';
if (!sentinel) failed++;
console.log((sentinel ? 'PASS' : 'FAIL') + ' [旧键 horse/elephant 不产出记谱] got=' + JSON.stringify(legacy));
console.log(failed ? '\n' + failed + ' FAIL' : '\nALL PASS (' + (cases.length + preCases.length + 1) + ')');
process.exit(failed ? 1 : 0);
