/* test/analyze_blunders.js — 对局瞎走检测器 (实证提示词优化用)
 * 用法: node test/analyze_blunders.js [record.json] [输出txt]
 * 检测: ①送吃/无根亏换 (走完被吃且换不回来) ②漏吃 (盘面上有免费大子没吃) ③来回拉锯 ④开局违规(代码拦截统计) ⑤错失必杀/困毙 (v1.7.9: 盘面有一步取胜着法却没走)
 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
for (const f of ['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js',
  'core/generator.js', 'core/judge.js', 'core/engine.js', 'benchmark/record.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const XQ = globalThis.XQ;

const REC = process.argv[2] || 'logs/match_headless.json';
const OUT = process.argv[3] || null;
const SELF = process.argv[2] === '--selftest';
const record = SELF ? null : JSON.parse(fs.readFileSync(path.join(ROOT, REC), 'utf8'));

const VAL = { rook: 9, cannon: 4.5, knight: 4, advisor: 2, bishop: 2, king: 100, pawn: 1 };   // v1.7.6: elephant→bishop (引擎类型名)
const cn = { red: { rook: '车', cannon: '炮', knight: '马', bishop: '相', advisor: '仕', king: '帅', pawn: '兵' }, black: { rook: '车', cannon: '砲', knight: '马', bishop: '象', advisor: '士', king: '将', pawn: '卒' } };
const opp = c => (c === 'red' ? 'black' : 'red');

// v3.7 开局三任务状态: 中炮 (己方半场 x=4 有炮) / 正马 (原位无马) / 挺兵 (任一路兵动过) — 与 v3.1 提示词三任务制对齐
function openingTaskState(engine, color) {
  const cells = engine.snapshot().cells;
  const yLo = color === 'red' ? 5 : 0, yHi = color === 'red' ? 9 : 4;
  let cannon = false, homeKnights = 0, pawnAdvanced = false;
  for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
    const p = cells[y][x];
    if (!p || p.color !== color) continue;
    if (p.type === 'cannon' && x === 4 && y >= yLo && y <= yHi) cannon = true;
    if (p.type === 'knight' && ((color === 'red' && y === 9 && (x === 1 || x === 7)) || (color === 'black' && y === 0 && (x === 1 || x === 7)))) homeKnights++;
    if (p.type === 'pawn' && ((color === 'red' && y < 9) || (color === 'black' && y > 0))) pawnAdvanced = true;
  }
  return { cannon, homeKnights, pawnAdvanced };
}

function newEngine() { return XQ.Engine.create({ ruleEnforce: false }); }   // v2.0: 分析器不重判 (旧棋谱可能含 6 连将, 引擎规则闭环会提前终局干扰重放)
function replay(engine, moves, n) {
  for (let i = 0; i < n; i++) {
    const m = moves[i];
    const f = XQ.Move.parseSq(m.from), t = XQ.Move.parseSq(m.to);
    const r = engine.applyPlayerMove(f.x, f.y, t.x, t.y);
    if (!r.ok) return false;
  }
  return true;
}
// 免费吃: color 方的所有"对方吃不回来"的 capture → [{val, from, to, target}]
function freeCaptures(engine, color) {
  const out = [];
  const legal = XQ.Generator.generateLegalMoves(engine.board || engineBoard(engine), color);
  for (const m of legal) {
    if (!m.captured) continue;
    const tv = VAL[m.captured.type] || 0;
    if (tv < 1) continue;
    const b2 = engine.cloneBoard();
    b2.applyMove(m);
    const replies = XQ.Generator.generateLegalMoves(b2, opp(color));
    let recapture = 0;
    for (const r of replies) {
      if (r.to.x === m.to.x && r.to.y === m.to.y && r.captured) recapture = Math.max(recapture, VAL[r.captured.type] || 0);
    }
    const net = tv - recapture;
    if (net >= 1.5) out.push({ val: net, raw: tv, from: XQ.Move.sqName(m.from), to: XQ.Move.sqName(m.to), target: m.captured.type, by: m.piece ? m.piece.type : '?' });
  }
  return out;
}
function engineBoard(engine) { return engine.cloneBoard(); } // 占位: 引擎内部 board 不外露, 用 snapshot 走法生成替代
// v1.7.9 错失必杀扫描: color 方的一步取胜着法 (走完后对方无解 — 绝杀或困毙)
// 先只对"走完将军"的着法做全量 reply 生成 (绝杀必先将军; 困毙无将军但罕见, 用对方无着法难找 — 此处只扫将军型绝杀, 困毙不计入以免误报)
function mateMoves(engine, color) {
  const out = [];
  const op = opp(color);
  let legal;
  try { legal = engine.generateLegalMoves(color); } catch (e) { return out; }
  for (const m of legal) {
    try {
      const b2 = engine.cloneBoard();
      b2.applyMove(m);
      if (!XQ.Rules.inCheck(b2, op)) continue;   // 先过滤: 只有将军着法才可能绝杀 (成本 O(1) 局面扫描)
      if (XQ.Generator.generateLegalMoves(b2, op).length === 0) {
        out.push({ from: XQ.Move.sqName(m.from), to: XQ.Move.sqName(m.to), piece: m.piece ? m.piece.type : '?' });
      }
    } catch (e2) { /* 单着失败跳过 */ }
  }
  return out;
}
// 注意: Generator 需要 board; 引擎暴露 legalMovesList; 这里直接用引擎封装
function legalMoves(engine, color) {
  return engine.generateLegalMoves(color);
}
// 免费吃 (走引擎封装): 试走后对手能否吃回
function freeCapturesViaEngine(engine, color) {
  const out = [];
  const legal = engine.generateLegalMoves(color);
  for (const m of legal) {
    if (!m.captured) continue;
    const tv = VAL[m.captured.type] || 0;
    if (tv < 1) continue;
    const fromN = XQ.Move.sqName(m.from), toN = XQ.Move.sqName(m.to);
    const probe = newEngine();
    // 复制到当前局面: 用 replayFrom 缓存太贵 — 改用 clone 思路: 直接在当前 engine 上 apply 再 undo
    const r = engine.applyPlayerMove(m.from.x, m.from.y, m.to.x, m.to.y);
    if (!r.ok) continue;
    const replies = engine.generateLegalMoves(opp(color));
    let recapture = 0;
    for (const rp of replies) {
      if (rp.captured && rp.to.x === m.to.x && rp.to.y === m.to.y) recapture = Math.max(recapture, VAL[rp.captured.type] || 0);
    }
    engine.undoPly ? engine.undoPly() : engine.undoMove(r.move);
    const net = tv - recapture;
    if (net >= 0.5) out.push({ val: net, raw: tv, from: fromN, to: toN, target: m.captured.type, by: m.piece.type });
  }
  return out;
}

// v3.7: 检测循环封装为函数 (主流程与 --selftest 共用)
function detect(record) {
const issues = [];
const engine = newEngine();
const moves = record.moves;
const openingChecked = {};   // v3.7 开局三任务: 每方只查一次 (各自第 8 步)

for (let i = 0; i < moves.length; i++) {
  const rec = moves[i];
  const side = rec.side;
  const mover = side;
  // ── 走之前: 该方有没有免费大子可吃而没吃 ──
  const free = freeCapturesViaEngine(engine, mover);
  // ── 走之前: 盘面上有没有一步绝杀没走 (v1.7.9) ──
  const mates = mateMoves(engine, mover);
  if (mates.length && !(mates.some(mv => mv.from === rec.from && mv.to === rec.to))) {
    const m0 = mates[0];
    issues.push({ ply: rec.n, side, type: '错失必杀', detail: `有绝杀着法 ${cn[mover][m0.piece] || m0.piece} ${m0.from}-${m0.to} 未走 (共${mates.length}个杀着), 实走 ${rec.from}-${rec.to}` });
  }
  const bestFree = free.length ? Math.max(...free.map(f => f.val)) : 0;
  const playedCaptureVal = rec.captured ? VAL[rec.captured] : 0;
  // 实际走法是否就是某个 free capture (允许最优)
  const playedF = XQ.Move.parseSq(rec.from), playedT = XQ.Move.parseSq(rec.to);
  const playedIsBestFree = free.some(f => f.from === rec.from && f.to === rec.to);
  if (bestFree >= 4 && !playedIsBestFree && playedCaptureVal < bestFree - 1.5) {
    const bf = free.find(f => f.val === bestFree);
    issues.push({ ply: rec.n, side, type: '漏吃', detail: `有免费${cn[side][bf.target] || bf.target}可吃 (${bf.from}-${bf.to}, 净赚${bf.val}) 却走 ${rec.from}-${rec.to}${rec.captured ? '吃' + rec.captured : ''}` });
  }
  // ── 执行走法 ──
  const f = XQ.Move.parseSq(rec.from), t = XQ.Move.parseSq(rec.to);
  const r = engine.applyPlayerMove(f.x, f.y, t.x, t.y);
  if (!r.ok) { issues.push({ ply: rec.n, side, type: '非法', detail: rec.from + '-' + rec.to }); continue; }
  const movedPiece = r.move.piece.type;
  const movedVal = VAL[movedPiece];
  // ── v3.2 窝心马: 马入己方九宫中心 (自堵帅/将, 与评价层 v2.5 窝心马惩罚同源) ──
  if (movedPiece === 'knight' && t.x === 4 && ((mover === 'red' && t.y === 8) || (mover === 'black' && t.y === 1))) {
    issues.push({ ply: rec.n, side, type: '窝心马', detail: `马入九宫中心 ${rec.from}-${rec.to} (自堵帅/将位), 宜尽早跳出` });
  }
  // ── 走之后: 对手能吃我刚走的子吗 (无根亏换/送吃) ──
  const replies = engine.generateLegalMoves(opp(mover));
  let attackerVal = 0, attackerType = '';
  for (const rp of replies) {
    if (rp.captured && rp.to.x === t.x && rp.to.y === t.y) {
      const v = VAL[rp.captured.type] || 0;
      if (v > attackerVal) { attackerVal = v; attackerType = rp.captured.type; }
    }
  }
  if (attackerVal > 0) {
    // 我能否吃回? v3.4 修复: 先落对方吃子再算吃回 — 此前己方子仍占落点 → 换回恒 0 → 有保护/可反吃也误判送吃, 历史报告全部高报 (与 guardHanging v2.2 同源 bug)
    let worstNet = 0, worstBy = attackerType, worstRecap = 0;
    const attCaps = replies.filter(rp => rp.captured && rp.to.x === t.x && rp.to.y === t.y);
    for (const rp of attCaps) {
      const rA = engine.applyPlayerMove(rp.from.x, rp.from.y, rp.to.x, rp.to.y);
      if (!rA.ok) continue;
      const myNow = engine.generateLegalMoves(mover);
      let gain = 0;
      for (const rm of myNow) {
        if (rm.captured && rm.to.x === t.x && rm.to.y === t.y) gain = Math.max(gain, VAL[rm.captured.type] || 0);
      }
      engine.undoPly();
      const net = playedCaptureVal + gain - movedVal;   // 我方净账: 吃X + 吃回攻击子 - 丢移动子
      if (net < worstNet) { worstNet = net; worstBy = rp.piece.type; worstRecap = gain; }
    }
    if (worstNet <= -0.5) {
      issues.push({ ply: rec.n, side, type: movedVal >= 3.5 ? (worstNet <= -3.5 ? '送吃大子' : '亏换大子') : '送兵', detail: `${cn[mover][movedPiece]}(${movedVal}) 走到 ${rec.to} 会被${cn[opp(mover)][worstBy]}(${VAL[worstBy] || attackerVal})吃, 换回${worstRecap || 0} → 净亏${(-worstNet).toFixed(1)}` });
    }
  }
  // ── 对手有无免费大子 (我方漏保护) ──
  const oppFree = freeCapturesViaEngine(engine, opp(mover));
  const big = oppFree.filter(f2 => f2.raw >= 4);
  if (big.length) {
    const b0 = big[0];
    issues.push({ ply: rec.n + 1, side: opp(mover), type: '对方免费吃', detail: `${side}走完留下: ${opp(mover)}可用${cn[opp(mover)][b0.by] || b0.by}免费吃${b0.target} (${b0.from}-${b0.to}, 净赚${b0.val})` });
  }
  // ── 来回拉锯: 同子 from→to→from ──
  if (i >= 2) {
    const p2 = moves[i - 2];
    if (p2.side === side && p2.from === rec.to && p2.to === rec.from) {
      issues.push({ ply: rec.n, side, type: '拉锯', detail: `${cn[mover][movedPiece]} ${p2.from}-${p2.to}-${rec.from} 来回走 (2回合内)` });
    }
  }
  // ── v3.7 开局三任务检测: 各自第 8 步 (红=第15手, 黑=第16手) 前须完成 架中炮/上正马两匹/挺兵开马脚 (v3.1 三任务制) ──
  const openDeadline = side === 'red' ? 15 : 16;
  if (rec.n >= openDeadline && !openingChecked[side]) {
    openingChecked[side] = true;
    const ot = openingTaskState(engine, side);
    const missing = [];
    if (!ot.cannon) missing.push('未架中炮');
    if (ot.homeKnights > 0) missing.push('正马未出齐 (原位还' + ot.homeKnights + '匹)');
    if (!ot.pawnAdvanced) missing.push('未挺兵开马脚');
    if (missing.length) issues.push({ ply: rec.n, side, type: '开局任务', detail: '八步内三任务未完成: ' + missing.join('、') });
  }
  // ── v3.9.2 长将检测: 分析器 ruleEnforce:false 不重判, 旧棋谱的连续将军 (≥4 警告 / =6 长将判负)
  //     engine.checkStreak 取本手走完后"对方"被将军的连续计数 (本手执子方, 跑完 toPly 后对方被将 = 己方连续将军+1)
  const streak = engine.checkStreak(mover) || 0;
  if (streak === 4) {
    issues.push({ ply: rec.n, side, type: '长将', detail: `${cn[mover][movedPiece]} 连续将军已 4 手 (≥4 警告), 离长将判负仅差 2 手, 须立即变招` });
  } else if (streak === 6) {
    issues.push({ ply: rec.n, side, type: '长将', detail: `${cn[mover][movedPiece]} 连续将军达 6 手 — 长将判负触发 (引擎规则闭环, 仅在 ruleEnforce 开时终局)` });
  }
}
return issues;
}

// v3.7: 主流程 (--selftest 模式跳过, selftest 在文件尾自行调用 detect)
if (!SELF) {
const issuesAll = detect(record);
// v3.9a: --top=N 截取前 N 条; --type=送吃,漏吃 按类型前缀过滤 (报告层参数化, 检测逻辑不动)
const argStr = process.argv.slice(2).join(' ');
const topM = /--top=(\d+)/.exec(argStr);
const typeM = /--type=([^\s]+)/.exec(argStr);
let issues = issuesAll;
if (typeM) { const ts = typeM[1].split(','); issues = issues.filter(x => ts.some(t2 => x.type.indexOf(t2) === 0)); }
if (topM) issues = issues.slice(0, parseInt(topM[1], 10));
const capN = record.moves.filter(m => m.captured).length;
let report = `=== 瞎走检测: ${record.id} (${record.moves.length}手, 吃子${capN}) ===\n`;
report += issues.length ? issues.map(x => `#${String(x.ply).padStart(2, '0')} [${x.side === 'red' ? '红' : '黑'}][${x.type}] ${x.detail}`).join('\n') : '(未检出明显瞎走)';
var cntPrefix = (p2) => issues.filter(x => x.type.indexOf(p2) === 0).length;   // v3.3 修复: 送吃大子/亏换大子/送兵 此前未计入总计 (type 精确匹配漏掉子类型)
report += `\n\n总计: 送吃${cntPrefix('送吃') + cntPrefix('送兵')} 亏换${cntPrefix('亏换')} 漏吃${issues.filter(x => x.type === '漏吃').length} 对方免费吃${issues.filter(x => x.type === '对方免费吃').length} 拉锯${issues.filter(x => x.type === '拉锯').length} 错失必杀${issues.filter(x => x.type === '错失必杀').length} 窝心马${issues.filter(x => x.type === '窝心马').length} 开局任务${issues.filter(x => x.type === '开局任务').length} 长将${cntPrefix('长将')}`;
console.log(report);
if (/--json/.test(argStr)) console.log(JSON.stringify({ record: record.id, plies: record.moves.length, total: issues.length, issues: issues }, null, 2));   // 第36轮: --json 机器可读输出
if (OUT) fs.writeFileSync(path.join(ROOT, OUT), report, 'utf8');
}

// ── v3.7 --selftest: 开局三任务检测回归 (好坏两场景, 全程真实引擎校验合法性) ──
function runSelfTest() {
  let spass = 0, sfail = 0;
  const sok = (cond, name) => { if (cond) { spass++; console.log('  ✓ ' + name); } else { sfail++; console.log('  ✗ ' + name); } };
  const mk = (list) => list.map((m, i) => ({ n: i + 1, side: i % 2 === 0 ? 'red' : 'black', from: m[0], to: m[1] }));
  // 好开局: 8步内完成 中炮/双正马/挺兵 (车马炮各出动) → 不报开局任务
  const goodMoves = [
    ['h3', 'e3'], ['h8', 'e8'], ['b1', 'c3'], ['b10', 'c8'], ['g1', 'h3'], ['g10', 'h8'],
    ['c4', 'c5'], ['c7', 'c6'], ['a1', 'a2'], ['i10', 'i9'], ['a2', 'a1'], ['i9', 'i10'],
    ['i1', 'h1'], ['a10', 'a9'], ['h1', 'i1'], ['a9', 'a10']
  ];
  // 坏开局: 8步只动车炮来回 (不架中炮/不上马/不挺兵) → 红黑各报一次
  const badMoves = [
    ['h3', 'f3'], ['h8', 'f8'], ['f3', 'h3'], ['f8', 'h8'], ['h3', 'f3'], ['h8', 'f8'],
    ['f3', 'h3'], ['f8', 'h8'], ['a1', 'a2'], ['i10', 'i9'], ['a2', 'a1'], ['i9', 'i10'],
    ['a1', 'a3'], ['i10', 'i8'], ['a3', 'a1'], ['i8', 'i10']
  ];
  const g = detect({ moves: mk(goodMoves) });
  sok(g.filter(x => x.type === '开局任务').length === 0, '好开局 (中炮+双正马+挺兵) 不报开局任务 (v3.7)');
  const b = detect({ moves: mk(badMoves) });
  sok(b.filter(x => x.type === '开局任务').length === 2, '坏开局 (只动车炮) 红黑各报一次开局任务 (v3.7)');
  // v3.9.2 长将检测: 好/坏开局均无连将, 计数器为 0 (只验证总计行格式带长将字段, 不构造真连将局面需 boardFromText, 实战检测由 E12 引擎守)
  sok(g.filter(x => x.type === '长将').length === 0, '好开局不报长将 (零噪音)');
  sok(b.filter(x => x.type === '长将').length === 0, '坏开局不报长将 (零噪音, 未达 ≥4 阈值)');
  console.log(spass === 4 && sfail === 0 ? '\nselftest 全部通过 ✓' : '\nselftest 失败 ' + sfail + ' 项');
  process.exit(sfail ? 1 : 0);
}
if (SELF) runSelfTest();
