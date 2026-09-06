# LLM-chess 优化日志

## 导读

> 本文件记录每一轮优化 (人工指令轮 + 自动优化代理轮), 供后续轮次防重复与溯源。
> 约定: 新轮次追加在文件末尾, 格式 "## YYYY-MM-DD HH:mm 第N轮"; 每项一行 = 文件 + 一句话说明。
> 标注「用户指令/勿回退」的条目是显式决策, 严禁改回。想了解项目先看 README.md。

# LLM-chess 自动优化日志

> 自动优化代理 (cron: llmchess-auto-optimize, 每30分钟) 追加记录。每轮格式: `## 日期 时间 第N轮` + 每项一行。
> 规则: 读过本文件的轮次严禁重复已列优化; 宁少勿滥。

## 2026-08-29 (人工会话已完成, 勿重复)

- v1.5.9 接口错误修复: max_tokens 4096 / timeout 120s / fail-fast / retryBlock 归因
- v1.5.10abc 思考流清洗 cleanReason: token 级扫描 + 小数保护 + 复述短语定向删 + 问号串压缩
- v1.5.11abcdef 提示词系列: 11 项优化 + 压缩 1862 字 + 符号清扫 + 子力价值/开局顺序/开局炮保护(代码级拦截 ply<16)
- v1.6 Replay 系统: replay.js + replay_controller.js + overlay UI (不调 LLM 重放棋谱)
- v1.6.1 七项: 评估条/走法列表/倍速 7 档/循环/边界禁用/续看进度/滚轮步进
- v1.6.2 六项: ETA/侧色标签/跳转+5+10/下着预览/键盘 Home-End-0-1-7/分边统计
- v1.6.3 十项: -5-10 后退/子力统计/时长柱状图/键盘帮助/进度百分比/最长思考跳转/下一局/PGN 导出/走法过滤/自动播放
- v1.7 HUD 十项: 被吃托盘/大字徽章/中文记谱/评值 sparkline/60s 提醒/将军横幅+脉冲/终局结算卡/棋谱侧色/状态条手数/面板折叠
- v1.7.1~7.4: 自动滚底/黑横幅 87CEEB→回退/信息卡片化/快答模式(thinking disabled)/模型信息卡/横幅去重(上方模型+方别, 下方全局时间)
- v2 赛博主题: 黑曜石×暗金全量换肤 (级联覆盖层), 金属外框/HUD 分段横幅/状态色系统/文字三级层级
- 测试基线: test_llm_convo 70/70 · replay_smoke 31/31 · check_ui 语法 4/4 · _clean_reason_check 10/10
- 坐标核查: a-i 底部左→右 / 10-1 左侧上→下, 与 parseSq/boardText 一致 (勿"修复")

## 2026-08-29 22:40 主会话实测轮 (match_test1: glm 自战 16 手)

- test/analyze_blunders.js 新增: 瞎走检测器 (送吃/免费吃/漏吃/拉锯, 静态交换评估; 修 VAL 表 knight/horse 类型错位)
- 实证发现: 黑方落后时转入英文讲解模式 ("Let me analyze...") 连烧 3 次重试 → 文本兑底随机走 → #12 送马 #14/#16 送兵 (一手 280~318s); 红方 0 瞎走 (开局顺序/吃子三问生效)
- v1.7.5 提示词: 第一句硬约束 (只输出一行 JSON, 首字符必须 {) / 落后禁止转入讲解模式 / 兵卒迎面对头规则 / retryBlock 首字符规则
- v1.7.5 代码: 兑底安全阀 greedySafe (贪心 1 层: 吃子价值 - 被吃风险), attempt3 文本兑底若白丢大子 → 换贪心安全走法
- system 1862 → 1955 字

## 2026-08-29 23:00 主会话实测验证轮 (match test2: glm 自战 16 手, 基线对照 test1)

- test/analyze_blunders.js 用于 A/B: 基线 test1 = 4 处瞎走/16手 (送马1+送兵3); 验证局 test2 = 1 处/16手 (旧阀门代码所限)
- 新局实证: 首字符约束后英文思考仍偶发 (模型固有), 但重试+兑底安全阀兜住; #16 安全阀实战首杀 (g8-g1 白丢炮→换 b8-b5)
- v1.7.5b 阀门修复: 旧版要求兑底必须吃子才检查 (非吃子跳火坑绕过) → 重写为评分对比式 (文本兑底评分 vs 贪心最优, 差>1.5 替换), 独立复现 f7-g5 场景 ✓
- 已知遗留: 黑方英文/跑题思考烧重试 (延迟 90~380s/手) — 提示词已尽力, 根治需换模型或关闭思考; tokenrhythm 503/504 频发 (上游不稳)
- cron 已恢复 enabled (22:30 起正常轮值)

## 2026-08-29 23:40 自动优化第1轮 (cron llmchess-auto-optimize)

- README.md v1.5 到 v2.1 全量更新: 目录结构补 replay//OPTIMIZATION_LOG/启动停止cmd, 测试表改 70/31/10/check_ui/analyze_blunders, 新增 v1.6 回放/v1.7 HUD/v2 主题/自动优化代理说明
- ui/app.js rpExportPGN 修复: 原黑方手前插 '*' (PGN 终局标记) 会被解析器当对局结束截断, 改标准 "1. 红手 黑手 2. ..." 格式, 末尾追加 1-0/0-1/* 结果标记
- ui/app.js rpParseEval 兜底增强: 纯文字评价 (红大优=+3/黑优=-1.5/和势=0) + 无符号数按文案定号 ("1.5 黑优"取负) — 修复已知小坑 "大优无数字时评估条误显均势"
- ui/app.js 回放棋盘补行列坐标标签: a-i/10-1 与主棋盘同口径 (rp-col-labels/rp-row-labels, 容器 padding 26/22 容纳)
- ui/app.js 回放倍速记忆: localStorage xq_replay:speed, 重开回放自动恢复上次倍速 (SPEEDS 校验)
- ui/app.js 评值走势曲线 #rp-evalchart: 全局 evaluation SVG 连线 (红方视角 clamp 3, 金点=当前手, 圆点点击跳转), 补齐时长柱状图之外的走势视图
- ai/llm_agent.js 重试降温: attempt>=2 时 temperature 收敛到 0.1 (chat 加 tempOverride 参数, 首手不变) — 格式重试要确定性, 同温重试常复制同一错误
- test/replay_smoke.js 内容解耦修复: 6 项硬编码断言 (6手/#6 e8/#3 e3-e7/+10 clamp 6) 改为从加载棋谱派生 — 根因: logs/match_headless.json 23:20 被 16 手验证局覆盖, 与本轮改动无关的既有测试 bug (断言数 31 不变)
- 测试: test_llm_convo 70/70 - replay_smoke 31/31 - check_ui 语法4/4+ID核查 - _clean_reason_check 10/10 全过; server.js 未动

## 2026-08-30 01:30 自动优化第2轮 (cron llmchess-auto-optimize)

- core/engine.js 重复局面检测: posCounts 按 盘面文本+执子方 计数, applyPlayerMove/undoPly/newGame 同步增减清退, 新增 engine.repetitionCount() API — 三次重复判和/长将检测的基础设施 (不改终局判定, 纯增量)
- test/run_tests.js 修复 D1 潜伏 bug: 原第2行末尾多余 '+' 把两行棋盘合成 NaN 垃圾行, 盘面只有9行且炮/帅各上移一行 (靠士恰为炮架碰巧通过); 补 E7/E8 重复局面计数测试 (马进退一回合/两回合 + undo 回退 + newGame 清零), 29→31 项
- ai/llm_agent.js 对拉代码级警示: 自己最近两手同子来回 (A-B-A) 时, 下一手 user 消息注入 "严禁再走回去, 必须换目标" 点名警告 (提示词防拉锯节的局面级强化, 仅 user 消息, system 长度不变)
- ui/app.js 重复局面 HUD 告警: afterMove 检查 repetitionCount, 2次提示变招/3次提示可判和 (warnBanner, repWarnedN 只升不降, restart 清零) — 模型拉锯时观战者即时可见
- ui/app.js 回放全屏模式: header 新增 ⛶ 按钮 + F 快捷键 + fullscreenchange 同步按钮态; Esc 语义修正 (全屏时第一次 Esc 退全屏, 第二次才退回放)
- index.html 补 favicon (SVG data URI, 消除每请求 /favicon.ico 404) + meta description (SEO/分享卡片)
- test/match_headless.js 对局结束自动跑瞎走检测 (execSync analyze_blunders, 失败静默跳过) — 无头对局直接出送吃/漏吃/拉锯报告, 不再手动补跑
- test/test_llm_convo.js 补 3 条对拉警示断言 (场景预置红黑双马来回/第5手带警告/第3手无警告零噪音), 70→73 项
- 测试: test_llm_convo 73/73 - replay_smoke 31/31 - check_ui 语法17文件+ID核查 - _clean_reason_check 10/10 - run_tests 31/31 全过; server.js 未动 (浏览器端改动 F5 生效, engine.js 走 <script> 同样免重启)

## 2026-08-30 ~04:30 回补: 未登记轮 (第3轮前置, 从代码注释/测试恢复 — 当轮崩溃于日志前, 防后续轮重复)

- engine.js v1.7.8 长将追踪: checkStreaksFrom 纯函数重放统计 + engine.checkStreak(color) API + undoPly 重算; llm_agent 连续将军 3 手以上 user 注入长将警告; test E9/E10 + llm_convo 2 断言 (73→75)
- judge.js v1.7.9 moveTag: 一步效果统一判定 (杀=将军无解/困=困毙/将); llm_agent legalAnnotated 合法列表升级 [b3>e3吃卒杀] 式标注 + 有杀/困时 mateHint 点名; 兑底安全阀可杀就杀 (mate/stalemate +1000); replay moveRisk 顺路算 marks, 走法列表/信息面板彩色标注 杀/困/将; analyze_blunders 新增错失必杀检测; replay_smoke 31→36, run_tests 33→37
- 教训: 该轮代码/README/测试全落地但 OPTIMIZATION_LOG 未写 (疑似先改后记被中断) — 此后轮次先记日志再跑长测试

## 2026-08-30 05:50 自动优化第3轮 (cron llmchess-auto-optimize)

- core/engine.js 规则闭环 — 长将判负: 一方连续将军 6 半回合 (3 回合) 仍不变招 → 自动终局 result='perpetual', 长将方判负 (优先级低于将杀/困毙); Engine.create({startBoard,turn,ruleEnforce:false}) 新增可测性参数, 默认规则开; 直接针对 LLM 实战高频的连将拉周 (此前只有 HUD 警告无强制力)
- ui/renderer.js 终局卡补 'perpetual' 原因文案 (长将判负 · 一方连续将军不变招); benchmark/record.js result 注释同步 — 静态文件 F5 生效
- test/run_tests.js E11~E13: moveTag 三态构造局 (双车闷杀=杀/单将可解=将/双车封宫+黑士自堵=困) + 长将判负闭环 (红车跟将 6 连将第 6 手自动终局, 长将方判负) + ruleEnforce:false 同局面不判负 (分析器不重判); 37→40 项; 副产出: Engine.create 支持自定义起始盘面 (规则测试基建)
- test/analyze_blunders.js 引擎改 ruleEnforce:false — 分析器不重判旧棋谱 (旧谱可能含 6 连将, 规则闭环会提前终局干扰重放/误报非法)
- ui/app.js 兑底透明化: afterMove 识别无 summary 且无 confidence 的兑底着法 → 决策卡摘要改 '兑底·安全着法' + 💭 前缀说明 + 大字徽章附 ⚠兑底 — 观战者可分辨模型自信决策与系统兜底
- test/check_ui.js 动态 ID 白名单 (replay-bar/rp-help-overlay 运行时创建) — 消除已知误报, 防后续轮误诊; index.html 缺 ID 报告不变严格
- README.md v2.0 规则闭环说明 + 测试表数字校正 (run_tests 40 / replay_smoke 36)
- 测试: run_tests 40/40 - test_llm_convo 79/79 - replay_smoke 36/36 ALL PASS - check_ui 语法 4 文件+ID核查 (missing none) - _clean_reason_check 10/10 全过; server.js 未动 (全部 F5/免重启生效)

## 2026-08-30 07:25 自动优化第4轮 (cron llmchess-auto-optimize)

- ai/llm_agent.js 全角容错解析 (v1.8a): 新增 toHalf() 全角→半角归一化, JSON 原样解析失败或坐标字段为全角 (如 "ｈ８") 时用归一化文本二次解析; 兑底坐标扫描也改用归一化文本 (全角坐标/引号/冒号/逗号/破折号一并命中) — 中文模型偶发全角输出原本会烧 3 次重试后兑底丢 meta, 现在一次成功
- ai/llm_agent.js confidence 百分制归一 (v1.8b): 模型输出 confidence 78/95 这类百分制 (或 "95%") 时原样 clamp 到 1.0 误导观感, 现 2..100 区间自动 /100 (78→0.78); 0..1.5 区间不变
- ai/llm_agent.js systemPrompt 特殊符号彻底清零: 残留的 "≤8字策略/≤14字" 改 "8字以内/14字以内" (全 prompt 扫描 ①②③≥≤~→⚠️ 均无残留), 缺必填字段的错误提示同步去 ≤/~ (该提示经 retryBlock 回传 user, 模型可能复述); 首手 system 1955→1957 字
- test/test_llm_convo.js 守卫断言 +7 (79→86): system 长度 ≤2000 字自动守护 + 特殊符号黑名单扫描 (防后续轮提示词改动引入乱码源) + 全角坐标一次解析 + 全角结构字符救回 + 百分制归一 3 断言
- evaluation/position.js 士象完整性 (v1.8): guardCount 双方仕相计数 + 评分项 (差×0.08) + 摘要点名 (己方士象不全→补防慎兑 / 对方士象不全→伺机攻九宫; 满 4 不点名零噪音) — 残局攻防知识注入引擎评价层, 不动 systemPrompt
- index.html 加 meta color-scheme=dark: 深色主题加载期免白闪
- README.md 测试表数字同步: run_tests 37→40 / test_llm_convo 79→86 / replay_smoke 33→36 / test_evaluation 40→43 (第3轮校正漏了目录结构行)
- 测试: test_llm_convo 86/86 - test_evaluation 43/43 - replay_smoke 36/36 ALL PASS - run_tests 40/40 - check_ui 语法 17 文件+ID核查 (missing none) - _clean_reason_check 10/10 全过; prompts_dump 已重生成 (system 1957 字); server.js 未动 (全部 F5/免重启生效)

## 2026-08-30 09:55 用户指令调整 (非自动轮, 勿回退)

- ai/llm_agent.js 开局炮吃马硬保护阈值放宽 (v1.5.11f 阈值用户指定收紧范围): 代码拦截 ply<16 (前16手/8回合) → ply<4 (前4手/2回合); 提示词同步 前8回合 → 前2回合; README v2.1 质量守护段同步
- 理由: 用户判断 8 回合禁炮吃马过严, 限制开局出子选择; 例外保留 (吃子直接将军放行), 吃子三问/落子自检软约束不变
- ⚠ 后续轮勿把此阈值当 bug 改回 16 手 — 用户显式决策; 若认为开局炮保护不足, 只可加软规则, 不动代码阈值
- 测试: node --check 通过 - test_llm_convo 89/89 通过 (含 system 长度/符号黑名单守卫)
- 事件: 09:13 验证局 test3 于第10手因 tokenrhythm 中继 DNS 故障中止 (ENOTFOUND tokenrhythm.studio, 无残谱), 09:52 DNS 恢复后重跑 (16手, 首次携带新阈值)

## 2026-08-30 10:28 自动优化第5轮 (cron llmchess-auto-optimize)

- ai/llm_agent.js 开局炮保护失效修复 (v2.3, 真 bug): 拦截条件写死 'horse'/'elephant', 引擎类型实为 knight/bishop → 炮吃马/象永不拦截 (仅剩吃士生效), v1.5.11f 的核心保护实为空转; 修为 knight/advisor/bishop, 拦截文案 前8回合→前2回合 同步 09:55 用户定稿口径; 与 app.js v1.7.6 cnNotation 同源教训 (引擎类型名 knight/bishop), 补回归测试直接验拦截行为
- evaluation/position.js 评价管线去重复计算 (性能): 一次 evaluate 内 snapshot 6→1 次、generateLegalMoves 4→2 次 (mobility/captureTargets/合法数复用预生成列表), 输出零变化 (stub/真实引擎双路验证)
- evaluation/xiangqi_knowledge.js + position.js 底线兵"老兵"知识: 兵/卒到底线子力 ×0.7 (只剩横移, 攻击力大减) + 摘要点名 "己方底线兵已成老兵, 勿再拱, 换其他子助攻" (有底线兵才点名, 零噪音); 直击模型爱把兵拱到底线的偏好 (提示词还鼓励"直捣九宫", 评价层纠偏)
- ui/app.js + index.html 主界面全屏观战: btn-row 新增 ⛶ 按钮 + F 快捷键 + documentElement requestFullscreen/exitFullscreen; 回放打开时 F 仍由回放分支接管 (不冲突), Esc 浏览器原生退全屏
- README.md 同步: 测试表 89→92/43→47/37→42 (正确性保证段滞后三轮) + tree 行 + v2.3 小改 bullet + 新增「常见问题 (排障)」小节 (401 未配 key/REASONING_REQUIRED/503 排队波/热更新范围只有 server.js 需重启/MATCH INCOMPLETE 语义/诊断日志用法) + 全屏观战用法
- 测试: test_llm_convo 89→92 - test_evaluation 43→47 - run_tests 42/42 - replay_smoke 36/36 - _clean_reason 10/10 - check_ui 18 文件语法+ID 核查 (missing none, 含新 btn-fullscreen) - cn_notation 13/13 全绿; prompts_dump 未变 (systemPrompt 未动); server.js 未动
- 教训: (1) position.js 改参数签名时漏改一处 push 行的 moves[i] → ReferenceError, 测试秒抓 — 改函数签名要全文搜旧变量名; (2) PowerShell 管道下多命令批量跑测试时 "exit 1" 可能是管道伪报, 用 *> $null 后读 $LASTEXITCODE 才准 (与 08-29 教训同源)

## 2026-08-30 11:45 自动优化第6轮 (cron llmchess-auto-optimize)

- evaluation/position.js 空头炮知识 (v2.4): 对方炮与己将同列且中间零隔子 (零屏) → 摘要风险点名 "对方空头炮直指你方将帅, 勿随手垫子" (垫子即成炮架送将), 己方视角则报优势 "空头炮压住对方九宫"; 有隔子不误报, 初始局不提 (零噪音); 直击实战炮镇中路模型看不见的盲区 (评价层注入, 不动 systemPrompt)
- ai/llm_agent.js 对手上一手吃子点名声 (v2.4): incUserMsg oppBlock 追加 "吃掉你的X" (X=被吃子记谱字符) — 模型不必逐格对比棋盘找哪些子消失了 (实战漏看被吃子是决策失误源); 无吃零噪音; 仅 user 消息, system 长度不变 (1957字)
- evaluation/position.js cloneBoard 去重 (性能, v2.4): palaceAttacks×2 + threatened×2 此前各 cloneBoard 一次 (4次/评价), 现一次克隆 bView 四项共享 (threatened 同时复用 evaluate 已有 snapshot 免重复快照), 输出零变化 (51 项测试全过)
- ui/app.js 终局卡 "🎬 回放本局" 按钮 (v2.4): eo-stats 末尾动态按钮 → rpWatchRecord() (rpEnsure+rpStart(currentRecord) 直达), 打完一局直接看录像, 免去回放选择器翻找; XQApp.replayWatchRecord 调试句柄; 对局→录像体验闭环
- ui/app.js 回放层 📂 导入本地 JSON (v2.4): 回放覆盖层选择器旁新增导入按钮, Record.importFromFile 载入后插入 picker 顶部选项并直接回放 — 与主界面 保存棋谱 导出格式一致; 主界面 📂 载入棋谱只静默重放无控制, 回放层导入给完整回放体验 (倍速/跳转/信息面板); 重复导入同选项去重, 解析失败报错到 info 面板
- ui/app.js 回放循环播放状态记忆 (v2.4): xq_replay:loop 存取, rpStart 恢复上次循环开关 (与倍速记忆同欥 localStorage), 重开回放不再重置循环
- README.md 同步: 测试表 92→98/47→51 + tree 行 + v2.4 bullet (空头炮/吃子点名声/cloneBoard 去重/终局回放本局/回放导入/循环记忆)
- 测试: test_llm_convo 92→98 - test_evaluation 47→51 - run_tests 42/42 - replay_smoke 36/36 - _clean_reason 10/10 - check_ui 0 missing 全绿; prompts_dump 未变 (systemPrompt 未动, system 仍 1957 字); server.js 未动 (全部 F5/免重启生效)
- 教训: 测试构造吃子场景两次踩坑 — (1) 象棋兵卒只在 a/c/e/g/i 列, b7 无黑卒 (炮吃马场景炮架不存在); (2) h1/h9 是马不是车 (红车在 a1/i1) — 构造棋局场景先核对初始布局, 用 applyPlayerMove 逐手验证再用

## 2026-08-30 12:45 手动优化轮 (用户指令: cron 已关, 转人工)

- ai/llm_agent.js onRetry 钩子 (v2.5): create opts 新增 onRetry(attempt/reason), 重试分支实时回调 (兑底/外层失败不触发) — 观战端不再对着 70~300s 黑箱猜
- ui/app.js 状态条重试可见 (v2.5): bannerThinking 每手归零 + onRetry 累计 + tick 文本追加 '重试N次' (aiRetries[side] 分区, 与 v1.7.3 im-stat 同款思路)
- evaluation/position.js 窝心马知识 (v2.5): 马入九宫中心 (红e2=y8/黑e9=y1) 评分 ±0.15 + 摘要点名 (己方'自堵九宫宜跳出' / 对方'受困可围攻'); 初始局零噪音; 直击今日两局黑方两次跳 e9 窝心的习惯
- test/match_headless.js 残局保谱 (v2.5): 收尾封装 finish(incomplete) — LLM 失败/自校验失效不再 process.exit 丢整局, 残谱落盘 + 瞎走检测照跑 + INCOMPLETE 退出码不变; 实测故障路径 (badprovider) 残谱 0 手落盘 ✓ / 正常路径 2 手 MATCH OK ✓
- test/replay_smoke.js 短谱保护 (v2.5): json <8 手自动合成 12 手确定性测试谱 (序列逐手验证合法, b1-c3...e7-e6 含吃子交换); 残谱不再弄挂守卫套件 (此前 2 手谱第 53 行 moves[2] 硬崩)
- 测试: test_llm_convo 98→101 - test_evaluation 51→55 - run_tests 42/42 - replay_smoke 36/36 (短谱合成路径实测) - _clean_reason 10/10 - check_ui 全过; prompts_dump 未变; server.js 未动
- 遗留风险: onRetry 仅覆盖重试分支, 3 次全败后的外层失败 (MATCH 层) 无回调 (观战端已有 warnBanner 15s 兜底); 窝心马评分阈值 0.15 若实战误报偏高可降至 0.1

## 2026-08-30 12:52 手动补丁 (用户指令: 口径澄清 + 中炮矄中卒提醒)

- ai/llm_agent.js 提示词语义澄清: 原「开局严禁用炮吃马/士/象」+「勿用炮轻易前压」连读可能被模型理解成'开局少动炮' — 改为「仅禁炮吃马/士/象这类换子, 炮的调动不限, 架中炮属正常出子」; 代码硬拦语义同步核实: ply<4 只拦吃子 (knight/advisor/bishop 目标), 非吃子调动从不拦
- ai/llm_agent.js 提示词新增: 架中炮后勿轻打中卒 (打卒落点常被马反吃, 白亏) — 直击老盲点 '炮打中卒 e3-e7' (两轮实战复现, 今日实盘再现场景)
- evaluation/position.js centralAim 检测 (v2.5b): 己方炮与对方中兵同列 (x=4) 且中间恰一隔子 → 攻方摘要 '你方中炮矄住对方中兵, 但勿轻打' / 守方摘要 '中兵被矄, 可跃马护卒或兑卒解脱'; 初始局/无隔子零噪音; 仅提醒不评分 (不动引擎打分避免扰动既有基线)
- 测试: test_evaluation 55→59 - test_llm_convo 101/101 (system 1957→1985 字, ≤2000 守护过) - run_tests 42/42 - replay_smoke 36/36 - _clean_reason 10/10 - check_ui 全过; prompts_dump 已重生成 (system 1985 字); server.js 未动

## 2026-08-30 13:05 手动优化轮 v2.6 (用户指令: 底层机制 + LLM 缓存命中率)

- ai/llm_agent.js system 恒定 (v2.6): 开局三节不再第5手动态裁剪 — 裁剪每局制造一次全前缀失效; 节标题自带 '前3-4手适用, 中残局忽略本节' 自限标记; system 2014 字全程逐字恒定 (测试断言第6手与第1手逐字相同)
- ai/llm_agent.js user 静态任务头 (v2.6): USER_HEAD ('## 任务: 给出当前局面你的最佳着法...') 前置, firstUserMsg/incUserMsg 共用 — system+任务头构成跨手恒定前缀; 原尾部静态收尾行上移, 动态内容全部后置
- ai/llm_agent.js 重试块绝对居末 (v2.6): retryBlock 后无任何静态文本 → 重试请求前缀与首次失败请求完全一致 → 复用已缓存前缀 (重试本就是最贵的请求)
- ai/llm_agent.js 缓存命中观测 (v2.6): countUsage 三口径兼容 (prompt_cache_hit_tokens / prompt_tokens_details.cached_tokens / cache_read_input_tokens) → usage.cacheHit; match_headless 统计行 '缓存命中: 红 X tok (Y%) / 黑 ...' (2手真跑验证输出正常, tokenrhythm 中继未上报时显示 0)
- 守护同步 (v2.6): system 上限 2000→2400 字 (开局三节全程保留的代价, 缓存命中后实际成本反降); 裁剪断言改逐字恒定断言; 已禁用 cron 的提示词规则同步 (≤2400 + 缓存设计勿回退)
- 测试: test_llm_convo 101→107 - test_evaluation 59/59 (锚点随改版更新) - run_tests 42/42 - replay_smoke 36/36 - _clean_reason 10/10 - check_ui 全过; prompts_dump 已重生成 (system 2014 字); 2 手真跑 MATCH OK; server.js 未动
- 遗留风险: 缓存命中收益依赖 provider 支持与中继路由稳定 (tokenrhythm 未上报缓存字段, 实际命中率需在对局侧观测延迟/账单); system +210 字的未命中首读成本一次/局

## 2026-08-30 13:20 手动优化轮 v2.7 (用户指令: 优化第一次请求和后续请求方式)

- ai/llm_agent.js 多轮对话结构 (v2.7): 历史以 (user 原样请求, assistant 原样 JSON 回复) 对追加 — 请求 N+1 的前缀 ⊇ 请求 N 全体, 首请求建缓存、后续只追加增量 (前缀缓存理论最优形态); convo entry 新增 userMsg/answer 字段存档原文字节
- ai/llm_agent.js 增量瘦身: 增量 user 不再重复任务头 (多轮上下文常驻, 每手省 ~57 字); 重试块追加于末尾 (失败请求全体复用); HIST_CAP=10 对超限从头裁 (16 手局每方 8 对不触顶)
- test/test_llm_convo.js: 新增 userOf() 助手, 31 处 messages[1] 断言迁移至末条消息语义; v2.6 缓存块重写为 v2.7 多轮断言 (前缀包含性/历史对/原样 JSON/任务头不重复/重试复用/cacheHit); 101→107→110
- test/dump_prompts.js: 增量段改取末条消息 + 历史对数 + 多轮结构说明 + 重试块样例同步 v2.7 文案
- 实测: 4 手真跑 MATCH OK — 缓存命中 红 2112 tok (42%) / 黑 2048 tok (41%) (tokenrhythm 上游真实上报), meta 4/4 零重试; 全套 test_evaluation 59 / llm_convo 110 / run_tests 42 / replay_smoke 36 / clean_reason 10 / check_ui 全过; prompts_dump 已重生成; server.js 未动
- 遗留风险: 长局 (每方 >10 手) 触发 HIST_CAP 裁剪 → 缓存重建点; token 增长随历史线性 (缓存命中后成本可控, 未上报缓存的 provider 下长局成本上升)

## 2026-08-30 13:50 手动补丁 v2.8 (用户指令: 继续优化提示词)

- ai/llm_agent.js systemPrompt 三处精修 (v2.8):
  - 新增多轮须知节: 历史里的棋盘/评价均为旧局面, 只依最后一条 user 的棋盘与合法列表决策; 历史中自己的 JSON 保持风格一致 — 护住 v2.7 多轮架构的认知一致性 (防模型拿旧盘面当现状)
  - 系统末尾追加首字符复强调: 回复第一个字符必须是 {, 禁英文与讲解, 禁围栏 — 利用末位近因效应打击今日实战最高频失败模式 (英文讲解开头烧重试)
  - 落子自检补窝心马禁入: 马勿入九宫中心 — 与评价层 v2.5 窝心马惩罚双重保险 (今日两局黑方两次跳 e9)
- 测试: system 2014→2161 字 (≤2400 守护过) - test_llm_convo 110/110 - test_evaluation 59 - run_tests 42 - replay_smoke 36 - clean_reason 10 - check_ui 全过 EXIT 0; prompts_dump 已重生成; server.js 未动
- 遗留风险: 英文讲解模式为模型固有倾向, 提示词只能压制不能根除 (重试+兑底+安全阀三层兜底仍在); 多轮须知对旧局面混淆的实效待对局观察

## 2026-08-30 14:10 手动优化轮 v2.9 (用户指令: 自己测试至少优化10点)

- 实测驱动: 16 手完整真跑 (grand-fjord) 边跑边改 — 缓存命中 62%/72% (v2.6+v2.7 叠加验证), 瞎走 0, meta 16/16, 守卫三连救车 (双方车均试图进 b 线被借架吃)
- ai/llm_agent.js evalMove2 提升 create 层 (engine 改参, 兑底阀经 evalMove2Next 包装调用) — legalAnnotated 可复用
- ai/llm_agent.js 合法列表亏子标注 (v2.9): 静态交换净亏 (<-1.5 分) 的吃子追加 '亏' 标 — 直击实战黑马吃兵被象反吃盲区, 模型看列表即避坑
- ai/llm_agent.js reasoning_content JSON 打捞 (v2.9): 内容层散文/为空时从思考层捞 JSON, 免烧重试 (实测打捞命中零重试)
- ai/llm_agent.js 重试线性退避 (v2.9): 429/503 等待 3s×attempt (3s→6s→9s), 替代固定 5s
- ai/llm_agent.js HIST_CAP 裁剪可见化 (v2.9): 超限从头裁时 console.warn 提示缓存重建
- ai/llm_agent.js usage.blocked 拦截计数 (v2.9): 开局保护/送吃守卫触发次数入 usage, 可观测化
- ai/llm_agent.js retryBlock 强化 (v2.9): 勿解释勿复述本警告 + 被拒着法不可再选 — 针对守卫拦截后英文讲解循环 (今日 #06 实景)
- ui/app.js 缓存命中率上卡 (v2.9): 模型信息卡/思考实时跳动两处追加 '缓存Y%' (provider 上报才显示)
- test/match_headless.js 系统拦截统计行 (v2.9): '系统拦截: 红 X 次 / 黑 Y 次' — 守卫贡献可量化 (本局实证拦下 3 次送车)
- 守卫正确性实证 (v2.9): 车 a10-b10/a1-b1 拦截为真阳性 — b8 黑炮原位当架, 借架吃车与历史'炮b3借架吃马'同源模式; 排除假阳性疑虑
- 测试: test_llm_convo 110→113 (+亏标注/reasoning打捞/零重试) - test_evaluation 59 - run_tests 42 - replay_smoke 36 - clean_reason 10 - check_ui 全过 EXIT 0; prompts_dump 未变 (system 未动); server.js 未动

## 2026-08-30 15:20 手动优化轮 v3.2 (用户指令: 继续测试至少20点)

- 实测: 16 手观察局 (v3.1 首秀) — 缓存命中 76%/84% (v2.6+v2.7+v2.9 叠加新高), 瞎走 0 (含新窝心马检测 0), meta 16/16, 系统拦截 1 次 (真阳性), HTTP 504 被线性退避接住
- ai/llm_agent.js retryBlock 提示触发面扩大 (v3.2): 守卫/保护拒绝也追加中文提示 — 今日两次实测守卫拦截后模型转英文讲解循环
- ai/llm_agent.js 历史 assistant 原文剥围栏 (v3.2): convo.answer 存储 时剥 ``` 围栏 — 防模型从历史模仿围栏输出引发解析失败
- ai/llm_agent.js HIST_CAP 可配置 (v3.2): opts.historyCap (默认 10 对)
- ai/llm_agent.js 裁剪后重注入任务头 (v3.2): u1 被 HIST_CAP 裁掉后当前 user 重补 USER_HEAD (任务约束不因裁剪丢失)
- evaluation/position.js 开局任务提醒 (v3.2): ownCannonCentered/homeKnights 检测 — 初始局提醒架中炮/上正马 (仅 opening 阶段, 中残局零噪音; 上正马提醒含'已上一匹还差一匹'状态)
- test/analyze_blunders.js 窝心马分类 (v3.2): 马入九宫中心入 issue + 总计行; 16 手观察局实测 0 (与提示词/评价层双重防护一致)
- test/match_headless.js 每手 prompt 增量观测 (v3.2): '#NN ... | in X tok' — 多轮历史增长可视化
- ui/app.js 拦截次数上卡 (v3.2): 模型信息卡/思考跳动追加 '拦截X' (与 usage.blocked 联动)
- test/test_evaluation.js +3: 初始局任务提醒×2 + 中炮已架零噪音 (ply 6 口径, 20 已出开局期)
- test/test_llm_convo.js +3: 亏标注零噪音 (仅净亏标亏) + HIST_CAP 裁剪两断言 (第11手 2+2*10 / 触顶封顶 22)
- 回归: test_evaluation 62 - test_llm_convo 116 - run_tests 42 - replay_smoke 36 - clean_reason 10 - check_ui 全过 EXIT 0; prompts_dump 已重生成 (system 2211 字); server.js 未动

## 2026-08-30 15:55 手动优化轮 v3.3 (用户指令: 继续测试至少20点)

- 实测驱动: 16 手观察局 (v3.2 栈首秀) — 缓存命中 67%/84%, 瞎走 0, 拦截 3 次全真阳性 (h1-h8/a10-b10/a9-h9 三次救车), 窝心马检测首战抓到真案例 (#14 黑马 g8-e9 入宫心)
- ai/llm_agent.js 合法列表危子预标 (v3.3): 非吃子送吃着法 (guardHanging 同源逻辑) 预标 '危' — 模型提前避开 → 少烧守卫重试 (今日实测同车两次被拦, 每次多烧一手等待)
- ai/llm_agent.js system 合法性节加标注图例 (v3.3): 吃X/亏/危/将/杀/困 含义 — 此前标签无解释全靠模型自悟
- ai/llm_agent.js retryBlock 任务核对话引导 (v3.3): 任务核对写进 plan 字段, 正文只给 JSON (实测模型两次在正文写任务清单导致解析失败)
- evaluation/position.js 出车任务提醒 (v3.3): homeRooks 检测 + opening 阶段 '出车占肋道/卒林线' 摘要 — 与提示词出车鼓励同源
- test/analyze_blunders.js 总计统计修复 (v3.3 真 bug): 送吃大子/亏换大子/送兵 三类 issue 此前未被计入总计行 (type 精确匹配漏掉子类型) — 改前缀匹配, 历史报告均低报
- test/match_headless.js 每手 prompt 增量观测 (v3.2 补充落地实测): '#NN | in X tok' 随历史增长可视化 (2285→12632 tok)
- ui/app.js 拦截次数上卡 (v3.3): 模型信息卡/思考跳动追加 '拦截X' (v3.2 遗留的 usage.blocked 联动补齐)
- 测试: test_evaluation 62→63 (+出车提醒) - test_llm_convo 116→118 (+危标注两断言/图例) - run_tests 42 - replay_smoke 36 - clean_reason 10 - check_ui 全过 EXIT 0; prompts_dump 已重生成 (system 2270 字); server.js 未动

## 2026-08-30 16:10 手动优化轮 v3.4 (用户指令: 继续测试至少20点, 第二轮)

- 实测: 24 手长局 (HIST_CAP 触发实战验证) — 裁剪 warn + 任务头重注入正常, 局面连续无断裂; 弃车牵制→炮借马架吃回战术组合; 窝心马攻防闭环 (黑跳窝心→红马攻宫心→黑被迫跳回)
- **test/analyze_blunders.js 送吃判定真 bug 修复 (v3.4, 本轮最大成果)**: 送吃/亏换判定的'换回'计算从未真正落子验证 — 己方子仍占落点 → 反吃扫描恒 0 → 有保护/可反吃也误判送吃, 历史报告全部高报 (24 手局三个'送吃大子净亏9'实为弃车牵制正确战术, 均为假阳性); 修复: 逐个落对方吃子再算我方吃回 (与 guardHanging v2.2 同源); 修复后 24 手局假阳性清零 (只剩真问题: 对方免费吃/窝心马/拉锯)
- ai/llm_agent.js extractJson 加固 (v3.4): 尾逗号容错 (',}' → '}') + 单引号键值兑底 — LLM 高频 JSON 格式错误免重试直接解析
- evaluation/position.js 出车提醒收紧 (v3.4): 原 opening 全程触发与挺兵任务抢手 — 改为三任务近完成 (中炮架好+双正马出齐) 才催出车
- ai/llm_agent.js + evaluation/position.js + test/* + README v2.1→v3.4 标题同步 (前轮累计)
- 测试: test_evaluation 62→64 (+出车双向断言/任务提醒) - test_llm_convo 118→120 (+尾逗号/单引号/HIST_CAP) - 其余全套 EXIT 0; prompts_dump 未变 (system 未动); server.js 未动

## 2026-08-30 17:55 手动优化轮 v3.6 (用户指令: 中国主流提供商 + Claude + 自定义接口)

- server.js 内置服务商扩容 (v3.6): 6→16 家 — 新增 阿里通义千问(DashScope)/字节豆包(火山方舟)/腾讯混元/讯飞星火/零一万物/百川智能/阶跃星辰/硅基流动/**Anthropic Claude(原生协议)**/**自定义(OpenAI兼容)**; server.js 模板与用户 keys.json 同步 (16 家, tokenrhythm key 保留)
- server.js relayAnthropic 协议转换中继 (v3.6): OpenAI 风格 payload → Anthropic /v1/messages (system 抽取/user-assistant 交替合并/x-api-key + anthropic-version 鉴权/max_tokens 缺省/上游固定非流式) → 合成 OpenAI 风格 SSE 帧 (llm_agent 零改动); usage 映射 input/output_tokens; 等待期 15s SSE 心跳防 streamIdle 60s 误杀; 浏览器断连销毁上游
- server.js 自定义提供商接口 (v3.6): keys.json custom 块 (baseUrl + apiKey, models 留空则前端模型框自由输入; 可加 headers 字段自定义请求头, chatPath 可覆盖) — 任意 OpenAI 兼容网关即插即用
- server.js 每服务商自定义请求头 (v3.6): relay headers merge providerCfg.headers (部分网关需额外鉴权头)
- 端到端验证: mock Anthropic 上游 + 独立 relay 实例 — 7 项请求校验全过 (path/x-api-key/version/system抽取/首user/max_tokens/stream off), SSE 2 帧 + usage 100/20 映射 + answer 可解析为着法 JSON, E2E PASS
- 版本: server health/banner + README 标题 v3.4→v3.6; keys.json 新服务商热加载无需重启 (server.js 协议转换需重启一次)
- 测试: 全套 6/6 EXIT 0 (64/120/42/36/10/check_ui); 重新打包 LLM-chess-v3.6-20260830.zip (泄漏检查 0); codemod/e2e 临时脚本清理

## 2026-08-30 18:40 提示词补丁 v3.6.1 (用户指令两条)

- ai/llm_agent.js 思考纪律追加'落子前想后果': 对方最强回应是什么, 会被反吃/送将/丢先手吗 — 与'只比2候选'配合, 不破坏速度红线
- ai/llm_agent.js 开局核心追加'每上一匹马立即挺同侧兵': 马二进三后接兵三进一, 马八进七后接兵七进一 (与八步三任务制对齐, 挺兵不再被出车挤掉)
- 测试: system 2211→2348 字 (≤2400) - test_llm_convo 120/120 - test_evaluation 64/64 全过; prompts_dump 已重生成 (缓存前缀一次性重建, 预期内)

## 2026-08-30 16:30 手动优化轮 v3.5 (用户指令: 继续测试至少20点)

- 实测: **deepseek-v4-flash 跨模型观察局** (tokenrhythm 中继) — 7 手处因上游 503/504 连环中止, 但数据完整: 缓存命中 71%/74% (prompt_cache_hit_tokens 三口径上报验证 ✓), 安全阀跨模型首杀 (#02 双 504 后文本兑底送车被阀拦下), 检测器发现 deepseek 两次漏吃免费马 (#03/#05 炮b3-b10 未走, #07 才吃), 残局保谱实战再验证 (残谱 7 手落盘 + MATCH INCOMPLETE)
- server.js 请求体上限 (v3.5): readBody 2MB 上限 → 超限 400 (防异常大包 OOM)
- server.js readBody abort/error 处理 (v3.5): 客户端中断不再挂起 Promise
- server.js relay 客户端断连销毁上游请求 (v3.5): 浏览器关页即 destroy upReq (省上游 token)
- server.js 版本号同步 (v3.5): /api/health + 启动 banner v1.0→v3.4
- server.js 默认绑定 127.0.0.1 (v3.5): API Key 安全; 局域网访问设 LLMCHESS_HOST=0.0.0.0 (需重启生效)
- server.js MIME 补 .md/.txt (v3.5): prompts_dump.md 正常渲染
- 跨模型发现 (v3.5): deepseek-v4-flash 质量弱于 glm-5.3-flash (漏吃免费马×2 vs 0 瞎走), 上游 503/504 更频发; 兑底阀/残谱保谱/缓存统计跨模型全部正常工作
- 测试: test_evaluation 64 - test_llm_convo 120 - run_tests 42 - replay_smoke 36 - clean_reason 10 - check_ui 全过 EXIT 0; server.js 语法过 (改动需重启生效, 未动正在运行的服务)

## 2026-08-30 14:30 手动补丁 v3.0 (用户指令: 开局首要目标四步序提示词)

- ai/llm_agent.js 开局两节重写 (v3.0): 开局路线 = 首要目标四步序 — ①架中炮 (炮二/八平五) ②上正马 (马二进三/马八进七) ③挺兵 (兵三/七进一) 给马腾出马脚 ④马跃过河进攻 (卧槽马/盘头马); 仅当炮路受制或必杀才变通 (不再按棋风三选一)
- ai/llm_agent.js 开局核心改为每手核对四步序进度 (中炮架了没/正马上了没/马脚开了没); 马脚未开时挺兵优先于跃马 (蹩腿马跳不出); 保中兵/防炮直打/车稍后出动保留
- 实测 6 手真跑: 模型严格按序执行 — #01 架中炮 / #03 上马 / #05 挺兵 (摘要自述'按四步序推进'), 黑方同构执行; 瞎走 0, meta 6/6; 一次上游 503 鉴权抖动被 v2.9 线性退避接住; 新增系统拦截统计行 0/0 上线; 缓存命中 红 57%/黑 24%
- 测试: test_evaluation 59/59 (三选一锚点同步为四步序) - test_llm_convo 110/110 - run_tests 42 - replay_smoke 36 - clean_reason 10 - check_ui 全过 EXIT 0; prompts_dump 已重生成 (system 2161→2190 字); server.js 未动
- 遗留风险: 四步序为强约束, 对方针对性破坏 (如进炮压马) 时依赖'炮路受制才变通'子句灵活应变 — 待实战观察

## 2026-08-30 14:50 手动补丁 v3.1 (用户指令: 顺序放开 + 八步三任务 + 出车进攻鼓励)

- ai/llm_agent.js 开局两节重写 (v3.1): 顺序放开 — 架炮与上马先后不限, 挺兵与跃马次序灵活; 硬约束 = 八步内完成三任务 (架中炮/上正马两匹/挺兵开马脚); 三任务完成后优先出车进攻 (车一平二/车九平八, 占肋道/卒林线, 车马炮协同过河); 原'车稍后出动'移除 (与出车鼓励冲突)
- 实测 8 手真跑: 红 炮马马车 / 黑 炮马车马 — 顺序灵活性与出车鼓励均生效 (红 #07 出车摘要'抗衡黑车'); 模型 attempt1 内容里自做任务核对 (架中炮✓/上正马还差一匹/挺兵开马脚) — 任务清单意识已建立; 缓存命中 71%/65%; meta 8/8 瞎走 0 拦截 0/0 MATCH OK
- test/test_evaluation.js 锚点同步: 四步序→三任务+优先出车进攻; 开局核心锚点 '前3-4手'→'前八步'
- 测试: test_evaluation 59/59 - test_llm_convo 110/110 - run_tests 42 - replay_smoke 36 - clean_reason 10 - check_ui 全过 EXIT 0; prompts_dump 已重生成 (system 2190→2211 字); server.js 未动
- 遗留观察: 本局双方均把挺兵顺延到出车之后 (八步内未走兵) — 任务制下顺序放开自然结果; 若需'三任务未齐不出车'强约束可一行收紧

## 2026-08-30 ~23:50 / 2026-08-31 ~01:10 回补: 未登记轮 (v3.7 系列, 从代码注释/测试恢复 — 防后续轮重复)

- evaluation/position.js 将门/肋道控制检测 (v3.7): 己方大子/过河兵占对方将门线 (x=3/5, d/f 路) → 攻方点名"压将门可谋杀势" / 守方点名"九宫吃紧"; 仅提醒不评分, 初始局零噪音
- ui/renderer.js HUD 阶段徽章 (v3.7): 状态条显示 开局/中局/残局 (PHASE_CN), 观战者一眼知阶段
- ai/llm_agent.js 合法列表排序 (v3.7): 杀/困 → 将 → 吃 → 普通 → 危/亏 沉底 (首因偏置, 最优着法优先可见) + tagCache 标注跨 attempt 缓存 (重试复用, 免重复全量静态交换计算)
- ai/llm_agent.js 手数修复 (v3.7): HIST_CAP 裁剪后 (convo.length+1) 手数错位 (第13手错显第11手) → 改由引擎步数推导 Math.floor(ply/2)+1; v3.7b 手数无空格与测试契约一致
- test/analyze_blunders.js 开局三任务检测 (v3.7): 各自第8步前须完成 架中炮/上正马两匹/挺兵开马脚 (对齐 v3.1 三任务制) + 检测循环封装 + --selftest 回归
- 测试: test_evaluation 64→70 (将门双向断言/排序/tagCache/手数) - test_llm_convo 120→124 (排序/沉底/裁剪后手数)
- 提示词未动 (system 仍 2348 字, v3.6.1 状态); server.js 未动

## 2026-08-31 04:16 自动优化第7轮 (cron llmchess-auto-optimize)

- core/engine.js 自然限着判和规则闭环 (v3.8): 连续 120 半回合 (60 回合, 亚洲棋规) 无吃子 → 自动终局 result='natural' 和棋; naturalCap 可配 (0=关闭), 吃子重置时钟, undoPly 重扫重算, 将军着法不计入, ruleEnforce:false 不判 (分析器/回放不重判); 兜住重复判和盲区 — 换着法序拉锯 (局面不精确重复) 原本可无限延续
- ui/renderer.js 终局卡 natural 文案 (自然限着判和 · 双方 60 回合无吃子) + benchmark/record.js result 注释补 repetition/natural
- ai/llm_agent.js 重试退避覆盖面扩大 (v3.8): retryWaitMs 提为模块级纯函数并导出 XQ.LLMAgent.retryWaitMs — 退避正则 429/503 → 429/50[234]/gateway/网关 (tokenrhythm/deepseek 上游 502/504 与 503 同源, 旧版 504 仅等 0.4s 立即重打); 格式类错误短等 400ms 不变
- ui/app.js PGN 导出和棋标准记号 (v3.8): repetition/natural/draw/agree 判和局 → '1/2-1/2' (PGN 标准), 未完成局保持 '*', 结果记号统一由 pgnRes 计算 (header 与末尾标记一致)
- evaluation/xiangqi_knowledge.js + position.js 兵临九宫知识 (v3.8): 过河兵入对方九宫区域 (x3-5, 非底线) 子力 ×1.2 + 双向摘要点名 (己方'威胁九宫配合车马可成杀势' / 对方'优先驱赶或兑走'); 与底线老兵贬值互斥 (y0/y9 归老兵管), 初始局零噪音, 不动 systemPrompt
- ui/app.js 回放 URL 深链 (v3.8): rpPickLoad/rpWatchRecord 写 '#rp=ls:<id>' (replaceState 不进历史栈), rpClose 清除, rpOpen 深链指定对象优先于上次选择, 页面加载带 #rp= 直达回放 — 刷新/分享链接续看; 导入文件无法深链跳过
- README.md 同步: 标题 v3.6→v3.8, 测试表 44/78/130, v3.7 回补 bullet + v3.8 bullet, 引擎 API 补 naturalClock(), 正确性保证 44 项
- 测试: run_tests 42→44 (E14 自然限着判和+开关 / E15 吃子重置时钟) - test_evaluation 70→78 (兵临九宫 8 断言) - test_llm_convo 124→130 (retryWaitMs 6 断言) - replay_smoke 36/36 - clean_reason 10/10 - check_ui 语法 EXIT 0 全绿; systemPrompt 未动 (system 仍 2348 字 ≤2400); server.js 未动 (全部 F5/免重启生效)
- 教训: (1) 兵临九宫 material() 条件初版误写 y>=3 会漏掉红兵宫内位 y1-2 — 复合条件逐项核对坐标语义再落笔; (2) 测试断言乘法 195×0.7×1.2 心算 162 实为 163.8→164 — 数值断言先算准再写; (3) 贪心找"不吃子不将军"测试着法时 applyPlayerMove 失败后不可 undoPly (会弹掉上一手), 必须 r.ok 判断后分支

## 2026-08-31 11:49 手动大轮 第8轮 (v3.9) — 用户指令「测试并做30个优化或修复」; 三方并行 (core subagent A2 ✓ / ai 主会话接管 B2 ✓ / ui subagent C2 完成 5 项后限流阵亡, 主会话接管补完), 30 项全落地

【core 包 (subagent A2 交付 8 项 + 主会话 1 项)】
- test/run_tests.js E14/E15 撞号修正: v2.2 重复判和/送吃守卫块重编号 E16/E17; 顺手修复 E1 永真断言 (原 || true, 改真非法 a1→a6 跨己方兵)
- core/engine.js undoPly genesis 修复: 自定义起始局面 (opts.startBoard) 时长将/时钟重放错用标准开局板 → 改从 genesis 原像重算 (E21 回归)
- core/engine.js naturalClock 语义修复: v3.8 注释「将军不计入」但实现累加 → 对齐 吃子清零/将军保持/普通+1; 新增纯函数 XQ.Engine.replayStats 导出 (E18)
- core/engine.js snapshot 增量: ply/naturalClock/repetitionCount 进出快照 (E22, replay 重建/观测层依赖)
- test/run_tests.js E19 混合序列 undo 边界 + E20 make/unmake 对账 (生成→应用→撤销→再生成一致, 开局全量+中局抽样)
- core/judge.js 长捉规则缺口注释标注 (扩展点: replayStats 架构加 per-move 捉子标记; 未硬实现)
- test/cn_notation_check.js 同列多子边界断言 +4 + 全量哨兵 (锁定无盘面形态)
- core/engine.js loadSerialized 失败路径修复: 坏棋谱时原 undoPly 会误弹上一手合法着法 (与贪心测试教训同源) → 改 newGame 整盘重置
- run_tests 44→49 全绿 (perft 44/1920/79666 金标准保持)

【ai 包 (主会话, 10 项)】
- ai/llm_agent.js 全角救回文案保原文 (v1.8a 遗留修): 新增 origTextField() — 救回场景 summary/plan/evaluation 取原文全角标点, 仅 tN!==t 时启用 (常规路径零开销)
- ai/llm_agent.js confidenceRaw: meta 保留模型原始信心 (1~1.5 区间歧义可观测, v1.8b 遗留); 两个兑底路径 meta 补齐 confidenceRaw 字段
- ai/llm_agent.js extractJson 无引号键容错: {from: "h8"} 裸键正则补引号兜底 (误伤只会解析失败继续走原路)
- ai/llm_agent.js attempts 计数: usage.attempts 全局累计 + meta.attempts 本手尝试次数 (重试可见化)
- ai/llm_agent.js opts.signal 外部中断: 已中止快拒 / 中途中止不烧重试 / AbortError 归因区分 (对局取消/关页不再白等上游)
- ai/llm_agent.js retryBlock 自查提示 (重答前自查括号引号闭合); test/dump_prompts.js 示例同步
- test/dump_prompts.js --check 模式并升级硬门禁: system 超 2400 字或检出特殊符号 → exit 1
- test/smoke_relay.js 服务未启动友好报错 (先启动 node server.js 提示)
- config/keys.json + index.html datalist 模型表同步: kimi-k2.6 / MiniMax-M3 / qwen3.5-plus
- test_llm_convo 130→140 全绿 (新增 10 断言)

【ui/replay/eval 包 (subagent C2 完成 5 项后限流阵亡, 主会话接管补测 + 续做 7 项)】
- replay/replay.js parseEval 迁移自 app.js (node 可测) + 方向判定修复: 无符号数字只在胜负词齐备且恰指一方时定方向, 子力词/孤立数字不动方向 (v3.3 遗留误判修)
- benchmark/record.js saveImported 导入落库 (import-* 前缀只留最近 2 条, 与真实记录分池); ui/app.js 导入写深链 #rp=ls:<id> (v3.8 遗留: 导入文件深链/刷新续看可达)
- benchmark/record.js summarize 一行战绩统一口径 (红胜/黑胜/和 · 手数 · 吃子 · 用时 + 终局标签); benchmark/cli.js 接入
- evaluation/position.js 沉底炮知识: 炮沉对方底线两翼 (x=1/7) 双向点名 (攻方勿撤/守方防底线闷杀), 与将门/空头炮/中炮检测零重叠, 初始局零噪音
- ui/app.js 模型 datalist 静态兑底保留 (中继不可用/无 models 时不再清空, 与 keys.json 核对去重)
- ui/app.js cnNotation 同列同种消歧: pieceAt 注入 (走子方在列扫描/离列补回 from.y), 同列 2+ 前/后, 兵 3+ 前/中/后; test/cn_notation_check.js 8 新用例 (17→25 全绿)
- ui/app.js 键盘 [ / ] ±5 手跳转 (v1.6.2 跳转按钮的键盘版) + 帮助模态补行
- test/match_headless.js json 原子写 (tmp+rename, 防中途崩溃留半写文件)
- test/analyze_blunders.js --top=N / --type= 报告层参数化 (检测逻辑不动)
- test/check_ui.js 断言增强: <script src> 本地引用存在性扫描 + localStorage key xq_ 前缀守护 (违例 exit 1)
- replay_smoke 36→45 (parseEval 6 + saveImported/summarize 3); test_evaluation 78→81 (沉底炮 3)

【测试总览】run_tests 49 / test_evaluation 81 / test_llm_convo 140 / replay_smoke 45 / cn_notation_check 25 / clean_reason 10 / check_ui (语法+ID+src+LS 守护) / analyze_blunders --selftest — 全 EXIT 0; systemPrompt 未动 (2348 字 ≤2400); server.js 未动; cron llmchess-auto-optimize 本轮期间暂停防撞车, 完成后恢复

【教训】(1) 兜(U+515C)/兑(U+5151) 形近字打错连烧两次 edit — 复杂汉字锚点先核对; (2) edit oldText 逐字含缩进 (app.js 实际 2 空格 vs 预期 6); (3) provider 不稳期 (超时波+限流) subagent 三路并行全灭, 主会话接管 + 文件所有权互斥是正确降级路径; (4) subagent 阵亡前已落的代码必须先跑测试核验再接手, 不能默认干净 (C2 的 5 项实测全绿)

## 2026-08-31 12:49 提示词专项 第9轮 (v3.9b) — 用户指令「针对提示词做10个优化」
1. ai/llm_agent.js system 合法性节补照面规则: 帅将不可无隔子同列相对(照面违规被拒) — 引擎 D4-D6 会拒, 提示词预防烧重试 (真实规则缺口)
2. system evaluation 口径统一: 一律红方视角(黑优写负数) — 原例词红方视角与 score 你方视角在黑方时歧义 (模型写 '+0.5 黑略优' 会被解析成红优)
3. system 子力价值补兑子速算: 车换马炮亏, 马炮兑车赚 (换子决策速查)
4. system 补过河兵价值: 翻倍勿轻兑 (对齐 engine materialDiff=2 / evaluation ×1.5)
5. system 防拉锯与长将矛盾消解: '解将除外' 移除 → 连将也须变着, 禁长将长捉(长将判负) — 原句暗示连将豁免与禁长将矛盾
6. system 落子自检露将具体化: 露将 = 对方车炮沿线直射帅将
7. system 战略优先级压缩: 对方子入侵底线宫城句 省 10 字
8. system 三处微压缩腾预算: 思考纪律复述列举/输出语言落后句/评分驱动句/镜像句 共省 ~17 字
9. user retryBlock 全角提醒 (全角字符一律半角) + strict 文案口径统一: 'summary 30字以内' → '14字以内' (与输出格式示例一致); recentLine 近几手序列补吃子标记 (车h3>e3吃马 形态, 对拉/材料判断更准)
10. test_llm_convo 守护扩展 +9 断言 (140→149): 照面/视角/兑子/过河兵/解将豁免移除/露将/14字口径/全角提醒/attempts; 旧锚点 '禁长将长捉' '第一直觉即最终答案' 保留并回归
- 字数: 2348→2393 (≤2400 硬门禁通过, 增减平衡); prompts_dump.md 已重生成; 特殊符号 0
- 测试: test_llm_convo 140→149 全绿 EXIT 0 / test_evaluation 81 全绿 / dump --check EXIT 0; 其余套件不受影响 (engine/ui 本轮未动, 上午轮已全绿)
- 教训: 改措辞先 grep 测试锚点 ('禁长将长捉'/'第一直觉即最终答案' 是守护断言, 两处措辞变更各炸 1 断言); 新增内容用压缩等价置换, dump --check 硬门禁立刻兜底 (首轮 2417 超限即被抓)

## 2026-08-31 13:09 发布准备 第10轮 (v3.9.1) — 用户指令「要上传 GitHub, 做 10 个让用户更方便的优化」; 附带发布前安全审计
1. package.json (新增): npm start (tools/start.js) / npm stop / npm server / npm test (7 套件一键) / engines node>=18 / MIT 元数据 — GitHub 用户零记忆成本
2. .gitignore (新增): config/keys.json 永不入库 + logs/temp/screenshots/*.log/node_modules 排除 — 保护新用户自己的 key 不被误传
3. config/keys.example.json (新增): 16 家供应商完整结构模板 (空 key), 仓库浏览者不跑代码也能看懂配置格式
4. LICENSE (新增): MIT (版权 2026 杜) — 公开仓库合法复用前提, 用户可自行更换
5. README 快速开始节: 3 步上手 (clone/启动.cmd/npm start) + 零配置试玩路径 (执方选随机AI) + npm test — 随机AI 链路本已存在 (app.js type=random 分支), 此前不可发现
6. README 安全与配置节: keys.json 已被 ignore/密钥仅存服务端/LLMCHESS_HOST 局域网/产物目录不入库
7. server.js 首跑横幅: v3.6→v3.9 + 新增「零配置: 无 Key 也能玩 — 执方选随机AI」提示行 (需重启生效)
8. tools/start.js: 横幅 v3.4→v3.9 + 服务商列表后无任何 apiKey 时打印零配置试玩指引
9. OPTIMIZATION_LOG.md 顶部导读: 说明用途/格式/追加约定 (42KB 逐轮日志首次可导航)
10. test/check_ui.js 发布四件套守护: .gitignore/LICENSE/package.json/keys.example.json 存在性扫描, 缺失 exit 1 (防发布物被误删)
- 安全审计结论: config/keys.json 未被 git 跟踪且从未入历史 (workspace 级 config/ 规则覆盖 ✓), tokenrhythm key 49 位仅在本地; LLM-chess 无本地 .gitignore 的空缺已补
- ⚠️ 重要提醒 (已告知用户): 现有 git 仓库根在 workspace 上层, TOOLS.md (含券商账号)/MEMORY.md (量化策略) 处于跟踪状态 — 上传 GitHub 必须在 LLM-chess/ 内新建独立仓库, 不要推整个 workspace 仓库
- 测试: npm test 全链 (7 套件) 全绿 EXIT 0; check_ui 新增发布守护通过

## 2026-08-31 14:45 发布收尾 (v1.0 品牌) — 用户指令
- 对外品牌统一 v1.0: README 标题 / package.json 1.0.0 / server.js 与 start.js 横幅; 历史日志内 v2.x/v3.x 标签保留 (过程记录)
- GitHub 描述改全英文并经 API 直写 (PATCH, GCM 缓存凭据), 修复复制粘贴产生的 ?? 乱码; git tag v1.0 已推送 (d52455c), 可基于 tag 发 GitHub Release
- 教训: 向 git 传中文 -m 参数实际入库为 UTF-8 (node 核验通过), 控制台乱码只是 GBK 显示层; GitHub 描述含长破折号时经浏览器剪贴板可能变 ?? — 描述用纯 ASCII 最稳

## 2026-08-31 17:10 UI i18n (v1.0.1) — 用户指令「添加英文版本 + 语言切换」
- ui/i18n.js (新增): 零依赖轻量 i18n 框架 — 70 键双语映射 (zh 默认/en), XQ.I18N.t/tArgs/setLang/getLang/apply, localStorage xq_lang 持久化, data-i18n / data-i18n-title 属性驱动, apply 后派发 xq:i18n 事件
- index.html: 引入 i18n.js (app.js 之前), 41 处静态中文加 data-i18n/data-i18n-title (title/h1/subtitle/设置面板全字段/think 面板/底部按钮/终局卡), 设置面板新增「语言」下拉 (中文/English)
- ui/renderer.js: 状态条文案 (胜利/和棋/回合/将军/思考中) + 终局卡 eo-title 接 XQ.I18N.t/tArgs
- ui/app.js: DOMContentLoaded 挂 ui-lang change 监听 → XQ.I18N.setLang(lang, true)
- 范围说明: 系统提示词 (给模型) 保持中文不在 i18n 范围; 棋盘棋子字符 (帅将车马炮) 为领域字符暂不翻译 (后续可加 PIECE_CHARS 双语)
- 测试: npm test 全链 EXIT 0 (含 check_ui 新 ID ui-lang/i18n.js 校验)

## 2026-09-01 09:00 第11轮 (v1.0.daily, cron llmchess-daily-optimize-report) — 仓库公开后社区/部署基建 10 项

1. .github/workflows/ci.yml (新增): CI 门禁 — push/PR 触发, Node 18/20/22 三版本矩阵, 全量 git ls-files js node --check + npm test 七套件; README 徽章行头部加 CI badge (链接 Actions)
2. .github/ISSUE_TEMPLATE (新增): bug_report.yml + feature_request.yml (YAML 表单: 复现步骤/领域下拉/日志区附永不贴 key 警告) + config.yml (强制走模板)
3. .github/dependabot.yml (新增): github-actions + npm 双生态每周检查 (应用零依赖, 主要守护 CI action 版本)
4. CONTRIBUTING.md (新增): 零依赖规则/双环境模块约定 (XQ.* 命名, 禁 require)/提示词缓存契约 (system 恒定+append-only+重试居末, 勿破)/PR 前置 npm test+node --check
5. CODE_OF_CONDUCT.md (新增): Contributor Covenant 2.1 精简版 (pledge/标准/执行/范围/署名)
6. SECURITY.md (新增): 支持版本表 + GitHub 私密漏洞报告入口 + 安全模型说明 (keys 服务端/127.0.0.1 默认绑定/无鉴权提醒/运行产物不入库)
7. Dockerfile + .dockerignore (新增): node:22-alpine 零依赖直拷, ENV LLMCHESS_HOST=0.0.0.0, HEALTHCHECK 打 /api/health, config 卷挂载保 keys.json 持久化 (注释含构建/运行命令); README 双语 Quick Start 各加 Docker 行
8. render.yaml (新增): Render.com 一键部署模板 (buildCommand npm test 作门禁, healthCheckPath /api/health, 免费档可用, 部署后填 key 提示); README 双语各加云端演示行
9. .github/workflows/release.yml (新增): 推 tag v* 自动跑 npm test 门禁后建 GitHub Release (generate_release_notes), 后续发版零手工
10. index.html + ui/i18n.js: SEO/OG 补全 (og:title/description/image=docs/ui.png/url + twitter:card large_image, 分享卡片出图) + a11y (i18n apply() 支持 data-i18n-aria 属性; snd-toggle/gear-toggle 补 aria-label 双语切换; gear title 误用 nav_settings(值=齿轮图标) 修正为 settings_title)

- 测试: node --check 37 文件 0 失败 - npm test 七套件全绿 EXIT 0 (run_tests 49 / evaluation 88 / llm_convo 149 / replay_smoke ALL PASS(短谱合成路径) / clean_reason 10 / cn_notation 25 / check_ui EXIT 0 含发布四件套守护)
- server.js 未动 (零重启); systemPrompt 未动 (2393 字); GitHub 数据: stars/forks 0, 无 issue/PR, release v1.0 已发布, traffic 需 auth

## 2026-09-02 09:00 第12轮 (v1.0.daily, cron llmchess-daily-optimize-report) — CI 红灯修复 + 回放 i18n + 社区基建 9 项

1. test/replay_smoke.js **CI 红灯根因修复 (本轮最重要)**: 首个 CI failure (8b0b09f, 三 Node 版本全挂) 根因 = 第58行直接 readFileSync('logs/match_headless.json'), 而 logs/ 被 gitignore, CI 全新 checkout 无此文件 → ENOENT; (v2.5 短谱保护只兜短/坏 JSON, 漏了文件不存在); 修复 = existsSync+try/catch 统一入口, 缺文件/坏 JSON 都走合成谱兜底; 本地模拟 CI 路径实测 (临时挪走残谱 → 合成 12 手 ALL PASS) + 正常路径回归
2. .github/workflows/ci.yml + release.yml 维护: 合入 Dependabot 三项 (actions/checkout v4→v7 / setup-node v4→v7 / softprops/action-gh-release v2→v3, 推送 main 后 3 个 PR 自动关闭, 顺带消除 runner Node20 弃用警告); ci 加 workflow_dispatch 手动触发; 矩阵加 windows-latest (node 22 include 单点, 校验主开发平台; 本机即 Windows 全套测试绿, 风险低)
3. **回放层 i18n 全链** (ui/i18n.js +66 键 ZH/EN 双语 + ui/app.js): rpEnsure 骨架按钮/标题/占位符全部 data-i18n + data-i18n-title 标记, 构建后立即 XQ.I18N.apply() (EN 用户首次打开即英文); 动态面板 (选择器/头部摘要/信息面板/评估条/走法列表/键盘帮助模态/思考时长与评值图表标题) 全部改 t()/tArgs(); 判和局 result 原文 (repetition/natural/draw/agree) 本地化描述; xq:i18n 事件联动重刷回放层动态面板 (语言热切换生效); 自动核对脚本验证 used keys 全存在于 ZH 且 ZH/EN 键集一致
4. .github/PULL_REQUEST_TEMPLATE.md (新增): 改动类型 checkbox + npm test/node --check 勾选 + 提示词缓存契约提醒 (system ≤2400/无特殊符号/dump --check) + 密钥红线 + 双语 README 同步提醒
5. .editorconfig (新增): utf-8 / js·css·html·json·yml 2空格 / 去行尾空白 (md 不 trim 保硬换行, cmd 不强制 EOL), 零 churn
6. package.json 元数据补全 (repository/bugs/homepage/author/keywords 8 个) + .nvmrc (22) — GitHub 侧栏/生态工具可读
7. README.md + README.zh-CN.md: 云端演示行升级为 **Deploy to Render 一键部署按钮** (render.com/deploy?repo=); 新增 Community/社区节 (Issues/Discussions/CONTRIBUTING/SECURITY 私密漏洞报告入口)
8. GitHub Discussions 已启用 (API PATCH has_discussions=true, GCM 凭据) + .github/ISSUE_TEMPLATE/config.yml contact_links 增 Discussions 入口 (分流问答, issue tracker 保持干净)
9. docs/ui.png 截图轮换: headless Edge 重拍当前界面 (556KB→511KB, 含 i18n/终局卡等 v1.0.1 后演进), 视觉核验棋盘/双方面板/标题正常

- 测试: npm test 七套件全绿 EXIT 0 (run_tests 49 / evaluation 88 / llm_convo 149 / replay_smoke ALL PASS(缺文件合成路径+正常路径双验证) / clean_reason 10 / cn_notation 25 / check_ui EXIT 0 含发布四件套守护); 改动 js 全 node --check; package.json JSON.parse 验证
- server.js 未动 (零重启); systemPrompt 未动 (2393 字); GitHub 数据: stars/forks 0, 3 个 open PR (均为 dependabot action 版本升级, 本轮合入后自动关闭), release v1.0, traffic 见报告
- 教训: (1) apply_patch 想替换 workflow 两行时把上下文行误写成新增 → setup-node 重复行, 逐文件读回核验才发现 — patch 后必读回; (2) i18n.js 块注释里写 "rpPaint*/" 会提前闭合注释 (node --check 秒抓) — 注释内禁出现 */;

### 第12轮补记: CI 推送后两轮 hotfix (同日, 推送后真实 CI 验证闭环)
- hotfix a5aabd2: ci.yml matrix 基础组合漏定义 os (runs-on 空值) → GitHub 启动失败 0 jobs; 修复 = os:[ubuntu-latest] 进基础矩阵 + windows include
- hotfix c442e6b → 7b7126a: ubuntu20 job 挂 F1 随机局测试 — 既有 flaky (Math.random 抽样, finished>=1 概率性); 修复 = 种子化 LCG (0x2F6E2B1) 确定性抽样, 三平台同结果; 种子下边际 finished=2/10 / plies=2420 (门槛 1/1500) 舒适
- 最终 CI 7b7126a: 4/4 jobs success (ubuntu 18/20/22 + windows-latest 22) — 仓库公开以来 CI 徽章首次全绿
- Dependabot PR #1/#2/#3 已关闭 (变更已直入 main, 留言说明)
- 教训: (1) workflow matrix include 语义 — include 只补/并, 不给未定义键兜底, runs-on 引用的键必须在基础组合有值; (2) 随机抽样断言进 CI 必须种子化, 概率性通过不是通过; (3) push 后要等真实 CI 结论, 本地全绿不等于 CI 绿

## 2026-09-03 09:00 第13轮 (v1.0.daily, cron llmchess-daily-optimize-report) — CI 门禁补全 + a11y/国际化 10 项

1. tools/check.js (新增): `npm run check` 统一入口 — 全业务 js 跨平台语法扫描 (node --check, 排除产物目录) + 提示词硬门禁 dump --check; 此前 dump --check 只在本机跑, CI 不设防, 本轮补全
2. .github/workflows/ci.yml — 语法步骤改 `npm run check` (替代 git ls-files | xargs, Windows runner 不友好且漏提示词门禁); CI 与本地检查首次同源
3. package.json — scripts 补 `check` (语法+提示词门禁) 与 `match` (node test/match_headless.js 一条命令开无头对局)
4. .github/workflows/greetings.yml (新增): 首次 issue/PR 自动欢迎 (双语: 模板补全/密钥红线/npm test+npm run check 指引/Discussions 分流)
5. index.html — a11y: prefers-reduced-motion 媒体查询全站动效降级 (落子/脉冲/闪烁/呼吸/光晕), 前庭敏感用户不再被持续动画干扰
6. ui/i18n.js — a11y/SEO: `<html lang>` 同步移入 apply() (初始加载即生效, 存了 en 的用户刷新后 lang 属性不再停在 zh-CN); setLang 原地同步去重
7. 棋子西文记谱切换 (国际用户): core/piece.js LETTERS 表 (KABNRCP, 红大写/黑小写) + ui/renderer.js pieceGlyph() + index.html ui-pieces 下拉 (设置面板, ui-lang 旁) + i18n 双语键 + ui/app.js change 监听 (localStorage xq_pieces 持久化, 切换即重绘); 仅棋盘显示层, HUD 中文记谱/评估/决策卡不受影响; 回放层共用 render 核心自动生效
8. docs/ARCHITECTURE.md (新增): 贡献者架构文档 — mermaid 模块地图 / LLM 单手数据流 / 提示词缓存契约 (勿破) / 测试地图表 / 零依赖与产物约定
9. README.md + README.zh-CN.md — 徽章升级: 补 Release (github/v/release) + Stars (github/stars) 徽章; 中文版首次补徽章行 (此前只有英文版有)
10. test/check_ui.js 第8节 — README 双语版本一致性守护: 主/中文档 h1 版本号须一致且与 package.json version 对齐 (防后续轮改版漂移)

- 测试: npm run check (语法全扫+提示词门禁) + npm test 七套件; 改动 js 全 node --check; server.js 未动 (零重启); systemPrompt 未动 (2393 字)
- GitHub 数据 (直连, 代理当日故障): stars/forks/watchers/subscribers 0, open issues/PRs 0, release v1.0 (2026-08-31), traffic 需 auth (401), 最近推送 2026-09-02; 另: 仓库 topics 经 API 直写 (SEO/可发现性), GitHub 社交预览图需仓库 Settings 手动上传 (API 不支持)
- 教训: apply_patch 多文件补丁失败会半途落地 (piece.js/renderer.js 已改而 i18n.js 未改) — 多文件补丁后必须逐文件核验; 手写 patch 缩进易错, 复杂中文锚点优先用 edit 工具逐字匹配; 兜/兑形近字第三次踩坑 (LOG 教训读了自己也踩)

## 2026-09-04 09:00 第4轮 (v1.0.daily, cron llmchess-daily-optimize-report) — 社区运维/文档/i18n 守护 10 项

1. CHANGELOG.md (新增): 里程碑式更新日志 (Keep a Changelog 风) — Unreleased/1.0.1/1.0.0 三段, 与逐轮 OPTIMIZATION_LOG 分层; README 双语社区节挂链
2. docker-compose.yml (新增): `docker compose up -d` 一键部署, ./config 卷挂载密钥持久化; README 双语 Quick Start 补行
3. test/i18n_check.js (新增, npm test 第8套件): 6 组断言 — zh/en 键集一致/键值非空/占位符逐键一致/index.html data-i18n 覆盖/ui+replay JS t() 字面量覆盖/哨兵键; **首跑即抓真 bug**: btn_save_settings 键缺失于字典, apply() 会把「保存并开局」按钮覆盖成原始键名 — 已补 zh/en 两键修复
4. index.html a11y: 状态条 role="status" aria-live="polite" (读屏实时播报回合/将军/胜负); ai-banner 有意不加 live (每秒 tick 会刷屏读屏)
5. .github/labeler.yml + workflows/labeler.yml (新增): PR 按改动路径自动打标签 (core/ai/ui/replay/evaluation/benchmark/tests/docs/ci/config 10 类), 步骤先 gh label create --force 补建标签再 actions/labeler@v5
6. .devcontainer/devcontainer.json (新增): Node 22 容器一键贡献环境, postCreateCommand=npm test 门禁, 8788 端口自动转发开浏览器
7. docs/BENCHMARK.md (新增): 无头对局/瞎走分析双语指南 — benchmark/cli.js 冒烟+Elo / match_headless 用法与统计行口径 (缓存命中/系统拦截/attempts) / analyze_blunders 检测类型与 --top --type / 棋谱流向; README 双语批量对局行挂链
8. README 双语 Roadmap 节 (新增): 多模型联赛/GitHub Pages 零配置演示/评价知识库扩充/TTS 解说/英文提示词实验 (诚实标注当前中文提示词最优)
9. .github/FUNDING.yml (新增): GitHub Sponsors (github: yydsdbc), 仓库页显示 Sponsor 按钮
10. ci.yml 安全加固: 补最小权限 `permissions: contents: read` (release/greetings 已有, 此前 ci 缺); README 双语套件徽章 7→8

- 测试: npm run check (语法 39 文件 + 提示词门禁 PASS) + npm test 八套件全绿 EXIT 0 (run_tests 49 / evaluation 88 / llm_convo 149 / replay_smoke ALL PASS / clean_reason 10 / cn_notation 25 / i18n_check 6/6 / check_ui EXIT 0); 改动 js 全 node --check; package.json/devcontainer.json JSON.parse 验证
- server.js 未动 (零重启); systemPrompt 未动 (2393 字)
- GitHub 数据 (代理故障, 直连成功): stars/forks/watchers/subscribers 0, open issues/PRs 0, release v1.0 (2026-08-31), traffic 需 auth (401), 最近推送 2026-09-03
- 教训: (1) 新增守护测试首跑就抓到存量 bug (i18n 覆盖缺口) — 守护类测试要先跑通再挂链; (2) 阈值型断言 (键数>=30) 首日用真实值校准, 拍脑袋阈值会误报

## 2026-09-05 09:00 第14轮 (v1.0.daily, cron llmchess-daily-optimize-report) — v1.0.2 发布 + 社区运维 10 项

1. CHANGELOG.md [1.0.2] - 2026-09-05 节建立 (收编 09-04 Unreleased 内容 + 本轮新增), package.json 1.0.0→1.0.2 — check_ui 版本守护通过 (README h1 v1.0 前缀校验)
2. tag v1.0.2 推送 → release.yml 首次真实收割: npm test 门禁 → 自动建 GitHub Release (generate_release_notes); v1.0 之后 5 天积累全部进正式版
3. .github/workflows/stale.yml (新增): 30 天无活动打 stale 标, 再 14 天自动关 (pinned/keep/security/有 assignee 豁免) — 无人值守仓库自动运维
4. .github/SUPPORT.md (新增): 支持分流 (问答走 Discussions 勿开 issue) + 提问前自查清单; README 双语社区节挂链
5. .github/CODEOWNERS (新增) + package.json funding 字段: PR 自动请求 yydsdbc review; npm fund 指向 GitHub Sponsors
6. ci.yml concurrency 组 (cancel-in-progress): 同 ref 新推送自动取消旧 run 省 runner 时长; 套件计数注释 7→9
7. test/link_check.js (新增, npm test 第9套件): 全仓 .md 相对链接守护 (fenced code 剥离, http/mailto/纯锚点跳过) — 首跑即抓 7 条真死链 (.github/SUPPORT.md 与 docs/ARCHITECTURE.md 的文件相对链接在 GitHub 渲染时全部 404, 已修为 ../ 路径); README 双语套件徽章 8→9 + 测试表补行 + 目录树计数 7→9
8. CONTRIBUTING.md: 新增 "Cutting a release" 维护者手册 (CHANGELOG→package version→tag push→release.yml 门禁) + Docs map (ARCHITECTURE/BENCHMARK/SUPPORT 交叉链接); 套件数 7→9
9. docker-compose.yml 补 healthcheck (/api/health, busybox wget, 与 Dockerfile HEALTHCHECK 同口径, start_period 10s)
10. check_ui 发布文件守护 4→6 (+CHANGELOG.md/.github/SUPPORT.md) — 发布物误删防线扩容

- 测试: npm run check (40 文件语法 + 提示词门禁 PASS) + npm test 九套件全绿 EXIT 0 (run_tests 49 / evaluation 88 / llm_convo 149 / replay_smoke ALL PASS / clean_reason 10 / cn_notation 25 / i18n_check 6/6 / link_check 31 链接 0 断 / check_ui EXIT 0 含发布 6 件套 + 版本守护 pkg=1.0.2)
- server.js 未动 (零重启); systemPrompt 未动 (2393 字)
- 教训: (1) 守护测试首跑抓存量 bug 二度应验 (i18n_check 之后 link_check 又抓 7 条) — 新守护套件必须先真实跑再挂链; (2) .github/ 与 docs/ 下的 md 相对链接要写 ../ 前缀, GitHub 按文件路径解析而非仓库根

## 2026-09-05 16:50 第15轮 (v1.0.3 Unreleased, 杜指令"纵观LLM-Chess做20个优化" — 服务端安全+性能批次)

1. **server.js CORS 收紧**: Access-Control-Allow-Origin 从 '*' 改为同源 Origin 回显 (localhost/127.0.0.1 白名单; 防任意第三方网页借用户浏览器 POST /api/chat 烧 key); file:// 调试 Origin=null 兜底
2. **/api/chat 限流**: 每 IP 30 次/分内存滑动窗 (429+Retry-After; 防失控循环/恶意刷请求烧 key; 超过 1000 IP 自动清过期)
3. **/api/health 真实版本**: 硬编码 '3.6' → 从 package.json 读 (v1.0.2)
4. **npm test 并行化**: 新增 test/run_all.js 零依赖 runner (9 套件并行, 33.5s→19s -43%; 5min 全局超时兜底; 任一失败输出 tail 定位); 原串行链保留 npm run test:serial
5. **keys.json mtime 缓存**: server 端密钥热加载语义不变 (文件一改立即生效), 但省每请求磁盘 IO+JSON 解析; 编辑器半写 (SyntaxError)/临时删除 (ENOENT) 容错保留上次有效配置
6. **静态文件 ETag/304**: sha1 ETag + no-cache (文件未变 304 空回, 对局中 F5 秒开; 动态 api 不走此路径)
7. **BENCHMARK.md 补限流说明**: 并行无头对局撞 429 的处理指引
8. **CHANGELOG [Unreleased] 记录本轮 7 项**
9. **回归验证**: server.js 3 处改动后 npm test 9/9 全绿 (并行 runner); smoke_ui 的 health 检查只断言 relay 字段不受 version 改动影响
10. **勘察记录**: ui/app.js 1608 行拆分评估后本轮不做 (一次性重构风险>收益, 拆分点留档: 决策卡/HUD/回放三块); moonshot 插件 9.1 (openclaw 侧) 不涉及本仓
- server.js 改动说明: 本轮动了 server.js (CORS/限流/health/keys缓存/ETag), 生效需重启 node server.js — Start.cmd/Stop.cmd 或 npm restart
- 下轮候选: app.js 拆分 (ui/render 分离), Dockerfile 多阶段构建, replay URL 分享 (share per-move link), engine worker 线程化

## 2026-09-05 17:50 第16轮 (杜指令: 删除棋风设置, 改为提示词等级 无/低/中/高)

1. **ai/llm_agent.js**: style(attack/balanced/defensive) → promptLevel(none/low/mid/high) 分级注入 — none=零风格节 / low=一句话 / mid=标准 / high=标准+战术补充(兑大子简化/保持复杂度/对方车炮未动勿换大子/保中兵); legacy style 映射 aggressive→high, defensive/balanced→mid (旧存档/旧调用兼容); 评分驱动节删'均势按棋风'
2. **index.html**: 红黑两个棋风下拉 → 提示词等级下拉 (无/低/中/高); 徽章 CSS st-agg/st-def/st-bal → st-none/st-low/st-mid/st-high (灰/蓝/绿/金); subtitle 棋风对垒→风格分级
3. **ui/i18n.js**: style 4 键 → prompt_level + pl_none/pl_low/pl_mid/pl_high (ZH/EN); subtitle 同步
4. **ui/app.js**: styleCN/styleClass → levelCN/levelClass (无/低/中/高); 设置读写默认 balanced→mid; LLMAgent.create 传 promptLevel; agents[side].style 字段名保留 (存档兼容, 值为等级); modelCard 徽章迁移
5. **record 存档兼容**: style 字段名不变 (值域变化), 旧谱 aggressive/defensive/balanced 经 levelCN 兜底显示'中' (未知值回落 mid 样式)
6. **门禁修复**: mid 风格节注入致 system 2413>2400 门禁 → mid 文案三轮压缩 (威胁/王城/均衡出子/果断进攻/急回防), high 级不受影响 (2510 是可选高预算)
7. **新增 test/_prompt_level_smoke.js**: 9 断言 (分级注入/none 无节/legacy 兼容/system 恒定/无残留)
8. **回归**: npm test 并行 9/9 全绿 (test_llm_convo 149 项含 system 长度门禁全过)
- 设计说明: '提示词等级'控制的是风格注入量而非棋风种类 — none=纯引擎驱动零风格偏置 / low 一句话 / mid 标准 / high 加战术细节; 每级 system 长度恒定 (前缀缓存不变式保持)
- 触点清单: llm_agent.js(核心) / index.html(下拉+CSS+subtitle) / i18n.js(ZH/EN 5新键) / app.js(读写+徽章+agent创建) / record 存档字段名兼容

## 2026-09-06 09:00 第17轮 (v1.0.daily, cron llmchess-daily-optimize-report)

1. **README.md**: Features/Styles 段改为 Prompt levels (None/Low/Mid/High, None=纯引擎评价; legacy 棋风存档仍可读) — v1.0.3 改造后的文档对齐
2. **README.zh-CN.md**: 4 处棋风残留清理 (AI信息面板徽章=无灰/低蓝/中绿/高金; 棋风系统→提示词等级系统含存档字段说明; 快速上手/设置入口改'提示词等级')
3. **test/dump_prompts.js**: 标题版本号从 package.json 动态取 (原硬编码 v1.5.8); --check 新增 prompts_dump 漂移守护 (磁盘 dump 与代码渲染不一致即 exit 1, 除生成时间行) — 文档腐化防线
4. **prompts_dump.md**: 重新生成 (v1.0.3 真实渲染, 含提示词等级段; 首手 system 2399 字达标)
5. **Dockerfile**: OCI 标签 (title/description/source/licenses/documentation); COPY 剔除 test/ (镜像不含测试套件)
6. **.github/workflows/ci.yml**: node-version 矩阵加 24 (18/20/22/24 + windows 22)
7. **CHANGELOG.md**: Unreleased 段记录本轮 (Changed x4 + Added AGENTS.md)
8. **AGENTS.md**: 入库 (昨夜写于 D:\projects 迁移时, agent 操作手册: 硬门禁/常用命令/发版流程/cron 约定)
- 验证: npm run check ALL PASS (含新漂移守护) + npm test 并行 9/9 全绿
- 背景: 项目昨夜迁 D:\projects (junction 兼容); 本轮为迁移后首次 daily 轮
## 2026-09-06 12:16 第18轮 (v1.0.daily, zcode)

1. **移动端棋盘等比缩放**: index.html 棋盘 432px 定宽 → CSS 变量 --cell 驱动 (格子/棋子/行列标/布局尺寸全走 calc), ≤460px 视口 --cell=(100vw-80px)/9 随视口收缩; SVG 线条走 viewBox 自适应零改动 — 手机上棋盘不再溢出
2. **键盘走子 (a11y)**: 主界面方向键移动棋盘光标 (renderer 渲染 .kb-cursor 青色描边), Enter/Space 选子/走子, Esc 取消 — 人棋玩家无鼠标可完整对局; 快捷键帮助同步
3. **屏幕阅读器着法播报**: 新增 #sr-move (sr-only + aria-live=polite), afterMove 播报 第N手+方别+中文记谱 (i18n sr_move) — 状态条 aria-live 只报回合, 着法细节此前无播报
4. **move-log DOM 裁剪**: renderer.logMove 超 150 条折叠头部为 '… 更早 N 手已折叠' 一行 — 长对局 (100+ 手) 节点增长封顶, 每手 scrollTop 重排成本有界; 全程仍可回放/导出
5. **欠费错误文案**: errBanner 新增 402/insufficient balance/余额/欠费/quota 分支 → i18n warn_pay (💰 充值指引) — 此前欠费落进兜底 '❌ 原始报错', 用户不知如何处置
6. **回放书签**: B 键标注/取消当前手; 纯逻辑 toggleBookmark/bookmarkKey 落 replay/replay.js (node 可测), 走法列表 🔖 标记 + 帮助表新增行, localStorage 按棋谱 id 持久 — 复盘长局标关键转折点
7. **新测试套件 test/_replay_edge.js**: 17 断言 (空棋谱/脏棋谱 skipped 容错/书签纯函数不变式/键隔离/控制器空谱操作) — 挂入 run_all 并行, npm test 9→10 套件
8. **README 徽章与套件数同步**: tests-9 suites → 10 suites (EN/ZH + Project Layout 注释)
9. **i18n 新键 6 个**: warn_pay/sr_move/log_trimmed/rp_bm_title/rp_hk_bm + rp_hk_main 扩写键盘走子 (ZH/EN 同步, i18n_check 把关)
10. **CHANGELOG Unreleased 记录本轮**
- 边界遵守: server.js 未动 (零重启); ai/llm_agent.js 未动 (system prompt/缓存架构零风险, prompts_dump 新鲜度 PASS); 无新依赖
- 验证: npm run check ALL PASS (45 文件语法 + prompt 门禁) + npm test 并行 10/10 全绿 (新增 _replay_edge 首跑抓出 skipped 计数断言错误并修正 — 守护先真实跑再挂链纪律再次应验)

## 2026-09-06 12:50 第18轮复审 (龙虾, zcode 产出 review)
1. [ui/app.js] 修复键盘走子回归: Enter/Space 原先无条件 preventDefault — 无光标时吞掉 Tab 聚焦按钮的原生激活; 现无 kbCursor 直接放行
2. [ui/renderer.js] 修复折叠计数: logTrimmed 模块级不复位, 重开对局后 '更早 N 手已折叠' 数字累积错; 现 move-log 清空后首条重置
- 复核确认: 672bd99 其余各项与报告一致 (SVG viewBox 缩放/输入框守卫/回放键位 gating/i18n zh-en 对齐/徽章 10 suites/_replay_edge 纯函数); server.js 与 ai/llm_agent.js 确未动
- 验证: node --check ✓ + npm run check ALL PASS + npm test 10/10
