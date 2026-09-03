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
    pieces_label: '棋子显示', pieces_cn: '汉字', pieces_en: '西文字母',
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
    empty: '(无)', unknown: '未知',
    /* 回放层 (v1.0.daily 09-02): rpEnsure 与 rpPaint 系与 rpShowHelp 全链双语 */
    rp_title: '🎬 对局回放',
    rp_import_btn: '📂 导入', rp_import_title: '导入本地棋谱 JSON (与主界面 保存棋谱 导出格式一致)',
    rp_autoplay_label: ' 自动播放', rp_close_btn: '✕ 退出回放',
    rp_even: '均势', rp_red_short: '红', rp_black_short: '黑',
    rp_gold_cur: '金=当前', rp_click_jump: '点击跳转',
    rp_timechart_caption: '⏱ 思考时长 · {r}/{b} · {g} · 点击跳转',
    rp_evalchart_caption: '📈 评值走势 (红方视角, 上=红优) · {g} · 点击跳转',
    rp_filter_placeholder: '🔍 过滤走法 (summary / 坐标)',
    rp_jump_label: '跳转', rp_jump_placeholder: '手',
    rp_loop_title: '循环播放 (L)', rp_start_title: '回到开头', rp_prev_title: '上一步',
    rp_toggle_title: '播放/暂停 (Space)', rp_next_title: '下一步', rp_end_title: '跳到结尾',
    rp_back5_title: '后退5手', rp_back10_title: '后退10手',
    rp_skip5_title: '快进5手', rp_skip10_title: '快进10手',
    rp_prevcap_title: '上一手吃子 (Shift+C)', rp_nextcap_title: '下一手吃子 (C)',
    rp_nextrecord_title: '下一局', rp_export_pgn_title: '导出 PGN',
    rp_help_title: '键盘帮助 (?)', rp_full_title: '全屏模式 (F)', rp_exit_full_title: '退出全屏 (F/Esc)',
    rp_no_local: '(暂无本地棋谱)', rp_tag_red_win: '红胜', rp_tag_black_win: '黑胜',
    rp_tag_over: '终局', rp_tag_ongoing: '未完', rp_moves_unit: '{n}手',
    rp_res_repetition: '三次重复判和', rp_res_natural: '自然限着判和', rp_res_draw: '双方和棋', rp_res_agree: '协议和棋',
    rp_head_plies: '· {n} 手 ·', rp_total_time: '总时长 {s}s', rp_avg_per_move: '平均 {s}s/手',
    rp_moves_secs: '{n}手/{s}s', rp_progress: '({c}/{t}手)', rp_material: '子力',
    rp_red_plus: '红+{n}', rp_black_plus: '黑+{n}', rp_longest: '最长 {s}s',
    rp_no_record: '⚠ 没有可回放的棋谱数据', rp_import_fail: '导入失败: ',
    rp_initial: '初始局面', rp_initial_hint: '共 {n} 手, 默认每步 {s}s, 按 ▶ 播放 或 ↔ 步进',
    rp_side_red_full: '🔴 红方', rp_side_black_full: '⚫ 黑方', rp_capture: ' 吃 {p}',
    rp_move_of: '第 {n}/{t} 手', rp_suspect: '⚠ 疑似失着: 静态推演此着净丢 {s} 分 (落点被反吃/白丢)',
    rp_mate: '🏁 绝杀! 将军且无解, 直接取胜', rp_stuck: '🔒 困毙! 对方无子可动, 判负', rp_check_now: '⚔ 本手将军',
    rp_ai_summary: 'AI简短分析:', rp_fallback_summary: '兑底·安全着法 (3次尝试失败后由安全阀代走, 无模型摘要)',
    rp_plan: '策略:', rp_eval_label: '局面评价:', rp_confidence: '信心值:', rp_think_time: '⏱ 思考',
    rp_candidates: '候选:', rp_skipped: '⚠ {n} 手数据异常已跳过 (rebuild 容错)',
    rp_eta: '⏳ 剩 {n} 手 ≈ {s}秒 @ {x}x', rp_next_move: '下着',
    rp_no_match: '无匹配走法',
    rp_title_mate: '绝杀: 将军且无解, 直接取胜', rp_title_stuck: '困毙: 对方无子可动, 判负',
    rp_title_check: '将军', rp_title_risky: '静态推演疑似白丢 {s} 分',
    rp_help_title_h: '⌨️ 键盘快捷键',
    rp_hk_prev_next: '上一步 / 下一步', rp_hk_home_end: '跳到开头 / 结尾', rp_hk_space: '播放 / 暂停',
    rp_hk_loop: '循环切换', rp_hk_full: '回放全屏切换 (全屏时 Esc 先退全屏)',
    rp_hk_speeds: '倍速: 0.25x / 0.5x / 1x / 2x / 5x / 10x / 20x',
    rp_hk_skip5: '后退 / 前进 5 手', rp_hk_capture: '下一手吃子 / 上一手吃子',
    rp_hk_wheel: '棋盘上 步进 (180ms 节流)', rp_hk_help: '显示本帮助 (再次按下或点击遮罩关闭)',
    rp_hk_esc: '退出回放',
    rp_hk_tips: '💡 走法列表点击跳转 · 时间柱状图点击跳转 · 最长思考 @#N 点击跳转',
    rp_hk_main: '主界面快捷键: M 静音 · R 重开 · F 全屏观战 (回放打开时 F 由回放接管)'
  };
  var EN = {
    app_title: '🦞 LLM-chess v1.0 · AI Battle & Spectating Platform',
    app_subtitle: 'AI battles live · Decision cards · Play styles · Game archive · OpenAI protocol (keys server-side)',
    nav_settings: '⚙', nav_replay: '🎬', nav_help: '?',
    language_label: 'Language',
    pieces_label: 'Piece glyphs', pieces_cn: 'Chinese', pieces_en: 'Letters',
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
    empty: '(none)', unknown: 'unknown',
    rp_title: '🎬 Game Replay',
    rp_import_btn: '📂 Import', rp_import_title: 'Import a local game JSON (same format as Save Game)',
    rp_autoplay_label: ' Autoplay', rp_close_btn: '✕ Exit replay',
    rp_even: 'Even', rp_red_short: 'Red', rp_black_short: 'Black',
    rp_gold_cur: 'gold = current', rp_click_jump: 'click to jump',
    rp_timechart_caption: '⏱ Think time · {r}/{b} · {g} · click to jump',
    rp_evalchart_caption: '📈 Eval trend (red perspective, up = red better) · {g} · click to jump',
    rp_filter_placeholder: '🔍 Filter moves (summary / coords)',
    rp_jump_label: 'Jump to', rp_jump_placeholder: 'ply',
    rp_loop_title: 'Toggle loop (L)', rp_start_title: 'Back to start', rp_prev_title: 'Previous move',
    rp_toggle_title: 'Play/Pause (Space)', rp_next_title: 'Next move', rp_end_title: 'Jump to end',
    rp_back5_title: 'Back 5 moves', rp_back10_title: 'Back 10 moves',
    rp_skip5_title: 'Forward 5 moves', rp_skip10_title: 'Forward 10 moves',
    rp_prevcap_title: 'Previous capture (Shift+C)', rp_nextcap_title: 'Next capture (C)',
    rp_nextrecord_title: 'Next game', rp_export_pgn_title: 'Export PGN',
    rp_help_title: 'Keyboard help (?)', rp_full_title: 'Fullscreen (F)', rp_exit_full_title: 'Exit fullscreen (F/Esc)',
    rp_no_local: '(no local games yet)', rp_tag_red_win: 'Red won', rp_tag_black_win: 'Black won',
    rp_tag_over: 'Finished', rp_tag_ongoing: 'ongoing', rp_moves_unit: '{n} moves',
    rp_res_repetition: 'draw by repetition', rp_res_natural: '60-move rule draw', rp_res_draw: 'draw', rp_res_agree: 'draw by agreement',
    rp_head_plies: '· {n} moves ·', rp_total_time: 'total {s}s', rp_avg_per_move: 'avg {s}s/move',
    rp_moves_secs: '{n} moves/{s}s', rp_progress: '({c}/{t} moves)', rp_material: 'Material',
    rp_red_plus: 'Red+{n}', rp_black_plus: 'Black+{n}', rp_longest: 'longest {s}s',
    rp_no_record: '⚠ No replay data available', rp_import_fail: 'Import failed: ',
    rp_initial: 'Initial position', rp_initial_hint: '{n} moves total, {s}s per step by default, press ▶ to play or ↔ to step',
    rp_side_red_full: '🔴 Red', rp_side_black_full: '⚫ Black', rp_capture: ' captures {p}',
    rp_move_of: 'Move {n}/{t}', rp_suspect: '⚠ Suspected blunder: static exchange loses {s} pts (recaptured / free loss)',
    rp_mate: '🏁 Checkmate! Unstoppable check — win', rp_stuck: '🔒 Stalemate! No legal move — loses', rp_check_now: '⚔ Check this move',
    rp_ai_summary: 'AI summary:', rp_fallback_summary: 'Fallback safe move (played by the safety valve after 3 failed attempts, no model summary)',
    rp_plan: 'Plan:', rp_eval_label: 'Evaluation:', rp_confidence: 'Confidence:', rp_think_time: '⏱ Think',
    rp_candidates: 'Candidates:', rp_skipped: '⚠ {n} malformed moves skipped (rebuild tolerance)',
    rp_eta: '⏳ {n} moves left ≈ {s}s @ {x}x', rp_next_move: 'Next',
    rp_no_match: 'No matching moves',
    rp_title_mate: 'Checkmate: unstoppable check, wins the game', rp_title_stuck: 'Stalemate: no legal move, loses',
    rp_title_check: 'Check', rp_title_risky: 'Static exchange suggests a free loss of {s} pts',
    rp_help_title_h: '⌨️ Keyboard Shortcuts',
    rp_hk_prev_next: 'Previous / Next move', rp_hk_home_end: 'Jump to start / end', rp_hk_space: 'Play / Pause',
    rp_hk_loop: 'Toggle loop', rp_hk_full: 'Toggle replay fullscreen (Esc exits fullscreen first)',
    rp_hk_speeds: 'Speeds: 0.25x / 0.5x / 1x / 2x / 5x / 10x / 20x',
    rp_hk_skip5: 'Back / forward 5 moves', rp_hk_capture: 'Next / previous capture',
    rp_hk_wheel: 'Step on board (180ms throttle)', rp_hk_help: 'Show this help (press again or click the backdrop to close)',
    rp_hk_esc: 'Exit replay',
    rp_hk_tips: '💡 Click move list / time chart / longest-think @#N to jump',
    rp_hk_main: 'Main UI keys: M mute · R reset · F fullscreen (replay takes over when open)'
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
    if (persist) { try { root.localStorage.setItem(LS_KEY, cur); } catch (e) {}
    }
    apply();
  }
  function apply() {
    if (typeof root.document === 'undefined') return;
    // v1.0.daily a11y/SEO: <html lang> 随界面语言同步 — 移入 apply 使初始加载 (存了 en 的用户) 也生效
    try { root.document.documentElement.setAttribute('lang', getLang() === 'en' ? 'en' : 'zh-CN'); } catch (e) {}
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
