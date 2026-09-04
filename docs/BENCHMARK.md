# Benchmark & Headless Matches / 批量对局与无头评测

> How to run games without the browser, read the stat lines, and turn logs into blunder reports.
> 如何脱离浏览器跑对局、读懂统计行、把日志变成瞎走报告。

## 1. Random smoke + Elo / 随机对局冒烟

```bash
node benchmark/cli.js 10 200    # [games] [maxPlies per game]
```

- RandomAI vs RandomAI; the engine must produce **zero illegal moves** — the process exits 1 otherwise. 引擎正确性冒烟（零非法着法门禁）+ Elo 表演示。
- Per game: one line via `Record.summarize` (红胜/黑胜/和 · 手数 · 吃子 · 用时 + 终局标签); end: 汇总 + Elo leaderboard.

## 2. Headless LLM match / 无头 LLM 对局

```bash
node server.js                                       # relay must be up / 需先启动中继
node test/match_headless.js tokenrhythm glm-5.3-flash 30   # [provider] [model] [maxPlies]
```

- Plays LLM vs LLM through the **same agent code path as the UI** (prompts, retries, guards, caching all identical).
- Writes `logs/match_headless.json` (atomic tmp+rename) and auto-runs the blunder detector at the end.
- Requires an `apiKey` for the provider in `config/keys.json` (hot-reloaded per request).
- Exit codes: **MATCH OK** = meta rate 100% and game complete; **MATCH INCOMPLETE** = partial game (fallback moves carry no meta) — expected exit code, not a crash. 兑底/残局属预期退出码，非故障。

### Stat lines / 统计行口径

| Line | Meaning |
|---|---|
| 缓存命中 X tok (Y%) | prefix-cache hits (v2.6/v2.7: constant system + append-only history) |
| 系统拦截 N | code-level guard rejections (opening cannon-takes-knight/advisor/bishop, hanging-piece guard) |
| attempts | per-move retry counts (`[LLM 红/黑] attempt N 失败重试` in server.log for details) |

## 3. Blunder analysis / 瞎走分析

```bash
node test/analyze_blunders.js logs/match_headless.json          # report to stdout
node test/analyze_blunders.js logs/match_headless.json out.txt  # also write txt
node test/analyze_blunders.js --selftest                        # built-in regression
```

Detected issue types / 检测类型:

- **送吃/无根亏换** — moved into an attacked, unrecapturable square (static exchange)
- **漏吃** — a free piece stood on the board and was not taken
- **来回拉锯** — same pieces shuffling back and forth
- **错失必杀/困毙** — a winning (mate/stalemate) move was available but not played
- **开局违规** — code-guard interception stats (opening three-task progress)
- **长将** — perpetual-check streaks (≥4 warn, =6 loses by rule)

Report-layer knobs: `--top=N` (limit listed issues) and `--type=` (filter by type); detection logic unaffected.

## 4. Records / 棋谱流向

- Browser: `localStorage` (`xq_records_v1`) → replay picker, deep link `#rp=ls:<id>`.
- Headless: `logs/match_headless.json` — loadable via the replay overlay 📂 import.
- JSON import/export formats are identical everywhere; PGN export includes per-move `{cn: ...}` Chinese notation comments.
