/* ui/i18n.js — 轻量 UI i18n 框架 (零依赖, 中文默认, English 可切)
 * 用法:  标记: <span data-i18n="key">默认中文</span><button data-i18n-title="key" title="默认中文">...</button>
 * 动态:  XQ.I18N.t('key') 或 XQ.I18N.tArgs('key', {name:'x'}) 占位符 {name}
 * 切换:  XQ.I18N.setLang('en'|'zh', true)  (第二参 true = 持久化到 localStorage 'xq_lang')
 * 自动:  init() 立即 apply (DOMContentLoaded 后); 调用 apply() 重新刷新
 * 范围:  UI 控件/状态/按钮/警告 — 系统提示词 (给模型) 不在 i18n 范围 (保持中文)
 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var LS_KEY = 'xq_lang';
  var LANGS = ['zh', 'en'];
  var ZH = {
    app_title: '🦞 LLM-chess v1.0 · AI 对战直播平台',
    app_subtitle: 'AI 对战直播平台 · 战略决策流 · 棋风对垒 · 棋谱存档 · OpenAI协议(密钥服务端)',
    nav_settings: '⚙', nav_replay: '🎬', nav_help: '?',
    language_label: '语言',
    settings_title: '对局设置',
    side_red: '红方', side_black: '黑方',
    enabled: '启用非人类棋手',
    type: '类型', type_human: '人类', type_random: '随机AI', type_llm: 'LLM',
    provider: '服务商', model: '模型',
    model_placeholder: '选或填模型名',
    style: '棋风', style_aggressive: '攻击型', style_defensive: '防守型', style_balanced: '均衡型',
    quick_mode: '快答模式 (关闭深度思考, 直出决策+原因)',
    btn_start: '开始对局', btn_reset: '重开',
    btn_save: '💾 保存棋谱', btn_load: '📂 载入棋谱',
    btn_play: '▶ 播放', btn_pause: '⏸ 暂停',
    btn_step_next: '⏭ 一步', btn_step_prev: '⏮ 一步',
    btn_jump_start: '⏮⏮ 跳到开头', btn_jump_end: '⏭⏭ 跳到结尾',
    btn_skip_back5: '⏪ -5', btn_skip_fwd5: '⏪ +5',
    btn_fullscreen: '⛶ 全屏', btn_help: '? 帮助', btn_close: '关闭',
    btn_import: '📂 导入JSON', btn_export: '💾 导出PGN',
    btn_keyboard_help: '键盘快捷键',
    speed: '倍速', speed_label: '倍速:',
    loop: '循环', loop_on: '循环: 开', loop_off: '循环: 关',
    status_idle: '等待对局开始',
    status_thinking: '🤖 {model}（{side}）思考中…',
    status_side_red: '红方', status_side_black: '黑方',
    status_check: '⚠️ 将军！',
    status_turn: '当前回合：{side}',
    status_win_red: '🏆 红方胜利！', status_win_black: '🏆 黑方胜利！',
    status_draw: '🤝 和棋',
    think_captured_title: '已吃子力', think_spark_title: '本方自评走势 (本方视角)',
    thinking_collapse_hint: '折叠思考', thinking_expand_hint: '展开查看',
    eval_summary_label: '局面基础评价 (引擎提供, 直接采用):',
    warn_llm_no_server: '⚠️ LLM 需要本地服务: 请运行 node server.js 后访问 http://localhost:8788',
    warn_auth: '⚠️ 鉴权失败 (401): 请检查 config/keys.json 对应服务商的 apiKey',
    warn_timeout: '⚠️ 上游超时/无响应, 已自动重试',
    warn_blocked: '⚠️ 系统拦截: {reason}',
    warn_open_first: '请先打开对局', warn_loading: '加载中…',
    stats_cached: '缓存', stats_blocked: '拦截',
    sound_on: '🔊 音效 开', sound_off: '🔇 音效 关',
    footer_sound_title: '音效开关',
    empty: '(无)', unknown: '未知'
  };
  var EN = {
    app_title: '🦞 LLM-chess v1.0 · AI Battle & Spectating Platform',
    app_subtitle: 'AI battles live · Decision cards · Play styles · Game archive · OpenAI protocol (keys server-side)',
    nav_settings: '⚙', nav_replay: '🎬', nav_help: '?',
    language_label: 'Language',
    settings_title: 'Game Settings',
    side_red: 'Red', side_black: 'Black',
    enabled: 'Enable non-human player',
    type: 'Type', type_human: 'Human', type_random: 'Random AI', type_llm: 'LLM',
    provider: 'Provider', model: 'Model',
    model_placeholder: 'Select or type a model name',
    style: 'Style', style_aggressive: 'Aggressive', style_defensive: 'Defensive', style_balanced: 'Balanced',
    quick_mode: 'Quick mode (skip deep thinking, output decision + reason directly)',
    btn_start: 'Start Game', btn_reset: 'Reset',
    btn_save: '💾 Save Game', btn_load: '📂 Load Game',
    btn_play: '▶ Play', btn_pause: '⏸ Pause',
    btn_step_next: '⏭ Step', btn_step_prev: '◀ Step',
    btn_jump_start: '⏮⏮ Start', btn_jump_end: '⏭⏭ End',
    btn_skip_back5: '⏪ -5', btn_skip_fwd5: '⏩ +5',
    btn_fullscreen: '⛶ Fullscreen', btn_help: '? Help', btn_close: 'Close',
    btn_import: '📂 Import JSON', btn_export: '💾 Export PGN',
    btn_keyboard_help: 'Keyboard Shortcuts',
    speed: 'Speed', speed_label: 'Speed:',
    loop: 'Loop', loop_on: 'Loop: on', loop_off: 'Loop: off',
    status_idle: 'Waiting for game to start',
    status_thinking: '🤖 {model} ({side}) thinking…',
    status_side_red: 'Red', status_side_black: 'Black',
    status_check: '⚠️ Check!',
    status_turn: 'Turn: {side}',
    status_win_red: '🏆 Red wins!', status_win_black: '🏆 Black wins!',
    status_draw: '🤝 Draw',
    think_captured_title: 'Captured pieces', think_spark_title: 'Self-eval trend (own perspective)',
    thinking_collapse_hint: 'Collapse thinking', thinking_expand_hint: 'Expand',
    eval_summary_label: 'Engine eval (use as-is):',
    warn_llm_no_server: '⚠️ LLM needs the local server: please run node server.js and open http://localhost:8788',
    warn_auth: '⚠️ Auth failed (401): check the apiKey for this provider in config/keys.json',
    warn_timeout: '⚠️ Upstream timeout / no response, retrying automatically',
    warn_blocked: '⚠️ Blocked: {reason}',
    warn_open_first: 'Please start a game first', warn_loading: 'Loading…',
    stats_cached: 'cached', stats_blocked: 'blocked',
    sound_on: '🔊 Sound on', sound_off: '🔇 Sound off',
    footer_sound_title: 'Toggle sound',
    empty: '(none)', unknown: 'unknown'
  };
  var STRINGS = { zh: ZH, en: EN };
  function has(l) { return l && LANGS.indexOf(l) !== -1 ? l : 'zh'; }
  var cur = 'zh';
  try { var _s = root.localStorage && root.localStorage.getItem(LS_KEY); if (_s) cur = has(_s); } catch (e) {}
  function t(k) {
    var dict = STRINGS[cur] || STRINGS.zh;
    var v = dict[k];
    return v == null ? (STRINGS.zh[k] != null ? STRINGS.zh[k] : k) : v;
  }
  function tArgs(k, a) {
    var s = t(k);
    if (!a) return s;
    return s.replace(/\{(\w+)\}/g, function (_, n) { return a[n] != null ? a[n] : ('{' + n + '}'); });
  }
  function setLang(lang, persist) {
    cur = has(lang);
    if (persist) { try { root.localStorage.setItem(LS_KEY, cur); } catch (e) {} }
    try { if (root.document) root.document.documentElement.setAttribute('lang', cur === 'en' ? 'en' : 'zh-CN'); } catch (e) {}
    apply();
  }
  function apply() {
    if (typeof root.document === 'undefined') return;
    var nodes = root.document.querySelectorAll('[data-i18n]');
    for (var i = 0; i < nodes.length; i++) {
      var n = nodes[i], k = n.getAttribute('data-i18n');
      var v = t(k);
      if (v != null) {
        if (n.tagName === 'INPUT' || n.tagName === 'TEXTAREA') n.placeholder = v;
        else n.textContent = v;
      }
    }
    var tnodes = root.document.querySelectorAll('[data-i18n-title]');
    for (var j = 0; j < tnodes.length; j++) {
      var n2 = tnodes[j], tk = n2.getAttribute('data-i18n-title');
      var v2 = t(tk);
      if (v2 != null) n2.setAttribute('title', v2);
    }
    var anodes = root.document.querySelectorAll('[data-i18n-aria]');
    for (var a = 0; a < anodes.length; a++) {
      var n3 = anodes[a], ak = n3.getAttribute('data-i18n-aria');
      var v3 = t(ak);
      if (v3 != null) n3.setAttribute('aria-label', v3);
    }
    try { root.document.title = t('app_title'); } catch (e) {}
    try { root.dispatchEvent(new root.CustomEvent('xq:i18n', { detail: { lang: cur } })); } catch (e2) {}
  }
  function getLang() { return cur; }
  function init() {
    if (typeof root.document === 'undefined') return;
    if (root.document.readyState === 'loading') root.document.addEventListener('DOMContentLoaded', apply);
    else apply();
  }
  XQ.I18N = { t: t, tArgs: tArgs, setLang: setLang, getLang: getLang, apply: apply, init: init, LANGS: LANGS, STRINGS: STRINGS };
})(typeof window !== 'undefined' ? window : globalThis);
