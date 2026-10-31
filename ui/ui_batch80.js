/* ui/ui_batch80.js — round 80 UI runtime guards and low-cost presentation helpers.
 * This file deliberately stays below the chess/application layer: it observes the
 * existing DOM and makes browser state explicit without changing move legality.
 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var LS_PREFIX = 'xq_ui80_';
  var hasDocument = !!root.document;

  /* B80-01..03: storage failures (private mode/quota) never break the board. */
  function safeGet(key, fallback) {
    try {
      var value = root.localStorage && root.localStorage.getItem(key);
      return value == null ? fallback : value;
    } catch (e) { return fallback; }
  }
  function safeSet(key, value) {
    try { if (root.localStorage) root.localStorage.setItem(key, String(value)); return true; }
    catch (e) { return false; }
  }
  function safeRemove(key) {
    try { if (root.localStorage) root.localStorage.removeItem(key); return true; }
    catch (e) { return false; }
  }

  /* B80-04..07: small pure helpers are shared by every state boundary below. */
  function clamp(value, min, max, fallback) {
    var n = Number(value);
    if (!isFinite(n)) n = fallback == null ? min : Number(fallback);
    if (!isFinite(n)) n = min;
    return Math.max(min, Math.min(max, n));
  }
  function bool(value, fallback) {
    if (value === true || value === false) return value;
    if (value === '1' || value === 'true' || value === 1) return true;
    if (value === '0' || value === 'false' || value === 0) return false;
    return !!fallback;
  }
  function side(value) { return value === 'red' || value === 'black' ? value : null; }
  function isEditable(target) {
    var el = target && target.nodeType === 1 ? target : null;
    if (!el) return false;
    var tag = String(el.tagName || '').toUpperCase();
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || !!el.isContentEditable;
  }
  function visible(el) {
    if (!el) return false;
    if (el.hidden || (el.getAttribute && el.getAttribute('aria-hidden') === 'true')) return false;
    if (el.offsetParent === null && el !== root.document.activeElement) return false;
    return true;
  }
  function focusSafe(el) {
    if (!el || typeof el.focus !== 'function') return false;
    try { el.focus({ preventScroll: true }); } catch (e) { try { el.focus(); } catch (e2) { return false; } }
    return root.document && root.document.activeElement === el;
  }
  function focusables(container) {
    if (!container || !container.querySelectorAll) return [];
    return Array.prototype.filter.call(container.querySelectorAll(
      'button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href],[tabindex="0"]'
    ), visible);
  }

  /* B80-08..10: debounce/animation-frame scheduling prevents resize and live-text storms. */
  function debounce(fn, wait) {
    var timer = null;
    function wrapped() {
      var args = arguments, self = this;
      if (timer) clearTimeout(timer);
      timer = setTimeout(function () { timer = null; fn.apply(self, args); }, Math.max(0, wait | 0));
    }
    wrapped.cancel = function () { if (timer) clearTimeout(timer); timer = null; };
    return wrapped;
  }
  function frameBatch(fn) {
    var pending = false, args = null;
    return function () {
      args = arguments;
      if (pending) return;
      pending = true;
      var run = function () { pending = false; var a = args; args = null; fn.apply(this, a || []); };
      if (typeof root.requestAnimationFrame === 'function') root.requestAnimationFrame(run);
      else setTimeout(run, 0);
    };
  }
  function reducedMotion() {
    try { return !!(root.matchMedia && root.matchMedia('(prefers-reduced-motion: reduce)').matches); }
    catch (e) { return false; }
  }
  function translated(key, fallback) {
    try { return XQ.I18N && XQ.I18N.t ? XQ.I18N.t(key) : fallback; } catch (e) { return fallback; }
  }
  function translatedArgs(key, args, fallback) {
    try { return XQ.I18N && XQ.I18N.tArgs ? XQ.I18N.tArgs(key, args) : fallback; } catch (e) { return fallback; }
  }

  /* B80-11..14: one text setter for live regions; equal messages are not re-announced. */
  function liveText(el, text) {
    if (!el) return false;
    text = String(text == null ? '' : text);
    if (el.textContent === text) return false;
    el.textContent = text;
    return true;
  }
  function setBusy(el, busy) {
    if (!el || !el.setAttribute) return;
    el.setAttribute('aria-busy', busy ? 'true' : 'false');
    if (el.classList) el.classList.toggle('is-busy', !!busy);
  }
  function scrollIntoViewSafe(el) {
    if (!el || typeof el.scrollIntoView !== 'function') return false;
    try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); }
    catch (e) { try { el.scrollIntoView(false); } catch (e2) { return false; } }
    return true;
  }
  function canonicalControls(rootEl) {
    var out = [];
    if (!rootEl || !rootEl.querySelectorAll) return out;
    Array.prototype.forEach.call(rootEl.querySelectorAll('input,select,textarea'), function (el) {
      if (!el.id) return;
      var value = el.type === 'checkbox' ? (el.checked ? '1' : '0') : String(el.value == null ? '' : el.value);
      out.push(el.id + '=' + value);
    });
    return out.sort();
  }
  function sameArray(a, b) {
    if (!a || !b || a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }

  /* B80-15..21: live connectivity status and page lifecycle state. */
  function onlineState() {
    return root.navigator && root.navigator.onLine !== false;
  }
  function paintConnection(status, announce) {
    if (!hasDocument) return;
    var el = root.document.getElementById('connection-status');
    if (!el) return;
    var online = status === 'online';
    el.dataset.state = online ? 'online' : 'offline';
    el.setAttribute('aria-label', translated('ui_network_status', 'Network status') + ': ' +
      translated(online ? 'ui_online' : 'ui_offline', online ? 'Online' : 'Offline'));
    var text = announce ? translated(online ? 'ui_reconnected' : 'ui_offline', online ? 'Back online' : 'Offline')
      : translated(online ? 'ui_online' : 'ui_offline', online ? 'Online' : 'Offline');
    liveText(el, text);
    root.document.documentElement.dataset.connection = online ? 'online' : 'offline';
  }
  function syncViewport() {
    if (!hasDocument || !root.document.documentElement) return;
    var de = root.document.documentElement;
    var vv = root.visualViewport;
    var width = vv && vv.width || root.innerWidth || 0;
    var height = vv && vv.height || root.innerHeight || 0;
    de.style.setProperty('--ui-vw', Math.max(0, width) + 'px');
    de.style.setProperty('--ui-vh', Math.max(0, height) + 'px');
    de.dataset.compact = width && width < 700 ? '1' : '0';
  }
  function installLifecycle() {
    if (!hasDocument) return;
    var initial = onlineState();
    paintConnection(initial ? 'online' : 'offline', false);
    root.addEventListener && root.addEventListener('online', function () { paintConnection('online', true); });
    root.addEventListener && root.addEventListener('offline', function () { paintConnection('offline', true); });
    root.document.addEventListener('xq:i18n', function () {
      var current = root.document.documentElement.dataset.connection || (onlineState() ? 'online' : 'offline');
      paintConnection(current, false);
    });
    root.document.addEventListener('visibilitychange', function () {
      var hidden = root.document.visibilityState === 'hidden';
      root.document.documentElement.dataset.pageHidden = hidden ? '1' : '0';
      root.document.documentElement.classList.toggle('ui-paused', hidden);
    });
    root.addEventListener && root.addEventListener('pageshow', function () {
      root.document.documentElement.dataset.pageHidden = '0';
      syncViewport();
    });
    root.addEventListener && root.addEventListener('pagehide', function () {
      root.document.documentElement.dataset.pageHidden = '1';
    });
    var resize = frameBatch(syncViewport);
    root.addEventListener && root.addEventListener('resize', resize, { passive: true });
    root.addEventListener && root.addEventListener('orientationchange', resize, { passive: true });
    if (root.visualViewport && root.visualViewport.addEventListener) root.visualViewport.addEventListener('resize', resize, { passive: true });
    syncViewport();
  }

  /* B80-22..27: modal semantics and focus containment for the settings surface. */
  function syncInert(show) {
    if (!hasDocument) return;
    /* settings-overlay lives inside board-container/arena; shielding an ancestor would
       also make the form inert. Shield only sibling surfaces that are outside the modal. */
    ['think-red', 'think-black', 'panel-splitter-r', 'spectator-meter', 'status-bar', 'ai-banner'].forEach(function (id) {
      var el = root.document.getElementById(id);
      if (!el) return;
      if ('inert' in el) el.inert = !!show;
      if (show) el.setAttribute('aria-hidden', 'true');
      else el.removeAttribute('aria-hidden');
    });
  }
  function trapTab(container, ev) {
    if (!container || ev.key !== 'Tab') return false;
    var list = focusables(container);
    if (!list.length) return false;
    var current = root.document.activeElement;
    if (ev.shiftKey ? current === list[0] || !container.contains(current) : current === list[list.length - 1] || !container.contains(current)) {
      focusSafe(ev.shiftKey ? list[list.length - 1] : list[0]);
      ev.preventDefault();
      return true;
    }
    return false;
  }
  function installModalGuard() {
    if (!hasDocument) return;
    var overlay = root.document.getElementById('settings-overlay');
    if (!overlay) return;
    var state = { open: false, clean: [], dirty: false, opener: null };
    function isOpen() { return overlay.classList && overlay.classList.contains('show'); }
    function snapshot() { state.clean = canonicalControls(overlay); state.dirty = false; overlay.removeAttribute('data-dirty'); }
    function updateDirty() {
      var next = !sameArray(state.clean, canonicalControls(overlay));
      state.dirty = next;
      if (next) overlay.setAttribute('data-dirty', '1'); else overlay.removeAttribute('data-dirty');
    }
    function rejectClose(ev) {
      if (!state.dirty) return true;
      var ok = true;
      try { ok = root.confirm(translated('ui_unsaved', 'Discard unsaved settings?')); } catch (e) {}
      if (!ok) { if (ev) { ev.preventDefault(); ev.stopImmediatePropagation(); } return false; }
      state.dirty = false; return true;
    }
    var observer = typeof root.MutationObserver === 'function' ? new root.MutationObserver(function () {
      var open = isOpen();
      if (open && !state.open) { state.open = true; state.opener = root.document.activeElement; snapshot(); syncInert(true); }
      if (!open && state.open) { state.open = false; syncInert(false); }
    }) : null;
    if (observer) observer.observe(overlay, { attributes: true, attributeFilter: ['class'] });
    overlay.addEventListener('input', updateDirty, true);
    overlay.addEventListener('change', updateDirty, true);
    root.document.addEventListener('keydown', function (ev) {
      if (!isOpen()) return;
      if (ev.key === 'Tab') trapTab(overlay, ev);
      if (ev.key === 'Escape') rejectClose(ev);
    }, true);
    root.document.addEventListener('click', function (ev) {
      if (!isOpen()) return;
      var target = ev.target;
      var close = target && target.closest && (target.closest('#btn-settings-close') || target === overlay);
      if (close) rejectClose(ev);
      var save = target && target.closest && target.closest('#btn-settings-save');
      if (save) { state.dirty = false; state.clean = canonicalControls(overlay); overlay.removeAttribute('data-dirty'); }
    }, true);
    root.addEventListener && root.addEventListener('beforeunload', function (ev) {
      if (isOpen() && state.dirty) { ev.preventDefault(); ev.returnValue = ''; }
    });
    /* Controls that benefit from mobile keyboards and deterministic browser autofill. */
    Array.prototype.forEach.call(overlay.querySelectorAll('input[type="text"]'), function (el) {
      el.setAttribute('autocomplete', 'off'); el.setAttribute('spellcheck', 'false');
    });
  }

  /* B80-28..34: dynamic panel semantics, pointer/keyboard mode and focus-safe scrolling. */
  function installPanelObserver() {
    if (!hasDocument) return;
    ['red', 'black'].forEach(function (sd) {
      var panel = root.document.getElementById('think-' + sd);
      if (!panel) return;
      panel.setAttribute('aria-live', 'off');
      panel.setAttribute('aria-busy', 'false');
      var sync = function () { setBusy(panel, panel.classList.contains('thinking')); };
      sync();
      if (typeof root.MutationObserver === 'function') new root.MutationObserver(sync).observe(panel, { attributes: true, attributeFilter: ['class'] });
    });
    var log = root.document.getElementById('move-log');
    if (log) log.addEventListener('click', function (ev) {
      var item = ev.target && ev.target.closest && ev.target.closest('.log-entry');
      if (item) scrollIntoViewSafe(item);
    });
    var board = root.document.getElementById('board');
    if (board) {
      board.addEventListener('pointerdown', function () { root.document.documentElement.dataset.inputMode = 'pointer'; }, { passive: true });
      board.addEventListener('keydown', function () { root.document.documentElement.dataset.inputMode = 'keyboard'; }, { passive: true });
    }
    Array.prototype.forEach.call(root.document.querySelectorAll('button'), function (button) {
      if (!button.getAttribute('type')) button.setAttribute('type', 'button');
    });
    var meter = root.document.getElementById('spectator-meter');
    if (meter) { meter.setAttribute('role', 'region'); meter.setAttribute('aria-live', 'polite'); }
    var status = root.document.getElementById('status-bar');
    if (status) status.setAttribute('aria-atomic', 'true');
  }

  /* B80-35..40: translated live status and safe interaction defaults. */
  function installLiveDedupe() {
    if (!hasDocument) return;
    var status = root.document.getElementById('status-text');
    var sr = root.document.getElementById('sr-status');
    if (!status || !sr || typeof root.MutationObserver !== 'function') return;
    var last = '';
    var announce = debounce(function (text) {
      if (text === last) return;
      last = text; liveText(sr, text);
    }, 80);
    new root.MutationObserver(function () { announce(status.textContent); }).observe(status, { childList: true, characterData: true, subtree: true });
  }
  function installSafeInputs() {
    if (!hasDocument) return;
    Array.prototype.forEach.call(root.document.querySelectorAll('input[type="number"]'), function (el) {
      el.setAttribute('inputmode', 'numeric'); el.setAttribute('autocomplete', 'off');
    });
    Array.prototype.forEach.call(root.document.querySelectorAll('input[type="range"]'), function (el) {
      if (!el.getAttribute('aria-valuemin') && el.min !== '') el.setAttribute('aria-valuemin', el.min);
      if (!el.getAttribute('aria-valuemax') && el.max !== '') el.setAttribute('aria-valuemax', el.max);
    });
  }
  function installOfflineHint() {
    if (!hasDocument) return;
    var status = root.document.getElementById('connection-status');
    if (status) status.addEventListener('click', function () { paintConnection(onlineState() ? 'online' : 'offline', false); });
  }

  /* B80-41..50: boot is idempotent, testable and safe when loaded twice by a cached shell. */
  function mount() {
    if (!hasDocument || root.document.documentElement.dataset.uiBatch80 === '1') return false;
    root.document.documentElement.dataset.uiBatch80 = '1';
    installLifecycle();
    installModalGuard();
    installPanelObserver();
    installLiveDedupe();
    installSafeInputs();
    installOfflineHint();
    root.document.documentElement.classList.toggle('ui-reduced-motion', reducedMotion());
    return true;
  }
  var API = {
    safeGet: safeGet, safeSet: safeSet, safeRemove: safeRemove, clamp: clamp, bool: bool, side: side,
    isEditable: isEditable, visible: visible, focusSafe: focusSafe, focusables: focusables,
    debounce: debounce, frameBatch: frameBatch, reducedMotion: reducedMotion, liveText: liveText,
    setBusy: setBusy, scrollIntoViewSafe: scrollIntoViewSafe, canonicalControls: canonicalControls,
    sameArray: sameArray, onlineState: onlineState, paintConnection: paintConnection,
    syncViewport: syncViewport, trapTab: trapTab, syncInert: syncInert, mount: mount, LS_PREFIX: LS_PREFIX
  };
  XQ.UIBatch80 = API;
  if (hasDocument) {
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', mount);
    else mount();
  }
})(typeof window !== 'undefined' ? window : globalThis);
