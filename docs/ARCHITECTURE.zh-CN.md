# 架构（中文版）

> 面向贡献者的 LLM-chess v1.1 模块地图：每个模块做什么、LLM 单手数据流、测试套件守护了哪些不变式。
>
> 🌐 English: [ARCHITECTURE.md](../docs/ARCHITECTURE.md)

## 总览

```mermaid
flowchart LR
    subgraph Browser [ui/ + replay/ (browser only)]
        UI[index.html + ui/app.js] -->|renders| RD[ui/renderer.js]
        UI -->|re-watch| RP[replay/replay.js + replay_controller.js]
        I18N[ui/i18n.js zh/en]
    end
    UI <-->|WebSocket/HTTP| SRV[server.js :8788]
    SRV -->|static files| UI
    SRV -->|relay: OpenAI / Anthropic protocol| LLM[16 LLM providers]
    subgraph Core [core/ + evaluation/ (browser + node)]
        ENG[core/engine.js] --> JUDGE[core/judge.js]
        EVAL[evaluation/position.js + xiangqi_knowledge.js]
        AGENT[ai/llm_agent.js + random_agent.js + committee_agent.js]
    end
    UI --> AGENT --> SRV
    AGENT --> ENG
    AGENT --> EVAL
    BENCH[benchmark/ + test/] --> ENG
```

- **ui/spectator.js** — 纯展示层：把静态红方评分映射为互补的红/黑百分比。它是未校准的启发式，绝不是模型信心或实测胜率；终局赛果覆盖评分；非法数据隐藏百分比；不可变快照标识在仅重绘选区时缓存评估值。思考流只展示供应商真实返回的推理与决策字段；响应阶段来自真实回调。

- **core/** — 引擎内核，可独立使用（perft 验证、适配 alpha-beta）：`engine.js`（局面状态、make/unmake、重复局面 + 长将 + 自然限着钟）、`rules.js` / `generator.js` / `move.js` / `board.js` / `piece.js`、`judge.js`（着法语义：将杀 / 困毙 / 将军标记）。
- **evaluation/** — 静态评估 + 知识层。`position.js`（子力、机动性、局面项）与 `xiangqi_knowledge.js`（领域启发式）。同时供给安全阀与观战评估条。
- **ai/** — 智能体。`llm_agent.js` 组装提示词、调用中继、解析/重试/兜底；`random_agent.js` 零配置对局；`committee_agent.js`（第29轮）单侧多 LLM — 轮换制或平行委员会投票（选民预算、安全否决、逐选民状态/计票进行态、合并的逐选民推理流，Elo 加权计票在第36轮）。外部中止信号可传**对象或 getter 函数**（第39轮），对局级控制器可整体替换而无需重建 agent。
- **server.js** — 静态文件服务 + 供应商中继（OpenAI 协议，另含 Anthropic 协议转换）。API key 永不出服务端；默认绑定 `127.0.0.1`。
- **ui/** + **replay/** — 观战 HUD、决策卡片、i18n（英/中，默认英文）、完整回放系统（重放已存棋谱，不调 LLM）。翻转视角（黑方视角，第34轮）、拖拽走子（第33轮）、键盘走子光标 + 面板宽度可调、悔棋（U）、自动存档 + 恢复、PGN 导入导出、备份/恢复、Elo 天梯（第30–36轮）。
- **benchmark/** + **test/** — 无头对局、Elo/棋谱工具链与全部测试套件。

## LLM 单手数据流

1. `engine.snapshot()` → 棋面文本 + 合法着法（带标注：吃子 / 将杀 / 送吃标记）。
2. `llm_agent` 按**缓存契约**（见下）组装提示词，POST 到 `server.js` 中继。
3. 中继转发给供应商（OpenAI 或 Anthropic 协议），流式回传。
4. 响应 JSON 解析（全角容忍、剥围栏、思考层打捞）；非法 → 退避重试；最终兜底 → 贪心安全着法。
5. 代码级守卫（开局炮吃禁手、送吃守卫）可在落子前拒绝着法；拒绝计入 `usage.blocked`。
6. `engine.applyPlayerMove()`；时钟、重复局面、HUD 与棋谱同步更新。

## 提示词缓存契约（勿破坏）

- `system` 提示词**整局字节级恒定**（不逐手裁剪）。两级：`none`（任务 + 输出协议）与 `high`（增加策略/战术，默认）；其余设置值归一为 `high`。两级共享局面摘要与引擎安全守卫；既有棋谱元数据不重写。LLM 请求调 `summarize` 时传 `openingTasks: false` 以省略旧版固定开局路线；默认观战摘要与数值评估不受影响。
- 对话历史**只追加**：(用户请求, 助手原始 JSON) 对；每次请求的前缀 ⊇ 上一次。
- 重试块永远位于**末尾**，重试可复用失败请求的缓存前缀。
- `HIST_CAP`（默认 10 对）从头部裁剪并重新注入任务头。
- 守卫：`npm run check` 跑提示词硬门禁（`test/dump_prompts.js --check`：system ≤ 2400 字、无特殊符号 ①②③≥≤~→⚠）。

## 测试地图

| 套件 | 守护内容 |
|---|---|
| `test/run_tests.js` | 引擎规则、时钟、重复局面、perft、make/unmake 往返 |
| `test/test_evaluation.js` | 评估项 + 知识启发式（起始局面零噪声） |
| `test/test_llm_convo.js` | 提示词组装、缓存契约、解析/重试/兜底、安全守卫 |
| `test/test_match_lifecycle.js` | 对局截止、迟到结果隔离、观察者失败、CLI 计分恰一次 |
| `test/test_settings_modes.js` | 有效玩家模式、隐藏配置保留、两级设置迁移、缺 key 警告与延迟聚焦 |
| `test/test_spectator.js` | 红方视角固定展示估计、终局态、非法评分、快照缓存、不改对局 |
| `test/test_thinking_visual.js` | 直播/回传思考展示、转义、当前 agent 回调闸门与语言保持 |
| `test/replay_smoke.js` | 回放重驱（无棋谱时合成一局） |
| `test/_clean_reason_check.js` | 思考流清洗规则 |
| `test/cn_notation_check.js` | 中文记谱（消歧边界） |
| `test/_replay_edge.js` | 回放边界 + 书签纯逻辑 |
| `test/_logic_layer.js` | 纯逻辑层守护（记谱、HUD 助手）、引擎 `legalTargets`/`dangerTargets` 记忆化 + 状态版本失效、DOM 桩渲染热路径（每渲染一次 `snapshot()`、O(1) `isOver`、箭头 SVG 去重、走势图签名去重、move-log `tabindex`、横幅→`#sr-alert` 播报）、DOM 桩 **i18n/字形**块（语言热切事件到达 `document`、`pieceGlyph` 遵循 `xq_pieces`、兜底着法文案按语言中立 `fallback` 旗标、双调用点时钟文案一致）、`vm` 桩 **SW 离线壳**守护（安装期预缓存覆盖 index.html 引用的全部子资源、作用域相对的导航兜底、拒绝的缓存写入吞掉）、**L14** 决策卡 a11y 标签对照真实字典、**L15** 重复计数悔棋时点与 `inCheck`/`posKey` 热路径记忆化、**L16** sw.js 作用域相对 `/api/` 判定与挂在事件生命周期上的缓存写（手工放行的 `put` 证明 `waitUntil` promise 保持 pending）、**L17** 终局卡键盘出口与「已收起」旗标（含收起后再渲染一次的探针）、90 格全部 `role="img"` + 坐标可访问名、move-log `role="button"`、最后着法徽章可访问名随语言热切重算、**L18** `err` 横幅播报/可聚焦/隐藏归还焦点、**L19** `snapshot()` 记忆化（同版本同对象、走子后新对象、悔棋后还原盘面）、**L20** 增量着法统计每手对照全谱回放（随机样本强制打到将杀；undo 经快照栈精确还原统计、续弈仍正确、`newGame` 重置；SW `activate` 只删自己的 `xq-shell-` 前缀 — 用 `caches.keys()` 桩同时放一个邻居应用缓存来证明） |
| `test/i18n_check.js` | i18n 字典守护 15 组（zh/en 键集一致、占位符一致、静态 `data-i18n` + JS `t()` 覆盖、静态/JS 侧 CJK 属性与动态写入口泄漏、非首参键引用存在性、按钮文案钩子、偏好选项钩子、JS 模板 `data-i18n*` 键存在性、纯符号按钮可访问名） |
| `test/link_check.js` | 文档链接守护 — 全仓 `.md` 相对链接必须可解析，`docs/` / `.github/` 内链接必须 `../` 前缀（同目录链接本地能解析但指向错误的 GitHub URL） |
| `test/_prompt_level_smoke.js` | 双方/双等级：长度与符号上限、固定前缀、旧设置归一、可执行 JSON 示例与预算 |
| `test/replay_risk_check.js` | 回放风险探测器 — 含惰性填充路径（跳转到某手与逐手走到该手，风险表与 将/杀/困 标记一致；`computeRisk` 必须把引擎摆到着法**之前**的局面）+ 棋谱配额兜底 |
| `test/_committee_agent.js` | 同侧多 LLM 委员会（委员会投票、平票决出、轮换、全失败、用量求和） |
| `test/_server_http.js` | server.js HTTP 行为 131 项检查（真实起服务：ETag/304、穿越 403（含反斜杠形态）、限流 429 + Retry-After、请求侧校验 400、OpenAI 非流式 + **流式 SSE** + Anthropic 协议中继、精确 origin CORS 白名单、**keys.json 热加载 + 半写容忍**、**静态缓存失效**（同尺寸改写也不得回旧字节）、**上游请求构造**（逐供应商头合并、`thinking` 仅 GLM 系且真实注入、尾斜杠剥离与默认/逐供应商 `chatPath`、流式才带 `stream_options`）、**上游失败 → 502**、**上游非 200 透传**（401/429/500 不得改写成 200/502 — 流式下错误体被当 SSE 解析会伪装成「流式返回为空」）、**非对象 JSON body → 400**（曾致进程崩溃的远程单点）、**敏感路径黑名单**（`/config/keys.json` 曾被原样吐出真实 key —「key 不出服务端」的 README 承诺一度为假；`.git/`、`logs/` 与点目录同样拒绝）、**空字节路径守卫**、每个提前拒绝分支及 `health`/`providers` 都带 ACAO、providers 字段透传、OPTIONS 预检、keys.json ENOENT 容忍、静态 `Cache-Control`、**响应中途上游中止**（非流式路径曾无响应挂死 12 秒 — 双协议路径必须 502 且进程存活）、**非流式上游 body 16MB 上限**、**黑名单按规范化路径逐段判定**（`/x/..%5cconfig/keys.json` 曾绕过裸首段判定）、**仅按 pathname 路由**（带 query 的 `/api/chat` 曾掉进静态分支）等） |
| `test/check_ui.js` | 语法清扫、ID 对账、localStorage 前缀、发布文件、README 版本对齐、HTML 净化、PWA manifest + SW 守护（图标/截图/分类）、回放对话框语义、生命周期世代守卫、a11y/PWA 源串守卫（`#sr-alert` 播报、`#sr-cursor` 键盘光标播报、label `for=`、走法列表键盘、拖拽中止、终局卡焦点归还、设置层模态快捷键闸门、SW 壳预缓存 + 导航兜底 + 缓存写兜底、棋子字单出口、兜底着法判定），接线/写入点守卫 — 静态 id 必须从 `document` 取（子树查询静默返回 null）、终局卡导出绑定、回放盘与候选悬停共读的 `dataset.flip` 写入、`#btn-row` 隐藏态（隐藏却可聚焦）、让导出 `updateClock` 可达的状态时钟 ticker、Enter/Space 让位给消费按键的控件、键盘光标播报随光标清理、回放层首绘、面板统计单出口、回放态 AI 闸门、终局卡 `Te`/`TAe` 别名先赋值后调用（var 只提升声明 — 该时序 bug 曾在 AI-vs-AI 局抛错并被 AI 失败处理器吞掉）、展示值/时点节（回放工具条文案必须走字典、播放/暂停按钮需自己的首绘、Elo 天梯与回放帮助两层全屏浮层都要对话语义 + 统一键盘出口 — Esc 曾被下层回放层吞掉导致浮层悬在盘面上、重复计数键必须在 `undoMove` **之前**取、引擎热路径记忆化必须存在且被 `bumpVer` 失效）、a11y/i18n/热路径/PWA 节（回放工具条纯符号按钮可访问名、棋谱选择器/跳转框/思考面板翻页器、翻转与全屏切换的 `aria-pressed`、试连结果的 live 区域、回放层 Tab 陷阱让位更高层模态、走法列表重建后焦点回到同一手、委员会与帮助表 `th[scope]`、走法效果字形走字典而 杀/困/将 判定保持语言中立标记、拖拽幽灵缓存尺寸、分隔条与音量滑块只在松手时落盘、回放 range 输入按动画帧合并、sw.js 作用域相对 `/api/` 判定 + 缓存写挂 `waitUntil`、manifest 底色对照页面**生效**的 `body` 规则 — 读第一个匹配会取到被覆盖前的颜色）、**一键双动作**与**ARIA 失效形态**节（分隔条方向键让位 + `selfActing` 识别 `role="separator"`、最后着法徽章真 `<button>` + 活绑定 + 隐藏态 visibility 契约、棋盘格 `role="img"`（无角色 div 上的 aria-label 按规范被忽略）、move-log `role="button"`、终局卡收起旗标及其复位、恢复横幅 `role="status` 空插入后填文本、思考面板/回放头部/信息面板整体重建后焦点与展开态存活、四组焦点陷阱选择器里的 `a[href]`）、**一动作两入口只修一条**节（终局卡背板点击必须与 Esc 同走 `dismissEndOverlay` 出口、回放走法列表与主列表同口径 `role="button"` + `aria-current`、双协议上游失败 502 都带 ACAO）、**默认焦点吞 Esc**（回放层开启聚焦 `<select>` 而全局 keydown 对 SELECT 早退）、**横幅语义**（`window.onerror` 的 err 横幅必须到达 `#sr-alert`、可聚焦、真有关闭绑定、隐藏持焦点横幅归还焦点）、**守路不守名**与**模态仍操作背景**节（静态托管敏感目录黑名单与空字节守卫、提前拒绝与探针端点 ACAO、sw.js 只缓存 `status===200`、回放层开启时消费全部未处理按键、`role="group"` + `aria-labelledby` 设置双栏、悔棋/重开走法日志焦点守护、回放传输按钮禁用后焦点保持、主走法日志 `aria-current`、回放全屏按钮随状态与语言变化的名称、`#server-warn` `role="status"`、`snapshot()` 记忆化与逐手死分配 `logText` 的移除）、规范化/路由/中继出口/焦点保持节（黑名单按规范化路径逐段判定（裸首段可被 `..%5c` 绕过）、仅按 pathname 路由、双非流式中继路径单一幂等过早关闭出口 + body 上限、SW activate 按自身前缀过滤、引擎 `gaveCheck` 将杀算将军且统计快照栈与 `history` 同长、`#btn-row` 隐藏/回放还原条隐藏/归档按钮禁用/回放打开者不可聚焦四处收焦点、横幅 `role` 跟随可聚焦性、高速回放 `aria-current` 随 `.active` 移动、供应商试连结果走 `tArgs` 替换 `{ms}`、热切换重绘覆盖 `#server-warn` 与终局统计） |
| `npm run check` | 全部 JS 文件语法清扫 + 提示词硬门禁 |

全套跑 `npm test`（27 套件）— CI 在 Node 18/20/22/24 (ubuntu) 与 Node 22 (windows) 上跑 `npm run check` + `npm test`。

## 约定

- **零依赖。** 浏览器模块挂 `XQ.*` 命名空间，不得使用 `require()`；Node-only 代码在 `server.js`、`tools/`、`test/`。
- 静态 UI 文件热可刷新（F5）；只有 `server.js` 改动需要重启。
- 运行产物（`logs/`、`temp/`、`screenshots/`）永不入库；`config/keys.json` 同样不入库。
- PR 清单见 [CONTRIBUTING.md](../CONTRIBUTING.md)，安全模型见 [SECURITY.md](../SECURITY.md)。
