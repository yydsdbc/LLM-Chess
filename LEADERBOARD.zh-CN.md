# 🏆 LLM 象棋天梯（中文版）

> 公开的 LLM-vs-LLM 象棋对局天梯，对局由本引擎完成。样本量目前**极小且未校准** — 排名仅用于演示协议本身，不构成模型棋力结论。可以按下方协议自行复现，或在浏览器里自带 key 跑对战。
>
> 🌐 English: [LEADERBOARD.md](LEADERBOARD.md)

[![leaderboard.json](https://img.shields.io/badge/data-leaderboard.json-blue)](leaderboard.json) [![方法论](#方法论)](#方法论)

## 当前榜

*自动生成: `node tools/leaderboard_export.js` → [leaderboard.json](leaderboard.json) · 更新于 2026-10-31*

| # | 模型 | 局 | 胜 | 和 | 负 | 得分 | 得分率 | 非法着法 |
|---|------|----|----|----|----|------|--------|----------|
| 1 | deepseek-v4-flash-0731 | 2 | 0 | 2 | 0 | 1.0 | 0.500 | 0 |
| 1 | glm-5.3-flash | 2 | 0 | 2 | 0 | 1.0 | 0.500 | 0 |

⚠️ **样本量 = 2 局镜像对局 (每模型自己打自己), 全部为 6~16 手的管线验证局 — 这不是棋力排名**, 只是证明计分链路可用。有意义的排名需要: ≥50 局/对、固定温度、多种对手交叉对战。欢迎用下面的协议跑出自己的数据发 PR。

## 方法论

- **规则**: 完整亚洲棋规子集 — 长将判负、自然限着 (60 回合无吃子判和)、三次重复局面判和、将杀/困毙判定。引擎过 perft 标准验证 (见 `npm test` 内引擎套件)。
- **计分**: 胜 = 1, 和 = 0.5, 负 = 0; 得分率 = 得分/局数。同模型镜像对局 (红黑互换) 消除先手偏差。
- **非法着法**: 被引擎拒绝的模型输出按局累计 — 这是衡量「LLM 是否稳定输出合法格式」的直接指标, 与棋力分开看。
- **无头基准协议** (可复现, 零浏览器):

```bash
# 双方同模型镜像局, 上限手数可调; LLMC_SEED 固定随机成分
node test/match_headless.js <provider> <model> [maxPlies]
# 例: node test/match_headless.js deepseek deepseek-chat 120

# 聚合 logs/match_*.json → leaderboard.json (胜1/和0.5/负0, 按 points→wins→name 排序)
node tools/leaderboard_export.js
```

- **浏览器内天梯**: UI 内的 Elo (benchmark/elo.js, K=32) 只记在**你自己的浏览器** localStorage — 它是天梯的私有视角; 本文件的 leaderboard.json 是**公开、可提交**的视角。两者口径独立, 不混算。
- **BYOK 直连**: 无本地中继时, 在设置 → 直连模式填自己的 key 即可跑真模型对战 (见 README)。

## 数据边界

1. **未校准**: 样本量太小, 不构成任何模型间棋力结论; 分差 < 样本噪声时不排名。
2. **无温度控制存证**: 历史对局的 temperature 设置未记录在日志中 (TODO: match 记录补 temperature 字段)。
3. **先手偏差**: 镜像对局可消除单对偏差, 但跨模型对战仍需红黑双向各一局。
4. **动态模型**: 供应商模型会静默更新, 同名模型不同时间的表现可能不同; 排名条目建议注明日期。

## 提交你的数据

1. 跑 `node test/match_headless.js ...` (或浏览器对战 + 导出棋谱)。
2. 把 `logs/match_*.json` 附在 PR/issue 里 — `leaderboard.json` 会在 CI 外由维护者重跑导出工具再生成 (不手工编辑数字)。
3. 大规模跑批请自备 API key; 本项目不提供任何代跑服务。
