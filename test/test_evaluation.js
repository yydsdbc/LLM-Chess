/* test_evaluation.js — 阶段性知识模型单元测试
 * 覆盖: 阶段判断 / 动态子力价值 / PositionEvaluator 摘要 / prompt 注入
 * 运行: node test/test_evaluation.js
 */
'use strict';
const path = require('path');
const fs = require('fs');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');
for (const f of ['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js',
  'core/generator.js', 'core/judge.js', 'core/engine.js',
  'evaluation/xiangqi_knowledge.js', 'evaluation/position.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), { filename: f });
}
const XQ = globalThis.XQ;
const K = XQ.XiangqiKnowledge, PE = XQ.PositionEvaluator;

let pass = 0, fail = 0;
function ok(cond, name) {
  if (cond) { pass++; console.log('  ✓ ' + name); }
  else { fail++; console.log('  ✗ ' + name); }
}

// ── stub engine: 用自定义 cells + ply 驱动阶段判断 ──
function cellsFrom(engine) { return engine.snapshot().cells; }
function removePiece(cells, x, y) { cells[y][x] = null; }
function stubEngine(cells, ply) {
  return {
    ply: () => ply,
    snapshot: () => ({ cells: cells, turn: () => 'red', lastMove: null }),
    inCheck: () => false,
    cloneBoard: () => ({ get: (x, y) => cells[y][x] }),   // isSquareAttacked 只需 get
    generateLegalMoves: () => [],
    legalMoveStrings: () => '',
    boardText: () => ''
  };
}

(async function main() {
  console.log('== 阶段判断 ==');
  const e0 = XQ.Engine.create();
  ok(K.detectPhase(e0) === 'opening', '初始局面 → opening');
  {
    const c = cellsFrom(XQ.Engine.create());
    removePiece(c, 0, 9); removePiece(c, 8, 0);   // 双方各丢一车 (大子交换1次→10)
    ok(K.detectPhase(stubEngine(c, 5)) === 'opening', '第5回合+大子交换1次 → 仍 opening');
    ok(K.detectPhase(stubEngine(c, 12)) === 'opening', '第12手 (6回合, round≤8) → 仍 opening');
    ok(K.detectPhase(stubEngine(c, 20)) === 'middlegame', '第20手 (10回合>8) → middlegame');
  }
  {
    const c = cellsFrom(XQ.Engine.create());
    removePiece(c, 0, 9); removePiece(c, 8, 0); removePiece(c, 8, 9); removePiece(c, 0, 0);
    removePiece(c, 1, 9); removePiece(c, 7, 0);   // 双方各丢两车一马 → big=6
    ok(K.detectPhase(stubEngine(c, 30)) === 'middlegame', 'big=6 → middlegame');
    removePiece(c, 7, 9); removePiece(c, 1, 0);   // 双方各丢一马 → big=4
    ok(K.detectPhase(stubEngine(c, 40)) === 'endgame', 'big=4 → endgame');
  }
  {
    const c = cellsFrom(XQ.Engine.create());
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
      const p = c[y][x];
      if (p && p.type !== 'pawn' && p.type !== 'king' && p.type !== 'rook') c[y][x] = null;
      if (p && p.type === 'rook' && (x > 0)) c[y][x] = null;   // 只留双车
    }
    ok(K.detectPhase(stubEngine(c, 60)) === 'endgame', '残局子力枯竭 → endgame');
  }

  console.log('== 动态子力价值 ==');
  ok(K.pieceValue('rook', 'opening') === 990, '开局车 900×1.1=990 (最高优先进攻子)');
  ok(K.pieceValue('knight', 'opening') === 360, '开局马 400×0.9=360 (需好位置, 降权)');
  ok(K.pieceValue('advisor', 'opening') === 180, '开局仕 200×0.9=180 (防守不轻动)');
  ok(K.pieceValue('knight', 'endgame') === 500, '残局马 400×1.25=500 (机动性增值)');
  ok(K.pieceValue('cannon', 'endgame') === 383, '残局炮 450×0.85=383 (缺炮架贬值)');
  ok(K.pieceValue('bishop', 'endgame') === 240, '残局相 200×1.2=240 (护帅增值)');
  ok(K.pieceValue('pawn', 'middlegame', { crossedRiver: false }) === 100, '未过河兵 100');
  ok(K.pieceValue('pawn', 'middlegame', { crossedRiver: true }) === 150, '过河兵 150');
  ok(K.pieceValue('pawn', 'endgame', { crossedRiver: true }) === 195, '残局过河兵 130×1.5=195 (兵线优势)');
  ok(K.pieceValue('pawn', 'middlegame', { crossedRiver: true, lastRank: true }) === 105, '过河底线兵 150×0.7=105 (v2.3 老兵贬值)');
  ok(K.pieceValue('pawn', 'endgame', { crossedRiver: true, lastRank: true }) === 137, '残局过河底线兵 195×0.7=137 (v2.3 老兵贬值)');
  ok(K.pieceValue('knight', 'endgame') > K.pieceValue('cannon', 'endgame'), '残局马 > 残局炮');
  ok(K.pieceValue('knight', 'endgame') > K.pieceValue('knight', 'opening'), '马: 残局 > 开局');
  ok(K.pieceValue('cannon', 'endgame') < K.pieceValue('cannon', 'middlegame'), '炮: 残局 < 中局');

  console.log('== PositionEvaluator 摘要 ==');
  {
    const s = PE.summarize(XQ.Engine.create(), 'red');
    ok(s.phase === 'opening', 'summarize.phase = opening (初始局面)');
    ok(typeof s.evaluation === 'string' && /^[+\-]?\d/.test(s.evaluation), 'evaluation 格式: "' + s.evaluation + '"');
    ok(Array.isArray(s.advantages) && s.advantages.length >= 1, 'advantages 非空 (' + s.advantages.length + '条)');
    ok(Array.isArray(s.risks) && s.risks.length >= 1, 'risks 非空 (' + s.risks.length + '条)');
    ok(/阶段: 开局/.test(s.text), 'text 含阶段行');
    ok(/局面评分/.test(s.text), 'text 含局面评分行');
    ok(/[\u4e00-\u9fa5]/.test(s.text), 'text 全中文摘要');
    ok(s.text.length < 600, 'text 简短 (<600字, 实测' + s.text.length + ') — 不发复杂计算');
    ok(/合法着法数/.test(s.text), 'text 保留合法着法数 (引擎硬信息)');
  }
  {
    // 走几步真实着法看摘要变化 (中炮 vs 屏风马)
    // 真实中炮开局序列: 炮二平五 / 马8进7 / 马二进三 / 车9平8 / 车一平二 / 卒3进1
    const e = XQ.Engine.create();
    const seq = [[7, 7, 4, 7], [7, 0, 6, 2], [7, 9, 6, 7], [8, 3, 8, 4], [2, 6, 2, 5], [2, 3, 2, 4]];
    for (const [fx, fy, tx, ty] of seq) e.applyPlayerMove(fx, fy, tx, ty);
    const s = PE.summarize(e, 'black');
    ok(!!s.phase && ['opening', 'middlegame', 'endgame'].includes(s.phase), '对局6手后 phase=' + s.phase);
    ok(/第3回合/.test(s.text), 'text 含回合数 (第3回合)');
  }
  {
    // 残局 stub: summarize 在子力枯竭时给出正确阶段
    const c = cellsFrom(XQ.Engine.create());
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
      const p = c[y][x];
      if (p && p.type !== 'pawn' && p.type !== 'king') c[y][x] = null;
    }
    c[0][4] = { color: 'black', type: 'king' };
    c[9][4] = { color: 'red', type: 'king' };
    c[5][0] = { color: 'red', type: 'pawn' };
    c[4][8] = { color: 'black', type: 'pawn' };
    const s = PE.summarize(stubEngine(c, 80), 'red');
    ok(s.phase === 'endgame', '残局 stub → phase=endgame');
    ok(/残局/.test(s.text), 'text 标示残局');
  }
  {
    // v1.8 士象完整性: 缺士象时摘要点名补防/攻九宫 (初始 4/4 不点名, 零噪音)
    const c = cellsFrom(XQ.Engine.create());
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
      const p = c[y][x];
      if (p && p.color === 'red' && (p.type === 'advisor' || p.type === 'bishop')) c[y][x] = null;
    }
    const sG = PE.summarize(stubEngine(c, 24), 'red');
    ok(/己方士象不全/.test(sG.text), '红方无仕相 → 摘要点名 己方士象不全 (v1.8 士象完整性)');
    ok(!/对方士象不全/.test(sG.text), '黑方士象齐 → 不误报 对方士象不全 (零噪音)');
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
      const p = c[y][x];
      if (p && p.color === 'black' && (p.type === 'advisor' || p.type === 'bishop')) c[y][x] = null;
    }
    const sG2 = PE.summarize(stubEngine(c, 24), 'red');
    ok(/对方士象不全/.test(sG2.text), '黑方也无士象 → 摘要追加 对方士象不全 (攻九宫提示)');
  }
  {
    // v2.3 底线老兵: 己方兵到底线 → 摘要点名勿再拱 (零噪音: 初始局无底线兵不提)
    const cP = cellsFrom(XQ.Engine.create());
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
      const p = cP[y][x];
      if (p && p.type !== 'pawn' && p.type !== 'king') cP[y][x] = null;
    }
    cP[0][0] = { color: 'red', type: 'pawn' }; cP[6][0] = null;   // 红兵 a4 推到底线 a10
    const sP = PE.summarize(stubEngine(cP, 60), 'red');
    ok(/底线兵已成老兵/.test(sP.text), '红兵到底线 → 摘要点名 老兵勿再拱 (v2.3)');
    ok(!/老兵/.test(PE.summarize(XQ.Engine.create(), 'red').text), '初始局无底线兵 → 不提老兵 (零噪音)');
  }
  {
    // v2.4 空头炮: 对方炮与己将同列且中间零隔子 → 风险/优势点名; 有隔子不误报 (零噪音)
    const cC = cellsFrom(XQ.Engine.create());
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
      const p = cC[y][x];
      if (p && p.type !== 'king') cC[y][x] = null;
    }
    cC[0][4] = { color: 'black', type: 'king' };
    cC[9][4] = { color: 'red', type: 'king' };
    cC[3][4] = { color: 'black', type: 'cannon' };   // 黑炮与红帅同列 (列e), 中间全空
    const sC = PE.summarize(stubEngine(cC, 20), 'red');
    ok(/空头炮/.test(sC.risks.join(';')), '黑炮零隔子对红帅 → 风险点名 空头炮 (v2.4)');
    const sC2 = PE.summarize(stubEngine(cC, 20), 'black');
    ok(/空头炮/.test(sC2.advantages.join(';')), '同局面黑方视角 → 优势点名 空头炮 (v2.4)');
    cC[6][4] = { color: 'red', type: 'pawn' };   // 垫一子 → 有隔子
    const sC3 = PE.summarize(stubEngine(cC, 20), 'red');
    ok(!/空头炮/.test(sC3.text), '有隔子 → 不误报空头炮 (零噪音)');
    ok(!/空头炮/.test(PE.summarize(XQ.Engine.create(), 'red').text), '初始局面 → 不提空头炮 (零噪音)');
  }

  {
    // v2.5 窝心马: 马入九宫中心 (红e2/黑e9) → 风险/优势点名; 初始局不提 (零噪音)
    const cH = cellsFrom(XQ.Engine.create());
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
      const p = cH[y][x];
      if (p && p.type !== 'king') cH[y][x] = null;
    }
    cH[0][4] = { color: 'black', type: 'king' };
    cH[9][4] = { color: 'red', type: 'king' };
    cH[1][4] = { color: 'black', type: 'knight' };   // 黑马入宫心 e9
    ok(/窝心马/.test(PE.summarize(stubEngine(cH, 20), 'red').advantages.join(';')), '黑马入宫心 → 红方视角优势点名 对方窝心马受困 (v2.5)');
    ok(/窝心马/.test(PE.summarize(stubEngine(cH, 20), 'black').risks.join(';')), '己方窝心马 → 黑方视角风险点名 窝心马 (v2.5)');
    cH[1][4] = null;
    cH[8][4] = { color: 'red', type: 'knight' };   // 红马入宫心 e2
    ok(/窝心马/.test(PE.summarize(stubEngine(cH, 20), 'black').advantages.join(';')), '红马入宫心 → 黑方视角优势点名 (v2.5)');
    ok(!/窝心马/.test(PE.summarize(XQ.Engine.create(), 'red').text), '初始局面 → 不提窝心马 (零噪音)');
  }

  {
    // v2.5b 中炮矄中卒: 己方炮与对方中兵同列且恰一隔子 → 攻方提醒勿轻打 / 守方提醒护卒; 初始局与无隔子不提 (零噪音)
    const cA = cellsFrom(XQ.Engine.create());
    for (let y = 0; y < 10; y++) for (let x = 0; x < 9; x++) {
      const p = cA[y][x];
      if (p && p.type !== 'king') cA[y][x] = null;
    }
    cA[0][4] = { color: 'black', type: 'king' };
    cA[9][4] = { color: 'red', type: 'king' };
    cA[3][4] = { color: 'black', type: 'pawn' };   // 黑中卒 e7
    cA[7][4] = { color: 'red', type: 'cannon' };   // 红中炮 e3
    cA[6][4] = { color: 'red', type: 'pawn' };     // 炮架 e4 (恰一隔子)
    ok(/中炮矄住/.test(PE.summarize(stubEngine(cA, 20), 'red').advantages.join(';')), '红中炮矄中卒 → 红方视角提醒勿轻打 (v2.5b)');
    ok(/中兵被对方中炮矄住/.test(PE.summarize(stubEngine(cA, 20), 'black').risks.join(';')), '中卒被矄 → 黑方视角提醒护卒 (v2.5b)');
    cA[6][4] = null;   // 无隔子 (screens=0) → 不算矄
    ok(!/中炮矄住/.test(PE.summarize(stubEngine(cA, 20), 'red').text), '无隔子 → 不点名 (零噪音)');
    ok(!/中炮矄住/.test(PE.summarize(XQ.Engine.create(), 'red').text), '初始局面 → 不点名 (零噪音)');
  }

  {
    // v3.7 将门/肋道控制: 己方大子压对方将门线 (x=3/5, d/f 路) → 攻方点名可谋杀势 / 守方点名九宫吃紧; 初始局零噪音
    const cF = cellsFrom(XQ.Engine.create());
    cF[9][0] = null;              // 移走红车原位 a1
    cF[4][3] = { color: 'red', type: 'rook' };   // 红车压黑方将门 d5 (x=3, y=4)
    ok(/压对方将门/.test(PE.summarize(stubEngine(cF, 40), 'red').advantages.join(';')), '红车压黑将门 → 红方优势点名 (v3.7)');
    ok(/压你方将门/.test(PE.summarize(stubEngine(cF, 40), 'black').risks.join(';')), '红车压黑将门 → 黑方风险点名 (v3.7)');
    ok(!/将门/.test(PE.summarize(XQ.Engine.create(), 'red').text), '初始局面 → 不提将门 (零噪音)');
  }

  {
    // v3.8 兵临九宫: 过河兵入对方九宫区域 (非底线) → 子力增值 + 双向摘要点名; 底线老兵不重复点名; 初始局零噪音
    ok(K.pieceValue('pawn', 'endgame', { crossedRiver: true, deepPalace: true }) === 234, '残局兵临九宫 195×1.2=234 (v3.8 兵线冲击最强点)');
    ok(K.pieceValue('pawn', 'middlegame', { crossedRiver: true, deepPalace: true }) === 180, '中局兵临九宫 150×1.2=180 (v3.8)');
    ok(K.pieceValue('pawn', 'middlegame', { crossedRiver: true }) === 150, '仅过河不增值 (无 deepPalace 标志)');
    const cD = cellsFrom(XQ.Engine.create());
    cD[6][4] = null;              // 红中兵离位 e7
    cD[1][4] = { color: 'red', type: 'pawn' };   // 红兵 e9: 已入黑九宫 (y1, 非底线)
    ok(/逼入对方九宫/.test(PE.summarize(stubEngine(cD, 30), 'red').advantages.join(';')), '红兵入黑九宫 → 红方优势点名 (v3.8)');
    ok(/逼入你方九宫/.test(PE.summarize(stubEngine(cD, 30), 'black').risks.join(';')), '红兵入黑九宫 → 黑方风险点名 (v3.8)');
    ok(!/逼入/.test(PE.summarize(XQ.Engine.create(), 'red').text), '初始局面 → 不提兵临九宫 (零噪音)');
    const cE = cellsFrom(XQ.Engine.create());
    cE[6][4] = null;
    cE[0][4] = { color: 'red', type: 'pawn' };   // 红兵 e10: 底线老兵 (归 v2.3 老兵贬值管, 不吃兵临九宫增值)
    ok(!/逼入对方九宫/.test(PE.summarize(stubEngine(cE, 30), 'red').text), '底线兵不重复点名兵临九宫 (v3.8 与老兵互斥)');
    ok(K.pieceValue('pawn', 'endgame', { crossedRiver: true, lastRank: true, deepPalace: true }) === 164, '底线+深宫同时传参时乘序 130×1.5×0.7×1.2=164 (调用方约定不并发, 防御性可算)');
  }

  {
    // v3.2 开局任务提醒: 初始局 → 提醒架中炮+上正马; 中炮架好后不再提醒 (零噪音)
    const sT = PE.summarize(stubEngine(cellsFrom(XQ.Engine.create()), 6), 'red');
    ok(/架中炮/.test(sT.advantages.join(';')), '初始局 → 开局任务提醒 架中炮 (v3.2)');
    ok(/上正马/.test(sT.advantages.join(';')), '初始局 → 开局任务提醒 上正马 (v3.2)');
    const cT = cellsFrom(XQ.Engine.create());
    cT[7][4] = { color: 'red', type: 'cannon' };   // 中炮已架 (e3)
    ok(!/架中炮/.test(PE.summarize(stubEngine(cT, 6), 'red').text), '中炮已架 → 不再提醒架中炮 (零噪音)');
    ok(!/出车/.test(sT.advantages.join(';')), '初始局任务未齐 → 不催出车 (v3.4 收紧)');
    const cR = cellsFrom(XQ.Engine.create());
    cR[7][4] = { color: 'red', type: 'cannon' };   // 中炮已架
    cR[9][1] = null; cR[9][7] = null;   // 双正马离位
    cR[7][2] = { color: 'red', type: 'knight' };   // 马 c3
    cR[7][6] = { color: 'red', type: 'knight' };   // 马 g3
    ok(/出车/.test(PE.summarize(stubEngine(cR, 10), 'red').advantages.join(';')), '三任务近完成 → 提醒出车 (v3.4)');
  }

  // v3.9 沉底炮: 己方炮沉对方底线两翼 (b10/h10) → 攻方优势点名 + 守方风险点名; 初始局零噪音
  {
    const cB = cellsFrom(XQ.Engine.create());
    cB[0][1] = XQ.Piece.create('red', 'cannon');   // 红炮落 b10 (黑方底线左翼, 原位黑马被替换)
    cB[2][1] = null;                                // 原炮位 b3 清空
    const sB = PE.summarize(stubEngine(cB, 24), 'red');
    ok(/沉底炮/.test(sB.advantages.join(';')), '红炮沉底 → 红方优势点名 沉底炮 (v3.9)');
    const sB2 = PE.summarize(stubEngine(cB, 24), 'black');
    ok(/沉底炮/.test(sB2.risks.join(';')), '对方沉底炮 → 黑方风险点名 (v3.9)');
    ok(!/沉底炮/.test(PE.summarize(XQ.Engine.create(), 'red').text), '初始局 → 不提沉底炮 (零噪音)');
  }

  console.log('== llm_agent prompt 注入 ==');
  {
    // 确认 systemPrompt 含评价原则(压缩行内联), user 含阶段摘要
    const src = fs.readFileSync(path.join(ROOT, 'ai/llm_agent.js'), 'utf8');
    ok(src.includes('## 中国象棋评价原则: 开局重出子与车炮主动'), 'systemPrompt 内联压缩版评价原则 (v1.5.1 快棋)');
    ok(src.includes('开局路线') && src.includes('架中炮') && src.includes('三任务') && src.includes('马脚') && src.includes('优先出车进攻'), 'systemPrompt 开局三任务 (v3.1 八步内架中炮/上马/挺兵开马脚, 任务完成后出车进攻)');
    ok(src.includes('开局核心(前八步适用, 中残局忽略本节; 马攻为主') && src.includes('先保中兵'), 'systemPrompt 含马攻核心+中兵保护 (锚点随 v3.1 八步任务制更新)');
    ok(src.includes('开局不要镜像'), 'systemPrompt 含反镜像指令 (v1.5.5)');
    ok(src.includes('mv.meta.reasoning = extractCN(out.reasoning'), 'llm_agent 把中文过滤后的 reasoning 挂到 mv.meta (v1.5.5)');
    ok(src.includes('禁止深度推演'), 'systemPrompt 快速决策约束 (v1.5.1)');
    ok(src.includes('XQ.PositionEvaluator.summarize'), 'situationText 委托 PositionEvaluator');
    ok(src.includes('rankTag') && src.includes('items.sort'), '合法列表排序: 杀/困→将→吃→普通→危/亏 (v3.7)');
    ok(src.includes('Math.floor(engine.ply() / 2) + 1'), 'HIST_CAP 裁剪后手数由引擎步数推导 (v3.7)');
    ok(src.includes('tagCache') && src.includes('tagCache[key]'), '合法列表标注跨 attempt 缓存 (v3.7 重试提速)');
    ok(src.includes('100% 简体中文') && src.includes('禁英文字符'), '语言约束加严 (100% 中文 + 禁止英文, v1.5.2, 锚点随 v1.5.11 措辞更新)');
  }

  console.log(fail ? '\n' + fail + ' FAILED' : '\n全部通过 ✓ (' + pass + ' 项)');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error('测试异常:', e); process.exit(1); });
