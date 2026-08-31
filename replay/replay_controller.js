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
    var speed = 1;
    var loop = !!opts.loop;
    var onState = opts.onState || function () {};
    var onPlayState = opts.onPlayState || function () {};   // (playing)

    function emit() { onState(session.state(), session); }
    function clearTimer() { if (timer) { clearTimeout(timer); timer = null; } }
    function delay() { return BASE_MS / speed; }

    function schedule() {
      clearTimer();
      if (!playing) return;
      timer = setTimeout(function () {
        if (!playing) return;
        if (!session.next()) {
          if (loop) { session.goto(0); emit(); schedule(); return; }   // v1.6.1 循环: 末尾自动重置
          playing = false; onPlayState(false); emit(); return;
        }
        emit();
        schedule();
      }, delay());
    }

    function play() {
      if (playing) return;
      if (session.idx() >= session.total()) session.goto(0);   // 播完再按 → 从头
      playing = true;
      onPlayState(true);
      emit();
      schedule();
    }
    function pause() {
      if (!playing) return;
      playing = false;
      clearTimer();
      onPlayState(false);
      emit();
    }
    function toggle() { playing ? pause() : play(); }

    /* 手动导航: 统一暂停 (可预测), 走完发一次状态 */
    function manual(fn) {
      pause();
      if (fn() !== false) emit();
    }
    function stepNext() { manual(function () { return session.next(); }); }
    function stepPrev() { manual(function () { return session.prev(); }); }
    function gotoPly(n) { manual(function () { return session.goto(n); }); }
    function toStart() { gotoPly(0); }
    function toEnd() { gotoPly(session.total()); }

    function setSpeed(x) {
      if (SPEEDS.indexOf(x) < 0) return;
      speed = x;
      if (playing) schedule();   // 按新间隔重排
    }

    function setLoop(v) { loop = !!v; }
    function isLooping() { return loop; }

    function dispose() { pause(); }

    return {
      play: play, pause: pause, toggle: toggle,
      stepNext: stepNext, stepPrev: stepPrev,
      gotoPly: gotoPly, toStart: toStart, toEnd: toEnd,
      setSpeed: setSpeed,
      setLoop: setLoop,
      isLooping: isLooping,
      delay: delay,
      speed: function () { return speed; },
      isPlaying: function () { return playing; },
      dispose: dispose
    };
  }

  XQ.ReplayController = { BASE_MS: BASE_MS, SPEEDS: SPEEDS, create: create };
})(typeof window !== 'undefined' ? window : globalThis);
