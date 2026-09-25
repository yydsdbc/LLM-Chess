# AGENTS.md — 给 AI Agent 的 LLM-Chess 操作手册

面向在本仓库干活的 AI agent（OpenClaw cron / 人工+AI 协作）。项目：象棋 LLM 对战平台，公开仓库 https://github.com/yydsdbc/LLM-Chess 。

## 项目一图流

- Node.js、无构建步骤：静态前端（`index.html` + `ui/`）+ `server.js` 中继（代理 LLM API，keys.json 热加载）。
- 对战核心：`ai/llm_agent.js`（system prompt 组装 / 重试退避 / 前缀缓存 / HIST_CAP 裁剪）。
- 深入架构：`docs/ARCHITECTURE.md`；优化历史：`OPTIMIZATION_LOG.md`（**每轮先读它避重复**）。

## 硬门禁（违反 = 白干）

1. **测试**：`npm test`（并行 15 套件 ~20s）全绿才能 commit；单套件可 `node test/<name>.js`；改动 js 全部先 `node --check`。
2. **system prompt**（`ai/llm_agent.js`）：≤2400 字、全中文、无特殊符号（①②③≥≤~→emoji）；提示词等级 none/low/mid/high 每级长度恒定（前缀缓存不变式）。
3. **server.js 尽量不改**（改了用户要重启进程）；确要改必须跑 `test/check_ui.js`（只做语法检查）**以及 `test/_server_http.js`**（真正起服务的 HTTP 行为门禁：静态敏感路径/穿越/中继/CORS/限流）。
4. **PowerShell 纪律**：每条命令后查 `$LASTEXITCODE`；严禁管道收尾（PowerShell 会伪报 exit 1）。
5. **i18n**：改中文文案必须同步 `ui/i18n.js` 的 EN 键（i18n_check 把关）。
6. **文档链接**：`.github/` 和 `docs/` 下 md 的相对链接必须 `../` 前缀（CI link_check 把关）。

## 常用命令

```powershell
npm test                 # 并行 15 套件（~20s）
node test/run_tests.js   # 串行链
node server.js           # 本地起服务 :8788
git push                 # 直连优先；失败: git -c http.https://github.com.proxy=http://127.0.0.1:10808 push
```

## 版本 / 发布

- `CHANGELOG.md` 保持 Keep a Changelog 格式。
- 发版流程：bump `package.json` → CHANGELOG 建版本段 → commit → tag `vX.Y.Z` → push tag（`release.yml` 自动跑测试门禁并发 Release）。
- `test/check_ui.js` 守护 README 双语 H1 版本号一致、且与 package.json 的主次版本前缀对齐 (无版本徽章; 只比 `v\d+.\d+` 前缀, 补丁号不校验)——改版本号记得同步 README 双语 H1。
- 历史版本：v1.0.2（2026-09-05 上午）、v1.0.3（2026-09-05 晚，prompt-level tiers + CORS/限流/ETag）。

## 多 Agent 协作协议（zcode / OpenClaw / Codex / 人工 通用）

本项目是**多 agent 并行协作**仓库 — 多个 AI agent 可能在不同时间、甚至同时工作。遵守以下协议避免冲突：

### 开工三步（必做）
1. `git pull` 拿最新 main（落后几个 commit 就可能做出重复工作）。
2. `git log --oneline -10` 看最近轮次号与内容 — **下一轮号 = 最新轮号 + 1**（看 `OPTIMIZATION_LOG.md` 尾部 `## YYYY-MM-DD HH:mm 第N轮` 确定）。
3. `git status` 确认无他人未提交改动 — 有则先联系或等合并，勿覆盖。

### 轮次记录规范
- 每轮在 `OPTIMIZATION_LOG.md` 追加：`## YYYY-MM-DD HH:mm 第N轮 (执行者ID — 指令摘要)`。
- 执行者ID：zcode / codex / openclaw / 人工名 — 让后来者知道谁做的。
- 先写 LOG 再跑长测试（防止崩溃后丢失记录 — 已发生 3 次）。

### 并行安全
- 大改前 `git pull` 确认没人在同一区域工作；发现并行 agent 的新 commit → **先读它做了什么** 再决定本轮方向。
- 多 agent 同时 commit → 后 push 的先 `git pull --rebase` 再 push。
- 轮号冲突（两人都写了第 N 轮）→ 后提交者改号为 N+1 并在 LOG 注记。

### Codex 特有注意事项
- Codex CLI 原生读取 `AGENTS.md`（本文件），无需额外配置。
- Codex 沙箱可能没有代理配置 → `git push` 走直连（`git -c http.https://github.com.proxy= push`）；如果直连不通，代理 `http://127.0.0.1:10808` 仅在宿主机上有效。
- Codex 没有 IAB 浏览器 → GUI 验证用 `npm test`（含 check_ui 源串守卫）替代截图；需要视觉验收时在报告中注明「浏览器验收待人工/其他 agent 补做」。
- Codex 不需要 `chcp 65001`（那是 Windows cmd 的 UTF-8 设置）；Git Bash / Linux shell 直接输出 UTF-8。
- PowerShell 的 `$LASTEXITCODE` 规则不适用于 Codex 的 bash 环境 — 用 `$?` 或 `echo "EXIT=$?"`。

### 矿区速查（截至第 54 轮，2026-09-25）
以下方向已被充分挖掘，新 agent 避免重复：
- a11y 六期 / i18n 六期（321+ 键双语全量覆盖，I5-I9 守护网络）/ PWA 三期 / 安全响应头+CSP+messages 校验
- 提示词两轮专项（2384 字, r35/r51）/ 引擎语义对齐（gaveCheck/undoPly 快照栈, r48）/ 中继健壮性（挂起/穿越/心跳, r46-48）
- 拖拽走子/面板分隔条/翻转视角/最后着法箭头/圆桌讨论/Elo 加权/fastMajority/候选悬停/合并流式思考
- 剩余矿区：评测知识库扩充 / Board flip 输入层边界 / 会诊辩论制二期 / PWA 离线棋谱管理 / Elo 趋势图

## 每日 cron 代理约定（llmchess-daily-optimize-report，09:00）

- ≥6 项真价值不重复优化（宁少不凑）；先读 `OPTIMIZATION_LOG.md` 全部轮次避重复。
- 产出：代码/文档改动 + OPTIMIZATION_LOG 追加轮次记录 + commit + 尽力 push + plain text 报告（GitHub 数据 + 10 项优化 + 测试与推送状态）。
- 触发语与报告格式见 OpenClaw automations 任务 `llmchess-daily-optimize-report` 的 payload。
