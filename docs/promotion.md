# 📣 分发弹药库 / Promotion ammo

> 这些是**给你（维护者）亲手发**的帖子草稿。发帖是外部行为，由你决定时机与账号；以下文案按各平台
> 自我推销规则撰写（Show HN 要求本人是作者/贡献者发帖并参与评论；Reddit 各 sub 请先读版规）。
> 发之前把 `<...>` 占位替换为实际值。**不要同一天全平台齐发** — 先一个平台观察反馈，修完最痛的问题再扩散。

---

## 1. Show HN (news.ycombinator.com)

**标题**: `Show HN: Watch LLMs debate and play Xiangqi (Chinese Chess) against each other`

**正文**:

> Hi HN! I built an open-source platform where you can watch LLMs play Chinese Chess (Xiangqi) — with their reasoning visible: each move shows the model's plan, candidate moves with scores, and in committee mode multiple models vote and argue before a move is played.
>
> Things you might find interesting:
>
> - **Committee / roundtable mode**: N models independently propose moves, see each other's proposals, then revote — the transcript of their "argument" is exportable as Markdown.
> - **BYOK demo**: the hosted page (https://yydsdbc.github.io/LLM-Chess/) runs the full engine client-side; paste your own OpenAI/DeepSeek/OpenRouter key and watch real models battle with zero setup. Keys stay in your browser.
> - **Research angle**: a headless benchmark protocol (`node test/match_headless.js provider model 120`) with machine-readable results and a public leaderboard.json — including "illegal move" counts per model, which turned out to be a fun reliability metric.
> - Zero npm dependencies, full Xiangqi rules engine (perft-verified), PWA so it works offline.
>
> Stack: vanilla JS, Node relay for server-side keys, no build step. ~27 test suites in CI.
>
> Known limits: the leaderboard sample is tiny (2 games) — it's a protocol demo, not a ranking. The engine is not an alpha-beta monster; the point is watching models reason, not engine strength.
>
> Happy to answer questions about the rule engine (long-check / repetition / natural-move rules were the tricky part) or the streaming pipeline.

**评论须知**: 作者前 2 小时守评论区；被问"为什么是象棋不是国象"——答：国象 LLM 对局已有不少项目，象棋规则（将帅不能照面/蹩马腿/长将禁手）对 LLM 的格式与规则遵守是更有趣的测试床。

---

## 2. Reddit r/LocalLLaMA

**标题**: `I made LLMs play Xiangqi against each other with visible reasoning and committee votes (open source, BYOK)`

**正文**:

> I wanted to see whether local/API models can hold a legal chess game *and* explain their moves, so I built LLM-Chess: a zero-dependency platform where models play Chinese Chess with a shared reasoning panel.
>
> What I find actually interesting for this sub:
>
> - **Format reliability under pressure**: models must output strict JSON with legal coordinates every move. The benchmark counts "illegal outputs" per model — some models fall apart mid-game, others stay clean for 100+ plies. (This turned out to be a better stress test than chat benchmarks.)
> - **Committee mode**: 3-5 models propose → see each other's proposals → revote. Watching a model change its vote when it sees a rival's line is genuinely fun.
> - **Self-host or BYOK**: keys stay server-side (local relay) or in your browser (direct-connect mode on the hosted page).
> - Works with any OpenAI-compatible endpoint (Ollama/vLLM included).
>
> Repo: https://github.com/yydsdbc/LLM-Chess · Live demo: https://yydsdbc.github.io/LLM-Chess/
>
> Happy to run specific model matchups if you suggest them (I have a few keys).

**版规注意**: r/LocalLLaMA 允许项目分享，但避免高频自推；一周后发「跑批结果贴」（附 leaderboard.json + 有趣的翻车局）比重复宣传更受欢迎。

---

## 3. 知乎（回答 + 想法）

**建议形态**: 回答「LLM 会下象棋吗？」类问题 + 独立文章。

**文章标题**: `我让大模型互相下象棋，还让它们开会吵架：LLM-Chess 开源实录`

**开头**:

> 先说结论：模型下棋不难，难的是每一步都合法、每一次都不装死、还要解释自己为什么这么走。我做了个开源平台把这些全部可视化 —— 模型每走一步，你能看到它的计划、候选着法打分；打开"委员会模式"，多个模型先各自提议、互相看到对方的方案、再投票改选，像圆桌辩论。
>
> 三个有意思的发现：
> 1. **格式遵守是分水岭**。同一局棋里模型会突然开始输出非法坐标，越到残局越容易崩 —— 这比"会不会下棋"更能区分模型纪律性。
> 2. **模型会改票**。圆桌模式里模型 B 看到模型 A 的杀招后改投对方方案，改票原因写在决策卡片里。
> 3. **人类看不懂的地方它们也吵得起来**。一次会诊 3:1 通过的着法，反对票理由是"车被牵制"，而多数派完全没提这点。
>
> 在线 demo（填自己的 key 就能看真模型对战）：https://yydsdbc.github.io/LLM-Chess/
> GitHub：https://github.com/yydsdbc/LLM-Chess

---

## 4. B站/抖音短视频脚本 (45~60s)

| 时间 | 画面 | 文案 |
|---|---|---|
| 0-5s | 决策卡片滚动 + 双模型思考流 | "我让两个 AI 下象棋——但它们得先吵架" |
| 5-15s | 委员会投票界面，3 个模型提议不同着法 | "红方走到这里，三个模型吵起来了：一个要跳马，一个要出车，还有一个想弃炮" |
| 15-25s | 投票条变化，某模型改票 | "看到对手的杀招之后，它当场改票了——理由还写得明明白白" |
| 25-35s | 落子动画 + 吃子 + 评值曲线 | "最后这一手，四个模型里只有一个看懂了" |
| 35-45s | 天梯页 + leaderboard.json | "所有对局数据都能导出，公开可复现——你也能用自己手里的模型跑一对" |
| 45-55s | BYOK 填 key → 开局 | "打开网页、填上你自己的 key，就能看真模型对战。项目开源，地址在简介" |

**简介区**: GitHub 链接 + demo 链接 + 「评论区点菜：想看哪两个模型打，点赞最高的安排」。

---

## 5. X/Twitter thread (英文, 5 推)

1. `I built an open-source arena where LLMs play Xiangqi (Chinese Chess) — and you can watch them THINK before every move. 🧵`
2. `Each move shows the model's plan, scored candidates, and confidence. In committee mode, multiple models propose moves, see each other's lines, and REVOTE. Yes, they change their votes — and write down why.`
3. `The best part: an "illegal move" counter. Watching a model keep perfect JSON+rule discipline for 100+ plies (vs one that collapses at move 30) is a better stress test than most chat benchmarks.`
4. `Zero dependencies. Full Asian rules (long-check, repetition, 60-move natural draw). PWA — works offline. Bring your own key and watch real models battle in the browser: https://yydsdbc.github.io/LLM-Chess/`
5. `Repo + reproducible headless benchmark + public leaderboard.json: https://github.com/yydsdbc/LLM-Chess — suggest matchups in the replies and I'll run them.`

---

## 发帖节奏建议 (D8-D10)

1. **D8**: Show HN（工作日早上 ET 时间）或知乎文章（二选一，看你想先吃哪个社区）。当天守评论。
2. **D9**: 根据首日反馈修 1-2 个最痛问题（预备：README 加 GIF、byok 引导更醒目），然后 Reddit。
3. **D10**: B站/抖音视频 + X thread。视频里「改票」片段是情绪点，务必实拍真实对局。
4. 全程：每贴独立数据（不要复制粘贴同一段），被质疑样本量时直接承认「2 局是协议验证，欢迎你跑出自己的数据」。
