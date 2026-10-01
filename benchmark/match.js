/* benchmark/match.js — 对局管理: 任意两个 Agent 按引擎规则对弈并产出棋局记录 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};

  /**
   * play({red, black, maxPlies=500, rateAllResults=false, onEvent})
   *  red/black: Agent (接口: {name, side, next(engine)→{from,to}, usage()→{...}|null})
   *  rateAllResults: CLI 也计入限手数/异常结果; 默认仅对规则终局计分。
   *  onEvent:   (type, data) 观察回调: 'move'|'end'|'illegal'|'error', 异常不影响对局。
   * @returns Promise<record>
   */
  function play(opts) {
    var red = opts.red, black = opts.black;
    var maxPlies = opts.maxPlies || 500;
    var observer = typeof opts.onEvent === 'function' ? opts.onEvent : function () {};
    function onEvent(type, data) {
      try { observer(type, data); }
      catch (err) { console.warn('[Match] onEvent ' + type + ' failed: ' + String(err && err.message || err)); }
    }
    var engine = XQ.Engine.create();
    var record = XQ.Record.blank({
      redName: red.name, redKind: red.kind, redModel: red.model || null,
      blackName: black.name, blackKind: black.kind, blackModel: black.model || null
    });
    var t0 = Date.now();

    return new Promise(function (resolve) {
      var finished = false;
      var moveTimeout = null;
      function step() {
        if (finished) return;
        if (engine.isOver()) return finish();
        if (engine.ply() >= maxPlies) {
          record.result = 'max_plies';
          record.winner = null;
          return finish();
        }
        var side = engine.turn();
        var agent = side === 'red' ? red : black;
        var t1 = Date.now();

        moveTimeout = setTimeout(function () {   // 第54/60轮: 单手超时 (120s) — LLM 挂起不阻塞整场
          if (finished) return;
          record.illegal++;
          record.result = 'error';
          record.winner = XQ.Piece.opponent(side);
          record.error = 'agent move timeout (120s)';
          try { if (agent.abort) agent.abort(); } catch (eA) {}
          onEvent('error', { side: side, error: record.error });
          finish();
        }, 120000);
        Promise.resolve()
          .then(function () { return agent.next(engine); })
          .then(function (mv) {
            if (finished) return;
            clearTimeout(moveTimeout);
            moveTimeout = null;
            var res = engine.applyPlayerMove(mv.from.x, mv.from.y, mv.to.x, mv.to.y);
            if (!res.ok) {
              record.illegal++;
              record.result = 'error';
              record.winner = XQ.Piece.opponent(side); // 走非法棋判负
              onEvent('illegal', { side: side, attempt: mv, reason: res.reason });
              return finish();
            }
            XQ.Record.addMove(record, engine, res.move, Date.now() - t1);
            onEvent('move', { move: res.move, engine: engine });
            if (res.status.over) {
              record.result = res.status.result;
              record.winner = res.status.winner;
              return finish();
            }
            setTimeout(step, 0); // 让出事件循环, UI 可呼吸
          })
          .catch(function (err) {
            if (finished) return;
            clearTimeout(moveTimeout);
            moveTimeout = null;
            record.result = 'error';
            record.winner = XQ.Piece.opponent(side); // agent 异常判负
            record.error = String(err && err.message || err);
            onEvent('error', { side: side, error: record.error });
            finish();
          });
      }

      function finish() {
        if (finished) return;
        finished = true;
        if (moveTimeout) { clearTimeout(moveTimeout); moveTimeout = null; }
        XQ.Record.finish(record, { result: record.result, winner: record.winner }, Date.now() - t0);
        var ru = red.usage && red.usage(), bu = black.usage && black.usage();
        if (ru) record.tokens.red = ru;
        if (bu) record.tokens.black = bu;
        // 统一在幂等终局入口计分, CLI 不再追加第二笔相同对局。
        if (XQ.Elo && (engine.isOver() || opts.rateAllResults === true)) {
          try { XQ.Elo.applyResult(record.red.name, record.black.name, record.winner); } catch (eE) {}
        }
        onEvent('end', { record: record });
        resolve(record);
      }

      step();
    });
  }

  XQ.Match = { play: play };
})(typeof window !== 'undefined' ? window : globalThis);
