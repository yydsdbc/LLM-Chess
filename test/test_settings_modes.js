/* Settings mode visibility: execute production controller functions against a small DOM. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '..', 'ui', 'app.js'), 'utf8');
function part(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, 'production function boundary: ' + start);
  return source.slice(from, to);
}
const functions = part('  var SIDE_DEFS = {', '  /* 动态拉取服务商列表')
  + part('  var PROVIDER_MODELS = {};', '  function readSettings()')
  + part('  function readSettings()', '  function fillSettings(')
  + part('  function fillSettings(', '  function saveAISettings(')
  + part('  function saveAISettings(', '  function applyAgents(')
  + part('  function applyAgents(', '  function closeAISettings(')
  + part('  function closeAISettings(', '  function settingsTool(')
  + part('  function paintServerWarn()', '  function openAISettings(')
  + part('  function openAISettings()', '  /* ── 记录/存档');
let passed = 0;
function test(name, run) {
  run(); passed++; console.log('  [PASS] ' + name);
}
function domElement(id) {
  const listeners = {}, attrs = {}, classes = new Set();
  return { id, value: '', checked: false, style: {}, innerHTML: '', focused: false, children: [],
    appendChild(element) { this.children.push(element); },
    classList: { add: name => classes.add(name), remove: name => classes.delete(name), contains: name => classes.has(name),
      toggle: (name, enabled) => enabled ? classes.add(name) : classes.delete(name) },
    setAttribute: (name, value) => { attrs[name] = String(value); },
    getAttribute: name => attrs[name], focus() { this.focused = true; },
    addEventListener: (name, fn) => { (listeners[name] || (listeners[name] = [])).push(fn); },
    change() { (listeners.change || []).forEach(fn => fn.call(this, { target: this })); }
  };
}
function fixture(options = {}) {
  const elements = {}, columns = {}, storage = {}, created = [], scheduled = [], frames = [];
  for (const side of ['red', 'black']) {
    const rows = ['provider', 'model', 'multi', 'style', 'quick'].map(name => domElement(side + '-' + name + '-row'));
    columns[side] = { rows, querySelectorAll: selector => { assert.strictEqual(selector, '.llm-only'); return rows; } };
    for (const name of ['enabled', 'type', 'provider', 'model', 'multi', 'style', 'quick']) {
      const element = elements['ai-' + side + '-' + name] = domElement('ai-' + side + '-' + name);
      element.closest = selector => { assert.strictEqual(selector, '.set-col'); return columns[side]; };
    }
  }
  for (const id of ['gear-toggle', 'settings-overlay', 'server-warn', 'move-log']) elements[id] = domElement(id);
  const context = { relayAvailable: false, _noKeysConfigured: false,
    document: { getElementById: id => elements[id], createElement: name => domElement(name), activeElement: null },
    localStorage: { getItem: key => storage[key] || null, setItem: (key, value) => { storage[key] = String(value); } },
    location: { host: 'localhost:8788' }, Date, agents: { red: null, black: null }, gameAbort: null,
    engine: { ply: () => 0, newGame() { this.restarts = (this.restarts || 0) + 1; } },
    startRecord: () => {}, refresh: () => {}, scheduleAgent: () => {}, closeAISettings: () => {},
    setTimeout: (fn, ms) => { scheduled.push({ fn, ms }); },
    requestAnimationFrame: fn => options.deferFrames ? frames.push(fn) : fn(),
    window: { confirm: () => true }, warnBanner: () => {}, selected: null, startTime: 0, aiBusy: false,
    XQ: { I18N: { t: key => key, tArgs: key => key },
      RandomAgent: { create: options => { created.push({ kind: 'random', options }); return options; } },
      LLMAgent: { create: options => { created.push({ kind: 'llm', options }); return options; } },
      CommitteeAgent: { create: options => { created.push({ kind: 'committee', options }); return options; } } }
  };
  Object.values(elements).forEach(element => {
    element.focus = function () { this.focused = true; context.document.activeElement = this; };
  });
  vm.createContext(context); vm.runInContext(functions, context, { filename: 'ui/app.js settings functions' });
  context.fillSettings({ red: { enabled: false, type: 'human', provider: 'deepseek', model: 'red-model', style: 'high', quick: true, multi: 'roundtable' },
    black: { enabled: true, type: 'random', provider: 'openai', model: 'openai:black-model', style: 'low', quick: false, multi: 'council' } });
  context.bindSettingsModes();
  return { context, elements, columns, storage, created, scheduled,
    nextFrame() { const fn = frames.shift(); if (fn) fn(); },
    flushFrames() { while (frames.length) frames.shift()(); },
    visible(side) { return columns[side].rows.every(row => row.style.display !== 'none'); },
    hidden(side) { return columns[side].rows.every(row => row.style.display === 'none'); },
    mode(side, enabled, type) { elements['ai-' + side + '-enabled'].checked = enabled;
      elements['ai-' + side + '-type'].value = type; elements['ai-' + side + '-type'].change(); } };
}

test('human and random hide LLM fields online, with each side independent', () => {
  const f = fixture(); f.context.setRelayAvailable(true);
  assert(f.hidden('red') && f.hidden('black'));
  f.mode('red', true, 'llm');
  assert(f.visible('red') && f.hidden('black'));
  assert.strictEqual(f.elements['server-warn'].style.display, 'none');
  f.mode('black', true, 'llm'); assert(f.visible('red') && f.visible('black'));
  f.mode('red', true, 'random'); assert(f.hidden('red') && f.visible('black'));
});
test('checkbox controls effective LLM mode without changing selected type', () => {
  const f = fixture(); f.context.setRelayAvailable(true); f.mode('red', true, 'llm');
  f.elements['ai-red-enabled'].checked = false; f.elements['ai-red-enabled'].change();
  assert(f.hidden('red')); assert.strictEqual(f.elements['ai-red-type'].value, 'llm');
  f.elements['ai-red-enabled'].checked = true; f.elements['ai-red-enabled'].change();
  assert(f.visible('red'));
});
test('type changes never auto-enable AI or erase hidden configuration', () => {
  const f = fixture(); f.context.setRelayAvailable(true);
  const original = JSON.stringify(f.context.readSettings().red);
  f.mode('red', false, 'llm'); assert(f.hidden('red')); assert(!f.elements['ai-red-enabled'].checked);
  f.mode('red', true, 'llm'); f.mode('red', true, 'random'); f.mode('red', false, 'human');
  assert.strictEqual(JSON.stringify(f.context.readSettings().red), original);
});
test('relay changes update open configuration immediately and only LLM gets warning', () => {
  const f = fixture();
  assert(f.hidden('red') && f.hidden('black'));
  assert.strictEqual(f.elements['server-warn'].style.display, 'none');
  f.mode('red', true, 'llm'); assert.strictEqual(f.elements['server-warn'].style.display, 'block');
  f.context.setRelayAvailable(true); assert(f.visible('red'));
  assert.strictEqual(f.elements['server-warn'].style.display, 'none');
  f.context.setRelayAvailable(false); assert(f.hidden('red'));
  assert.strictEqual(f.elements['server-warn'].style.display, 'block');
  f.mode('red', true, 'random'); assert.strictEqual(f.elements['server-warn'].style.display, 'none');
});
test('no-key warning follows only enabled LLM selections', () => {
  const f = fixture(); f.context.setRelayAvailable(true); f.context._noKeysConfigured = true;
  f.mode('red', true, 'llm'); assert(f.visible('red'));
  assert.strictEqual(f.elements['server-warn'].style.display, 'block');
  assert.strictEqual(f.elements['server-warn'].innerHTML, 'server_no_key');
  f.mode('red', false, 'llm'); assert.strictEqual(f.elements['server-warn'].style.display, 'none');
});
test('filling and reopening saved settings restores visibility and retains values', () => {
  const f = fixture(); f.context.setRelayAvailable(true);
  const saved = { red: { enabled: true, type: 'llm', provider: 'openai', model: 'A,B', style: 'high', quick: true, multi: 'roundtable' },
    black: { enabled: false, type: 'llm', provider: 'deepseek', model: 'C', style: 'none', quick: true, multi: 'off' } };
  f.storage.xq_v1_settings = JSON.stringify(saved); f.context.openAISettings();
  assert(f.visible('red') && f.hidden('black'));
  assert.deepStrictEqual(JSON.parse(JSON.stringify(f.context.readSettings())), saved);
  assert.strictEqual(f.elements['gear-toggle'].getAttribute('aria-expanded'), 'true');
  assert(f.elements['ai-red-enabled'].focused);
});
test('closing settings before deferred focus keeps focus on gear across both frame timings', () => {
  for (const advanceFirstFrame of [false, true]) {
    const f = fixture({ deferFrames: true });
    f.context.openAISettings();
    if (advanceFirstFrame) f.nextFrame();
    f.context.closeAISettings();
    assert.strictEqual(f.context.document.activeElement, f.elements['gear-toggle']);
    f.flushFrames();
    assert.strictEqual(f.context.document.activeElement, f.elements['gear-toggle']);
    assert.strictEqual(f.elements['ai-red-enabled'].focused, false);
    assert.strictEqual(f.elements['gear-toggle'].getAttribute('aria-expanded'), 'false');
  }
});
test('normal deferred opening still focuses the first settings control', () => {
  const f = fixture({ deferFrames: true });
  f.context.openAISettings(); f.flushFrames();
  assert.strictEqual(f.context.document.activeElement, f.elements['ai-red-enabled']);
  assert.strictEqual(f.elements['gear-toggle'].getAttribute('aria-expanded'), 'true');
});
test('saving offline human and random modes preserves dormant LLM fields and creates no LLM', () => {
  const f = fixture(); const expected = JSON.parse(JSON.stringify(f.context.readSettings()));
  f.context.saveAISettings();
  assert.deepStrictEqual(JSON.parse(f.storage.xq_v1_settings), expected);
  assert.strictEqual(f.context.agents.red, null); assert.strictEqual(f.context.agents.black.kind, 'random');
  assert.strictEqual(f.created.length, 1); assert.strictEqual(f.created[0].kind, 'random');
  assert.strictEqual(f.context.engine.restarts, 1); assert.strictEqual(f.scheduled[0].ms, 100);
});
test('saved enabled LLM mode remains active with all exact configuration values', () => {
  const f = fixture(); f.context.setRelayAvailable(true); f.mode('red', true, 'llm'); f.context.saveAISettings();
  const saved = JSON.parse(f.storage.xq_v1_settings);
  assert.strictEqual(saved.red.enabled, true); assert.strictEqual(saved.red.type, 'llm');
  assert.strictEqual(saved.red.model, 'red-model'); assert.strictEqual(saved.red.quick, true);
  assert.strictEqual(saved.red.multi, 'roundtable'); assert.strictEqual(saved.red.style, 'high');
  assert.strictEqual(f.context.agents.red.kind, 'llm');
  assert.strictEqual(f.created[0].options.model, 'red-model');
  assert.strictEqual(f.created[0].options.promptLevel, 'high');
  assert.strictEqual(f.created[0].options.thinking, 'disabled');
});
async function asyncTest(name, run) {
  await run(); passed++; console.log('  [PASS] ' + name);
}
(async function () {
  await asyncTest('empty provider list shows no-key warning and preserves static fallback configuration', async () => {
    const f = fixture(); f.context.setRelayAvailable(true); f.mode('red', true, 'llm');
    f.elements['ai-red-provider'].innerHTML = 'static-provider-fallback';
    const saved = JSON.stringify(f.context.readSettings());
    f.context.fetch = async () => ({ json: async () => ({ providers: [] }) });
    assert.strictEqual(f.context._noKeysConfigured, false);
    assert.strictEqual(await f.context.loadProviderOptions(), false);
    assert.strictEqual(f.context._noKeysConfigured, true);
    assert.strictEqual(f.elements['server-warn'].style.display, 'block');
    assert.strictEqual(f.elements['server-warn'].innerHTML, 'server_no_key');
    assert.strictEqual(f.elements['ai-red-provider'].innerHTML, 'static-provider-fallback');
    assert.strictEqual(JSON.stringify(f.context.readSettings()), saved);
    assert(f.visible('red') && f.hidden('black'));
  });
  await asyncTest('provider key changes refresh the warning without reopening settings', async () => {
    const f = fixture(); f.context.setRelayAvailable(true); f.mode('red', true, 'llm');
    let hasKey = false;
    f.context.fetch = async () => ({ json: async () => ({ providers: [
      { id: 'deepseek', name: 'DeepSeek', hasKey, models: ['default-red'] },
      { id: 'openai', name: 'OpenAI', hasKey: false, models: ['default-black'] }
    ] }) });
    assert.strictEqual(await f.context.loadProviderOptions(), true);
    assert.strictEqual(f.context._noKeysConfigured, true);
    assert.strictEqual(f.elements['server-warn'].style.display, 'block');
    assert.strictEqual(f.elements['ai-red-model'].value, 'red-model');
    assert.strictEqual(f.elements['ai-black-model'].value, 'openai:black-model');
    hasKey = true;
    assert.strictEqual(await f.context.loadProviderOptions(), true);
    assert.strictEqual(f.context._noKeysConfigured, false);
    assert.strictEqual(f.elements['server-warn'].style.display, 'none');
    f.mode('red', true, 'random');
    hasKey = false; await f.context.loadProviderOptions();
    assert.strictEqual(f.elements['server-warn'].style.display, 'none');
  });
  console.log('settings modes: ' + passed + '/' + passed + ' PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
