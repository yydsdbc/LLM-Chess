# AGENTS.md — 给 AI Agent 的 LLM-Chess 操作手册

面向在本仓库干活的 AI agent（OpenClaw cron / 人工+AI 协作）。项目：象棋 LLM 对战平台，公开仓库 https://github.com/yydsdbc/LLM-Chess 。

## 项目一图流

- Node.js、无构建步骤：静态前端（`index.html` + `ui/`）+ `server.js` 中继（代理 LLM API，keys.json 热加载）。
- 对战核心：`ai/llm_agent.js`（system prompt 组装 / 重试退避 / 前缀缓存 / HIST_CAP 裁剪）。
- 深入架构：`docs/ARCHITECTURE.md`；优化历史：`OPTIMIZATION_LOG.md`（**每轮先读它避重复**）。

## 硬门禁（违反 = 白干）

1. **测试**：`npm test`（并行 9 套件 ~19s）全绿才能 commit；单套件可 `node test/<name>.js`；改动 js 全部先 `node --check`。
2. **system prompt**（`ai/llm_agent.js`）：≤2400 字、全中文、无特殊符号（①②③≥≤~→emoji）；提示词等级 none/low/mid/high 每级长度恒定（前缀缓存不变式）。
3. **server.js 尽量不改**（改了用户要重启进程）；确要改必须跑 `test/check_ui.js`。
4. **PowerShell 纪律**：每条命令后查 `$LASTEXITCODE`；严禁管道收尾（PowerShell 会伪报 exit 1）。
5. **i18n**：改中文文案必须同步 `ui/i18n.js` 的 EN 键（i18n_check 把关）。
6. **文档链接**：`.github/` 和 `docs/` 下 md 的相对链接必须 `../` 前缀（CI link_check 把关）。

## 常用命令

```powershell
npm test                 # 并行 9 套件（~19s）
node test/run_tests.js   # 串行链
node server.js           # 本地起服务 :8788
git push                 # 直连优先；失败: git -c http.https://github.com.proxy=http://127.0.0.1:10808 push
```

## 版本 / 发布

- `CHANGELOG.md` 保持 Keep a Changelog 格式。
- 发版流程：bump `package.json` → CHANGELOG 建版本段 → commit → tag `vX.Y.Z` → push tag（`release.yml` 自动跑测试门禁并发 Release）。
- `test/check_ui.js` 守护 README 徽章版本号 = package.json——改版本号三处同步。
- 历史版本：v1.0.2（2026-09-05 上午）、v1.0.3（2026-09-05 晚，prompt-level tiers + CORS/限流/ETag）。

## 每日 cron 代理约定（llmchess-daily-optimize-report，09:00）

- ≥6 项真价值不重复优化（宁少不凑）；先读 `OPTIMIZATION_LOG.md` 全部轮次避重复。
- 产出：代码/文档改动 + OPTIMIZATION_LOG 追加轮次记录 + commit + 尽力 push + plain text 报告（GitHub 数据 + 10 项优化 + 测试与推送状态）。
- 触发语与报告格式见 OpenClaw automations 任务 `llmchess-daily-optimize-report` 的 payload。
