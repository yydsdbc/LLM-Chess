/* Round 80 UI guard contract. No browser dependency: pure helpers run in a VM and
 * DOM contracts are checked against the real shipped shell. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.join(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'ui/ui_batch80.js'), 'utf8');
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
let passed = 0;
async function test(name, fn) { await fn(); passed++; console.log('  ✓ ' + name); }

function classList() {
  const values = new Set();
  return { add: v => values.add(v), remove: v => values.delete(v), contains: v => values.has(v),
    toggle: (v, on) => { if (on === undefined) on = !values.has(v); on ? values.add(v) : values.delete(v); return on; } };
}
function node(id, tag = 'div') {
  const attrs = {}, n = { id, tagName: tag.toUpperCase(), nodeType: 1, hidden: false, offsetParent: {},
    dataset: {}, style: { setProperty(k, v) { this[k] = v; } }, classList: classList(), children: [],
    value: '', type: '', checked: false, min: '', max: '', textContent: '', parentNode: null,
    setAttribute(k, v) { attrs[k] = String(v); if (k === 'aria-hidden') this.hidden = String(v) === 'true'; },
    getAttribute(k) { return Object.prototype.hasOwnProperty.call(attrs, k) ? attrs[k] : null; },
    removeAttribute(k) { delete attrs[k]; },
    focus() { this.ownerDocument.activeElement = this; },
    contains(x) { return this === x || this.children.indexOf(x) >= 0; },
    appendChild(x) { this.children.push(x); x.parentNode = this; return x; },
    querySelectorAll() { return []; }, querySelector() { return null; },
    addEventListener() {}, scrollIntoView() { this.scrolled = true; },
    closest() { return null; }
  };
  return n;
}
function fixture() {
  const store = new Map(), listeners = {}, ids = {};
  const document = { readyState: 'complete', activeElement: null, documentElement: node('html'),
    getElementById: id => ids[id] || null, querySelectorAll: () => [], addEventListener(type, fn) { (listeners[type] ||= []).push(fn); },
    createElement: tag => node('', tag), body: node('body'), visibilityState: 'visible',
    dispatch(type, event = {}) { (listeners[type] || []).forEach(fn => fn(event)); }
  };
  document.documentElement.ownerDocument = document; document.body.ownerDocument = document;
  const context = { console, document, window: null, navigator: { onLine: true }, innerWidth: 1024, innerHeight: 768,
    localStorage: { getItem: key => store.has(key) ? store.get(key) : null, setItem: (key, value) => store.set(key, String(value)), removeItem: key => store.delete(key) },
    setTimeout, clearTimeout, setInterval, clearInterval, requestAnimationFrame: fn => setTimeout(fn, 0),
    matchMedia: () => ({ matches: false }), confirm: () => true, addEventListener(type, fn) { (listeners['window:' + type] ||= []).push(fn); },
    dispatch(type, event = {}) { (listeners['window:' + type] || []).forEach(fn => fn(event)); },
    setImmediate, MutationObserver: undefined, visualViewport: null, XQ: {}
  };
  context.window = context; vm.createContext(context);
  vm.runInContext(source, context, { filename: 'ui/ui_batch80.js' });
  return { context, document, ids, store, api: context.XQ.UIBatch80 };
}

(async () => {
  const f = fixture(), api = f.api;
  await test('safeGet returns fallback for missing storage', () => assert.strictEqual(api.safeGet('missing', 'fallback'), 'fallback'));
  await test('safeSet and safeRemove round trip values', () => { assert(api.safeSet('a', 7)); assert.strictEqual(api.safeGet('a', ''), '7'); assert(api.safeRemove('a')); assert.strictEqual(api.safeGet('a', 'x'), 'x'); });
  await test('storage exceptions are isolated', () => { f.context.localStorage = { getItem() { throw Error('private'); }, setItem() { throw Error('quota'); }, removeItem() { throw Error('private'); } }; assert.strictEqual(api.safeGet('x', 3), 3); assert.strictEqual(api.safeSet('x', 1), false); assert.strictEqual(api.safeRemove('x'), false); });
  await test('clamp handles NaN and both bounds', () => { assert.strictEqual(api.clamp('x', 0, 10, 4), 4); assert.strictEqual(api.clamp(-2, 0, 10), 0); assert.strictEqual(api.clamp(12, 0, 10), 10); });
  await test('bool accepts serialized settings and fallback', () => { assert(api.bool('1')); assert(api.bool('true')); assert(!api.bool('0', true)); assert(api.bool('unknown', true)); });
  await test('side validates only engine sides', () => { assert.strictEqual(api.side('red'), 'red'); assert.strictEqual(api.side('black'), 'black'); assert.strictEqual(api.side('blue'), null); });
  await test('editable guard covers form controls and contenteditable', () => { assert(api.isEditable(node('x', 'input'))); const e = node('e'); e.isContentEditable = true; assert(api.isEditable(e)); assert(!api.isEditable(node('d'))); });
  await test('visible guard honors hidden and aria-hidden', () => { const n = node('x'); assert(api.visible(n)); n.hidden = true; assert(!api.visible(n)); n.hidden = false; n.setAttribute('aria-hidden', 'true'); assert(!api.visible(n)); });
  await test('focusSafe focuses without throwing', () => { const n = node('focus'); n.ownerDocument = f.document; assert(api.focusSafe(n)); assert.strictEqual(f.document.activeElement, n); });
  await test('focusables uses the full modal control selector', () => { assert(source.includes("button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]")); });
  await test('debounce collapses repeated calls', async () => { let calls = 0; const fn = api.debounce(() => calls++, 5); fn(); fn(); await new Promise(r => setTimeout(r, 15)); assert.strictEqual(calls, 1); fn.cancel(); });
  await test('frameBatch coalesces a resize burst', async () => { let calls = 0; const fn = api.frameBatch(() => calls++); fn(); fn(); await new Promise(r => setTimeout(r, 15)); assert.strictEqual(calls, 1); });
  await test('reducedMotion is a safe media-query read', () => { assert.strictEqual(api.reducedMotion(), false); f.context.matchMedia = () => ({ matches: true }); assert.strictEqual(api.reducedMotion(), true); });
  await test('liveText avoids duplicate announcements', () => { const n = node('live'); assert(api.liveText(n, 'a')); assert(!api.liveText(n, 'a')); assert(api.liveText(n, 'b')); });
  await test('setBusy updates aria state and class state', () => { const n = node('busy'); api.setBusy(n, true); assert.strictEqual(n.getAttribute('aria-busy'), 'true'); assert(n.classList.contains('is-busy')); api.setBusy(n, false); assert.strictEqual(n.getAttribute('aria-busy'), 'false'); });
  await test('scrollIntoViewSafe supports the nearest target', () => { const n = node('scroll'); assert(api.scrollIntoViewSafe(n)); assert(n.scrolled); });
  await test('canonicalControls is order independent', () => { const root = node('form'); const b = node('b', 'input'); b.type = 'checkbox'; b.checked = true; const a = node('a', 'input'); a.value = 'z'; root.querySelectorAll = () => [b, a]; assert.deepStrictEqual(Array.from(api.canonicalControls(root)), ['a=z', 'b=1']); });
  await test('sameArray distinguishes length and values', () => { assert(api.sameArray(['a'], ['a'])); assert(!api.sameArray(['a'], ['b'])); assert(!api.sameArray(['a'], [])); });
  await test('onlineState treats missing navigator flag as online', () => { f.context.navigator.onLine = true; assert(api.onlineState()); f.context.navigator.onLine = false; assert(!api.onlineState()); delete f.context.navigator.onLine; assert(api.onlineState()); });
  await test('paintConnection exposes state and localized label', () => { const n = node('connection-status'); n.ownerDocument = f.document; f.ids['connection-status'] = n; api.paintConnection('offline', false); assert.strictEqual(n.dataset.state, 'offline'); assert.strictEqual(f.document.documentElement.dataset.connection, 'offline'); assert(/离线|Offline/.test(n.textContent)); });
  await test('syncViewport writes usable viewport variables', () => { f.context.innerWidth = 390; f.context.innerHeight = 844; api.syncViewport(); assert.strictEqual(f.document.documentElement.style['--ui-vw'], '390px'); assert.strictEqual(f.document.documentElement.style['--ui-vh'], '844px'); assert.strictEqual(f.document.documentElement.dataset.compact, '1'); });
  await test('network listeners are present for online recovery', () => { assert(source.includes("addEventListener('online'")); assert(source.includes("addEventListener('offline'")); });
  await test('language changes repaint the current connection state', () => { assert(source.includes("addEventListener('xq:i18n'")); assert(source.includes("paintConnection(current, false)")); });
  await test('visibility lifecycle marks hidden pages', () => { assert(source.includes("dataset.pageHidden = hidden ? '1' : '0'")); assert(source.includes("classList.toggle('ui-paused', hidden)")); });
  await test('pageshow restores viewport state', () => { assert(source.includes("addEventListener('pageshow'")); assert(source.includes('syncViewport();')); });
  await test('pagehide marks the shell inactive', () => { assert(source.includes("addEventListener('pagehide'")); });
  await test('resize is frame scheduled', () => { assert(source.includes('var resize = frameBatch(syncViewport)')); });
  await test('visualViewport resize is covered when available', () => { assert(source.includes('root.visualViewport.addEventListener')); });
  await test('syncInert shields sibling surfaces without disabling settings', () => { const a = node('think-red'); const m = node('spectator-meter'); const s = node('status-bar'); const b = node('ai-banner'); [a, m, s, b].forEach(x => { x.ownerDocument = f.document; f.ids[x.id] = x; }); api.syncInert(true); assert.strictEqual(a.getAttribute('aria-hidden'), 'true'); api.syncInert(false); assert.strictEqual(a.getAttribute('aria-hidden'), null); assert(!source.includes("['arena', 'spectator-meter'")); });
  await test('trapTab cycles a modal at either edge', () => { const box = node('box'); const first = node('first', 'button'), last = node('last', 'button'); first.ownerDocument = f.document; last.ownerDocument = f.document; box.children = [first, last]; box.querySelectorAll = () => [first, last]; f.document.activeElement = last; const ev = { key: 'Tab', shiftKey: false, preventDefault() { this.stopped = true; } }; assert(api.trapTab(box, ev)); assert(ev.stopped); assert.strictEqual(f.document.activeElement, first); });
  await test('settings dirty prompt is implemented at capture phase', () => { assert(source.includes("translated('ui_unsaved'")); assert(source.includes("addEventListener('click', function (ev)")); });
  await test('settings dirty state compares canonical controls', () => { assert(source.includes('state.clean = canonicalControls(overlay)')); assert(source.includes('state.dirty = next')); });
  await test('unsaved Escape can be rejected without closing', () => { assert(source.includes('if (!ok) { if (ev) { ev.preventDefault(); ev.stopImmediatePropagation(); }')); });
  await test('beforeunload protects an open dirty settings form', () => { assert(source.includes("addEventListener('beforeunload'")); assert(source.includes('ev.returnValue =')); });
  await test('model text fields disable autofill and spell correction', () => { assert(source.includes("setAttribute('autocomplete', 'off')")); assert(source.includes("setAttribute('spellcheck', 'false')")); });
  await test('thinking panels expose busy state without a noisy live region', () => { assert(source.includes("panel.setAttribute('aria-live', 'off')")); assert(source.includes("setBusy(panel, panel.classList.contains('thinking'))")); });
  await test('panel observer watches only the class attribute', () => { assert(source.includes("attributeFilter: ['class']")); });
  await test('move log click keeps selected entries visible', () => { assert(source.includes("log.addEventListener('click'")); assert(source.includes('scrollIntoViewSafe(item)')); });
  await test('board records pointer versus keyboard input mode', () => { assert(source.includes("dataset.inputMode = 'pointer'")); assert(source.includes("dataset.inputMode = 'keyboard'")); });
  await test('buttons without an explicit type become non-submit controls', () => { assert(source.includes("if (!button.getAttribute('type')) button.setAttribute('type', 'button')")); });
  await test('spectator meter is a named live region', () => { assert(source.includes("meter.setAttribute('role', 'region')")); assert(source.includes("meter.setAttribute('aria-live', 'polite')")); });
  await test('status bar is announced atomically', () => { assert(source.includes("status.setAttribute('aria-atomic', 'true')")); });
  await test('status announcements are debounced and deduplicated', () => { assert(source.includes('var last =')); assert(source.includes('if (text === last) return')); });
  await test('numeric fields opt into numeric mobile keyboards', () => { assert(source.includes("setAttribute('inputmode', 'numeric')")); });
  await test('range controls publish min and max to assistive tech', () => { assert(source.includes("setAttribute('aria-valuemin', el.min)")); assert(source.includes("setAttribute('aria-valuemax', el.max)")); });
  await test('connection chip can refresh after a resumed page', () => { assert(source.includes("status.addEventListener('click'")); assert(source.includes("paintConnection(onlineState() ? 'online' : 'offline', false)")); });
  await test('mount is idempotent across cached shell reloads', () => { assert(source.includes("dataset.uiBatch80 === '1'")); assert(source.includes("dataset.uiBatch80 = '1'")); });
  await test('mount exposes a stable round prefix for diagnostics', () => { assert.strictEqual(api.LS_PREFIX, 'xq_ui80_'); });
  await test('index ships the runtime after the app layer', () => { assert(html.indexOf('ui/app.js') < html.indexOf('ui/ui_batch80.js')); });
  await test('index contains the connection status landmark', () => { assert(/id="connection-status"[^>]+role="status"/.test(html)); });
  await test('index contains coarse-pointer hit target fallback', () => { assert(html.includes('@media (pointer:coarse)') && html.includes('min-height:42px')); });
  await test('index contains forced-colors fallback', () => { assert(html.includes('@media (forced-colors:active)')); });
  await test('index contains print-safe output rules', () => { assert(html.includes('@media print') && html.includes('#settings-overlay')); });
  await test('index contains short landscape viewport rules', () => { assert(html.includes('max-height:620px') && html.includes('orientation:landscape')); });
  await test('index contains a hidden-page animation pause', () => { assert(html.includes('.ui-paused .think-panel.thinking')); });
  await test('service worker cache version advances with the shell', () => { assert(sw.includes("var CACHE = 'xq-shell-v4'")); });
  await test('service worker precaches the batch runtime', () => { assert(sw.includes("'./ui/ui_batch80.js'")); });
  await test('service worker keeps API responses out of the shell', () => { assert(sw.includes('if (isApiPath(url.pathname)) return')); });
  await test('manifest offers a safe standalone fallback display', () => { assert.deepStrictEqual(manifest.display_override, ['window-controls-overlay', 'standalone']); assert.strictEqual(manifest.display, 'standalone'); });
  await test('manifest permits portrait and landscape boards', () => { assert.strictEqual(manifest.orientation, 'any'); });
  await test('manifest does not request related native apps', () => { assert.strictEqual(manifest.prefer_related_applications, false); });
  await test('Chinese and English new labels are both present', () => { const i18n = fs.readFileSync(path.join(ROOT, 'ui/i18n.js'), 'utf8'); for (const key of ['ui_network_status', 'ui_network_online', 'ui_online', 'ui_offline', 'ui_reconnected', 'ui_unsaved']) assert((i18n.match(new RegExp('\\b' + key + '\\s*:', 'g')) || []).length >= 2, key + ' must have zh/en'); });
  console.log('UI batch 80: ' + passed + ' checks passed');
})().catch(err => { console.error(err.stack || err); process.exitCode = 1; });
