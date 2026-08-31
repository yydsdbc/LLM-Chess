/* evaluation/position.js — PositionEvaluator 局面评价器
 * 流水线: Board → Rules → PositionEvaluator → XiangqiKnowledge → 中文摘要 → LLM
 * 职责: 动态子力合计 / 子力活跃度 / 将帅安全 / 进攻压力 / 防守完整性 / 兵线优势
 * 输出: 面向 LLM 的简短中文摘要 (不发送复杂计算), 字段: phase / evaluation / advantages / risks / text
 * 浏览器与 node 双端可用 (挂 XQ.PositionEvaluator)
 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var K = XQ.XiangqiKnowledge;

  var BIG = { rook: 1, knight: 1, cannon: 1 };
  var NAMES = { rook: '车', knight: '马', cannon: '炮', bishop: '相', advisor: '仕', pawn: '兵', king: '帅' };

  function sq(x, y) { return XQ.Move.sqName({ x: x, y: y }); }
  function fmtPiece(p, x, y) { return NAMES[p.type] + '(' + sq(x, y) + ')'; }

  // ── 动态子力合计 (含过河兵增值/底线老兵贬值 v2.3) ──
  // v2.3 性能: 收 snapshot 参数 — 此前 material/openFileRooks/crossedPawns/guardCount 各自 engine.snapshot() (每次重建 90 格)
  function material(snap, color, phase) {
    var total = 0;
    for (var y = 0; y < 10; y++) {
      for (var x = 0; x < 9; x++) {
        var p = snap.cells[y][x];
        if (!p || p.color !== color) continue;
        total += K.pieceValue(p.type, phase, {
          crossedRiver: p.type === 'pawn' && XQ.Rules.crossedRiver(color, y),
          lastRank: p.type === 'pawn' && (color === 'red' ? y === 0 : y === 9),   // v2.3 底线老兵贬值
          deepPalace: p.type === 'pawn' && x >= 3 && x <= 5 && (color === 'red' ? (y >= 1 && y <= 2) : (y >= 7 && y <= 8))   // v3.8 兵临九宫 (入对方宫区 x3-5 且非底线: 红兵 y1-2, 黑卒 y7-8; y0/y9 底线归老兵贬值管)
        });
      }
    }
    return total;
  }

  // ── 子力活跃度: 大子 (车马炮) 合法着法数 (v2.3: 接收预生成合法列表, 免重复全盘生成) ──
  function mobility(legalMoves) {
    var n = 0;
    for (var i = 0; i < legalMoves.length; i++) if (BIG[legalMoves[i].piece.type]) n++;
    return n;
  }

  // ── 将帅安全: 九宫受攻击点数 (v2.4: 接收共享克隆盘, 免每次评价重复 cloneBoard) ──
  function palaceAttacks(b, color, byColor) {
    var y0 = color === 'red' ? 7 : 0, n = 0;
    for (var y = y0; y < y0 + 3; y++) {
      for (var x = 3; x <= 5; x++) {
        if (b.get(x, y) && b.get(x, y).type === 'king') continue;   // 将帅本身不计
        if (XQ.Rules.isSquareAttacked(b, x, y, byColor)) n++;
      }
    }
    return n;
  }

  // ── 受威胁己子列表 (≤4; v2.4: 接收共享克隆盘 + 预生成快照) ──
  function threatened(b, snap, color) {
    var opp = color === 'red' ? 'black' : 'red';
    var out = [];
    for (var y = 0; y < 10 && out.length < 4; y++) {
      for (var x = 0; x < 9 && out.length < 4; x++) {
        var p = snap.cells[y][x];
        if (!p || p.color !== color || p.type === 'king') continue;
        if (XQ.Rules.isSquareAttacked(b, x, y, opp)) out.push(fmtPiece(p, x, y));
      }
    }
    return out;
  }

  // ── 可吃子目标 (去重, ≤4; v2.3: 接收预生成合法列表) ──
  function captureTargets(legalMoves) {
    var seen = {}, out = [];
    for (var i = 0; i < legalMoves.length && out.length < 4; i++) {
      var c = legalMoves[i].captured;
      if (!c) continue;
      var k = c.color + ':' + c.type + ':' + XQ.Move.sqName(legalMoves[i].to);
      if (seen[k]) continue;
      seen[k] = 1;
      out.push(NAMES[c.type] + '(' + XQ.Move.sqName(legalMoves[i].to) + ')');
    }
    return out;
  }

  // ── 车是否占开放线 (该列除车外无其他子; v2.3: 收 snapshot 参数) ──
  function openFileRooks(snap, color) {
    var out = [];
    for (var y = 0; y < 10; y++) {
      for (var x = 0; x < 9; x++) {
        var p = snap.cells[y][x];
        if (!p || p.color !== color || p.type !== 'rook') continue;
        var blocked = false;
        for (var yy = 0; yy < 10; yy++) {
          if (yy === y) continue;
          if (snap.cells[yy][x]) { blocked = true; break; }   // 同列其它任何子都算阻挡
        }
        if (!blocked) out.push('车(' + sq(x, y) + ')占开放线路');
        if (out.length >= 2) return out;
      }
    }
    return out;
  }

  // ── 过河兵计数 (v2.3: 收 snapshot 参数) ──
  function crossedPawns(snap, color) {
    var n = 0;
    for (var y = 0; y < 10; y++) {
      for (var x = 0; x < 9; x++) {
        var p = snap.cells[y][x];
        if (p && p.color === color && p.type === 'pawn' && XQ.Rules.crossedRiver(color, y)) n++;
      }
    }
    return n;
  }

  // ── v1.8 士象完整计数 (仕+相 / 士+象, 满 4 为全; v2.3: 收 snapshot 参数) ──
  function guardCount(snap, color) {
    var n = 0;
    for (var y = 0; y < 10; y++) {
      for (var x = 0; x < 9; x++) {
        var p = snap.cells[y][x];
        if (p && p.color === color && (p.type === 'advisor' || p.type === 'bishop')) n++;
      }
    }
    return n;
  }

  // ── v2.3 底线老兵计数 (兵/卒到底线后只能横移, 攻击力大减 — "老兵") ──
  function lastRankPawns(snap, color) {
    var y = color === 'red' ? 0 : 9, n = 0;
    for (var x = 0; x < 9; x++) {
      var p = snap.cells[y][x];
      if (p && p.color === color && p.type === 'pawn') n++;
    }
    return n;
  }

  // ── v3.8 兵临九宫计数: 兵/卒已入对方九宫区域 (x3-5, 宫区行) 且非底线 — 威胁九宫, 配合大子可成杀 ──
  function deepPalacePawns(snap, color) {
    var y0 = color === 'red' ? 1 : 7;   // 红兵入黑宫 y1-2 (y0 已属底线老兵), 黑卒入红宫 y7-8 (y9 底线)
    var n = 0;
    for (var y = y0; y < y0 + 2; y++) {
      for (var x = 3; x <= 5; x++) {
        var p = snap.cells[y][x];
        if (p && p.color === color && p.type === 'pawn') n++;
      }
    }
    return n;
  }

  // ── v2.4 空头炮检测: 对方炮与己方将(帅)同列且中间零隔子 — 己方随手垫子即成炮架送将, 中路高压信号
  function faceCannon(snap, color) {
    var oC = color === 'red' ? 'black' : 'red';
    var kx = -1, ky = -1, x, y, p;
    for (y = 0; y < 10; y++) for (x = 0; x < 9; x++) {
      p = snap.cells[y][x];
      if (p && p.color === color && p.type === 'king') { kx = x; ky = y; }
    }
    if (kx < 0) return false;
    for (y = 0; y < 10; y++) {
      if (y === ky) continue;
      p = snap.cells[y][kx];
      if (!p || p.color !== oC || p.type !== 'cannon') continue;
      var screens = 0;
      for (var z = Math.min(y, ky) + 1; z < Math.max(y, ky); z++) if (snap.cells[z][kx]) screens++;
      if (screens === 0) return true;
    }
    return false;
  }

  // ── v2.5 窝心马检测: 马入己方九宫中心 (红e2/黑e9, 帅/将正前位) — 出路受限且自堵宫心, 宜尽早跳出
  function palaceHorse(snap, color) {
    var p = snap.cells[color === 'red' ? 8 : 1][4];   // y0=第10行: 黑宫心 e9 = y1, 红宫心 e2 = y8
    return !!(p && p.color === color && p.type === 'knight');
  }

  // ── v2.5b 中炮矄中卒检测: 己方炮与对方中兵同列 (x=4) 且中间恰一隔子 — 架中炮打中卒常被马反吃 (实战高频亏换, 仅提醒不评分)
  function centralAim(snap, color) {
    var oC = color === 'red' ? 'black' : 'red';
    var pawnY = -1;
    for (var y = 0; y < 10; y++) {
      var pw = snap.cells[y][4];
      if (pw && pw.color === oC && pw.type === 'pawn') { pawnY = y; break; }   // 中兵只能在中路 (兵卒不换列)
    }
    if (pawnY < 0) return false;
    for (var y2 = 0; y2 < 10; y2++) {
      if (y2 === pawnY) continue;
      var c = snap.cells[y2][4];
      if (!c || c.color !== color || c.type !== 'cannon') continue;
      var screens = 0;
      for (var z = Math.min(y2, pawnY) + 1; z < Math.max(y2, pawnY); z++) if (snap.cells[z][4]) screens++;
      if (screens === 1) return true;
    }
    return false;
  }

  // ── v3.2 开局任务进度检测: 中炮架了没 / 正马上齐了没 (仅开局阶段提示, 中残局零噪音) ──
  function ownCannonCentered(sn, col) {
    for (var y = 0; y < 10; y++) { var c = sn.cells[y][4]; if (c && c.color === col && c.type === 'cannon') return true; }
    return false;
  }
  function homeKnights(sn, col) {
    var homes = col === 'red' ? [[1, 9], [7, 9]] : [[1, 0], [7, 0]];   // y0=第10行
    var n = 0;
    for (var i = 0; i < homes.length; i++) { var p = sn.cells[homes[i][1]][homes[i][0]]; if (p && p.color === col && p.type === 'knight') n++; }
    return n;
  }

  // ── v3.7 将门(肋道)控制检测: 己方大子/过河兵占据对方将门线 (x=3/5 = d/f 路, 将帅活动要道) — 车占将门/双车错/铁门栓类杀势的前提, 仅点名不评分 (与 centralAim 同策略) ──
  function palaceFiles(snap, color) {
    var y0 = color === 'red' ? 0 : 5, y1 = color === 'red' ? 4 : 9;   // 对方半场 y 范围 (红攻黑: 0..4; 黑攻红: 5..9)
    var out = [];
    var seen = {};
    for (var y = y0; y <= y1; y++) {
      for (var xi = 0; xi < 2; xi++) {
        var x = xi === 0 ? 3 : 5;
        var p = snap.cells[y][x];
        if (!p || p.color !== color) continue;
        if (p.type !== 'rook' && p.type !== 'cannon' && p.type !== 'knight' && p.type !== 'pawn') continue;
        var k = x + ',' + y;
        if (seen[k]) continue;
        seen[k] = 1;
        out.push(NAMES[p.type] + '(' + sq(x, y) + ')');
        if (out.length >= 2) return out;
      }
    }
    return out;
  }

  // ── v3.9 沉底炮检测: 己方炮沉到对方底线两翼 (x=1/7, 炮二进七/炮八进七经典杀位) — 压制底线可成闷杀/底线杀势, 仅提醒不评分
  // (与将门 x=3/5、空头炮将帅同列、中炮 x=4 检测零重叠; 初始局炮在己方半场不触发) ──
  function bottomCannon(snap, color) {
    var yT = color === 'red' ? 0 : 9;   // 对方底线 (y0=第10行黑方底线 / y9=第1行红方底线)
    var out = [];
    var xs = [1, 7];
    for (var i = 0; i < xs.length; i++) {
      var p = snap.cells[yT][xs[i]];
      if (p && p.color === color && p.type === 'cannon') out.push(sq(xs[i], yT));
    }
    return out;
  }

  // ── v3.9.2 槽心马/挂角马检测: 己方马已逼近对方宫城区 (x=1/2/6/7, y=对方宫城行 ±1), 可成「卧槽/挂角」杀势前奏 — 经典攻王位 (与窝心马 v2.5 x=4 宫心位互斥, 与沉底炮/将门/空头炮零重叠; 初始局马在己方半场不触发; 仅提醒不评分)
  //   槽心马 (wòcāo mǎ, litter-horse): 马位于 x∈{1,7}, 紧贴对方宫城侧翼, 可借象田跳入九宫 (老式叫法含 x∈{2,6}; 合并入挂角马)
  //   挂角马 (guàjiǎo mǎ, cornered-horse): 马位于 x∈{2,6}, y=对方宫城次行, 可从角位挂将
  function attackHorse(snap, color) {
    var opp = color === 'red' ? 'black' : 'red';
    var yT = color === 'red' ? 1 : 8;   // 对方宫城次行: 攻击黑用 y=1 (黑宫 0-2), 攻击红用 y=8 (红宫 7-9)
    var yTop = color === 'red' ? 2 : 7;   // 对方宫城顶行 (包含底线次行)
    var out = [];
    var xs = [1, 2, 6, 7];   // 四个侧翼位, 排除 x=3/5 仕相步
    for (var i = 0; i < xs.length; i++) {
      // 检查 y∈[yT..yTop] 范围 (黑方宫城行 0-2, 攻击位 1-2 含底线; 红方宫城行 7-9, 攻击位 7-8)
      for (var y = Math.min(yT, yTop); y <= Math.max(yT, yTop); y++) {
        var p = snap.cells[y][xs[i]];
        if (p && p.color === color && p.type === 'knight') { out.push(sq(xs[i], y)); break; }   // 同一列只报告首个, 避免多匹重复点
      }
    }
    return out;
  }

  // ── 综合评价 (数值仅供摘要归一, 不直接发给 LLM) ──
  // v2.3 性能: snapshot 与双方合法着法只算一次, 全管线复用 — 此前一次评价共 4 次 generateLegalMoves + 6 次 snapshot (重复全盘扫描)
  function evaluate(engine, side) {
    var opp = side === 'red' ? 'black' : 'red';
    var phase = K.detectPhase(engine);
    var round = Math.ceil(engine.ply() / 2);
    var snap = engine.snapshot();
    var legalMine = engine.generateLegalMoves(side), legalTheirs = engine.generateLegalMoves(opp);
    var bView = engine.cloneBoard();   // v2.4 性能: 一次克隆供宫攻/受威胁四项共享 (此前各克隆一次, 4→1)
    var matM = material(snap, side, phase), matT = material(snap, opp, phase);
    var mobM = mobility(legalMine), mobT = mobility(legalTheirs);
    var palaceM = palaceAttacks(bView, side, opp), palaceT = palaceAttacks(bView, opp, side);
    var thM = threatened(bView, snap, side), thT = threatened(bView, snap, opp);
    var pawnM = crossedPawns(snap, side), pawnT = crossedPawns(snap, opp);
    var guardM = guardCount(snap, side), guardT = guardCount(snap, opp);   // v1.8 士象完整度
    var lastM = lastRankPawns(snap, side);   // v2.3 底线老兵 (仅己方点名, 对方的不值得占摘要位)
    var deepM = deepPalacePawns(snap, side), deepT = deepPalacePawns(snap, opp);   // v3.8 兵临九宫 (双向点名)
    var faceM = faceCannon(snap, side), faceT = faceCannon(snap, opp);   // v2.4 空头炮
    var pHM = palaceHorse(snap, side), pHT = palaceHorse(snap, opp);   // v2.5 窝心马
    var aimM = centralAim(snap, side), aimT = centralAim(snap, opp);   // v2.5b 中炮矄中卒 (仅提醒不评分)
    var pfM = palaceFiles(snap, side), pfT = palaceFiles(snap, opp);   // v3.7 将门/肋道控制 (仅点名不评分)
    var bcM = bottomCannon(snap, side), bcT = bottomCannon(snap, opp);   // v3.9 沉底炮 (仅提醒不评分)
    var atkM = attackHorse(snap, side), atkT = attackHorse(snap, opp);   // v3.9.2 槽心马/挂角马 (仅提醒不评分)
    var taskCannon = ownCannonCentered(snap, side), taskHome = homeKnights(snap, side);   // v3.2 开局任务进度
    var taskHomeRooks = 0;   // v3.3 出车任务: 己方车在原位计数
    var rhH = side === 'red' ? [[0, 9], [8, 9]] : [[0, 0], [8, 0]];
    for (var ri = 0; ri < rhH.length; ri++) { var rp2 = snap.cells[rhH[ri][1]][rhH[ri][0]]; if (rp2 && rp2.color === side && rp2.type === 'rook') taskHomeRooks++; }

    var score = (matM - matT) / 100
      + (mobM - mobT) * 0.04
      + (pawnM - pawnT) * 0.18
      + (palaceT - palaceM) * 0.12
      - thM.length * 0.10 + thT.length * 0.10
      + (guardM - guardT) * 0.08   // v1.8 士象完整度 (缺仕相 = 防御缺口)
      + (pHT - pHM) * 0.15;   // v2.5 窝心马 (己方宫心自堵扣分, 对方受困加分)

    return {
      phase: phase, round: round,
      materialDiff: matM - matT,
      mobilityDiff: mobM - mobT,
      crossedDiff: pawnM - pawnT,
      guardMine: guardM, guardTheirs: guardT,   // v1.8 士象完整度
      lastRankMine: lastM,   // v2.3 底线老兵
      deepPalaceMine: deepM, deepPalaceTheirs: deepT,   // v3.8 兵临九宫
      faceCannonMine: faceM, faceCannonTheirs: faceT,   // v2.4 空头炮
      palaceHorseMine: pHM, palaceHorseTheirs: pHT,   // v2.5 窝心马
      centralAimMine: aimM, centralAimTheirs: aimT,   // v2.5b 中炮矄中卒
      palaceFileMine: pfM, palaceFileTheirs: pfT,   // v3.7 将门/肋道控制
      bottomCannonMine: bcM, bottomCannonTheirs: bcT,   // v3.9 沉底炮
      attackHorseMine: atkM, attackHorseTheirs: atkT,   // v3.9.2 槽心马/挂角马
      taskCannon: taskCannon, taskHomeKnights: taskHome,   // v3.2 开局任务进度
      taskHomeRooks: taskHomeRooks,   // v3.3 出车任务
      palaceUnderAttack: palaceM,
      palacePressure: palaceT,
      threatenedMine: thM, threatenedTheirs: thT,
      captures: captureTargets(legalMine),
      inCheck: engine.inCheck(side),
      openFiles: openFileRooks(snap, side),
      legalCount: legalMine.length,   // v2.3: summarize 复用, 免第 4 次全盘生成
      score: Math.round(score * 10) / 10
    };
  }

  // ── 摘要生成 (简短中文, 直接注入 prompt) ──
  function summarize(engine, side) {
    var e = evaluate(engine, side);
    var s = e.score;
    var youLose = s < 0;
    var abs = Math.abs(s);
    var evalStr = (s > 0 ? '+' : '') + s.toFixed(1) + ' '
      + (abs >= 2 ? (youLose ? '对方大优' : '你方大优')
        : abs >= 0.8 ? (youLose ? '对方占优' : '你方占优')
        : abs >= 0.25 ? (youLose ? '对方略优' : '你方略优')
        : '大致均势');

    var adv = [], risk = [];
    if (e.materialDiff >= 150) adv.push('动态子力领先');
    else if (e.materialDiff <= -150) risk.push('子力落后, 避免轻易兑子');
    if (e.mobilityDiff >= 4) adv.push('大子出动更活跃 (可行着法多' + e.mobilityDiff + '步)');
    else if (e.mobilityDiff <= -4 && e.phase === 'opening') risk.push('出子偏慢, 优先开动车马炮');
    e.openFiles.forEach(function (t) { adv.push(t); });
    if (e.crossedDiff >= 1) adv.push('过河兵占优, 兵线有冲击力');
    else if (e.crossedDiff <= -2) risk.push('对方兵已过河, 警惕兵线渗透');
    if (e.palacePressure >= 2) adv.push('已对对方九宫形成攻击压力');
    e.threatenedTheirs.slice(0, 2).forEach(function (t) { adv.push('对方' + t + '暴露在攻击范围内'); });
    if (e.inCheck) risk.push('正被将军, 必须优先应将');
    if (e.palaceUnderAttack >= 2) risk.push('己方九宫受侵扰, 防守需加固');
    e.threatenedMine.slice(0, 2).forEach(function (t) { risk.push(t + '受威胁, 注意保护或兑走'); });
    if (e.guardMine < 4) risk.push('己方士象不全, 优先补防慎兑士象');   // v1.8 士象完整性 (满4不点名, 零噪音)
    if (e.guardTheirs < 4) adv.push('对方士象不全, 可伺机攻九宫');
    if (e.faceCannonMine) risk.push('对方空头炮直指你方将帅, 中路无遮拦, 勿随手垫子');   // v2.4 空头炮 (零屏才点名)
    if (e.faceCannonTheirs) adv.push('你方空头炮压住对方九宫, 对方垫子即成炮架');   // v2.4
    if (e.palaceHorseMine) risk.push('窝心马自堵九宫 (马在帅/将正前位), 宜尽早跳出调整');   // v2.5 窝心马 (零噪音)
    if (e.palaceHorseTheirs) adv.push('对方窝心马受困宫心, 可寻机围攻九宫');   // v2.5
    if (e.centralAimMine) adv.push('你方中炮矄住对方中兵, 但勿轻打: 打卒落点常被马/车反吃, 先跃马成势再图');   // v2.5b (仅提醒不评分)
    if (e.centralAimTheirs) risk.push('己方中兵被对方中炮矄住, 勿随手送架, 可跃马护卒或兑卒解脱');   // v2.5b
    if (e.palaceFileMine.length) adv.push('己方' + e.palaceFileMine.join('、') + '压对方将门 (d/f 线), 将帅受制, 可谋划杀势');   // v3.7
    if (e.palaceFileTheirs.length) risk.push('对方' + e.palaceFileTheirs.join('、') + '压你方将门, 九宫侧翼吃紧, 先驱赶或封堵');   // v3.7
    if (e.bottomCannonMine.length) adv.push('己方沉底炮(' + e.bottomCannonMine.join('、') + ')压对方底线, 勿轻易撤回, 可配合车/马谋底线杀势');   // v3.9 沉底炮 (零噪音)
    if (e.bottomCannonTheirs.length) risk.push('对方沉底炮(' + e.bottomCannonTheirs.join('、') + ')压你方底线, 警惕底线闷杀, 可兑走或驱赶');   // v3.9
    if (e.attackHorseMine.length) adv.push('己方马(' + e.attackHorseMine.join('、') + ')逼近对方九宫, 己成槽心/挂角位, 可跴将/抽车取势, 护住马眼勿轻兑');   // v3.9.2 槽心马/挂角马 (零噪音, 与窝心马 v2.5 x=4 宫心互斥)
    if (e.attackHorseTheirs.length) risk.push('对方马(' + e.attackHorseTheirs.join('、') + ')逼近你方九宫, 可走槽心/挂角位, 勿随手送马, 可驱赶/走跴或预兑');   // v3.9.2
    if (e.phase === 'opening') {   // v3.2 开局任务提醒 (中残局零噪音)
      if (!e.taskCannon) adv.push('开局任务: 尽快架中炮 (炮二/八平五)');
      if (e.taskHomeKnights >= 1) adv.push('开局任务: 尽快上正马 (两匹都出)');   // v3.2: 还有马在原位就提醒 (含已上一匹的情况)
      if (e.taskCannon && e.taskHomeKnights === 0 && e.taskHomeRooks >= 1) adv.push('三任务近完成, 优先出车进攻 (车一平二/车九平八, 占肋道/卒林线)');   // v3.4: 出车提醒收紧到三任务近完成 (原 opening 全程触发与挺兵任务抢手)
    }
    if (e.lastRankMine >= 1) risk.push('己方底线兵已成老兵 (只能横移), 勿再拱, 换其他子助攻');   // v2.3 底线老兵 (零噪音: 有底线兵才点名)
    if (e.deepPalaceMine >= 1) adv.push('己方兵卒已逼入对方九宫区域, 威胁九宫, 配合车马可成杀势');   // v3.8 兵临九宫 (零噪音: 有深入兵才点名)
    if (e.deepPalaceTheirs >= 1) risk.push('对方兵卒已逼入你方九宫区域, 优先驱赶或兑走, 勿任其发揮');   // v3.8
    if (!adv.length) adv.push('局面大体均衡, 稳步发展');
    if (!risk.length) risk.push('暂无明显风险');

    var lines = [
      '- 阶段: ' + K.PHASE_CN[e.phase] + ' (第' + e.round + '回合)',
      '- 局面评分: ' + evalStr,
      '- 优势: ' + adv.slice(0, 3).join('; '),
      '- 风险: ' + risk.slice(0, 3).join('; ')
    ];
    if (e.captures.length) lines.push('- 你可吃子: ' + e.captures.join('、'));
    lines.push('- 合法着法数: ' + e.legalCount);   // v2.3: 复用 evaluate 预生成结果

    return {
      phase: e.phase,
      evaluation: evalStr,
      advantages: adv.slice(0, 3),
      risks: risk.slice(0, 3),
      score: e.score,
      text: lines.join('\n')
    };
  }

  XQ.PositionEvaluator = { evaluate: evaluate, summarize: summarize, attackHorse: attackHorse };
})(typeof window !== 'undefined' ? window : globalThis);
