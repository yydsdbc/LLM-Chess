/* 象棋引擎 v1.0 — Engine 门面 (UI / Agent 唯一入口, 不暴露内部可变状态) */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var Piece = XQ.Piece, Move = XQ.Move, Board = XQ.Board,
      Rules = XQ.Rules, Generator = XQ.Generator, Judge = XQ.Judge;

  /** v1.7.8 纯函数 (独立可测): 从 startBoard 重放 history, 统计各方"最近连续将军手数"
   *  语义: 某方每手都将军 → 己方计数累加; 任一手不将军 → 己方清零 (对方走子不影响己方计数) */
  function checkStreaksFrom(startBoard, history) {
    return replayStats(startBoard, history).streaks;
  }

  /** A2 v3.9 纯函数: 重放 history 同时统计 长将计数 + 自然限着时钟 — undoPly 从起始原像重算用,
   *  与 applyPlayerMove 的单步语义严格一致: 吃子→时钟清零; 将军着法→不计入 (保持); 普通着法→+1 */
  function replayStats(startBoard, history) {
    var b = startBoard.clone();
    var streaks = { red: 0, black: 0 };
    var clock = 0;
    var list = history || [];
    for (var i = 0; i < list.length; i++) {
      var m = list[i];
      b.applyMove(m);
      var chk = Rules.inCheck(b, Piece.opponent(m.piece.color));
      if (chk) streaks[m.piece.color]++;
      else streaks[m.piece.color] = 0;
      if (m.captured) clock = 0;
      else if (!chk) clock++;
    }
    return { streaks: streaks, naturalClock: clock };
  }

  function create(opts) {
    opts = opts || {};
    var ruleEnforce = opts.ruleEnforce !== false;   // v2.0 规则闭环开关 (默认开; 分析器/回放重建可关, 不重判)
    var board = opts.startBoard ? opts.startBoard.clone() : Board.create();   // v2.0: 支持自定义起始盘面 (规则测试用)
    var genesis = board.clone();   // A2 v3.9: 起始盘面原像 — undoPly 重放基点 (修复自定义起始局面误用标准开局板回放)
    var turn = opts.turn || 'red';
    var history = [];        // Move[]
    /* 第48轮: 每手走完后的 {长将计数, 自然限着时钟} 快照栈 — 与 history 严格同长 (仅 applyPlayerMove 压、
       undoPly 弹、newGame 清), 让悔棋/复盘跳转 O(1) 恢复统计而不必重放历史 (见 undoPly 处注释)。 */
    var statStack = [];
    var lastMove = null;
    var _tgtCache = null;   // 第37轮: legalTargets memo (任意盘面变更即由 apply/undo 重置)
    var _dgrCache = null;   // 第39轮: dangerTargets memo (选中格每帧重算静态交换 → 记忆化)
    var _chkCache = null;   // 第43轮: inCheck memo (渲染一帧内 render 逐格判定 + renderStatus 各调一次 → 全盘攻击图扫描减半)
    var _snapCache = null;  // 第47轮: snapshot memo — 每帧 90 个 {color,type,id} 对象分配是渲染路径最大单笔分配 (键同 _stateVer)
    var _stateVer = 0;      // 第39轮: 盘面变更版本 — memo 键用它 (原用 history.length: undo 后换着法重演回同一手数会过期命中)
    function bumpVer() { _stateVer++; _tgtCache = null; _dgrCache = null; _chkCache = null; _snapCache = null; }
    var over = false, result = 'normal', winner = null;
    var listeners = [];
    var posCounts = {};      // v1.7.7 重复局面计数: key=盘面文本|执子方 — 三次重复判和/长将检测基础
    var checkStreaks = { red: 0, black: 0 };   // v1.7.8 长将追踪: 各方"最近连续将军手数" (每手都将军则累加, 不将军则清零)
    var naturalCap = typeof opts.naturalCap === 'number' ? opts.naturalCap : 120;   // v3.8 自然限着: 连续 120 半回合 (60 回合) 无吃子判和 (0=关闭); 亚洲棋规 60 回合自然限着
    var naturalClock = 0;    // v3.8: 当前连续无吃子半回合数 (吃子即清零)
    /* 第43轮: 盘面文本 memo (键 = _stateVer) — snapshot 每帧都要 posCounts[posKey()], 原先每帧重建一次
       90 格文本; _stateVer 覆盖全部盘面/执子方变更 (apply/undo/newGame 均 bumpVer), 故同版本内结果恒定。 */
    var _pkCache = null;
    function posKey() {
      if (_pkCache === null || _pkCache.ver !== _stateVer) _pkCache = { ver: _stateVer, key: board.toText() + '|' + turn };
      return _pkCache.key;
    }
    /** 重复局面计数进出 (key 可显式传入: undoPly 必须扣「被撤销的那个局面」, 见该处注释) */
    function bumpPos(delta, key) {
      var k = key || posKey();
      if (delta > 0) posCounts[k] = (posCounts[k] || 0) + 1;
      else if (posCounts[k]) { posCounts[k]--; if (!posCounts[k]) delete posCounts[k]; }
    }

    function emit(type, data) {
      listeners.forEach(function (cb) { try { cb(type, data); } catch (e) {} });
    }

    function refreshStatus() {
      var st = Judge.status(board, turn);
      over = st.over; result = st.result; winner = st.winner;
      return st;
    }

    var api = {
      /** ── 查询 (只读快照) ── */
      turn: function () { return turn; },
      isOver: function () { return over; },
      result: function () { return { result: result, winner: winner, over: over }; },
      ply: function () { return history.length; },
      history: function () { return history.map(Move.clone); },
      lastMove: function () { return lastMove ? Move.clone(lastMove) : null; },
      repetitionCount: function () { return posCounts[posKey()] || 0; },   // v1.7.7 当前局面已出现次数 (含本次; 3=可判和)
      naturalClock: function () { return naturalClock; },   // v3.8 当前连续无吃子半回合数 (naturalCap 时判和)
      checkStreak: function (color) { return checkStreaks[color || turn] || 0; },   // v1.7.8 某方最近连续将军手数 (4+=长将风险)
      inCheck: function (color) {
        var c = color || turn;
        if (_chkCache && _chkCache.color === c && _chkCache.ver === _stateVer) return _chkCache.val;   // 第43轮 memo (键含方别: 两方各一次不可互相覆盖)
        var v = Rules.inCheck(board, c);
        _chkCache = { color: c, ver: _stateVer, val: v };
        return v;
      },
      pieceAt: function (x, y) { return board.get(x, y) || null; },
      kingPos: function (color) { return board.kingPos(color); },

      /** UI 渲染快照: cells[y][x] = {color,type,id}|null
       *  第47轮: 按 _stateVer 记忆化 — 快照的全部字段 (cells/turn/over/result/winner/ply/naturalClock/
       *  repetitionCount) 都只随盘面或执子方变化, 而 apply/undo/newGame 三条写路径均 bumpVer; 渲染每帧
       *  调一次 (renderer.render) 时同版本内结果恒定, 故同版本直接复用同一对象 (调用方一律只读)。 */
      snapshot: function () {
        if (_snapCache && _snapCache.ver === _stateVer) return _snapCache.val;
        var cells = [];
        for (var y = 0; y < board.H; y++) {
          var row = [];
          for (var x = 0; x < board.W; x++) {
            var p = board.get(x, y);
            row.push(p ? { color: p.color, type: p.type, id: p.id } : null);
          }
          cells.push(row);
        }
        var val = { cells: cells, turn: turn, over: over, result: result, winner: winner, lastMove: api.lastMove(),
                 ply: history.length, naturalClock: naturalClock, repetitionCount: posCounts[posKey()] || 0 };   // A2 v3.9 增量: 计数进出快照 (replay 重建/观测层依赖; 旧消费者只读原有字段, 纯增量安全)
        _snapCache = { ver: _stateVer, val: val };
        return val;
      },

      /** ── 走法 ── */
      generateLegalMoves: function (color) {
        return Generator.generateLegalMoves(board, color || turn);
      },
      legalTargets: function (x, y) {
        var p = board.get(x, y);
        if (!p || p.color !== turn) return [];
        if (_tgtCache && _tgtCache.key === x + ',' + y + '@' + _stateVer) return _tgtCache.list;   // 第37轮 memo / 第39轮 键改状态版本
        _tgtCache = { key: x + ',' + y + '@' + _stateVer, list: Generator.legalTargetsFrom(board, x, y) };
        return _tgtCache.list;
      },
      dangerTargets: function (x, y) {
        var p = board.get(x, y);
        if (!p || p.color !== turn) return [];
        if (_dgrCache && _dgrCache.key === x + ',' + y + '@' + _stateVer) return _dgrCache.list;   // 第39轮: 与 legalTargets 同款 memo (渲染热路径)
        _dgrCache = { key: x + ',' + y + '@' + _stateVer, list: Generator.dangerTargetsFrom(board, x, y) };
        return _dgrCache.list;
      },

      /**
       * 应用走法 (唯一写入口)。UI 与 Agent 均走此方法。
       * @returns {ok, reason?, move?, status?}
       */
      applyPlayerMove: function (fx, fy, tx, ty) {
        if (over) return { ok: false, reason: 'game_over' };
        var p = board.get(fx, fy);
        if (!p) return { ok: false, reason: 'empty_square' };
        if (p.color !== turn) return { ok: false, reason: 'not_your_turn' };
        var legal = Generator.generateLegalMoves(board, turn);
        var m = null;
        for (var i = 0; i < legal.length; i++) {
          if (Move.matchesCoord(legal[i], fx, fy, tx, ty)) { m = legal[i]; break; }
        }
        if (!m) return { ok: false, reason: 'illegal_move' };
        board.applyMove(m);
        history.push(m);
        lastMove = m;
        turn = Piece.opponent(turn);
        bumpVer();   // 第39轮: 盘面变更 → memo 失效; 第43轮: 必须先于 bumpPos — posKey 的盘面文本 memo 按 _stateVer 判定,
                     //            否则这里会命中「走子前」的旧键, 把重复计数记到上一个局面上
        bumpPos(1);
        var st = refreshStatus();
        /* 第48轮关键修复: 判定「这一手是否将军」必须用「对方是否被将军」, 而不是 `st.result === 'check'` —
           Judge.status 对**将杀**返回 result:'checkmate' (只有「将军但有解」才是 'check'), 于是将杀那一手
           被当成普通着法: 长将计数被**清零** (应为 +1 — 与本节文档「每手都将军则累加」以及纯函数
           replayStats/checkStreaksFrom 的口径直接矛盾), 自然限着时钟也 +1 (将军着法按亚洲棋规不计入)。
           实测 60 局随机对局 16951 手中有 21 手两条实现不一致, 全部落在将杀手 (增量 0/时钟+1 vs 重放 1/时钟不变);
           由于 undoPly 一直走重放, 这一分歧在「将杀后悔棋」时会被静默抹平, 平时则只影响盘上读数
           (checkStreak()/长将风险指示) 与入谱 note。必须在下方规则闭环改写 st 之前取值。
           gaveCheck ⟺ Rules.inCheck(board, Piece.opponent(m.piece.color))。 */
        var gaveCheck = (st.result === 'check' || st.result === 'checkmate');
        // v1.7.8 长将追踪: 走完后对方被将军 → 该方连续将军计数+1, 否则清零
        if (gaveCheck) checkStreaks[m.piece.color]++; else checkStreaks[m.piece.color] = 0;
        // v2.0 规则闭环 — 长将判负: 一方连续将军 6 半回合 (3 回合) 仍不变招 → 长将方判负。
        // 依据: 亚洲棋规长将属违例着法; 优先级低于将杀/困毙 (refreshStatus 已判 over 时不再覆盖)。
        // 阈值 6 = 连续 3 回合每手都将军, 正常战术抽将达不到; LLM 连将拉锯 (实战高频) 由规则强制终局。
        if (ruleEnforce && !over && st.result === 'check' && checkStreaks[m.piece.color] >= 6) {
          over = true; result = 'perpetual'; winner = Piece.opponent(m.piece.color);
          st = { over: true, result: result, winner: winner };
        }
        // v2.2 规则闭环 — 三次重复局面判和: 同一盘面+执子方第 3 次出现 → 自动终局 result='repetition', 双方和棋。
        // 依据: 亚洲棋规, 对局中同一局面反复出现可由裁判判和; 优先级低于将杀/困毙/长将判负 —
        // 任一方存在连续将军计数 (checkStreaks>0) 时跳过判和 (重复由长将规则处理: 长将方判负而非和棋), 无将军的纯拉锯才判和。
        if (ruleEnforce && !over && st.result !== 'check' && checkStreaks.red === 0 && checkStreaks.black === 0 && (posCounts[posKey()] || 0) >= 3) {
          over = true; result = 'repetition'; winner = null;
          st = { over: true, result: result, winner: null };
        }
        // v3.8 规则闭环 — 自然限着判和: 连续 naturalCap 半回合 (默认120=60回合) 无吃子 → 判和。
        // 依据: 亚洲棋规 60 回合自然限着; 兜住重复判和的盲区 — 双方换着法序拉锯 (局面不精确重复) 可无限延续, 只有吃子才重置。
        // 优先级低于将杀/困毙/长将判负/重复判和; 将军着法不计入 (与亚洲棋规一致), ruleEnforce 关闭时不判 (分析器/回放不重判)。
        // A2 v3.9 修复: v3.8 注释「将军着法不计入」但实现把将军着法也累加 (与注释/E14 测试口径矛盾) — 对齐: 吃子清零 / 将军保持 / 普通+1
        if (m.captured) naturalClock = 0;
        else if (!gaveCheck) naturalClock++;
        if (ruleEnforce && !over && naturalCap > 0 && st.result !== 'check' && naturalClock >= naturalCap) {
          over = true; result = 'natural'; winner = null;
          st = { over: true, result: result, winner: null };
        }
        /* 第48轮: 统计快照栈 — 与 history 严格同长 (每手压入走完后的长将计数+自然限着时钟),
           undoPly 弹栈即 O(1) 恢复, 取代原先「每次悔棋都从 genesis 重放整条历史」的 O(n) 重算
           (复盘跳转是连续 undoPly → 489 手棋谱点第一手 ≈ 24 万次 applyMove + 全盘攻击扫描, 主线程可见卡顿)。 */
        statStack.push({ red: checkStreaks.red, black: checkStreaks.black, naturalClock: naturalClock });
        emit('move', { move: Move.clone(m), status: st });
        return { ok: true, move: Move.clone(m), status: st };
      },

      /** 悔一步 (半回合) */
      undoPly: function () {
        if (!history.length) return false;
        var m = history.pop();
        /* 第43轮关键修复: 重复计数的键必须在 undoMove **之前**取 — bumpPos 用 posKey() 取的是「当前盘面」,
           而撤销后当前盘面已经是恢复出来的那个局面, 于是扣的是「恢复后的局面」而不是「刚被撤掉的局面」:
           被撤局面的计数永远留着, 恢复后的局面反而被无故扣减/删除。表现: 悔棋后重走同一着, 同一局面
           在盘上其实只出现过一次, posCounts 却累加到 3 → 第 3 次重走当场判「三次重复和棋」(实测 2,3,4,5 递增)。
           修: 先取被撤销局面的键, 再 undoMove, 再把计数扣在那个键上。 */
        var undoneKey = posKey();
        board.undoMove(m);
        turn = m.piece.color;
        bumpPos(-1, undoneKey);
        bumpVer();     // 第39轮: memo 失效 (undo 后重选/重演不复用旧盘面结果)
        // A2 v3.9 修复: 旧版从标准开局盘 Board.create() 重放 — 自定义起始局面 (opts.startBoard) 时 genesis 错位,
        // 长将计数/自然限着时钟在含将军/吃子的历史下全错; 改从真正的起始原像一次性重算 (与 applyPlayerMove 单步语义同源)
        /* 第48轮: 改为弹统计快照栈 (O(1)) — 原实现每次都从 genesis 重放整条 history (O(n) 次 applyMove +
           Rules.inCheck 全盘攻击扫描), 而「复盘点第 N 手」是连续 undoPly → O(n²): 489 手棋谱点第一手约 24 万次
           applyMove, 主线程可见卡顿。栈由 applyPlayerMove 逐手压入, 且该处的将军判定已与本函数原用的
           replayStats 口径对齐 (见 applyPlayerMove 的 gaveCheck), 故两者结果逐键相同。
           兜底: 若不变式被破坏 (将来新增了别的写路径) 则回退到重放算法并清栈, 语义与旧实现完全一致。 */
        if (statStack.length > history.length) {
          /* statStack[i] 存的是「第 i+1 手走完之后」的统计, 所以被撤销那一手的快照要先丢弃,
             再**读取**(而非弹出) 新的栈顶 = 「上一手走完之后」; 栈空 = 回到起始局面 (create() 初值全 0,
             opts.startBoard 自定义起始局面同样从 0 起算, 与 replayStats(genesis, []) 一致)。
             首版直接用了弹出的那一项 (即「被撤销那一手之后」), 等价性探针当场报 318/320 步不一致。 */
          statStack.pop();
          var prevS = statStack.length ? statStack[statStack.length - 1] : null;
          checkStreaks = prevS ? { red: prevS.red, black: prevS.black } : { red: 0, black: 0 };
          naturalClock = prevS ? prevS.naturalClock : 0;
        } else {
          statStack.length = 0;
          var rs = replayStats(genesis, history);
          checkStreaks = rs.streaks;
          naturalClock = rs.naturalClock;
        }
        over = false; result = 'normal'; winner = null;
        lastMove = history.length ? history[history.length - 1] : null;
        emit('undo', {});
        return true;
      },

      newGame: function () {
        board = Board.create();
        genesis = board.clone();   // A2 v3.9: 起始原像同步重置
        turn = 'red';
        history = [];
        lastMove = null;
        statStack = [];   // 第48轮: 统计快照栈随新局清空 (与 history 同长不变式)
        posCounts = {};   // v1.7.7: 重复计数随新局清零
        checkStreaks = { red: 0, black: 0 };   // v1.7.8: 长将计数随新局清零
        naturalClock = 0;   // v3.8: 自然限着计数随新局清零
        over = false; result = 'normal'; winner = null;
        bumpVer();   // 第39轮: 新局 memo 失效
        emit('new', {});
      },

      /** ── 搜索/序列化支持 ── */
      cloneBoard: function () { return board.clone(); },
      /** 从当前盘面独立搜索: 把 Board 交给 Generator/Judge 直接使用 */

      /** 棋谱序列化 (可重放) */
      serialize: function () {
        return { v: 1, moves: history.map(function (m) { return [m.from.x, m.from.y, m.to.x, m.to.y]; }) };
      },
      loadSerialized: function (s) {
        this.newGame();   // 第39轮: newGame 内 bumpVer 已使 memo 失效 (同长度异盘面边角一并覆盖)
        if (!s || !s.moves) return false;
        for (var i = 0; i < s.moves.length; i++) {
          var m = s.moves[i];
          var r = this.applyPlayerMove(m[0], m[1], m[2], m[3]);
          if (!r.ok) { this.newGame(); return false; } // 走不下去 = 坏棋谱; v3.9a 修复: 原 undoPly 会误弹上一手合法着法 (与贪心测试教训同源), 改整盘重置保证干净状态
        }
        return true;
      },

      /** ── LLM/展示辅助 ── */
      boardText: function () { return board.toText(); },
      sqName: Move.sqName,
      legalMoveStrings: function (color) {
        return this.generateLegalMoves(color).map(function (m) { return '[' + Move.sqName(m.from) + '>' + Move.sqName(m.to) + ']'; }).join(' ');
      },
      moveName: function (m) { return Move.name(m); },

      onChange: function (cb) { listeners.push(cb); }
    };
    return api;
  }

  XQ.Engine = { create: create, checkStreaksFrom: checkStreaksFrom, replayStats: replayStats };
})(typeof window !== 'undefined' ? window : globalThis);
