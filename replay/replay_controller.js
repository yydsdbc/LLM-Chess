/* replay/replay_controller.js — 回放控制 (v1.6)
   自动播放 / 暂停 / 继续 / 上一步 / 下一步 / 跳转; 默认每步间隔 10s, 倍速 0.5x/1x/2x/5x。
   纯逻辑 + 回调输出, 不碰 DOM (渲染由 ui/app.js 的回调完成)。 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};

  var BASE_MS = 10000;
  var SPEEDS = [0.25, 0.5, 1, 2, 5, 10, 20];   // v1.6.1: 慢动作 0.25x 复盘 + 快进 10x/20x 扫描

  function create(session, opts) {
    opts = opts || {};
    var timer = null;
    var playing = false;
    var generation = 0;
    var ticks = 0;
    var baseMs = Number.isFinite(Number(opts.baseMs)) && Number(opts.baseMs) >= 0 ? Math.min(86400000, Number(opts.baseMs)) : BASE_MS;
    var speed = SPEEDS.indexOf(Number(opts.speed)) >= 0 ? Number(opts.speed) : 1;
    var loop = !!opts.loop;
    var onState = opts.onState || function () {};
    var onPlayState = opts.onPlayState || function () {};   // (playing)
    var onError = typeof opts.onError === 'function' ? opts.onError : function () {};

    function report(err, phase) { try { onError(err, phase); } catch (ignored) {} }
    function emit() { try { onState(session.state(), session); } catch (err) { report(err, 'state'); } }
    function playState(value) { try { onPlayState(value); } catch (err) { report(err, 'play-state'); } }
    function clearTimer() { generation++; if (timer) { clearTimeout(timer); timer = null; } }
    function delay() { return baseMs / speed; }

    function schedule() {
      clearTimer();
      if (!playing) return;
      var token = generation;
      timer = setTimeout(function () {
        timer = null;
        if (!playing || token !== generation) return;
        try {
          ticks++;
          if (!session.next()) {
            if (loop) { session.goto(0); emit(); schedule(); return; }   // v1.6.1 循环: 末尾自动重置
            playing = false; playState(false); emit(); return;
          }
          emit();
          schedule();
        } catch (err) {
          playing = false; clearTimer(); playState(false); report(err, 'tick'); emit();
        }
      }, delay());
    }

    function play() {
      if (playing) return;
      try { if (session.idx() >= session.total()) session.goto(0); } catch (err) { report(err, 'play'); return; }   // 播完再按 → 从头
      playing = true;
      playState(true);
      emit();
      schedule();
    }
    function pause() {
      if (!playing) return;
      playing = false;
      clearTimer();
      playState(false);
      emit();
    }
    function toggle() { playing ? pause() : play(); }

    /* 手动导航: 统一暂停 (可预测), 走完发一次状态 */
    function manual(fn) {
      pause();
      try { if (fn() !== false) emit(); } catch (err) { report(err, 'navigation'); }
    }
    function stepNext() { manual(function () { return session.next(); }); }
    function stepPrev() { manual(function () { return session.prev(); }); }
    function gotoPly(n) { manual(function () { return session.goto(n); }); }
    function toStart() { gotoPly(0); }
    function toEnd() { gotoPly(session.total()); }

    function setSpeed(x) {
      x = Number(x);
      if (SPEEDS.indexOf(x) < 0) return false;
      speed = x;
      if (playing) schedule();   // 按新间隔重排
      return true;
    }

    function setBaseMs(value) {
      var n = Number(value);
      if (!Number.isFinite(n) || n < 0) return false;
      baseMs = Math.min(86400000, n);
      if (playing) schedule();
      return true;
    }

    function setLoop(v) { loop = !!v; }
    function isLooping() { return loop; }

    /* v3.9.2 跳到下一手吃子 / 上一手吃子: 从当前 idx 对应的下一手向后扫, 找首个 .captured 非空手;
       没吃子 (整局零吃子) 时跳末尾/起点。手动导航语义: 同样 pause + emit。 */
    function findCaptureIdx(fromIdx, dir) {
      var cached = typeof session.capturePlies === 'function' ? session.capturePlies() : null;
      if (cached && cached.length) {
        if (dir > 0) for (var c = 0; c < cached.length; c++) if (cached[c] > fromIdx) return cached[c];
        if (dir < 0) for (var d = cached.length - 1; d >= 0; d--) if (cached[d] < fromIdx) return cached[d];
        return -1;
      }
      var moves = session.record.moves || [];
      var n = moves.length;
      var i = dir > 0 ? fromIdx : fromIdx - 1;
      var end = dir > 0 ? n : -1;
      var step = dir > 0 ? 1 : -1;
      while (i !== end && i >= 0 && i <= n) {
        if (moves[i] && moves[i].captured) return i + 1;   // 跳到该手之后 (ply=i+1)
        i += step;
      }
      return -1;
    }
    function stepNextCapture() {
      pause();
      var cur = session.idx();
      var n = session.total();
      var target = findCaptureIdx(cur, 1);
      if (target < 0 || target > n) target = n;   // 找不到后续吃子时跳末尾 (与 next 按钮语义对齐: 不烧重复, 给个目的地)
      if (target === cur + 1) { session.next(); emit(); return; }
      if (target !== cur) { session.goto(target); emit(); }
    }
    function stepPrevCapture() {
      pause();
      var cur = session.idx();
      var target = findCaptureIdx(cur, -1);
      if (target < 0) target = 0;   // 找不到先前吃子时跳开头
      if (target !== cur) { session.goto(target); emit(); }
    }

    function dispose() { pause(); }

    return {
      play: play, pause: pause, toggle: toggle,
      stepNext: stepNext, stepPrev: stepPrev,
      stepNextCapture: stepNextCapture, stepPrevCapture: stepPrevCapture,   // v3.9.2: 跳到下一手/上一手吃子
      gotoPly: gotoPly, toStart: toStart, toEnd: toEnd,
      setSpeed: setSpeed,
      setBaseMs: setBaseMs,
      setLoop: setLoop,
      isLooping: isLooping,
      delay: delay,
      speed: function () { return speed; },
      baseMs: function () { return baseMs; },
      ticks: function () { return ticks; },
      isPlaying: function () { return playing; },
      dispose: dispose
    };
  }

  XQ.ReplayController = { BASE_MS: BASE_MS, SPEEDS: SPEEDS, create: create };
})(typeof window !== 'undefined' ? window : globalThis);
