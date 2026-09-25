/* benchmark/match.js — 对局管理: 任意两个 Agent 按引擎规则对弈并产出棋局记录 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};

  /**
   * play({red, black, maxPlies=500, onEvent})
   *  red/black: Agent (接口: {name, side, next(engine)→{from,to}, usage()→{...}|null})
   *  onEvent:   (type, data) 回调: 'move'|'end'|'illegal'
   * @returns Promise<record>
   */
  function play(opts) {
    var red = opts.red, black = opts.black;
    var maxPlies = opts.maxPlies || 500;
    var onEvent = opts.onEvent || function () {};
    var engine = XQ.Engine.create();
    var record = XQ.Record.blank({
      redName: red.name, redKind: red.kind, redModel: red.model || null,
      blackName: black.name, blackKind: black.kind, blackModel: black.model || null
    });
    var t0 = Date.now();

    return new Promise(function (resolve) {
      function step() {
        if (engine.isOver()) return finish();
        if (engine.ply() >= maxPlies) {
          record.result = 'max_plies';
          record.winner = null;
          return finish();
        }
        var side = engine.turn();
        var agent = side === 'red' ? red : black;
        var t1 = Date.now();

        var moveTimeout = setTimeout(function () {   // 第54/60轮: 单手超时 (120s) — LLM 挂起不阻塞整场
          record.illegal++;
          record.result = 'error';
          finish();
        }, 120000);
        Promise.resolve()
          .then(function () { return agent.next(engine); })
          .then(function (mv) {
            clearTimeout(moveTimeout);
            var res = engine.applyPlayerMove(mv.from.x, mv.from.y, mv.to.x, mv.to.y);
            if (!res.ok) {
              record.illegal++;
              record.result = 'error';
              record.winner = XQ.Piece.opponent(side); // 走非法棋判负
              onEvent('illegal', { side: side, attempt: mv, reason: res.reason });
              return finish();
            }
            XQ.Record.addMove(record, engine, res.move, Date.now() - t1);
            if (res.status.over && XQ.Elo) {   // 第54轮: headless match 终局也记 Elo (原只 cli 有)
              try { XQ.Elo.applyResult(record.red.name, record.black.name, res.status.winner); } catch (eE) {}
            }
            onEvent('move', { move: res.move, engine: engine });
            if (res.status.over) {
              record.result = res.status.result;
              record.winner = res.status.winner;
              return finish();
            }
            setTimeout(step, 0); // 让出事件循环, UI 可呼吸
          })
          .catch(function (err) {
            record.result = 'error';
            record.winner = XQ.Piece.opponent(side); // agent 异常判负
            record.error = String(err && err.message || err);
            onEvent('error', { side: side, error: record.error });
            finish();
          });
      }

      function finish() {
        XQ.Record.finish(record, { result: record.result, winner: record.winner }, Date.now() - t0);
        var ru = red.usage && red.usage(), bu = black.usage && black.usage();
        if (ru) record.tokens.red = ru;
        if (bu) record.tokens.black = bu;
        onEvent('end', { record: record });
        resolve(record);
      }

      step();
    });
  }

  XQ.Match = { play: play };
})(typeof window !== 'undefined' ? window : globalThis);
