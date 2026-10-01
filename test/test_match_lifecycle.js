/* Headless match lifecycle: late agents must not alter a completed research record. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
for (const file of ['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js', 'core/generator.js',
  'core/judge.js', 'core/engine.js', 'benchmark/record.js', 'benchmark/elo.js', 'benchmark/match.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file });
}
const XQ = globalThis.XQ;
const storage = new Map();
globalThis.localStorage = { getItem: key => storage.get(key) || null, setItem: (key, value) => storage.set(key, String(value)), removeItem: key => storage.delete(key) };
const actualSetTimeout = globalThis.setTimeout;
const actualClearTimeout = globalThis.clearTimeout;
let pass = 0;
async function test(name, run) {
  const moveTimers = [];
  globalThis.setTimeout = function (fn, delay) {
    if (delay !== 120000) return actualSetTimeout(fn, delay);
    const timer = { fn, cleared: false };
    moveTimers.push(timer);
    return timer;
  };
  globalThis.clearTimeout = function (timer) {
    if (moveTimers.indexOf(timer) >= 0) timer.cleared = true;
    else actualClearTimeout(timer);
  };
  try {
    await run(moveTimers);
    pass++;
    console.log('  [PASS] ' + name);
  } finally {
    globalThis.setTimeout = actualSetTimeout;
    globalThis.clearTimeout = actualClearTimeout;
  }
}
function blackAgent() {
  return { name: 'Black', kind: 'test', next: async engine => engine.generateLegalMoves('black')[0] };
}
const flush = () => new Promise(resolve => actualSetTimeout(resolve, 0));
function cyclingAgent(side, name) {
  let turns = 0;
  return { name, kind: 'test', next: async engine => {
    const row = side === 'red' ? '3' : '8';
    const from = (turns++ % 2 ? 'g' : 'h') + row;
    const to = (from[0] === 'h' ? 'g' : 'h') + row;
    return engine.generateLegalMoves(side).find(move => XQ.Move.sqName(move.from) === from && XQ.Move.sqName(move.to) === to);
  } };
}
async function runCli(maxPlies) {
  const priorRandomAgent = XQ.RandomAgent;
  XQ.RandomAgent = { create: opts => cyclingAgent(opts.side, opts.name) };
  XQ.Elo.resetAll();
  try {
    return await new Promise((resolve, reject) => {
      const output = [];
      const context = { XQ, localStorage: globalThis.localStorage, require: () => ({}),
        process: { argv: ['node', 'benchmark/cli.js', '1', String(maxPlies), '--json'], env: {},
          exit: code => code ? reject(new Error(output.join('\n'))) : resolve(output) },
        console: { log: line => output.push(String(line)), error: error => output.push(String(error)) } };
      vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'benchmark/cli.js'), 'utf8'), context, { filename: 'benchmark/cli.js' });
    });
  } finally { XQ.RandomAgent = priorRandomAgent; }
}

(async function () {
  await test('timeout aborts agent, awards loss and ignores late successful move', async timers => {
    let finishMove, aborts = 0, blackCalls = 0;
    const events = [];
    const black = blackAgent();
    black.next = async () => { blackCalls++; throw new Error('unexpected next turn'); };
    const red = { name: 'Late', kind: 'test', next: engine => new Promise(resolve => {
      const move = engine.generateLegalMoves('red')[0];
      finishMove = () => resolve(move);
    }), abort: () => { aborts++; } };
    const pending = XQ.Match.play({ red, black, onEvent: type => events.push(type) });
    await flush();
    timers[0].fn();
    const record = await pending;
    const finished = JSON.stringify(record);
    finishMove();
    await flush(); await flush();
    assert.strictEqual(aborts, 1);
    assert.strictEqual(record.winner, 'black');
    assert.strictEqual(record.result, 'error');
    assert.strictEqual(record.illegal, 1);
    assert.match(record.error, /timeout|超时/i);
    assert.strictEqual(JSON.stringify(record), finished);
    assert.strictEqual(blackCalls, 0);
    assert.deepStrictEqual(events, ['error', 'end']);
    assert(timers[0].cleared);
  });
  await test('late rejection after timeout cannot mutate record or emit another end', async timers => {
    let rejectMove;
    const events = [];
    const red = { name: 'RejectLate', kind: 'test', next: () => new Promise((resolve, reject) => { rejectMove = reject; }) };
    const pending = XQ.Match.play({ red, black: blackAgent(), onEvent: type => events.push(type) });
    await flush();
    timers[0].fn();
    const record = await pending;
    const finished = JSON.stringify(record);
    rejectMove(new Error('late error'));
    await flush();
    assert.strictEqual(JSON.stringify(record), finished);
    assert.deepStrictEqual(events, ['error', 'end']);
  });
  await test('agent error clears deadline and settles once', async timers => {
    const events = [];
    const red = { name: 'RejectNow', kind: 'test', next: async () => { throw new Error('offline'); } };
    const record = await XQ.Match.play({ red, black: blackAgent(), onEvent: type => events.push(type) });
    assert.strictEqual(record.winner, 'black');
    assert.strictEqual(record.error, 'offline');
    assert(timers[0].cleared);
    const finished = JSON.stringify(record);
    timers[0].fn();
    assert.strictEqual(JSON.stringify(record), finished);
    assert.deepStrictEqual(events, ['error', 'end']);
  });
  await test('normal legal turn retains maxPlies behavior and clears deadline', async timers => {
    const events = [];
    const red = { name: 'Legal', kind: 'test', next: async engine => engine.generateLegalMoves('red')[0] };
    const record = await XQ.Match.play({ red, black: blackAgent(), maxPlies: 1, onEvent: type => events.push(type) });
    assert.strictEqual(record.moves.length, 1);
    assert.strictEqual(record.result, 'max_plies');
    assert.strictEqual(record.winner, null);
    assert(timers[0].cleared);
    assert.deepStrictEqual(events, ['move', 'end']);
  });
  await test('natural match scores one game and truncated default match does not score', async () => {
    XQ.Elo.resetAll();
    const red = cyclingAgent('red', 'CycleRed');
    const black = cyclingAgent('black', 'CycleBlack');
    const record = await XQ.Match.play({ red, black, maxPlies: 20 });
    assert.strictEqual(record.result, 'repetition');
    assert(XQ.Elo.leaderboard().every(entry => entry.games === 1 && entry.draw === 1));
    const truncated = await XQ.Match.play({ red: cyclingAgent('red', 'ShortRed'), black: cyclingAgent('black', 'ShortBlack'), maxPlies: 1 });
    assert.strictEqual(truncated.result, 'max_plies');
    assert(!XQ.Elo.leaderboard().some(entry => entry.name === 'ShortRed'));
  });
  await test('CLI natural ending and maxPlies ending each count exactly one game', async () => {
    const naturalOutput = await runCli(20);
    assert(naturalOutput.some(line => line.indexOf('"result":"repetition"') >= 0));
    assert(XQ.Elo.leaderboard().every(entry => entry.games === 1 && entry.draw === 1));
    const shortOutput = await runCli(1);
    assert(shortOutput.some(line => line.indexOf('"result":"max_plies"') >= 0));
    assert(XQ.Elo.leaderboard().every(entry => entry.games === 1 && entry.draw === 1));
  });
  await test('throwing move/end observers do not change outcome or prevent settlement', async () => {
    const events = [];
    const red = cyclingAgent('red', 'ObserveRed');
    const black = cyclingAgent('black', 'ObserveBlack');
    const pending = XQ.Match.play({ red, black, maxPlies: 1, onEvent: type => { events.push(type); throw new Error('observer ' + type); } });
    const record = await Promise.race([pending, new Promise(resolve => actualSetTimeout(() => resolve(null), 100))]);
    assert(record, 'end observer cannot leave the match pending');
    assert.strictEqual(record.result, 'max_plies');
    assert.strictEqual(record.winner, null);
    assert.deepStrictEqual(events, ['move', 'end']);
  });
  await test('throwing error/end observers preserve the agent failure and settle', async () => {
    const events = [];
    const red = { name: 'ObserveFailure', kind: 'test', next: async () => { throw new Error('offline agent'); } };
    const pending = XQ.Match.play({ red, black: blackAgent(), onEvent: type => { events.push(type); throw new Error('observer ' + type); } });
    const record = await Promise.race([pending, new Promise(resolve => actualSetTimeout(() => resolve(null), 100))]);
    assert(record, 'error observer cannot leave the match pending');
    assert.strictEqual(record.result, 'error');
    assert.strictEqual(record.error, 'offline agent');
    assert.strictEqual(record.winner, 'black');
    assert.deepStrictEqual(events, ['error', 'end']);
  });
  console.log('test_match_lifecycle: ' + pass + '/' + pass + ' PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
