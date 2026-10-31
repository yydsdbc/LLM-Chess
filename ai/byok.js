/* ai/byok.js — 第82轮: BYOK 直连配置 (Bring Your Own Key)
 * 用途: GitHub Pages 等静态托管没有 /api/chat 中继, 访客填自己的 key 后浏览器**直连**
 *       OpenAI 兼容端点观看/进行真 LLM 对战 (OpenAI/DeepSeek/OpenRouter/GLM/Moonshot/
 *       SiliconFlow/Groq/Ollama…)。OpenRouter 端点可代连 Claude/Gemini/Grok 系模型。
 * 安全边界: key 只存访客浏览器 localStorage('xq_byok'), 仅随请求发往用户自填的服务商端点;
 *           本项目无任何自建服务器参与该链路, 不收集任何凭据。
 * 协议口径: llm_agent 消费的 openai 兼容 SSE 形状与中继输出一致, 直连复用同一套流解析。 */
(function (root) {
  'use strict';
  var XQ = root.XQ = root.XQ || {};
  var LS_KEY = 'xq_byok';

  var PRESETS = [
    { id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'] },
    { id: 'deepseek', label: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat', 'deepseek-reasoner'] },
    { id: 'openrouter', label: 'OpenRouter (Claude / Gemini / Grok)', baseUrl: 'https://openrouter.ai/api/v1', models: ['anthropic/claude-sonnet-4', 'google/gemini-2.5-flash', 'openai/gpt-4o-mini'] },
    { id: 'glm', label: '智谱 GLM', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', models: ['glm-4-flash', 'glm-4-plus', 'glm-4.5-flash'] },
    { id: 'moonshot', label: 'Moonshot Kimi', baseUrl: 'https://api.moonshot.cn/v1', models: ['moonshot-v1-8k', 'kimi-k2-0711-preview'] },
    { id: 'siliconflow', label: '硅基流动 SiliconFlow', baseUrl: 'https://api.siliconflow.cn/v1', models: ['Qwen/Qwen2.5-7B-Instruct', 'deepseek-ai/DeepSeek-V3'] },
    { id: 'groq', label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile'] },
    { id: 'custom', label: '自定义 (Ollama / vLLM / LM Studio…)', baseUrl: 'http://localhost:11434/v1', models: [] }
  ];

  function load() {
    try {
      var v = null;
      try { v = JSON.parse(root.localStorage.getItem(LS_KEY) || 'null'); } catch (eP) { v = null; }
      if (!v || typeof v !== 'object' || Array.isArray(v)) return null;
      return {
        preset: typeof v.preset === 'string' ? v.preset : 'custom',
        baseUrl: typeof v.baseUrl === 'string' ? v.baseUrl : '',
        apiKey: typeof v.apiKey === 'string' ? v.apiKey : '',
        model: typeof v.model === 'string' ? v.model : ''
      };
    } catch (e) { return null; }
  }
  function save(cfg) {
    try { root.localStorage.setItem(LS_KEY, JSON.stringify(cfg || {})); return true; } catch (e) { return false; }
  }
  function clear() { try { root.localStorage.removeItem(LS_KEY); } catch (e) {} }
  function presetOf(id) {
    for (var i = 0; i < PRESETS.length; i++) if (PRESETS[i].id === id) return PRESETS[i];
    return PRESETS[PRESETS.length - 1];
  }
  function isConfigured() {
    var c = load();
    return !!(c && c.baseUrl && c.apiKey && c.model);
  }
  /* 连通性测试: 1 token 最小补全, 返回 {ok, ms, error?} — Failed to fetch 附 CORS 提示 (直连失败最常见原因) */
  function testConnection(cfg) {
    var t0 = Date.now();
    return fetch(String(cfg.baseUrl).replace(/\/+$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + cfg.apiKey },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'user', content: 'hi' }], max_tokens: 1, stream: false })
    }).then(function (res) {
      var ms = Date.now() - t0;
      if (res.ok) return { ok: true, ms: ms };
      return res.json().catch(function () { return {}; }).then(function (e) {
        return { ok: false, ms: ms, error: 'HTTP ' + res.status + ' ' + ((e.error && e.error.message) || e.message || '') };
      });
    }).catch(function (err) {
      var msg = (err && err.message) || 'fetch failed';
      if (/failed to fetch|networkerror|load failed/i.test(msg)) {
        msg += ' (可能被 CORS 拦截: 该服务商不允许浏览器直连, 请改用本地中继或其他服务商)';
      }
      return { ok: false, ms: Date.now() - t0, error: msg };
    });
  }

  XQ.BYOK = { PRESETS: PRESETS, presetOf: presetOf, load: load, save: save, clear: clear, isConfigured: isConfigured, testConnection: testConnection };
})(typeof window !== 'undefined' ? window : this);
