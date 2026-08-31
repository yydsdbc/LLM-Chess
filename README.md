# 🦞 LLM-chess v1.0 · AI 对战直播平台

中国象棋 + LLM 对战平台。v1.5 决策卡片流/棋风对垒/观战动效；v1.6 回放系统（不调 LLM 快速重看对局）；v1.7 HUD 观战仪表盘（被吃托盘/中文记谱/评值走势/终局结算）；v2 赛博暗金主题。核心引擎可独立用于搜索算法（alpha-beta / MCTS）与 Agent 研发。


## 快速开始

```bash
git clone <本仓库>
cd LLM-chess
双击 启动.cmd        # 或: npm start (需 Node.js 18+)
```
启动后浏览器自动打开 http://localhost:8788。

- **零配置试玩**: 齿轮设置 → 执方选「随机AI」→ 开战 — 无需任何 API Key
- **接入 LLM**: 编辑 `config/keys.json` 填入任意服务商 apiKey (首次运行自动生成空白模板, 16 家服务商格式参考 `config/keys.example.json`) → 重启即生效
- **一键测试**: `npm test` (引擎 perft 金标准 + 提示词/评价/回放/记谱 全套守护)
- **停止**: 双击 停止.cmd 或 `npm stop`

## 安全与配置

- `config/keys.json` 含密钥, 已被 `.gitignore` 排除, 永远不会被提交; 格式参考 `config/keys.example.json`
- 密钥只保存在服务端, 前端经 `/api/chat` 中继调用, 浏览器永不见密钥
- 服务默认只监听 127.0.0.1; 局域网对战设环境变量 `LLMCHESS_HOST=0.0.0.0` 后重启
- 运行产物目录 (logs/ temp/ screenshots/) 均不入库

## 目录结构

```
LLM-chess/
├── index.html          # 页面壳 (仅加载脚本, 无逻辑)
├── server.js           # 本地服务器: 静态托管 + /api/chat 密钥中继
├── 启动.cmd / 停止.cmd  # 一键后台启停 (端口 8788)
├── OPTIMIZATION_LOG.md # 优化日志 (人工 + 自动优化代理逐轮追加, 防重复)
├── config/
│   └── keys.json       # 各服务商 API Key (服务端持有, 首次运行自动生成模板)
├── core/               # 引擎内核 (浏览器/Node 双环境, 与 UI 零耦合)
│   ├── piece.js        #   棋子 {color,type,id}
│   ├── move.js         #   走法 {from,to,piece,captured} + apply/undo/clone 支持
│   ├── board.js        #   棋盘状态 (clone/applyMove/undoMove/toText)
│   ├── rules.js        #   规则: 各兵种着法/将军/照面(飞将)/攻击图
│   ├── generator.js    #   generateLegalMoves / perft
│   ├── judge.js        #   将杀 / 困毙判定 (困毙判负)
│   └── engine.js       #   Engine 门面 (UI 唯一入口)
├── ai/
│   ├── random_agent.js #   随机合法着法 (基准对手)
│   └── llm_agent.js    #   OpenAI 协议 Agent (走 /api/chat 中继, 重试+自校验)
├── benchmark/
│   ├── match.js        #   对局管理 (任意两 Agent 对弈→棋谱记录)
│   ├── record.js       #   棋谱: localStorage + JSON 导入导出
│   ├── elo.js          #   Elo 评分表
│   └── cli.js          #   命令行批量对局
├── evaluation/
│   ├── xiangqi_knowledge.js # 阶段判断(开/中/残) + 动态子力价值表 + 评价原则文案
│   └── position.js          # PositionEvaluator: 活跃度/将帅安全/压力/兵线 → 中文摘要
├── ui/
│   ├── renderer.js     #   纯渲染 (只读 Engine 快照)
│   └── app.js          #   控制器: 交互/音效/存档/Agent调度/回放覆盖层
├── replay/
│   ├── replay.js            # 回放数据层: 棋谱 → 引擎状态机 (next增量/prev/goto重建, 脏数据容错)
│   └── replay_controller.js # 回放控制层: 播放/暂停/步进/跳转/倍速7档/循环
└── test/               # run_tests.js 49项(perft金标准+重复局面/长将追踪/moveTag杀标注/长将判负/三次重复判和/送吃守卫) · test_llm_convo.js 140项(提示词/重试/兑底安全阀/开局炮保护回归/对拉与长将警示/重复局面警示/合法列表杀标注/亏子标注/危子预标/全角容错/对手吃子标注/重试钩子/多轮缓存守护/HIST_CAP裁剪/reasoning打捞) · replay_smoke.js 45项 · test_evaluation.js 81项(含士象完整性/底线老兵/空头炮/窝心马/中炮矄中卒/开局任务提醒/出车提醒) · _clean_reason_check.js 10项 · analyze_blunders.js 瞎走检测器(含错失必杀) · check_ui.js 语法+ID核查 · smoke_ui.js UI冒烟13项
```

## v1.5 观战直播平台

- **AI 信息面板**：双侧面板头部下方 info 条 —— 棋风徽章(⚔攻击/⚖均衡/🛡防守) + 局面评价摘要(优势绿/风险红)；思考中闪烁提示。
- **思考可视化（决策卡片）**：每手落子后面板切换为卡片流 —— 着法/战略计划/摘要/候选着法+评分/信心/耗时，最近 4 手；备选模式保留分页文本流。
- **棋风系统**：设置页每方可选 攻击型/均衡型/防守型，注入 system prompt 影响攻防倾向；棋风随棋谱存档（redStyle/blackStyle）。
- **观战动效**：落子滑动入位(0.28s) + 吃子 ghost 淡出 + 将军警示音(两连上升音) + 将帅格红色脉冲 + 思考面板呼吸边框。
- **统一输出协议**：LLM 扩展 JSON `{from,to,plan,summary,candidates[{move,score}],evaluation,confidence}`，解析失败前 2 次严格重试(含字段完整性校验)、第 3 次坐标兑底(校验合法列表)；嵌套 JSON 用括号配对扫描器提取。
- **快棋提示词 (v1.5.2)**：system 629 字(原 1178)——禁深推、凭直觉一步选定、优先级一行化、输出总长≤120字；max_tokens 2000；实测 glm-5.3-flash 首手 8~20s (原 70~300s); 流式 JSON 不上推面板 (仅 reasoning 上推) + 强制 100% 简体中文 + 字体加大 (12.5px) + stat 压紧防 tokens 被挤 + UNKNOWN_FIELD/REASONING_REQUIRED 自动摘字段重试；thinking 字段链路已打通(server 透传, 默认不发送, glm-5.3 系强制思考)。
- **提示词 v1.5.7 五项优化**：①输出示例按执方定制（红 h3-e3 / 黑 h8-e8，防黑方照抄红方示例坐标被判非法）；②新增“方向感”节（红下黑上、进=行号增减、河界位置，免去模型猜方向）；③candidates 改“起点-终点”坐标制（删中文记谱转换负担）+ score 口径定义（你方视角 -3~+3）；④增量 user 注入近 8 手全局序列（防重复对拉）+ 战略优先级补“禁长将长捉”；⑤重试提示给出“逐字核对坐标/必填字段一个不能少”具体修正指引 + 输出禁 markdown 围栏。test_llm_convo 51→60。
- **提示词 v1.5.8 落子提速五项**：①新增“思考纪律(速度红线)”节（思考最多 3 短句、只比较 2 个候选、禁逐子扫描/推演多回合——思考模型解码时长是落子延迟大头）；②开局三节（开局路线/开局核心/不镜像）仅前 4 手注入，第 5 手起动态裁剪（中残局 system 少约 350 字）；③必填字段对齐严格校验（仅 summary/confidence 必填，plan/evaluation/candidates 降为可选——字段越多格式失败重试越多）；④战术快通道（必杀/强制将军/白吃大子时第一直觉即最终答案）；⑤输出预算收紧（总长≤120→≤90字、summary≤18→≤14字、JSON 一行写完）。另：llm_agent 补 attempt 失败/兑底 console.warn 排障日志（正常局零噪音）。实测 6 手 match_headless：**6/6 全 meta 零兑底**（v1.5.7 两轮分别 5/6、3/4），红均 38.4→25.7s；诊断日志当场抓到一次英文推理重试。test_llm_convo 60→66。
- **v1.5.9 接口错误修复**：①max_tokens 2000→4096（思考模型的 reasoning_content 与 JSON 同计 max_tokens，2000 会把长思考+JSON 一起截断 → 无 JSON 可解析，是“返回无法解析/为空”类接口错误的主因；只提上限，不影响短回复耗时）；②请求超时 90s→120s（provider 排队波 70~300s，90s 必中断后重试总耗时更长）；③重试提示按失败原因定制：解析失败/为空/超时类追加“100% 简体中文思考、思考≤3短句、立即输出 JSON 原文”针对性提示（retryBlock() 统一两处内联重试块）。实测 6 手：6/6 全 meta、重试 0/0（历史首次零重试零兑底）。test_llm_convo 66→67。
- **DeepSeek 接口排障**：报障“deepseek 模型接口都有问题”根因 = **apiKey 从未配置**（relay 每请求 400“未配置 apiKey”），keys.json 内仅 tokenrhythm 有 key。连带修复：①relay socket 空闲超时 65s→180s（排队波 70~300s 时 relay 会先杀请求 → 502；须大于 agent 的 120s）；②thinking 开关仅 GLM 系（bigmodel/tokenrhythm）透传，防非 GLM 上游未知字段 400；③agent 遇永久错误（401/402/403/模型不存在/余额不足）立即失败不烧 3 次重试；④上游 error 对象正确提取 message（不再 [object Object]）；⑤keys.json 补全各商 models 推荐（UI 模型框自动填默认值）。**剩余动作：用户在 config/keys.json 填 deepseek 的 apiKey 后重启**（deepseek-chat=快棋合适不思考；deepseek-reasoner=恒思考不可关）。test_llm_convo 67→69。
- **v1.5.10 观战体验六项**（实战截图反馈）：①思考流清洗 cleanReason（token 级扫描检测：≥4 连续子力字/短数字/点横加号（含全角变体 －＋）压成 …，小数占位符保护、散文标点打断、进/平/捉动词保记谱，决策卡💭同源清洗，回归用例 test/_clean_reason_check.js）；②决策卡片不因落子变浅（idle 弱化只限纯文本模式）；③思考方面板金色高亮（border/glow 加强 + 模型名发光 + 圆点脉冲）；④棋盘行列坐标（左 10~1 / 下 a~i，DOM 网格标签）；⑤prompt：无保护子力放心吃 + 残局（双方车炮马总数≤3）鼓励兵卒进攻；⑥tokenrhythm datalist 补 deepseek-v4-flash-0731 / deepseek-v4-pro-0813。静态文件改动，浏览器 F5 生效。test_llm_convo 69→70。

## v1.6 回放系统

- **🎬 观看回放**：不调 LLM，把已保存棋谱（localStorage `xq_records_v1` / 📂 导入的 JSON / `logs/match_headless.json`）快速重驱动棋盘。数据层 `replay/replay.js`（next 增量 / prev、goto 重建引擎 / 脏数据容错），控制层 `replay_controller.js`（BASE_MS=10s/步，播放/暂停/步进/跳转/循环/自动停止）。
- **回放控制**：倍速 7 档（0.25x 慢动作 → 20x 快进）、±5/±10 跳转、GO 输入跳转、进度滑块+百分比、续看进度（按棋谱 id 存 localStorage）、滚轮步进、边界按钮禁用、快捷键（←→/Home/End/Space/0/L/1-7/?/Esc）、键盘帮助弹窗、倍速记忆（重开恢复上次倍速）。
- **回放可视化**：评估条（evaluation 文本→数字→红黑横条，支持纯文字评价兜底）、评值走势曲线（全局 SVG 连线，金点=当前，点击跳转）、思考时长柱状图（红蓝分边，点击跳转）、走法列表（AI 简短分析主导航+过滤+侧色）、下着预览（棋盘半透明橙框）、棋盘行列坐标、子力/分边/平均耗时统计、ETA 剩余时间、PGN 导出（标准 "1. 红手 黑手 2. ..." 格式+结果标记）。

## v1.7 HUD 观战仪表盘 & v2 赛博主题

- **HUD 十项**：被吃子力托盘、最新着法大字徽章（4s 淡出）、中文记谱 cnNotation（红汉字/黑数字，实战验证 炮八平五/砲8平5）、评值 sparkline（本方视角 ±3）、思考 60s 提醒、将军横幅+棋盘红光脉冲、终局结算卡（均耗/吃子/token）、棋谱侧色点、状态条思考期手数、思考面板折叠。
- **质量守护（代码级）**：开局保护拦截（前 2 回合炮吃马/士/象非将军直接拒绝重选；v2.3 修复类型名 horse/elephant→knight/bishop — 原写法永不命中，炮吃马/象实际未拦截，附回归测试）；兑底安全阀（第 3 次文本兑底若静态评分劣于贪心最优 >1.5 → 换安全走法）；重试降温（attempt≥2 时 temperature 收敛 0.1，格式重试要确定性）；吃子三问/落子自检/防拉锯等 11 项提示词策略 + 特殊符号清扫（防模型复述乱码）。
- **v1.7.9 杀棋知识链路**：`Judge.moveTag(b, op)` 一步效果统一判定（杀=将军无解 / 困=困毙判负 / 将 / null）→ ①LLM 合法列表升级为 `[b3>e3吃卒杀]` 式标注（有杀/困时 user 消息追加“一步直接取胜优先选它”提示，system 长度不变）；②兑底安全阀可杀就杀（mate/stalemate +1000 压倒子力得失）；③回放走法列表+信息面板彩色标注 杀/困/将（replay.moveRisk 顺路计算，零额外开销）；④analyze_blunders 新增“错失必杀”检测（盘面有一步绝杀却没走 → 点名报告）。测试：run_tests 33→37、replay_smoke 31→33。
- **v2 赛博主题**：黑曜石×暗金全量换肤（级联覆盖层不改原规则），金属棋盘外框、HUD 分段横幅、状态色系统、文字三级层级。
- **v2.0 规则闭环 — 长将判负**：引擎级终局规则（亚洲棋规：长将属违例）——一方连续将军 6 半回合（3 回合）仍不变招 → 自动终局 `result='perpetual'`，长将方判负（优先级低于将杀/困毙）；`Engine.create({ruleEnforce:false})` 可关（analyze_blunders 分析器不重判旧棋谱）；终局卡补长将判负原因文案；HUD 兑底透明化（3 次重试后的兑底着法在决策卡/大字徽章标 ⚠兑底，观战者知悉非模型自信决策）。测试：run_tests 37→40。
- **v2.2 规则闭环 — 三次重复判和 + 送吃守卫**：①同一盘面+执子方第 3 次出现 → 自动终局 `result='repetition'` 和棋（任一方存在连将计数时跳过判和，由长将规则优先处理；`ruleEnforce:false` 可关；回放重建引擎显式关规则，忠实重放旧谱）；②llm_agent 送吃守卫 guardHanging：车炮马非吃子不将军落点被低值子攻击且无保护、1 层静态交换净损 3 分以上 → 拒绝重选（直击实战送马/送炮瞎走；兑底路径不拦防死循环；agent.guardCheck() 诊断口供测试）；③模型知情：局面第 2 次重复时 user 注入“第 3 次将自动判和，优势须变招/劣势可求和”警示（首手/增量共用 repWarnText）；④修复 v1.7.5b 兑底安全阀交换评估同款 bug（未先落对方吃子就算吃回 → gain 恒 0，有保护大子被高估损失）。测试：run_tests 40→42、test_llm_convo 86→89。
- **v2.3 评价与观战小改（自动优化第5轮）**：①评价管线去重复计算（一次评价 snapshot 6→1 次、合法着法生成 4→2 次，输出不变）；②底线兵“老兵”知识（兵到底线只能横移，子力 ×0.7 + 摘要点名勿再拱，零噪音）；③主界面全屏观战（⛶ 按钮 / F 键；回放内 F 仍为回放全屏，不冲突）。测试：test_evaluation 43→47、test_llm_convo 89→92。
- **v2.4 对局质量与回放闭环（自动优化第6轮）**：①空头炮知识（对方炮与己将同列且中间零隔子 → 摘要风险点名“勿随手垫子”，己方视角则报优势；有隔子不误报，零噪音）；②对手上一手吃子点名声（user 消息“吃掉你的X”，免模型逐格对比棋盘找被吃子，无吃零噪音）；③评价管线 cloneBoard 去重（宫攻/受威胁四项共享一次克隆，4→1，输出不变）；④终局卡“🎬 回放本局”按钮（打完直接看录像，免去回放选择器翻找）；⑤回放层 📂 导入本地 JSON（与 保存棋谱 导出格式一致，主界面载入只重放无控制，这里给完整回放体验）；⑥回放循环播放状态记忆（与倍速记忆同欥 localStorage）。测试：test_evaluation 47→51、test_llm_convo 92→98。
- **v2.5 观战可见性·知识·保谱（手动轮，cron 已停改人工）**：①onRetry 钩子（llm_agent → app.js 状态条实时显示“重试N次”，直击重试烧 70~300s 观战黑箱）；②窝心马知识（马入九宫中心 e2/e9 → 摘要点名“自堵九宫宜跳出”/对方受困则报优势，初始局零噪音，评价层注入不动 systemPrompt）；③match_headless 残局保谱（LLM 故障/自校验失败不再丢整局，残谱落盘 + 瞎走检测照跑，09:47 断网局全丢教训）；④replay_smoke 短谱保护（json <8 手自动合成 12 手确定性测试谱，残谱不再弄挂守卫套件）。测试：test_llm_convo 98→101、test_evaluation 51→55。
- **v2.5b 口径澄清 + 中炮矄中卒提醒（用户指令）**：①提示词澄清开局禁令语义 — 前 2 回合仅禁「炮吃马/士/象」换子吃法，炮的调动（架中炮/平炮/巡河）不受限且属正常出子，消除模型把禁令读成“少动炮”的空间；②评价层中炮矄中卒检测（己方炮与对方中兵同列且恰一隔子 → 攻方摘要“勿轻打：打卒落点常被马/车反吃”，守方摘要“可跃马护卒或兑卒解脱”；初始局/无隔子零噪音，仅提醒不评分）；③代码硬拦语义核实：ply<4 仅拦炮吃马/士/象的吃子，非吃子调动从不拦。测试：test_evaluation 55→59；system 1957→1985 字（≤2000 守护过）。
- **v2.6 前缀缓存优化（底层机制）**：①开局三节全程保留（原第5手动态裁剪每局制造一次全前缀失效，节内自带“中残局忽略”自限标记，system 2014 字恒定）；②user 消息首段静态任务头（与 system 构成恒定前缀，动态内容全部后置）；③重试块绝对居末（重试请求前缀与首次一致 → 复用已缓存前缀）；④缓存命中观测（usage.cacheHit 三口径兼容 deepseek/openai/anthropic 上报 + 无头对局统计行“缓存命中 X tok (Y%)”）；⑤守护同步：system 上限 2000→2400、裁剪断言改恒定断言。测试：test_llm_convo 101→107。
- **v2.7 多轮对话结构（首请求建缓存、后续请求只追加）**：①历史以 (user 原样请求, assistant 原样 JSON 回复) 对追加 — 请求 N+1 的前缀 ⊇ 请求 N 全体，前缀缓存理论最优形态；②增量 user 不再重复任务头（多轮上下文常驻，每手省 ~57 字）；③重试块追加于末尾，失败请求全体复用；④历史上限 HIST_CAP=10 对（16 手局不触顶，超限从头裁一次性重建）；⑤实测 4 手真跑：缓存命中 红 2112 tok (42%) / 黑 2048 tok (41%)（tokenrhythm 上游真实上报），meta 4/4 零重试 MATCH OK。测试：test_llm_convo 107→110（userOf 助手迁移 31 处断言）。
- **v2.9 自测驱动优化轮（用户指令：自测至少10点）**：①evalMove2 提升 create 层（亏标注复用前置）；②合法列表静态交换净亏吃子标 '亏'（直击黑马吃兵被象反吃盲区，模型看列表即避坑）；③reasoning_content JSON 打捞（内容层散文时免重试，实测打捞命中零重试）；④限流/503 线性退避 3s→6s→9s；⑤HIST_CAP 裁剪可见化；⑥app.js 信息卡实时显示缓存命中率（两处）；⑦usage.blocked 代码级拦截计数；⑧match_headless 新增系统拦截统计行；⑨retryBlock 强化：勿解释勿复述+被拒着法不可再选（针对守卫拦截后英文讲解循环）；⑩守卫正确性实证：车 a10-b10/a1-b1 拦截为真阳性（b8 黑炮原位当架，借架吃车模式确认，非假阳性）；⑪测试 +3（亏标注/reasoning打捞/零重试）+userOf 迁移；⑫16 手完整对局验证：缓存命中 62%/72%、瞎走 0、守卫三连救车。测试：test_llm_convo 110→113。
- **v2.8 提示词精修（用户指令：继续优化提示词）**：①多轮须知（历史里的棋盘/评价均为旧局面，只依最后一条 user 决策；历史中自己的 JSON 保持风格一致——护住 v2.7 多轮架构的认知一致性）；②系统末尾首字符复强调（回复第一个字符必须是 {、禁英文与讲解、禁围栏——针对今日实战高频失败模式'Let me analyze...'英文讲解烧重试，利用末位近因效应）；③落子自检补窝心马禁入（与评价层 v2.5 窝心马惩罚双重保险）。system 2014→2161 字（≤2400 守护过）。
- **v3.0 开局四步序提示词（用户指令）**：开局路线重写为首要目标四步序 — 第一步架中炮 (炮二/八平五) → 第二步上正马 (马二进三/马八进七) → 第三步挺兵 (兵三/七进一) 给马腾出马脚 → 第四步马跃过河进攻 (卧槽马/盘头马)；仅当炮路受制或必杀才变通；开局核心改为每手核对四步序进度 (马脚未开时挺兵优先于跃马)；不再按棋风三选一。实测 6 手真跑：模型严格按序执行 (架中炮→上马→挺兵，摘要自述'按四步序推进')，瞎走 0，meta 6/6；一次上游 503 鉴权抖动被线性退避接住；新增系统拦截统计行 0/0 上线。测试：test_evaluation 59/59 (锚点同步)；system 2161→2190 字（≤2400）。
- **v3.1 开局三任务制（用户指令）**：顺序放开 — 架炮与上马先后不限，挺兵与跃马次序灵活；硬约束改为“八步内完成三任务：架中炮/上正马(两匹)/挺兵开马脚”；任务完成后**优先出车进攻**（车一平二/车九平八，占肋道/卒林线，车马炮协同过河）；test_evaluation 锚点同步（三任务/出车）。8 手真跑：红 炮马马车 / 黑 炮马车马 — 顺序灵活性与出车鼓励均生效；缓存命中 71%/65%；瞎走 0；system 2190→2211 字。遗留观察：本局挺兵被出车挤到八步后未走，若需“三任务未齐不出车”强约束可再收紧。
- **v3.7 对局质量与观战小改 (未入日志轮, 从代码注释回补)**：①评价层将门/肋道控制检测（己方大子/过河兵占对方 d/f 路 → 双向点名“压将门可谋杀势/九宫吃紧”，仅提醒不评分）；②HUD 阶段徽章（状态条显示 开局/中局/残局）；③合法列表排序（杀/困→将→吃→普通→危/亏，首因偏置）+ 标注跨 attempt 缓存；④HIST_CAP 裁剪后手数由引擎步数推导（原 convo.length+1 裁剪后错显）；⑤analyze_blunders 开局三任务检测 + --selftest 回归；test_evaluation 64→70 / test_llm_convo 120→124
- **v3.8 自动优化轮 (cron 第7轮)**：①自然限着判和规则闭环 — 连续 120 半回合 (60 回合, 亚洲棋规) 无吃子 → 自动终局 result="natural" 和棋（naturalCap 可配/0 关，吃子重置，将军着法不计入，ruleEnforce:false 不判，兜住换序拉锯不精确重复可无限延续的盲区）；②retryWaitMs 模块级纯函数导出，退避覆盖 429/50[234]/gateway（旧版 504 仅等 0.4s 重打）；③PGN 导出和棋标准记号 1/2-1/2；④兵临九宫知识（过河兵入对方九宫区 子力 ×1.2 + 双向摘要点名，与底线老兵互斥）；⑤回放 URL 深链 #rp=ls:<id>（刷新/分享续看）；run_tests 42→44 / test_evaluation 70→78 / test_llm_convo 124→130
- **v3.9 三方并行大轮 (第8轮, 30 项)**：core 真 bug 双修（undoPly genesis 板重算 + naturalClock 将军不计入口径落地，新增 XQ.Engine.replayStats）+ snapshot 增量（ply/naturalClock/repetitionCount）+ E18-E22/make-unmake 对账/E1 永真修复/loadSerialized 失败重置；ai 解析健壮性（全角救回文案保原文 origTextField/confidenceRaw/裸键容错/attempts 计数/opts.signal 外部中止/retryBlock 自查）；ui 与回放（parseEval 迁 replay.js 方向修复/导入落库深链/Record.summarize 一行战绩/沉底炮知识/cnNotation 同列前中后消歧/键盘 [ ] ±5/match_headless 原子写/analyze_blunders --top --type/check_ui src+LS 守护/模型表同步 kimi-k2.6·MiniMax-M3·qwen3.5-plus）
- **自动优化代理**：cron 每 30 分钟自动实施不重复优化并追加 `OPTIMIZATION_LOG.md`（全套测试守护）。

## 运行

## 快速上手 (三步)

1. **解压后双击 `启动.cmd`** — 自动后台启动服务并打开浏览器 (需已安装 Node.js 18+；未安装会给出下载地址)
2. **首次使用**: 编辑 `config/keys.json`, 在你用的服务商下填入 `apiKey` (模板已含 tokenrhythm 在内的全部服务商)，保存后重启一次
3. **开棋**: 棋盘左上角 ⚙ 选双方模型/棋风 → 开始对局；`停止.cmd` 一键停止

> 默认端口 8788 (启动时可用参数覆盖)；服务默认仅本机可访问，局域网访问设环境变量 `LLMCHESS_HOST=0.0.0.0` 后重启。

## 内置模型服务商 (16 家，config/keys.json 填 apiKey 即用)

| 服务商 | 接口 | 模型示例 |
|---|---|---|
| TokenRhythm | OpenAI 兼容 | glm-5.3-flash / deepseek-v4-flash |
| 阿里通义千问 | OpenAI 兼容 (DashScope) | qwen-max / qwen-plus / qwen3-max |
| 字节豆包 | OpenAI 兼容 (火山方舟) | doubao-1.5-pro-32k |
| 腾讯混元 | OpenAI 兼容 | hunyuan-turbo / hunyuan-pro |
| 讯飞星火 | OpenAI 兼容 | 4.0Ultra / max-32k |
| 月之暗面 Kimi | OpenAI 兼容 | kimi-k2-turbo-preview |
| DeepSeek | OpenAI 兼容 | deepseek-chat / deepseek-reasoner |
| 智谱 GLM | OpenAI 兼容 | glm-4.7-flash / glm-4.5-flash |
| 百川智能 | OpenAI 兼容 | Baichuan4 |
| 零一万物 | OpenAI 兼容 | yi-large |
| 阶跃星辰 | OpenAI 兼容 | step-2-16k |
| MiniMax | OpenAI 兼容 | MiniMax-M2.7 |
| 硅基流动 | OpenAI 兼容 | DeepSeek-V3 / Qwen2.5-72B |
| OpenAI | OpenAI 兼容 | gpt-4o-mini |
| **Anthropic Claude** | **原生协议 (中继自动转换)** | claude-sonnet-4-5 / claude-opus-4-1 |
| **自定义** | 任意 OpenAI 兼容网关 | models 留空 → 前端模型框自由输入 |

> Claude 走原生 Anthropic 协议，中继自动完成 system 抽取/消息交替合并/x-api-key 鉴权/usage 映射/SSE 合成，无需额外网关；自定义提供商改 keys.json 的 custom 块 (baseUrl + apiKey，可加 headers 字段)，models 留空则前端可自由输入模型名。新增/修改 keys.json 后无需重启 (每请求热加载)。

| 模式 | 方法 | 说明 |
|------|------|------|
| 快捷启停 | 双击 `启动.cmd` / `停止.cmd` | 等价 node server.js 后台运行 (默认 8788) |
| 单机 (人类/随机AI) | 双击 `index.html` 或任意静态服务器 | 零依赖 |
| 人机/AI对战 (LLM) | `node server.js` → http://localhost:8788 | 密钥在 `config/keys.json` 填好后重启 |

- 设置入口：棋盘左上角 ⚙。每方可独立配置 人类 / 随机AI / LLM（红黑可用不同服务商），LLM 可另选棋风。
- 全屏观战：顶部 ⛶ 按钮或 F 键（设置/输入框聚焦时不抢键；回放打开时 F 归回放全屏管）。
- 竞技场布局：左侧红方 / 右侧黑方思考流面板（LLM 流式输出 reasoning，侧边显示累计耗时/手数）；底部横幅带方色 + 棋谱行记录每手耗时 ⏱。窄屏自动变红上黑下横条。
- 存档：下方 💾 导出当前对局 JSON；📂 导入并重放。
- 批量对局：`node benchmark/cli.js 10 200`

## 测试

| 命令 | 覆盖 |
|------|------|
| `node test/run_tests.js` | 引擎 49 项 (perft 金标准 + 重复局面/长将追踪/moveTag 三态/长将判负/三次重复判和/送吃守卫/自然限着判和) |
| `node test/test_evaluation.js` | 阶段性知识模型 81 项 (阶段判断/动态子力/摘要/士象完整性/底线老兵/空头炮/窝心马/中炮矄中卒/开局任务提醒/出车提醒/将门控制/兵临九宫/沉底炮) |
| `node test/test_llm_convo.js` | LLM Agent 140 项 (提示词/重试/兑底安全阀/开局炮保护回归/必填校验/对拉与长将警示/重复局面警示/全角容错/信度归一/对手吃子标注/重试钩子/多轮缓存守护/HIST_CAP裁剪/亏子标注/危子预标/reasoning打捞/attempts/外部中止) |
| `node test/replay_smoke.js` | 回放系统 45 项 (数据层/控制层/倍速/循环/跳转/容错/杀标注/parseEval方向/导入落库/战绩汇总) |
| `node test/_clean_reason_check.js` | 思考流清洗 10 项 (垃圾压缩/记谱保留/复述删改) |
| `node test/cn_notation_check.js` | 中文记谱 25 项 (经典谱锚点/同列多兵前中后消歧/同列多车马边界/旧键哨兵) |
| `node test/check_ui.js` | 4 文件语法 + getElementById/HTML 交叉核查 |
| `node test/analyze_blunders.js <log.json>` | 瞎走检测 (送吃/免费吃/漏吃/拉锯/错失必杀, 静态交换评估) |
| `node test/smoke_relay.js` | 真实中继单发 (需 key) |
| `node test/smoke_ui.js [model]` | 无头 Edge 冒烟 13 项 (自动开局/决策日志/分页哨兵/截图) |
| `node test/match_headless.js <provider> <model> [n]` | 无头 LLM 对局 n 手 |

## 评价数据流

Board → Rules → PositionEvaluator → XiangqiKnowledge → 中文摘要 → LLM选着法

- LLM 负责: 战略判断 / 候选选择 / 风格决策；Engine 负责: 规则 / 数值评价 / 局面分析。
- 子力价值按阶段动态调整 (开局车990/马360 → 残局马500/炮383/相仕240/过河兵195)。
- 注入 LLM 的只有简短中文摘要 (阶段/评分/优势/风险/可吃子/合法数)，不发送复杂计算。

## 引擎 API 速览

```js
var e = XQ.Engine.create();
e.applyPlayerMove(fx, fy, tx, ty)   // 唯一写入口, 内置合法性校验
e.generateLegalMoves(color)          // 合法着法生成
e.legalTargets(x,y) / dangerTargets(x,y)
e.undoPly() / newGame() / serialize() / loadSerialized()
e.boardText() / legalMoveStrings(color)   // LLM prompt 辅助
e.repetitionCount()                  // 当前局面重复次数 (v1.7.7); 第3次出现自动判和 result='repetition' (v2.2, ruleEnforce 可关)
e.checkStreak(color)                 // 某方最近连续将军手数, 4+=长将风险 (v1.7.8); 6 连将判负 perpetual (v2.0)
e.naturalClock()                  // 当前连续无吃子半回合数 (v3.8); 达 naturalCap (默认120=60回合) 自动判和 result='natural'

// 搜索算法直接用底层:
var b = e.cloneBoard();                       // 廉价拷贝
XQ.Generator.perft(b, 'red', depth);          // 已验证 44/1920/79666
b.applyMove(m); b.undoMove(m);                // 可逆模拟
XQ.Judge.status(b, colorToMove);
XQ.Judge.moveTag(b, opColor[, movesPre]);     // v1.7.9 一步效果: 杀/困/将/null (movesPre 可免二次生成)
```

Move 对象: `{ from:{x,y}, to:{x,y}, piece:{color,type,id}, captured }`

## 正确性保证

`node test/run_tests.js` — 49 项断言全绿，包括象棋界公认 perft 数字：
**开局 perft(1)=44 · perft(2)=1920 · perft(3)=79666**，以及随机千手对局零非法、绝杀/困毙/飞将边界用例。

## 常见问题 (排障)

- **接口 401 / “未配置 apiKey”**：`config/keys.json` 对应服务商填 `apiKey` 即可（该文件每请求重读，无需重启）；模型名不存在/余额不足会立即失败不烧重试。
- **REASONING_REQUIRED / UNKNOWN_FIELD**：glm 系上游强制思考，agent 会自动摘除 thinking 字段重试；勾选“快答模式”时非 GLM 上游才真正关闭思考。
- **503/504、一手 70~300s**：provider 侧排队波，agent 已设 120s 超时+重试+降温；tokenrhythm 偶发 DNS 故障 (ENOTFOUND)，稍后重试即可。
- **热更新范围**：ai/ ui/ replay/ index.html 改动浏览器 F5 即生效；keys.json 每请求重读；**只有改 server.js 才需要重启**（`停止.cmd` → `启动.cmd`）。
- **无头对局报 MATCH INCOMPLETE**：这是“手数未满或 meta 率 <100%”的预期退出码（兑底着法无 meta），非崩溃；看 logs/blunders_*.txt 瞎走报告定位。
- **落子一直转圈**：先看浏览器控制台与 server.log 中 `[LLM 红/黑] attempt N 失败重试` 的原因行（v1.5.7 诊断日志），再对照上表。

## 安全模型

API Key 仅存在于服务端 `config/keys.json`（请勿提交到仓库）。前端通过同源 `/api/chat` 中继调用，请求体只含 `{provider, model, messages}`，密钥永不出服务器。Token 用量由中继透传的 `usage` 字段记录进棋谱。
