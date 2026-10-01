/* Real renderer and controller callbacks: provider data stays distinct from invented analysis. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
let passed = 0;
function test(name, run) {
  run(); passed++; console.log('  [PASS] ' + name);
}
function load(context, file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), context, { filename: file });
}
function appPart(start, end) {
  const source = fs.readFileSync(path.join(ROOT, 'ui/app.js'), 'utf8');
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert(from >= 0 && to > from, 'production controller boundary: ' + start);
  return source.slice(from, to);
}
function element(id, names = []) {
  const classes = new Set(names), attrs = {};
  const node = { id, children: [], dataset: {}, style: {}, hidden: false, clientWidth: 240, clientHeight: 160,
    scrollHeight: 200, scrollTop: 0, getBoundingClientRect: () => ({ width: 240, height: 160 }),
    appendChild(child) { this.children.push(child); child.parentNode = this; return child; },
    contains(child) { return this === child || this.children.some(item => item.contains(child)); },
    setAttribute(name, value) { attrs[name] = String(value); },
    getAttribute(name) { return attrs[name] || null; },
    removeAttribute(name) { delete attrs[name]; },
    addEventListener() {},
    querySelector(selector) { return this.querySelectorAll(selector)[0] || null; },
    querySelectorAll(selector) {
      const matches = candidate => {
        if (selector[0] === '#') return candidate.id === selector.slice(1);
        const wanted = [...selector.matchAll(/\.([\w-]+)/g)].map(match => match[1]);
        const attributes = [...selector.matchAll(/\[([\w-]+)(?:="([^"]*)")?\]/g)];
        return (wanted.length > 0 || attributes.length > 0)
          && wanted.every(name => candidate.classList.contains(name))
          && attributes.every(attribute => attribute[2] === undefined
            ? candidate.getAttribute(attribute[1]) !== null : candidate.getAttribute(attribute[1]) === attribute[2]);
      };
      const found = [];
      const visit = parent => parent.children.forEach(child => { if (matches(child)) found.push(child); visit(child); });
      visit(this); return found;
    }
  };
  node.classList = { contains: name => classes.has(name), add: name => classes.add(name), remove: name => classes.delete(name),
    toggle(name, enabled) { if (enabled === undefined) enabled = !classes.has(name); enabled ? classes.add(name) : classes.delete(name); return enabled; } };
  let textContent = '';
  Object.defineProperty(node, 'textContent', {
    get: () => textContent + node.children.map(child => child.textContent).join(''),
    set: value => { textContent = String(value); node.children.length = 0; }
  });
  let innerHTML = '';
  Object.defineProperty(node, 'innerHTML', {
    get: () => innerHTML,
    set: value => { if (node.forbidRebuild) throw new Error('stream update rebuilt ' + id); innerHTML = String(value); }
  });
  return node;
}
function fixture() {
  const ids = {}, documentBody = element('body');
  const document = { body: documentBody, documentElement: { dataset: {}, setAttribute() {} },
    activeElement: null, getElementById: id => ids[id] || null,
    querySelector: selector => documentBody.querySelector(selector),
    querySelectorAll: selector => documentBody.querySelectorAll(selector),
    addEventListener() {}, dispatchEvent() {}, createElement: () => element('') };
  const context = { console, document, Date, setTimeout, clearTimeout, setInterval, clearInterval, AbortController,
    TextEncoder, TextDecoder, Uint8Array,
    getComputedStyle: () => ({ fontSize: '14px', lineHeight: '22px', fontStyle: 'normal', fontWeight: '400', fontFamily: 'sans-serif' }),
    localStorage: { getItem: () => null, setItem() {} }, CustomEvent: function (type) { this.type = type; } };
  context.window = context; vm.createContext(context);
  load(context, 'ui/i18n.js'); load(context, 'ui/renderer.js');
  const UI = context.XQ.UI;
  function mount(side) {
    const root = ids['think-' + side] = documentBody.appendChild(element('think-' + side, ['think-panel']));
    const body = ids['think-' + side + '-body'] = root.appendChild(element('think-' + side + '-body', ['think-body', 'card-mode']));
    const pager = root.appendChild(element('pager-' + side, ['think-pager']));
    for (const name of ['prev', 'info', 'next']) pager.appendChild(element('pager-' + side + '-' + name, ['pg-' + name]));
    const old = body.appendChild(element('old-' + side, ['dcard']));
    const toggle = old.appendChild(element('toggle-' + side, ['d-toggle']));
    toggle.dataset.ply = '4'; toggle.setAttribute('aria-expanded', 'true');
    const reasoning = old.appendChild(element('reasoning-' + side, ['d-reason']));
    reasoning.textContent = 'previous model explanation'; reasoning.style.display = 'block';
    const card = body.appendChild(element('current-' + side, ['dcard', 'd-thinking']));
    card.dataset.phase = 'waiting';
    const nodes = {};
    for (const name of ['phase', 'progress', 'stream', 'source', 'retry']) {
      nodes[name] = card.appendChild(element('thinking-' + side + '-' + name, ['d-thinking-' + name]));
    }
    body.forbidRebuild = true; card.forbidRebuild = true; old.forbidRebuild = true;
    return { root, body, old, toggle, reasoning, card, nodes };
  }
  return { context, document, ids, UI, mount };
}
function callbackFixture() {
  const f = fixture(), ctx = f.context, created = [], updates = [];
  load(ctx, 'ai/llm_agent.js');
  const makeAgent = options => { const agent = {}; created.push({ options, agent }); return agent; };
  ctx.XQ.LLMAgent.create = makeAgent; ctx.XQ.CommitteeAgent = { create: makeAgent };
  ctx.XQ.UI.updateThinking = (side, data) => { updates.push({ side, data }); return true; };
  Object.assign(ctx, { relayAvailable: true, agents: { red: null, black: null }, aiBusy: true,
    view: { aiThinkingSide: 'red' }, gameAbort: new AbortController(), readSettings: () => ({}), warnBanner() {},
    showThinking() { throw new Error('provider callback fell back to a full panel replacement'); } });
  f.ids['gear-toggle'] = element('gear-toggle');
  vm.runInContext(appPart('  var SIDE_DEFS = {', '  function settingsLLMActive(')
    + appPart('  function cleanReason(', '  function showThinking(')
    + appPart('  function applyAgents(', '  function closeAISettings('), ctx);
  function configure(model = 'A,B') {
    ctx.applyAgents({ red: { enabled: true, type: 'llm', provider: 'deepseek', model, style: 'high', multi: 'roundtable' },
      black: { enabled: false, type: 'human' } });
    return created[created.length - 1].options;
  }
  return { ...f, created, updates, configure };
}

test('actual provider callbacks expose streaming, proposal, final and retry phases', () => {
  const f = callbackFixture(), options = f.configure();
  options.onThinking('red', '先保护中兵，再准备兑子。');
  options.onProgress({ side: 'red', phase: 'proposal', answered: 1, total: 2 });
  options.onProgress({ side: 'red', phase: 'final', answered: 2, total: 2 });
  options.onRetry({ attempt: 2, waitMs: 3000 });
  assert.deepStrictEqual(f.updates.map(update => update.data.phase), ['streaming', 'proposal', 'final', 'retry']);
  assert.strictEqual(f.updates[0].data.text, '先保护中兵，再准备兑子。');
  assert(f.updates[1].data.progress.includes('1/2') && f.updates[2].data.progress.includes('2/2'));
  assert.strictEqual(f.updates[3].data.retry, 2);
  assert.strictEqual(f.context.view.aiRetries.red, 2); assert.strictEqual(f.context.view.aiRetryWait, 3000);
});
test('old agent callbacks cannot change a replacement agent or its retry counters', () => {
  const f = callbackFixture(), old = f.configure(); f.configure('C,D');
  old.onThinking('red', '旧模型迟到文本'); old.onProgress({ side: 'red', phase: 'final', answered: 2, total: 2 });
  old.onRetry({ attempt: 99, waitMs: 99999 });
  assert.strictEqual(f.updates.length, 0); assert.strictEqual(f.context.view.aiRetries, undefined);
});
test('inactive/new-game and wrong-side callbacks cannot publish thinking; same agent can resume', () => {
  const f = callbackFixture(), options = f.configure();
  f.context.aiBusy = false;
  options.onThinking('red', '迟到文本'); options.onRetry({ attempt: 9 });
  options.onProgress({ side: 'red', phase: 'proposal', answered: 1, total: 2 });
  f.context.aiBusy = true; f.context.view.aiThinkingSide = 'black';
  options.onThinking('red', '错误方文本'); options.onRetry({ attempt: 9 });
  options.onProgress({ side: 'red', phase: 'final', answered: 2, total: 2 });
  f.context.view.aiThinkingSide = 'red';
  options.onThinking('black', '错误回调方'); options.onProgress({ side: 'black', phase: 'final', answered: 2, total: 2 });
  assert.strictEqual(f.updates.length, 0);
  const oldSignal = options.signal(); f.context.gameAbort.abort(); f.context.gameAbort = new AbortController();
  assert(oldSignal.aborted); assert(!options.signal().aborted); assert.notStrictEqual(options.signal(), oldSignal);
  options.onThinking('red', '新局正常思考');
  assert.strictEqual(f.updates.length, 1); assert.strictEqual(f.updates[0].data.text, '新局正常思考');
});

test('first single-model turn creates a waiting card before any provider thinking exists', () => {
  const f = callbackFixture(); f.configure('A');
  const panels = [], timers = [];
  f.context.XQ.UI.thinkPanel = (side, opts) => panels.push({ side, opts });
  Object.assign(f.context, { currentRecord: { moves: [] }, aiBusy: false, gameId: 1, decisionLog: { red: [], black: [] },
    engine: { isOver: () => false, turn: () => 'red' }, agentFor: side => f.context.agents[side],
    decisionPanelOpts: () => ({}), infoHTML: () => '', refresh() {},
    bannerThinking: (model, side) => { f.context.view.aiThinkingSide = side; },
    setTimeout: (fn, ms) => { timers.push({ fn, ms }); } });
  vm.runInContext(appPart('  function scheduleAgent()', '  /* ── 设置 ── */'), f.context);
  f.context.scheduleAgent();
  const panel = panels.find(item => item.side === 'red');
  assert(panel && panel.opts.cards && panel.opts.cards.length === 1);
  assert(panel.opts.cards[0].includes('class="dcard d-thinking"') && panel.opts.cards[0].includes('data-phase="waiting"'));
  assert(/class="d-thinking-source" hidden><\/div>/.test(panel.opts.cards[0]));
  assert.strictEqual(timers[0].ms, 350);
});
test('thinking-card text is escaped and missing provider text remains explicitly absent', () => {
  const f = fixture();
  const html = f.UI.thinkingCard({ phase: 'streaming', text: '<img src=x onerror="x"> & \'quoted\'', progress: '<script>x</script>', retry: 2 });
  assert(!html.includes('<img') && !html.includes('<script'));
  assert(html.includes('&lt;img') && html.includes('&quot;') && html.includes('&#39;') && html.includes('&amp;'));
  const empty = f.UI.thinkingCard({ phase: 'waiting' });
  assert(/class="d-thinking-source" hidden><\/div>/.test(empty));
  assert(/class="d-thinking-stream" hidden><\/div>/.test(empty));
  assert(!empty.includes(f.context.XQ.I18N.t('thinking_model_source')));
  const invalid = f.UI.thinkingCard({ phase: '\" onclick=\"x', retry: '<script>' });
  assert(invalid.includes('data-phase="waiting"') && !invalid.includes('onclick='));
  assert(!invalid.includes('data-retry='));
});
test('live updates preserve historical cards, expanded reasoning and keyboard focus', () => {
  const f = fixture(), m = f.mount('red'); f.document.activeElement = m.toggle;
  m.nodes.stream.textContent = '真实第一段'; m.nodes.progress.textContent = '1/2';
  for (const phase of ['waiting', 'streaming', 'proposal', 'final', 'retry']) {
    assert.strictEqual(f.UI.updateThinking('red', { phase, text: '模型最新文本', progress: '2/2', retry: 2 }), true);
    assert.strictEqual(m.card.dataset.phase, phase);
    assert.strictEqual(m.nodes.phase.textContent, f.context.XQ.I18N.t('thinking_phase_' + phase));
    assert.strictEqual(m.body.children[0], m.old); assert.strictEqual(m.body.children[1], m.card);
    assert.strictEqual(f.document.activeElement, m.toggle); assert.strictEqual(m.toggle.getAttribute('aria-expanded'), 'true');
    assert.strictEqual(m.reasoning.textContent, 'previous model explanation'); assert.strictEqual(m.reasoning.style.display, 'block');
  }
  assert.strictEqual(m.nodes.source.hidden, false); assert.strictEqual(m.nodes.stream.textContent, '模型最新文本');
});
test('partial live updates preserve actual provider text; explicit clearing removes its source label', () => {
  const f = fixture(), m = f.mount('red');
  f.UI.updateThinking('red', { phase: 'streaming', text: '<script>literal text</script>', progress: '1/2', retry: 2 });
  f.UI.updateThinking('red', { phase: 'final', progress: '2/2' });
  assert.strictEqual(m.nodes.stream.textContent, '<script>literal text</script>');
  assert.strictEqual(m.nodes.progress.textContent, '2/2'); assert.strictEqual(m.nodes.retry.hidden, false);
  const copy = f.UI.thinkingState('red'); copy.text = 'changed copy'; copy.phase = 'waiting';
  assert.strictEqual(f.UI.thinkingState('red').text, '<script>literal text</script>');
  assert.strictEqual(f.UI.thinkingState('red').phase, 'final');
  f.UI.updateThinking('red', { text: '', progress: '', retry: null });
  assert.strictEqual(m.nodes.stream.hidden, true); assert.strictEqual(m.nodes.source.hidden, true);
  assert.strictEqual(m.nodes.source.textContent, ''); assert.strictEqual(m.nodes.retry.hidden, true);
  assert.strictEqual(m.nodes.progress.hidden, true);
});
test('new-game text replacement removes thinking state; late or invalid-side updates do nothing', () => {
  const f = fixture(), m = f.mount('red'); f.mount('black');
  assert.strictEqual(f.UI.updateThinking('purple', { text: 'invalid side' }), false);
  assert.strictEqual(f.UI.thinkingState('purple'), null);
  f.UI.updateThinking('red', { phase: 'streaming', text: '旧局文本' });
  f.UI.thinkPanel('red', { text: f.context.XQ.I18N.t('think_wait'), active: false });
  assert.strictEqual(m.body.children.length, 0); assert.strictEqual(f.UI.thinkingState('red'), null);
  assert.strictEqual(f.UI.updateThinking('red', { text: '迟到旧文本' }), false);
  assert.strictEqual(m.body.textContent, f.context.XQ.I18N.t('think_wait'));
});
test('real i18n apply cannot overwrite dynamic cards or erase their live thinking state', () => {
  const f = fixture(), m = f.mount('red');
  m.body.setAttribute('data-i18n', 'status_idle'); m.body.forbidRebuild = false;
  const markup = f.UI.thinkingCard({ phase: 'streaming', text: '保护中兵的实时分析', progress: '1/2' });
  // The mounted card nodes represent the browser's HTML result; string escaping is tested separately.
  f.UI.thinkPanel('red', { cards: [markup], active: true }); m.body.forbidRebuild = true;
  f.UI.updateThinking('red', { phase: 'streaming', text: '保护中兵的实时分析', progress: '1/2' });
  assert.strictEqual(m.body.getAttribute('data-i18n'), null);
  f.context.XQ.I18N.setLang('en', false); // Executes production apply, including textContent replacement on bound nodes.
  assert.strictEqual(m.body.children[1], m.card);
  assert.strictEqual(f.UI.thinkingState('red').text, '保护中兵的实时分析');
  assert.strictEqual(f.UI.thinkingState('red').progress, '1/2');
  f.UI.updateThinking('red', {});
  assert.strictEqual(m.nodes.phase.textContent, f.context.XQ.I18N.t('thinking_phase_streaming'));
});
test('only explicit cards/text rendering removes the initial body translation binding', () => {
  const f = fixture(), m = f.mount('red');
  m.body.textContent = 'initial placeholder'; m.body.setAttribute('data-i18n', 'status_idle');
  for (const opts of [{ stat: '1 move' }, { name: 'Red' }, { active: false }, { info: 'model' }]) {
    f.UI.thinkPanel('red', opts); assert.strictEqual(m.body.getAttribute('data-i18n'), 'status_idle');
  }
  f.context.XQ.I18N.setLang('en', false);
  assert.strictEqual(m.body.textContent, f.context.XQ.I18N.t('status_idle'));
  f.UI.thinkPanel('red', { text: 'provider dynamic text' });
  assert.strictEqual(m.body.getAttribute('data-i18n'), null);
  f.context.XQ.I18N.setLang('zh', false); assert.strictEqual(m.body.textContent, 'provider dynamic text');
});
test('legacy random thinking cards are not exposed as model-provided thoughts', () => {
  const f = fixture(), m = f.mount('red'); delete m.card.dataset.phase;
  m.nodes.stream.textContent = 'legacy random placeholder';
  assert.strictEqual(f.UI.thinkingState('red'), null);
  assert.strictEqual(f.UI.updateThinking('red', { phase: 'streaming', text: 'not model data' }), false);
  assert.strictEqual(m.nodes.stream.textContent, 'legacy random placeholder');
});
test('completed decisions show only supplied path steps and retain candidate origin and destination', () => {
  const f = fixture();
  const minimal = f.UI.decisionCards([{ n: 1, name: 'b3-e3', confidence: 0.8 }], 1)[0];
  assert(!minimal.includes('d-path-step') && !minimal.includes('d-plan') && !minimal.includes('d-cands') && !minimal.includes('d-sum'));
  assert(minimal.includes(f.context.XQ.I18N.t('d_conf')) && !minimal.includes('%'));
  const rich = f.UI.decisionCards([{ n: 2, name: 'b3-e3', plan: '稳住中路', summary: '保护中兵',
    candidates: [{ move: 'b3-e3*', score: '+0.2' }, { move: 'h3-e3', score: '+0.1' }] }], 1)[0];
  assert.strictEqual((rich.match(/d-path-step/g) || []).length, 3);
  assert(rich.includes('data-from="b3" data-to="e3"') && rich.includes('data-from="h3" data-to="e3"'));
  assert(rich.includes('稳住中路') && rich.includes('保护中兵') && rich.includes('d-cand-win'));
  const invalid = f.UI.decisionCards([{ n: 3, name: 'x', candidates: [{ move: 'x3-e3', score: '<img>' }] }], 1)[0];
  assert(!invalid.includes('data-from=') && invalid.includes('&lt;img&gt;'));
});
test('completed model names, move numbers and reasoning cannot break quoted attributes or create elements', () => {
  const f = fixture();
  const html = f.UI.decisionCards([{ n: '1\" autofocus=\"x', name: '<img>', voterName: 'm\" onmouseover=\"evil',
    summary: '<script>bad</script>', plan: '<svg>', reasoning: '<iframe>', confidence: '<button>' }], 1)[0];
  assert(!/<(?:img|script|svg|iframe|button)>/.test(html));
  assert(html.includes('title="m&quot; onmouseover=&quot;evil"'));
  assert(!html.includes('title="m" onmouseover="evil"'));
  assert(html.includes('data-ply="1&quot; autofocus=&quot;x"'));
  assert(html.includes('&lt;iframe&gt;') && html.includes('&lt;button&gt;'));
});
test('completed explanations distinguish genuine model thoughts from summary, fallback and vote sources', () => {
  const f = fixture();
  const examples = [
    { reasoning: '先检查王城风险，再决定出车。', key: 'thinking_model_source' },
    { reasoning: '【快答·未开思考】保护中路', key: 'thinking_summary_source' },
    { reasoning: '[轮换] A\n【快答·未开思考】保护中路', key: 'thinking_summary_source' },
    { reasoning: '【兑底】系统选择合法着法', key: 'thinking_fallback_source' },
    { reasoning: '其他兜底说明', fallback: true, key: 'thinking_fallback_source' },
    { reasoning: '系统统计两票赞成', committeeMode: 'council', key: 'thinking_vote_source' },
    { reasoning: '圆桌终判汇总', committeeMode: 'roundtable', key: 'thinking_vote_source' },
    { reasoning: '同侪会诊 2票胜出', key: 'thinking_vote_source' }
  ];
  for (const language of ['zh', 'en']) {
    f.context.XQ.I18N.setLang(language, false);
    for (const example of examples) {
      const html = f.UI.decisionCards([{ n: 1, name: 'b3-e3', ...example }], 1)[0];
      const label = /<div class="d-reason-source">([^<]*)<\/div>/.exec(html);
      assert(label); assert.strictEqual(label[1], f.context.XQ.I18N.t(example.key));
      if (example.key !== 'thinking_model_source') assert.notStrictEqual(label[1], f.context.XQ.I18N.t('thinking_model_source'));
    }
  }
});
test('spectator meter distinguishes estimated percentages, actual result, draw and unavailable', () => {
  const f = fixture();
  for (const id of ['spectator-meter', 'spectator-red-fill', 'spectator-black-fill', 'spectator-red-value', 'spectator-black-value', 'spectator-meter-note']) {
    f.ids[id] = element(id);
  }
  const engine = {}, snap = {};
  let estimate = { status: 'estimate', red: 62, black: 38 };
  f.context.XQ.Spectator = { estimate: (actualEngine, actualSnapshot) => {
    assert.strictEqual(actualEngine, engine); assert.strictEqual(actualSnapshot, snap); return estimate;
  } };
  f.UI.renderSpectatorMeter(engine, snap);
  assert.strictEqual(f.ids['spectator-red-value'].textContent, '62%');
  assert.strictEqual(f.ids['spectator-black-value'].textContent, '38%');
  assert.strictEqual(f.ids['spectator-red-fill'].style.width, '62%');
  estimate = { status: 'draw', red: 50, black: 50 }; f.UI.renderSpectatorMeter(engine, snap);
  assert.strictEqual(f.ids['spectator-meter'].dataset.status, 'draw');
  assert.strictEqual(f.ids['spectator-red-value'].textContent, f.context.XQ.I18N.t('spectator_draw'));
  assert(!f.ids['spectator-black-value'].textContent.includes('%'));
  estimate = { status: 'red-win' }; f.UI.renderSpectatorMeter(engine, snap);
  assert.strictEqual(f.ids['spectator-red-value'].textContent, f.context.XQ.I18N.t('spectator_won'));
  assert.strictEqual(f.ids['spectator-black-fill'].style.width, '0%');
  for (const invalid of [{ status: 'unavailable' }, { status: 'estimate', red: NaN, black: 50 }, { status: 'estimate', red: 120, black: -20 }]) {
    estimate = invalid; f.UI.renderSpectatorMeter(engine, snap);
    assert.strictEqual(f.ids['spectator-meter'].dataset.status, 'unavailable');
    assert.strictEqual(f.ids['spectator-red-value'].textContent, '—');
    assert.strictEqual(f.ids['spectator-black-value'].textContent, '—');
    assert.strictEqual(f.ids['spectator-red-fill'].style.width, '0%');
    assert.strictEqual(f.ids['spectator-black-fill'].style.width, '0%');
  }
});

async function testAsync(name, run) { await run(); passed++; console.log('  [PASS] ' + name); }
async function providerCase(format, reasoning, quick = false) {
  const f = fixture(), emitted = [];
  for (const file of ['core/piece.js', 'core/move.js', 'core/board.js', 'core/rules.js', 'core/generator.js',
    'core/judge.js', 'core/engine.js', 'evaluation/xiangqi_knowledge.js', 'evaluation/position.js', 'ai/llm_agent.js']) load(f.context, file);
  const payload = { from: 'b3', to: 'e3', summary: '保护中路', confidence: 0.8 };
  let calls = 0;
  f.context.fetch = async () => {
    calls++;
    if (format === 'json') return { ok: true, headers: { get: () => 'application/json' },
      json: async () => ({ choices: [{ message: { content: JSON.stringify(payload), reasoning_content: reasoning } }] }) };
    const delta = { content: JSON.stringify(payload) };
    if (reasoning !== undefined) delta.reasoning_content = reasoning;
    const chunks = ['data: ' + JSON.stringify({ choices: [{ delta }] }) + '\n\n', 'data: [DONE]\n\n'];
    return { ok: true, headers: { get: () => 'text/event-stream' }, body: { getReader: () => ({
      read: async () => chunks.length ? { done: false, value: new TextEncoder().encode(chunks.shift()) } : { done: true }, cancel: async () => {} }) } };
  };
  const agent = f.context.XQ.LLMAgent.create({ side: 'red', provider: 'mock', model: 'mock', quick,
    onThinking: (side, text) => emitted.push({ side, text }) });
  const move = await agent.next(f.context.XQ.Engine.create());
  assert.strictEqual(calls, 1); assert.strictEqual(move.from.x, 1); assert.strictEqual(move.to.x, 4);
  return { f, emitted, move };
}
(async function () {
  await testAsync('real JSON and SSE without provider reasoning never invent a visible thinking stream', async () => {
    for (const format of ['json', 'sse']) {
      for (const reasoning of [undefined, '', 'Only English analysis']) {
        const result = await providerCase(format, reasoning);
        assert.strictEqual(result.emitted.length, 0, format + ': only actual supported reasoning may be emitted');
        assert.strictEqual(result.move.meta.reasoning, '');
      }
      const result = await providerCase(format, '先稳住中路，再保护中兵。');
      assert(result.emitted.length > 0); assert.strictEqual(result.emitted[0].text, '先稳住中路，再保护中兵。');
    }
  });
  await testAsync('quick-answer explanation retains its explicit no-thinking marker in completed decisions', async () => {
    const result = await providerCase('json', undefined, true);
    assert.strictEqual(result.emitted.length, 0);
    assert(result.move.meta.reasoning.startsWith('【快答·未开思考】'));
    const html = result.f.UI.decisionCards([{ n: 1, name: 'b3-e3', ...result.move.meta }], 1)[0];
    assert(html.includes('【快答·未开思考】') && html.includes('保护中路'));
    assert(!html.includes('d-thinking-source'));
  });
  console.log('thinking visuals: ' + passed + '/' + passed + ' PASS');
})().catch(error => { console.error(error); process.exitCode = 1; });
